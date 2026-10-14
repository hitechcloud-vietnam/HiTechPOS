import { z } from "zod";
import { type BusinessContext } from "./contracts";
import {
  preparedOverviewSchema,
  validatePreparedOverview,
} from "./preparedOverview";
const count = z.number().int().nonnegative().safe();
const label = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim() === s);
const quantity = z
  .object({ unit: label(32), soldMilli: count, returnedMilli: count })
  .strict();
const item = z
  .object({
    itemId: z.string().regex(/^[a-f\d]{24}$/),
    name: label(300),
    billedSalesMinor: count,
    refundsMinor: count,
    salesAfterReturnsMinor: z.number().int().safe(),
    quantities: z.array(quantity).min(1).max(16),
  })
  .strict();
const insight = z
  .object({
    schemaVersion: z.literal(1),
    state: z.enum(["available", "incomplete"]),
    reason: z
      .enum([
        "original_items_unavailable",
        "item_facts_invalid",
        "item_budget_exceeded",
      ])
      .nullable(),
    sourceSales: count.max(100000),
    unavailableSales: count.max(100000),
    totalItems: count.max(10000).nullable(),
    truncated: z.boolean(),
    items: z.array(item).max(20),
  })
  .strict();
const schema = preparedOverviewSchema.extend({ itemInsights: insight });
export type PreparedItems = z.infer<typeof schema>;
export type RankedItem = PreparedItems["itemInsights"]["items"][number];
export function validatePreparedItems(
  input: unknown,
  context: BusinessContext,
  branchId: string,
  day: string,
): PreparedItems {
  const value = schema.parse(input);
  const { itemInsights: facts, ...overview } = value;
  validatePreparedOverview(overview, context, [branchId], day);
  const invalid = () => {
    throw new Error("Invalid item ranking");
  };
  if (
    !context.capabilities.includes("items.read") ||
    facts.sourceSales < overview.completedSales ||
    facts.unavailableSales > facts.sourceSales
  )
    invalid();
  if (facts.state === "incomplete") {
    if (
      !facts.reason ||
      facts.unavailableSales < 1 ||
      facts.totalItems !== null ||
      facts.truncated ||
      facts.items.length
    )
      invalid();
    return value;
  }
  if (
    facts.reason !== null ||
    facts.unavailableSales !== 0 ||
    facts.totalItems === null ||
    facts.truncated !== facts.totalItems > 20 ||
    facts.items.length !== Math.min(20, facts.totalItems) ||
    (facts.totalItems > 0 && facts.sourceSales === 0)
  )
    invalid();
  let billed = 0n,
    refunds = 0n;
  const seen = new Set<string>();
  let previous: RankedItem | null = null;
  for (const row of facts.items) {
    if (
      seen.has(row.itemId) ||
      row.salesAfterReturnsMinor !== row.billedSalesMinor - row.refundsMinor ||
      (previous &&
        (previous.salesAfterReturnsMinor < row.salesAfterReturnsMinor ||
          (previous.salesAfterReturnsMinor === row.salesAfterReturnsMinor &&
            previous.itemId >= row.itemId)))
    )
      invalid();
    seen.add(row.itemId);
    previous = row;
    let unit: string | null = null;
    for (const quantity of row.quantities) {
      if (
        (unit !== null && unit >= quantity.unit) ||
        (!quantity.soldMilli && !quantity.returnedMilli)
      )
        invalid();
      unit = quantity.unit;
    }
    billed += BigInt(row.billedSalesMinor);
    refunds += BigInt(row.refundsMinor);
  }
  if (
    billed > BigInt(value.billedSalesMinor) ||
    refunds > BigInt(value.refundsMinor) ||
    (!facts.truncated &&
      (billed !== BigInt(value.billedSalesMinor) ||
        refunds !== BigInt(value.refundsMinor)))
  )
    invalid();
  return value;
}
