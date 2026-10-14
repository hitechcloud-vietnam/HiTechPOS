import { z } from "zod";
import { type BusinessContext } from "../domain/contracts";
import { credentialSchema, type Credential } from "./sessionVault";
import {
  ConnectionError,
  discoverBusinessServer,
  readJson,
  type Options,
} from "./businessConnection";
import { preferenceSchema } from "./notifications";

export const stockPreferenceSchema = preferenceSchema
  .pick({
    branchId: true,
    timezone: true,
    revision: true,
    enabled: true,
    quiet: true,
  })
  .extend({
    minimumIntervalMinutes: z.union([
      z.literal(15),
      z.literal(30),
      z.literal(60),
      z.literal(180),
    ]),
  })
  .strict();
export type StockPreference = z.infer<typeof stockPreferenceSchema>;
function branchFor(context: BusinessContext, branchId: string) {
  const branch = context.branches.find((row) => row.id === branchId);
  if (
    !branch ||
    !/^[a-f\d]{24}$/.test(branchId) ||
    !context.capabilities.includes("stock.read") ||
    !context.capabilities.includes("notifications.self.manage")
  )
    throw new ConnectionError("accessChanged");
  return branch;
}
function validate(value: unknown, context: BusinessContext, branchId: string) {
  const branch = branchFor(context, branchId),
    parsed = stockPreferenceSchema.safeParse(value);
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
function authenticated(credential: Credential) {
  const parsed = credentialSchema.safeParse(credential);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now())
    throw new ConnectionError("signInRequired");
  return parsed.data;
}
async function negotiate(
  credential: Credential,
  context: BusinessContext,
  branchId: string,
  options: Options,
) {
  branchFor(context, branchId);
  const auth = authenticated(credential),
    deadline = Date.now() + 20000;
  const bounded = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ConnectionError("timeout", true);
    return {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 10000, remaining),
    };
  };
  const discovery = await discoverBusinessServer(auth.origin, {
    ...bounded(),
    stockAlertPreferences: true,
  });
  if (discovery.stockAlertPreferences !== "stock-alert-preferences-v1")
    throw new ConnectionError("unsupported");
  branchFor(context, branchId);
  authenticated(auth);
  return { auth, bounded };
}
export async function readStockPreference(
  credential: Credential,
  context: BusinessContext,
  branchId: string,
  options: Options,
) {
  const { auth, bounded } = await negotiate(
    credential,
    context,
    branchId,
    options,
  );
  return validate(
    await readJson(
      auth.origin,
      "/notifications/stock/" + branchId,
      bounded(),
      auth.token,
    ),
    context,
    branchId,
  );
}
export async function saveStockPreference(
  credential: Credential,
  context: BusinessContext,
  input: StockPreference,
  options: Options,
) {
  const preference = validate(input, context, input.branchId);
  if (preference.revision >= Number.MAX_SAFE_INTEGER - 1)
    throw new ConnectionError("invalidResponse");
  const { auth, bounded } = await negotiate(
    credential,
    context,
    preference.branchId,
    options,
  );
  const result = validate(
    await readJson(
      auth.origin,
      "/notifications/stock/" + preference.branchId,
      bounded(),
      auth.token,
      {
        method: "POST",
        body: {
          expectedRevision: preference.revision,
          enabled: preference.enabled,
          minimumIntervalMinutes: preference.minimumIntervalMinutes,
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
    result.minimumIntervalMinutes !== preference.minimumIntervalMinutes ||
    result.quiet.enabled !== preference.quiet.enabled ||
    result.quiet.start !== preference.quiet.start ||
    result.quiet.end !== preference.quiet.end
  )
    throw new ConnectionError("invalidResponse");
  return result;
}
