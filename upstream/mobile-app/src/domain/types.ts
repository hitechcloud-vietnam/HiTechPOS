export type Locale =
  | "en"
  | "ta"
  | "hi"
  | "ml"
  | "kn"
  | "te"
  | "si"
  | "ne"
  | "ar"
  | "fr"
  | "es"
  | "pt"
  | "id"
  | "th"
  | "de"
  | "sw"
  | "nl"
  | "it";
export interface Item {
  id: string;
  name: string;
  price: number;
  code: string;
  barcode?: string;
  category: string;
  visual: string;
  image?: string;
  imageRevision?: string;
  shape?: "circle" | "square" | "diamond";
  taxBps: number;
  taxInclusive: boolean;
  active: boolean;
  requiresConfiguration?: boolean;
  quantityScale?: 1000;
  unit?: string;
}
export interface Line {
  id: string;
  snapshotVersion?: string;
  offlineUntil?: string;
  itemId?: string;
  name: string;
  quantity: number;
  quantityScale?: 1000;
  unit?: string;
  price: number;
  taxBps: number;
  taxInclusive: boolean;
}
export interface Customer {
  id: string;
  name: string;
  phone: string;
}
export interface Cart {
  id: string;
  lines: Line[];
  customer?: Customer;
  createdAt: string;
}
export interface UpiAccount {
  id: string;
  name: string;
  vpa: string;
  active: boolean;
  verification: "manual" | "provider";
}
export interface Shop {
  id: string;
  branchId: string;
  name: string;
  branchName: string;
  currency: string;
  staffId: string;
  staffName: string;
  mode: "training" | "live";
  baseUrl?: string;
  /** Server-authenticated routes sharing credentials and a deduplication ledger. */
  connection?: { idempotencyScope: string; local?: string; remote?: string };
  snapshotVersion: string;
  offlineUntil: string;
  historyPolicy?: { days: number; maxReceipts: number };
  quickTaxBps: number;
  quickTaxInclusive: boolean;
  permissions: {
    inventoryWrite?: boolean;
    supplierRead?: boolean;
    sell: boolean;
    quickSale: boolean;
    customerWrite: boolean;
    itemWrite: boolean;
    priceOverride: boolean;
    manualUpi: boolean;
    voidLine?: boolean;
    receiptPrint?: boolean;
  };
  paymentMethods?: ("cash" | "card" | "upi")[];
  upiAccounts: UpiAccount[];
  defaultUpiAccountId?: string;
  capabilities: {
    inventory?: boolean;
    saleSync: boolean;
    devicePairing: boolean;
    tillPrint: boolean;
    printStatus?: boolean;
    cloudDelivery?: boolean;
    terminal: boolean;
  };
}
export type Payment =
  | { method: "card"; status: "staff-confirmed"; reference?: string }
  | { method: "cash"; received: number; change: number }
  | {
      method: "upi";
      account: UpiAccount;
      status: "staff-confirmed";
      reference: string;
    };
export interface Sale {
  id: string;
  snapshotVersion?: string;
  tillPrint?: "pending" | "queued";
  shopId: string;
  branchId: string;
  staffId: string;
  cart: Cart;
  total: number;
  tax: number;
  payment: Payment;
  createdAt: string;
  currency: string;
  receipt: string;
  training: boolean;
  sync: "pending" | "synced" | "review";
  serverId?: string;
  cloudReceivedAt?: string;
}
export interface Outbox {
  id: string;
  saleId: string;
  authority: string;
  shopId: string;
  branchId: string;
  attempts: number;
  nextAttemptAt: number;
  error?: string;
  state: "pending" | "review";
}
export interface Settings {
  locale: Locale;
  printer: "system" | "till" | "bluetooth";
  directPrinter?: {
    address: string;
    name: string;
    width: 384 | 576;
    /** ESC/POS connector selection: 0 = pin 2, 1 = pin 5. Disabled by default. */
    cashDrawer?: 0 | 1;
  };
  autoPrint: boolean;
}
export interface DirectPrintJob {
  id: string;
  saleId: string;
  printer: NonNullable<Settings["directPrinter"]>;
  state:
    "queued" | "sending" | "submitted" | "unknown" | "failed" | "confirmed";
  attempts: number;
  /** Only the initial cash receipt may pulse the attached drawer. */
  drawerPulse?: 0 | 1;
  updatedAt: string;
}
export interface SessionData {
  favourites?: string[];
  catalogue: { count: number; imageCount: number; categories: string[] };
  catalogueUpdatedAt?: string;
  shop: Shop | null;
  items: Item[];
  cart: Cart;
  held: Cart[];
  sales: Sale[];
  outbox: Outbox[];
  settings: Settings;
  customers: Customer[];
}
