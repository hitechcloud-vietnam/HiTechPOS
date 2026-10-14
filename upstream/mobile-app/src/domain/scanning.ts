import type { Item } from "./types";

/** Product data stays opaque: preserve leading zeroes; never navigate scanned URLs. */
export function resolveProductScan(items: Item[], input: string): Item {
  const code = input.replace(/[\r\n]+$/, "");
  if (
    !code ||
    code.length > 512 ||
    /[\x00-\x1f\x7f]/.test(code) ||
    /^(?:upi:|https?:|posnic:|%B|;\d{12,19}=)/i.test(code)
  )
    throw new Error("invalidScan");
  const matches = items.filter((item) => item.active && item.barcode === code);
  if (matches.length !== 1)
    throw new Error(matches.length ? "multipleMatches" : "noMatch");
  return matches[0]!;
}
