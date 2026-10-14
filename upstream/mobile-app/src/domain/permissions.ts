import type { Shop } from "./types";

export function requirePermission(
  shop: Shop,
  action: keyof Shop["permissions"],
  now = Date.now(),
): void {
  if (shop.permissions[action] !== true) throw new Error("permissionDenied");
  const until = Date.parse(shop.offlineUntil);
  if (!Number.isFinite(until) || until <= now) throw new Error("grantExpired");
}
