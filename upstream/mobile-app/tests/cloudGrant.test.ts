import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudGrant } from "../src/services/cloudGrant";

test("cloud authorization retains its internet authority despite a nearby till", () => {
  const expected = {
    baseUrl: "https://shop.hitechpos.vn/api",
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
    baseUrl: "https://shop.hitechpos.vn/api",
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
    "https://user:secret@shop.hitechpos.vn/api",
    "https://shop.hitechpos.vn/api?token=secret",
    "https://shop.hitechpos.vn/api#other",
  ])
    assert.throws(
      () => cloudGrant({ baseUrl, code: "ABCDEF123456" }),
      /invalidServer/,
    );
  assert.throws(() =>
    cloudGrant({ baseUrl: "https://shop.hitechpos.vn/api", code: "1234" }),
  );
});
