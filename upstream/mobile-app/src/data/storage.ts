import type { CatalogueQuery, CatalogueResult } from "./catalogueQuery";
export interface Change {
  key: string;
  value: unknown | null;
}
export interface CatalogueSnapshot {
  pages: string[];
  count: number;
}
export type CatalogueInput =
  import("../domain/types").Item[] | CatalogueSnapshot;
export interface Storage {
  replaceCatalogue?(
    snapshot: CatalogueSnapshot,
    changes: Change[],
  ): Promise<void>;
  catalogue?(query: CatalogueQuery): Promise<CatalogueResult>;
  get<T>(key: string): Promise<T | null>;
  list<T>(prefix: string): Promise<T[]>;
  /** Enumerate cache keys without decoding their potentially large payloads. */
  keys?(prefix: string): Promise<string[]>;
  batch(changes: Change[]): Promise<void>;
}
