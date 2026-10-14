import test from "node:test";
import assert from "node:assert/strict";
import { sampleContext } from "../src/data/sample";
import {
  readSummarySchedule,
  saveSummarySchedule,
} from "../src/services/registerNotifications";
const branchId = "a".repeat(24);
const context = {
  ...sampleContext("manager"),
  branches: [
    {
      ...sampleContext("manager").branches[0]!,
      id: branchId,
      timezone: "Asia/Kolkata",
    },
  ],
};
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "a".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const discovery = {
  product: "posnic-business",
  apiVersion: 1,
  issuer: credential.origin,
  authorization: "business-pkce-v1",
  audience: "posnic-business",
  reporting: "bounded-summary-v2",
};
const legacy = {
  branchId,
  timezone: "Asia/Kolkata",
  revision: 1,
  enabled: true,
  time: "23:00",
  quiet: { enabled: false, start: "22:00", end: "07:00" },
  locale: "en",
  channel: "inApp",
  nextSendAt: "2026-09-29T17:30:00.000Z",
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
test("close schedules negotiate all capabilities and keep revision-bound writes on the same origin", async () => {
  let calls = 0;
  const options = {
    fetcher: (async (url, init) => {
      calls++;
      if (calls === 1) {
        assert.ok(String(url).endsWith("/discovery?registerSessions=1"));
        return response({
          ...discovery,
          registerReporting: "bounded-register-session-v1",
          registerInbox: "inbox-register-v1",
          registerSchedules: "register-close-v1",
        });
      }
      assert.ok(
        String(url).endsWith(
          "/notifications/preferences/" + branchId + "?scheduleVersion=2",
        ),
      );
      const value = {
        ...legacy,
        scheduleVersion: 2,
        mode: "register-close",
        nextSendAt: null,
      };
      if (init?.method === "POST") {
        assert.deepEqual(JSON.parse(init.body as string), {
          expectedRevision: 1,
          enabled: true,
          time: "23:00",
          quiet: legacy.quiet,
          locale: "en",
          scheduleVersion: 2,
          mode: "register-close",
        });
        return response({ ...value, revision: 2 });
      }
      return response(value);
    }) as typeof fetch,
  };
  const initial = await readSummarySchedule(
    credential,
    context,
    branchId,
    options,
  );
  assert.equal(initial.supportsClose, true);
  assert.equal(
    (await saveSummarySchedule(credential, context, initial, options))
      .preference.revision,
    2,
  );
});
test("older Community servers retain the exact daily wire contract and cannot save close mode", async () => {
  const options = {
    fetcher: (async (url, init) => {
      if (String(url).includes("/discovery")) return response(discovery);
      assert.ok(String(url).endsWith("/notifications/preferences/" + branchId));
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        assert.equal(Object.hasOwn(body, "mode"), false);
        assert.equal(Object.hasOwn(body, "scheduleVersion"), false);
        return response({ ...legacy, revision: 2 });
      }
      return response(legacy);
    }) as typeof fetch,
  };
  const initial = await readSummarySchedule(
    credential,
    context,
    branchId,
    options,
  );
  assert.equal(initial.supportsClose, false);
  assert.equal(initial.preference.mode, "daily");
  await saveSummarySchedule(credential, context, initial, options);
  await assert.rejects(
    saveSummarySchedule(
      credential,
      context,
      {
        ...initial,
        preference: { ...initial.preference, mode: "register-close" },
      },
      { fetcher: async () => assert.fail("must not send") },
    ),
  );
});
test("schedule reads reject wrong scope, malformed quiet hours and unsupported future contracts", async () => {
  await assert.rejects(
    readSummarySchedule(
      credential,
      { ...context, capabilities: [] },
      branchId,
      { fetcher: async () => assert.fail("no access") },
    ),
  );
  for (const changed of [
    { ...legacy, branchId: "b".repeat(24) },
    { ...legacy, timezone: "UTC" },
    { ...legacy, quiet: { enabled: true, start: "22:00", end: "22:00" } },
  ]) {
    await assert.rejects(
      readSummarySchedule(credential, context, branchId, {
        fetcher: async (url) =>
          response(String(url).includes("/discovery") ? discovery : changed),
      }),
    );
  }
  await assert.rejects(
    readSummarySchedule(credential, context, branchId, {
      fetcher: async () =>
        response({ ...discovery, registerSchedules: "future-v3" }),
    }),
  );
});
