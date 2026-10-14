import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadCatalogue } from "../src/services/catalogueDownload";
import { trainingItems } from "../src/data/training";
import type { Storage, Change } from "../src/data/storage";
class Memory implements Storage {
  rows = new Map<string, unknown>();
  async get<T>(key: string) {
    return structuredClone(this.rows.get(key) ?? null) as T | null;
  }
  async list<T>(prefix: string) {
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value) as T);
  }
  async batch(changes: Change[]) {
    for (const change of changes)
      change.value === null
        ? this.rows.delete(change.key)
        : this.rows.set(change.key, structuredClone(change.value));
  }
}
test("interrupted catalogue resumes completed pages and never changes the active catalogue", async () => {
  const store = new Memory();
  store.rows.set("item:old", { id: "old" });
  const manifest = {
    version: "v1",
    count: 3,
    pages: [
      { id: "a", count: 2 },
      { id: "b", count: 1 },
    ],
  };
  let requests: number[] = [];
  await assert.rejects(
    downloadCatalogue(manifest, "shop", store, async (index) => {
      requests.push(index);
      if (index === 1) throw Error("offline");
      return trainingItems.slice(0, 2);
    }),
    /offline/,
  );
  assert.deepEqual(requests, [0, 1]);
  assert.deepEqual(await store.get("item:old"), { id: "old" });
  requests = [];
  const result = await downloadCatalogue(
    manifest,
    "shop",
    store,
    async (index) => {
      requests.push(index);
      return trainingItems.slice(2, 3);
    },
  );
  assert.equal(result.length, 3);
  assert.deepEqual(requests, [1]);
  const changed = await downloadCatalogue(
    { version: "v2", count: 1, pages: [{ id: "b", count: 1 }] },
    "shop",
    store,
    async () => {
      throw Error("must reuse unchanged page");
    },
  );
  assert.equal(changed.length, 1);
  assert.equal((await store.list("catalogue-page:shop:")).length, 1);
});
test("more than ten thousand items download without an item cap", async () => {
  const count = 10017,
    pages = Array.from({ length: Math.ceil(count / 256) }, (_, index) => ({
      id: "page" + index,
      count: Math.min(256, count - index * 256),
    }));
  const result = await downloadCatalogue(
    { version: "large", count, pages },
    "large",
    new Memory(),
    async (index) =>
      Array.from({ length: pages[index]!.count }, (_, offset) => ({
        ...trainingItems[0]!,
        id: String(index * 256 + offset),
      })),
  );
  assert.equal(result.length, count);
  assert.equal(new Set(result.map((item) => item.id)).size, count);
});
test("scope changes never reuse another shop cache; corrupt counts and duplicate IDs fail closed", async () => {
  const store = new Memory(),
    manifest = { version: "v", count: 1, pages: [{ id: "p", count: 1 }] };
  await downloadCatalogue(manifest, "one", store, async () => [
    trainingItems[0]!,
  ]);
  await assert.rejects(
    downloadCatalogue(manifest, "two", store, async () => {
      throw Error("offline");
    }),
    /offline/,
  );
  await assert.rejects(
    downloadCatalogue({ ...manifest, count: 2 }, "one", store, async () => []),
    /invalidServer/,
  );
  await assert.rejects(
    downloadCatalogue(
      { version: "v", count: 2, pages: [{ id: "dup", count: 2 }] },
      "one",
      store,
      async () => [trainingItems[0]!, trainingItems[0]!],
    ),
    /invalidServer/,
  );
});
