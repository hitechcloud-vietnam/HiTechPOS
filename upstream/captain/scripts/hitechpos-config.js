'use strict';
/*
 * HiTechPOS build-time cloud settings.
 *
 * config.js ships two constants, CLOUD_SUFFIX and ACCOUNT_ORIGIN, with the
 * production defaults. A build for another environment (staging, a private
 * deployment) sets
 *
 *   HITECHPOS_CLOUD_SUFFIX=.staging.hitechpos.vn
 *   HITECHPOS_ACCOUNT_ORIGIN=https://app.staging.hitechpos.vn
 *
 * and `vite build` rewrites those lines in dist/config.js; build-apk.js and
 * install-ios-plugins.js put the same account host into the native browser
 * allow-list, which refuses to open any other approval page. Unset means the
 * defaults below, which must stay identical to config.js (a unit test checks).
 */

const DEFAULTS = Object.freeze({
  cloudSuffix: '.hitechpos.vn',
  accountOrigin: 'https://app.hitechpos.vn',
});

function cloudSuffix(value) {
  const text = String(value).trim().toLowerCase();
  if (!/^(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(text) || !text.slice(1).includes('.'))
    throw new Error('HITECHPOS_CLOUD_SUFFIX must look like ".hitechpos.vn"');
  return text;
}

function accountOrigin(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch (e) {
    throw new Error('HITECHPOS_ACCOUNT_ORIGIN must be an https origin');
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('HITECHPOS_ACCOUNT_ORIGIN must be an https origin without port, path or query');
  return url.origin;
}

function resolve(env = process.env) {
  return {
    cloudSuffix: env.HITECHPOS_CLOUD_SUFFIX ? cloudSuffix(env.HITECHPOS_CLOUD_SUFFIX) : DEFAULTS.cloudSuffix,
    accountOrigin: env.HITECHPOS_ACCOUNT_ORIGIN ? accountOrigin(env.HITECHPOS_ACCOUNT_ORIGIN) : DEFAULTS.accountOrigin,
  };
}

const SUFFIX_LINE = /^(\s*const CLOUD_SUFFIX = )'[^']*';$/m;
const ORIGIN_LINE = /^(\s*const ACCOUNT_ORIGIN = )'[^']*';$/m;

/* Rewrites the two constants in config.js source. Throws when either line has
   moved, so a refactor cannot silently ship the defaults. */
function applyToConfig(source, settings = resolve()) {
  if (!SUFFIX_LINE.test(source) || !ORIGIN_LINE.test(source))
    throw new Error('config.js no longer declares CLOUD_SUFFIX / ACCOUNT_ORIGIN on one line each');
  return source
    .replace(SUFFIX_LINE, `$1'${settings.cloudSuffix}';`)
    .replace(ORIGIN_LINE, `$1'${settings.accountOrigin}';`);
}

/* The native plugins compare the approval page's host to a literal. */
function applyToNative(source, settings = resolve()) {
  const host = new URL(DEFAULTS.accountOrigin).host;
  if (!source.includes(`"${host}"`)) throw new Error(`native template no longer checks "${host}"`);
  return source.split(`"${host}"`).join(`"${new URL(settings.accountOrigin).host}"`);
}

module.exports = { DEFAULTS, resolve, applyToConfig, applyToNative };
