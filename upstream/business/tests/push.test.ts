import test from "node:test";
import assert from "node:assert/strict";
import { notificationIntent } from "../src/domain/notificationIntent";
import {
  readPushStatus,
  setPushRegistration,
} from "../src/services/pushRegistration";
const credential = {
  origin: "https://shop.example.com",
  token: "pb1_" + "a".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

test("push language negotiation accepts legacy servers and validates capability responses", async () => {
  const base = {
    available: true,
    projectId: "11111111-1111-4111-8111-111111111111",
    enabled: true,
  };
  const current = await readPushStatus(credential, {
    fetcher: async (url) => {
      assert.equal(new URL(String(url)).search, "?language=1&channels=2");
      return json({ ...base, supportedLanguages: ["en", "ta"], locale: "ta" });
    },
  });
  assert.equal(current.locale, "ta");
  const legacy = await readPushStatus(credential, {
    fetcher: async () => json(base),
  });
  assert.equal(legacy.supportedLanguages, undefined);
  for (const extra of [
    { locale: "ta" },
    { supportedLanguages: ["en"] },
    { supportedLanguages: ["en", "en"], locale: "en" },
    { supportedLanguages: ["en"], locale: "ta" },
    { supportedLanguages: ["constructor"], locale: "constructor" },
  ])
    await assert.rejects(
      readPushStatus(credential, {
        fetcher: async () => json({ ...base, ...extra }),
      }),
    );
  await setPushRegistration(
    credential,
    {
      token: "ExpoPushToken[abcdefghij]",
      platform: "android",
      projectId: base.projectId,
      locale: "ta",
    },
    {
      fetcher: async (_url, options) => {
        assert.equal(JSON.parse(String(options?.body)).locale, "ta");
        return json({ enabled: true });
      },
    },
  );
});
test("notification taps only request the authenticated Inbox and cannot carry URLs or approve actions", () => {
  const data = { kind: "business-inbox", eventId: "a".repeat(24) };
  assert.equal(notificationIntent(data), "inbox");
  for (const value of [
    null,
    "inbox",
    { ...data, url: "https://other.example" },
    { ...data, action: "approve" },
    { ...data, token: "secret" },
    { ...data, eventId: "../other" },
    { ...data, kind: "approve-discount" },
  ])
    assert.equal(notificationIntent(value), null);
});
test("push registration uses the dedicated session and rejects contradictory server acknowledgements", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    (
      await readPushStatus(credential, {
        fetcher: async () =>
          json({ available: true, projectId, enabled: false }),
      })
    ).enabled,
    false,
  );
  await assert.rejects(
    readPushStatus(credential, {
      fetcher: async () =>
        json({ available: false, projectId: null, enabled: true }),
    }),
  );
  let calls = 0;
  await setPushRegistration(credential, null, {
    fetcher: async (url, options) => {
      calls++;
      assert.equal(
        String(url),
        credential.origin + "/api/business/v1/notifications/device",
      );
      assert.equal(options?.method, "DELETE");
      assert.equal(
        new Headers(options?.headers).get("authorization"),
        "Bearer " + credential.token,
      );
      return json({ enabled: false });
    },
  });
  assert.equal(calls, 1);
  await assert.rejects(
    setPushRegistration(credential, null, {
      fetcher: async () => json({ enabled: true }),
    }),
  );
});

test("native channel negotiation accepts legacy servers and rejects unsupported versions", async () => {
  const base = {
    available: true,
    projectId: "11111111-1111-4111-8111-111111111111",
    enabled: false,
  };
  const status = await readPushStatus(credential, {
    fetcher: async () => json({ ...base, channelVersion: 2 }),
  });
  assert.equal(status.channelVersion, 2);
  for (const channelVersion of [1, 3, "2", null])
    await assert.rejects(
      readPushStatus(credential, {
        fetcher: async () => json({ ...base, channelVersion }),
      }),
    );
  await setPushRegistration(
    credential,
    {
      token: "ExpoPushToken[abcdefghij]",
      platform: "android",
      projectId: base.projectId,
      channelVersion: 2,
    },
    {
      fetcher: async (_url, options) => {
        assert.equal(JSON.parse(String(options?.body)).channelVersion, 2);
        return json({ enabled: true });
      },
    },
  );
});
