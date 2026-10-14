import test from "node:test";
import assert from "node:assert/strict";
import { type BusinessContext } from "../src/domain/contracts";
import { sampleContext } from "../src/data/sample";
import { validatePreparedStock } from "../src/domain/preparedStock";
import { readBusinessStock } from "../src/services/businessStock";
import { ConnectionError } from "../src/services/businessConnection";
const base = sampleContext("manager");
const branchId = "a".repeat(24);
const context: BusinessContext = {
  ...base,
  capabilities: ["stock.read"],
  businessId: "b".repeat(24),
  branches: [{ ...base.branches[0]!, id: branchId }],
};
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "a".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
function fixture() {
  const at = new Date().toISOString();
  return {
    schemaVersion: 1,
    metricDefinitionVersion: "stored-stock-v1",
    businessId: context.businessId,
    branchId,
    observedFrom: at,
    preparedAt: at,
    coverage: {
      scannedItems: 3,
      excludedItems: 1,
      verifiedItems: 1,
      unavailableItems: 1,
      reasons: { stock_tracking_unknown: 1 },
    },
    lowItemCount: 1,
    listTruncated: false,
    lowItems: [
      {
        itemId: "c".repeat(24),
        name: "Rice",
        unit: "kg",
        availableMilli: -125,
        thresholdMilli: 0,
        thresholdSource: "item",
        low: true,
      },
    ],
    freshness: {
      state: "partial",
      sourceUpdatedAt: null,
      checkedAt: at,
      complete: false,
    },
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const discovery = {
  product: "posnic-business",
  apiVersion: 1,
  issuer: credential.origin,
  authorization: "business-pkce-v1",
  audience: "posnic-business",
  reporting: "bounded-summary-v2",
  stockReporting: "bounded-stock-v1",
};
test("stock negotiation uses a fixed scoped endpoint and works without financial permission", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(String(url));
    if (calls.length === 1) {
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      return json(discovery);
    }
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer " + credential.token,
    );
    assert.equal(init?.redirect, "error");
    return json(fixture());
  };
  const result = await readBusinessStock(
    credential,
    { ...context, capabilities: ["stock.read"] },
    branchId,
    { fetcher },
  );
  assert.deepEqual(calls, [
    credential.origin + "/api/business/v1/discovery?stock=1",
    credential.origin + "/api/business/v1/stock?branchId=" + branchId,
  ]);
  assert.equal(result.lowItems[0]!.availableMilli, -125);
  assert.equal(result.coverage.unavailableItems, 1);
  assert.equal(result.freshness.complete, false);
});
test("unsupported servers and removed stock access never receive an authenticated stock request", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    const old = { ...discovery, stockReporting: undefined };
    return json(old);
  };
  await assert.rejects(
    readBusinessStock(
      credential,
      { ...context, capabilities: ["overview.read"] },
      branchId,
      { fetcher },
    ),
    (e) => e instanceof ConnectionError && e.problem === "accessChanged",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    readBusinessStock(credential, context, "d".repeat(24), { fetcher }),
    (e) => e instanceof ConnectionError && e.problem === "accessChanged",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    readBusinessStock(credential, context, branchId, { fetcher }),
    (e) => e instanceof ConnectionError && e.problem === "unsupported",
  );
  assert.equal(calls, 1);
});
test("stock validation rejects hidden coverage gaps, extra fields, wrong scope and false freshness", () => {
  for (const change of [
    { businessId: "d".repeat(24) },
    { branchId: "d".repeat(24) },
    { extra: "unexpected" },
    { lowItemCount: 0 },
    { listTruncated: true },
    { coverage: { ...fixture().coverage, unavailableItems: 0 } },
    { coverage: { ...fixture().coverage, reasons: { future_reason: 1 } } },
    { lowItems: [{ ...fixture().lowItems[0], availableMilli: 1 }] },
    { lowItems: [{ ...fixture().lowItems[0], unit: "" }] },
    { lowItems: [{ ...fixture().lowItems[0], availableMilli: 0.5 }] },
    { freshness: { ...fixture().freshness, complete: true } },
    { freshness: { ...fixture().freshness, state: "current" } },
    { freshness: { ...fixture().freshness, state: "delayed" } },
    { observedFrom: "2000-01-01T00:00:00.000Z" },
  ])
    assert.throws(() =>
      validatePreparedStock({ ...fixture(), ...change }, context, branchId),
    );
});
test("empty and truncated stock observations remain incomplete and repeated identities cannot inflate a list", () => {
  const value = fixture();
  const empty = {
    ...value,
    lowItemCount: 0,
    lowItems: [],
    coverage: {
      scannedItems: 0,
      excludedItems: 0,
      verifiedItems: 0,
      unavailableItems: 0,
      reasons: {},
    },
  };
  assert.equal(
    validatePreparedStock(empty, context, branchId).freshness.complete,
    false,
  );
  const many = {
    ...value,
    lowItemCount: 105,
    listTruncated: true,
    coverage: {
      scannedItems: 105,
      excludedItems: 0,
      verifiedItems: 105,
      unavailableItems: 0,
      reasons: {},
    },
    lowItems: Array.from({ length: 100 }, (_, i) => ({
      ...value.lowItems[0]!,
      itemId: (i + 1).toString(16).padStart(24, "0"),
    })),
  };
  assert.equal(
    validatePreparedStock(many, context, branchId).lowItemCount,
    105,
  );
  many.lowItems[1]!.itemId = many.lowItems[0]!.itemId;
  assert.throws(() => validatePreparedStock(many, context, branchId));
});
test("stock service rejects corrupt responses and keeps server unavailability distinct from zero stock", async () => {
  for (const [status, payload, problem] of [
    [200, { ...fixture(), lowItemCount: 999 }, "invalidResponse"],
    [503, {}, "busy"],
    [403, {}, "accessChanged"],
  ] as const) {
    let calls = 0;
    const fetcher: typeof fetch = async () =>
      ++calls === 1 ? json(discovery) : json(payload, status);
    await assert.rejects(
      readBusinessStock(credential, context, branchId, { fetcher }),
      (e) => e instanceof ConnectionError && e.problem === problem,
    );
  }
});

test("stock freshness rejects expired responses and accepts only honestly labelled delayed observations", () => {
  const value = fixture();
  const now = Date.parse(value.preparedAt);
  const delayed = {
    ...value,
    observedFrom: new Date(now - 960000).toISOString(),
    preparedAt: new Date(now - 960000).toISOString(),
    freshness: { ...value.freshness, state: "delayed" },
  };
  assert.equal(
    validatePreparedStock(delayed, context, branchId, now).freshness.state,
    "delayed",
  );
  assert.throws(() =>
    validatePreparedStock(
      { ...delayed, freshness: { ...delayed.freshness, state: "partial" } },
      context,
      branchId,
      now,
    ),
  );
  assert.throws(() =>
    validatePreparedStock(value, context, branchId, now + 300001),
  );
  assert.throws(() =>
    validatePreparedStock(value, context, branchId, now - 300001),
  );
  assert.throws(() =>
    validatePreparedStock(
      {
        ...delayed,
        observedFrom: new Date(now - 90000000).toISOString(),
        preparedAt: new Date(now - 90000000).toISOString(),
      },
      context,
      branchId,
      now,
    ),
  );
});
