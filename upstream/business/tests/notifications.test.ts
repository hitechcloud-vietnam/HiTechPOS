import test from "node:test";
import assert from "node:assert/strict";
import { sampleContext } from "../src/data/sample";
import {
  validateInbox,
  savePreference,
  type NotificationPreference,
} from "../src/services/notifications";

const branchId = "a".repeat(24),
  context = {
    ...sampleContext("manager"),
    branches: [{ ...sampleContext("manager").branches[0]!, id: branchId }],
  };
const entry = {
  id: "b".repeat(24),
  branchId,
  kind: "daily_unavailable",
  businessDate: "2026-09-28",
  createdAt: "2026-09-28T17:30:00.000Z",
  read: false,
  summary: null,
};
test("Inbox rejects out-of-scope, duplicate and contradictory entries", () => {
  assert.equal(
    validateInbox({ entries: [entry], next: null }, context).entries[0]!
      .summary,
    null,
  );
  for (const changed of [
    { ...entry, branchId: "c".repeat(24) },
    { ...entry, kind: "daily_summary" },
    { ...entry, password: "unexpected" },
  ])
    assert.throws(() =>
      validateInbox({ entries: [changed], next: null }, context),
    );
  assert.throws(() =>
    validateInbox({ entries: [entry, entry], next: null }, context),
  );
  assert.throws(() =>
    validateInbox(
      { entries: [entry], next: null },
      { ...context, capabilities: [] },
    ),
  );
});
test("preference writes bind the observed revision without recipient or account overrides", async () => {
  const preference: NotificationPreference = {
    branchId,
    timezone: "Asia/Kolkata",
    revision: 3,
    enabled: true,
    time: "23:00",
    quiet: { enabled: true, start: "22:00", end: "07:00" },
    locale: "en",
    channel: "inApp",
    nextSendAt: "2026-09-29T01:30:00.000Z",
  };
  let calls = 0;
  const saved = await savePreference(
    {
      origin: "https://shop.example.com",
      token: "pb1_" + "a".repeat(43),
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    preference,
    {
      fetcher: async (url, options) => {
        calls++;
        assert.equal(
          String(url),
          "https://shop.example.com/api/business/v1/notifications/preferences/" +
            branchId,
        );
        assert.deepEqual(JSON.parse(options!.body as string), {
          expectedRevision: 3,
          enabled: true,
          time: "23:00",
          quiet: preference.quiet,
          locale: "en",
        });
        return new Response(JSON.stringify({ ...preference, revision: 4 }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(saved.revision, 4);
});
