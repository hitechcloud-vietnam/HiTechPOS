const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {install} = require('../scripts/install-ios-plugins');
// Git Bash's tar treats C: as a remote host; use the Windows archive tool.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
for (const kind of ['spm','pods']) test(`iOS ${kind} project includes and registers local plugins after repeat installation`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'captain-ios-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'ios'));
 execFileSync(tar,['-xzf',path.resolve(`node_modules/@capacitor/cli/assets/ios-${kind}-template.tar.gz`),'-C',path.join(root,'ios')]);
 fs.mkdirSync(path.join(root,'ios-templates'));
 fs.copyFileSync('ios-templates/CaptainPlugins.swift',path.join(root,'ios-templates/CaptainPlugins.swift'));
 install(root); install(root);
 const source=fs.readFileSync(path.join(root,'ios/App/App/AppDelegate.swift'),'utf8');
 assert.equal(source.match(/class CaptainSecureSessionPlugin/g).length,1);
 assert.match(source,/registerPluginInstance\(CaptainSecureSessionPlugin\(\)\)/);
 assert.match(source,/registerPluginInstance\(CaptainLocalNetworkPlugin\(\)\)/);
 assert.match(source,/kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
 assert.match(fs.readFileSync(path.join(root,'ios/App/App/Base.lproj/Main.storyboard'),'utf8'),/customClass="CaptainBridgeViewController" customModule="App"/);
});
