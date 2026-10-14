import type { Sale } from "../domain/types";
export function receiptText(
  sale: Sale,
  shop: string,
  locale: string,
  t: (key: string) => string,
) {
  const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ");
  const money = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: sale.currency,
    }).format(n / 100);
  return [
    clean(shop),
    t(
      sale.training
        ? "trainingReceipt"
        : sale.sync === "synced"
          ? "receipt"
          : "offlineReceipt",
    ),
    clean(sale.receipt),
    new Date(sale.createdAt).toLocaleString(locale),
    "────────────────────",
    ...sale.cart.lines.map(
      (l) => `${clean(l.name)} × ${l.quantity}\n${money(l.price * l.quantity)}`,
    ),
    "────────────────────",
    `${t("total")}: ${money(sale.total)}`,
    `${t("tax")}: ${money(sale.tax)}`,
    t(sale.payment.method),
    ...(sale.payment.method === "upi" ? [t("unverified")] : []),
    "",
  ].join("\n");
}
