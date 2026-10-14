import type { Shop } from "./types";

export type DeviceAdapter = "camera" | "hid" | "system-print" | "till-print";
export interface DeviceOption {
  id: DeviceAdapter;
  label: string;
  enabled: boolean;
}
export const receiptJobMessage = {
  queued: "printWaiting",
  printing: "printWorking",
  needs_attention: "review",
  done: "printReportedDone",
  failed: "review",
  not_found: "unknownPrint",
} as const;

/** Advertises available workflows, not discovered or physically online hardware. */
export function deviceOptions(shop: Shop, now = Date.now()): DeviceOption[] {
  const valid =
    Number.isFinite(Date.parse(shop.offlineUntil)) &&
    Date.parse(shop.offlineUntil) > now;
  const scan = valid && shop.permissions.sell === true;
  const print = valid && shop.permissions.receiptPrint === true;
  return [
    { id: "camera", label: "scan", enabled: scan },
    { id: "hid", label: "externalScanner", enabled: scan },
    { id: "system-print", label: "systemPrinter", enabled: print },
    {
      id: "till-print",
      label: "tillPrinter",
      enabled: print && shop.mode === "live" && shop.capabilities.tillPrint,
    },
  ];
}
