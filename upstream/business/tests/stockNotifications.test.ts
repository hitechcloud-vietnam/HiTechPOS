import test from "node:test";
import assert from "node:assert/strict";
import { sampleContext } from "../src/data/sample";
import { type BusinessContext } from "../src/domain/contracts";
import {
  readStockPreference,
  saveStockPreference,
  type StockPreference,
} from "../src/services/stockNotifications";
import { readJson } from "../src/services/businessConnection";
const origin = "https://shop.example.com",
  branchId = "a".repeat(24);
const credential = {
  origin,
  token: "pb1_" + "t".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const context: BusinessContext = {
  ...sampleContext("manager"),
  capabilities: ["stock.read", "notifications.self.manage"],
  branches: [
    {
      ...sampleContext("manager").branches[0]!,
      id: branchId,
      timezone: "Asia/Kolkata",
    },
  ],
};
const preference: StockPreference = {
  branchId,
  timezone: "Asia/Kolkata",
  revision: 0,
  enabled: false,
  minimumIntervalMinutes: 60,
  quiet: { enabled: false, start: "22:00", end: "07:00" },
};
const discovery = {
  product: "posnic-business",
  apiVersion: 1,
  issuer: origin,
  audience: "posnic-business",
  authorization: "business-pkce-v1",
  reporting: "bounded-summary-v2",
  stockAlertPreferences: "stock-alert-preferences-v1",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

test("stock preferences negotiate without credentials and read only the fixed scoped endpoint", async () => {
  const paths: string[] = [];
  const result = await readStockPreference(credential, context, branchId, {
    fetcher: async (url, options) => {
      paths.push(String(url));
      if (String(url).includes("discovery")) {
        assert.equal(
          (options!.headers as Record<string, string>).Authorization,
          undefined,
        );
        return json(discovery);
      }
      assert.equal(
        (options!.headers as Record<string, string>).Authorization,
        "Bearer " + credential.token,
      );
      assert.equal(options!.redirect, "error");
      return json(preference);
    },
  });
  assert.deepEqual(result, preference);
  assert.deepEqual(paths, [
    origin + "/api/business/v1/discovery?stockAlertPreferences=1",
    origin + "/api/business/v1/notifications/stock/" + branchId,
  ]);
});
test("unsupported servers receive neither authenticated preference reads nor writes", async () => {
  for (const save of [false, true]) {
    let calls = 0;
    const options = {
      fetcher: async () => {
        calls++;
        const { stockAlertPreferences: _cap, ...old } = discovery;
        return json(old);
      },
    };
    await assert.rejects(
      save
        ? saveStockPreference(credential, context, preference, options)
        : readStockPreference(credential, context, branchId, options),
      { problem: "unsupported" },
    );
    assert.equal(calls, 1);
  }
});
test("scope loss and invalid credentials prevent networking, including permission changes during discovery", async () => {
  const noFetch = async () => {
    throw new Error("unexpected_fetch");
  };
  for (const changed of [
    { ...context, branches: [] },
    { ...context, capabilities: ["stock.read"] },
    { ...context, capabilities: ["notifications.self.manage"] },
  ] satisfies BusinessContext[]) {
    await assert.rejects(
      readStockPreference(credential, changed, branchId, { fetcher: noFetch }),
      { problem: "accessChanged" },
    );
  }
  for (const changed of [
    { ...credential, token: "pos-token" },
    { ...credential, expiresAt: "2020-01-01T00:00:00.000Z" },
    { ...credential, origin: "http://shop.example.com" },
  ])
    await assert.rejects(
      readStockPreference(changed, context, branchId, { fetcher: noFetch }),
      { problem: "signInRequired" },
    );
  const changed = structuredClone(context);
  let calls = 0;
  await assert.rejects(
    readStockPreference(credential, changed, branchId, {
      fetcher: async () => {
        calls++;
        changed.capabilities = [];
        return json(discovery);
      },
    }),
    { problem: "accessChanged" },
  );
  assert.equal(calls, 1);
});
test("malformed, foreign-branch or unsupported-frequency settings are rejected", async () => {
  for (const changes of [
    { branchId: "b".repeat(24) },
    { timezone: "UTC" },
    { minimumIntervalMinutes: 1 },
    { minimumIntervalMinutes: "60" },
    { revision: -1 },
    { secret: "unexpected" },
    { quiet: { enabled: true, start: "07:00", end: "07:00" } },
    { quiet: { enabled: false, start: "25:00", end: "07:00" } },
  ]) {
    await assert.rejects(
      readStockPreference(credential, context, branchId, {
        fetcher: async (url) =>
          json(
            String(url).includes("discovery")
              ? discovery
              : { ...preference, ...changes },
          ),
      }),
      { problem: "invalidResponse" },
    );
  }
});
test("stock setting saves send only revision and selected controls and require exact confirmation", async () => {
  const input: StockPreference = {
    ...preference,
    enabled: true,
    minimumIntervalMinutes: 30,
  };
  const requestBodies: unknown[] = [];
  const result = await saveStockPreference(credential, context, input, {
    fetcher: async (url, options) => {
      if (String(url).includes("discovery")) return json(discovery);
      assert.equal(options!.method, "POST");
      requestBodies.push(JSON.parse(options!.body as string));
      return json({ ...input, revision: 1 });
    },
  });
  assert.equal(result.revision, 1);
  assert.deepEqual(requestBodies, [
    {
      expectedRevision: 0,
      enabled: true,
      minimumIntervalMinutes: 30,
      quiet: input.quiet,
    },
  ]);
  for (const change of [
    { revision: 0 },
    { enabled: false },
    { minimumIntervalMinutes: 60 },
    { quiet: { ...input.quiet, enabled: true } },
  ])
    await assert.rejects(
      saveStockPreference(credential, context, input, {
        fetcher: async (url) =>
          json(
            String(url).includes("discovery")
              ? discovery
              : { ...input, revision: 1, ...change },
          ),
      }),
      { problem: "invalidResponse" },
    );
});
test("HTTP conflicts cannot masquerade as saved settings and explicitly accepted decision errors keep their contract", async () => {
  await assert.rejects(
    saveStockPreference(credential, context, preference, {
      fetcher: async (url) =>
        String(url).includes("discovery")
          ? json(discovery)
          : json({ ...preference, revision: 1 }, 409),
    }),
    { problem: "conflict", transient: false },
  );
  const error = { error: { code: "preference_changed" } };
  await assert.rejects(
    saveStockPreference(credential, context, preference, {
      fetcher: async (url) =>
        String(url).includes("discovery") ? json(discovery) : json(error, 409),
    }),
    { problem: "conflict" },
  );
  assert.deepEqual(
    await readJson(
      origin,
      "/decisions/test",
      { fetcher: async () => json({ state: "already_decided" }, 409) },
      credential.token,
      { method: "POST", body: {}, acceptErrorStatuses: [409] },
    ),
    { state: "already_decided" },
  );
});
test("foreign discovery issuers and cancelled requests cannot send a stock preference token", async () => {
  let calls = 0;
  await assert.rejects(
    readStockPreference(credential, context, branchId, {
      fetcher: async () => {
        calls++;
        return json({ ...discovery, issuer: "https://other.example.com" });
      },
    }),
    { problem: "unsupported" },
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readStockPreference(credential, context, branchId, {
      signal: controller.signal,
      fetcher: async () => {
        throw new Error("unexpected_fetch");
      },
    }),
    { problem: "cancelled" },
  );
});
