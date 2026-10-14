import { type BusinessContext } from "./contracts";
import {
  branchDay,
  type PreparedOverview,
  validatePreparedOverview,
} from "./preparedOverview";

export const SNAPSHOT_MAX_AGE_MS = 15 * 60_000;
export type OverviewSnapshot = {
  value: PreparedOverview;
  scope: string;
  receivedAt: number;
  expiresAt: number;
};
/** Memory-only identity includes the session and complete observed ACL context. */
export function snapshotScope(
  origin: string,
  token: string,
  context: BusinessContext,
  ids: string[],
) {
  return JSON.stringify([origin, token, context, [...ids].sort()]);
}
export function readOverviewSnapshot(
  snapshot: OverviewSnapshot | null,
  scope: string,
  context: BusinessContext,
  ids: string[],
  now = Date.now(),
): PreparedOverview | null {
  if (
    !snapshot ||
    snapshot.scope !== scope ||
    now < snapshot.receivedAt ||
    now >= snapshot.expiresAt ||
    now - snapshot.receivedAt >= SNAPSHOT_MAX_AGE_MS
  )
    return null;
  const branches = ids.map((id) =>
    context.branches.find((branch) => branch.id === id),
  );
  const timezone = branches[0]?.timezone;
  if (
    !timezone ||
    branches.some((branch) => !branch || branch.timezone !== timezone)
  )
    return null;
  try {
    return validatePreparedOverview(
      snapshot.value,
      context,
      ids,
      branchDay(timezone, new Date(now)),
    );
  } catch {
    return null;
  }
}
