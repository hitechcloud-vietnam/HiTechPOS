import test from "node:test";
import assert from "node:assert/strict";
import { BiometricVault } from "../src/services/biometricVault";
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "b".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
function store() {
  const entries = new Map<string, string>();
  return {
    entries,
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
}
function fixture() {
  const protectedStore = store(),
    markers = store();
  let binding: string | null = "a".repeat(32);
  const vault = new BiometricVault(
    protectedStore,
    markers,
    async () => binding,
  );
  return {
    vault,
    protectedStore,
    markers,
    change: (next: string | null) => {
      binding = next;
    },
  };
}
test("biometrics require opt-in and the same live PIN enrollment without exposing a token in the preference", async () => {
  const f = fixture();
  assert.equal(await f.vault.isEnabled(), false);
  await assert.rejects(f.vault.unlock());
  await f.vault.enable(credential);
  assert.equal(await f.vault.isEnabled(), true);
  assert.equal(
    JSON.stringify([...f.markers.entries.values()]).includes(credential.token),
    false,
  );
  assert.deepEqual(await f.vault.unlock(), credential);
  f.change("c".repeat(32));
  assert.equal(await f.vault.isEnabled(), false);
  await assert.rejects(f.vault.unlock());
  f.change(null);
  await assert.rejects(f.vault.unlock());
});
test("OS cancellation, background lock, invalidation and expiry never yield a credential", async () => {
  const f = fixture();
  await f.vault.enable(credential);
  f.protectedStore.get = async () => {
    throw new Error("OS cancelled");
  };
  await assert.rejects(f.vault.unlock());
  f.protectedStore.get = async () => {
    f.vault.lock();
    return JSON.stringify({ binding: "a".repeat(32), credential });
  };
  await assert.rejects(f.vault.unlock());
  f.protectedStore.get = async () => null;
  await assert.rejects(f.vault.unlock());
  f.protectedStore.get = async () =>
    JSON.stringify({
      binding: "a".repeat(32),
      credential: { ...credential, expiresAt: "2020-01-01T00:00:00.000Z" },
    });
  await assert.rejects(f.vault.unlock());
});
test("disabling invalidates the marker before deletion and cancels queued unlock", async () => {
  const f = fixture();
  await f.vault.enable(credential);
  const pending = f.vault.unlock();
  const disabled = f.vault.disable();
  await assert.rejects(pending);
  await disabled;
  assert.equal(await f.vault.isEnabled(), false);
  assert.equal(f.protectedStore.entries.size, 0);
});
