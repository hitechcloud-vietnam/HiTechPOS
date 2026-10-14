import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Item, Shop } from "../domain/types";

export interface ImageFiles {
  get(key: string): Promise<string | null>;
  put(key: string, bytes: Uint8Array, mime: string): Promise<string>;
  prune?(keep: Set<string>): Promise<void>;
}
export const imageKey = (scope: string, url: string, revision = "") =>
  bytesToHex(sha256(utf8ToBytes(JSON.stringify([scope, url, revision]))));
export function productImageUrl(value: string, base: string): string | null {
  try {
    const url = new URL(
      value.startsWith("/uploads/") ? base.replace(/\/$/, "") + value : value,
      base + "/",
    );
    const origin = new URL(base);
    if (
      url.username ||
      url.password ||
      !["https:", "http:"].includes(url.protocol)
    )
      return null;
    if (url.protocol === "http:" && url.origin !== origin.origin) return null;
    return url.href;
  } catch {
    return null;
  }
}
const MAX_BYTES = 2 * 1024 * 1024;
export async function readImage(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  pairedBase?: string,
) {
  const options: RequestInit = {
    signal,
    credentials: "omit",
    redirect: "error",
  };
  let response = await fetcher(url, options);
  // Desktop serves uploads at its origin root; cloud proxies also serve the
  // API-prefixed route. Only retry a missing upload on the paired origin.
  if (response.status === 404 && pairedBase && !signal.aborted) {
    const source = new URL(url);
    const base = new URL(pairedBase);
    const prefix = base.pathname.replace(/\/$/, "");
    if (
      prefix.endsWith("/api") &&
      source.origin === base.origin &&
      source.pathname.startsWith(prefix + "/uploads/")
    ) {
      source.pathname = source.pathname.slice(prefix.length);
      await response.body?.cancel().catch(() => {});
      response = await fetcher(source.href, options);
    }
  }
  const mime =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  if (
    !response.ok ||
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ||
    Number(response.headers.get("content-length")) > MAX_BYTES
  )
    throw Error("invalidImage");
  const reader = response.body?.getReader();
  if (!reader) throw Error("invalidImage");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw Error("cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error("invalidImage");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!size) throw Error("invalidImage");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const starts = (...signature: number[]) =>
    signature.every((b, i) => bytes[i] === b);
  const valid =
    mime === "image/png"
      ? starts(137, 80, 78, 71, 13, 10, 26, 10)
      : mime === "image/jpeg"
        ? starts(255, 216, 255)
        : mime === "image/gif"
          ? starts(71, 73, 70, 56) &&
            [55, 57].includes(bytes[4]!) &&
            bytes[5] === 97
          : starts(82, 73, 70, 70) &&
            bytes.slice(8, 12).join(",") === "87,69,66,80";
  if (!valid) throw Error("invalidImage");
  return { bytes, mime };
}

/** Completed images survive restart; failed/partial files are never published. */
export async function cacheProductImages(
  items: Iterable<Item> | AsyncIterable<Item>,
  shop: Shop,
  files: ImageFiles,
  signal: AbortSignal,
  onImage: (id: string, uri: string) => void,
  fetcher: typeof fetch = fetch,
) {
  if (!shop.baseUrl || shop.mode !== "live") return;
  const scope = JSON.stringify([shop.baseUrl, shop.id, shop.branchId]);
  const keep = new Set<string>();
  const running = new Set<Promise<void>>();
  let inspected = 0;
  for await (const item of items) {
    if (++inspected % 64 === 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal.aborted) return;
    const url = item.image && productImageUrl(item.image, shop.baseUrl);
    if (!url) continue;
    const key = imageKey(scope, url, item.imageRevision);
    keep.add(key);
    const saved = await files.get(key).catch(() => null);
    if (saved) {
      onImage(item.id, saved);
      continue;
    }
    const task = (async () => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, 12000);
      try {
        if (signal.aborted) return;
        const { bytes, mime } = await readImage(
          url,
          controller.signal,
          fetcher,
          shop.baseUrl,
        );
        if (signal.aborted) return;
        const uri = await files.put(key, bytes, mime);
        if (!signal.aborted) onImage(item.id, uri);
      } catch {
        // Keep the configured icon; a later refresh retries missing images.
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
      }
    })();
    running.add(task);
    void task.finally(() => running.delete(task));
    if (running.size >= 2) await Promise.race(running);
  }
  await Promise.all(running);
  // Prune only after examining the complete active catalogue, never a visible page.
  if (!signal.aborted) await files.prune?.(keep).catch(() => {});
}
