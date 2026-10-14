import type { Shop, Sale } from "../domain/types";
import { ApiError, PosnicApi } from "./api";
import { isLocalServer, serverAddress } from "./serverAddress";

export function shopRoutes(shop: Shop): string[] {
  const routes = [shop.baseUrl];
  // Only authenticated bootstrap metadata can introduce another authority.
  if (shop.connection?.idempotencyScope) {
    for (const [kind, raw] of Object.entries(shop.connection)) {
      if (kind === "idempotencyScope" || !raw) continue;
      const address = serverAddress(raw);
      if ((kind === "local") !== isLocalServer(address))
        throw new Error("invalidServer");
      routes.push(address);
    }
  }
  return [...new Set(routes.filter((url): url is string => !!url))].sort(
    (a, b) => Number(isLocalServer(b)) - Number(isLocalServer(a)),
  );
}

/** Alternate addresses must share tenant, staff and a server-declared dedupe ledger. */
export class ShopConnection {
  private selected?: string;
  constructor(
    private shop: Shop,
    private client: (url: string) => Pick<PosnicApi, "catalogue" | "upload"> = (
      url,
    ) => new PosnicApi(url),
  ) {}
  private async verify(url: string) {
    const snapshot = await this.client(url).catalogue();
    const actual = snapshot.shop;
    if (
      actual.id !== this.shop.id ||
      actual.branchId !== this.shop.branchId ||
      actual.staffId !== this.shop.staffId ||
      !actual.capabilities.saleSync ||
      (url !== this.shop.baseUrl &&
        (!this.shop.connection?.idempotencyScope ||
          actual.connection?.idempotencyScope !==
            this.shop.connection.idempotencyScope))
    ) {
      throw new ApiError("invalidServer", 409);
    }
    return { ...snapshot, shop: { ...actual, baseUrl: this.shop.baseUrl } };
  }
  private async attempt<T>(operation: (url: string) => Promise<T>): Promise<T> {
    let failure: unknown = new ApiError("networkError");
    const routes = shopRoutes(this.shop);
    if (this.selected)
      routes.sort(
        (a, b) => Number(b === this.selected) - Number(a === this.selected),
      );
    for (const url of routes) {
      try {
        const result = await operation(url);
        this.selected = url;
        return result;
      } catch (error) {
        failure = error;
        // A refusal is not a network outage. Never bypass permissions or conflicts.
        if (
          !(error instanceof ApiError) ||
          (error.status !== 0 && error.status < 500)
        )
          throw error;
      }
    }
    throw failure;
  }
  async upload(sale: Sale) {
    return this.attempt(async (url) => {
      if (url !== this.shop.baseUrl) await this.verify(url);
      return this.client(url).upload(sale);
    });
  }
  async catalogue() {
    return this.attempt((url) => this.verify(url));
  }
}
