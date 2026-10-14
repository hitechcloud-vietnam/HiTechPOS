import type { Item } from "../domain/types";
import { normalizeDigits } from "../domain/money";

export interface CatalogueQuery {
  ids?: string[];
  search?: string;
  category?: string;
  code?: string;
  barcode?: string;
  imagesOnly?: boolean;
  offset?: number;
  limit?: number;
}
export interface CatalogueSummary {
  count: number;
  imageCount: number;
  categories: string[];
}
export interface CatalogueResult {
  items: Item[];
  total: number;
  summary: CatalogueSummary;
}
export function bounds(query: CatalogueQuery) {
  return {
    offset: Math.max(0, Math.floor(query.offset || 0)),
    limit: Math.max(1, Math.min(256, Math.floor(query.limit || 48))),
  };
}
export function matchesItem(item: Item, query: CatalogueQuery) {
  if (!item.active) return false;
  if (query.ids && !query.ids.includes(item.id)) return false;
  if (query.category && item.category !== query.category) return false;
  if (query.code !== undefined && item.code !== query.code) return false;
  if (query.barcode !== undefined && item.barcode !== query.barcode)
    return false;
  if (query.imagesOnly && !item.image) return false;
  const search = query.search || "";
  return (
    !search ||
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.code === normalizeDigits(search) ||
    item.barcode === search
  );
}
/** Cursor accumulator keeps only the visible page, never the full catalogue. */
export function catalogueCollector(query: CatalogueQuery) {
  const { offset, limit } = bounds(query);
  const result: CatalogueResult = {
    items: [],
    total: 0,
    summary: { count: 0, imageCount: 0, categories: [] },
  };
  const categories = new Set<string>();
  return {
    add(item: Item) {
      result.summary.count++;
      if (item.image) result.summary.imageCount++;
      if (item.active && item.category) categories.add(item.category);
      if (matchesItem(item, query)) {
        if (result.total >= offset && result.items.length < limit)
          result.items.push(item);
        result.total++;
      }
    },
    finish() {
      result.summary.categories = [...categories].sort();
      return result;
    },
  };
}
