import * as Crypto from "expo-crypto";
import { z } from "zod";
import { credentials } from "../platform/credentials";
import { foreground } from "../platform/foreground";
import { automaticAuthReturn } from "../platform/authBrowser";
import { cloudGrant } from "./cloudGrant";

export const ACCOUNT_ORIGIN = "https://www.posnic.com";
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function base64url(bytes: Uint8Array): string {
  let value = 0,
    bits = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet[(value >>> bits) & 63];
    }
  }
  if (bits) result += alphabet[(value << (6 - bits)) & 63];
  return result;
}
export async function authorizeAccount(
  intent: "login" | "signup",
  openBrowser: (url: string, matchCode: string) => Promise<void>,
  signal: AbortSignal,
) {
  const verifier = base64url(await Crypto.getRandomBytesAsync(32));
  const codeChallenge = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    )
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  async function post(path: string, body: unknown) {
    if (signal.aborted) throw new Error("authorizationCancelled");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 15000);
    try {
      const response = await fetch(ACCOUNT_ORIGIN + "/api/mobile/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      if (response.status === 404) throw new Error("accountServiceUnavailable");
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error === "access_denied"
            ? "authorizationCancelled"
            : "authorizationExpired",
        );
      return data;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  const request = z
    .object({
      request: z.string().regex(/^[\w-]{43}$/),
      authorizationUrl: z.string().url(),
      expiresIn: z.number().positive().max(900),
    })
    .parse(
      await post("requests", {
        codeChallenge,
        deviceId: await credentials.deviceId(),
        deviceName: "Posnic Mobile POS",
        intent,
        returnToApp: automaticAuthReturn,
      }),
    );
  const url = new URL(request.authorizationUrl);
  if (url.origin !== ACCOUNT_ORIGIN || url.pathname !== "/api/mobile/authorize")
    throw new Error("invalidServer");
  const expires = Date.now() + request.expiresIn * 1000;
  let browserClosed = false;
  try {
    await openBrowser(url.href, request.request.slice(-6).toUpperCase());
  } catch (error) {
    // Android may report dismissal when the user returns manually after approval.
    // Only the PKCE-bound exchange can establish whether approval actually happened.
    if (
      signal.aborted ||
      !(error instanceof Error) ||
      error.message !== "authorizationCancelled"
    )
      throw error;
    browserClosed = true;
  }
  let firstPoll = true;
  while (Date.now() < expires && !signal.aborted) {
    if (!firstPoll)
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, 5000);
        signal.addEventListener("abort", finish, { once: true });
      });
    firstPoll = false;
    await foreground(signal);
    if (Date.now() >= expires) break;
    const data = await post("token", {
      request: request.request,
      codeVerifier: verifier,
    });
    if (data.error === "authorization_pending") {
      if (browserClosed) throw Error("authorizationCancelled");
      continue;
    }
    const grant = cloudGrant(data);
    return { ...grant, verifier };
  }
  throw new Error(
    signal.aborted ? "authorizationCancelled" : "authorizationExpired",
  );
}
