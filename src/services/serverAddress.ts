export function privateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  )
    return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
  );
}
function localHost(host: string): boolean {
  return (
    privateIpv4(host) ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    (!host.includes(".") && !host.includes(":"))
  );
}
export function serverAddress(raw: string): string {
  let value = raw.trim();
  if (!value || /\s/.test(value)) throw new Error("invalidServer");
  const explicit = /^https?:\/\//i.test(value);
  if (!explicit && /^[a-z0-9-]+$/i.test(value) && value !== "localhost")
    value = `https://${value.toLowerCase()}.posnic.io`;
  else if (!explicit) {
    if (value.includes("://")) throw new Error("invalidServer");
    const host = value.split("/")[0]!.split(":")[0]!;
    value = (localHost(host) ? "http://" : "https://") + value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalidServer");
  }
  if (
    url.username ||
    url.password ||
    !url.hostname ||
    !["https:", "http:"].includes(url.protocol) ||
    url.hash ||
    url.search
  )
    throw new Error("invalidServer");
  const local = localHost(url.hostname);
  if (!local) url.protocol = "https:";
  if (local && !explicit && !url.port) url.port = "5555";
  const path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(?:index\.html|login|pair)$/, "")
    .replace(/\/api$/, "");
  return url.origin + path + "/api";
}
export function parseShopQr(raw: string): string {
  return parseServerInput(raw).address;
}
/** Typed/pasted details and QR codes use exactly the same parser. */
export function parseServerInput(raw: string): {
  address: string;
  code?: string;
} {
  let value = raw.trim(),
    code: string | undefined;
  if (value.startsWith("{")) {
    let data;
    try {
      data = JSON.parse(value);
    } catch {
      throw new Error("invalidServer");
    }
    if (!data || typeof data.server !== "string")
      throw new Error("invalidServer");
    value = data.server;
    code = typeof data.code === "string" ? data.code : undefined;
  }
  try {
    const url = new URL(value);
    const carried =
      url.searchParams.get("server") || url.searchParams.get("shop");
    if (carried) {
      value = carried;
      code = url.searchParams.get("code") || code;
    }
  } catch {}
  return {
    address: serverAddress(value),
    ...(code ? { code: code.trim() } : {}),
  };
}
export function isLocalServer(address: string): boolean {
  try {
    return localHost(new URL(address).hostname);
  } catch {
    return false;
  }
}
