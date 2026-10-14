/**
 * HiTechPOS cloud endpoints, in one place.
 *
 * Defaults are production. A build for another environment sets
 *   EXPO_PUBLIC_HITECHPOS_CLOUD_SUFFIX=.staging.hitechpos.vn
 *   EXPO_PUBLIC_HITECHPOS_ACCOUNT_ORIGIN=https://app.staging.hitechpos.vn
 * which Expo inlines at bundle time (EXPO_PUBLIC_* only, read with dot access).
 */
export const DEFAULT_CLOUD_SUFFIX = ".hitechpos.vn";
export const DEFAULT_ACCOUNT_ORIGIN = "https://app.hitechpos.vn";

export function cloudSuffix(value: string | undefined): string {
  if (!value) return DEFAULT_CLOUD_SUFFIX;
  const text = value.trim().toLowerCase();
  if (
    !/^(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(text) ||
    !text.slice(1).includes(".")
  )
    throw new Error(
      "EXPO_PUBLIC_HITECHPOS_CLOUD_SUFFIX must look like .hitechpos.vn",
    );
  return text;
}
export function accountOrigin(value: string | undefined): string {
  if (!value) return DEFAULT_ACCOUNT_ORIGIN;
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "EXPO_PUBLIC_HITECHPOS_ACCOUNT_ORIGIN must be an https origin",
    );
  return url.origin;
}

/** A bare shop code `demo` becomes `https://demo` + CLOUD_SUFFIX. */
export const CLOUD_SUFFIX = cloudSuffix(
  process.env.EXPO_PUBLIC_HITECHPOS_CLOUD_SUFFIX,
);
/** Account service that approves a phone in the browser (/api/mobile/*). */
export const ACCOUNT_ORIGIN = accountOrigin(
  process.env.EXPO_PUBLIC_HITECHPOS_ACCOUNT_ORIGIN,
);
