/*
 * Plan limits, read from wherever this copy of the app happens to be running.
 *
 * The desktop app caches them in its data folder after the gateway hands them
 * over; a cloud shop reads them from its own database, written there by the
 * admin console. Same shape either way, so callers do not care which they are.
 *
 * A shop with no cloud account has no limits, which is the point of the free
 * edition. Any failure reads as "no limit": a shop must never be blocked from
 * trading because a limits file was unreadable.
 */
const fs = require('fs');
const { currentConnection } = require('../db/tenant-context');
const path = require('path');

const TTL_MS = 30_000;
/* Keyed by the database the limits were read from. A single process-wide
   entry served one shop's plan to every other shop in a multi-tenant shard
   for up to TTL_MS. (HiTechPOS fix.) */
const caches = new Map();

function cacheKey() {
  if (process.env.POSNIC_BRAND_DIR) return 'brand-dir';
  try {
    const mongoose = require('mongoose');
    const conn = currentConnection(mongoose.connection);
    return (conn && conn.name) || 'default';
  } catch {
    return 'default';
  }
}

async function getLimits() {
  const key = cacheKey();
  const cache = caches.get(key) || { at: 0, limits: null };
  if (Date.now() - cache.at < TTL_MS) return cache.limits;
  let limits = null;
  try {
    const dir = process.env.POSNIC_BRAND_DIR;
    if (dir) {
      const file = path.join(dir, 'limits.json');
      if (fs.existsSync(file)) limits = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        limits = await currentConnection(mongoose.connection)
          .db.collection('app_limits')
          .findOne({ _id: 'limits' });
      }
    }
  } catch (err) {
    limits = null;
  }
  caches.set(key, { at: Date.now(), limits });
  return limits;
}

/** Outlets this shop may run, or null when nothing is enforcing a number. */
async function branchLimit() {
  return limitOf('branches');
}

async function limitOf(key) {
  const limits = await getLimits();
  const n = limits && Number(limits[key]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Staff logins and catalogue size, written by the HiTechPOS control plane
    from the shop's plan. Absent means unlimited, as for branches. */
const userLimit = () => limitOf('users');
const itemLimit = () => limitOf('products');

/** Drops the cache so a freshly synced limit applies without a restart. */
function invalidate() {
  caches.clear();
}

module.exports = { getLimits, branchLimit, userLimit, itemLimit, invalidate };
