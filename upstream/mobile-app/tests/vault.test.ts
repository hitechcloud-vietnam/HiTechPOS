import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import {
  SessionVault,
  validPin,
  type SecretStore,
} from "../src/services/sessionVault";
function setup() {
  const data = new Map<string, string>();
  const store: SecretStore = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  return { data, store, vault: new SessionVault(store, randomBytes) };
}
const account = {
  username: "cashier",
  password: "password-to-remember",
  token: "signed-session",
  server: "https://shop.example/api",
};
test("PIN follows existing till rules and never accepts common sequences", () => {
  for (const pin of [
    "0000",
    "1234",
    "2580",
    "1212",
    "4567",
    "543210",
    "12",
    "abcd",
  ])
    assert.equal(validPin(pin), false);
  assert.equal(validPin("4829"), true);
});
test("PIN seals remembered credentials, locks tokens, and unlocks after process restart", async () => {
  const { vault, store, data } = setup();
  await vault.remember(account);
  await vault.enroll("4829");
  assert.equal(data.has("posnic.account"), false);
  assert.equal(
    [...data.values()].some(
      (s) => s.includes(account.password) || s.includes(account.token),
    ),
    false,
  );
  vault.lock();
  assert.equal(await vault.token(), null);
  const restarted = new SessionVault(store, randomBytes);
  assert.deepEqual(await restarted.profile(), {
    username: account.username,
    server: account.server,
  });
  await assert.rejects(() => restarted.unlock("9871"), /pinWrong/);
  assert.equal(await restarted.token(), null);
  assert.deepEqual(await restarted.unlock("4829"), account);
  assert.equal(await restarted.token(), account.token);
});
test("five failures persist across restarts; recovery preserves server account", async () => {
  const { vault, store } = setup();
  await vault.remember(account);
  await vault.enroll("4829");
  vault.lock();
  for (let n = 0; n < 5; n++)
    await assert.rejects(() =>
      new SessionVault(store, randomBytes).unlock("9871"),
    );
  await assert.rejects(() => vault.unlock("4829"), /pinAttempts/);
  await vault.recover(account);
  assert.equal(await vault.hasPin(), false);
  assert.equal(await vault.token(), account.token);
});

test("cancelling an in-flight unlock cannot restore a session later", async () => {
  const { vault } = setup();
  await vault.remember(account);
  await vault.enroll("4829");
  vault.lock();
  const opening = vault.unlock("4829");
  await new Promise((resolve) => setTimeout(resolve, 10));
  vault.lock();
  await assert.rejects(() => opening, /pinLocked/);
  assert.equal(await vault.token(), null);
  assert.deepEqual(await vault.unlock("4829"), account);
});

const nativeDerive = async (pin: string, salt: Uint8Array) =>
  new Uint8Array(pbkdf2Sync(pin, salt, 600000, 32, "sha256"));
test("native PIN setup survives restart, rejects wrong PIN and retains encrypted account", async () => {
  const { store, data } = setup();
  const v = new SessionVault(store, randomBytes, nativeDerive);
  await v.remember(account);
  await v.enroll("4829");
  assert.equal(JSON.parse(data.get("posnic.pin")!).kdf, "pbkdf2-sha256-600k");
  assert.equal(data.has("posnic.account"), false);
  v.lock();
  const restarted = new SessionVault(store, randomBytes, nativeDerive);
  await assert.rejects(restarted.unlock("9871"), /pinWrong/);
  assert.deepEqual(await restarted.unlock("4829"), account);
});
test("failed native first-time setup leaves the signed-in account intact and no partial PIN", async () => {
  const { store } = setup();
  const v = new SessionVault(store, randomBytes, async () => {
    throw Error("pinTimeout");
  });
  await v.remember(account);
  await assert.rejects(v.enroll("4829"), /pinTimeout/);
  assert.equal(await v.hasPin(), false);
  assert.deepEqual(await v.account(), account);
});
test("native-capable app can unlock an existing legacy scrypt PIN", async () => {
  const { vault, store } = setup();
  await vault.remember(account);
  await vault.enroll("4829");
  vault.lock();
  const upgraded = new SessionVault(store, randomBytes, nativeDerive);
  assert.deepEqual(await upgraded.unlock("4829"), account);
});

test("locking while native PIN setup runs discards the derived key without saving a PIN", async () => {
  const { store } = setup();
  let finish!: (key: Uint8Array) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const vault = new SessionVault(
    store,
    randomBytes,
    () =>
      new Promise<Uint8Array>((resolve) => {
        finish = resolve;
        started();
      }),
  );
  await vault.remember(account);
  const setting = vault.enroll("4829");
  await ready;
  vault.lock();
  const key = new Uint8Array(32).fill(7);
  finish(key);
  await assert.rejects(setting, /pinLocked/);
  assert.ok(key.every((value) => value === 0));
  assert.equal(await vault.hasPin(), false);
});

test("each remembered connection uses only its own token, including after PIN unlock", async () => {
  const { vault, store } = setup();
  await vault.remember(account);
  const local = {
    ...account,
    server: "http://192.168.1.200:5555/api",
    token: "local-only",
  };
  await vault.rememberConnection(local);
  assert.equal((await vault.accountFor(account.server))?.token, account.token);
  assert.equal((await vault.accountFor(local.server))?.token, "local-only");
  assert.equal(await vault.accountFor("https://untrusted.example/api"), null);
  await vault.enroll("4829");
  vault.lock();
  assert.equal(await vault.accountFor(account.server), null);
  const restarted = new SessionVault(store, randomBytes);
  await restarted.unlock("4829");
  assert.equal(
    (await restarted.accountFor(account.server))?.token,
    account.token,
  );
  assert.equal((await restarted.accountFor(local.server))?.token, "local-only");
  await restarted.clear();
  assert.equal(await restarted.accountFor(local.server), null);
});
