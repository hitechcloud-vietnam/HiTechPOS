import test from "node:test";
import assert from "node:assert/strict";
import { type BusinessContext } from "../src/domain/contracts";
import {
  readInbox,
  validateInbox,
  canReadInbox,
} from "../src/services/notifications";
import { validateStockAlert } from "../src/domain/stockAlert";
const branchId = "a".repeat(24),
  origin = "https://stock.example.com";
const context: BusinessContext = {
  accountId: "b".repeat(24),
  businessId: "c".repeat(24),
  businessName: "Stock only",
  capabilities: ["stock.read", "notifications.self.manage"],
  branches: [
    {
      id: branchId,
      name: "Central",
      currency: "INR",
      currencyDigits: 2,
      timezone: "Asia/Kolkata",
    },
  ],
};
const at = "2026-09-01T10:00:00.000Z";
const stock = {
  schemaVersion: 1,
  snapshotId: "a".repeat(64),
  observedFrom: at,
  preparedAt: at,
  sourceComplete: false,
  coverage: {
    scannedItems: 4,
    verifiedItems: 2,
    unavailableItems: 1,
    excludedItems: 1,
    reasons: { stock_threshold_unconfigured: 1 },
  },
  totalLowItemCount: 2,
  newLowItemCount: 1,
  listTruncated: false,
  items: [
    {
      itemId: "d".repeat(24),
      name: "Rice",
      unit: "kg",
      availableMilli: -1000,
      thresholdMilli: 2000,
      thresholdSource: "item",
      low: true,
    },
  ],
};
const entry = {
  id: "e".repeat(24),
  branchId,
  kind: "stock_low",
  businessDate: "2026-09-01",
  createdAt: at,
  read: false,
  summary: null,
  stock,
};
const credential = {
  origin,
  token: "pb1_" + "t".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const discovery = {
  product: "posnic-business",
  apiVersion: 1,
  issuer: origin,
  authorization: "business-pkce-v1",
  audience: "posnic-business",
  reporting: "bounded-summary-v2",
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

test("historical stock Inbox uses independent scope and retains explicit unknown coverage", () => {
  const result = validateInbox({ entries: [entry], next: null }, context);
  assert.deepEqual(result.entries[0], entry);
  assert.equal(canReadInbox(context), true);
  assert.equal(
    canReadInbox({ ...context, capabilities: ["approvals.read"] }),
    true,
  );
  assert.equal(canReadInbox({ ...context, branches: [] }), false);
  assert.equal(
    canReadInbox({ ...context, capabilities: ["notifications.self.manage"] }),
    false,
  );
  for (const value of [
    { ...entry, branchId: "f".repeat(24) },
    { ...entry, summary: {} },
    { ...entry, stockDigest: "private" },
    { ...entry, kind: "daily_unavailable", stock: undefined },
  ])
    assert.throws(() =>
      validateInbox({ entries: [value], next: null }, context),
    );
  assert.throws(() =>
    validateInbox(
      { entries: [entry], next: null },
      { ...context, capabilities: ["overview.read"] },
    ),
  );
});

test("stock alert validator rejects contradictory counts, unsafe facts, completeness and times", () => {
  for (const patch of [
    { sourceComplete: true },
    { newLowItemCount: 3 },
    { newLowItemCount: 0 },
    { totalLowItemCount: 3 },
    { listTruncated: true },
    { items: [] },
    { items: [{ ...stock.items[0], availableMilli: 3000 }] },
    {
      items: [
        { ...stock.items[0], availableMilli: Number.MAX_SAFE_INTEGER + 1 },
      ],
    },
    { items: [{ ...stock.items[0], low: false }] },
    { items: [{ ...stock.items[0], secret: "private" }] },
    { items: [stock.items[0], stock.items[0]], newLowItemCount: 2 },
    { coverage: { ...stock.coverage, verifiedItems: 3 } },
    { coverage: { ...stock.coverage, reasons: {} } },
    { observedFrom: "2026-09-01T10:00:01.000Z" },
    { observedFrom: "2026-09-01T09:59:00.000Z" },
    { preparedAt: "2099-01-01T00:00:00.000Z" },
    { extra: "private" },
  ])
    assert.throws(() => validateStockAlert({ ...stock, ...patch }, at));
  assert.throws(() => validateStockAlert(stock, "invalid"));
});

test("stock Inbox discovers capability before opting in, carries auth and follows an empty-page cursor", async () => {
  const cursor = "f".repeat(24),
    calls: string[] = [];
  const result = await readInbox(
    credential,
    context,
    {
      fetcher: async (url, init) => {
        calls.push(String(url));
        if (String(url).includes("discovery")) {
          assert.equal(new Headers(init?.headers).has("authorization"), false);
          return json({ ...discovery, stockAlerts: "inbox-stock-v1" });
        }
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer " + credential.token,
        );
        return json({ entries: [], next: cursor });
      },
    },
    cursor,
  );
  assert.equal(calls[0], origin + "/api/business/v1/discovery?stockAlerts=1");
  assert.equal(
    calls[1],
    origin +
      "/api/business/v1/inbox?stockAlerts=1&registerSessions=1&before=" +
      cursor,
  );
  assert.equal(result.next, cursor);
});

test("legacy servers remain usable but unnegotiated stock and oversized pages are rejected", async () => {
  for (const supported of [false, true]) {
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("discovery"))
        return json({
          ...discovery,
          ...(supported ? { stockAlerts: "inbox-stock-v1" } : {}),
        });
      const address = new URL(String(url));
      assert.equal(address.searchParams.has("stockAlerts"), supported);
      return json({
        entries: supported
          ? Array.from({ length: 11 }, (_, index) => ({
              ...entry,
              id: index.toString(16).padStart(24, "0"),
            }))
          : [entry],
        next: null,
      });
    };
    await assert.rejects(readInbox(credential, context, { fetcher }), {
      problem: "invalidResponse",
    });
  }
  const result = await readInbox(credential, context, {
    fetcher: async (url) =>
      json(
        String(url).includes("discovery")
          ? discovery
          : { entries: [], next: null },
      ),
  });
  assert.equal(result.entries.length, 0);
  await assert.rejects(
    readInbox(
      credential,
      { ...context, capabilities: [] },
      {
        fetcher: async () => {
          throw new Error("must not fetch");
        },
      },
    ),
    { problem: "accessChanged" },
  );
});

test("Inbox rejects invalid credentials before networking and lost stock scope after discovery", async () => {
  const blocked = async () => {
    throw new Error("must not fetch");
  };
  for (const changed of [
    { ...credential, token: "pos-jwt" },
    { ...credential, origin: "http://unsafe.example.com" },
    { ...credential, expiresAt: "2020-01-01T00:00:00.000Z" },
  ])
    await assert.rejects(readInbox(changed, context, { fetcher: blocked }), {
      problem: "signInRequired",
    });
  const mutable: BusinessContext = {
    ...context,
    capabilities: [...context.capabilities],
  };
  let calls = 0;
  await assert.rejects(
    readInbox(credential, mutable, {
      fetcher: async () => {
        calls++;
        mutable.capabilities = ["overview.read"];
        return json({ ...discovery, stockAlerts: "inbox-stock-v1" });
      },
    }),
    { problem: "accessChanged" },
  );
  assert.equal(calls, 1);
});
