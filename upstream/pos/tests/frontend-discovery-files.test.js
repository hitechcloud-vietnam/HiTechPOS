const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const PUBLIC = path.join(FRONTEND, 'public');
const ROOT_FILES = ['robots.txt', 'sitemap.xml', 'llms.txt', '_headers'];
// HiTechPOS: entry pages carry the HiTechPOS identity (see docs/UPSTREAM.md).
const POSNIC_SEO_TITLE = 'HiTechPOS - Phần mềm quản lý bán hàng';
const POSNIC_SEO_DESCRIPTION =
  'HiTechPOS là phần mềm quản lý bán hàng cho cửa hàng, quán ăn và nhà hàng, dựa trên mã nguồn mở Posnic \\(AGPL-3\\.0\\)\\.';
const POSNIC_SEO_KEYWORDS = ['POS', 'Billing Software', 'Offline POS', 'Online/Offline POS', 'open source POS'];

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8');
}

function extractJsonLd(html, scriptId) {
  const match = html.match(
    new RegExp(`<script\\s+type="application/ld\\+json"\\s+id="${scriptId}">([\\s\\S]*?)<\\/script>`),
  );
  assert.ok(match, `${scriptId} JSON-LD script is missing`);
  return JSON.parse(match[1]);
}

test('frontend source carries machine-readable discovery files for the app domain', () => {
  for (const file of ROOT_FILES) {
    assert.ok(fs.existsSync(path.join(FRONTEND, file)), `${file} is missing from frontend/`);
  }

  // HiTechPOS: every copy of this frontend is one shop's private till on a
  // SaaS subdomain (<shop>.hitechpos.vn), so nothing here is for search
  // engines and nothing points at posnic.com (docs/UPSTREAM.md).
  const robots = read(FRONTEND, 'robots.txt');
  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /^Disallow: \/$/m);
  assert.doesNotMatch(robots, /^Allow: \/$/m);
  assert.doesNotMatch(robots, /posnic\.(?:com|io|in)/);

  const sitemap = read(FRONTEND, 'sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(sitemap, /<loc>/, 'a shop has no public page to list');
  assert.doesNotMatch(sitemap, /posnic\.(?:com|io|in)/);

  const llms = read(FRONTEND, 'llms.txt');
  assert.match(llms, /^# HiTechPOS shop$/m);
  assert.match(llms, /^Product website: https:\/\/hitechpos\.vn\/$/m);
  assert.match(llms, /^Based on: Posnic POS, https:\/\/github\.com\/Posnic\/POS \(AGPL-3\.0-only\)$/m,
    'the AGPL attribution to Posnic must stay');
  assert.match(llms, /POS; Billing Software; Offline POS; Online\/Offline POS; open source POS/);
  assert.doesNotMatch(llms, /https?:\/\/(?:www\.)?posnic\.(?:com|io|in)(?:\/|$)/m);

  const headers = read(FRONTEND, '_headers');
  assert.match(headers, /^\/\*\n  X-Robots-Tag: noindex, nofollow$/m);
  assert.match(headers, /\/robots\.txt[\s\S]*Content-Type: text\/plain; charset=utf-8/);
  assert.match(headers, /\/llms\.txt[\s\S]*Content-Type: text\/plain; charset=utf-8/);
  assert.match(headers, /\/sitemap\.xml[\s\S]*Content-Type: application\/xml; charset=utf-8/);
  assert.match(
    headers,
    /\/static\/manifest\.webmanifest[\s\S]*Content-Type: application\/manifest\+json; charset=utf-8/,
  );
});

test('public app entry pages expose canonical POS metadata', () => {
  const index = read(FRONTEND, 'index.html');
  const login = read(FRONTEND, 'login.html');
  const keywordContent = POSNIC_SEO_KEYWORDS.join(', ');

  for (const html of [index, login]) {
    assert.match(html, new RegExp(`<title>${POSNIC_SEO_TITLE}</title>`));
    assert.match(html, new RegExp(`<meta name="description" content="${POSNIC_SEO_DESCRIPTION}">`));
    assert.match(html, new RegExp(`<meta name="keywords" content="${keywordContent}">`));
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/hitechpos\.vn\/">/);
    assert.doesNotMatch(html, /https?:\/\/(?:www\.)?posnic\.io(?:\/|["'])/);
  }

  assert.match(login, new RegExp(`<meta property="og:title" content="${POSNIC_SEO_TITLE}">`));
  assert.match(login, /<meta property="og:url" content="https:\/\/hitechpos\.vn\/">/);
  assert.match(login, /<meta name="twitter:card" content="summary">/);
  assert.match(login, new RegExp(`<meta name="twitter:title" content="${POSNIC_SEO_TITLE}">`));

  const softwareSchema = extractJsonLd(login, 'posnic-software-schema');
  assert.equal(softwareSchema['@context'], 'https://schema.org');
  assert.equal(softwareSchema['@type'], 'SoftwareApplication');
  assert.equal(softwareSchema.name, 'HiTechPOS');
  assert.equal(softwareSchema.url, 'https://hitechpos.vn/');
  assert.equal(softwareSchema.codeRepository, 'https://github.com/hitechcloud-vietnam/HiTechPOS');
  assert.equal(softwareSchema.isBasedOn, 'https://github.com/Posnic/POS');
  assert.equal(softwareSchema.applicationCategory, 'BusinessApplication');
  assert.equal(softwareSchema.softwareVersion, require('../package.json').version);
  assert.deepEqual(softwareSchema.keywords, POSNIC_SEO_KEYWORDS);
});

test('gulp publishes discovery files into frontend/public', () => {
  const gulpIndex = read(FRONTEND, 'gulpfile.js', 'index.js');
  assert.match(gulpIndex, /function copyRootPublicFiles\(\)/);
  for (const file of ROOT_FILES) {
    assert.match(gulpIndex, new RegExp(`['"]${file.replace('.', '\\.')}['"]`));
  }
  assert.match(gulpIndex, /exports\.rootPublicFiles = copyRootPublicFiles/);
  assert.match(gulpIndex, /parallel\(copyRootPublicFiles,/);

  if (!fs.existsSync(PUBLIC)) return;
  for (const file of ROOT_FILES) {
    const built = path.join(PUBLIC, file);
    assert.ok(fs.existsSync(built), `${file} is missing from frontend/public after build`);
    assert.equal(read(FRONTEND, file), read(PUBLIC, file), `${file} changed during copy`);
  }
});

test('tenant frontend deploy checks discovery files before rsync', () => {
  const deployWorkflow = read(ROOT, '.github', 'workflows', 'deploy-frontend.yml');
  const developWorkflow = read(ROOT, '.github', 'workflows', 'deploy-develop.yml');
  for (const file of ['frontend/public/robots.txt', 'frontend/public/sitemap.xml', 'frontend/public/llms.txt']) {
    const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(deployWorkflow, new RegExp(escapedFile));
    assert.match(developWorkflow, new RegExp(escapedFile));
  }
});
