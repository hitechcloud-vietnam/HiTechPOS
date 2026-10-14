import { z } from "zod";
import { vault } from "../platform/vault";
import { PosnicApi } from "./api";
import type { Shop } from "../domain/types";
import type {
  InventoryDraft,
  InventoryItem,
  InventoryOperation,
  InventoryReference,
} from "../domain/inventory";
import { inventoryPayload } from "../domain/inventory";
const operation = z.object({
  id: z.string(),
  operationId: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["count", "receive", "damage", "loss"]),
  state: z.enum(["prepared", "applying", "conflict", "complete", "cancelled"]),
  reason: z.string(),
  approvalRequired: z.boolean(),
  applied: z.array(z.string()),
  conflicts: z.array(z.string()),
  lines: z.array(
    z.object({
      itemId: z.string(),
      name: z.string(),
      quantity: z.number().int(),
      expected: z.number().int(),
      actualOpening: z.number().int().optional(),
      actualClosing: z.number().int().optional(),
    }),
  ),
});
const row = z
  .object({ id: z.string(), name: z.string(), active: z.boolean() })
  .passthrough();
const inventoryItem = row.extend({
  tracked: z.boolean(),
  quantity: z.number().int().nullable(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  price: z.number().int().nonnegative(),
  code: z.string(),
  category: z.string(),
  visual: z.string(),
  taxBps: z.number().int(),
  taxInclusive: z.boolean(),
  unit: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  categoryId: z.string(),
  sku: z.string(),
  quantityScale: z.literal(1000).optional(),
  image: z.string().max(2048).optional(),
});
export class InventoryApi {
  private api: PosnicApi;
  constructor(private shop: Shop) {
    if (!shop.baseUrl || shop.mode !== "live") throw Error("serverUpgrade");
    this.api = new PosnicApi(shop.baseUrl);
  }
  private async request(path: string, body?: unknown) {
    const account = await vault.accountFor(this.shop.baseUrl!);
    if (!account || account.server !== this.shop.baseUrl)
      throw Error("signInFailed");
    return this.api.request(
      "/mobile/v1/inventory/" + path,
      body === undefined
        ? undefined
        : {
            ...(body as Record<string, unknown>),
            scope: {
              shopId: this.shop.id,
              branchId: this.shop.branchId,
              staffId: this.shop.staffId,
            },
          },
      account.token,
    );
  }
  async catalogue(kind = "items", q = "", after = "") {
    const page = z
      .object({
        shopId: z.string(),
        branchId: z.string(),
        staffId: z.string(),
        asOf: z.string(),
        permissions: z.object({
          read: z.boolean(),
          write: z.boolean(),
          approvalActions: z.array(z.string()),
        }),
        rows: z.array(row).max(200),
        next: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .nullable(),
      })
      .parse(
        await this.request(
          "catalogue?kind=" +
            encodeURIComponent(kind) +
            "&q=" +
            encodeURIComponent(q) +
            (after ? "&after=" + encodeURIComponent(after) : ""),
        ),
      );
    if (
      page.shopId !== this.shop.id ||
      page.branchId !== this.shop.branchId ||
      page.staffId !== this.shop.staffId
    )
      throw Error("invalidServer");
    if (page.next && after && page.next <= after) throw Error("invalidServer");
    const rows =
      kind === "items"
        ? page.rows.map((r) => {
            const parsed = inventoryItem.parse(r);
            if (parsed.image?.startsWith("/"))
              parsed.image = new URL(
                parsed.image,
                this.shop.baseUrl,
              ).toString();
            return parsed;
          })
        : page.rows;
    return {
      ...page,
      rows: rows as unknown as (InventoryItem | InventoryReference)[],
    };
  }
  async prepare(draft: InventoryDraft): Promise<InventoryOperation> {
    return operation.parse(
      await this.request("operations", inventoryPayload(draft)),
    );
  }
  async status(id: string) {
    return operation.parse(
      await this.request("operations/" + encodeURIComponent(id)),
    );
  }
  async findRequest(id: string) {
    return z
      .object({ operation: operation.nullable() })
      .parse(await this.request("requests/" + encodeURIComponent(id)))
      .operation;
  }
  async abandonRequest(id: string) {
    return operation.parse(
      await this.request("requests/" + encodeURIComponent(id) + "/cancel", {}),
    );
  }
  async confirm(id: string) {
    return operation.parse(
      await this.request(
        "operations/" + encodeURIComponent(id) + "/confirm",
        {},
      ),
    );
  }
  async cancel(id: string) {
    return operation.parse(
      await this.request(
        "operations/" + encodeURIComponent(id) + "/cancel",
        {},
      ),
    );
  }
  async operations(after = "") {
    return z
      .object({ rows: z.array(operation), next: z.string().nullable() })
      .parse(
        await this.request(
          "operations" + (after ? "?after=" + encodeURIComponent(after) : ""),
        ),
      );
  }
  async history(itemId: string, before = "") {
    return z
      .object({
        rows: z.array(
          z.object({
            id: z.string(),
            at: z.string().nullable(),
            reason: z.string(),
            note: z.string(),
            opening: z.string(),
            closing: z.string(),
            quantity: z.string(),
            actor: z.string(),
          }),
        ),
        next: z.string().nullable(),
      })
      .parse(
        await this.request(
          "items/" +
            encodeURIComponent(itemId) +
            "/history" +
            (before ? "?before=" + encodeURIComponent(before) : ""),
        ),
      );
  }
}
