import type { Repository } from "../data/repository";
import { ApiError, PosnicApi } from "./api";
import { ShopConnection } from "./routes";
import type { Shop } from "../domain/types";
/** Single flight and durable retries, with verified routes for the paired shop. */
export class SyncWorker {
  lastError: string | null = null;
  private flight: Promise<void> | null = null;
  private deliveryOffset = 0;
  constructor(
    private repository: Repository,
    private api: (
      url: string,
      shop: Shop,
    ) => Pick<PosnicApi, "upload"> & Partial<Pick<PosnicApi, "catalogue">> = (
      url,
      shop,
    ) => new ShopConnection(shop),
  ) {}
  run(force = false): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = this.drain(force).finally(() => {
      this.flight = null;
    });
    return this.flight;
  }
  private async drain(force: boolean) {
    this.lastError = null;
    const state = await this.repository.load();
    if (
      !state.shop ||
      state.shop.mode === "training" ||
      !state.shop.capabilities.saleSync
    )
      return;
    const client = this.api(state.shop.baseUrl!, state.shop);
    if (client.catalogue) {
      try {
        const snapshot = await client.catalogue();
        await this.repository.refreshCatalogue(snapshot.shop, snapshot.items);
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          await this.repository.suspendPermissions(state.shop);
          throw error;
        }
        if (
          !(error instanceof ApiError) ||
          (error.status !== 0 && error.status < 500)
        )
          throw error;
        // A transport failure must not revoke an unexpired offline grant.
        this.lastError =
          error instanceof Error ? error.message : "networkError";
      }
    }
    for (const entry of state.outbox) {
      if (
        entry.state === "review" ||
        (!force && entry.nextAttemptAt > Date.now())
      )
        continue;
      const sale = state.sales.find((s) => s.id === entry.saleId);
      if (
        !sale ||
        entry.authority !== state.shop.baseUrl ||
        entry.shopId !== state.shop.id ||
        entry.branchId !== state.shop.branchId
      ) {
        await this.repository.retry(entry, "invalidServer", true);
        continue;
      }
      try {
        const response = await client.upload(sale);
        await this.repository.acknowledge(sale.id, response.serverId);
      } catch (error) {
        const review =
          error instanceof ApiError &&
          [400, 403, 409, 422].includes(error.status);
        await this.repository.retry(
          entry,
          error instanceof Error ? error.message : "networkError",
          review,
        );
        this.lastError =
          error instanceof Error ? error.message : "networkError";
        if (!review) break;
      }
    }
    const updated = await this.repository.load();
    if (updated.shop?.capabilities.cloudDelivery) {
      const candidates = updated.sales.filter(
        (sale) =>
          !sale.training &&
          sale.sync === "synced" &&
          sale.serverId &&
          !sale.cloudReceivedAt,
      );
      const offset = this.deliveryOffset % Math.max(1, candidates.length);
      const waiting = [
        ...candidates.slice(offset),
        ...candidates.slice(0, offset),
      ].slice(0, 50);
      this.deliveryOffset =
        (offset + waiting.length) % Math.max(1, candidates.length);
      if (waiting.length)
        try {
          const proof = await new PosnicApi(updated.shop.baseUrl!).delivery(
            updated.shop,
            waiting,
          );
          await this.repository.confirmCloud(proof);
        } catch {
          // Delivery evidence is independent of sale acceptance. Never resubmit a
          // paid sale or erase an acknowledgment because this read is unavailable.
        }
    }
    for (const sale of updated.sales) {
      if (sale.tillPrint !== "pending" || sale.sync !== "synced") continue;
      try {
        await new PosnicApi(state.shop.baseUrl!).printReceipt(sale.id);
        await this.repository.queueTillPrint(sale.id, true);
      } catch (error) {
        this.lastError =
          error instanceof Error ? error.message : "networkError";
        break;
      }
    }
    await this.repository.pruneReceipts();
  }
}
