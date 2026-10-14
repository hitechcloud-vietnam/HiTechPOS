import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import appConfig, { DISPLAY_NAME } from "../app.config";
import { CLOUD_ORIGIN as connectionOrigin } from "../src/services/businessConnection";
import {
  CLOUD_ORIGIN,
  DEFAULT_CLOUD_ORIGIN,
  cloudOrigin,
} from "../src/config/hitechpos";
const require = createRequire(import.meta.url);
const withDisplayName = require("../plugins/withDisplayName.js");

test("the owner app ships as HiTechPOS", () => {
  assert.equal(appConfig.name, "HiTechPOS Business");
  assert.equal(appConfig.slug, "hitechpos-business");
  assert.equal(appConfig.scheme, "vn.hitechpos.business");
  assert.equal(appConfig.ios?.bundleIdentifier, "vn.hitechpos.business");
  assert.equal(appConfig.android?.package, "vn.hitechpos.business");
  assert.equal(DISPLAY_NAME, "HiTechPOS Chủ cửa hàng");
  assert.equal(appConfig.ios?.infoPlist?.CFBundleDisplayName, DISPLAY_NAME);
  assert.equal(appConfig.web?.name, DISPLAY_NAME);
});

test("the Android launcher label is the Vietnamese display name", async () => {
  const config = withDisplayName(
    { name: "HiTechPOS Business", slug: "business" },
    { name: DISPLAY_NAME },
  );
  const result = await config.mods.android.strings({
    ...config,
    modResults: {
      resources: {
        string: [{ $: { name: "app_name" }, _: "HiTechPOS Business" }],
      },
    },
    modRequest: { platform: "android", modName: "strings" },
  });
  assert.deepEqual(
    result.modResults.resources.string
      .filter((item: { $: { name: string } }) => item.$.name === "app_name")
      .map((item: { _: string }) => item._),
    [DISPLAY_NAME],
  );
});

test("the cloud origin is HiTechPOS and only an https origin may replace it", () => {
  assert.equal(DEFAULT_CLOUD_ORIGIN, "https://app.hitechpos.vn");
  assert.equal(CLOUD_ORIGIN, DEFAULT_CLOUD_ORIGIN);
  assert.equal(connectionOrigin, CLOUD_ORIGIN);
  assert.equal(
    cloudOrigin("https://app.staging.hitechpos.vn/"),
    "https://app.staging.hitechpos.vn",
  );
  for (const bad of [
    "http://app.hitechpos.vn",
    "https://app.hitechpos.vn/owner",
    "https://user@app.hitechpos.vn",
  ])
    assert.throws(() => cloudOrigin(bad));
});
