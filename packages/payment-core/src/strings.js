'use strict';

/*
 * Linear-time helpers for strings that come from configuration or requests.
 * Regexes like /\/+$/ or /^[^\s@]+@[^\s@]+\.[^\s@]+$/ backtrack
 * polynomially on crafted input (many slashes, many dots), which CodeQL
 * rightly flags; these do the same job in one pass.
 */
function trimTrailingSlashes(value) {
  const s = String(value == null ? '' : value);
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* / */) end--;
  return s.slice(0, end);
}

/* Practical e-mail shape check: one @, no whitespace, a dot in the domain
   that is neither first nor last, at most 254 characters. */
function isEmail(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1 && !domain.startsWith('.') && !domain.includes('..');
}

/* Strips control characters (newlines included) so a value cannot forge or
   split log lines; also caps the length. */
function forLog(value, max = 200) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

/* Removes markup until none is left, so nested fragments like "<<b>b>"
   cannot reassemble into a tag. For plain-text derivations only. */
function stripTags(value) {
  let s = String(value == null ? '' : value);
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/<[^<>]*>/g, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/[<>]/g, '');
}

module.exports = { trimTrailingSlashes, isEmail, forLog, stripTags };
