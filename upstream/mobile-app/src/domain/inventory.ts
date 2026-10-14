import type { Item } from "./types";
export type InventoryMode = "count" | "receive" | "damage" | "loss";
export interface InventoryItem extends Item {
  tracked: boolean;
  quantity: number | null;
  revision: string;
  supplierId: string;
  supplierName: string;
  categoryId: string;
  sku: string;
  unit: string;
}
export interface InventoryReference {
  id: string;
  name: string;
  active: boolean;
}
export interface InventoryOperation {
  id: string;
  operationId: string;
  mode: InventoryMode;
  state: "prepared" | "applying" | "conflict" | "complete" | "cancelled";
  reason: string;
  approvalRequired: boolean;
  lines: {
    itemId: string;
    name: string;
    quantity: number;
    expected: number;
    actualOpening?: number;
    actualClosing?: number;
  }[];
  applied: string[];
  conflicts: string[];
}
export interface InventoryDraft {
  id: string;
  mode: InventoryMode;
  reason: string;
  createdAt: string;
  state: "draft" | "sending" | "submitted";
  lines: { item: InventoryItem; quantity: number }[];
  operation?: InventoryOperation;
}
export function inventoryPayload(draft: InventoryDraft) {
  if (!draft.reason.trim() || !draft.lines.length || draft.lines.length > 200)
    throw Error("inventoryReviewRequired");
  const seen = new Set<string>();
  for (const line of draft.lines) {
    if (
      seen.has(line.item.id) ||
      !line.item.tracked ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 0 ||
      line.quantity > 999999999 ||
      (draft.mode !== "count" && !line.quantity) ||
      (!line.item.quantityScale && line.quantity % 1000)
    )
      throw Error("invalidQuantity");
    seen.add(line.item.id);
  }
  return {
    id: draft.id,
    mode: draft.mode,
    reason: draft.reason,
    lines: draft.lines.map((l) => ({
      itemId: l.item.id,
      quantity: l.quantity,
      ...(draft.mode === "count" ? { revision: l.item.revision } : {}),
    })),
  };
}
