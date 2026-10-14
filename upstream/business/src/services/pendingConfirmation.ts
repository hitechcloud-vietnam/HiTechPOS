import { type AuthorizationAttempt } from "./authorization";
import { type BusinessContext } from "../domain/contracts";

// Memory only. Keep the short-lived PKCE request through a browser round trip;
// account credentials, confirmation tokens and decision commands are not kept.
let pending: {
  origin: string;
  accountId: string;
  businessId: string;
  requestId: string;
  attempt: AuthorizationAttempt;
} | null = null;
export function rememberConfirmation(
  origin: string,
  context: BusinessContext,
  requestId: string,
  attempt: AuthorizationAttempt,
) {
  pending = {
    origin,
    accountId: context.accountId,
    businessId: context.businessId,
    requestId,
    attempt,
  };
}
export function pendingConfirmation(origin: string, context: BusinessContext) {
  if (pending && pending.attempt.expiresAt <= Date.now()) pending = null;
  return pending?.origin === origin &&
    pending.accountId === context.accountId &&
    pending.businessId === context.businessId
    ? pending
    : null;
}
export function clearConfirmation() {
  pending = null;
}
