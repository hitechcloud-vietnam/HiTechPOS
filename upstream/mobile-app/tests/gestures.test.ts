import { test } from "node:test";
import assert from "node:assert/strict";
import { horizontalGesture, adjacentRecord } from "../src/domain/gestures";

test("receipt swipes follow reading direction, without stealing vertical scroll or system edges", () => {
  const swipe = (dx: number, dy = 0, start = 200, rtl = false, touches = 1) =>
    horizontalGesture(dx, dy, start, 390, touches, rtl, false, true);
  assert.equal(swipe(-90), "next");
  assert.equal(swipe(90), "previous");
  assert.equal(swipe(90, 0, 200, true), "next");
  assert.equal(swipe(-90, 0, 200, true), "previous");
  assert.equal(swipe(-20), null);
  assert.equal(swipe(-90, 100), null);
  assert.equal(swipe(-90, 0, 380), null);
  assert.equal(swipe(90, 0, 8), null);
  assert.equal(swipe(-90, 0, 200, false, 2), null);
});

test("iOS leading edge goes back instead of changing the record; no checkout swipe actions", () => {
  assert.equal(horizontalGesture(90, 0, 8, 390, 1, false, true, true), "back");
  assert.equal(
    horizontalGesture(-90, 0, 380, 390, 1, true, true, true),
    "back",
  );
  assert.equal(
    horizontalGesture(-90, 0, 200, 390, 1, false, false, false),
    null,
  );
  assert.equal(horizontalGesture(-90, 0, 8, 390, 1, false, true, true), null);
});

test("detail navigation uses stable IDs and stops at boundaries without wrapping", () => {
  const ids = ["third", "second", "first"];
  assert.equal(adjacentRecord(ids, "third", "previous"), undefined);
  assert.equal(adjacentRecord(ids, "first", "next"), undefined);
  assert.equal(adjacentRecord(ids, "missing", "next"), undefined);
  assert.equal(adjacentRecord(ids, "second", "next"), "first");
  assert.equal(adjacentRecord(ids, "second", "previous"), "third");
});
