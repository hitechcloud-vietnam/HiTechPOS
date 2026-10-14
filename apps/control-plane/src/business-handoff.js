'use strict';

/*
 * The one row HiTechPOS Cloud writes into a shop's own database to hand an
 * owner's phone over to that shop (upstream/business/docs/
 * HITECHPOS_SERVER_CONTRACT.md section 3.5).
 *
 * The shard's exchange() (upstream/pos/api/src/services/business-access.js)
 * already accepts rows with authorization 'cloud-browser' in the shop's
 * `business_authorizations` collection; it re-checks the user, its auth
 * version, branches and ACL before issuing its own pb1_ session. This module
 * has no dependencies so the shard's jest suite can build the row with the
 * same code the control plane uses and run it through the real exchange().
 */

const HANDOFF_TTL_MS = 5 * 60_000;
const OWNER_TYPES = ['admin', 'super_admin'];

/* Same rule as active() in business-access.js: a disabled, deactivated or
   locked user is never handed a phone session. */
function activeUser(user, nowMs) {
  return !!(
    user &&
    user.activate === true &&
    user.isActive !== false &&
    !user.disabled &&
    !(Number(user.lockUntil) > nowMs) &&
    !(user.accountLocked && (!user.accountLockedUntil || new Date(user.accountLockedUntil).getTime() > nowMs))
  );
}

/* The control-plane owner maps only to an owner-level user of the shop (the
   super_admin the Posnic installer creates), never to staff sharing an email. */
function eligibleOwner(user, nowMs) {
  return activeUser(user, nowMs) && OWNER_TYPES.includes(user.usertype || user.role);
}

/*
 * `user` is the raw shop user document: _id and license are copied as stored
 * so their BSON types match what exchange() queries with.
 */
function authorizationRow(user, { requestHash, codeChallenge, deviceName, stepUp, authenticatedAt, now, ttlMs = HANDOFF_TTL_MS }) {
  if (!/^[a-f0-9]{64}$/.test(String(requestHash))) throw new Error('requestHash must be sha256 hex');
  if (!(now instanceof Date) || !(authenticatedAt instanceof Date)) throw new Error('dates required');
  if (!(ttlMs > 0 && ttlMs <= 10 * 60_000)) throw new Error('hand-over lifetime must be at most ten minutes');
  return {
    _id: requestHash,
    codeChallenge,
    deviceName,
    stepUp: stepUp === true,
    status: 'approved',
    userId: user._id,
    license: user.license,
    authVersion: Number(user && user.authVersion) || 0,
    issuedAt: now,
    authorization: 'cloud-browser',
    authenticatedAt,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

module.exports = { activeUser, eligibleOwner, authorizationRow, HANDOFF_TTL_MS, OWNER_TYPES };
