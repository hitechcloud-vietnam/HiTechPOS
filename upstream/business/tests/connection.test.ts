import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectionError,
  discoverBusinessServer,
  createReportingClient,
} from "../src/services/businessConnection";
import { sampleContext, sampleOverview } from "../src/data/sample";

const origin = "https://shop.example.com";
const metadata = {
  product: "posnic-business",
  apiVersion: 1,
  issuer: origin,
  authorization: "business-pkce-v1",
  audience: "posnic-business",
  reporting: "bounded-summary-v1",
};
const token = "pb1_" + "a".repeat(43);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const failure = (problem: string) => (error: unknown) =>
  error instanceof ConnectionError && error.problem === problem;

test("discovery is credential-free and bound to the selected issuer and Business protocol", async () => {
  const result = await discoverBusinessServer(origin, {
    fetcher: async (url, options) => {
      assert.equal(url, origin + "/api/business/v1/discovery");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      assert.deepEqual(options?.headers, { Accept: "application/json" });
      return json(metadata);
    },
  });
  assert.deepEqual(result, metadata);
  for (const change of [
    { issuer: "https://other.example.com" },
    { audience: "posnic-mobile" },
    { apiVersion: 2 },
    { tokenEndpoint: "https://other.example.com" },
  ]) {
    await assert.rejects(
      discoverBusinessServer(origin, {
        fetcher: async () => json({ ...metadata, ...change }),
      }),
      failure("unsupported"),
    );
  }
});

test("HTTP failures and malformed responses have safe actionable codes", async () => {
  for (const [status, code] of [
    [404, "unsupported"],
    [401, "signInRequired"],
    [403, "accessChanged"],
    [429, "busy"],
    [500, "unreachable"],
  ] as const) {
    await assert.rejects(
      discoverBusinessServer(origin, {
        fetcher: async () => json({ secret: "must not surface" }, status),
      }),
      failure(code),
    );
  }
  for (const response of [
    new Response("<html>Login</html>"),
    new Response("not json", {
      headers: { "content-type": "application/json" },
    }),
    json("x".repeat(256_001)),
  ]) {
    await assert.rejects(
      discoverBusinessServer(origin, { fetcher: async () => response }),
      failure("invalidResponse"),
    );
  }
  const redirected = json(metadata);
  Object.defineProperty(redirected, "redirected", { value: true });
  await assert.rejects(
    discoverBusinessServer(origin, { fetcher: async () => redirected }),
    failure("invalidResponse"),
  );
});
test("only transient transport failures allow last-known reporting data", async () => {
  for (const [status, transient] of [
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [429, true],
    [500, true],
    [502, true],
    [503, false],
  ] as const) {
    await assert.rejects(
      discoverBusinessServer(origin, { fetcher: async () => json({}, status) }),
      (error: unknown) =>
        error instanceof ConnectionError && error.transient === transient,
    );
  }
  await assert.rejects(
    discoverBusinessServer(origin, {
      fetcher: async () => {
        throw new TypeError("network unavailable");
      },
    }),
    (error: unknown) => error instanceof ConnectionError && error.transient,
  );
  await assert.rejects(
    discoverBusinessServer(origin, { fetcher: async () => json({}) }),
    (error: unknown) => error instanceof ConnectionError && !error.transient,
  );
});

test("cancelled requests do not start, and hung requests time out", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    discoverBusinessServer(origin, {
      signal: controller.signal,
      fetcher: async () => {
        assert.fail("No request after cancellation");
      },
    }),
    failure("cancelled"),
  );
  await assert.rejects(
    discoverBusinessServer(origin, {
      timeoutMs: 5,
      fetcher: async (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    }),
    failure("timeout"),
  );
});

test("reporting refuses POS credentials and unauthorized requests before network access", async () => {
  const fetcher: typeof fetch = async () => {
    assert.fail("Must not request data");
  };
  assert.throws(
    () => createReportingClient(origin, "eyJ.pos.jwt", { fetcher }),
    failure("signInRequired"),
  );
  const client = createReportingClient(origin, token, { fetcher });
  const context = sampleContext("manager");
  for (const ids of [
    [],
    ["foreign"],
    [context.branches[0]!.id, context.branches[0]!.id],
  ]) {
    await assert.rejects(
      client.overview(context, ids, "2026-09-28"),
      failure("accessChanged"),
    );
  }
  await assert.rejects(
    client.overview(
      sampleContext("stock"),
      [context.branches[0]!.id],
      "2026-09-28",
    ),
    failure("accessChanged"),
  );
  await assert.rejects(
    client.overview(context, [context.branches[0]!.id], "2026-02-30"),
    failure("invalidResponse"),
  );
});

test("scoped reporting verifies context, exact date, business and branches", async () => {
  const context = sampleContext("manager");
  const ids = context.branches.map((b) => b.id);
  const overview = sampleOverview(context, null, "current");
  const calls: string[] = [];
  const client = createReportingClient(origin, token, {
    fetcher: async (url, options) => {
      calls.push(String(url));
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        `Bearer ${token}`,
      );
      assert.equal(options?.credentials, "omit");
      return json(String(url).endsWith("/context") ? context : overview);
    },
  });
  assert.deepEqual(await client.context(), context);
  assert.deepEqual(await client.overview(context, ids, "2026-09-28"), overview);
  assert.equal(calls.length, 2);
  for (const change of [
    { businessDate: "2026-09-27" },
    { businessId: "other" },
    { branchIds: ["other"] },
  ]) {
    const bad = createReportingClient(origin, token, {
      fetcher: async () => json({ ...overview, ...change }),
    });
    await assert.rejects(
      bad.overview(context, ids, "2026-09-28"),
      failure("invalidResponse"),
    );
  }
  await assert.rejects(
    createReportingClient(origin, token, {
      fetcher: async () =>
        json({
          ...context,
          branches: [...context.branches, ...context.branches],
        }),
    }).context(),
    failure("invalidResponse"),
  );
});
