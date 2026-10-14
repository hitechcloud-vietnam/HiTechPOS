import { z } from "zod";
import { type BusinessContext } from "../domain/contracts";
import { type Credential } from "./sessionVault";
import {
  ConnectionError,
  discoverBusinessServer,
  readJson,
  type Options,
} from "./businessConnection";
import {
  preferenceSchema,
  readPreference,
  savePreference,
} from "./notifications";

export const scheduleSchema = preferenceSchema.extend({
  scheduleVersion: z.literal(2),
  mode: z.enum(["daily", "register-close"]),
});
export type SummarySchedule = z.infer<typeof scheduleSchema>;
export type ScheduleResult = {
  supportsClose: boolean;
  preference: SummarySchedule;
};
function branchFor(context: BusinessContext, branchId: string) {
  const branch = context.branches.find((b) => b.id === branchId);
  if (
    !branch ||
    !/^[a-f\d]{24}$/.test(branchId) ||
    !context.capabilities.includes("overview.read") ||
    !context.capabilities.includes("notifications.self.manage")
  )
    throw new ConnectionError("accessChanged");
  return branch;
}
function validate(
  value: unknown,
  context: BusinessContext,
  branchId: string,
  response = true,
) {
  const branch = branchFor(context, branchId),
    parsed = scheduleSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.branchId !== branchId ||
    parsed.data.timezone !== branch.timezone ||
    (parsed.data.quiet.enabled &&
      parsed.data.quiet.start === parsed.data.quiet.end) ||
    (response &&
      (!parsed.data.enabled || parsed.data.mode === "register-close") &&
      parsed.data.nextSendAt !== null)
  )
    throw new ConnectionError("invalidResponse");
  return parsed.data;
}
const path = (branchId: string) =>
  "/notifications/preferences/" + branchId + "?scheduleVersion=2";
export async function readSummarySchedule(
  credential: Credential,
  context: BusinessContext,
  branchId: string,
  options: Options,
): Promise<ScheduleResult> {
  branchFor(context, branchId);
  const discovery = await discoverBusinessServer(credential.origin, {
    ...options,
    registerSessions: true,
  });
  const supportsClose =
    discovery.registerSchedules === "register-close-v1" &&
    discovery.registerInbox === "inbox-register-v1" &&
    discovery.registerReporting === "bounded-register-session-v1";
  const value = supportsClose
    ? await readJson(
        credential.origin,
        path(branchId),
        options,
        credential.token,
      )
    : {
        ...(await readPreference(credential, branchId, options)),
        scheduleVersion: 2,
        mode: "daily",
      };
  return { supportsClose, preference: validate(value, context, branchId) };
}
export async function saveSummarySchedule(
  credential: Credential,
  context: BusinessContext,
  input: ScheduleResult,
  options: Options,
): Promise<ScheduleResult> {
  const preference = validate(
    input.preference,
    context,
    input.preference.branchId,
    false,
  );
  if (
    preference.revision >= Number.MAX_SAFE_INTEGER ||
    (!input.supportsClose && preference.mode !== "daily")
  )
    throw new ConnectionError("unsupported");
  let value: unknown;
  if (input.supportsClose)
    value = await readJson(
      credential.origin,
      path(preference.branchId),
      options,
      credential.token,
      {
        method: "POST",
        body: {
          expectedRevision: preference.revision,
          enabled: preference.enabled,
          time: preference.time,
          quiet: preference.quiet,
          locale: preference.locale,
          scheduleVersion: 2,
          mode: preference.mode,
        },
      },
    );
  else {
    const { scheduleVersion: _version, mode: _mode, ...legacy } = preference;
    value = {
      ...(await savePreference(credential, legacy, options)),
      scheduleVersion: 2,
      mode: "daily",
    };
  }
  const result = validate(value, context, preference.branchId);
  if (
    result.revision !== preference.revision + 1 ||
    result.mode !== preference.mode ||
    result.enabled !== preference.enabled ||
    result.time !== preference.time ||
    result.locale !== preference.locale ||
    result.quiet.enabled !== preference.quiet.enabled ||
    result.quiet.start !== preference.quiet.start ||
    result.quiet.end !== preference.quiet.end
  )
    throw new ConnectionError("invalidResponse");
  return { supportsClose: input.supportsClose, preference: result };
}
