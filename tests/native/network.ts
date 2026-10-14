import { sampleContext } from "../../src/data/sample";
export const account = {
  ...sampleContext("manager"),
  businessName: "PIN test business",
  capabilities: [],
};
// No credentials or production traffic: installed only in the isolated QA build.
export const businessFetch: typeof fetch = async (input) => {
  const url = String(input);
  const body = url.endsWith("/context")
    ? account
    : url.endsWith("/session")
      ? { revoked: true }
      : { error: { code: "unavailable" } };
  // React Native's global Response has no streaming body. Match expo/fetch's
  // actual Response contract, which readJson intentionally requires.
  const status =
    url.endsWith("/context") || url.endsWith("/session") ? 200 : 503;
  return {
    url,
    redirected: false,
    status,
    ok: status === 200,
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return {
              done: false,
              value: new TextEncoder().encode(JSON.stringify(body)),
            };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  } as unknown as Response;
};
