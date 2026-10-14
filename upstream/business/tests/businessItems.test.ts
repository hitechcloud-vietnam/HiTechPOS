import test from "node:test";
import assert from "node:assert/strict";
import { sampleContext } from "../src/data/sample";
import { validatePreparedItems } from "../src/domain/preparedItems";
import { readBusinessItems } from "../src/services/businessItems";
import { ConnectionError } from "../src/services/businessConnection";
const context = sampleContext("manager"),
  branchId = context.branches[0]!.id;
const day = "2026-09-29";
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "a".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
function fixture() {
  return {
    schemaVersion: 2,
    metricDefinitionVersion: 2,
    businessId: context.businessId,
    branchIds: [branchId],
    businessDate: day,
    currency: "INR",
    currencyDigits: 2,
    billedSalesMinor: 100,
    refundsMinor: 200,
    salesAfterReturnsMinor: -100,
    completedSales: 1,
    preparedAt: "2026-09-29T00:00:00.000Z",
    freshness: {
      state: "partial",
      sourceUpdatedAt: null,
      checkedAt: "2026-09-29T00:00:00.000Z",
      complete: false,
    },
    itemInsights: {
      schemaVersion: 1,
      state: "available",
      reason: null,
      sourceSales: 2,
      unavailableSales: 0,
      totalItems: 1,
      truncated: false,
      items: [
        {
          itemId: "a".repeat(24),
          name: "Tea",
          billedSalesMinor: 100,
          refundsMinor: 200,
          salesAfterReturnsMinor: -100,
          quantities: [{ unit: "cup", soldMilli: 1000, returnedMilli: 2000 }],
        },
      ],
    },
  };
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
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
  itemReporting: "bounded-items-v1",
};
test("item reads negotiate support and send credentials only to the fixed authorized endpoint", async () => {
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
  const result = await readBusinessItems(credential, context, branchId, day, {
    fetcher,
  });
  assert.equal(result.itemInsights.items[0]!.salesAfterReturnsMinor, -100);
  assert.equal(
    calls[0],
    credential.origin + "/api/business/v1/discovery?items=1",
  );
  assert.equal(new URL(calls[1]!).pathname, "/api/business/v1/items");
  assert.equal(new URL(calls[1]!).searchParams.get("branchId"), branchId);
});
test("incomplete history stays distinct from an available empty day", () => {
  const value = fixture();
  const incomplete = {
    ...value,
    itemInsights: {
      ...value.itemInsights,
      state: "incomplete",
      reason: "original_items_unavailable",
      unavailableSales: 1,
      totalItems: null,
      items: [],
    },
  };
  assert.equal(
    validatePreparedItems(incomplete, context, branchId, day).itemInsights
      .state,
    "incomplete",
  );
  const empty = {
    ...value,
    completedSales: 0,
    billedSalesMinor: 0,
    refundsMinor: 0,
    salesAfterReturnsMinor: 0,
    itemInsights: {
      ...value.itemInsights,
      sourceSales: 0,
      totalItems: 0,
      items: [],
    },
  };
  assert.equal(
    validatePreparedItems(empty, context, branchId, day).itemInsights
      .totalItems,
    0,
  );
});
test("malformed money, duplicate units, scope mismatches and false completeness cannot reach the screen", () => {
  for (const change of [
    (v: ReturnType<typeof fixture>) => {
      v.itemInsights.items[0]!.salesAfterReturnsMinor = 1;
    },
    (v: ReturnType<typeof fixture>) => {
      v.itemInsights.items[0]!.quantities.push(
        v.itemInsights.items[0]!.quantities[0]!,
      );
    },
    (v: ReturnType<typeof fixture>) => {
      v.itemInsights.truncated = true;
    },
    (v: ReturnType<typeof fixture>) => {
      v.businessId = "another";
    },
    (v: ReturnType<typeof fixture>) => {
      v.freshness.complete = true;
    },
    (v: ReturnType<typeof fixture>) => {
      v.itemInsights.items[0]!.refundsMinor = 201;
      v.itemInsights.items[0]!.salesAfterReturnsMinor = -101;
    },
    (v: ReturnType<typeof fixture>) => {
      v.itemInsights.unavailableSales = 1;
    },
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => validatePreparedItems(value, context, branchId, day));
  }
});
test("denied local scope performs no network work and older servers never receive item requests", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    const { itemReporting, ...older } = discovery;
    return json(older);
  };
  await assert.rejects(
    readBusinessItems(
      credential,
      { ...context, capabilities: [] },
      branchId,
      day,
      { fetcher },
    ),
    (e: unknown) =>
      e instanceof ConnectionError && e.problem === "accessChanged",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    readBusinessItems(credential, context, branchId, day, { fetcher }),
    (e: unknown) => e instanceof ConnectionError && e.problem === "unsupported",
  );
  assert.equal(calls, 1);
});
