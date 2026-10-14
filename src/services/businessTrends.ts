import { type BusinessContext } from "../domain/contracts";
import {
  branchDay,
  validatePreparedOverview,
  type PreparedOverview,
} from "../domain/preparedOverview";
import { type Credential } from "./sessionVault";
import {
  ConnectionError,
  createReportingClient,
  discoverBusinessServer,
  type Options,
} from "./businessConnection";

export type BusinessTrend = {
  anchorDay: string;
  days: { day: string; summary: PreparedOverview | null }[];
};

/** Calendar arithmetic, not 24-hour subtraction across a branch DST transition. */
export function precedingBusinessDays(timezone: string, instant = new Date()) {
  const anchorDay = branchDay(timezone, instant);
  const cursor = new Date(anchorDay + "T12:00:00Z");
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    days.push(cursor.toISOString().slice(0, 10));
  }
  return { anchorDay, days: days.reverse() };
}

/** Seven bounded prepared reads; the server requests asynchronous desktop preparation. */
export async function readBusinessTrend(
  credential: Credential,
  context: BusinessContext,
  branchIds: string[],
  options: Options & { fetcher: typeof fetch },
  instant = new Date(),
): Promise<BusinessTrend> {
  if (
    !context.capabilities.includes("overview.read") ||
    !branchIds.length ||
    branchIds.length > 100 ||
    new Set(branchIds).size !== branchIds.length
  )
    throw new ConnectionError("accessChanged");
  const branches = branchIds.map((id) =>
    context.branches.find((branch) => branch.id === id),
  );
  if (branches.some((branch) => !branch))
    throw new ConnectionError("accessChanged");
  const first = branches[0]!;
  if (
    branches.some(
      (branch) =>
        branch!.currency !== first.currency ||
        branch!.currencyDigits !== first.currencyDigits ||
        branch!.timezone !== first.timezone,
    )
  )
    throw new ConnectionError("invalidResponse");
  const calendar = precedingBusinessDays(first.timezone, instant);
  const deadline = Date.now() + 20_000;
  const bounded = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ConnectionError("timeout", true);
    return {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 10_000, remaining),
    };
  };
  const discovery = await discoverBusinessServer(credential.origin, bounded());
  if (discovery.reporting !== "bounded-summary-v2")
    throw new ConnectionError("unsupported");
  const days: BusinessTrend["days"] = [];
  for (const day of calendar.days) {
    try {
      const result = await createReportingClient(
        credential.origin,
        credential.token,
        bounded(),
      ).overview(context, branchIds, day, 2);
      days.push({
        day,
        summary: validatePreparedOverview(result, context, branchIds, day),
      });
    } catch (error) {
      // An authoritative missing prepared day is a gap, never a zero-sales day.
      // Network failures, invalid responses and access changes invalidate the whole read.
      if (
        error instanceof ConnectionError &&
        error.problem === "busy" &&
        !error.transient
      )
        days.push({ day, summary: null });
      else throw error;
    }
  }
  return { anchorDay: calendar.anchorDay, days };
}
