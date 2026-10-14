import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { type BusinessContext } from "./contracts";
import { branchDay } from "./preparedOverview";
const id = z.string().regex(/^[a-f\d]{24}$/);
const instant = z
  .string()
  .datetime()
  .refine((value) => new Date(value).toISOString() === value);
const amount = z.number().int().nonnegative().safe();
export const registerCloseSchema = z
  .object({
    schemaVersion: z.literal(1),
    branchId: id,
    sessionId: id,
    registerId: id,
    registerName: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value === value.trim()),
    openedAt: instant,
    closedAt: instant,
    closeRevision: z.string().regex(/^[a-f\d]{64}$/),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(100),
    eligibleAt: instant,
  })
  .strict();
export const registerSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    metricDefinitionVersion: z.literal("register-session-v1"),
    businessId: id,
    branchId: id,
    close: registerCloseSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    currencyDigits: z.number().int().min(0).max(3),
    billedSalesMinor: amount,
    refundsMinor: amount,
    completedSales: amount.max(100000),
    salesAfterReturnsMinor: z.number().int().safe(),
    preparedAt: instant,
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
export type RegisterClose = z.infer<typeof registerCloseSchema>;
export type RegisterSummary = z.infer<typeof registerSummarySchema>;
export function validateRegisterClose(
  input: unknown,
  context: BusinessContext,
  branchId: string,
  sessionId: string,
  now = Date.now(),
): RegisterClose {
  const close = registerCloseSchema.parse(input);
  const branch = context.branches.find((b) => b.id === branchId);
  if (
    !branch ||
    !context.capabilities.includes("overview.read") ||
    !context.capabilities.includes("notifications.self.manage") ||
    close.branchId !== branchId ||
    close.sessionId !== sessionId ||
    close.timezone !== branch.timezone
  )
    throw new Error("Register scope mismatch");
  const opened = Date.parse(close.openedAt),
    closed = Date.parse(close.closedAt);
  if (
    opened > closed ||
    closed > now + 300000 ||
    Date.parse(close.eligibleAt) !== closed + 600000 ||
    close.businessDate !== branchDay(branch.timezone, new Date(closed))
  )
    throw new Error("Invalid register bounds");
  const revision = bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([
          context.businessId,
          branchId,
          sessionId,
          close.registerId,
          close.openedAt,
          close.closedAt,
        ]),
      ),
    ),
  );
  if (revision !== close.closeRevision)
    throw new Error("Invalid close revision");
  return close;
}
export function validateRegisterSummary(
  input: unknown,
  context: BusinessContext,
  branchId: string,
  sessionId: string,
  now = Date.now(),
): RegisterSummary {
  const value = registerSummarySchema.parse(input);
  validateRegisterClose(value.close, context, branchId, sessionId, now);
  const branch = context.branches.find((b) => b.id === branchId)!;
  if (
    value.businessId !== context.businessId ||
    value.branchId !== branchId ||
    value.currency !== branch.currency ||
    value.currencyDigits !== branch.currencyDigits
  )
    throw new Error("Register summary scope mismatch");
  const prepared = Date.parse(value.preparedAt),
    checked = Date.parse(value.freshness.checkedAt);
  if (
    value.salesAfterReturnsMinor !==
      value.billedSalesMinor - value.refundsMinor ||
    (value.billedSalesMinor > 0 && value.completedSales === 0) ||
    prepared < Date.parse(value.close.eligibleAt) ||
    prepared > checked + 300000 ||
    checked > now + 300000 ||
    value.freshness.state !==
      (checked - prepared > 900000 ? "delayed" : "partial")
  )
    throw new Error("Invalid register reconciliation");
  return value;
}
