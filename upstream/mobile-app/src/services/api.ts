import type { CatalogueInput } from "../data/storage";
import { z } from "zod";
import type { Sale, Shop, Item } from "../domain/types";
import { downloadCatalogue } from "./catalogueDownload";
import { credentials } from "../platform/credentials";

export { serverAddress, parseShopQr } from "./serverAddress";
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export class PosnicApi {
  private csrfToken: string | null = null;
  constructor(
    readonly base: string,
    private fetcher: typeof fetch = fetch,
    private timeoutMs = 15000,
  ) {}
  async request(
    path: string,
    body?: unknown,
    token?: string | null,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Browser fetch checks its receiver. Calling it as this.fetcher binds it
      // to PosnicApi and fails before a network request is sent.
      const fetchRequest = this.fetcher;
      const response = await fetchRequest(this.base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(!token && body !== undefined && this.csrfToken
            ? { "X-XSRF-TOKEN": this.csrfToken }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
        // Mobile authenticates explicitly; a retained browser/session cookie
        // must not turn password sign-in into an ambient authenticated write.
        credentials: "omit",
      });
      // Some native cookie stores still retain server sessions. Reflect the
      // same server's token from the preceding probe without bypassing CSRF.
      this.csrfToken = response.headers?.get("X-CSRF-TOKEN") || this.csrfToken;
      if (!response.ok) {
        const details = await response.json().catch(() => null);
        const serverMessage = details?.error?.message ?? details?.message;
        throw new ApiError(
          path.startsWith("/mobile/v1/inventory/") && response.status === 409
            ? "inventoryConflict"
            : path.startsWith("/mobile/v1/inventory/") &&
                response.status === 400
              ? "inventoryInvalid"
              : typeof serverMessage === "string" &&
                  serverMessage.startsWith("Your session security token")
                ? "signInFailed"
                : typeof serverMessage === "string" &&
                    serverMessage.startsWith("Enable Mobile POS")
                  ? "mobileDisabled"
                  : response.status === 401
                    ? "signInFailed"
                    : response.status === 403
                      ? "permissionDenied"
                      : response.status === 404
                        ? "serverUpgrade"
                        : "networkError",
          response.status,
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("networkError");
    } finally {
      clearTimeout(timeout);
    }
  }
  async probe() {
    const runtime = z
      .object({
        edition: z.enum(["community", "cloud"]),
        apiSchema: z.number(),
        features: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await this.request("/runtime-info"));
    return runtime;
  }
  async connect(
    username: string,
    password: string,
    code?: string,
    persist = true,
    codeVerifier?: string,
  ): Promise<{ shop: Shop; items: CatalogueInput; token: string }> {
    const runtime = await this.probe();
    if (runtime.features?.mobilePosV1 !== true)
      throw new Error("serverUpgrade");
    const device = {
      device_id: await credentials.deviceId(),
      device_model: "Posnic Mobile POS",
      platform: "mobile-pos",
    };
    const result = z
      .object({ token: z.string().min(1) })
      .parse(
        await this.request(
          code ? "/mobile/v1/pair" : "/users/kioskMobileLogin",
          code
            ? { code, device, codeVerifier }
            : { username, password, device },
        ),
      );
    const data = await this.readCatalogue(result.token);
    const shop: Shop = { ...data.shop, mode: "live", baseUrl: this.base };
    if (!shop.capabilities.saleSync) throw new Error("serverUpgrade");
    if (persist) await credentials.set(result.token);
    return { shop, items: data.items, token: result.token };
  }
  async upload(sale: Sale) {
    const { tillPrint: _print, cloudReceivedAt: _cloud, ...payload } = sale;
    const response = z
      .object({
        saleId: z.string(),
        serverId: z.string(),
        shopId: z.string(),
        branchId: z.string(),
      })
      .parse(
        await this.request(
          "/mobile/v1/sales",
          { idempotencyKey: sale.id, sale: payload },
          await credentials.get(this.base),
        ),
      );
    if (
      response.saleId !== sale.id ||
      response.shopId !== sale.shopId ||
      response.branchId !== sale.branchId
    )
      throw new ApiError("invalidServer", 409);
    return response;
  }
  async catalogue(): Promise<{ shop: Shop; items: CatalogueInput }> {
    const data = await this.readCatalogue(await credentials.get(this.base));
    return {
      shop: { ...data.shop, mode: "live", baseUrl: this.base },
      items: data.items,
    };
  }
  async delivery(shop: Shop, sales: Sale[]) {
    const response = z
      .object({
        shopId: z.string(),
        branchId: z.string(),
        staffId: z.string(),
        available: z.boolean(),
        receipts: z
          .array(
            z.object({
              id: z.string(),
              serverId: z.string(),
              receivedAt: z.iso.datetime(),
            }),
          )
          .max(50),
      })
      .parse(
        await this.request(
          "/mobile/v1/delivery-status",
          { ids: sales.map((sale) => sale.id) },
          await credentials.get(this.base),
        ),
      );
    if (
      response.shopId !== shop.id ||
      response.branchId !== shop.branchId ||
      response.staffId !== shop.staffId ||
      (!response.available && response.receipts.length > 0) ||
      response.receipts.some(
        (proof) =>
          !sales.some(
            (sale) => sale.id === proof.id && sale.serverId === proof.serverId,
          ),
      )
    )
      throw new ApiError("invalidServer", 409);
    return response.receipts;
  }
  private async readCatalogue(token: string | null) {
    const raw = await this.request(
      "/mobile/v1/bootstrap?catalogue=paged&quantity=fixed3",
      undefined,
      token,
    );
    const manifest = pagedBootstrap.safeParse(raw);
    if (!manifest.success) return bootstrap.parse(raw);
    const { shop, catalogue } = manifest.data;
    if (catalogue.version !== shop.snapshotVersion)
      throw new ApiError("invalidServer", 409);
    const store = await (await import("../data/openStorage")).openStorage();
    const items = await downloadCatalogue(
      catalogue,
      JSON.stringify([this.base, shop.id, shop.branchId, shop.staffId]),
      store,
      async (index, id) => {
        const page = cataloguePage.parse(
          await this.request(
            `/mobile/v1/catalogue/${encodeURIComponent(catalogue.version)}/${index}`,
            undefined,
            token,
          ),
        );
        if (
          page.id !== id ||
          page.index !== index ||
          page.version !== catalogue.version ||
          page.shopId !== shop.id ||
          page.branchId !== shop.branchId ||
          page.staffId !== shop.staffId
        )
          throw new ApiError("invalidServer", 409);
        return page.items;
      },
      true,
    );
    return { shop, items };
  }
  async receipts(shop: Shop, query: string, before?: string) {
    const result = receiptPage.parse(
      await this.request(
        "/mobile/v1/receipts?q=" +
          encodeURIComponent(query) +
          (before ? "&before=" + encodeURIComponent(before) : ""),
        undefined,
        await credentials.get(this.base),
      ),
    );
    if (
      result.shopId !== shop.id ||
      result.branchId !== shop.branchId ||
      result.staffId !== shop.staffId
    )
      throw new ApiError("invalidServer", 409);
    return result;
  }
  async printReceipt(saleId: string) {
    return this.request(
      "/mobile/v1/print-jobs",
      { id: "receipt:" + saleId, saleId, document: "receipt" },
      await credentials.get(this.base),
    );
  }
  async printReceiptStatus(saleId: string) {
    const result = z
      .object({
        saleId: z.string(),
        state: z.enum([
          "queued",
          "printing",
          "needs_attention",
          "done",
          "failed",
          "not_found",
        ]),
      })
      .parse(
        await this.request(
          `/mobile/v1/print-jobs/${encodeURIComponent(saleId)}`,
          undefined,
          await credentials.get(this.base),
        ),
      );
    if (result.saleId !== saleId) throw new ApiError("invalidServer", 409);
    return result.state;
  }
}
const minor = z.number().int().min(0).max(99999999999);
const item = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price: minor,
  code: z.string().regex(/^\d{0,6}$/),
  barcode: z.string().optional(),
  category: z.string(),
  visual: z.string(),
  image: z.string().max(2048).optional(),
  imageRevision: z.string().max(100).optional(),
  shape: z.enum(["circle", "square", "diamond"]).optional(),
  taxBps: z.number().int().min(0).max(10000),
  taxInclusive: z.boolean(),
  active: z.boolean(),
  requiresConfiguration: z.boolean().optional(),
  quantityScale: z.literal(1000).optional(),
  unit: z.string().max(30).optional(),
});
export const bootstrap = z.object({
  shop: z.object({
    id: z.string().min(1),
    branchId: z.string().min(1),
    name: z.string(),
    branchName: z.string(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .refine(
        (currency) =>
          new Intl.NumberFormat("en", {
            style: "currency",
            currency,
          }).resolvedOptions().maximumFractionDigits === 2,
        "Only two-decimal currencies are supported by this build",
      ),
    staffId: z.string().min(1),
    staffName: z.string(),
    snapshotVersion: z.string().min(1),
    offlineUntil: z.string().datetime(),
    historyPolicy: z
      .object({
        days: z.number().int().min(1).max(365),
        maxReceipts: z.number().int().min(100).max(100000),
      })
      .optional(),
    connection: z
      .object({
        idempotencyScope: z.string().min(1),
        local: z.string().url().optional(),
        remote: z.string().url().optional(),
      })
      .optional(),
    quickTaxBps: z.number().int().min(0).max(10000),
    quickTaxInclusive: z.boolean(),
    permissions: z.object({
      inventoryWrite: z.boolean().optional(),
      supplierRead: z.boolean().optional(),
      sell: z.boolean(),
      quickSale: z.boolean(),
      customerWrite: z.boolean(),
      itemWrite: z.boolean(),
      priceOverride: z.boolean(),
      manualUpi: z.boolean(),
      voidLine: z.boolean().default(false),
      receiptPrint: z.boolean().default(false),
    }),
    paymentMethods: z.array(z.enum(["cash", "card", "upi"])).optional(),
    upiAccounts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        vpa: z.string(),
        active: z.boolean(),
        verification: z.enum(["manual", "provider"]),
      }),
    ),
    defaultUpiAccountId: z.string().optional(),
    capabilities: z.object({
      inventory: z.boolean().optional(),
      saleSync: z.boolean(),
      devicePairing: z.boolean(),
      tillPrint: z.boolean(),
      printStatus: z.boolean().default(false),
      cloudDelivery: z.boolean().default(false),
      terminal: z.boolean(),
    }),
  }),
  items: z.array(item),
});

const receiptPage = z.object({
  shopId: z.string(),
  branchId: z.string(),
  staffId: z.string(),
  next: z.string().nullable(),
  receipts: z
    .array(
      z.object({
        id: z.string(),
        receipt: z.string(),
        createdAt: z.string(),
        total: minor,
        tax: minor,
        currency: z.string(),
        customer: z.string(),
        method: z.enum(["cash", "card", "upi"]),
        lines: z
          .array(
            z.object({
              name: z.string(),
              quantity: z.number().positive(),
              unit: z.string().max(30).optional(),
              price: minor,
            }),
          )
          .max(500),
      }),
    )
    .max(50),
});
export type ServerReceipt = z.infer<typeof receiptPage>["receipts"][number];

const pagedBootstrap = z.object({
  shop: bootstrap.shape.shop,
  catalogue: z.object({
    protocol: z.literal(1),
    version: z.string().regex(/^[a-f0-9]{64}$/),
    count: z.number().int().nonnegative(),
    pages: z.array(
      z.object({
        id: z.string().regex(/^[a-f0-9]{64}$/),
        count: z.number().int().min(1).max(256),
      }),
    ),
  }),
});
const cataloguePage = z.object({
  version: z.string(),
  index: z.number().int().nonnegative(),
  id: z.string(),
  shopId: z.string(),
  branchId: z.string(),
  staffId: z.string(),
  items: z.array(item).max(256),
});
