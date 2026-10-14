'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Append to an existing compiled source file, so both Capacitor project formats
// include the plugins without rewriting Xcode's build-file identifiers.
function install(root) {
  const target = path.join(root, 'ios/App/App/AppDelegate.swift');
  const storyboard = path.join(root, 'ios/App/App/Base.lproj/Main.storyboard');
  const marker = '// BEGIN CAPTAIN LOCAL PLUGINS';
  const source = fs.readFileSync(target, 'utf8').split(marker)[0].trimEnd();
  const plugins = fs.readFileSync(path.join(root, 'ios-templates/CaptainPlugins.swift'), 'utf8');
  const layout = fs.readFileSync(storyboard, 'utf8');
  if (!/customClass="(?:CAPBridgeViewController|CaptainBridgeViewController)"/.test(layout)) {
    throw new Error('Cannot locate the Captain iOS bridge view controller');
  }
  fs.writeFileSync(target, source + '\n\n' + marker + '\n' + plugins + '\n');
  fs.writeFileSync(storyboard, layout.replace(
    /customClass="(?:CAPBridgeViewController|CaptainBridgeViewController)" customModule="(?:Capacitor|App)"(?: customModuleProvider="target")?/,
    'customClass="CaptainBridgeViewController" customModule="App" customModuleProvider="target"'));
}
module.exports = { install };
