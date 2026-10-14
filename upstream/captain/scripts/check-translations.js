const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../assets/common/locales');
const manifest = require('../assets/common/locales/manifest.json');
const en = require('../assets/common/locales/en.json');
const fields = s => (s.match(/\{\d+\}/g) || []).sort().join(',');
const errors = [];
for (const {code} of manifest) {
  const words = JSON.parse(fs.readFileSync(path.join(dir, code + '.json'), 'utf8'));
  const missing = Object.keys(en).filter(key=>!words[key]);
  if (missing.length) errors.push(`${code}: ${missing.length} missing translations`);
  const extra = Object.keys(words).filter(key=>!Object.hasOwn(en, key));
  if (extra.length) errors.push(`${code}: ${extra.length} unknown message keys`);
  for (const [key,value] of Object.entries(words)) {
    if (typeof value !== 'string' || !value.trim() || /\uFFFD|<\/?(?:script|iframe)|javascript:/i.test(value)) {
      errors.push(`${code}: invalid translation for ${key}`);
      continue;
    }
    if (fields(key) !== fields(value)) errors.push(`${code}: altered placeholders in ${key}`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode=1; }
else console.log(`${manifest.length} languages, ${Object.keys(en).length} messages each; placeholders intact.`);
