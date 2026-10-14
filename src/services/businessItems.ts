import { type BusinessContext } from "../domain/contracts";
import { type Credential } from "./sessionVault";
import {
  ConnectionError,
  createReportingClient,
  discoverBusinessServer,
  type Options,
} from "./businessConnection";

/** One branch/day, bounded preparation reads only. No local ranking from a
 * truncated set of branches, and no sample fallback for a connected account. */
export async function readBusinessItems(
  credential: Credential,
  context: BusinessContext,
  branchId: string,
  day: string,
  options: Options & { fetcher: typeof fetch },
) {
  if (
    !context.capabilities.includes("items.read") ||
    !context.capabilities.includes("overview.read") ||
    !context.branches.some((branch) => branch.id === branchId)
  )
    throw new ConnectionError("accessChanged");
  const deadline = Date.now() + 20000;
  const bounded = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ConnectionError("timeout", true);
    return {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 10000, remaining),
    };
  };
  const discovery = await discoverBusinessServer(credential.origin, {
    ...bounded(),
    items: true,
  });
  if (
    discovery.reporting !== "bounded-summary-v2" ||
    discovery.itemReporting !== "bounded-items-v1"
  )
    throw new ConnectionError("unsupported");
  return createReportingClient(
    credential.origin,
    credential.token,
    bounded(),
  ).items(context, branchId, day);
}
