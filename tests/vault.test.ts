import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, pbkdf2 } from "node:crypto";
import {
  SessionVault,
  VaultError,
  validPin,
  credentialSchema,
} from "../src/services/sessionVault";
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "a".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
test("PIN opt-out requires verification, remains device stored, and re-enrollment removes direct access", async () => {
  const { vault, entries, create } = fixture();
  await vault.enroll(credential, "826493");
  const binding = await vault.biometricBinding();
  await assert.rejects(vault.disablePin("123456"));
  assert.equal(await vault.pinEnabled(), true);
  await vault.disablePin("826493");
  assert.equal(await vault.pinEnabled(), false);
  assert.equal(await vault.hasCredential(), true);
  assert.equal(await vault.biometricBinding(), binding);
  assert.deepEqual(await create().unlockWithoutPin(), credential);
  await vault.enroll(credential, "7391");
  await assert.rejects(vault.unlockWithoutPin());
  assert.equal(entries.has("business.device-session.v1"), false);
  await vault.forget();
  assert.equal(await vault.hasCredential(), false);
});
const code = (expected: string) => (error: unknown) =>
  error instanceof VaultError && error.code === expected;
function fixture() {
  const entries = new Map<string, string>();
  const store = {
    async get(key: string) {
      return entries.get(key) ?? null;
    },
    async set(key: string, value: string) {
      entries.set(key, value);
    },
    async remove(key: string) {
      entries.delete(key);
    },
  };
  const create = () =>
    new SessionVault(store, async (size) => randomBytes(size));
  return { entries, create, vault: create() };
}
test("PIN policy and credential schema reject trivial PINs, account passwords and insecure origins", () => {
  for (const pin of [
    "1234",
    "123456",
    "654321",
    "121212",
    "123123",
    "222222",
    "012345",
  ])
    assert.equal(validPin(pin), false);
  assert.equal(validPin("826493"), true);
  for (const authorizationOrigin of [
    undefined,
    credential.origin,
    "https://www.posnic.com",
  ])
    assert.equal(
      credentialSchema.parse({ ...credential, authorizationOrigin })
        .authorizationOrigin,
      authorizationOrigin,
    );
  for (const authorizationOrigin of [
    "https://attacker.example.com",
    "http://www.posnic.com",
    "https://www.posnic.com/path",
  ])
    assert.throws(() =>
      credentialSchema.parse({ ...credential, authorizationOrigin }),
    );
  assert.throws(() =>
    credentialSchema.parse({ ...credential, password: "do not store" }),
  );
  assert.throws(() =>
    credentialSchema.parse({
      ...credential,
      origin: "http://shop.example.com",
    }),
  );
});
test("remembered token is encrypted, authenticates ciphertext and survives process recreation", async () => {
  const { vault, entries, create } = fixture();
  await vault.enroll(credential, "826493");
  assert.ok(!JSON.stringify([...entries.values()]).includes(credential.token));
  assert.ok(!JSON.stringify([...entries.values()]).includes(credential.origin));
  assert.deepEqual(await create().unlock("826493"), credential);
  const key = "business.pin.v1",
    value = JSON.parse(entries.get(key)!);
  value.data =
    (value.data.startsWith("00") ? "01" : "00") + value.data.slice(2);
  entries.set(key, JSON.stringify(value));
  await assert.rejects(create().unlock("826493"), code("pinIncorrect"));
});
test("failed-attempt budget persists across restarts and concurrent presses", async () => {
  const { vault, create } = fixture();
  await vault.enroll(credential, "826493");
  for (let i = 0; i < 3; i++)
    await assert.rejects(create().unlock("000000"), code("pinIncorrect"));
  const next = create();
  const outcomes = await Promise.allSettled([
    next.unlock("000000"),
    next.unlock("000000"),
    next.unlock("826493"),
  ]);
  assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
  await assert.rejects(create().unlock("826493"), code("signInRequired"));
});
test("background lock cancels pending unlock; forget removes both encrypted token and installation secret", async () => {
  const { vault, entries } = fixture();
  await vault.enroll(credential, "826493");
  const pending = vault.unlock("826493");
  vault.lock();
  await assert.rejects(pending, code("pinLocked"));
  await vault.forget();
  assert.equal(entries.size, 0);
  assert.equal(await vault.hasCredential(), false);
});
test("biometric binding changes on enrollment, disappears after PIN exhaustion and sign-out", async () => {
  const { vault } = fixture();
  assert.equal(await vault.biometricBinding(), null);
  await vault.enroll(credential, "826493");
  const first = await vault.biometricBinding();
  assert.ok(first);
  await vault.enroll(credential, "937482");
  assert.notEqual(await vault.biometricBinding(), first);
  for (let i = 0; i < 5; i++) await assert.rejects(vault.unlock("000000"));
  assert.equal(await vault.biometricBinding(), null);
  await vault.forget();
  assert.equal(await vault.biometricBinding(), null);
});

const nativeKdf = (pin: string, salt: string): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    pbkdf2(
      pin,
      Buffer.from(salt, "hex"),
      600_000,
      32,
      "sha256",
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );

test("four-digit native vault persists across restarts and enforces five attempts", async () => {
  assert.equal(validPin("8264"), true);
  for (const pin of ["0000", "1111", "1212", "1234", "4321", "2580", "12345"])
    assert.equal(validPin(pin), false);
  const entries = new Map<string, string>();
  const store = {
    get: async (k: string) => entries.get(k) ?? null,
    set: async (k: string, v: string) => {
      entries.set(k, v);
    },
    remove: async (k: string) => {
      entries.delete(k);
    },
  };
  const create = () =>
    new SessionVault(store, async (n) => randomBytes(n), Date.now, nativeKdf);
  await create().enroll(credential, "8264");
  assert.equal(JSON.parse(entries.get("business.pin.v1")!).version, 2);
  assert.deepEqual(await create().unlock("8264"), credential);
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      create().unlock("0000"),
      code(i === 4 ? "signInRequired" : "pinIncorrect"),
    );
  await assert.rejects(create().unlock("8264"), code("signInRequired"));
});

test("legacy six-digit records migrate only after correct PIN and preserve biometric binding", async () => {
  const entries = new Map<string, string>();
  const store = {
    get: async (k: string) => entries.get(k) ?? null,
    set: async (k: string, v: string) => {
      entries.set(k, v);
    },
    remove: async (k: string) => {
      entries.delete(k);
    },
  };
  const old = new SessionVault(store, async (n) => randomBytes(n));
  await old.enroll(credential, "826493");
  const binding = await old.biometricBinding();
  const next = new SessionVault(
    store,
    async (n) => randomBytes(n),
    Date.now,
    nativeKdf,
  );
  await assert.rejects(next.unlock("000000"), code("pinIncorrect"));
  assert.equal(JSON.parse(entries.get("business.pin.v1")!).version, 1);
  assert.deepEqual(await next.unlock("826493"), credential);
  assert.equal(JSON.parse(entries.get("business.pin.v1")!).version, 2);
  assert.equal(await next.biometricBinding(), binding);
  assert.deepEqual(await next.unlock("826493"), credential);
});

test("backgrounding during native enrollment never saves the credential", async () => {
  const entries = new Map<string, string>();
  let finish!: (value: Uint8Array) => void;
  let started!: () => void;
  const began = new Promise<void>((r) => {
    started = r;
  });
  const store = {
    get: async (k: string) => entries.get(k) ?? null,
    set: async (k: string, v: string) => {
      entries.set(k, v);
    },
    remove: async (k: string) => {
      entries.delete(k);
    },
  };
  const vault = new SessionVault(
    store,
    async (n) => randomBytes(n),
    Date.now,
    async () => {
      started();
      return new Promise((r) => {
        finish = r;
      });
    },
  );
  const enrolling = vault.enroll(credential, "8264");
  await began;
  vault.lock();
  const key = new Uint8Array(32).fill(1);
  finish(key);
  await assert.rejects(enrolling, code("pinLocked"));
  assert.equal(await vault.hasCredential(), false);
  assert.ok(key.every((x) => x === 0));
});
