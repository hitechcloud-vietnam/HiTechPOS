import { scryptAsync } from "@noble/hashes/scrypt.js";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { communityOrigin } from "../domain/server";

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export const credentialSchema = z
  .object({
    origin: z.string().refine((value) => {
      try {
        return communityOrigin(value) === value;
      } catch {
        return false;
      }
    }),
    token: z.string().regex(/^pb1_[A-Za-z0-9_-]{43}$/),
    expiresAt: z.string().datetime(),
    authorizationOrigin: z.string().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.authorizationOrigin === undefined ||
      value.authorizationOrigin === value.origin ||
      value.authorizationOrigin === "https://www.posnic.com",
    "Unexpected authorization origin",
  );
export type Credential = z.infer<typeof credentialSchema>;
const recordSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    nonce: z.string().regex(/^[a-f0-9]{24}$/),
    data: z
      .string()
      .min(32)
      .max(8192)
      .regex(/^[a-f0-9]+$/),
    failures: z.number().int().min(0).max(5),
  })
  .strict();
const RECORD = "business.pin.v1",
  SECRET = "business.install-secret.v1",
  UNLOCKED = "business.device-session.v1";
const deviceSchema = z
  .object({
    credential: credentialSchema,
    binding: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict();
export class VaultError extends Error {
  constructor(
    public readonly code:
      | "pinWeak"
      | "pinIncorrect"
      | "pinLocked"
      | "signInRequired"
      | "storageUnavailable",
  ) {
    super(code);
  }
}
export function validPin(pin: string) {
  return (
    /^(?:\d{4}|\d{6})$/.test(pin) &&
    !/^(\d)\1+$/.test(pin) &&
    !/^(\d\d)\1$/.test(pin) &&
    !/^(\d\d)\1\1$/.test(pin) &&
    !/^(\d\d\d)\1$/.test(pin) &&
    ![
      "123456",
      "654321",
      "012345",
      "543210",
      "111222",
      "112233",
      "000000",
      "1234",
      "4321",
      "0123",
      "3210",
      "2580",
      "0852",
      "1122",
      "2000",
    ].includes(pin) &&
    ![1, -1].some((step) =>
      [...pin].slice(1).every((digit, i) => +digit === +pin[i]! + step),
    )
  );
}
/** Only minimal Business credentials are persisted; never passwords or report data. */
export class SessionVault {
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private store: SecretStore,
    private random: (size: number) => Promise<Uint8Array>,
    private now = Date.now,
    private nativeDerive?: (
      pin: string,
      saltAndSecret: string,
    ) => Promise<Uint8Array>,
    private legacyDerive?: (
      pin: string,
      saltAndSecret: string,
    ) => Promise<Uint8Array>,
  ) {}
  lock() {
    this.generation++;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  async hasCredential() {
    return (
      (await this.store.get(RECORD)) !== null ||
      (await this.store.get(UNLOCKED)) !== null
    );
  }
  async pinEnabled() {
    return (await this.store.get(RECORD)) !== null;
  }
  async unlockWithoutPin(): Promise<Credential> {
    const generation = this.generation;
    return this.serial(async () => {
      if (await this.store.get(RECORD)) throw new VaultError("signInRequired");
      const raw = await this.store.get(UNLOCKED);
      const parsed = deviceSchema.safeParse(raw ? JSON.parse(raw) : null);
      if (
        !parsed.success ||
        Date.parse(parsed.data.credential.expiresAt) <= this.now()
      )
        throw new VaultError("signInRequired");
      if (generation !== this.generation) throw new VaultError("pinLocked");
      return parsed.data.credential;
    });
  }
  /** Explicitly opt out of the additional app PIN; platform storage remains device-bound. */
  async disablePin(pin: string) {
    const generation = this.generation;
    const credential = await this.unlock(pin);
    return this.serial(async () => {
      if (generation !== this.generation) throw new VaultError("pinLocked");
      const record = recordSchema.parse(
        JSON.parse((await this.store.get(RECORD)) || "null"),
      );
      await this.store.set(
        UNLOCKED,
        JSON.stringify({ credential, binding: record.salt }),
      );
      if (generation !== this.generation) {
        await this.store.remove(UNLOCKED);
        throw new VaultError("pinLocked");
      }
      await this.store.remove(RECORD);
    });
  }
  /** Non-secret enrollment binding. A replacement PIN vault or exhausted PIN
   * budget also invalidates its optional biometric credential. */
  biometricBinding(): Promise<string | null> {
    const generation = this.generation;
    return this.serial(async () => {
      if (generation !== this.generation) return null;
      const raw = await this.store.get(RECORD);
      try {
        if (!raw) {
          const direct = await this.store.get(UNLOCKED);
          const value = deviceSchema.safeParse(
            direct ? JSON.parse(direct) : null,
          );
          return value.success &&
            Date.parse(value.data.credential.expiresAt) > this.now()
            ? value.data.binding
            : null;
        }
        const record = recordSchema.parse(JSON.parse(raw ?? "null"));
        return record.failures < 5 ? record.salt : null;
      } catch {
        return null;
      }
    });
  }
  private async derive(
    pin: string,
    salt: string,
    secret: string,
    generation: number,
    version: 1 | 2 = 1,
  ) {
    const nativeDerive = version === 2 ? this.nativeDerive : this.legacyDerive;
    if (version === 2 && !nativeDerive)
      throw new VaultError("storageUnavailable");
    if (nativeDerive) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = nativeDerive(pin, salt + secret);
      let abandoned = false;
      try {
        const key = await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              abandoned = true;
              reject(new VaultError("storageUnavailable"));
            }, 10_000);
          }),
        ]);
        if (generation !== this.generation) {
          key.fill(0);
          throw new VaultError("pinLocked");
        }
        return key;
      } finally {
        clearTimeout(timer);
        void work.then(
          (key) => {
            if (abandoned) key.fill(0);
          },
          () => {},
        );
      }
    }
    const started = this.now();
    return scryptAsync(
      new TextEncoder().encode(pin),
      hexToBytes(salt + secret),
      {
        N: 32768,
        r: 8,
        p: 1,
        dkLen: 32,
        maxmem: 64 * 1024 * 1024,
        asyncTick: 8,
        onProgress: () => {
          if (generation !== this.generation || this.now() - started > 20_000)
            throw new VaultError("pinLocked");
        },
      },
    );
  }
  enroll(credential: Credential, pin: string) {
    const generation = this.generation;
    return this.serial(async () => {
      if (!validPin(pin)) throw new VaultError("pinWeak");
      const value = credentialSchema.parse(credential);
      if (Date.parse(value.expiresAt) <= this.now())
        throw new VaultError("signInRequired");
      const salt = bytesToHex(await this.random(16)),
        nonce = await this.random(12);
      let secret = await this.store.get(SECRET);
      if (!secret) {
        secret = bytesToHex(await this.random(32));
        await this.store.set(SECRET, secret);
      }
      if (!/^[a-f0-9]{64}$/.test(secret))
        throw new VaultError("storageUnavailable");
      const version = this.nativeDerive ? 2 : 1;
      const key = await this.derive(pin, salt, secret, generation, version);
      try {
        const data = bytesToHex(
          gcm(key, nonce).encrypt(
            new TextEncoder().encode(JSON.stringify(value)),
          ),
        );
        if (generation !== this.generation) throw new VaultError("pinLocked");
        await this.store.set(
          RECORD,
          JSON.stringify({
            version,
            salt,
            nonce: bytesToHex(nonce),
            data,
            failures: 0,
          }),
        );
        await this.store.remove(UNLOCKED);
        if (generation !== this.generation) throw new VaultError("pinLocked");
      } finally {
        key.fill(0);
      }
    });
  }
  unlock(pin: string): Promise<Credential> {
    const generation = this.generation;
    return this.serial(async () => {
      if (generation !== this.generation) throw new VaultError("pinLocked");
      const raw = await this.store.get(RECORD),
        secret = await this.store.get(SECRET);
      if (!raw || !secret || !/^[a-f0-9]{64}$/.test(secret))
        throw new VaultError("signInRequired");
      let record: z.infer<typeof recordSchema>;
      try {
        record = recordSchema.parse(JSON.parse(raw));
      } catch {
        throw new VaultError("signInRequired");
      }
      if (record.failures >= 5) throw new VaultError("signInRequired");
      // Reserve the attempt durably before doing work. Killing the process or
      // parallel presses cannot reset the budget or race a later successful write.
      await this.store.set(
        RECORD,
        JSON.stringify({ ...record, failures: record.failures + 1 }),
      );
      if (!/^(?:\d{4}|\d{6})$/.test(pin))
        throw new VaultError(
          record.failures === 4 ? "signInRequired" : "pinIncorrect",
        );
      const key = await this.derive(
        pin,
        record.salt,
        secret,
        generation,
        record.version,
      );
      let credential: Credential;
      try {
        const plain = gcm(key, hexToBytes(record.nonce)).decrypt(
          hexToBytes(record.data),
        );
        try {
          credential = credentialSchema.parse(
            JSON.parse(new TextDecoder().decode(plain)),
          );
        } finally {
          plain.fill(0);
        }
      } catch {
        throw new VaultError(
          record.failures === 4 ? "signInRequired" : "pinIncorrect",
        );
      } finally {
        key.fill(0);
      }
      if (generation !== this.generation) throw new VaultError("pinLocked");
      if (Date.parse(credential.expiresAt) <= this.now())
        throw new VaultError("signInRequired");
      if (record.version === 1 && this.nativeDerive) {
        // Preserve the enrollment binding used by biometric unlock. Only the
        // encryption format changes after a successful legacy PIN verification.
        const nextKey = await this.derive(
          pin,
          record.salt,
          secret,
          generation,
          2,
        );
        try {
          const nonce = await this.random(12);
          record = {
            ...record,
            version: 2,
            nonce: bytesToHex(nonce),
            data: bytesToHex(
              gcm(nextKey, nonce).encrypt(
                new TextEncoder().encode(JSON.stringify(credential)),
              ),
            ),
          };
        } finally {
          nextKey.fill(0);
        }
      }
      if (generation !== this.generation) throw new VaultError("pinLocked");
      await this.store.set(RECORD, JSON.stringify({ ...record, failures: 0 }));
      if (generation !== this.generation) throw new VaultError("pinLocked");
      return credential;
    });
  }
  forget() {
    this.lock();
    return this.serial(async () => {
      await this.store.remove(RECORD);
      await this.store.remove(UNLOCKED);
      await this.store.remove(SECRET);
    });
  }
}
