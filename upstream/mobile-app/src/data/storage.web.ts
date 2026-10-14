import { catalogueCollector } from "./catalogueQuery";
import type { Storage, Change } from "./storage";
/** Browser preview uses IndexedDB transactions. Native tills use encrypted SQLite. */
let opening: Promise<Storage> | null = null;
export function openStorage(): Promise<Storage> {
  if (!opening)
    opening = initialize().catch((error) => {
      opening = null;
      throw error;
    });
  return opening;
}
async function initialize(): Promise<Storage> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("posnic-preview", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    replaceCatalogue(snapshot, changes) {
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite"),
          store = tx.objectStore("records");
        let count = 0,
          remaining = snapshot.pages.length,
          failure: Error | null = null;
        const fail = () => {
          failure = new Error("invalidServer");
          tx.abort();
        };
        store.delete(IDBKeyRange.bound("item:", "item:\uffff"));
        for (const key of snapshot.pages) {
          if (!key.startsWith("catalogue-page:")) {
            fail();
            break;
          }
          const request = store.get(key);
          request.onsuccess = () => {
            const page = request.result;
            if (!Array.isArray(page?.items) || page.items.length > 256) {
              fail();
              return;
            }
            for (const item of page.items) {
              store.add(item, "item:" + item.id);
              count++;
            }
            if (--remaining === 0 && count !== snapshot.count) fail();
          };
        }
        if (!snapshot.pages.length && snapshot.count !== 0) fail();
        if (!failure)
          for (const c of changes) {
            if (c.value === null) store.delete(c.key);
            else store.put(c.value, c.key);
          }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(failure ?? tx.error);
        tx.onabort = () =>
          reject(failure ?? tx.error ?? new Error("storageUnavailable"));
      });
    },
    catalogue(query) {
      return new Promise((resolve, reject) => {
        const result = catalogueCollector(query);
        const tx = db.transaction("records");
        const request = tx
          .objectStore("records")
          .openCursor(IDBKeyRange.bound("item:", "item:\uffff"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            result.add(cursor.value);
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(result.finish());
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("storageUnavailable"));
      });
    },
    keys(prefix: string) {
      return new Promise<string[]>((resolve, reject) => {
        const q = db
          .transaction("records")
          .objectStore("records")
          .getAllKeys(IDBKeyRange.bound(prefix, prefix + "\uffff"));
        q.onsuccess = () => resolve(q.result.map(String));
        q.onerror = () => reject(q.error);
      });
    },
    get<T>(key: string) {
      return new Promise<T | null>((resolve, reject) => {
        const q = db.transaction("records").objectStore("records").get(key);
        q.onsuccess = () => resolve(q.result ?? null);
        q.onerror = () => reject(q.error);
      });
    },
    list<T>(prefix: string) {
      return new Promise<T[]>((resolve, reject) => {
        const q = db
          .transaction("records")
          .objectStore("records")
          .getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    },
    batch(changes: Change[]) {
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        const store = tx.objectStore("records");
        for (const c of changes) {
          if (c.value === null) store.delete(c.key);
          else store.put(c.value, c.key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("storageUnavailable"));
      });
    },
  };
}
