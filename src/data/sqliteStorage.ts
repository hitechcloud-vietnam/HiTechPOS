import { bounds } from "./catalogueQuery";
import type { Item } from "../domain/types";
import { normalizeDigits } from "../domain/money";
import type { SQLiteDatabase } from "expo-sqlite";
import type { Storage, Change } from "./storage";

type Connection = Pick<
  SQLiteDatabase,
  "execAsync" | "runAsync" | "getFirstAsync" | "getAllAsync"
>;

/** Owns one already-unlocked connection. Every operation uses the same queue. */
export function sqliteStorage(db: Connection): Storage {
  let tail: Promise<unknown> = Promise.resolve();
  let unusable = false;
  let indexed = false;
  async function indexItem(key: string, item: Item) {
    await db.runAsync(
      "INSERT OR REPLACE INTO catalogue_index(key,name,code,barcode,category,active,image) VALUES(?,?,?,?,?,?,?)",
      key,
      item.name.toLowerCase(),
      item.code,
      item.barcode || "",
      item.category,
      item.active ? 1 : 0,
      item.image ? 1 : 0,
    );
  }
  async function indexItems(items: { key: string; item: Item }[]) {
    // Stay under SQLite's conservative 999-parameter limit while avoiding one
    // native bridge round trip per product during migration/activation.
    for (let offset = 0; offset < items.length; offset += 128) {
      const page = items.slice(offset, offset + 128);
      if (!page.length) continue;
      await db.runAsync(
        "INSERT OR REPLACE INTO catalogue_index(key,name,code,barcode,category,active,image) VALUES " +
          page.map(() => "(?,?,?,?,?,?,?)").join(","),
        ...page.flatMap(({ key, item }) => [
          key,
          item.name.toLowerCase(),
          item.code,
          item.barcode || "",
          item.category,
          item.active ? 1 : 0,
          item.image ? 1 : 0,
        ]),
      );
    }
  }
  async function ensureIndex() {
    if (indexed) return;
    await db.execAsync("BEGIN IMMEDIATE");
    try {
      const existing = await db.getFirstAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='catalogue_index'",
      );
      if (!existing) {
        await db.execAsync(
          "CREATE TABLE catalogue_index(key TEXT PRIMARY KEY,name TEXT NOT NULL,code TEXT NOT NULL,barcode TEXT NOT NULL,category TEXT NOT NULL,active INTEGER NOT NULL,image INTEGER NOT NULL); CREATE INDEX catalogue_code ON catalogue_index(code,active,key); CREATE INDEX catalogue_barcode ON catalogue_index(barcode,active,key); CREATE INDEX catalogue_category ON catalogue_index(category,active,key); CREATE INDEX catalogue_active ON catalogue_index(active,key);",
        );
        let after = "item:";
        for (;;) {
          const rows = await db.getAllAsync<{ key: string; value: string }>(
            "SELECT key,value FROM records WHERE key>? AND key<? ORDER BY key LIMIT 256",
            after,
            "item:\uffff",
          );
          await indexItems(
            rows.map((row) => ({ key: row.key, item: JSON.parse(row.value) })),
          );
          if (rows.length < 256) break;
          after = rows[rows.length - 1]!.key;
        }
      }
      await db.execAsync("COMMIT");
      indexed = true;
    } catch (error) {
      try {
        await db.execAsync("ROLLBACK");
      } catch {
        unusable = true;
      }
      throw error;
    }
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => {
      if (unusable) throw new Error("storageUnavailable");
      return operation();
    });
    tail = result.catch(() => {});
    return result;
  }
  async function writeChange(change: Change) {
    if (change.key.startsWith("item:")) {
      if (change.value === null)
        await db.runAsync(
          "DELETE FROM catalogue_index WHERE key=?",
          change.key,
        );
      else await indexItem(change.key, change.value as Item);
    }
    if (change.value === null)
      await db.runAsync("DELETE FROM records WHERE key=?", change.key);
    else
      await db.runAsync(
        "INSERT INTO records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        change.key,
        JSON.stringify(change.value),
      );
  }
  return {
    replaceCatalogue(snapshot, changes) {
      return serial(async () => {
        await ensureIndex();
        await db.execAsync("BEGIN IMMEDIATE");
        try {
          await db.runAsync(
            "DELETE FROM records WHERE key>=? AND key<?",
            "item:",
            "item:\uffff",
          );
          await db.execAsync("DELETE FROM catalogue_index");
          let count = 0;
          for (const key of snapshot.pages) {
            const row = await db.getFirstAsync<{ value: string }>(
              "SELECT value FROM records WHERE key=?",
              key,
            );
            if (!row || !key.startsWith("catalogue-page:"))
              throw Error("invalidServer");
            const page = JSON.parse(row.value) as { items: Item[] };
            if (!Array.isArray(page.items) || page.items.length > 256)
              throw Error("invalidServer");
            // A single SQL statement copies one page; duplicate IDs abort the transaction.
            await db.runAsync(
              "INSERT INTO records(key,value) SELECT 'item:' || json_extract(value,'$.id'), value FROM json_each(?)",
              JSON.stringify(page.items),
            );
            await indexItems(
              page.items.map((item) => ({ key: "item:" + item.id, item })),
            );
            count += page.items.length;
          }
          if (count !== snapshot.count) throw Error("invalidServer");
          for (const change of changes) await writeChange(change);
          await db.execAsync("COMMIT");
        } catch (error) {
          try {
            await db.execAsync("ROLLBACK");
          } catch {
            unusable = true;
          }
          throw error;
        }
      });
    },
    catalogue(query) {
      return serial(async () => {
        await ensureIndex();
        const where = ["i.active=1"],
          params: (string | number)[] = [];
        for (const column of ["code", "barcode", "category"] as const) {
          if (
            query[column] !== undefined &&
            (column !== "category" || query.category)
          ) {
            where.push(`i.${column}=?`);
            params.push(query[column]!);
          }
        }
        if (query.ids) {
          where.push("i.key IN (SELECT 'item:' || value FROM json_each(?))");
          params.push(JSON.stringify(query.ids));
        }
        if (query.imagesOnly) where.push("i.image=1");
        if (query.search) {
          where.push("(instr(i.name,?)>0 OR i.code=? OR i.barcode=?)");
          params.push(
            query.search.toLowerCase(),
            normalizeDigits(query.search),
            query.search,
          );
        }
        const clause = where.join(" AND "),
          { offset, limit } = bounds(query);
        const total = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) count FROM catalogue_index i WHERE " + clause,
          ...params,
        );
        const rows = await db.getAllAsync<{ value: string }>(
          "SELECT r.value FROM catalogue_index i JOIN records r ON r.key=i.key WHERE " +
            clause +
            " ORDER BY i.key LIMIT ? OFFSET ?",
          ...params,
          limit,
          offset,
        );
        const summary = await db.getFirstAsync<{
          count: number;
          imageCount: number;
        }>(
          "SELECT COUNT(*) count,COALESCE(SUM(image),0) imageCount FROM catalogue_index",
        );
        const categories = await db.getAllAsync<{ category: string }>(
          "SELECT DISTINCT category FROM catalogue_index WHERE active=1 AND category<>'' ORDER BY category",
        );
        return {
          items: rows.map((row) => JSON.parse(row.value) as Item),
          total: total!.count,
          summary: {
            ...summary!,
            categories: categories.map((row) => row.category),
          },
        };
      });
    },
    keys(prefix: string) {
      return serial(async () => {
        const rows = await db.getAllAsync<{ key: string }>(
          "SELECT key FROM records WHERE key>=? AND key<? ORDER BY key",
          prefix,
          prefix + "\uffff",
        );
        return rows.map((row) => row.key);
      });
    },
    get<T>(key: string) {
      return serial(async () => {
        const row = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM records WHERE key=?",
          key,
        );
        return row ? (JSON.parse(row.value) as T) : null;
      });
    },
    list<T>(prefix: string) {
      return serial(async () => {
        const rows = await db.getAllAsync<{ value: string }>(
          "SELECT value FROM records WHERE key>=? AND key<? ORDER BY key",
          prefix,
          prefix + "\uffff",
        );
        return rows.map((row) => JSON.parse(row.value) as T);
      });
    },
    batch(changes: Change[]) {
      return serial(async () => {
        // Expo's exclusive transaction helper opens another, unkeyed SQLCipher
        // connection. Use this connection and serialize reads as well as writes
        // so no unrelated operation can join this transaction.
        await ensureIndex();
        await db.execAsync("BEGIN IMMEDIATE");
        try {
          for (const change of changes) await writeChange(change);
          await db.execAsync("COMMIT");
        } catch (error) {
          try {
            await db.execAsync("ROLLBACK");
          } catch {
            unusable = true;
          }
          throw error;
        }
      });
    },
  };
}
