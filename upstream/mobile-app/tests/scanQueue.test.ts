import { test } from "node:test";
import assert from "node:assert/strict";
import { ScanQueue } from "../src/domain/scanQueue";

test("rapid scans retain order and intentional repeated products", async () => {
  const values: string[] = [];
  const queue = new ScanQueue(async (value) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    values.push(value);
    return value;
  });
  await Promise.all(
    Array.from({ length: 25 }, (_, index) => queue.submit(String(index % 3))),
  );
  assert.deepEqual(
    values,
    Array.from({ length: 25 }, (_, index) => String(index % 3)),
  );
  assert.equal(queue.pending, 0);
});

test("overflow is explicit and background cancellation removes only unstarted scans", async () => {
  let finish!: (value: string) => void;
  const values: string[] = [];
  const queue = new ScanQueue(async (value) => {
    values.push(value);
    return await new Promise<string>((resolve) => {
      finish = resolve;
    });
  }, 2);
  const first = queue.submit("first");
  const second = queue.submit("second");
  const rejected = assert.rejects(second, /scannerPaused/);
  await assert.rejects(queue.submit("overflow"), /scannerPaused/);
  queue.cancel();
  await rejected;
  finish("first");
  assert.equal(await first, "first");
  assert.deepEqual(values, ["first"]);
});

test("unknown barcode does not block following valid scans", async () => {
  const queue = new ScanQueue(async (value) => {
    if (value === "bad") throw new Error("noMatch");
    return value;
  });
  const bad = assert.rejects(queue.submit("bad"), /noMatch/);
  assert.equal(await queue.submit("valid"), "valid");
  await bad;
});
