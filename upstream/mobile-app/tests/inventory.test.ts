import { test } from "node:test";
import assert from "node:assert/strict";
import { InventoryStore } from "../src/data/inventory";
import {
  inventoryPayload,
  type InventoryDraft,
  type InventoryItem,
} from "../src/domain/inventory";
import type { Storage, Change } from "../src/data/storage";
import { trainingShop, trainingItems } from "../src/data/training";
class Memory implements Storage {
  records = new Map<string, unknown>();
  async get<T>(key: string) {
    return structuredClone(this.records.get(key) ?? null) as T | null;
  }
  async keys(prefix: string) {
    return [...this.records.keys()].filter((k) => k.startsWith(prefix));
  }
  async list<T>(prefix: string) {
    return [...this.records]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => structuredClone(v) as T);
  }
  async batch(changes: Change[]) {
    for (const c of changes)
      c.value === null
        ? this.records.delete(c.key)
        : this.records.set(c.key, structuredClone(c.value));
  }
}
const item: InventoryItem = {
  ...trainingItems[0]!,
  id: "abc",
  quantity: 10000,
  tracked: true,
  revision: "a".repeat(64),
  supplierId: "s",
  supplierName: "Supplier",
  categoryId: "c",
  sku: "sku",
  unit: "piece",
};
const draft: InventoryDraft = {
  id: "inventory-test-one",
  createdAt: new Date().toISOString(),
  mode: "count",
  state: "draft",
  reason: "Count",
  lines: [{ item, quantity: 0 }],
};
test("zero is a valid explicit count; fractional unit and repeated identity are rejected", () => {
  assert.equal(inventoryPayload(draft).lines[0]!.quantity, 0);
  assert.throws(() => inventoryPayload({ ...draft, mode: "receive" }));
  assert.throws(() =>
    inventoryPayload({ ...draft, lines: [{ item, quantity: 1500 }] }),
  );
  assert.throws(() =>
    inventoryPayload({ ...draft, lines: [...draft.lines, ...draft.lines] }),
  );
  assert.throws(() =>
    inventoryPayload({ ...draft, lines: Array(201).fill(draft.lines[0]) }),
  );
});
test("drafts survive reopening and are isolated by server, branch and staff", async () => {
  const memory = new Memory(),
    first = new InventoryStore(memory, trainingShop);
  await first.save(draft);
  assert.equal(
    (await new InventoryStore(memory, trainingShop).drafts()).length,
    1,
  );
  for (const shop of [
    { ...trainingShop, staffId: "other" },
    { ...trainingShop, branchId: "other" },
    { ...trainingShop, baseUrl: "https://other.example/api" },
  ])
    assert.equal((await new InventoryStore(memory, shop).drafts()).length, 0);
});
test("sent contents freeze durably before a network request and cannot be discarded ambiguously", async () => {
  const store = new InventoryStore(new Memory(), trainingShop);
  await store.save(draft);
  await store.save({ ...draft, state: "sending" });
  await assert.rejects(store.save({ ...draft, reason: "changed" }));
  await assert.rejects(store.discard({ ...draft, state: "sending" }));
  assert.equal((await store.drafts())[0]!.state, "sending");
});
test("interrupted inventory refresh keeps the previous snapshot; activation removes deleted items", async () => {
  const memory = new Memory(),
    store = new InventoryStore(memory, trainingShop);
  await store.stage("items", "old", 0, [item]);
  await store.activate("items", "old", 1, "2026-01-01");
  await store.stage("items", "new", 0, [
    { ...item, id: "second", name: "New item" },
  ]);
  assert.equal((await store.cached("items", ""))[0]!.id, item.id);
  await store.activate("items", "new", 1, "2026-02-01");
  assert.deepEqual(
    (await store.cached("items", "")).map((r) => r.id),
    ["second"],
  );
});
test("an unsubmitted request reopens under a new identity without moving authority", async () => {
  const store = new InventoryStore(new Memory(), trainingShop);
  const sending = { ...draft, state: "sending" as const };
  await store.save(sending);
  const reopened = await store.reopenUnsubmitted(
    sending,
    "replacement-request",
  );
  assert.equal(reopened.state, "draft");
  assert.equal((await store.drafts()).length, 1);
  assert.equal((await store.drafts())[0]!.id, "replacement-request");
  assert.deepEqual(reopened.lines, draft.lines);
});
