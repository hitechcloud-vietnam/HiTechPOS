import type { Storage } from "./storage";
import type { Shop } from "../domain/types";
import type {
  InventoryDraft,
  InventoryItem,
  InventoryReference,
} from "../domain/inventory";
export class InventoryStore {
  private tail: Promise<unknown> = Promise.resolve();
  private prefix: string;
  constructor(
    private storage: Storage,
    shop: Shop,
  ) {
    this.prefix =
      "inventory:" +
      JSON.stringify([shop.baseUrl, shop.id, shop.branchId, shop.staffId]) +
      ":";
  }
  drafts() {
    return this.storage.list<InventoryDraft>(this.prefix + "draft:");
  }
  // Caller must first cancel the request identity on the original server.
  // A plain not-found read cannot exclude a late in-flight prepare.
  async reopenUnsubmitted(draft: InventoryDraft, newId: string) {
    await this.tail;
    if (draft.operation || draft.state !== "sending" || newId === draft.id)
      throw Error("inventoryUncertain");
    const next: InventoryDraft = { ...draft, id: newId, state: "draft" };
    await this.storage.batch([
      { key: this.prefix + "draft:" + draft.id, value: null },
      { key: this.prefix + "draft:" + newId, value: next },
    ]);
    return next;
  }
  async save(draft: InventoryDraft) {
    const copy: InventoryDraft = JSON.parse(JSON.stringify(draft));
    const work = this.tail.then(async () => {
      const key = this.prefix + "draft:" + copy.id;
      const previous = await this.storage.get<InventoryDraft>(key);
      if (
        previous &&
        previous.state !== "draft" &&
        (copy.state === "draft" ||
          JSON.stringify([copy.mode, copy.reason, copy.lines]) !==
            JSON.stringify([previous.mode, previous.reason, previous.lines]))
      )
        throw Error("inventoryUncertain");
      await this.storage.batch([{ key, value: copy }]);
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async stage(
    kind: string,
    generation: string,
    page: number,
    rows: (InventoryItem | InventoryReference)[],
  ) {
    await this.storage.batch([
      {
        key: this.prefix + "snapshot:" + kind + ":" + generation + ":" + page,
        value: rows,
      },
    ]);
  }
  async activate(
    kind: string,
    generation: string,
    count: number,
    asOf: string,
  ) {
    await this.storage.batch([
      {
        key: this.prefix + "active:" + kind,
        value: { generation, count, asOf },
      },
    ]);
    if (this.storage.keys) {
      const keys = await this.storage.keys(
        this.prefix + "snapshot:" + kind + ":",
      );
      await this.storage.batch(
        keys
          .filter(
            (k) =>
              !k.startsWith(
                this.prefix + "snapshot:" + kind + ":" + generation + ":",
              ),
          )
          .map((key) => ({ key, value: null })),
      );
    }
  }
  async discard(draft: InventoryDraft) {
    if (
      draft.state !== "draft" &&
      draft.operation?.state !== "cancelled" &&
      draft.operation?.state !== "complete"
    )
      throw Error("inventoryUncertain");
    await this.storage.batch([
      { key: this.prefix + "draft:" + draft.id, value: null },
    ]);
  }
  async cache(
    kind: string,
    page: string,
    rows: (InventoryItem | InventoryReference)[],
    asOf: string,
  ) {
    await this.storage.batch([
      { key: this.prefix + kind + ":" + page, value: { rows, asOf } },
    ]);
  }
  async cached(kind: string, query: string, offset = 0, limit = 200) {
    const active = await this.storage.get<{
      generation: string;
      count: number;
      asOf: string;
    }>(this.prefix + "active:" + kind);
    const pages = await this.storage.list<{
      rows: (InventoryItem | InventoryReference)[];
      asOf: string;
    }>(this.prefix + kind + ":");
    const rows = new Map<string, InventoryItem | InventoryReference>();
    if (active)
      for (let i = 0; i < active.count; i++) {
        const page = await this.storage.get<
          (InventoryItem | InventoryReference)[]
        >(this.prefix + "snapshot:" + kind + ":" + active.generation + ":" + i);
        for (const row of page || []) rows.set(row.id, row);
      }
    for (const page of pages
      .filter((p) => !active || p.asOf > active.asOf)
      .sort((a, b) => a.asOf.localeCompare(b.asOf)))
      for (const row of page.rows) rows.set(row.id, row);
    const q = query.toLocaleLowerCase();
    return [...rows.values()]
      .filter((r) =>
        [r.name, "barcode" in r ? r.barcode : "", "sku" in r ? r.sku : ""].some(
          (v) => v?.toLocaleLowerCase().includes(q),
        ),
      )
      .slice(offset, offset + limit);
  }
}
