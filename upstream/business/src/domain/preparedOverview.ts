import { z } from "zod";
import { type BusinessContext, hasCapability } from "./contracts";

const nonnegative = z.number().int().nonnegative().safe();
const instant = z.string().datetime();
export const preparedOverviewSchema = z
  .object({
    schemaVersion: z.literal(2),
    metricDefinitionVersion: z.literal(2),
    businessId: z.string().min(1),
    branchIds: z.array(z.string().min(1)).min(1).max(100),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    currencyDigits: z.number().int().min(0).max(3),
    billedSalesMinor: nonnegative,
    refundsMinor: nonnegative,
    salesAfterReturnsMinor: z.number().int().safe(),
    completedSales: nonnegative,
    preparedAt: instant,
    freshness: z
      .object({
        state: z.enum(["partial", "delayed"]),
        sourceUpdatedAt: instant.nullable(),
        checkedAt: instant,
        complete: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type PreparedOverview = z.infer<typeof preparedOverviewSchema>;

export function validatePreparedOverview(
  input: unknown,
  context: BusinessContext,
  requested: string[],
  day: string,
): PreparedOverview {
  const value = preparedOverviewSchema.parse(input);
  if (
    !hasCapability(context, "overview.read") ||
    !requested.length ||
    new Set(requested).size !== requested.length ||
    value.businessId !== context.businessId ||
    value.businessDate !== day ||
    value.branchIds.length !== requested.length ||
    new Set(value.branchIds).size !== requested.length ||
    !requested.every((id) => value.branchIds.includes(id))
  )
    throw new Error("Response scope mismatch");
  for (const id of requested) {
    const branch = context.branches.find((branch) => branch.id === id);
    if (
      !branch ||
      branch.currency !== value.currency ||
      branch.currencyDigits !== value.currencyDigits
    )
      throw new Error("Response currency mismatch");
  }
  if (
    value.salesAfterReturnsMinor !==
      value.billedSalesMinor - value.refundsMinor ||
    Date.parse(value.preparedAt) >
      Date.parse(value.freshness.checkedAt) + 5 * 60000 ||
    (value.freshness.sourceUpdatedAt !== null &&
      Date.parse(value.freshness.sourceUpdatedAt) >
        Date.parse(value.preparedAt) + 5 * 60000)
  )
    throw new Error("Invalid summary reconciliation");
  return value;
}

/** Use the branch's calendar day, never the phone's timezone. */
export function branchDay(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}
