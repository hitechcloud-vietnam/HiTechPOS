import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudGrant } from "../src/services/cloudGrant";

test("cloud authorization retains its internet authority despite a nearby till", () => {
  const expected = {
    baseUrl: "https://shop.posnic.io/api",
    code: "ABCDEF123456",
  };
  assert.deepEqual(
    cloudGrant({
      ...expected,
      localServers: [
        { addresses: ["http://192.168.1.200:5555/api"], code: "123456ABCDEF" },
      ],
    }),
    expected,
  );
  assert.deepEqual(cloudGrant(expected), expected);
});
test("unrelated local discovery metadata cannot break cloud sign-in", () => {
  const expected = {
    baseUrl: "https://shop.posnic.io/api",
    code: "ABCDEF123456",
  };
  assert.deepEqual(
    cloudGrant({ ...expected, localServers: [{ addresses: null }] }),
    expected,
  );
});
test("cloud grants reject insecure or credential-bearing endpoints and invalid codes", () => {
  for (const baseUrl of [
    "http://192.168.1.200:5555/api",
    "https://user:secret@shop.posnic.io/api",
    "https://shop.posnic.io/api?token=secret",
    "https://shop.posnic.io/api#other",
  ])
    assert.throws(
      () => cloudGrant({ baseUrl, code: "ABCDEF123456" }),
      /invalidServer/,
    );
  assert.throws(() =>
    cloudGrant({ baseUrl: "https://shop.posnic.io/api", code: "1234" }),
  );
});
