import test from "node:test";
import assert from "node:assert/strict";
import {
  listenForInboxNotifications,
  type InboxNotificationResponse,
} from "../src/services/pushResponses";
const response = (
  data: unknown,
  actionIdentifier = "default",
): InboxNotificationResponse => ({
  actionIdentifier,
  notification: { request: { content: { data } } },
});
const hint = { kind: "business-inbox", eventId: "a".repeat(24) };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("cold-start and live responses accept only default-action Inbox hints", async () => {
  let receive!: (value: InboxNotificationResponse | null) => void;
  let opened = 0,
    cleared = 0;
  const stop = listenForInboxNotifications(
    {
      defaultAction: "default",
      subscribe(callback) {
        receive = callback;
        return () => {};
      },
      readLast: async () => response(hint),
      clearLast: async () => {
        cleared++;
      },
    },
    () => {
      opened++;
    },
  );
  await settle();
  assert.equal(opened, 1);
  assert.equal(cleared, 1);
  receive(null);
  receive(response(hint, "approve"));
  receive(response({ ...hint, url: "https://other.example" }));
  receive(response({ ...hint, token: "secret" }));
  await settle();
  assert.equal(opened, 1);
  assert.equal(cleared, 1);
  receive(response(hint));
  await settle();
  assert.equal(opened, 2);
  assert.equal(cleared, 2);
  stop();
});

test("disposed account listeners cannot route a late cold-start or native response", async () => {
  let receive!: (value: InboxNotificationResponse | null) => void;
  let resolve!: (value: InboxNotificationResponse) => void;
  const pending = new Promise<InboxNotificationResponse>((done) => {
    resolve = done;
  });
  let removed = 0,
    opened = 0,
    cleared = 0;
  const stop = listenForInboxNotifications(
    {
      defaultAction: "default",
      subscribe(callback) {
        receive = callback;
        return () => {
          removed++;
        };
      },
      readLast: () => pending,
      clearLast: async () => {
        cleared++;
      },
    },
    () => {
      opened++;
    },
  );
  stop();
  stop();
  resolve(response(hint));
  receive(response(hint));
  await settle();
  assert.equal(removed, 1);
  assert.equal(opened, 0);
  assert.equal(cleared, 0);
});

test("native read and clear failures stay contained and do not disable later valid taps", async () => {
  let receive!: (value: InboxNotificationResponse | null) => void;
  let opened = 0;
  const stop = listenForInboxNotifications(
    {
      defaultAction: "default",
      subscribe(callback) {
        receive = callback;
        return () => {};
      },
      readLast: async () => {
        throw new Error("native read failed");
      },
      clearLast: async () => {
        throw new Error("native clear failed");
      },
    },
    () => {
      opened++;
    },
  );
  await settle();
  receive(response(hint));
  await settle();
  receive(response(hint));
  await settle();
  assert.equal(opened, 2);
  stop();
});
