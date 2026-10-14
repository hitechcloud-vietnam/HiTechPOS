import type { Item } from "./types";

export type PhotoMode = "product" | "order";
export interface PhotoLine {
  id: string;
  text: string;
  query: string;
  quantity: number | null;
  item?: Item;
  reviewed: boolean;
  excluded: boolean;
}
export interface PhotoDraft {
  id: string;
  scope: string;
  revision: number;
  mode: PhotoMode;
  image: string;
  lines: PhotoLine[];
  createdAt: string;
  imported?: string;
  truncated?: boolean;
}
export const normalizePhotoText = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();

/** Preserve source words: numbers in names/pack sizes aren't trusted quantities. */
export function photoLine(text: string, id: string): PhotoLine {
  const raw = text.trim().slice(0, 300);
  const match =
    /^(\d+(?:[.,]\d+)?)\s*[x×]?\s+(.+)$/.exec(raw) ??
    /^(.+?)\s+[x×]\s*(\d+(?:[.,]\d+)?)$/i
      .exec(raw)
      ?.map((v, i, a) => (i === 1 ? a[2]! : i === 2 ? a[1]! : v));
  return {
    id,
    text: raw,
    query: match?.[2] ?? raw,
    quantity: match ? Number(match[1]!.replace(",", ".")) : null,
    reviewed: false,
    excluded: false,
  };
}

export function photoScore(item: Item, text: string): number {
  if (!item.active || item.requiresConfiguration) return 0;
  const source = normalizePhotoText(text),
    name = normalizePhotoText(item.name);
  if (!source || !name) return 0;
  if (item.barcode && text.split(/\s+/).includes(item.barcode)) return 100;
  if (source === name) return 95;
  const tokens = new Set(source.split(" "));
  const words = name.split(" ");
  const hits = words.filter((w) => tokens.has(w)).length;
  if (!hits) return 0;
  // Conflicting digits (strength, size, edition) must not look like an exact match.
  const numbers: string[] = name.match(/\d+/g) ?? [];
  const sourceNumbers: string[] = source.match(/\d+/g) ?? [];
  const conflict =
    numbers.length &&
    sourceNumbers.length &&
    numbers.some((n) => !sourceNumbers.includes(n));
  return Math.round((80 * hits) / words.length) - (conflict ? 40 : 0);
}
export function photoReady(draft: PhotoDraft): boolean {
  return (
    !draft.imported &&
    draft.lines.some((l) => !l.excluded) &&
    draft.lines.every(
      (l) =>
        l.excluded ||
        (l.reviewed &&
          !!l.item &&
          !l.item.requiresConfiguration &&
          l.quantity !== null &&
          Number.isFinite(l.quantity) &&
          l.quantity > 0 &&
          (l.item.quantityScale === 1000
            ? Number.isInteger(Math.round(l.quantity * 1000000) / 1000)
            : Number.isInteger(l.quantity))),
    )
  );
}
