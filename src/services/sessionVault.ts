import { scryptAsync } from "@noble/hashes/scrypt.js";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface RememberedAccount {
  token: string;
  username: string;
  password: string;
  server: string;
  connections?: Record<string, { token: string; username: string }>;
}
export type NativePinDeriver = (
  pin: string,
  salt: Uint8Array,
) => Promise<Uint8Array>;
interface PinRecord {
  kdf?: "pbkdf2-sha256-600k";
  salt: string;
  nonce: string;
  data: string;
  failures: number;
}
const encode = (s: string) =>
  Uint8Array.from(
    encodeURIComponent(s).match(/%[0-9A-F]{2}|[^%]/g) ?? [],
    (c) => (c[0] === "%" ? parseInt(c.slice(1), 16) : c.charCodeAt(0)),
  );
const decode = (b: Uint8Array) =>
  decodeURIComponent(
    Array.from(b, (c) => "%" + c.toString(16).padStart(2, "0")).join(""),
  );
export function validPin(pin: string): boolean {
  if (
    !/^\d{4,6}$/.test(pin) ||
    /^(\d)\1+$/.test(pin) ||
    [
      "1234",
      "4321",
      "0123",
      "1212",
      "2580",
      "1004",
      "2000",
      "123456",
      "654321",
      "111222",
    ].includes(pin)
  )
    return false;
  return ![1, -1].some((step) =>
    [...pin]
      .slice(1)
      .every((digit, i) => Number(digit) === Number(pin[i]) + step),
  );
}
/** Same local-unlock semantics and scrypt parameters as POS src/pin-lock.js. */
export class SessionVault {
  private generation = 0;
  private active: RememberedAccount | null = null;
  private key: Uint8Array | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private store: SecretStore,
    private random: (length: number) => Uint8Array,
    private nativeDerive?: NativePinDeriver,
  ) {}
  private serial<T>(fn: () => Promise<T>) {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  async hasPin() {
    return !!(await this.store.get("posnic.pin"));
  }
  async deviceId() {
    return this.serial(async () => {
      let value = await this.store.get("posnic.device");
      if (!value) {
        value = Array.from(this.random(16), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        await this.store.set("posnic.device", value);
      }
      return value;
    });
  }
  async profile(): Promise<{ username: string; server: string } | null> {
    const p = await this.store.get("posnic.profile");
    return p ? JSON.parse(p) : null;
  }
  async account(): Promise<RememberedAccount | null> {
    if (await this.hasPin()) return this.active;
    const saved = await this.store.get("posnic.account");
    return saved ? JSON.parse(saved) : null;
  }
  async token() {
    if (await this.hasPin()) return this.active?.token ?? null;
    return (
      (await this.account())?.token ?? (await this.store.get("posnic.token"))
    );
  }
  async accountFor(server: string): Promise<RememberedAccount | null> {
    const account = await this.account();
    if (account?.server === server) return account;
    const saved = account?.connections?.[server];
    return saved ? { ...saved, server, password: "" } : null;
  }
  rememberConnection(account: RememberedAccount) {
    return this.serial(async () => {
      const current = await this.account();
      const connections = { ...current?.connections };
      if (current?.server && current.token)
        connections[current.server] = {
          token: current.token,
          username: current.username,
        };
      connections[account.server] = {
        token: account.token,
        username: account.username,
      };
      await this.writeAccount({ ...account, connections });
    });
  }
  async setToken(token: string) {
    const previous = await this.account();
    await this.remember({
      username: "",
      server: "",
      password: "",
      ...previous,
      token,
    });
  }
  remember(account: RememberedAccount) {
    return this.serial(() => this.writeAccount(account));
  }
  private async writeAccount(account: RememberedAccount) {
    const record = await this.record();
    if (record) {
      if (!this.key) throw new Error("pinLocked");
      await this.seal(record, this.key, account);
    } else await this.store.set("posnic.account", JSON.stringify(account));
    this.active = account;
    await this.store.set(
      "posnic.profile",
      JSON.stringify({ username: account.username, server: account.server }),
    );
    await this.store.remove("posnic.token");
  }
  private async record(): Promise<PinRecord | null> {
    const value = await this.store.get("posnic.pin");
    return value ? JSON.parse(value) : null;
  }
  private async derive(
    pin: string,
    salt: string,
    generation = this.generation,
    kdf?: PinRecord["kdf"],
  ) {
    const started = Date.now();
    let secret = await this.store.get("posnic.install-secret");
    if (!secret) {
      secret = bytesToHex(this.random(32));
      await this.store.set("posnic.install-secret", secret);
    }
    if (kdf) {
      if (kdf !== "pbkdf2-sha256-600k" || !this.nativeDerive)
        throw Error("nativeBuildRequired");
      const key = await this.nativeDerive(pin, hexToBytes(salt + secret));
      if (generation !== this.generation || key.length !== 32) {
        key.fill(0);
        throw Error("pinLocked");
      }
      return key;
    }
    return scryptAsync(encode(pin), hexToBytes(salt + secret), {
      N: 32768,
      r: 8,
      p: 1,
      dkLen: 32,
      maxmem: 64 * 1024 * 1024,
      asyncTick: 8,
      onProgress: () => {
        if (generation !== this.generation) throw new Error("pinLocked");
        if (Date.now() - started > 20000) throw new Error("pinTimeout");
      },
    });
  }
  private async seal(
    record: PinRecord,
    key: Uint8Array,
    account: RememberedAccount,
  ) {
    const nonce = this.random(12);
    const data = gcm(key, nonce).encrypt(encode(JSON.stringify(account)));
    await this.store.set(
      "posnic.pin",
      JSON.stringify({
        ...record,
        nonce: bytesToHex(nonce),
        data: bytesToHex(data),
        failures: 0,
      }),
    );
  }
  enroll(pin: string) {
    return this.serial(async () => {
      const generation = this.generation;
      if (!validPin(pin)) throw new Error("pinWeak");
      if ((await this.hasPin()) && !this.active) throw new Error("pinLocked");
      const account = (await this.account()) ?? {
        token: (await this.token()) ?? "",
        username: "",
        server: "",
        password: "",
      };
      const salt = bytesToHex(this.random(16));
      const kdf = this.nativeDerive
        ? ("pbkdf2-sha256-600k" as const)
        : undefined;
      const key = await this.derive(pin, salt, generation, kdf);
      if (generation !== this.generation) {
        key.fill(0);
        throw new Error("pinLocked");
      }
      await this.seal(
        { salt, nonce: "", data: "", failures: 0, ...(kdf ? { kdf } : {}) },
        key,
        account,
      );
      this.key?.fill(0);
      this.key = key;
      this.active = account;
      await this.store.remove("posnic.account");
      await this.store.remove("posnic.token");
    });
  }
  lock() {
    this.generation++;
    this.key?.fill(0);
    this.key = null;
    this.active = null;
  }
  clear() {
    return this.serial(async () => {
      this.lock();
      for (const key of [
        "posnic.pin",
        "posnic.account",
        "posnic.profile",
        "posnic.token",
      ])
        await this.store.remove(key);
    });
  }
  unlock(pin: string) {
    return this.serial(async () => {
      const generation = this.generation;
      const record = await this.record();
      if (!record) throw new Error("pinMissing");
      if (record.failures >= 5) throw new Error("pinAttempts");
      // Persist before derivation: process termination cannot reset failed tries.
      await this.store.set(
        "posnic.pin",
        JSON.stringify({ ...record, failures: record.failures + 1 }),
      );
      const key = await this.derive(pin, record.salt, generation, record.kdf);
      let account: RememberedAccount;
      try {
        account = JSON.parse(
          decode(
            gcm(key, hexToBytes(record.nonce)).decrypt(hexToBytes(record.data)),
          ),
        );
      } catch {
        key.fill(0);
        throw new Error(record.failures + 1 >= 5 ? "pinAttempts" : "pinWrong");
      }
      await this.store.set(
        "posnic.pin",
        JSON.stringify({ ...record, failures: 0 }),
      );
      if (this.generation !== generation) {
        key.fill(0);
        throw new Error("pinLocked");
      }
      this.key = key;
      this.active = account;
      return account;
    });
  }
  // Only call after a fresh server authentication and pinned identity check.
  recover(account: RememberedAccount) {
    return this.serial(async () => {
      await this.store.set("posnic.account", JSON.stringify(account));
      await this.store.remove("posnic.pin");
      this.lock();
      this.active = account;
    });
  }
}
