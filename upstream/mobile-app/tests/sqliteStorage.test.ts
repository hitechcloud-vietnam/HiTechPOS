import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteStorage } from "../src/data/sqliteStorage";

function connect(file: string) {
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)))",
  );
  // The adapter is intentionally passed a single connection with no API for
  // opening an extra, unkeyed transaction connection.
  const storage = sqliteStorage({
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...params: SQLInputValue[]) =>
      db.prepare(sql).run(...params),
    getFirstAsync: async (sql: string, ...params: SQLInputValue[]) =>
      db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql: string, ...params: SQLInputValue[]) =>
      db.prepare(sql).all(...params),
  } as unknown as Parameters<typeof sqliteStorage>[0]);
  return { db, storage };
}
test("first settings write and sale batch use one connection and survive reopening", async () => {
  const dir = mkdtempSync(join(tmpdir(), "posnic-storage-"));
  const file = join(dir, "test.db");
  let db: DatabaseSync | undefined;
  try {
    const first = connect(file);
    db = first.db;
    assert.equal(await first.storage.get("settings"), null);
    await first.storage.batch([
      { key: "settings", value: { locale: "ta" } },
      { key: "sale:1", value: { id: "1" } },
      { key: "outbox:1", value: { saleId: "1" } },
    ]);
    db.close();
    db = undefined;
    const second = connect(file);
    db = second.db;
    assert.deepEqual(await second.storage.get("settings"), { locale: "ta" });
    assert.deepEqual(await second.storage.list("sale:"), [{ id: "1" }]);
    assert.deepEqual(await second.storage.list("outbox:"), [{ saleId: "1" }]);
    assert.deepEqual(await second.storage.keys!("sale:"), ["sale:1"]);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true });
  }
});
test("a failed SQL batch rolls back before queued reads and subsequent writes", async () => {
  const { db, storage } = connect(":memory:");
  try {
    await storage.batch([{ key: "cart", value: { id: "original" } }]);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const failed = storage.batch([
      { key: "cart", value: null },
      { key: "sale:1", value: { id: "1" } },
      { key: "outbox:1", value: cycle },
    ]);
    const queuedRead = storage.get("cart");
    await assert.rejects(failed, /circular/i);
    assert.deepEqual(await queuedRead, { id: "original" });
    assert.deepEqual(await storage.list("sale:"), []);
    await storage.batch([{ key: "settings", value: { locale: "en" } }]);
    assert.deepEqual(await storage.get("settings"), { locale: "en" });
  } finally {
    db.close();
  }
});

test("catalogue migration, indexed barcode lookup and visible pages stay bounded beyond 10k items", async () => {
  const { db, storage } = connect(":memory:");
  try {
    const { trainingItems, trainingShop } =
      await import("../src/data/training");
    const { Repository } = await import("../src/data/repository");
    // Simulate the previous release: only records exist, no search index yet.
    const insert = db.prepare("INSERT INTO records VALUES(?,?)");
    db.exec("BEGIN");
    for (let n = 0; n < 10017; n++) {
      const id = String(n).padStart(5, "0");
      insert.run(
        "item:" + id,
        JSON.stringify({
          ...trainingItems[0],
          id,
          code: id,
          barcode: "000" + id,
          name: n === 10016 ? "CAFÉ தமிழ்" : "Product " + id,
          category: n % 2 ? "Food" : "Drink",
        }),
      );
    }
    insert.run("shop", JSON.stringify(trainingShop));
    db.exec("COMMIT");
    // A full item-list read is prohibited in this test after migration.
    const list = storage.list;
    storage.list = async (prefix) => {
      assert.notEqual(prefix, "item:");
      return list(prefix);
    };
    const repo = new Repository(
      storage,
      () => "cart",
      () => Date.parse(trainingShop.offlineUntil) - 1000,
    );
    const state = await repo.load();
    assert.equal(state.items.length, 48);
    assert.equal(state.catalogue.count, 10017);
    const last = await repo.catalogue({ barcode: "00010016" });
    assert.equal(last.total, 1);
    assert.equal(last.items[0]?.name, "CAFÉ தமிழ்");
    assert.equal((await repo.catalogue({ search: "café" })).total, 1);
    assert.equal((await repo.catalogue({ search: "தமிழ்" })).total, 1);
    assert.equal(
      (await repo.catalogue({ code: "10016" })).items[0]?.id,
      "10016",
    );
    assert.equal((await repo.catalogue({ ids: [] })).total, 0);
    assert.equal((await repo.catalogue({ ids: [last.items[0]!.id] })).total, 1);
    assert.equal(
      (await repo.catalogue({ ids: [last.items[0]!.id], search: "absent" }))
        .total,
      0,
    );
    const second = await repo.catalogue({ offset: 48 });
    assert.equal(second.items.length, 48);
    assert.equal(second.items[0]?.id, "00048");
    await repo.scanProduct("00010016");
    assert.equal((await repo.load()).cart.lines[0]?.itemId, "10016");
    const plans = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT key FROM catalogue_index WHERE barcode=? AND active=1",
      )
      .all("00010016");
    assert.match(JSON.stringify(plans), /catalogue_barcode/);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    await assert.rejects(
      storage.batch([
        { key: "item:10016", value: null },
        { key: "fail", value: cycle },
      ]),
    );
    assert.equal((await repo.catalogue({ barcode: "00010016" })).total, 1);
    await storage.batch([{ key: "item:10016", value: null }]);
    assert.equal((await repo.catalogue({ barcode: "00010016" })).total, 0);
    assert.equal((await repo.catalogue()).summary.count, 10016);
  } finally {
    db.close();
  }
});

test("streamed catalogue activation is atomic across pages, grant, index and restart", async () => {
  const { db, storage } = connect(":memory:");
  try {
    const { trainingItems, trainingShop } =
      await import("../src/data/training");
    const { Repository } = await import("../src/data/repository");
    const { downloadCatalogue } =
      await import("../src/services/catalogueDownload");
    const repo = new Repository(storage, () => "cart");
    const shop = {
      ...trainingShop,
      mode: "live" as const,
      baseUrl: "http://test",
    };
    await repo.pair(shop, trainingItems);
    const original = await repo.load();
    const count = 10017,
      pages = Array.from({ length: Math.ceil(count / 256) }, (_, n) => ({
        id: "p" + n,
        count: Math.min(256, count - n * 256),
      }));
    const snapshot = await downloadCatalogue(
      { version: "next", count, pages },
      "scope",
      storage,
      async (n) =>
        Array.from({ length: pages[n]!.count }, (_, i) => ({
          ...trainingItems[0]!,
          id: String(n * 256 + i),
        })),
      true,
    );
    assert.equal(Array.isArray(snapshot), false);
    assert.equal(snapshot.pages.length, 40);
    // Missing second page must roll back the first page and preserve the old grant.
    await assert.rejects(
      repo.refreshCatalogue(
        { ...shop, snapshotVersion: "next" },
        { ...snapshot, pages: [snapshot.pages[0]!, "catalogue-page:missing"] },
      ),
      /invalidServer/,
    );
    assert.deepEqual((await repo.load()).items, original.items);
    assert.equal(
      (await repo.load()).shop?.snapshotVersion,
      shop.snapshotVersion,
    );
    await repo.refreshCatalogue({ ...shop, snapshotVersion: "next" }, snapshot);
    const restarted = new Repository(storage, () => "next-cart");
    const active = await restarted.load();
    assert.equal(active.catalogue.count, count);
    assert.equal(active.items.length, 48);
    assert.equal(active.shop?.snapshotVersion, "next");
    assert.equal(
      (await restarted.catalogue({ search: trainingItems[0]!.name })).total,
      count,
    );
    assert.equal(await storage.get("item:" + trainingItems[0]!.id), null);
    await assert.rejects(
      repo.refreshCatalogue(
        { ...shop, snapshotVersion: "bad" },
        { pages: [snapshot.pages[0]!, snapshot.pages[0]!], count: 512 },
      ),
      /UNIQUE/,
    );
    assert.equal((await restarted.catalogue()).summary.count, count);
    assert.equal((await restarted.load()).shop?.snapshotVersion, "next");
  } finally {
    db.close();
  }
});
