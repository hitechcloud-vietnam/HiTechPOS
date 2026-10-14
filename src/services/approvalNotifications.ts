import { z } from "zod";
import { type BusinessContext } from "../domain/contracts";
import { type Credential } from "./sessionVault";
import {
  ConnectionError,
  discoverBusinessServer,
  readJson,
  type Options,
} from "./businessConnection";
import { preferenceSchema } from "./notifications";

export const approvalPreferenceSchema = preferenceSchema.pick({
  branchId: true,
  timezone: true,
  revision: true,
  enabled: true,
  quiet: true,
});
export type ApprovalPreference = z.infer<typeof approvalPreferenceSchema>;

function branchFor(context: BusinessContext, branchId: string) {
  const branch = context.branches.find((row) => row.id === branchId);
  if (
    !branch ||
    !/^[a-f\d]{24}$/.test(branchId) ||
    !context.capabilities.includes("approvals.read") ||
    !context.capabilities.includes("notifications.self.manage")
  )
    throw new ConnectionError("accessChanged");
  return branch;
}
function validate(value: unknown, context: BusinessContext, branchId: string) {
  const branch = branchFor(context, branchId),
    parsed = approvalPreferenceSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.branchId !== branchId ||
    parsed.data.timezone !== branch.timezone ||
    (parsed.data.quiet.enabled &&
      parsed.data.quiet.start === parsed.data.quiet.end)
  )
    throw new ConnectionError("invalidResponse");
  return parsed.data;
}
export async function readApprovalPreference(
  credential: Credential,
  context: BusinessContext,
  branchId: string,
  options: Options,
) {
  branchFor(context, branchId);
  const discovery = await discoverBusinessServer(credential.origin, {
    ...options,
    approvals: true,
  });
  if (discovery.approvalAlerts !== "inbox-approval-v1")
    throw new ConnectionError("unsupported");
  return validate(
    await readJson(
      credential.origin,
      "/notifications/approvals/" + branchId,
      options,
      credential.token,
    ),
    context,
    branchId,
  );
}
export async function saveApprovalPreference(
  credential: Credential,
  context: BusinessContext,
  input: ApprovalPreference,
  options: Options,
) {
  const preference = validate(input, context, input.branchId);
  if (preference.revision >= Number.MAX_SAFE_INTEGER)
    throw new ConnectionError("invalidResponse");
  const result = validate(
    await readJson(
      credential.origin,
      "/notifications/approvals/" + preference.branchId,
      options,
      credential.token,
      {
        method: "POST",
        body: {
          expectedRevision: preference.revision,
          enabled: preference.enabled,
          quiet: preference.quiet,
        },
      },
    ),
    context,
    preference.branchId,
  );
  if (
    result.revision !== preference.revision + 1 ||
    result.enabled !== preference.enabled ||
    result.quiet.enabled !== preference.quiet.enabled ||
    result.quiet.start !== preference.quiet.start ||
    result.quiet.end !== preference.quiet.end
  )
    throw new ConnectionError("invalidResponse");
  return result;
}
