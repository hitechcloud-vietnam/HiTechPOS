import { z } from "zod";
import { type BusinessContext } from "../domain/contracts";
import { type Credential } from "./sessionVault";
import { type Session } from "./authorization";
import { readJson, ConnectionError, type Options } from "./businessConnection";

const id = z.string().regex(/^[a-f\d]{24}$/);
const key = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const minor = z.number().int().nonnegative().safe();
const state = z.enum([
  "pending",
  "approved",
  "declined",
  "cancelled",
  "expired",
  "applying",
  "applied",
]);
const person = z
  .object({ id, name: z.string().min(1).max(160).nullable() })
  .strict();
export const decisionSchema = z
  .object({
    id,
    branchId: id,
    action: z.literal("discount_apply"),
    state,
    revision: z.number().int().nonnegative().safe(),
    requester: person,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    summary: z
      .object({
        beforeDiscountMinor: minor,
        discountMinor: minor,
        payableMinor: minor,
        roundingMinor: z.number().int().min(-100).max(100),
        currency: z.string().regex(/^[A-Z]{3}$/),
        currencyDigits: z.number().int().min(0).max(3),
        itemCount: z.number().int().min(1).max(500),
        reason: z.string().min(1).max(500),
      })
      .strict(),
    canDecide: z.boolean(),
    unavailableReason: z
      .enum(["closed", "self_approval", "discount_limit"])
      .nullable(),
    requiresStepUp: z.boolean(),
    decision: z
      .object({
        id: key,
        outcome: z.enum(["approved", "declined"]),
        reason: z.string().max(500),
        approver: person,
      })
      .strict()
      .nullable(),
    timeline: z
      .array(z.object({ state, at: z.string().datetime() }).strict())
      .min(1)
      .max(16),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export function validateDecision(
  input: unknown,
  context: BusinessContext,
): Decision {
  const value = decisionSchema.parse(input),
    summary = value.summary;
  const branch = context.branches.find(
    (branch) => branch.id === value.branchId,
  );
  if (
    !context.capabilities.includes("approvals.read") ||
    !branch ||
    branch.currency !== summary.currency ||
    branch.currencyDigits !== summary.currencyDigits
  )
    throw new Error("Decision scope mismatch");
  if (
    !summary.discountMinor ||
    summary.discountMinor > summary.beforeDiscountMinor ||
    BigInt(summary.payableMinor) !==
      BigInt(summary.beforeDiscountMinor) -
        BigInt(summary.discountMinor) +
        BigInt(summary.roundingMinor)
  )
    throw new Error("Decision amounts mismatch");
  if (
    Date.parse(value.expiresAt) <= Date.parse(value.createdAt) ||
    value.timeline[0]!.state !== "pending" ||
    value.timeline.at(-1)!.state !== value.state ||
    value.timeline.some(
      (event, index) =>
        index > 0 &&
        Date.parse(event.at) < Date.parse(value.timeline[index - 1]!.at),
    )
  )
    throw new Error("Decision history mismatch");
  if (
    value.canDecide !==
      (value.state === "pending" && value.unavailableReason === null) ||
    (value.canDecide &&
      (value.requester.id === context.accountId ||
        !context.capabilities.includes("discounts.approve"))) ||
    (["approved", "applying", "applied", "declined"].includes(value.state) &&
      !value.decision) ||
    (value.decision &&
      (value.decision.approver.id === value.requester.id ||
        (value.state === "declined"
          ? value.decision.outcome !== "declined"
          : value.decision.outcome !== "approved")))
  )
    throw new Error("Decision state mismatch");
  return value;
}
function path(requestId: string) {
  if (!id.safeParse(requestId).success)
    throw new ConnectionError("invalidResponse");
  return "/decisions/" + requestId;
}
function checked(input: unknown, context: BusinessContext, requestId: string) {
  try {
    const value = validateDecision(input, context);
    if (value.id !== requestId) throw new Error("Request mismatch");
    return value;
  } catch {
    throw new ConnectionError("invalidResponse");
  }
}
export async function readDecisions(
  credential: Credential,
  context: BusinessContext,
  options: Options,
  query: { before?: string; branchId?: string; history?: boolean } = {},
) {
  const params = new URLSearchParams();
  for (const field of ["before", "branchId"] as const) {
    if (query[field] !== undefined) {
      if (!id.safeParse(query[field]).success)
        throw new ConnectionError("invalidResponse");
      params.set(field, query[field]!);
    }
  }
  if (query.history) params.set("history", "true");
  const input = await readJson(
    credential.origin,
    "/decisions?" + params,
    options,
    credential.token,
  );
  try {
    const page = z
      .object({
        schemaVersion: z.literal(1),
        entries: z.array(decisionSchema).max(50),
        nextCursor: id.nullable(),
      })
      .strict()
      .parse(input);
    if (
      !context.capabilities.includes("approvals.read") ||
      new Set(page.entries.map((entry) => entry.id)).size !==
        page.entries.length
    )
      throw new Error("Scope mismatch");
    for (const entry of page.entries) {
      validateDecision(entry, context);
      if (
        (query.branchId && entry.branchId !== query.branchId) ||
        (query.before && entry.id >= query.before)
      )
        throw new Error("Page mismatch");
    }
    if (
      page.nextCursor &&
      (page.entries.length !== 50 ||
        page.nextCursor !== page.entries.at(-1)!.id)
    )
      throw new Error("Cursor mismatch");
    return page;
  } catch {
    throw new ConnectionError("invalidResponse");
  }
}
export async function readDecision(
  credential: Credential,
  context: BusinessContext,
  requestId: string,
  options: Options,
) {
  return checked(
    await readJson(
      credential.origin,
      path(requestId),
      options,
      credential.token,
    ),
    context,
    requestId,
  );
}
const actionSchema = z
  .object({
    decisionId: key,
    expectedRevision: z.number().int().nonnegative().safe(),
    outcome: z.enum(["approved", "declined"]),
    reason: z.string().max(500),
  })
  .strict()
  .refine((value) => value.outcome !== "declined" || !!value.reason.trim());
export type DecisionAction = z.infer<typeof actionSchema>;
const problemSchema = z.enum([
  "step_up_required",
  "confirmation_account_mismatch",
  "self_approval_denied",
  "discount_limit_exceeded",
  "decision_changed",
  "request_expired",
  "decision_conflict",
]);
export class DecisionError extends Error {
  constructor(public readonly code: z.infer<typeof problemSchema>) {
    super(code);
  }
}
export function validateConfirmation(
  credential: Credential,
  context: BusinessContext,
  confirmation: Session,
) {
  if (
    confirmation.origin !== credential.origin ||
    confirmation.context.accountId !== context.accountId ||
    confirmation.context.businessId !== context.businessId
  )
    throw new DecisionError("confirmation_account_mismatch");
}
export async function sendDecision(
  credential: Credential,
  context: BusinessContext,
  requestId: string,
  action: DecisionAction,
  options: Options,
  confirmation?: Session,
) {
  if (!context.capabilities.includes("discounts.approve"))
    throw new ConnectionError("accessChanged");
  const body = actionSchema.parse(action);
  if (confirmation) validateConfirmation(credential, context, confirmation);
  const input = await readJson(
    credential.origin,
    path(requestId),
    options,
    credential.token,
    {
      method: "POST",
      body: {
        ...body,
        ...(confirmation ? { confirmationToken: confirmation.token } : {}),
      },
      acceptErrorStatuses: [409, 410, 428],
    },
  );
  const error = z
    .object({ error: z.object({ code: problemSchema }).strict() })
    .strict()
    .safeParse(input);
  if (error.success) throw new DecisionError(error.data.error.code);
  const result = checked(input, context, requestId);
  if (
    result.decision?.id !== action.decisionId ||
    result.decision.outcome !== action.outcome ||
    result.decision.reason !== action.reason ||
    result.decision.approver.id !== context.accountId
  )
    throw new ConnectionError("invalidResponse");
  return result;
}
