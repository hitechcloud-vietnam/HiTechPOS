import type { Line } from "./types";

/** Money crosses domain boundaries as safe integer minor units, never floats. */
export function parseMoney(raw: string): number {
  // Decimal keyboards can emit a comma or Arabic decimal mark. Grouped and
  // mixed-separator values still fail the strict minor-unit parser below.
  const text = normalizeDigits(raw.trim()).replace(/[,\u066b]/g, ".");
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(text)) throw new Error("invalidAmount");
  const [whole = "0", decimal = ""] = text.split(".");
  const n = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(n)) throw new Error("invalidAmount");
  return n;
}
export function normalizeDigits(value: string): string {
  const starts = [
    0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66,
    0xe50, 0xed0, 0xff10,
  ];
  return [...value]
    .map((c) => {
      const point = c.codePointAt(0)!;
      const start = starts.find((s) => point >= s && point < s + 10);
      return start === undefined ? c : String(point - start);
    })
    .join("");
}
export function quickCode(raw: string): string {
  const code = normalizeDigits(raw.trim());
  if (code && !/^\d{1,6}$/.test(code)) throw new Error("invalidCode");
  return code;
}
export function parseQuantity(raw: string, scale = 1): number {
  const text = normalizeDigits(raw.trim()).replace(/[,\u066b]/g, ".");
  if (!(scale === 1000 ? /^\d{1,3}(\.\d{0,3})?$/ : /^\d{1,3}$/).test(text))
    throw Error("invalidQuantity");
  const quantity = Number(text);
  if (quantity <= 0 || quantity > 999) throw Error("invalidQuantity");
  return quantity;
}
export function lineAmounts(line: Line): { total: number; tax: number } {
  const scale = line.quantityScale === 1000 ? 1000 : 1;
  const units = Math.round(line.quantity * scale);
  if (
    !Number.isSafeInteger(line.price) ||
    line.price < 0 ||
    !Number.isSafeInteger(units) ||
    units <= 0 ||
    units / scale !== line.quantity ||
    line.quantity > 999 ||
    !Number.isInteger(line.taxBps) ||
    line.taxBps < 0 ||
    line.taxBps > 10000
  )
    throw Error("invalidAmount");
  const raw = BigInt(line.price) * BigInt(units);
  const round = (n: bigint, d: bigint) => Number((n * 2n + d) / (d * 2n));
  const base = round(raw, BigInt(scale));
  const tax = round(
    raw * BigInt(line.taxBps),
    BigInt(scale) * BigInt(line.taxInclusive ? 10000 + line.taxBps : 10000),
  );
  const total = base + (line.taxInclusive ? 0 : tax);
  if (!Number.isSafeInteger(total)) throw Error("invalidAmount");
  return { total, tax };
}
export function totals(lines: Line[]): { total: number; tax: number } {
  let total = 0,
    tax = 0;
  for (const line of lines) {
    const amount = lineAmounts(line);
    total += amount.total;
    tax += amount.tax;
  }
  if (!Number.isSafeInteger(total)) throw new Error("invalidAmount");
  return { total, tax };
}
export function formatMoney(
  minor: number,
  currency = "INR",
  locale = "en",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: minor % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}
