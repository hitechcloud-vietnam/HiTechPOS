/**
 * HiTechPOS Cloud origin for the owner app.
 *
 * This origin plays the role Posnic Cloud (https://www.posnic.com) plays
 * upstream: credential-free discovery that advertises
 * `business-cloud-pkce-v1`, the browser consent page and the PKCE exchange
 * that hands the phone over to the shop's own origin. HiTechPOS has not built
 * that service yet; docs/HITECHPOS_SERVER_CONTRACT.md lists exactly what the
 * app expects from it. Until then "Continue with HiTechPOS Cloud" reports the
 * server as unsupported, and owners can still connect to their shop origin
 * (https://<shop>.hitechpos.vn) directly or explore the sample business.
 *
 * Override at bundle time with EXPO_PUBLIC_HITECHPOS_CLOUD_ORIGIN (Expo inlines
 * EXPO_PUBLIC_* variables read with dot access).
 */
export const DEFAULT_CLOUD_ORIGIN = "https://app.hitechpos.vn";

export function cloudOrigin(value: string | undefined): string {
  if (!value) return DEFAULT_CLOUD_ORIGIN;
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "EXPO_PUBLIC_HITECHPOS_CLOUD_ORIGIN must be an https origin without a path",
    );
  return url.origin;
}

export const CLOUD_ORIGIN = cloudOrigin(
  process.env.EXPO_PUBLIC_HITECHPOS_CLOUD_ORIGIN,
);
