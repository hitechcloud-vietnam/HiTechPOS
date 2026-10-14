import test from "node:test";
import assert from "node:assert/strict";
import {
  precedingBusinessDays,
  readBusinessTrend,
} from "../src/services/businessTrends";
import { sampleContext } from "../src/data/sample";
import { ConnectionError } from "../src/services/businessConnection";
const context = sampleContext("manager");
const ids = context.branches.map((branch) => branch.id);
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "a".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const instant = new Date("2026-09-29T05:00:00Z");
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
};
function summary(day: string) {
  return {
    schemaVersion: 2,
    metricDefinitionVersion: 2,
    businessId: context.businessId,
    branchIds: ids,
    businessDate: day,
    currency: "INR",
    currencyDigits: 2,
    billedSalesMinor: 1000,
    refundsMinor: 1200,
    salesAfterReturnsMinor: -200,
    completedSales: 1,
    preparedAt: instant.toISOString(),
    freshness: {
      state: "partial",
      sourceUpdatedAt: null,
      checkedAt: instant.toISOString(),
      complete: false,
    },
  };
}

test("seven preceding branch dates cross leap years and DST without repeats or today's partial day", () => {
  assert.deepEqual(
    precedingBusinessDays("Asia/Kolkata", new Date("2024-03-01T00:00:00Z")),
    {
      anchorDay: "2024-03-01",
      days: [
        "2024-02-23",
        "2024-02-24",
        "2024-02-25",
        "2024-02-26",
        "2024-02-27",
        "2024-02-28",
        "2024-02-29",
      ],
    },
  );
  for (const date of ["2026-03-09T04:30:00Z", "2026-11-02T05:30:00Z"]) {
    const result = precedingBusinessDays("America/New_York", new Date(date));
    assert.equal(new Set(result.days).size, 7);
    assert.equal(result.days.includes(result.anchorDay), false);
    assert.equal(
      Date.parse(result.anchorDay) - Date.parse(result.days[0]!),
      7 * 86400000,
    );
  }
  assert.equal(
    precedingBusinessDays(
      "America/Los_Angeles",
      new Date("2026-01-01T01:00:00Z"),
    ).anchorDay,
    "2025-12-31",
  );
});

test("trend reads exactly seven prepared dates, keeps negative returns and represents missing days as gaps", async () => {
  const calls: string[] = [];
  const result = await readBusinessTrend(
    credential,
    context,
    ids,
    {
      fetcher: async (address) => {
        const url = new URL(String(address));
        if (url.pathname.endsWith("discovery")) return json(discovery);
        assert.deepEqual(url.searchParams.getAll("branchId"), ids);
        const day = url.searchParams.get("businessDate")!;
        calls.push(day);
        return day.endsWith("25")
          ? json({ error: "summary_unavailable" }, 503)
          : json(summary(day));
      },
    },
    instant,
  );
  assert.equal(calls.length, 7);
  assert.equal(result.anchorDay, "2026-09-29");
  assert.equal(
    result.days.find((row) => row.day === "2026-09-25")!.summary,
    null,
  );
  assert.equal(result.days[0]!.summary!.salesAfterReturnsMinor, -200);
  assert.equal(result.days[0]!.summary!.freshness.complete, false);
});

test("scope failures cause no requests and denied, throttled or corrupt days never become zero-sales gaps", async () => {
  for (const scope of [[], ["unknown"], [...ids, ...ids]])
    await assert.rejects(
      readBusinessTrend(
        credential,
        context,
        scope,
        { fetcher: async () => assert.fail("scope must be checked first") },
        instant,
      ),
    );
  await assert.rejects(
    readBusinessTrend(
      credential,
      { ...context, capabilities: [] },
      ids,
      { fetcher: async () => assert.fail("ACL must be checked first") },
      instant,
    ),
  );
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(
      readBusinessTrend(
        credential,
        context,
        ids,
        {
          fetcher: async (url) => {
            if (String(url).endsWith("discovery")) return json(discovery);
            calls++;
            return json({}, status);
          },
        },
        instant,
      ),
      (error) => error instanceof ConnectionError,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    readBusinessTrend(
      credential,
      context,
      ids,
      {
        fetcher: async (url) =>
          String(url).endsWith("discovery")
            ? json(discovery)
            : json(summary("2000-01-01")),
      },
      instant,
    ),
    (error) =>
      error instanceof ConnectionError && error.problem === "invalidResponse",
  );
});
