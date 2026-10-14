import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../src/data/repository";
import { trainingShop, trainingItems } from "../src/data/training";
import type { Storage, Change } from "../src/data/storage";
import type { Sale } from "../src/domain/types";
import { receiptsToPrune } from "../src/domain/retention";
import { receiptText } from "../src/services/receiptText";

class Memory implements Storage {
  data = new Map<string, unknown>();
  fail = false;
  async get<T>(key: string) {
    return structuredClone(this.data.get(key) ?? null) as T | null;
  }
  async list<T>(prefix: string) {
    return [...this.data]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, v]) => structuredClone(v) as T);
  }
  async batch(changes: Change[]) {
    if (this.fail) throw Error("disk full");
    for (const c of changes)
      c.value === null
        ? this.data.delete(c.key)
        : this.data.set(c.key, structuredClone(c.value));
  }
}
async function setup() {
  const store = new Memory();
  let i = 0;
  const repo = new Repository(store, () => `id-${++i}`);
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://example.invalid",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.settings({
    locale: "ta",
    printer: "bluetooth",
    autoPrint: true,
    directPrinter: {
      address: "AA:BB:CC:DD:EE:FF",
      name: "Kitchen",
      width: 384,
    },
  });
  await repo.addItem(trainingItems[0]!);
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  return { store, repo, sale };
}
test("offline checkout atomically queues direct printing and upload but never Till printing", async () => {
  const { repo, sale } = await setup();
  assert.equal(sale.tillPrint, undefined);
  assert.equal((await repo.load()).outbox.length, 1);
  assert.equal((await repo.directPrintJobs())[0]?.state, "queued");
  await assert.rejects(repo.queueTillPrint(sale.id), /printCheckPaper/);
});
test("interrupted send survives restart as unknown; explicit reprint reuses receipt and is audited", async () => {
  const { store, repo, sale } = await setup();
  await repo.prepareDirectPrint(sale.id);
  const reboot = new Repository(store, () => "reboot");
  await reboot.recoverDirectPrints();
  assert.equal((await reboot.directPrintJobs())[0]?.state, "unknown");
  await assert.rejects(reboot.prepareDirectPrint(sale.id), /printCheckPaper/);
  await assert.rejects(reboot.signOut(), /printCheckPaper/);
  const next = await reboot.prepareDirectPrint(sale.id, true);
  assert.equal(next.attempts, 2);
  assert.equal((await store.list("print-audit:")).length, 2);
  await reboot.completeDirectPrint(sale.id, "submitted");
  await assert.rejects(reboot.prepareDirectPrint(sale.id), /printCheckPaper/);
  await reboot.completeDirectPrint(sale.id, "confirmed");
  assert.equal((await reboot.load()).sales.length, 1);
});
test("concurrent direct print attempts have a single execution owner", async () => {
  const { repo, sale } = await setup();
  const results = await Promise.allSettled([
    repo.prepareDirectPrint(sale.id),
    repo.prepareDirectPrint(sale.id),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("cash drawer is opt-in, cash-only and never pulsed again on retry or reprint", async () => {
  const { repo, store, sale } = await setup();
  const settings = (await repo.load()).settings;
  const printer = { ...settings.directPrinter!, cashDrawer: 0 as const };
  await repo.settings({ ...settings, directPrinter: printer });
  // Existing jobs keep the exact printer configuration from checkout.
  assert.equal((await repo.prepareDirectPrint(sale.id)).drawerPulse, undefined);
  await repo.completeDirectPrint(sale.id, "submitted");
  await repo.addItem(trainingItems[0]!);
  const next = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  assert.equal((await repo.prepareDirectPrint(next.id)).drawerPulse, 0);
  await repo.completeDirectPrint(next.id, "failed");
  assert.equal((await repo.prepareDirectPrint(next.id)).drawerPulse, undefined);
  await repo.completeDirectPrint(next.id, "submitted");
  assert.equal(
    (await repo.prepareDirectPrint(next.id, true)).drawerPulse,
    undefined,
  );
  await repo.completeDirectPrint(next.id, "submitted");
  // Even a stored electronic-payment receipt can never request the cash pulse.
  await store.batch([
    {
      key: "sale:upi",
      value: {
        ...next,
        id: "upi",
        payment: { method: "upi", status: "staff-confirmed" },
      },
    },
  ]);
  assert.equal((await repo.prepareDirectPrint("upi")).drawerPulse, undefined);
});
test("failed journal commit never authorizes a printer send", async () => {
  const { repo, store, sale } = await setup();
  store.fail = true;
  await assert.rejects(repo.prepareDirectPrint(sale.id), /disk full/);
  assert.equal((await repo.directPrintJobs())[0]?.state, "queued");
});
test("retention preserves pending sales, outbox and unresolved prints beyond age/count limits", async () => {
  const { repo, store, sale } = await setup();
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  const rows: Sale[] = [
    { ...sale, id: "pending", createdAt: old },
    { ...sale, id: "review", sync: "review", createdAt: old },
    { ...sale, id: "printed-unknown", sync: "synced", createdAt: old },
    { ...sale, id: "outbox", sync: "synced", createdAt: old },
    { ...sale, id: "old", sync: "synced", createdAt: old },
    { ...sale, id: "recent", sync: "synced" },
  ];
  const pending = (await repo.load()).outbox[0]!;
  const job = (await repo.directPrintJobs())[0]!;
  assert.deepEqual(
    receiptsToPrune(
      rows,
      [{ ...pending, saleId: "outbox" }],
      [{ ...job, saleId: "printed-unknown", state: "unknown" }],
    ),
    ["old"],
  );
  await store.batch([
    {
      key: "sale:" + sale.id,
      value: { ...sale, sync: "synced", createdAt: old },
    },
    { key: "outbox:" + sale.id, value: null },
  ]);
  await repo.pruneReceipts();
  assert.equal((await repo.load()).sales.length, 1);
  await repo.completeDirectPrint(sale.id, "confirmed");
  await repo.pruneReceipts();
  assert.equal((await repo.load()).sales.length, 0);
  assert.equal((await repo.load()).items.length, trainingItems.length);
});
test("raster receipt source preserves localized text and strips input control characters", async () => {
  const { sale } = await setup();
  const text = receiptText(sale, "தமிழ்\u001b@ shop", "ta", (key) => key);
  assert.match(text, /தமிழ்/);
  assert.doesNotMatch(text, /\u001b/);
  assert.match(text, /cash/);
});
test("receipt count limit does not limit item catalogue or pending receipts", async () => {
  const { sale } = await setup();
  const receipts = Array.from({ length: 10002 }, (_, i) => ({
    ...sale,
    id: `r${i}`,
    sync: "synced" as const,
    createdAt: new Date(Date.now() - i * 1000).toISOString(),
  }));
  const pending = { ...sale, id: "unsent", createdAt: "2000-01-01T00:00:00Z" };
  assert.deepEqual(receiptsToPrune([...receipts, pending], [], []), [
    "r10000",
    "r10001",
  ]);
});
test("sign-out archives follow branch retention without exposing or pruning another branch", async () => {
  const { repo, store, sale } = await setup();
  const old = {
    ...sale,
    id: "archived",
    sync: "synced",
    createdAt: "2000-01-01T00:00:00Z",
  };
  const key = `archive:${sale.shopId}:${sale.staffId}:archived`;
  const foreignKey = `archive:${sale.shopId}:${sale.staffId}:foreign`;
  await store.batch([
    { key, value: old },
    {
      key: foreignKey,
      value: { ...old, id: "foreign", branchId: "other-branch" },
    },
  ]);
  await repo.pruneReceipts();
  assert.equal(await store.get(key), null);
  assert.ok(await store.get(foreignKey));
  assert.equal((await repo.load()).sales.length, 1);
});
test("submitted Bluetooth output does not trap the cashier after sale acknowledgment", async () => {
  const { repo, sale } = await setup();
  await repo.prepareDirectPrint(sale.id);
  await repo.completeDirectPrint(sale.id, "submitted");
  await repo.acknowledge(sale.id, "server-receipt");
  await repo.signOut();
  assert.equal((await repo.load()).shop, null);
});
