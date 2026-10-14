import { z } from "zod";
import { type BusinessContext } from "./contracts";
import { type ReportRange, validDay } from "./reportPeriod";
import { branchDay } from "./preparedOverview";
const amount = z.number().int().safe(),
  positive = amount.nonnegative();
const item = z.object({
  itemId: z.string(),
  name: z.string().max(300),
  billedSalesMinor: positive,
  refundsMinor: positive,
  salesAfterReturnsMinor: amount,
  quantities: z
    .array(
      z.object({
        unit: z.string().max(32),
        soldMilli: positive,
        returnedMilli: positive,
      }),
    )
    .max(16),
});
export const insightsSchema = z.object({
  schemaVersion: z.literal(1),
  businessId: z.string(),
  branchId: z.string(),
  from: z.string().nullable(),
  to: z.string(),
  currency: z.string(),
  currencyDigits: z.number().int().min(0).max(3),
  timezone: z.string(),
  billedSalesMinor: positive,
  refundsMinor: positive,
  salesAfterReturnsMinor: amount,
  bills: positive,
  checkedAt: z.string().datetime(),
  complete: z.literal(false),
  items: z
    .object({
      bySales: z.array(item).max(20),
      byQuantity: z
        .array(z.object({ unit: z.string(), items: z.array(item).max(20) }))
        .max(16),
    })
    .nullable(),
  staff: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        billedSalesMinor: positive,
        refundsMinor: positive,
        salesAfterReturnsMinor: amount,
      }),
    )
    .max(20)
    .nullable(),
  hours: z
    .array(
      z.object({
        hour: z.number().int().min(0).max(23),
        billedSalesMinor: positive,
        bills: positive,
      }),
    )
    .length(24),
  discounts: z.object({ amountMinor: positive, bills: positive }).nullable(),
  returns: z.object({ amountMinor: positive, transactions: positive }),
  payments: z
    .object({
      basis: z.literal("invoice-date"),
      receivedMinor: positive,
      outstandingMinor: positive,
      methods: z
        .array(z.object({ name: z.string().max(80), amountMinor: positive }))
        .max(100),
    })
    .nullable(),
  details: z
    .array(
      z.object({
        id: z.string(),
        number: z.string(),
        date: z.string().datetime(),
        billedSalesMinor: positive,
        refundsMinor: positive,
      }),
    )
    .max(50),
});
export type BusinessInsights = z.infer<typeof insightsSchema>;
export function validateInsights(
  input: unknown,
  context: BusinessContext,
  branchId: string,
  range: ReportRange | null,
) {
  const value = insightsSchema.parse(input),
    branch = context.branches.find((b) => b.id === branchId);
  if (
    !branch ||
    !context.capabilities.includes("overview.read") ||
    value.businessId !== context.businessId ||
    value.branchId !== branchId ||
    value.currency !== branch.currency ||
    value.currencyDigits !== branch.currencyDigits ||
    value.timezone !== branch.timezone ||
    (range && (value.from !== range.from || value.to !== range.to)) ||
    value.salesAfterReturnsMinor !==
      value.billedSalesMinor - value.refundsMinor ||
    value.returns.amountMinor !== value.refundsMinor
  )
    throw Error("Invalid insight scope");
  if (
    !validDay(value.to) ||
    (value.from !== null && (!validDay(value.from) || value.from > value.to)) ||
    (!range && value.to !== branchDay(branch.timezone)) ||
    Date.parse(value.checkedAt) > Date.now() + 300000 ||
    Date.parse(value.checkedAt) < Date.now() - 900000
  )
    throw Error("Invalid insight dates");
  if (
    (value.items && !context.capabilities.includes("items.read")) ||
    (value.staff && !context.capabilities.includes("reporting.manage")) ||
    (value.payments && !context.capabilities.includes("tenders.read"))
  )
    throw Error("Unexpected report permission");
  const sum = (rows: number[]) => rows.reduce((a, b) => a + BigInt(b), 0n);
  if (
    new Set(value.hours.map((h) => h.hour)).size !== 24 ||
    sum(value.hours.map((h) => h.billedSalesMinor)) !==
      BigInt(value.billedSalesMinor) ||
    sum(value.hours.map((h) => h.bills)) !== BigInt(value.bills)
  )
    throw Error("Invalid hourly totals");
  if (
    value.payments &&
    (sum(value.payments.methods.map((m) => m.amountMinor)) !==
      BigInt(value.payments.receivedMinor) ||
      BigInt(value.payments.receivedMinor) +
        BigInt(value.payments.outstandingMinor) !==
        BigInt(value.billedSalesMinor))
  )
    throw Error("Invalid payment reconciliation");
  for (const row of [
    ...(value.items?.bySales || []),
    ...(value.items?.byQuantity.flatMap((g) => g.items) || []),
    ...(value.staff || []),
  ])
    if (row.salesAfterReturnsMinor !== row.billedSalesMinor - row.refundsMinor)
      throw Error("Invalid ranking totals");
  return value;
}
