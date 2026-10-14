'use strict';

/*
 * Retention of backup runs, named by their UTC start time
 * ("20261014T020000Z"). Semantics follow restic's --keep-daily/--keep-weekly:
 *
 *   - keepDaily N: for the last N calendar days that HAVE a backup, keep the
 *     newest backup of each of those days;
 *   - keepWeekly M: for the last M ISO weeks that have a backup, keep the
 *     newest backup of each week;
 *   - the newest backup is always kept, whatever N and M say.
 *
 * Days and weeks are counted in local time, `tzOffsetMinutes` east of UTC
 * (Vietnam, UTC+7, has no daylight saving: 420). A run that happened at
 * 01:00 ICT belongs to that ICT day, not to the previous UTC day.
 *
 * Names that do not look like a run are never selected for removal.
 */

const NAME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

function parseRunName(name) {
  const m = NAME_RE.exec(String(name));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t);
  /* reject 20261340T... and friends that Date.UTC would roll over */
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  return back;
}

function formatRunName(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/* Local calendar day and ISO week keys of an instant. */
function localKeys(date, tzOffsetMinutes) {
  const local = new Date(date.getTime() + tzOffsetMinutes * 60000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const day = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  /* ISO 8601 week: the week (Mon-Sun) belongs to the year of its Thursday. */
  const t = new Date(Date.UTC(y, m, d));
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const isoYear = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { day, week: `${isoYear}-W${String(week).padStart(2, '0')}` };
}

function count(name, v) {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return v;
}

/*
 * names: run directory names (any order). Returns
 *   keep:    [{ name, reasons: ['latest'|'daily'|'weekly', ...] }] newest first
 *   remove:  [name] newest first
 *   ignored: [name] not a run name, left alone
 */
function selectRetention(names, { keepDaily = 7, keepWeekly = 4, tzOffsetMinutes = 420 } = {}) {
  count('keepDaily', keepDaily);
  count('keepWeekly', keepWeekly);
  if (!Number.isInteger(tzOffsetMinutes) || Math.abs(tzOffsetMinutes) > 14 * 60) throw new RangeError('tzOffsetMinutes must be an integer between -840 and 840');
  const ignored = [];
  const runs = [];
  for (const name of new Set(names)) {
    const at = parseRunName(name);
    if (at) runs.push({ name, at }); else ignored.push(name);
  }
  runs.sort((a, b) => b.at - a.at);

  const reasons = new Map(runs.map((r) => [r.name, []]));
  if (runs.length) reasons.get(runs[0].name).push('latest');
  const days = new Set();
  const weeks = new Set();
  for (const r of runs) {
    const k = localKeys(r.at, tzOffsetMinutes);
    if (!days.has(k.day)) {
      days.add(k.day);
      if (days.size <= keepDaily) reasons.get(r.name).push('daily');
    }
    if (!weeks.has(k.week)) {
      weeks.add(k.week);
      if (weeks.size <= keepWeekly) reasons.get(r.name).push('weekly');
    }
  }
  const keep = [];
  const remove = [];
  for (const r of runs) {
    const why = reasons.get(r.name);
    if (why.length) keep.push({ name: r.name, reasons: why }); else remove.push(r.name);
  }
  return { keep, remove, ignored };
}

module.exports = { selectRetention, parseRunName, formatRunName, localKeys, NAME_RE };
