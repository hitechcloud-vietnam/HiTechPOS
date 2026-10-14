import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import appConfig from "../app.config";
import permissionDescriptions from "../src/i18n/native-permissions.json";
import { releaseLanguages } from "../src/i18n";
const require = createRequire(import.meta.url);
const plugin = require("../plugins/withBusinessNavigation.js");

test("Expo writes and registers all release-language Face ID resources in the native project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "business-native-locales-"));
  try {
    execFileSync(
      "tar",
      ["-xf", "node_modules/expo/template.tgz", "-C", root, "package/ios"],
      { windowsHide: true },
    );
    const projectRoot = path.join(root, "package");
    const project = require("xcode").project(
      path.join(projectRoot, "ios/HelloWorld.xcodeproj/project.pbxproj"),
    );
    project.parseSync();
    const {
      setLocalesAsync,
    } = require("@expo/config-plugins/build/ios/Locales");
    await setLocalesAsync(appConfig, { projectRoot, project });
    const generated = project.writeSync();
    assert.deepEqual(
      [...Object.keys(permissionDescriptions)].sort(),
      releaseLanguages.map((language) => language.code).sort(),
    );
    for (const [code, description] of Object.entries(permissionDescriptions)) {
      const resource = await readFile(
        path.join(
          projectRoot,
          `ios/HelloWorld/Supporting/${code}.lproj/InfoPlist.strings`,
        ),
        "utf8",
      );
      assert.equal(resource, `NSFaceIDUsageDescription = "${description}";`);
      assert.match(
        generated,
        new RegExp(`${code}\\.lproj/InfoPlist\\.strings`),
      );
      assert.ok(description.includes("Face ID"));
      assert.ok(description.includes("Posnic Business"));
      assert.doesNotMatch(description, /["\\\\\r\n]/);
    }
    // Re-running prebuild must not add duplicate resource build entries.
    await setLocalesAsync(appConfig, { projectRoot, project });
    assert.equal(project.writeSync(), generated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("iOS privacy modifies the installed SDK template once and refuses conflicting lifecycle overrides", async () => {
  const template = execFileSync(
    "tar",
    [
      "-xOf",
      "node_modules/expo/template.tgz",
      "package/ios/HelloWorld/AppDelegate.swift",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const config = plugin({ name: "Business", slug: "business" });
  const modify = (contents: string) =>
    config.mods.ios.appDelegate({
      ...config,
      modResults: { language: "swift", contents },
      modRequest: { platform: "ios", modName: "appDelegate" },
    });
  const output = (await modify(template)).modResults.contents;
  assert.match(output, /window\.addSubview\(cover\)/);
  assert.match(
    output,
    /coverBusinessWindow\(\)\s+super\.applicationWillResignActive/,
  );
  assert.match(
    output,
    /coverBusinessWindow\(\)\s+super\.applicationDidEnterBackground/,
  );
  assert.equal((await modify(output)).modResults.contents, output);
  await assert.rejects(
    modify(
      template.replace(
        "class AppDelegate: ExpoAppDelegate {",
        "class RenamedDelegate: ExpoAppDelegate {",
      ),
    ),
    /Review AppDelegate/,
  );
  await assert.rejects(
    modify(
      template.replace(
        "class AppDelegate: ExpoAppDelegate {",
        "class AppDelegate: ExpoAppDelegate {\n override func applicationWillResignActive(_ application: UIApplication) {}",
      ),
    ),
    /Review AppDelegate/,
  );
});
