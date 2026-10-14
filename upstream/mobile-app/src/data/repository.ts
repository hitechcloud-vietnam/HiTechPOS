import {
  catalogueCollector,
  type CatalogueQuery,
  type CatalogueResult,
} from "./catalogueQuery";
import type { Storage, Change, CatalogueInput } from "./storage";
import { InventoryStore } from "./inventory";
import type {
  Cart,
  Customer,
  Item,
  Line,
  Outbox,
  Payment,
  Sale,
  SessionData,
  Settings,
  Shop,
} from "../domain/types";
import { quickCode, totals } from "../domain/money";
import { trainingItems, trainingShop } from "./training";
import { resolveProductScan } from "../domain/scanning";
import type { DirectPrintJob } from "../domain/types";
import { receiptsToPrune, printNeedsAttention } from "../domain/retention";
import { photoReady, photoScore, type PhotoDraft } from "../domain/photoOrders";

export class Repository {
  inventory(shop: Shop) {
    return new InventoryStore(this.store, shop);
  }
  private connectionKey(shop: Shop) {
    return `connections:${shop.id}:${shop.branchId}:${shop.staffId}`;
  }
  async connections(shop: Shop): Promise<string[]> {
    return [
      ...new Set([
        shop.baseUrl!,
        ...((await this.store.get<string[]>(this.connectionKey(shop))) ?? []),
      ]),
    ].filter(Boolean);
  }
  async switchConnection(shop: Shop, items: CatalogueInput) {
    return this.serial(async () => {
      const current = await this.store.get<Shop>("shop");
      if (
        !current ||
        current.mode !== "live" ||
        shop.mode !== "live" ||
        current.id !== shop.id ||
        current.branchId !== shop.branchId ||
        current.staffId !== shop.staffId ||
        !shop.baseUrl
      )
        throw Error("connectionWrongShop");
      // Reauthentication to the same endpoint must remain possible with an outbox.
      if (current.baseUrl === shop.baseUrl) {
        await this.replaceCatalogue(items, [
          { key: "shop", value: shop },
          {
            key: "catalogue-updated-at",
            value: new Date(this.now()).toISOString(),
          },
        ]);
        this.catalogueCache = null;
        return;
      }
      const sales = await this.store.list<Sale>("sale:");
      const prints = await this.store.list<DirectPrintJob>("print:");
      if (
        (await this.store.list<Outbox>("outbox:")).length ||
        sales.some((s) => s.sync !== "synced" || s.tillPrint === "pending") ||
        prints.some(printNeedsAttention)
      )
        throw Error("connectionPending");
      if (
        (await this.store.get<Cart>("cart"))?.lines.length ||
        (await this.store.list<Cart>("held:")).length
      )
        throw Error("connectionCart");
      const changes: Change[] = [];
      if (current.baseUrl !== shop.baseUrl) {
        const prefix = (s: Shop) =>
          `connection-history:${encodeURIComponent(s.baseUrl!)}:${s.id}:${s.branchId}:${s.staffId}:`;
        for (const sale of sales) {
          changes.push(
            { key: prefix(current) + sale.id, value: sale },
            { key: "sale:" + sale.id, value: null },
          );
        }
        for (const sale of await this.store.list<Sale>(prefix(shop)))
          changes.push({ key: "sale:" + sale.id, value: sale });
        for (const job of prints)
          changes.push(
            {
              key: `connection-print:${encodeURIComponent(current.baseUrl!)}:${job.id}`,
              value: job,
            },
            { key: "print:" + job.id, value: null },
          );
        for (const customer of await this.store.list<Customer>("customer:"))
          changes.push({ key: "customer:" + customer.id, value: null });
      }
      await this.replaceCatalogue(items, [
        ...changes,
        { key: "shop", value: shop },
        {
          key: this.connectionKey(shop),
          value: [
            ...new Set([...(await this.connections(current)), shop.baseUrl]),
          ],
        },
        {
          key: "catalogue-updated-at",
          value: new Date(this.now()).toISOString(),
        },
      ]);
      this.catalogueCache = null;
    });
  }
  private tail: Promise<unknown> = Promise.resolve();
  private catalogueCache: CatalogueResult | null = null;
  constructor(
    private store: Storage,
    private uuid: () => string,
    private now: () => number = Date.now,
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  newCart(): Cart {
    return {
      id: this.uuid(),
      lines: [],
      createdAt: new Date(this.now()).toISOString(),
    };
  }
  async load(): Promise<SessionData> {
    await this.tail;
    const [
      shop,
      items,
      cart,
      held,
      sales,
      outbox,
      settings,
      customers,
      catalogueUpdatedAt,
    ] = await Promise.all([
      this.store.get<Shop>("shop"),
      this.catalogueCache ?? this.queryCatalogue({}),
      this.store.get<Cart>("cart"),
      this.store.list<Cart>("held:"),
      this.store.list<Sale>("sale:"),
      this.store.list<Outbox>("outbox:"),
      this.store.get<Settings>("settings"),
      this.store.list<Customer>("customer:"),
      this.store.get<string>("catalogue-updated-at"),
    ]);
    this.catalogueCache = items;
    return {
      shop,
      favourites: shop
        ? ((await this.store.get<string[]>(this.favouritesKey(shop))) ?? [])
        : [],
      catalogueUpdatedAt: catalogueUpdatedAt ?? undefined,
      items: items.items,
      catalogue: items.summary,
      cart: cart ?? this.newCart(),
      held,
      sales: sales.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      outbox,
      settings: settings ?? {
        locale: "en",
        printer: "system",
        autoPrint: false,
      },
      customers,
    };
  }
  private async queryCatalogue(
    query: CatalogueQuery,
  ): Promise<CatalogueResult> {
    if (this.store.catalogue) return this.store.catalogue(query);
    const result = catalogueCollector(query);
    for (const item of await this.store.list<Item>("item:")) result.add(item);
    return result.finish();
  }
  async catalogue(query: CatalogueQuery = {}) {
    await this.tail;
    return this.queryCatalogue(query);
  }
  private favouritesKey(shop: Shop) {
    return (
      "favourites:" +
      JSON.stringify([shop.mode, shop.id, shop.branchId, shop.staffId])
    );
  }
  async toggleFavourite(id: string) {
    return this.serial(async () => {
      const shop = await this.authorized("sell");
      const key = this.favouritesKey(shop);
      const current = (await this.store.get<string[]>(key)) ?? [];
      const item = await this.store.get<Item>("item:" + id);
      if (!current.includes(id) && (!item || !item.active))
        throw Error("notFound");
      await this.store.batch([
        {
          key,
          value: current.includes(id)
            ? current.filter((value) => value !== id)
            : [...current, id],
        },
      ]);
    });
  }
  async *imageItems(): AsyncGenerator<Item> {
    const version = (await this.store.get<Shop>("shop"))?.snapshotVersion;
    let offset = 0;
    for (;;) {
      const page = await this.catalogue({
        imagesOnly: true,
        offset,
        limit: 256,
      });
      if ((await this.store.get<Shop>("shop"))?.snapshotVersion !== version)
        throw Error("catalogueChanged");
      for (const item of page.items) yield item;
      offset += page.items.length;
      if (offset >= page.total || !page.items.length) return;
    }
  }
  private async itemKeys() {
    return this.store.keys
      ? this.store.keys("item:")
      : (await this.store.list<Item>("item:")).map((item) => "item:" + item.id);
  }
  async startTraining() {
    return this.serial(async () => {
      if (await this.store.get("shop")) throw new Error("shopAlreadyPaired");
      await this.store.batch([
        { key: "shop", value: trainingShop },
        { key: "cart", value: this.newCart() },
        ...trainingItems.map((item) => ({
          key: "item:" + item.id,
          value: item,
        })),
      ]);
      this.catalogueCache = null;
    });
  }
  private async replaceCatalogue(items: CatalogueInput, changes: Change[]) {
    if (!Array.isArray(items)) {
      if (!this.store.replaceCatalogue) throw Error("storageUnavailable");
      await this.store.replaceCatalogue(items, changes);
      return;
    }
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw Error("invalidServer");
    const old = await this.itemKeys();
    await this.store.batch([
      ...old.map((key) => ({ key, value: null })),
      ...items.map((item) => ({ key: "item:" + item.id, value: item })),
      ...changes,
    ]);
  }
  async pair(shop: Shop, items: CatalogueInput) {
    return this.serial(async () => {
      if (await this.store.get("shop")) throw new Error("shopAlreadyPaired");
      if (!shop.id || !shop.branchId || !shop.snapshotVersion)
        throw new Error("invalidServer");
      await this.replaceCatalogue(items, [
        { key: "shop", value: shop },
        {
          key: "catalogue-updated-at",
          value: new Date(this.now()).toISOString(),
        },
        { key: "cart", value: this.newCart() },
      ]);
      this.catalogueCache = null;
    });
  }
  async leaveTraining() {
    return this.serial(async () => {
      const shop = await this.store.get<Shop>("shop");
      const sales = await this.store.list<Sale>("sale:");
      if (
        shop?.mode !== "training" ||
        sales.some((s) => !s.training) ||
        (await this.store.list<Outbox>("outbox:")).length
      )
        throw new Error("permissionDenied");
      const changes: Change[] = [
        "shop",
        "cart",
        "receipt-sequence",
        "catalogue-updated-at",
      ].map((key) => ({ key, value: null }));
      for (const key of await this.itemKeys())
        changes.push({ key, value: null });
      for (const prefix of ["sale:", "held:", "customer:", "print:"])
        for (const row of await this.store.list<{ id: string }>(prefix))
          changes.push({ key: prefix + row.id, value: null });
      await this.store.batch(changes);
      this.catalogueCache = null;
    });
  }
  async signOut() {
    return this.serial(async () => {
      if (
        (await this.store.list<DirectPrintJob>("print:")).some(
          printNeedsAttention,
        )
      )
        throw new Error("printCheckPaper");
      const sales = await this.store.list<Sale>("sale:");
      const cart = await this.store.get<Cart>("cart");
      if (
        (await this.store.list<Outbox>("outbox:")).length ||
        sales.some(
          (s) =>
            !s.training && (s.sync !== "synced" || s.tillPrint === "pending"),
        )
      )
        throw new Error("signOutPending");
      if (cart?.lines.length || (await this.store.list<Cart>("held:")).length)
        throw new Error("signOutCart");
      const shop = await this.store.get<Shop>("shop");
      const changes: Change[] = [
        "shop",
        "cart",
        "receipt-sequence",
        "catalogue-updated-at",
      ].map((key) => ({ key, value: null }));
      // Keep acknowledged receipts locally without exposing another cashier's history.
      for (const sale of sales)
        changes.push({
          key: `archive:${shop?.id}:${shop?.staffId}:${sale.id}`,
          value: sale,
        });
      for (const job of await this.store.list<DirectPrintJob>("print:")) {
        changes.push({
          key: `print-audit:${shop?.id}:${shop?.staffId}:${job.id}`,
          value: job,
        });
        changes.push({ key: "print:" + job.id, value: null });
      }
      for (const key of await this.itemKeys())
        changes.push({ key, value: null });
      for (const prefix of ["sale:", "held:", "customer:"])
        for (const row of await this.store.list<{ id: string }>(prefix))
          changes.push({ key: prefix + row.id, value: null });
      await this.store.batch(changes);
      this.catalogueCache = null;
    });
  }
  private async authorized(action: keyof Shop["permissions"]): Promise<Shop> {
    const shop = await this.store.get<Shop>("shop");
    if (!shop || shop.permissions[action] !== true)
      throw new Error("permissionDenied");
    if (
      Date.parse(shop.offlineUntil) <= this.now() ||
      !Number.isFinite(Date.parse(shop.offlineUntil))
    )
      throw new Error("grantExpired");
    return shop;
  }
  async suspendPermissions(expected: Shop) {
    return this.serial(async () => {
      const shop = await this.store.get<Shop>("shop");
      if (
        !shop ||
        shop.id !== expected.id ||
        shop.branchId !== expected.branchId ||
        shop.staffId !== expected.staffId ||
        shop.baseUrl !== expected.baseUrl
      )
        return;
      await this.store.batch([
        {
          key: "shop",
          value: {
            ...shop,
            permissions: Object.fromEntries(
              Object.keys(shop.permissions).map((key) => [key, false]),
            ),
          },
        },
      ]);
    });
  }
  async refreshCatalogue(shop: Shop, items: CatalogueInput) {
    return this.serial(async () => {
      const current = await this.store.get<Shop>("shop");
      if (
        !current ||
        current.mode !== "live" ||
        shop.mode !== "live" ||
        current.id !== shop.id ||
        current.branchId !== shop.branchId ||
        current.staffId !== shop.staffId ||
        current.baseUrl !== shop.baseUrl
      )
        throw new Error("invalidServer");
      // Activate all pages and the grant together. Paid/held snapshots stay untouched.
      await this.replaceCatalogue(items, [
        { key: "shop", value: shop },
        {
          key: "catalogue-updated-at",
          value: new Date(this.now()).toISOString(),
        },
      ]);
      this.catalogueCache = null;
    });
  }
  async addItem(item: Item, requestedQuantity?: number) {
    return this.serial(async () => {
      const shop = await this.authorized("sell");
      const current = await this.store.get<Item>("item:" + item.id);
      if (
        !current ||
        !current.active ||
        [
          "name",
          "price",
          "taxBps",
          "taxInclusive",
          "barcode",
          "quantityScale",
          "unit",
        ].some((key) => current[key as keyof Item] !== item[key as keyof Item])
      )
        throw new Error("catalogueChanged");
      if (current.requiresConfiguration) throw new Error("itemUnavailable");
      if (current.quantityScale === 1000 && requestedQuantity === undefined)
        throw Error("invalidQuantity");
      const quantity = requestedQuantity ?? 1;
      totals([{ ...item, quantity }]);
      const cart = (await this.store.get<Cart>("cart")) ?? this.newCart();
      const existing = cart.lines.find(
        (line) =>
          line.itemId === item.id &&
          line.price === item.price &&
          line.snapshotVersion === shop.snapshotVersion,
      );
      if (existing) {
        existing.quantity =
          Math.round((existing.quantity + quantity) * 1000) / 1000;
      } else
        cart.lines.push({
          snapshotVersion: shop.snapshotVersion,
          offlineUntil: shop.offlineUntil,
          id: this.uuid(),
          itemId: item.id,
          name: item.name,
          quantity,
          ...(item.quantityScale
            ? { quantityScale: item.quantityScale, unit: item.unit }
            : {}),
          price: item.price,
          taxBps: item.taxBps,
          taxInclusive: item.taxInclusive,
        });
      totals(cart.lines);
      await this.store.batch([{ key: "cart", value: cart }]);
    });
  }
  photoScope(shop: Shop) {
    return JSON.stringify([shop.mode, shop.id, shop.branchId, shop.staffId]);
  }
  async photoDraft(): Promise<PhotoDraft | null> {
    return this.serial(async () => {
      const shop = await this.authorized("sell");
      const changes: Change[] = [];
      for (const row of await this.store.list<PhotoDraft>("photo:"))
        if (!(Date.parse(row.createdAt) + 7 * 86400000 > this.now()))
          changes.push({ key: "photo:" + row.scope, value: null });
      if (changes.length) await this.store.batch(changes);
      return this.store.get<PhotoDraft>("photo:" + this.photoScope(shop));
    });
  }
  async savePhotoDraft(draft: PhotoDraft, expectedRevision: number | null) {
    return this.serial(async () => {
      const shop = await this.authorized("sell");
      if (draft.scope !== this.photoScope(shop))
        throw Error("permissionDenied");
      const key = "photo:" + draft.scope;
      const previous = await this.store.get<PhotoDraft>(key);
      if (
        previous &&
        Date.parse(previous.createdAt) + 7 * 86400000 > this.now() &&
        (previous.id !== draft.id ||
          previous.revision !== expectedRevision ||
          previous.imported)
      )
        throw Error("photoChanged");
      if (draft.image.length > 7000000 || draft.lines.length > 50)
        throw Error("photoInvalid");
      const next = { ...draft, revision: (expectedRevision ?? -1) + 1 };
      await this.store.batch([{ key, value: next }]);
      return next;
    });
  }
  async discardPhotoDraft(id: string) {
    return this.serial(async () => {
      const shop = await this.authorized("sell");
      const key = "photo:" + this.photoScope(shop);
      const draft = await this.store.get<PhotoDraft>(key);
      if (draft?.id !== id) throw Error("photoChanged");
      await this.store.batch([{ key, value: null }]);
    });
  }
  async matchPhotoProducts(text: string): Promise<Item[]> {
    await this.authorized("sell");
    const candidates: { item: Item; score: number }[] = [];
    // Search every local item in bounded pages, not only the visible catalogue page.
    let offset = 0;
    for (;;) {
      const page = await this.catalogue({ offset, limit: 256 });
      for (const item of page.items) {
        const score = photoScore(item, text);
        if (score > 0) candidates.push({ item, score });
      }
      candidates.sort(
        (a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name),
      );
      candidates.length = Math.min(candidates.length, 8);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    return candidates.map((c) => c.item);
  }
  async importPhotoDraft(id: string, revision: number) {
    return this.serial(async () => {
      const shop = await this.authorized("sell");
      const key = "photo:" + this.photoScope(shop);
      const draft = await this.store.get<PhotoDraft>(key);
      if (!draft || draft.id !== id) throw Error("photoChanged");
      if (draft.imported) return draft.imported;
      if (draft.revision !== revision || !photoReady(draft))
        throw Error("photoReviewRequired");
      if (Date.parse(draft.createdAt) + 7 * 86400000 <= this.now())
        throw Error("photoChanged");
      const cart = (await this.store.get<Cart>("cart")) ?? this.newCart();
      for (const row of draft.lines.filter((l) => !l.excluded)) {
        const item = await this.store.get<Item>("item:" + row.item!.id);
        if (
          !item ||
          !item.active ||
          item.requiresConfiguration ||
          [
            "name",
            "price",
            "taxBps",
            "taxInclusive",
            "quantityScale",
            "unit",
          ].some((k) => item[k as keyof Item] !== row.item![k as keyof Item])
        )
          throw Error("catalogueChanged");
        const line: Line = {
          id: this.uuid(),
          itemId: item.id,
          name: item.name,
          quantity: row.quantity!,
          quantityScale: item.quantityScale,
          unit: item.unit,
          price: item.price,
          taxBps: item.taxBps,
          taxInclusive: item.taxInclusive,
          snapshotVersion: shop.snapshotVersion,
          offlineUntil: shop.offlineUntil,
        };
        totals([line]);
        cart.lines.push(line);
      }
      totals(cart.lines);
      // One durable commit: crash/retry cannot import the same capture twice.
      await this.store.batch([
        { key: "cart", value: cart },
        {
          key,
          value: {
            ...draft,
            image: "",
            imported: cart.id,
            revision: draft.revision + 1,
          },
        },
      ]);
      return cart.id;
    });
  }
  async scanItem(input: string): Promise<Item> {
    const barcode = input.replace(/[\r\n]+$/, "");
    const { items } = await this.catalogue({ barcode, limit: 2 });
    return resolveProductScan(items, input);
  }
  async scanProduct(input: string): Promise<string> {
    const item = await this.scanItem(input);
    await this.addItem(item);
    return item.name;
  }
  async addQuick(price: number, name: string) {
    return this.serial(async () => {
      const shop = await this.authorized("quickSale");
      if (!shop.permissions.sell) throw new Error("permissionDenied");
      if (!Number.isSafeInteger(price) || price <= 0)
        throw new Error("invalidAmount");
      const cart = (await this.store.get<Cart>("cart")) ?? this.newCart();
      cart.lines.push({
        snapshotVersion: shop.snapshotVersion,
        offlineUntil: shop.offlineUntil,
        id: this.uuid(),
        name: name.trim() || "Quick sale",
        quantity: 1,
        price,
        taxBps: shop.quickTaxBps,
        taxInclusive: shop.quickTaxInclusive,
      });
      totals(cart.lines);
      await this.store.batch([{ key: "cart", value: cart }]);
    });
  }
  async quantity(lineId: string, delta: number) {
    return this.serial(async () => {
      await this.authorized("sell");
      if (!Number.isSafeInteger(delta)) throw new Error("invalidAmount");
      if (delta < 0) await this.authorized("voidLine");
      const cart = await this.store.get<Cart>("cart");
      if (!cart) return;
      const line = cart.lines.find((i) => i.id === lineId);
      if (!line) return;
      line.quantity = Math.round((line.quantity + delta) * 1000) / 1000;
      cart.lines = cart.lines.filter((i) => i.quantity > 0);
      totals(cart.lines);
      await this.store.batch([{ key: "cart", value: cart }]);
    });
  }
  async setQuantity(lineId: string, quantity: number) {
    return this.serial(async () => {
      await this.authorized("sell");
      const cart = await this.store.get<Cart>("cart");
      const line = cart?.lines.find((row) => row.id === lineId);
      if (!line || !cart) throw Error("notFound");
      if (quantity < line.quantity) await this.authorized("voidLine");
      line.quantity = quantity;
      totals(cart.lines);
      await this.store.batch([{ key: "cart", value: cart }]);
    });
  }
  async hold() {
    return this.serial(async () => {
      await this.authorized("sell");
      const cart = await this.store.get<Cart>("cart");
      if (!cart?.lines.length) throw new Error("emptyCart");
      await this.store.batch([
        { key: "held:" + cart.id, value: cart },
        { key: "cart", value: this.newCart() },
      ]);
    });
  }
  async resume(id: string) {
    return this.serial(async () => {
      await this.authorized("sell");
      const current = await this.store.get<Cart>("cart");
      if (current?.lines.length) throw new Error("cartNotEmpty");
      const held = await this.store.get<Cart>("held:" + id);
      if (!held) throw new Error("notFound");
      await this.store.batch([
        { key: "cart", value: held },
        { key: "held:" + id, value: null },
      ]);
    });
  }
  async customer(name: string, phone: string) {
    return this.serial(async () => {
      await this.authorized("customerWrite");
      if (!name.trim() && !phone.trim()) throw new Error("customerRequired");
      const customer: Customer = {
        id: this.uuid(),
        name: name.trim(),
        phone: phone.trim(),
      };
      const cart = (await this.store.get<Cart>("cart")) ?? this.newCart();
      cart.customer = customer;
      await this.store.batch([
        { key: "customer:" + customer.id, value: customer },
        { key: "cart", value: cart },
      ]);
    });
  }
  async createItem(item: Item) {
    return this.serial(async () => {
      const shop = await this.authorized("itemWrite");
      // Master writes require a server version-check contract. Training is isolated.
      if (shop.mode !== "training") throw new Error("serverRequired");
      const code = quickCode(item.code);
      if (code && (await this.queryCatalogue({ code, limit: 1 })).total)
        throw new Error("duplicateCode");
      if (
        !item.name.trim() ||
        !Number.isSafeInteger(item.price) ||
        item.price < 0
      )
        throw new Error("invalidAmount");
      await this.store.batch([
        {
          key: "item:" + item.id,
          value: { ...item, code, name: item.name.trim() },
        },
      ]);
      this.catalogueCache = null;
    });
  }
  async checkout(cartId: string, payment: Payment): Promise<Sale> {
    return this.serial(async () => {
      // A double-tap or retry after an ambiguous local response returns the same sale.
      const saved = await this.store.get<Sale>("sale:" + cartId);
      if (saved) return saved;
      const shop = await this.authorized("sell");
      if (shop.mode === "live" && !shop.capabilities.saleSync)
        throw new Error("serverUpgrade");
      const cart = await this.store.get<Cart>("cart");
      if (!cart?.lines.length || cart.id !== cartId)
        throw new Error("emptyCart");
      if (cart.lines.some((line) => !line.itemId))
        await this.authorized("quickSale");
      if (cart.customer) await this.authorized("customerWrite");
      if (
        cart.lines.some(
          (line) =>
            line.offlineUntil && Date.parse(line.offlineUntil) <= this.now(),
        )
      )
        throw new Error("grantExpired");
      const amount = totals(cart.lines);
      if (amount.total <= 0) throw new Error("invalidAmount");
      if (shop.paymentMethods && !shop.paymentMethods.includes(payment.method))
        throw new Error("unavailable");
      if (payment.method === "cash") {
        if (
          !Number.isSafeInteger(payment.received) ||
          payment.received < amount.total
        )
          throw new Error("insufficientCash");
        payment = {
          method: "cash",
          received: payment.received,
          change: payment.received - amount.total,
        };
      } else if (payment.method === "card") {
        if (
          !shop.paymentMethods?.includes("card") ||
          payment.status !== "staff-confirmed" ||
          (payment.reference && payment.reference.length > 100)
        )
          throw new Error("unavailable");
      } else {
        const accountId = payment.account.id;
        const account = shop.upiAccounts.find(
          (a) => a.id === accountId && a.active,
        );
        if (
          !shop.permissions.manualUpi ||
          !account ||
          account.verification !== "manual" ||
          account.vpa !== payment.account.vpa
        )
          throw new Error("upiUnavailable");
        payment = {
          ...payment,
          account: { ...account },
          status: "staff-confirmed",
        };
      }
      const sequence =
        ((await this.store.get<number>("receipt-sequence")) ?? 0) + 1;
      const sale: Sale = {
        snapshotVersion: shop.snapshotVersion,
        id: cart.id,
        shopId: shop.id,
        branchId: shop.branchId,
        staffId: shop.staffId,
        cart,
        ...amount,
        payment,
        createdAt: new Date(this.now()).toISOString(),
        currency: shop.currency,
        receipt: `${shop.mode === "training" ? "TRAIN" : "M"}-${cart.id.slice(0, 8)}-${sequence}`,
        training: shop.mode === "training",
        sync: shop.mode === "training" ? "synced" : "pending",
      };
      const printSettings = await this.store.get<Settings>("settings");
      if (
        !sale.training &&
        shop.permissions.receiptPrint === true &&
        printSettings?.autoPrint &&
        printSettings.printer === "till"
      )
        sale.tillPrint = "pending";
      const writes: Change[] = [
        { key: "sale:" + sale.id, value: sale },
        { key: "receipt-sequence", value: sequence },
        { key: "cart", value: this.newCart() },
      ];
      if (
        printSettings?.autoPrint &&
        printSettings.printer === "bluetooth" &&
        printSettings.directPrinter &&
        shop.permissions.receiptPrint
      ) {
        writes.push({
          key: "print:" + sale.id,
          value: {
            id: sale.id,
            saleId: sale.id,
            printer: printSettings.directPrinter,
            state: "queued",
            attempts: 0,
            updatedAt: sale.createdAt,
          } satisfies DirectPrintJob,
        });
      }
      if (!sale.training)
        writes.push({
          key: "outbox:" + sale.id,
          value: {
            id: sale.id,
            saleId: sale.id,
            authority: shop.baseUrl!,
            shopId: shop.id,
            branchId: shop.branchId,
            attempts: 0,
            nextAttemptAt: 0,
            state: "pending",
          } satisfies Outbox,
        });
      await this.store.batch(writes);
      return sale;
    });
  }
  async settings(settings: Settings) {
    return this.serial(() =>
      this.store.batch([{ key: "settings", value: settings }]),
    );
  }
  async directPrintJobs(): Promise<DirectPrintJob[]> {
    await this.tail;
    return this.store.list<DirectPrintJob>("print:");
  }
  async prepareDirectPrint(
    saleId: string,
    reprint = false,
  ): Promise<DirectPrintJob> {
    return this.serial(async () => {
      const shop = await this.authorized("receiptPrint");
      const sale = await this.store.get<Sale>("sale:" + saleId);
      const settings = await this.store.get<Settings>("settings");
      if (
        !sale ||
        sale.shopId !== shop.id ||
        sale.branchId !== shop.branchId ||
        sale.staffId !== shop.staffId ||
        !settings?.directPrinter ||
        sale.tillPrint
      )
        throw new Error("deviceUnavailable");
      const prior = await this.store.get<DirectPrintJob>("print:" + saleId);
      if (prior && !reprint && !["queued", "failed"].includes(prior.state))
        throw new Error("printCheckPaper");
      if (prior?.state === "sending") throw new Error("printCheckPaper");
      const job: DirectPrintJob = {
        id: saleId,
        saleId,
        printer: prior && !reprint ? prior.printer : settings.directPrinter,
        state: "sending",
        attempts: (prior?.attempts ?? 0) + 1,
        ...(!reprint &&
        !prior?.attempts &&
        !sale.training &&
        sale.payment.method === "cash" &&
        (prior?.printer ?? settings.directPrinter).cashDrawer !== undefined
          ? {
              drawerPulse: (prior?.printer ?? settings.directPrinter)
                .cashDrawer,
            }
          : {}),
        updatedAt: new Date(this.now()).toISOString(),
      };
      await this.store.batch([
        ...(prior
          ? [
              {
                key: `print-audit:${saleId}:${prior.attempts}:${this.uuid()}`,
                value: prior,
              },
            ]
          : []),
        { key: "print:" + saleId, value: job },
      ]);
      return job;
    });
  }
  async completeDirectPrint(
    saleId: string,
    state: "submitted" | "unknown" | "failed" | "confirmed",
  ) {
    return this.serial(async () => {
      const shop = await this.authorized("receiptPrint");
      const sale = await this.store.get<Sale>("sale:" + saleId);
      if (
        !sale ||
        sale.shopId !== shop.id ||
        sale.branchId !== shop.branchId ||
        sale.staffId !== shop.staffId
      )
        throw new Error("permissionDenied");
      const job = await this.store.get<DirectPrintJob>("print:" + saleId);
      if (!job) throw new Error("deviceUnavailable");
      await this.store.batch([
        {
          key: "print:" + saleId,
          value: {
            ...job,
            state,
            updatedAt: new Date(this.now()).toISOString(),
          },
        },
      ]);
    });
  }
  async recoverDirectPrints() {
    return this.serial(async () => {
      const jobs = await this.store.list<DirectPrintJob>("print:");
      await this.store.batch(
        jobs
          .filter((j) => j.state === "sending")
          .map((j) => ({
            key: "print:" + j.id,
            value: { ...j, state: "unknown" },
          })),
      );
    });
  }
  async pruneReceipts() {
    return this.serial(async () => {
      const shop = await this.store.get<Shop>("shop");
      if (!shop) return;
      const archived = (await this.store.list<Sale>("archive:")).filter(
        (sale) => sale.shopId === shop.id && sale.branchId === shop.branchId,
      );
      const ids = receiptsToPrune(
        [...(await this.store.list<Sale>("sale:")), ...archived],
        await this.store.list<Outbox>("outbox:"),
        await this.store.list<DirectPrintJob>("print:"),
        shop.historyPolicy,
        this.now(),
      );
      const removed = new Set(ids);
      await this.store.batch([
        ...ids.flatMap((id) => [
          { key: "sale:" + id, value: null },
          { key: "print:" + id, value: null },
        ]),
        ...archived
          .filter((sale) => removed.has(sale.id))
          .map((sale) => ({
            key: `archive:${sale.shopId}:${sale.staffId}:${sale.id}`,
            value: null,
          })),
      ]);
    });
  }
  async acknowledge(id: string, serverId: string) {
    return this.serial(async () => {
      const sale = await this.store.get<Sale>("sale:" + id);
      if (!sale) return;
      await this.store.batch([
        { key: "sale:" + id, value: { ...sale, sync: "synced", serverId } },
        { key: "outbox:" + id, value: null },
      ]);
    });
  }
  async queueTillPrint(id: string, queued = false) {
    return this.serial(async () => {
      if (!queued) await this.authorized("receiptPrint");
      const sale = await this.store.get<Sale>("sale:" + id);
      if (!sale || sale.training) throw new Error("deviceUnavailable");
      if (await this.store.get("print:" + id))
        throw new Error("printCheckPaper");
      if (sale.tillPrint === "queued" && !queued) return;
      await this.store.batch([
        {
          key: "sale:" + id,
          value: { ...sale, tillPrint: queued ? "queued" : "pending" },
        },
      ]);
    });
  }
  async confirmCloud(
    proofs: { id: string; serverId: string; receivedAt: string }[],
  ) {
    return this.serial(async () => {
      const shop = await this.store.get<Shop>("shop");
      const writes: Change[] = [];
      for (const proof of proofs) {
        const sale = await this.store.get<Sale>("sale:" + proof.id);
        if (
          !shop ||
          !sale ||
          sale.training ||
          sale.sync !== "synced" ||
          sale.shopId !== shop.id ||
          sale.branchId !== shop.branchId ||
          sale.staffId !== shop.staffId ||
          sale.serverId !== proof.serverId ||
          !Number.isFinite(Date.parse(proof.receivedAt))
        )
          throw Error("invalidServer");
        writes.push({
          key: "sale:" + sale.id,
          value: { ...sale, cloudReceivedAt: proof.receivedAt },
        });
      }
      await this.store.batch(writes);
    });
  }
  async retry(entry: Outbox, message: string, review = false) {
    return this.serial(async () => {
      const attempts = entry.attempts + 1;
      const changes: Change[] = [
        {
          key: "outbox:" + entry.id,
          value: {
            ...entry,
            attempts,
            error: message,
            state: review ? "review" : "pending",
            nextAttemptAt:
              this.now() + Math.min(300000, 1000 * 2 ** Math.min(attempts, 8)),
          },
        },
      ];
      if (review) {
        const sale = await this.store.get<Sale>("sale:" + entry.saleId);
        if (sale)
          changes.push({
            key: "sale:" + sale.id,
            value: { ...sale, sync: "review" },
          });
      }
      await this.store.batch(changes);
    });
  }
}
