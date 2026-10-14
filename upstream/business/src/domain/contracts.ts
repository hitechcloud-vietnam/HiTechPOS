import { z } from "zod";

export const capabilitySchema = z.enum([
  "reporting.manage",
  "overview.read",
  "tenders.read",
  "items.read",
  "stock.read",
  "approvals.read",
  "discounts.approve",
  "notifications.self.manage",
]);
export type Capability = z.infer<typeof capabilitySchema>;
const id = z.string().min(1).max(128);
const minor = z.number().int().safe();
const instant = z.string().datetime({ offset: true });
export const branchSchema = z
  .object({
    id,
    name: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    currencyDigits: z.number().int().min(0).max(3),
    timezone: z.string().min(1),
  })
  .strict();
export const contextSchema = z
  .object({
    accountId: id,
    businessId: id,
    businessName: z.string().min(1),
    branches: z.array(branchSchema).max(100),
    capabilities: z.array(capabilitySchema),
  })
  .strict()
  .refine(
    (c) => new Set(c.branches.map((b) => b.id)).size === c.branches.length,
    "Duplicate branch ID",
  );
export type BusinessContext = z.infer<typeof contextSchema>;
export const freshnessSchema = z
  .object({
    state: z.enum(["current", "delayed", "partial", "unavailable"]),
    sourceUpdatedAt: instant.nullable(),
    checkedAt: instant,
    complete: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.state === "current" && (!v.complete || v.sourceUpdatedAt === null))
      ctx.addIssue({
        code: "custom",
        message: "Current data needs a complete source watermark",
      });
    if (v.state !== "current" && v.complete)
      ctx.addIssue({
        code: "custom",
        message: "Incomplete state cannot claim completeness",
      });
  });
export const overviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    metricDefinitionVersion: z.literal(1),
    businessId: id,
    branchIds: z.array(id).min(1).max(100),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    currencyDigits: z.number().int().min(0).max(3),
    netSalesMinor: minor,
    completedSales: z.number().int().nonnegative().safe(),
    freshness: freshnessSchema,
  })
  .strict();
export type Overview = z.infer<typeof overviewSchema>;
export type ItemSummary = {
  id: string;
  name: string;
  netSalesMinor: number;
  quantity: number;
};
export type StockItem = {
  id: string;
  name: string;
  available: number;
  threshold: number;
  unit: string;
};

export function hasCapability(
  context: BusinessContext,
  capability: Capability,
) {
  return context.capabilities.includes(capability);
}
/** Empty access is an unavailable state, never permission to query all branches. */
export function resolveBranchScope(
  context: BusinessContext,
  selection: string | null,
): string[] {
  if (context.branches.length === 0) return [];
  if (context.branches.length === 1) return [context.branches[0]!.id];
  if (selection === null || selection === "all")
    return context.branches.map((b) => b.id);
  if (!context.branches.some((b) => b.id === selection))
    throw new Error("Branch access denied");
  return [selection];
}
export function canShowBranchSelector(context: BusinessContext) {
  return context.branches.length > 1;
}
/** Defense in depth for adapters. Production must enforce the same checks server-side. */
export function validateOverview(
  input: unknown,
  context: BusinessContext,
  requested: string[],
): Overview {
  if (!hasCapability(context, "overview.read"))
    throw new Error("Overview access denied");
  const value = overviewSchema.parse(input);
  if (!requested.length || new Set(requested).size !== requested.length)
    throw new Error("Invalid branch scope");
  if (value.businessId !== context.businessId)
    throw new Error("Business mismatch");
  if (
    value.branchIds.length !== requested.length ||
    new Set(value.branchIds).size !== requested.length ||
    !requested.every((b) => value.branchIds.includes(b))
  )
    throw new Error("Response scope mismatch");
  for (const branchId of requested) {
    const b = context.branches.find((b) => b.id === branchId);
    if (!b) throw new Error("Branch access denied");
    if (
      b.currency !== value.currency ||
      b.currencyDigits !== value.currencyDigits
    )
      throw new Error("Currencies must be grouped separately");
  }
  return value;
}
