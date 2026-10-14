const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const signingDir = path.join(os.homedir(), '.posnic', 'captain-signing');
const keystorePath = path.join(signingDir, 'captain-release.jks');
const propertiesPath = path.join(signingDir, 'release-signing.properties');
const alias = 'posnic-captain';

const keytoolCandidates = [
  process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'keytool.exe'),
  path.join(projectRoot, '.android-build-tools', 'jdk17', 'bin', 'keytool.exe'),
  path.resolve(projectRoot, '..', 'apk-converter', '.android-build-tools', 'jdk17', 'bin', 'keytool.exe'),
  'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe'
].filter(Boolean);
const keytool = keytoolCandidates.find(candidate => fs.existsSync(candidate));

if (!keytool) throw new Error('keytool was not found. Install JDK 17 or set JAVA_HOME.');
fs.mkdirSync(signingDir, { recursive: true });

if (fs.existsSync(keystorePath) && fs.existsSync(propertiesPath)) {
  console.log(`Release signing already configured: ${propertiesPath}`);
  process.exit(0);
}
if (fs.existsSync(keystorePath) || fs.existsSync(propertiesPath)) {
  throw new Error(`Incomplete signing setup found in ${signingDir}. Restore both files or move them before retrying.`);
}

const password = crypto.randomBytes(24).toString('base64url');
const result = spawnSync(keytool, [
  '-genkeypair',
  '-keystore', keystorePath,
  '-alias', alias,
  '-keyalg', 'RSA',
  '-keysize', '2048',
  '-validity', '10000',
  '-storepass', password,
  '-keypass', password,
  '-dname', 'CN=Posnic Captain, O=Posnic Innovations Private Limited, C=IN'
], { stdio: 'inherit', windowsHide: true });

if (result.status !== 0) {
  fs.rmSync(keystorePath, { force: true });
  throw new Error(`keytool failed with exit code ${result.status}`);
}

const properties = [
  `storeFile=${keystorePath.replace(/\\/g, '/')}`,
  `storePassword=${password}`,
  `keyAlias=${alias}`,
  `keyPassword=${password}`,
  ''
].join('\n');
fs.writeFileSync(propertiesPath, properties, { encoding: 'utf8', mode: 0o600 });

console.log(`Release signing configured in: ${signingDir}`);
console.log('IMPORTANT: Back up this folder securely. Future app updates must use the same keystore.');
