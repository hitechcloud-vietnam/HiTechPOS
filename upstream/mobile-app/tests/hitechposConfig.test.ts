import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_ORIGIN,
  CLOUD_SUFFIX,
  accountOrigin,
  cloudSuffix,
} from "../src/config/hitechpos";
import { AUTH_RETURN_URL } from "../src/services/browserAuthorization";

test("HiTechPOS cloud defaults", () => {
  assert.equal(CLOUD_SUFFIX, ".hitechpos.vn");
  assert.equal(ACCOUNT_ORIGIN, "https://app.hitechpos.vn");
  assert.equal(AUTH_RETURN_URL, "vn.hitechpos.mobile://authorized");
});

test("build-time overrides are validated", () => {
  assert.equal(cloudSuffix(".Staging.HiTechPOS.vn"), ".staging.hitechpos.vn");
  assert.equal(
    accountOrigin("https://app.staging.hitechpos.vn/"),
    "https://app.staging.hitechpos.vn",
  );
  for (const bad of ["hitechpos.vn", ".vn", ".a.vn/x"])
    assert.throws(() => cloudSuffix(bad));
  for (const bad of [
    "http://app.hitechpos.vn",
    "https://app.hitechpos.vn/path",
    "https://app.hitechpos.vn:8443",
  ])
    assert.throws(() => accountOrigin(bad));
});

test("app identity is HiTechPOS", () => {
  const { expo } = JSON.parse(readFileSync("app.json", "utf8"));
  assert.equal(expo.name, "HiTechPOS");
  assert.equal(expo.slug, "hitechpos-mobile");
  assert.equal(expo.scheme, "vn.hitechpos.mobile");
  assert.equal(expo.ios.bundleIdentifier, "vn.hitechpos.mobile");
  assert.equal(expo.android.package, "vn.hitechpos.mobile");
  assert.equal(expo.ios.appleTeamId, undefined);
});
