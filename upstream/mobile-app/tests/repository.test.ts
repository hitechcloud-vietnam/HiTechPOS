import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../src/data/repository";
import type { Storage, Change } from "../src/data/storage";
import { trainingItems, trainingShop } from "../src/data/training";
import { SyncWorker } from "../src/services/sync";
import { ApiError } from "../src/services/api";
import { receiptHtml } from "../src/services/receipt";

class MemoryStore implements Storage {
  records = new Map<string, unknown>();
  fail = false;
  async get<T>(key: string) {
    return structuredClone(this.records.get(key) ?? null) as T | null;
  }
  async list<T>(prefix: string) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, v]) => structuredClone(v) as T);
  }
  async batch(changes: Change[]) {
    const next = new Map(this.records);
    for (const change of changes) {
      if (change.value === null) next.delete(change.key);
      else next.set(change.key, structuredClone(change.value));
    }
    if (this.fail) throw new Error("disk full");
    this.records = next;
  }
}
function setup() {
  const storage = new MemoryStore();
  let sequence = 0;
  const repo = new Repository(
    storage,
    () => `id-${++sequence}`,
    () => 1000,
  );
  return { storage, repo };
}

test("cloud confirmation is separate from local acceptance and cannot acknowledge an unuploaded or foreign receipt", async () => {
  const { repo } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  const proof = {
    id: sale.id,
    serverId: "server-one",
    receivedAt: new Date().toISOString(),
  };
  await assert.rejects(repo.confirmCloud([proof]), /invalidServer/);
  assert.equal((await repo.load()).outbox.length, 1);
  await repo.acknowledge(sale.id, proof.serverId);
  assert.equal((await repo.load()).sales[0]!.cloudReceivedAt, undefined);
  await assert.rejects(
    repo.confirmCloud([{ ...proof, serverId: "other" }]),
    /invalidServer/,
  );
  await repo.confirmCloud([proof]);
  assert.equal((await repo.load()).sales[0]!.cloudReceivedAt, proof.receivedAt);
  assert.equal((await repo.load()).outbox.length, 0);
});
test("checkout survives repository recreation and repeated checkout returns same receipt", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  const [a, b] = await Promise.all([
    repo.checkout(cart.id, { method: "cash", received: 5000, change: 999 }),
    repo.checkout(cart.id, { method: "cash", received: 5000, change: 999 }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.payment.method, "cash");
  assert.equal(a.payment.method === "cash" && a.payment.change, 1500);
  const reboot = new Repository(storage, () => "restart");
  const data = await reboot.load();
  assert.equal(data.sales.length, 1);
  assert.equal(data.cart.lines.length, 0);
  assert.equal(data.outbox.length, 0);
});
test("failed commit retains cart and creates neither sale nor outbox", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  storage.fail = true;
  await assert.rejects(() =>
    repo.checkout(cart.id, { method: "cash", received: 5000, change: 0 }),
  );
  storage.fail = false;
  const data = await repo.load();
  assert.equal(data.cart.id, cart.id);
  assert.equal(data.cart.lines.length, 1);
  assert.equal(data.sales.length, 0);
});
test("underpayment, denied action, duplicate code and expired offline grant do not mutate sales", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  const state = await repo.load();
  await assert.rejects(
    () =>
      repo.checkout(state.cart.id, { method: "cash", received: 1, change: 0 }),
    /insufficientCash/,
  );
  await assert.rejects(
    () => repo.createItem({ ...trainingItems[0]!, id: "other" }),
    /duplicateCode/,
  );
  await storage.batch([
    {
      key: "shop",
      value: { ...trainingShop, offlineUntil: "1970-01-01T00:00:00Z" },
    },
  ]);
  await assert.rejects(
    () =>
      repo.checkout(state.cart.id, {
        method: "cash",
        received: 5000,
        change: 0,
      }),
    /grantExpired/,
  );
  assert.equal((await repo.load()).sales.length, 0);
});
test("hold and resume preserve cart and refuse to overwrite another cart", async () => {
  const { repo } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  const id = (await repo.load()).cart.id;
  await repo.hold();
  await repo.addItem(trainingItems[1]!);
  await assert.rejects(() => repo.resume(id), /cartNotEmpty/);
  await repo.hold();
  await repo.resume(id);
  assert.equal((await repo.load()).cart.lines[0]?.name, "Filter coffee");
});
test("live sale and outbox commit together; transient retry preserves authority and identifier", async () => {
  const { repo } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  const sale = await repo.checkout(cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  assert.equal((await repo.load()).outbox.length, 1);
  let calls = 0;
  const worker = new SyncWorker(repo, (url) => ({
    upload: async (sent) => {
      assert.equal(url, "https://shop.example/api");
      assert.equal(sent.id, sale.id);
      calls++;
      throw new ApiError("networkError");
    },
  }));
  await Promise.all([worker.run(), worker.run()]);
  assert.equal(calls, 1);
  const pending = (await repo.load()).outbox[0]!;
  assert.equal(pending.attempts, 1);
  assert.equal(pending.state, "pending");
});
test("successful sync acknowledges once; permanent rejection keeps paid receipt in review", async () => {
  const { repo } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  let cart = (await repo.load()).cart;
  await repo.checkout(cart.id, { method: "cash", received: 5000, change: 0 });
  await new SyncWorker(repo, () => ({
    upload: async (sale) => ({
      saleId: sale.id,
      serverId: "remote1",
      shopId: sale.shopId,
      branchId: sale.branchId,
    }),
  })).run();
  assert.equal((await repo.load()).outbox.length, 0);
  await repo.addItem(trainingItems[0]!);
  cart = (await repo.load()).cart;
  await repo.checkout(cart.id, { method: "cash", received: 5000, change: 0 });
  await new SyncWorker(repo, () => ({
    upload: async () => {
      throw new ApiError("permissionDenied", 403);
    },
  })).run();
  assert.equal((await repo.load()).outbox[0]?.state, "review");
  assert.ok((await repo.load()).sales.some((s) => s.sync === "review"));
});
test("receipt escapes merchant and item markup", async () => {
  const { repo } = setup();
  await repo.startTraining();
  await repo.addQuick(100, "<script>alert(1)</script>");
  const cart = (await repo.load()).cart;
  const sale = await repo.checkout(cart.id, {
    method: "cash",
    received: 100,
    change: 0,
  });
  const html = receiptHtml(sale, "<img onerror=x>", (x) => x);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;img/);
  assert.match(html, /trainingReceipt/);
});

test("catalogue refresh is atomic, tenant pinned, and preserves cart price snapshots", async () => {
  const { repo, storage } = setup();
  const shop = {
    ...trainingShop,
    mode: "live" as const,
    baseUrl: "https://shop.example/api",
  };
  await repo.pair(shop, trainingItems);
  await repo.addItem(trainingItems[0]!);
  const changed = { ...trainingItems[0]!, price: 9900 };
  await assert.rejects(
    () => repo.refreshCatalogue({ ...shop, branchId: "other" }, [changed]),
    /invalidServer/,
  );
  storage.fail = true;
  await assert.rejects(
    () => repo.refreshCatalogue(shop, [changed]),
    /disk full/,
  );
  storage.fail = false;
  assert.equal((await repo.load()).items.length, trainingItems.length);
  await repo.refreshCatalogue({ ...shop, snapshotVersion: "next" }, [changed]);
  const state = await repo.load();
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0]?.price, 9900);
  assert.equal(state.cart.lines[0]?.price, 3500);
  assert.equal(state.shop?.snapshotVersion, "next");
  await assert.rejects(repo.addItem(trainingItems[0]!), /catalogueChanged/);
  await assert.rejects(repo.addItem(trainingItems[1]!), /catalogueChanged/);
  await repo.addItem(changed);
  const updated = await repo.load();
  assert.deepEqual(
    updated.cart.lines.map((line) => line.price),
    [3500, 9900],
  );
});

test("leaving training clears only practice data and refuses live shops", async () => {
  const { repo } = setup();
  await repo.startTraining();
  await repo.settings({ locale: "ta", printer: "system", autoPrint: false });
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  await repo.checkout(cart.id, { method: "cash", received: 3500, change: 0 });
  await repo.leaveTraining();
  let state = await repo.load();
  assert.equal(state.shop, null);
  assert.equal(state.sales.length, 0);
  assert.equal(state.items.length, 0);
  assert.equal(state.settings.locale, "ta");
  await repo.pair({ ...trainingShop, mode: "live" }, trainingItems);
  await assert.rejects(() => repo.leaveTraining(), /permissionDenied/);
  state = await repo.load();
  assert.equal(state.items.length, trainingItems.length);
});

test("manual recovery bypasses backoff and a restarted worker sends the durable sale", async () => {
  const { repo, storage } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  const entry = (await repo.load()).outbox[0]!;
  await storage.batch([
    {
      key: "outbox:" + entry.id,
      value: { ...entry, nextAttemptAt: Date.now() + 300000 },
    },
  ]);
  const reopened = new Repository(
    storage,
    () => "next-cart",
    () => 1000,
  );
  const worker = new SyncWorker(reopened, () => ({
    upload: async (sent) => ({
      saleId: sent.id,
      shopId: sent.shopId,
      branchId: sent.branchId,
      serverId: "remote",
    }),
  }));
  await worker.run();
  assert.equal((await reopened.load()).outbox.length, 1);
  await worker.run(true);
  assert.equal((await reopened.load()).outbox.length, 0);
  assert.equal(
    (await reopened.load()).sales.find((s) => s.id === sale.id)?.sync,
    "synced",
  );
});

test("offline till print survives restart and sale acknowledgement", async () => {
  const { repo, storage } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: {
        ...trainingShop.capabilities,
        saleSync: true,
        tillPrint: true,
      },
    },
    trainingItems,
  );
  await repo.settings({ locale: "en", printer: "till", autoPrint: true });
  await repo.addItem(trainingItems[0]!);
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  const reopened = new Repository(storage, () => "next-cart");
  assert.equal((await reopened.load()).sales[0]?.tillPrint, "pending");
  await reopened.acknowledge(sale.id, "server-sale");
  assert.equal((await reopened.load()).sales[0]?.tillPrint, "pending");
  await reopened.queueTillPrint(sale.id, true);
  await reopened.queueTillPrint(sale.id);
  assert.equal((await reopened.load()).sales[0]?.tillPrint, "queued");
});

test("cart lines retain the issuing catalogue when prices refresh", async () => {
  const { repo } = setup();
  const shop = {
    ...trainingShop,
    mode: "live" as const,
    baseUrl: "https://shop.example/api",
    capabilities: { ...trainingShop.capabilities, saleSync: true },
  };
  await repo.pair(shop, trainingItems);
  await repo.addItem(trainingItems[0]!);
  await repo.refreshCatalogue(
    { ...shop, snapshotVersion: "new-catalogue" },
    trainingItems.map((i) => ({ ...i, price: i.price + 100 })),
  );
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  assert.equal(sale.snapshotVersion, "new-catalogue");
  assert.equal(sale.cart.lines[0]?.snapshotVersion, shop.snapshotVersion);
  assert.equal(sale.cart.lines[0]?.price, trainingItems[0]!.price);
});

test("sign-out refuses unpaid work and archives acknowledged receipts without exposing them to the next user", async () => {
  const { repo, storage } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  await assert.rejects(() => repo.signOut(), /signOutCart/);
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  await assert.rejects(() => repo.signOut(), /signOutPending/);
  assert.equal((await repo.load()).outbox.length, 1);
  await repo.acknowledge(sale.id, "server-id");
  await repo.signOut();
  const state = await repo.load();
  assert.equal(state.shop, null);
  assert.equal(state.sales.length, 0);
  assert.equal((await storage.list("archive:")).length, 1);
});

test("revoked cart actions cannot be completed and denied mutations preserve the cart", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.addQuick(100, "Extra");
  const before = await repo.load();
  await storage.batch([
    {
      key: "shop",
      value: {
        ...before.shop,
        permissions: {
          ...before.shop!.permissions,
          quickSale: false,
          voidLine: false,
        },
      },
    },
  ]);
  await assert.rejects(
    () => repo.quantity(before.cart.lines[0]!.id, -1),
    /permissionDenied/,
  );
  await assert.rejects(
    () =>
      repo.checkout(before.cart.id, {
        method: "cash",
        received: 100,
        change: 0,
      }),
    /permissionDenied/,
  );
  assert.deepEqual((await repo.load()).cart, before.cart);
  await storage.batch([
    {
      key: "shop",
      value: {
        ...before.shop,
        permissions: { ...before.shop!.permissions, sell: false },
      },
    },
  ]);
  await assert.rejects(() => repo.hold(), /permissionDenied/);
  await assert.rejects(() => repo.resume("anything"), /permissionDenied/);
});

test("customer permission is rechecked at checkout and printing defaults to denied", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.addItem(trainingItems[0]!);
  await repo.customer("Customer", "123");
  const state = await repo.load();
  await storage.batch([
    {
      key: "shop",
      value: {
        ...state.shop,
        permissions: {
          ...state.shop!.permissions,
          customerWrite: false,
          receiptPrint: undefined,
        },
      },
    },
  ]);
  await assert.rejects(
    () =>
      repo.checkout(state.cart.id, {
        method: "cash",
        received: 5000,
        change: 0,
      }),
    /permissionDenied/,
  );
  await assert.rejects(
    () => repo.queueTillPrint("receipt"),
    /permissionDenied/,
  );
  assert.equal((await repo.load()).sales.length, 0);
});

test("online authorization refusal suspends new actions without discarding paid offline sales", async () => {
  const { repo } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await repo.addItem(trainingItems[0]!);
  const state = await repo.load();
  await repo.checkout(state.cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  let uploads = 0;
  const worker = new SyncWorker(repo, () => ({
    catalogue: async () => {
      throw new ApiError("permissionDenied", 403);
    },
    upload: async () => {
      uploads++;
      throw new Error("must not upload");
    },
  }));
  await assert.rejects(() => worker.run(), /permissionDenied/);
  assert.equal(uploads, 0);
  assert.equal((await repo.load()).outbox.length, 1);
  assert.equal((await repo.load()).sales.length, 1);
  await assert.rejects(
    () => repo.addItem(trainingItems[0]!),
    /permissionDenied/,
  );
});

test("transport failures preserve an unexpired offline grant", async () => {
  const { repo } = setup();
  await repo.pair(
    {
      ...trainingShop,
      mode: "live",
      baseUrl: "https://shop.example/api",
      capabilities: { ...trainingShop.capabilities, saleSync: true },
    },
    trainingItems,
  );
  await new SyncWorker(repo, () => ({
    catalogue: async () => {
      throw new ApiError("networkError", 0);
    },
    upload: async () => {
      throw new Error("no pending sales");
    },
  })).run();
  await repo.addItem(trainingItems[0]!);
  assert.equal((await repo.load()).cart.lines.length, 1);
});

test("scanner writes use the offline catalogue and the same current selling ACL", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.scanProduct("POSNIC-DEMO-11");
  await repo.scanProduct("POSNIC-DEMO-11");
  const state = await repo.load();
  assert.equal(state.cart.lines[0]!.quantity, 2);
  await assert.rejects(() => repo.scanProduct("unknown-barcode"), /noMatch/);
  await storage.batch([
    {
      key: "shop",
      value: {
        ...state.shop,
        permissions: { ...state.shop!.permissions, sell: false },
      },
    },
  ]);
  await assert.rejects(
    () => repo.scanProduct("POSNIC-DEMO-11"),
    /permissionDenied/,
  );
  assert.deepEqual((await repo.load()).cart, state.cart);
});

test("catalogue freshness is durable and failed refresh cannot advance it", async () => {
  const { storage, repo } = setup();
  const shop = {
    ...trainingShop,
    mode: "live" as const,
    baseUrl: "http://localhost:5555",
  };
  await repo.pair(shop, trainingItems);
  assert.equal(
    (await repo.load()).catalogueUpdatedAt,
    new Date(1000).toISOString(),
  );
  const newer = new Repository(
    storage,
    () => "new-id",
    () => 2000,
  );
  storage.fail = true;
  await assert.rejects(
    newer.refreshCatalogue(shop, trainingItems),
    /disk full/,
  );
  assert.equal(
    (await newer.load()).catalogueUpdatedAt,
    new Date(1000).toISOString(),
  );
  storage.fail = false;
  await newer.refreshCatalogue(shop, trainingItems);
  assert.equal(
    (await newer.load()).catalogueUpdatedAt,
    new Date(2000).toISOString(),
  );
  await newer.signOut();
  assert.equal((await newer.load()).catalogueUpdatedAt, undefined);
});

test("weighed item requires an explicit quantity and reductions keep the void ACL", async () => {
  const { repo } = setup();
  const weighted = {
    ...trainingItems[0]!,
    quantityScale: 1000 as const,
    unit: "kg",
    price: 3500,
    taxBps: 0,
  };
  await repo.pair(
    {
      ...trainingShop,
      permissions: { ...trainingShop.permissions, voidLine: false },
    },
    [weighted],
  );
  await assert.rejects(repo.addItem(weighted), /invalidQuantity/);
  await assert.rejects(repo.addItem(weighted, -1), /invalidAmount/);
  await repo.addItem(weighted, 0.125);
  let state = await repo.load();
  assert.equal(state.cart.lines[0]?.quantity, 0.125);
  assert.equal(state.cart.lines[0]?.unit, "kg");
  await assert.rejects(
    repo.setQuantity(state.cart.lines[0]!.id, 0.1),
    /permissionDenied/,
  );
  await repo.addItem(weighted, 0.125);
  state = await repo.load();
  assert.equal(state.cart.lines[0]?.quantity, 0.25);
  const sale = await repo.checkout(state.cart.id, {
    method: "cash",
    received: 875,
    change: 0,
  });
  assert.equal(sale.total, 875);
  assert.match(
    receiptHtml(sale, "Shop", (s) => s),
    /0.25 kg/,
  );
});

test("favourites persist independently of the cart and stay scoped to cashier and branch", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  await repo.toggleFavourite(trainingItems[0]!.id);
  const restarted = new Repository(
    storage,
    () => "restarted",
    () => 1000,
  );
  const saved = await restarted.load();
  assert.deepEqual(saved.favourites, [trainingItems[0]!.id]);
  assert.equal(saved.cart.lines.length, 0);
  assert.equal((await restarted.catalogue({ ids: saved.favourites })).total, 1);
  assert.equal((await restarted.catalogue({ ids: [] })).total, 0);
  await storage.batch([
    { key: "shop", value: { ...trainingShop, staffId: "other" } },
  ]);
  assert.deepEqual((await restarted.load()).favourites, []);
  await storage.batch([
    { key: "shop", value: { ...trainingShop, branchId: "other" } },
  ]);
  assert.deepEqual((await restarted.load()).favourites, []);
  await storage.batch([{ key: "shop", value: trainingShop }]);
  await restarted.toggleFavourite(trainingItems[0]!.id);
  assert.deepEqual((await restarted.load()).favourites, []);
  await assert.rejects(restarted.toggleFavourite("missing"), /notFound/);
});

test("synced disabled methods cannot check out, and confirmed card retains its tender", async () => {
  const { repo, storage } = setup();
  await repo.startTraining();
  const state = await repo.load();
  await storage.batch([
    { key: "shop", value: { ...state.shop, paymentMethods: ["card"] } },
  ]);
  await repo.addItem(trainingItems[0]!);
  const cart = (await repo.load()).cart;
  await assert.rejects(
    () => repo.checkout(cart.id, { method: "cash", received: 5000, change: 0 }),
    /unavailable/,
  );
  const sale = await repo.checkout(cart.id, {
    method: "card",
    status: "staff-confirmed",
    reference: "terminal-42",
  });
  assert.equal(sale.payment.method, "card");
  assert.equal((await repo.load()).cart.lines.length, 0);
});

const localConnection = {
  ...trainingShop,
  mode: "live" as const,
  baseUrl: "http://192.168.1.200:5555/api",
  capabilities: { ...trainingShop.capabilities, saleSync: true },
};
const internetConnection = {
  ...localConnection,
  baseUrl: "https://same-shop.posnic.io/api",
};
test("connection switching isolates receipt history and restores it when returning", async () => {
  const { repo } = setup();
  await repo.pair(localConnection, trainingItems);
  await repo.addItem(trainingItems[0]!);
  const sale = await repo.checkout((await repo.load()).cart.id, {
    method: "cash",
    received: 5000,
    change: 0,
  });
  await assert.rejects(
    repo.switchConnection(internetConnection, trainingItems),
    /connectionPending/,
  );
  assert.equal((await repo.load()).outbox.length, 1);
  await repo.acknowledge(sale.id, "local-sale");
  await repo.switchConnection(internetConnection, trainingItems);
  assert.equal((await repo.load()).sales.length, 0);
  assert.deepEqual(await repo.connections(internetConnection), [
    internetConnection.baseUrl,
    localConnection.baseUrl,
  ]);
  await repo.switchConnection(localConnection, trainingItems);
  assert.equal((await repo.load()).sales[0]!.serverId, "local-sale");
  assert.equal((await repo.load()).outbox.length, 0);
});
test("switching rejects another identity or an unfinished basket without changing the active shop", async () => {
  const { repo } = setup();
  await repo.pair(localConnection, trainingItems);
  for (const field of ["id", "branchId", "staffId"] as const)
    await assert.rejects(
      repo.switchConnection(
        { ...internetConnection, [field]: "other" },
        trainingItems,
      ),
      /connectionWrongShop/,
    );
  await repo.addItem(trainingItems[0]!);
  await assert.rejects(
    repo.switchConnection(internetConnection, trainingItems),
    /connectionCart/,
  );
  assert.equal((await repo.load()).shop!.baseUrl, localConnection.baseUrl);
  assert.equal((await repo.load()).cart.lines.length, 1);
  // Expired-login recovery to the original authority is always allowed.
  await repo.switchConnection(localConnection, trainingItems);
  assert.equal((await repo.load()).cart.lines.length, 1);
});
test("a failed connection transaction leaves the original catalogue and history active", async () => {
  const { repo, storage } = setup();
  await repo.pair(localConnection, trainingItems);
  storage.fail = true;
  await assert.rejects(
    repo.switchConnection(internetConnection, []),
    /disk full/,
  );
  storage.fail = false;
  assert.equal((await repo.load()).shop!.baseUrl, localConnection.baseUrl);
  assert.ok((await repo.load()).items.length);
});
