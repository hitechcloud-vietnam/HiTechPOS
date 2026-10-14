import * as Print from "expo-print";
import { PosnicApi } from "../services/api";
import { credentials } from "./credentials";
import type { Sale, Shop, Settings } from "../domain/types";
import { receiptHtml, escapeHtml } from "../services/receipt";
import * as Crypto from "expo-crypto";
import { requirePermission } from "../domain/permissions";
export async function printTest(
  shop: Shop,
  settings: Settings,
  t: (key: string) => string,
): Promise<void> {
  requirePermission(shop, "receiptPrint");
  if (settings.printer === "bluetooth") throw new Error("deviceUnavailable");
  if (settings.printer === "system") {
    await Print.printAsync({
      html: `<!doctype html><html lang="${settings.locale}" dir="${settings.locale === "ar" ? "rtl" : "ltr"}"><meta charset="utf-8"><body><h1>${escapeHtml(shop.name)}</h1><h2>${escapeHtml(t("testReceipt"))}</h2><p>0123456789</p><p>✓ • ───────────────</p></body></html>`,
    });
    return;
  }
  if (!shop.baseUrl || !shop.capabilities.tillPrint)
    throw new Error("deviceUnavailable");
  await new PosnicApi(shop.baseUrl).request(
    "/mobile/v1/print-jobs",
    { id: Crypto.randomUUID(), document: "test" },
    await credentials.get(shop.baseUrl),
  );
}
export async function printSale(
  sale: Sale,
  shop: Shop,
  settings: Settings,
  t: (key: string) => string,
): Promise<void> {
  requirePermission(shop, "receiptPrint");
  if (settings.printer === "bluetooth") throw new Error("deviceUnavailable");
  if (
    sale.shopId !== shop.id ||
    sale.branchId !== shop.branchId ||
    sale.staffId !== shop.staffId
  )
    throw new Error("permissionDenied");
  if (settings.printer === "system") {
    await Print.printAsync({
      html: receiptHtml(sale, shop.name, t, settings.locale),
    });
    return;
  }
  if (!shop.baseUrl || !shop.capabilities.tillPrint)
    throw new Error("deviceUnavailable");
  await new PosnicApi(shop.baseUrl).request(
    "/mobile/v1/print-jobs",
    { id: `receipt:${sale.id}`, saleId: sale.id, document: "receipt" },
    await credentials.get(shop.baseUrl),
  );
}
