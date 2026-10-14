import test from "node:test";
import assert from "node:assert/strict";
import { sampleContext } from "../src/data/sample";
import {
  readOverviewSnapshot,
  snapshotScope,
  SNAPSHOT_MAX_AGE_MS,
} from "../src/domain/overviewSnapshot";
import {
  branchDay,
  validatePreparedOverview,
} from "../src/domain/preparedOverview";

const context = sampleContext("manager"),
  ids = context.branches.map((b) => b.id),
  day = "2026-09-28";
const value = {
  schemaVersion: 2,
  metricDefinitionVersion: 2,
  businessId: context.businessId,
  branchIds: ids,
  businessDate: day,
  currency: "INR",
  currencyDigits: 2,
  billedSalesMinor: 0,
  refundsMinor: 2500,
  salesAfterReturnsMinor: -2500,
  completedSales: 0,
  preparedAt: "2026-09-28T01:00:00.000Z",
  freshness: {
    state: "partial",
    sourceUpdatedAt: null,
    checkedAt: "2026-09-28T01:01:00.000Z",
    complete: false,
  },
};
test("memory snapshots expire and cannot cross sessions, accounts, branch scope, ACL or branch midnight", () => {
  const receivedAt = Date.parse("2026-09-28T01:02:00Z");
  const identity = snapshotScope(
    "https://shop.example.com",
    "session-one",
    context,
    ids,
  );
  const snapshot = {
    value: validatePreparedOverview(value, context, ids, day),
    scope: identity,
    receivedAt,
    expiresAt: receivedAt + SNAPSHOT_MAX_AGE_MS,
  };
  assert.deepEqual(
    readOverviewSnapshot(snapshot, identity, context, ids, receivedAt + 1000),
    value,
  );
  for (const now of [
    receivedAt - 1,
    snapshot.expiresAt,
    snapshot.expiresAt + 1,
  ])
    assert.equal(
      readOverviewSnapshot(snapshot, identity, context, ids, now),
      null,
    );
  for (const changed of [
    snapshotScope("https://other.example.com", "session-one", context, ids),
    snapshotScope("https://shop.example.com", "session-two", context, ids),
    snapshotScope(
      "https://shop.example.com",
      "session-one",
      { ...context, accountId: "other" },
      ids,
    ),
    snapshotScope("https://shop.example.com", "session-one", context, [
      "other",
    ]),
  ])
    assert.equal(
      readOverviewSnapshot(snapshot, changed, context, ids, receivedAt),
      null,
    );
  assert.equal(
    readOverviewSnapshot(
      snapshot,
      identity,
      { ...context, capabilities: [] },
      ids,
      receivedAt,
    ),
    null,
  );
  const beforeMidnight = Date.parse("2026-09-28T18:29:00Z");
  assert.equal(
    readOverviewSnapshot(
      {
        ...snapshot,
        receivedAt: beforeMidnight,
        expiresAt: beforeMidnight + SNAPSHOT_MAX_AGE_MS,
      },
      identity,
      context,
      ids,
      beforeMidnight + 60_000,
    ),
    null,
  );
});
test("live summaries allow a return-only negative day and reject conflicting definitions, scope and completeness", () => {
  assert.deepEqual(validatePreparedOverview(value, context, ids, day), value);
  for (const change of [
    { schemaVersion: 1 },
    { metricDefinitionVersion: 1 },
    { currency: "USD" },
    { branchIds: [...ids, ...ids] },
    { businessId: "other" },
    { businessDate: "2026-09-27" },
    { billedSalesMinor: -1 },
    { refundsMinor: Infinity },
    { salesAfterReturnsMinor: 0 },
    { preparedAt: "2026-09-29T01:00:00.000Z" },
    { freshness: { ...value.freshness, complete: true } },
    { freshness: { ...value.freshness, state: "current" } },
    { customerName: "must not be exposed" },
  ])
    assert.throws(() =>
      validatePreparedOverview({ ...value, ...change }, context, ids, day),
    );
  assert.throws(() =>
    validatePreparedOverview(value, sampleContext("stock"), ids, day),
  );
});
test("Today follows branch time at midnight and across daylight-saving boundaries", () => {
  assert.equal(
    branchDay("Asia/Kolkata", new Date("2026-09-27T19:00:00Z")),
    "2026-09-28",
  );
  assert.equal(
    branchDay("America/New_York", new Date("2026-09-28T01:00:00Z")),
    "2026-09-27",
  );
  assert.equal(
    branchDay("America/New_York", new Date("2026-11-01T06:30:00Z")),
    "2026-11-01",
  );
});
