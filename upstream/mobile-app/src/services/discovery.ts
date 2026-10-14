import { privateIpv4 } from "./serverAddress";
export interface DiscoveredServer {
  address: string;
  edition: string;
  version: string;
  compatible: boolean;
}
export async function discoverServers(
  ip: string,
  signal: AbortSignal,
  onFound: (server: DiscoveredServer) => void,
  onProgress: (done: number, total: number) => void,
  fetcher: typeof fetch = fetch,
  ports = [5555, 5000, 80],
): Promise<void> {
  if (!privateIpv4(ip)) throw new Error("wifiRequired");
  const prefix = ip.split(".").slice(0, 3).join(".");
  const targets = Array.from(
    { length: 254 },
    (_, n) => `${prefix}.${n + 1}`,
  ).flatMap((host) => ports.map((port) => `http://${host}:${port}/api`));
  let index = 0,
    done = 0;
  await Promise.all(
    Array.from({ length: 24 }, async () => {
      while (index < targets.length && !signal.aborted) {
        const address = targets[index++]!;
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(abort, 800);
        try {
          const response = await fetcher(address + "/runtime-info", {
            signal: controller.signal,
            redirect: "error",
            headers: { Accept: "application/json" },
          });
          if (response.ok) {
            const data = await response.json();
            if (
              ["community", "cloud"].includes(data?.edition) &&
              typeof data?.apiSchema === "number" &&
              typeof data?.syncProtocol === "number" &&
              !signal.aborted
            )
              onFound({
                address,
                edition: data.edition,
                version: typeof data.version === "string" ? data.version : "",
                compatible: data.features?.mobilePosV1 === true,
              });
          }
        } catch {
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
          if (!signal.aborted) onProgress(++done, targets.length);
        }
      }
    }),
  );
}
