import { z } from "zod";
import { validateInsights } from "../domain/businessInsights";
import { type ReportRange } from "../domain/reportPeriod";
import { communityOrigin } from "../domain/server";
import { validatePreparedOverview } from "../domain/preparedOverview";
import { validatePreparedStock } from "../domain/preparedStock";
import { validatePreparedItems } from "../domain/preparedItems";
import {
  contextSchema,
  validateOverview,
  type BusinessContext,
} from "../domain/contracts";

export const CLOUD_ORIGIN = "https://www.posnic.com";
export const BUSINESS_PATH = "/api/business/v1";
export type ConnectionProblem =
  | "unsupported"
  | "unreachable"
  | "timeout"
  | "cancelled"
  | "signInRequired"
  | "accessChanged"
  | "busy"
  | "conflict"
  | "invalidResponse";
export class ConnectionError extends Error {
  constructor(
    public readonly problem: ConnectionProblem,
    public readonly transient = false,
  ) {
    super(problem);
    this.name = "ConnectionError";
  }
}

// Fixed relative endpoints: a discovery document cannot move credentials to
// another server, introduce selling permissions, or select arbitrary URLs.
const discoverySchema = z
  .object({
    product: z.literal("posnic-business"),
    apiVersion: z.literal(1),
    issuer: z.string(),
    authorization: z.enum(["business-pkce-v1", "business-cloud-pkce-v1"]),
    audience: z.literal("posnic-business"),
    reporting: z.enum([
      "bounded-summary-v1",
      "bounded-summary-v2",
      "unavailable",
    ]),
    itemReporting: z.literal("bounded-items-v1").optional(),
    insightReporting: z.literal("bounded-insights-v1").optional(),
    stockReporting: z.literal("bounded-stock-v1").optional(),
    approvalAlerts: z.literal("inbox-approval-v1").optional(),
    stockAlerts: z.literal("inbox-stock-v1").optional(),
    stockAlertPreferences: z.literal("stock-alert-preferences-v1").optional(),
    registerReporting: z.literal("bounded-register-session-v1").optional(),
    registerInbox: z.literal("inbox-register-v1").optional(),
    registerSchedules: z.literal("register-close-v1").optional(),
  })
  .strict();
export type Discovery = z.infer<typeof discoverySchema>;
export type Options = {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export async function readJson(
  origin: string,
  path: string,
  options: Options,
  token?: string,
  request?: {
    method: "POST" | "DELETE";
    body?: unknown;
    acceptErrorStatuses?: (409 | 410 | 428)[];
  },
) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 10_000);
  try {
    if (controller.signal.aborted) throw new ConnectionError("cancelled");
    const url = origin + BUSINESS_PATH + path;
    const response = await (options.fetcher ?? fetch)(url, {
      method: request?.method ?? "GET",
      ...(request?.body ? { body: JSON.stringify(request.body) } : {}),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(request?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.redirected || (response.url && response.url !== url))
      throw new ConnectionError("invalidResponse");
    if (response.status === 401) throw new ConnectionError("signInRequired");
    if (response.status === 403) throw new ConnectionError("accessChanged");
    if ([404, 405, 426, 501].includes(response.status))
      throw new ConnectionError("unsupported");
    if (response.status === 409 && !request?.acceptErrorStatuses?.includes(409))
      throw new ConnectionError("conflict");
    if ([429, 503].includes(response.status))
      throw new ConnectionError("busy", response.status === 429);
    if (
      !response.ok &&
      !request?.acceptErrorStatuses?.some(
        (status) => status === response.status,
      )
    )
      throw new ConnectionError("unreachable", response.status >= 500);
    if (
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      throw new ConnectionError("invalidResponse");
    const reader = response.body?.getReader();
    if (!reader) throw new ConnectionError("invalidResponse");
    const decoder = new TextDecoder();
    let raw = "",
      bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 256_000) {
          await reader.cancel();
          throw new ConnectionError("invalidResponse");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    if (controller.signal.aborted)
      throw new ConnectionError(timedOut ? "timeout" : "cancelled", timedOut);
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new ConnectionError("invalidResponse");
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw new ConnectionError(timedOut ? "timeout" : "cancelled", timedOut);
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError("unreachable", true);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

export async function discoverBusinessServer(
  address: string,
  options: Options & {
    items?: boolean;
    insights?: boolean;
    approvals?: boolean;
    registerSessions?: boolean;
    stock?: boolean;
    stockAlertPreferences?: boolean;
    stockAlerts?: boolean;
  } = {},
): Promise<Discovery> {
  const origin = communityOrigin(address);
  const query = new URLSearchParams();
  if (options.items) query.set("items", "1");
  if (options.insights) query.set("insights", "1");
  if (options.approvals) query.set("approvals", "1");
  if (options.stock) query.set("stock", "1");
  if (options.stockAlerts) query.set("stockAlerts", "1");
  if (options.stockAlertPreferences) query.set("stockAlertPreferences", "1");
  if (options.registerSessions) query.set("registerSessions", "1");
  const parsed = discoverySchema.safeParse(
    await readJson(
      origin,
      "/discovery" + (query.size ? "?" + query.toString() : ""),
      options,
    ),
  );
  if (!parsed.success || parsed.data.issuer !== origin)
    throw new ConnectionError("unsupported");
  if (
    parsed.data.authorization === "business-cloud-pkce-v1" &&
    origin !== CLOUD_ORIGIN
  )
    throw new ConnectionError("unsupported");
  return parsed.data;
}

/** Every request retains the dedicated Business audience and exact origin. */
export function createReportingClient(
  address: string,
  token: string,
  options: Options & { fetcher: typeof fetch },
) {
  const origin = communityOrigin(address);
  // Business opaque tokens are deliberately distinct from existing POS JWTs.
  if (!/^pb1_[A-Za-z0-9_-]{43}$/.test(token))
    throw new ConnectionError("signInRequired");
  return {
    async insights(
      context: BusinessContext,
      branchId: string,
      range: ReportRange | null,
    ) {
      if (
        !context.capabilities.includes("overview.read") ||
        !context.branches.some((b) => b.id === branchId)
      )
        throw new ConnectionError("accessChanged");
      const discovery = await discoverBusinessServer(origin, {
        ...options,
        insights: true,
      });
      if (discovery.insightReporting !== "bounded-insights-v1")
        throw new ConnectionError("unsupported");
      const query = new URLSearchParams({
        branchId,
        ...(range ? range : { period: "all" }),
      });
      const value = await readJson(
        origin,
        `/insights?${query}`,
        options,
        token,
      );
      try {
        return validateInsights(value, context, branchId, range);
      } catch {
        throw new ConnectionError("invalidResponse");
      }
    },
    async stock(context: BusinessContext, branchId: string) {
      if (
        !context.capabilities.includes("stock.read") ||
        !context.branches.some((branch) => branch.id === branchId)
      )
        throw new ConnectionError("accessChanged");
      const value = await readJson(
        origin,
        `/stock?${new URLSearchParams({ branchId })}`,
        options,
        token,
      );
      try {
        return validatePreparedStock(value, context, branchId);
      } catch {
        throw new ConnectionError("invalidResponse");
      }
    },
    async items(
      context: BusinessContext,
      branchId: string,
      businessDate: string,
    ) {
      if (
        !context.capabilities.includes("overview.read") ||
        !context.capabilities.includes("items.read") ||
        !context.branches.some((branch) => branch.id === branchId)
      )
        throw new ConnectionError("accessChanged");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
        !Number.isFinite(Date.parse(businessDate)) ||
        new Date(businessDate).toISOString().slice(0, 10) !== businessDate
      )
        throw new ConnectionError("invalidResponse");
      const query = new URLSearchParams({ businessDate, branchId });
      const value = await readJson(origin, `/items?${query}`, options, token);
      try {
        return validatePreparedItems(value, context, branchId, businessDate);
      } catch {
        throw new ConnectionError("invalidResponse");
      }
    },
    async context(): Promise<BusinessContext> {
      const parsed = contextSchema.safeParse(
        await readJson(origin, "/context", options, token),
      );
      if (!parsed.success) throw new ConnectionError("invalidResponse");
      return parsed.data;
    },
    async overview(
      context: BusinessContext,
      branchIds: string[],
      businessDate: string,
      version: 1 | 2 = 1,
    ) {
      if (
        !context.capabilities.includes("overview.read") ||
        !branchIds.length ||
        new Set(branchIds).size !== branchIds.length ||
        branchIds.length > 100 ||
        branchIds.some((id) => !context.branches.some((b) => b.id === id))
      )
        throw new ConnectionError("accessChanged");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
        !Number.isFinite(Date.parse(businessDate)) ||
        new Date(businessDate).toISOString().slice(0, 10) !== businessDate
      )
        throw new ConnectionError("invalidResponse");
      const query = new URLSearchParams({ businessDate });
      branchIds.forEach((id) => query.append("branchId", id));
      const value = await readJson(
        origin,
        `/overview?${query}`,
        options,
        token,
      );
      try {
        const result =
          version === 2
            ? validatePreparedOverview(value, context, branchIds, businessDate)
            : validateOverview(value, context, branchIds);
        if (result.businessDate !== businessDate)
          throw new Error("Date mismatch");
        return result;
      } catch {
        throw new ConnectionError("invalidResponse");
      }
    },
  };
}
