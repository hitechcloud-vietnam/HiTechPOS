import test from "node:test";
import assert from "node:assert/strict";
import {
  canShowBranchSelector,
  contextSchema,
  resolveBranchScope,
  validateOverview,
} from "../src/domain/contracts";
import {
  sampleContext,
  sampleItems,
  sampleOverview,
  sampleStock,
} from "../src/data/sample";
import { averageBill, formatMoney } from "../src/domain/money";
import { recordSwipe, adjacentIndex } from "../src/domain/gestures";
import { communityOrigin } from "../src/domain/server";

test("one accessible branch auto-selects without showing a selector", () => {
  const c = sampleContext("manager");
  assert.equal(canShowBranchSelector(c), false);
  assert.deepEqual(resolveBranchScope(c, null), ["central"]);
  assert.deepEqual(resolveBranchScope(c, "previously-permitted-branch"), [
    "central",
  ]);
});
test("zero access never means all branches", () => {
  const c = sampleContext("no-access");
  assert.deepEqual(resolveBranchScope(c, null), []);
  assert.equal(canShowBranchSelector(c), false);
  assert.throws(() => sampleOverview(c, null, "current"));
});
test("multiple branch scope cannot include an unknown ID", () => {
  const c = sampleContext("owner");
  assert.equal(canShowBranchSelector(c), true);
  assert.deepEqual(resolveBranchScope(c, null), ["central", "marina"]);
  assert.throws(() => resolveBranchScope(c, "other-tenant"));
});
test("stock-only access cannot retrieve sales or item sales", () => {
  const c = sampleContext("stock");
  assert.throws(() => sampleOverview(c, null, "current"));
  assert.deepEqual(sampleItems(c, null), []);
  assert.ok(sampleStock(c, null).length);
});
test("overview rejects wrong business, extra branches and false freshness", () => {
  const c = sampleContext("owner"),
    v = sampleOverview(c, "central", "current");
  assert.throws(() =>
    validateOverview({ ...v, businessId: "another" }, c, ["central"]),
  );
  assert.throws(() =>
    validateOverview({ ...v, branchIds: ["central", "marina"] }, c, [
      "central",
    ]),
  );
  assert.throws(() =>
    validateOverview(
      { ...v, freshness: { ...v.freshness, complete: false } },
      c,
      ["central"],
    ),
  );
  assert.throws(() =>
    validateOverview(
      { ...v, freshness: { ...v.freshness, sourceUpdatedAt: null } },
      c,
      ["central"],
    ),
  );
});
test("mixed currencies must not be summed", () => {
  const c = sampleContext("owner"),
    v = sampleOverview(c, null, "current");
  const mixed = contextSchema.parse({
    ...c,
    branches: c.branches.map((b, i) => (i ? { ...b, currency: "USD" } : b)),
  });
  assert.throws(() => validateOverview(v, mixed, ["central", "marina"]));
});
test("sample branch totals sum exactly without changing metric definitions", () => {
  const c = sampleContext("owner");
  const a = sampleOverview(c, "central", "current"),
    b = sampleOverview(c, "marina", "current"),
    all = sampleOverview(c, null, "current");
  assert.equal(all.netSalesMinor, a.netSalesMinor + b.netSalesMinor);
  assert.equal(all.completedSales, a.completedSales + b.completedSales);
});
test("money uses safe minor units and zero bills have no average", () => {
  assert.equal(averageBill(4285000, 126), 34008);
  assert.equal(averageBill(0, 0), null);
  assert.throws(() => formatMoney(1.5, "INR", 2));
  assert.throws(() => formatMoney(Number.MAX_SAFE_INTEGER + 1, "INR", 2));
  assert.match(formatMoney(12345, "INR", 2), /123\.45/);
});
test("record paging excludes system edges, vertical and multi-touch", () => {
  assert.equal(recordSwipe(-90, 4, 160, 390, 1), "next");
  assert.equal(recordSwipe(90, 4, 160, 390, 1), "previous");
  assert.equal(recordSwipe(-90, 4, 160, 390, 1, true), "previous");
  assert.equal(recordSwipe(-90, 4, 10, 390, 1), null);
  assert.equal(recordSwipe(-90, 4, 380, 390, 1), null);
  assert.equal(recordSwipe(-90, 100, 160, 390, 1), null);
  assert.equal(recordSwipe(-90, 4, 160, 390, 2), null);
});
test("detail paging stops at ends without wrapping", () => {
  assert.equal(adjacentIndex(0, 3, "previous"), 0);
  assert.equal(adjacentIndex(2, 3, "next"), 2);
  assert.equal(adjacentIndex(1, 3, "next"), 2);
});
test("Community origins reject credentials, insecure transport and ambiguous suffixes", () => {
  assert.equal(
    communityOrigin(" https://cafe.example.com/ "),
    "https://cafe.example.com",
  );
  for (const bad of [
    "http://cafe.example.com",
    "https://u:p@cafe.example.com",
    "https://cafe.example.com/token",
    "https://cafe.example.com/?token=1",
    "https://cafe.example.com/#token",
  ])
    assert.throws(() => communityOrigin(bad));
});
