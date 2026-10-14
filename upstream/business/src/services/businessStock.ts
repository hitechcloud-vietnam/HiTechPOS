import { type BusinessContext } from "../domain/contracts";
import { type Credential } from "./sessionVault";
import {
  ConnectionError,
  createReportingClient,
  discoverBusinessServer,
  type Options,
} from "./businessConnection";

/** A scoped stored-stock observation with explicit coverage, never a local
 * stock calculation or a sample fallback for a connected account. */
export async function readBusinessStock(
  credential: Credential,
  context: BusinessContext,
  branchId: string,
  options: Options & { fetcher: typeof fetch },
) {
  if (
    !context.capabilities.includes("stock.read") ||
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
    stock: true,
  });
  if (
    discovery.reporting !== "bounded-summary-v2" ||
    discovery.stockReporting !== "bounded-stock-v1"
  )
    throw new ConnectionError("unsupported");
  return createReportingClient(
    credential.origin,
    credential.token,
    bounded(),
  ).stock(context, branchId);
}
