import { z } from "zod";
import {
  credentialSchema,
  type Credential,
  type SecretStore,
  VaultError,
} from "./sessionVault";

const KEY = "business.biometric.v1";
const recordSchema = z
  .object({
    binding: z.string().regex(/^[a-f0-9]{32}$/),
    credential: credentialSchema,
  })
  .strict();
/** The credential store must require OS biometric authentication for reads.
 * The separate marker contains only a non-secret PIN enrollment binding. */
export class BiometricVault {
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private protectedStore: SecretStore,
    private markerStore: SecretStore,
    private binding: () => Promise<string | null>,
    private now = Date.now,
  ) {}
  lock() {
    this.generation++;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  async isEnabled() {
    const binding = await this.binding();
    return !!binding && (await this.markerStore.get(KEY)) === binding;
  }
  enable(credential: Credential) {
    const generation = this.generation;
    return this.serial(async () => {
      const binding = await this.binding();
      const value = credentialSchema.parse(credential);
      if (!binding || Date.parse(value.expiresAt) <= this.now())
        throw new VaultError("signInRequired");
      if (generation !== this.generation) throw new VaultError("pinLocked");
      await this.protectedStore.set(
        KEY,
        JSON.stringify({ binding, credential: value }),
      );
      if (generation !== this.generation || binding !== (await this.binding()))
        throw new VaultError("pinLocked");
      await this.markerStore.set(KEY, binding);
    });
  }
  unlock(): Promise<Credential> {
    const generation = this.generation;
    return this.serial(async () => {
      const binding = await this.binding();
      if (!binding || !(await this.isEnabled()))
        throw new VaultError("signInRequired");
      if (generation !== this.generation) throw new VaultError("pinLocked");
      // This read invokes the OS prompt. A separate authenticateAsync followed
      // by an unprotected read would not bind authentication to the credential.
      const raw = await this.protectedStore.get(KEY);
      const record = recordSchema.safeParse(raw ? JSON.parse(raw) : null);
      if (
        !record.success ||
        record.data.binding !== binding ||
        Date.parse(record.data.credential.expiresAt) <= this.now()
      )
        throw new VaultError("signInRequired");
      if (
        generation !== this.generation ||
        binding !== (await this.binding()) ||
        !(await this.isEnabled())
      )
        throw new VaultError("pinLocked");
      return record.data.credential;
    });
  }
  disable() {
    this.lock();
    return this.serial(async () => {
      await this.markerStore.remove(KEY);
      await this.protectedStore.remove(KEY);
    });
  }
}
