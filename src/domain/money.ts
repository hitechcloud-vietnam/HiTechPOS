import { getFormatLocale } from "../i18n";

export function formatMoney(
  minor: number,
  currency: string,
  digits: number,
  locale = getFormatLocale(),
) {
  if (!Number.isSafeInteger(minor))
    throw new Error("Money must be safe integer minor units");
  if (!Number.isInteger(digits) || digits < 0 || digits > 3)
    throw new Error("Invalid currency precision");
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Avoid floating-point division losing a minor unit on large valid totals.
  const amount = BigInt(minor),
    scale = 10n ** BigInt(digits);
  const whole = amount / scale;
  const fraction = (amount < 0n ? -amount : amount) % scale;
  const fractionText = digits
    ? new Intl.NumberFormat(locale, {
        useGrouping: false,
        minimumIntegerDigits: digits,
        maximumFractionDigits: 0,
      }).format(fraction)
    : "";
  return formatter
    .formatToParts(minor < 0 && whole === 0n ? -0 : whole)
    .map((part) => (part.type === "fraction" ? fractionText : part.value))
    .join("");
}
export function averageBill(netMinor: number, count: number) {
  if (
    !Number.isSafeInteger(netMinor) ||
    !Number.isSafeInteger(count) ||
    count < 0
  )
    throw new Error("Invalid money or sale count");
  return count === 0 ? null : Math.round(netMinor / count);
}
