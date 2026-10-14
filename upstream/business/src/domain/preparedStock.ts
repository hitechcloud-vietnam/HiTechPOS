import { z } from "zod";
import { type BusinessContext } from "./contracts";
const id = z.string().regex(/^[a-f\d]{24}$/);
const instant = z
  .string()
  .datetime()
  .refine((value) => new Date(value).toISOString() === value);
const count = z.number().int().min(0).max(10000);
export const stockReasons = [
  "invalid_stock_scope",
  "stock_tracking_unknown",
  "stock_status_unknown",
  "ambiguous_branch_stock",
  "invalid_stock_item",
  "stock_threshold_unconfigured",
  "invalid_stock_quantity",
  "invalid_stock_threshold",
] as const;
const label = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim() === value);
export const stockItemSchema = z
  .object({
    itemId: id,
    name: label(200),
    unit: label(40),
    availableMilli: z.number().int().safe(),
    thresholdMilli: z.number().int().nonnegative().safe(),
    thresholdSource: z.enum(["item", "branch"]),
    low: z.literal(true),
  })
  .strict();
export const stockCoverageSchema = z
  .object({
    scannedItems: count,
    excludedItems: count,
    verifiedItems: count,
    unavailableItems: count,
    reasons: z.partialRecord(z.enum(stockReasons), count.min(1)),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    metricDefinitionVersion: z.literal("stored-stock-v1"),
    businessId: id,
    branchId: id,
    observedFrom: instant,
    preparedAt: instant,
    coverage: stockCoverageSchema,
    lowItemCount: count,
    lowItems: z.array(stockItemSchema).max(100),
    listTruncated: z.boolean(),
    freshness: z
      .object({
        state: z.enum(["partial", "delayed"]),
        sourceUpdatedAt: z.null(),
        checkedAt: instant,
        complete: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type PreparedStock = z.infer<typeof schema>;
export function validatePreparedStock(
  input: unknown,
  context: BusinessContext,
  branchId: string,
  now = Date.now(),
): PreparedStock {
  const value = schema.parse(input);
  if (
    !context.capabilities.includes("stock.read") ||
    !context.branches.some((branch) => branch.id === branchId) ||
    value.branchId !== branchId ||
    value.businessId !== context.businessId
  )
    throw new Error("Stock scope mismatch");
  const start = Date.parse(value.observedFrom),
    end = Date.parse(value.preparedAt),
    checked = Date.parse(value.freshness.checkedAt);
  if (
    start > end ||
    end - start > 15000 ||
    end > checked ||
    checked > now + 300000 ||
    now - checked > 300000 ||
    checked - end > 86400000 ||
    value.freshness.state !== (checked - end > 900000 ? "delayed" : "partial")
  )
    throw new Error("Invalid stock observation times");
  const c = value.coverage;
  if (
    c.scannedItems !== c.excludedItems + c.verifiedItems + c.unavailableItems ||
    Object.values(c.reasons).reduce((a, b) => a + b, 0) !==
      c.unavailableItems ||
    value.lowItemCount > c.verifiedItems ||
    value.lowItems.length !== Math.min(value.lowItemCount, 100) ||
    value.listTruncated !== value.lowItemCount > 100
  )
    throw new Error("Invalid stock coverage");
  let previous = "";
  for (const item of value.lowItems) {
    if (item.itemId <= previous || item.availableMilli > item.thresholdMilli)
      throw new Error("Invalid low-stock item");
    previous = item.itemId;
  }
  return value;
}
