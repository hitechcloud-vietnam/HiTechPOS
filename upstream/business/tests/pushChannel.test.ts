import test from "node:test";
import assert from "node:assert/strict";
import { createPushChannelUpdater } from "../src/services/pushChannel";

test("language refresh never creates a channel or resets a muted channel's importance", async () => {
  let existing: { name: string; importance: number } | null = null;
  const writes: unknown[] = [];
  const update = createPushChannelUpdater({
    read: async () => existing,
    name: () => "Notifications du téléphone",
    defaultImportance: 5,
    async write(name, importance, create) {
      writes.push({ name, importance, create });
      existing = { name, importance };
    },
  });
  await update();
  assert.equal(writes.length, 0);
  await update(true);
  assert.deepEqual(writes.pop(), {
    name: "Notifications du téléphone",
    importance: 5,
    create: true,
  });
  existing = { name: "Old label", importance: 2 };
  await update();
  assert.deepEqual(writes.pop(), {
    name: "Notifications du téléphone",
    importance: 2,
    create: false,
  });
  await update();
  assert.equal(writes.length, 0);
});

test("rapid language changes serialize writes and a failed refresh does not block recovery", async () => {
  let language = "Français",
    fail = false,
    calls = 0;
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const names: string[] = [];
  const update = createPushChannelUpdater({
    async read() {
      if (fail) throw new Error("native unavailable");
      return { name: "Old", importance: 2 };
    },
    name: () => language,
    defaultImportance: 5,
    async write(name) {
      if (++calls === 1) {
        started();
        await blocked;
      }
      names.push(name);
    },
  });
  const first = update();
  await firstStarted;
  language = "தமிழ்";
  const second = update();
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(names, ["Français", "தமிழ்"]);
  fail = true;
  await assert.rejects(update(), /native unavailable/);
  fail = false;
  language = "العربية";
  await update();
  assert.equal(names.at(-1), "العربية");
});

test("category creation inherits a muted legacy channel and later refresh preserves category overrides", async () => {
  let existing: { name: string; importance: number } | null = null;
  let legacyImportance = 0;
  let label = "Stock alerts";
  const writes: { name: string; importance: number; create: boolean }[] = [];
  const update = createPushChannelUpdater({
    read: async () => existing,
    name: () => label,
    defaultImportance: 3,
    initialImportance: async () => legacyImportance,
    async write(name, importance, create) {
      writes.push({ name, importance, create });
      existing = { name, importance };
    },
  });
  await update(true);
  assert.deepEqual(writes[0], {
    name: "Stock alerts",
    importance: 0,
    create: true,
  });
  existing = { name: "Stock alerts", importance: 2 };
  legacyImportance = 4;
  label = "Stock";
  await update();
  assert.deepEqual(writes[1], { name: "Stock", importance: 2, create: false });
});

test("a failed legacy settings lookup cannot silently create an unmuted category", async () => {
  let fail = true;
  const writes: number[] = [];
  const update = createPushChannelUpdater({
    read: async () => null,
    name: () => "Approvals",
    defaultImportance: 3,
    initialImportance: async () => {
      if (fail) throw new Error("settings unavailable");
      return 0;
    },
    async write(_name, importance) {
      writes.push(importance);
    },
  });
  await assert.rejects(update(true), /settings unavailable/);
  assert.deepEqual(writes, []);
  fail = false;
  await update(true);
  assert.deepEqual(writes, [0]);
});
