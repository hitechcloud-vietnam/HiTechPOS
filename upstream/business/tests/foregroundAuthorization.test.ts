import test from "node:test";
import assert from "node:assert/strict";
import { foregroundAuthorization } from "../src/services/foregroundAuthorization";
import type { Session } from "../src/services/authorization";
import { sampleContext } from "../src/data/sample";
const session: Session = {
  origin: "https://shop.example.com",
  token: "pb1_" + "a".repeat(43),
  expiresAt: "2099-01-01T00:00:00.000Z",
  context: sampleContext("manager"),
};
test("browser approval waits through background and inactive transitions before opening PIN setup", () => {
  let state = "background";
  const received: Session[] = [],
    discarded: Session[] = [];
  const gate = foregroundAuthorization({
    active: () => state === "active",
    deliver: (s) => received.push(s),
    discard: (s) => discarded.push(s),
  });
  gate.offer(session);
  assert.equal(received.length, 0);
  state = "inactive";
  gate.resume();
  assert.equal(received.length, 0);
  state = "active";
  gate.resume();
  gate.resume();
  gate.dispose();
  assert.deepEqual(received, [session]);
  assert.deepEqual(discarded, []);
});
test("cancelled approval cannot sign in when the app later becomes active", () => {
  let active = false;
  const discarded: Session[] = [];
  const gate = foregroundAuthorization({
    active: () => active,
    deliver: () => assert.fail("cancelled request delivered"),
    discard: (s) => discarded.push(s),
  });
  gate.offer(session);
  gate.dispose();
  active = true;
  gate.resume();
  gate.dispose();
  assert.deepEqual(discarded, [session]);
});
test("a foreground approval is delivered immediately and a late cancelled response is discarded", () => {
  const received: Session[] = [],
    discarded: Session[] = [];
  const gate = foregroundAuthorization({
    active: () => true,
    deliver: (s) => received.push(s),
    discard: (s) => discarded.push(s),
  });
  gate.offer(session);
  assert.deepEqual(received, [session]);
  gate.dispose();
  gate.offer(session);
  assert.deepEqual(discarded, [session]);
});
