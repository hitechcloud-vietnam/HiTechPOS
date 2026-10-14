import type { Item } from "../domain/types";
import type { Storage, CatalogueSnapshot } from "../data/storage";

export interface CatalogueManifest {
  version: string;
  count: number;
  pages: { id: string; count: number }[];
}
interface SavedPage {
  id: string;
  items: Item[];
}

/** Pages persist independently; callers activate only the complete, validated result. */
export function downloadCatalogue(
  manifest: CatalogueManifest,
  scope: string,
  store: Storage,
  fetchPage: (index: number, id: string) => Promise<Item[]>,
  streamed: true,
): Promise<CatalogueSnapshot>;
export function downloadCatalogue(
  manifest: CatalogueManifest,
  scope: string,
  store: Storage,
  fetchPage: (index: number, id: string) => Promise<Item[]>,
): Promise<Item[]>;
export async function downloadCatalogue(
  manifest: CatalogueManifest,
  scope: string,
  store: Storage,
  fetchPage: (index: number, id: string) => Promise<Item[]>,
  streamed = false,
): Promise<Item[] | CatalogueSnapshot> {
  if (
    manifest.pages.reduce((sum, page) => sum + page.count, 0) !== manifest.count
  )
    throw new Error("invalidServer");
  const prefix = "catalogue-page:" + scope + ":";
  const items: Item[] = [];
  const ids = new Set<string>();
  for (const [index, page] of manifest.pages.entries()) {
    const key = prefix + page.id;
    let cached = await store.get<SavedPage>(key);
    if (!cached) {
      const downloaded = await fetchPage(index, page.id);
      if (downloaded.length !== page.count) throw new Error("invalidServer");
      cached = { id: page.id, items: downloaded };
      await store.batch([{ key, value: cached }]);
    }
    if (cached.id !== page.id || cached.items.length !== page.count)
      throw new Error("invalidServer");
    for (const item of cached.items) {
      if (ids.has(item.id)) throw new Error("invalidServer");
      ids.add(item.id);
      if (!streamed) items.push(item);
    }
  }
  if (ids.size !== manifest.count) throw new Error("invalidServer");
  // Keep downloaded pages for retries and unchanged-page reuse. Old page cleanup
  // happens only after every replacement page has been validated and persisted.
  const keep = new Set(manifest.pages.map((page) => prefix + page.id));
  const old = store.keys
    ? await store.keys(prefix)
    : (await store.list<SavedPage>(prefix)).map((page) => prefix + page.id);
  await store.batch(
    old.filter((key) => !keep.has(key)).map((key) => ({ key, value: null })),
  );
  return streamed
    ? {
        pages: manifest.pages.map((page) => prefix + page.id),
        count: manifest.count,
      }
    : items;
}
