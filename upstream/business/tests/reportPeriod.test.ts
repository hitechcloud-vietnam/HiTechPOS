import test from "node:test";
import assert from "node:assert/strict";
import { reportRange, validDay } from "../src/domain/reportPeriod";
test("branch periods distinguish completed weeks, rolling days and partial weeks", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  assert.deepEqual(reportRange("lastWeek", "Asia/Kolkata", undefined, now), {
    from: "2026-10-05",
    to: "2026-10-11",
  });
  assert.deepEqual(reportRange("lastSeven", "Asia/Kolkata", undefined, now), {
    from: "2026-10-07",
    to: "2026-10-13",
  });
  assert.deepEqual(reportRange("thisWeek", "Asia/Kolkata", undefined, now), {
    from: "2026-10-12",
    to: "2026-10-14",
  });
});
test("calendar arithmetic handles year and DST boundaries and rejects impossible dates", () => {
  assert.deepEqual(
    reportRange(
      "lastMonth",
      "America/New_York",
      undefined,
      new Date("2026-01-01T15:00:00Z"),
    ),
    { from: "2025-12-01", to: "2025-12-31" },
  );
  assert.deepEqual(
    reportRange(
      "lastSeven",
      "America/New_York",
      undefined,
      new Date("2026-03-10T15:00:00Z"),
    ),
    { from: "2026-03-03", to: "2026-03-09" },
  );
  assert.equal(validDay("2026-02-30"), false);
  assert.throws(() =>
    reportRange("custom", "UTC", { from: "2026-10-02", to: "2026-10-01" }),
  );
  assert.equal(reportRange("all", "UTC"), null);
});
