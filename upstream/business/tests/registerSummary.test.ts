import test from "node:test";
import { validateInbox } from "../src/services/notifications";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sampleContext } from "../src/data/sample";
import {
  validateRegisterClose,
  validateRegisterSummary,
} from "../src/domain/registerSummary";
const branchId = "a".repeat(24),
  sessionId = "b".repeat(24),
  businessId = "c".repeat(24);
const context = {
  ...sampleContext("manager"),
  businessId,
  branches: [
    {
      ...sampleContext("manager").branches[0]!,
      id: branchId,
      timezone: "Asia/Kolkata",
      currency: "INR",
      currencyDigits: 2,
    },
  ],
};
const at = Date.parse("2026-09-29T02:00:00.000Z");
const close = {
  schemaVersion: 1,
  branchId,
  sessionId,
  registerId: "d".repeat(24),
  registerName: "Counter 1",
  openedAt: "2026-09-28T15:00:00.000Z",
  closedAt: "2026-09-29T01:00:00.000Z",
  eligibleAt: "2026-09-29T01:10:00.000Z",
  businessDate: "2026-09-29",
  timezone: "Asia/Kolkata",
  closeRevision: "",
};
close.closeRevision = createHash("sha256")
  .update(
    JSON.stringify([
      businessId,
      branchId,
      sessionId,
      close.registerId,
      close.openedAt,
      close.closedAt,
    ]),
  )
  .digest("hex");
const summary = {
  schemaVersion: 1,
  metricDefinitionVersion: "register-session-v1",
  businessId,
  branchId,
  close,
  currency: "INR",
  currencyDigits: 2,
  billedSalesMinor: 10000,
  refundsMinor: 12500,
  completedSales: 1,
  salesAfterReturnsMinor: -2500,
  preparedAt: new Date(at).toISOString(),
  freshness: {
    state: "partial",
    sourceUpdatedAt: null,
    checkedAt: new Date(at).toISOString(),
    complete: false,
  },
};
test("session summaries validate overnight scope and exact minor units including net returns", () => {
  assert.equal(
    validateRegisterSummary(summary, context, branchId, sessionId, at)
      .salesAfterReturnsMinor,
    -2500,
  );
  const delayed = {
    ...summary,
    freshness: {
      ...summary.freshness,
      state: "delayed",
      checkedAt: new Date(at + 960000).toISOString(),
    },
  };
  assert.equal(
    validateRegisterSummary(delayed, context, branchId, sessionId, at + 960000)
      .freshness.state,
    "delayed",
  );
});
test("session summaries reject plausible but corrupt amounts, scope, freshness and close history", () => {
  for (const bad of [
    { ...summary, salesAfterReturnsMinor: 0 },
    { ...summary, completedSales: 0 },
    { ...summary, currency: "USD" },
    { ...summary, currencyDigits: 0 },
    { ...summary, branchId: "e".repeat(24) },
    { ...summary, preparedAt: close.closedAt },
    { ...summary, billedSalesMinor: Number.MAX_SAFE_INTEGER + 1 },
    { ...summary, freshness: { ...summary.freshness, complete: true } },
    { ...summary, freshness: { ...summary.freshness, state: "delayed" } },
    { ...summary, close: { ...close, sessionId: "e".repeat(24) } },
    { ...summary, close: { ...close, businessDate: "2026-09-28" } },
    { ...summary, close: { ...close, closeRevision: "0".repeat(64) } },
    { ...summary, close: { ...close, eligibleAt: close.closedAt } },
    { ...summary, unexpected: true },
  ])
    assert.throws(() =>
      validateRegisterSummary(bad, context, branchId, sessionId, at),
    );
  assert.throws(() =>
    validateRegisterClose(
      close,
      { ...context, capabilities: ["overview.read"] },
      branchId,
      sessionId,
      at,
    ),
  );
  assert.throws(() =>
    validateRegisterSummary(
      summary,
      { ...context, businessId: "e".repeat(24) },
      branchId,
      sessionId,
      at,
    ),
  );
});

test("register Inbox entries cannot relabel dates, sessions, summary state or close identity", () => {
  const entry = {
    id: "f".repeat(24),
    branchId,
    kind: "register_summary",
    businessDate: close.businessDate,
    createdAt: new Date(at).toISOString(),
    read: false,
    sessionId,
    close,
    summary,
  };
  assert.equal(
    validateInbox({ entries: [entry], next: null }, context).entries.length,
    1,
  );
  for (const changed of [
    { ...entry, kind: "register_unavailable" },
    { ...entry, summary: null },
    { ...entry, businessDate: "2026-09-28" },
    { ...entry, sessionId: "e".repeat(24) },
    { ...entry, createdAt: close.closedAt },
    {
      ...entry,
      summary: {
        ...summary,
        close: { ...close, registerName: "Other counter" },
      },
    },
  ])
    assert.throws(() =>
      validateInbox({ entries: [changed], next: null }, context),
    );
});
