import type { Sale } from "../domain/types";
import { formatMoney } from "../domain/money";
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function receiptHtml(
  sale: Sale,
  shopName: string,
  t: (key: string) => string,
  locale = "en",
): string {
  const esc = escapeHtml,
    money = (n: number) => esc(formatMoney(n, sale.currency, locale));
  return `<!doctype html><html lang="${esc(locale)}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>@page{margin:4mm}body{font:14px sans-serif;max-width:72mm;margin:auto;color:#111}h1{font-size:20px}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #ddd}td:last-child{text-align:end}small{display:block;margin:10px 0}.total{font-size:20px}</style></head><body><h1>${esc(shopName)}</h1><small>${esc(sale.training ? t("trainingReceipt") : sale.sync === "synced" ? t("receipt") : t("offlineReceipt"))}</small><p>${esc(sale.receipt)}<br>${esc(new Date(sale.createdAt).toLocaleString(locale))}</p><table>${sale.cart.lines.map((l) => `<tr><td>${esc(l.name)} × ${l.quantity}${l.unit ? " " + esc(l.unit) : ""}</td><td>${money(l.price * l.quantity)}</td></tr>`).join("")}</table><p class="total">${esc(t("total"))}: ${money(sale.total)}</p><p>${esc(t("tax"))}: ${money(sale.tax)}</p><p>${esc(t(sale.payment.method))}</p>${sale.payment.method === "upi" ? `<small>${esc(t("unverified"))}</small>` : ""}</body></html>`;
}
