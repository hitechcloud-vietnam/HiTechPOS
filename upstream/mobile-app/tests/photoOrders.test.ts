import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../src/data/repository";
import type { Storage, Change } from "../src/data/storage";
import {
  photoLine,
  photoReady,
  photoScore,
  normalizePhotoText,
  type PhotoDraft,
} from "../src/domain/photoOrders";
import { trainingItems } from "../src/data/training";
class Memory implements Storage {
  rows = new Map<string, unknown>();
  fail = false;
  async get<T>(key: string) {
    return structuredClone(this.rows.get(key) ?? null) as T | null;
  }
  async list<T>(prefix: string) {
    return [...this.rows]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => structuredClone(v)) as T[];
  }
  async batch(changes: Change[]) {
    if (this.fail) throw Error("diskFull");
    const copy = new Map(this.rows);
    for (const c of changes)
      c.value === null
        ? copy.delete(c.key)
        : copy.set(c.key, structuredClone(c.value));
    this.rows = copy;
  }
}
async function setup() {
  const store = new Memory();
  let id = 0;
  const repo = new Repository(
    store,
    () => String(++id),
    () => 1000,
  );
  await repo.startTraining();
  const state = await repo.load();
  const item = trainingItems[0]!;
  const draft: PhotoDraft = {
    id: "photo1",
    scope: repo.photoScope(state.shop!),
    revision: 0,
    mode: "order",
    image: "data:image/jpeg;base64,/9j/AA==",
    createdAt: new Date(1000).toISOString(),
    lines: [
      { ...photoLine("2 coffee", "r1"), item, quantity: 2, reviewed: true },
    ],
  };
  return { store, repo, draft, item };
}
test("Unicode matching retains Tamil marks and does not equate different strengths", () => {
  assert.equal(normalizePhotoText("பால்"), "பால்");
  const item = { ...trainingItems[0]!, name: "Medicine 20 mg" };
  assert.ok(
    photoScore(item, "Medicine 20 mg") > photoScore(item, "Medicine 10 mg"),
  );
  assert.equal(photoLine("Chicken 65", "x").quantity, null);
  assert.equal(photoLine("2 coffee", "x").quantity, 2);
  assert.equal(photoLine("coffee x 3", "x").quantity, 3);
});
test("review blocks missing quantities, unconfirmed and all excluded rows", async () => {
  const { draft } = await setup();
  assert.equal(photoReady(draft), true);
  assert.equal(
    photoReady({
      ...draft,
      lines: draft.lines.map((l) => ({ ...l, quantity: null })),
    }),
    false,
  );
  assert.equal(
    photoReady({
      ...draft,
      lines: draft.lines.map((l) => ({ ...l, reviewed: false })),
    }),
    false,
  );
  assert.equal(
    photoReady({
      ...draft,
      lines: draft.lines.map((l) => ({ ...l, excluded: true })),
    }),
    false,
  );
});
test("atomic import is idempotent and survives a failed disk write", async () => {
  const { repo, store, draft } = await setup();
  const saved = await repo.savePhotoDraft(draft, null);
  store.fail = true;
  await assert.rejects(
    repo.importPhotoDraft(saved.id, saved.revision),
    /diskFull/,
  );
  store.fail = false;
  assert.equal((await repo.load()).cart.lines.length, 0);
  const a = await repo.importPhotoDraft(saved.id, saved.revision);
  const b = await repo.importPhotoDraft(saved.id, saved.revision);
  assert.equal(a, b);
  assert.equal((await repo.load()).cart.lines.length, 1);
  assert.equal((await repo.photoDraft())?.image, "");
});
test("scope, permissions, stale edits and catalogue changes are rejected", async () => {
  const { repo, store, draft, item } = await setup();
  await assert.rejects(
    repo.savePhotoDraft({ ...draft, scope: "foreign" }, null),
    /permissionDenied/,
  );
  const saved = await repo.savePhotoDraft(draft, null);
  await assert.rejects(repo.savePhotoDraft(saved, 999), /photoChanged/);
  await store.batch([
    { key: "item:" + item.id, value: { ...item, price: item.price + 1 } },
  ]);
  await assert.rejects(
    repo.importPhotoDraft(saved.id, saved.revision),
    /catalogueChanged/,
  );
  const shop = (await repo.load()).shop!;
  await store.batch([
    {
      key: "shop",
      value: { ...shop, permissions: { ...shop.permissions, sell: false } },
    },
  ]);
  await assert.rejects(
    repo.importPhotoDraft(saved.id, saved.revision),
    /permissionDenied/,
  );
});
test("saved drafts persist across repository restart and exclude only explicitly skipped rows", async () => {
  const { repo, store, draft } = await setup();
  const saved = await repo.savePhotoDraft(
    {
      ...draft,
      lines: [
        ...draft.lines,
        { ...photoLine("unreadable", "r2"), excluded: true },
      ],
    },
    null,
  );
  const reopened = new Repository(
    store,
    () => "new",
    () => 1000,
  );
  assert.equal((await reopened.photoDraft())?.id, saved.id);
  await reopened.importPhotoDraft(saved.id, saved.revision);
  assert.equal((await reopened.load()).cart.lines.length, 1);
});

test("expired captures are purged and fractional piece counts cannot be imported", async () => {
  const { repo, store, draft } = await setup();
  await repo.savePhotoDraft(draft, null);
  const expired = new Repository(
    store,
    () => "new",
    () => 8 * 86400000,
  );
  assert.equal(await expired.photoDraft(), null);
  assert.equal((await store.list("photo:")).length, 0);
  assert.equal(
    photoReady({
      ...draft,
      lines: draft.lines.map((l) => ({ ...l, quantity: 1.5 })),
    }),
    false,
  );
});

test("matching searches beyond the first catalogue page and ignores unavailable items", async () => {
  const { repo, store, item } = await setup();
  await store.batch(
    Array.from({ length: 600 }, (_, i) => ({
      key: "item:extra" + i,
      value: { ...item, id: "extra" + i, name: "Book edition " + i },
    })),
  );
  const matches = await repo.matchPhotoProducts("Book edition 599");
  assert.equal(matches[0]?.id, "extra599");
  await store.batch([
    { key: "item:extra599", value: { ...matches[0], active: false } },
  ]);
  assert.ok(
    !(await repo.matchPhotoProducts("Book edition 599")).some(
      (i) => i.id === "extra599",
    ),
  );
});
