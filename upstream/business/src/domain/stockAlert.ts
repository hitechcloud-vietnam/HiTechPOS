import { z } from "zod";
import { stockCoverageSchema, stockItemSchema } from "./preparedStock";

const instant = z
  .string()
  .datetime()
  .refine((value) => new Date(value).toISOString() === value);
export const stockAlertSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: z.string().regex(/^[a-f\d]{64}$/),
    observedFrom: instant,
    preparedAt: instant,
    sourceComplete: z.literal(false),
    coverage: stockCoverageSchema,
    totalLowItemCount: z.number().int().min(1).max(10000),
    newLowItemCount: z.number().int().min(1).max(10000),
    items: z.array(stockItemSchema).min(1).max(20),
    listTruncated: z.boolean(),
  })
  .strict();
export type StockAlert = z.infer<typeof stockAlertSchema>;

/** Historical Inbox observations do not expire with the live stock snapshot. */
export function validateStockAlert(
  input: unknown,
  createdAt: string,
  now = Date.now(),
): StockAlert {
  const stock = stockAlertSchema.parse(input),
    c = stock.coverage;
  const start = Date.parse(stock.observedFrom),
    end = Date.parse(stock.preparedAt),
    created = Date.parse(createdAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(created) ||
    start > end ||
    end - start > 15000 ||
    end > created ||
    created > now + 300000
  )
    throw new Error("Invalid stock alert times");
  if (
    c.scannedItems !== c.excludedItems + c.verifiedItems + c.unavailableItems ||
    Object.values(c.reasons).reduce((a, b) => a + b, 0) !==
      c.unavailableItems ||
    stock.totalLowItemCount > c.verifiedItems ||
    stock.newLowItemCount > stock.totalLowItemCount ||
    stock.items.length !== Math.min(stock.newLowItemCount, 20) ||
    stock.listTruncated !== stock.newLowItemCount > 20
  )
    throw new Error("Invalid stock alert coverage");
  let previous = "";
  for (const item of stock.items) {
    if (item.itemId <= previous || item.availableMilli > item.thresholdMilli)
      throw new Error("Invalid stock alert item");
    previous = item.itemId;
  }
  return stock;
}
