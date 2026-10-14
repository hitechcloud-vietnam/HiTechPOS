'use strict';

/** Strip Vietnamese diacritics, including đ/Đ (which NFD does not decompose). */
function removeDiacritics(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFC');
}

/** URL-safe slug: "Phở Bò Tái" -> "pho-bo-tai". */
function slugifyVN(input, { separator = '-' } = {}) {
  return removeDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^${escapeRe(separator)}+|${escapeRe(separator)}+$`, 'g'), '');
}

/** Normalized form for case/diacritic-insensitive search. */
function searchNormalize(input) {
  return removeDiacritics(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when every whitespace-separated token of `query` occurs in `text` (normalized). */
function matchesSearch(text, query) {
  const hay = searchNormalize(text);
  return searchNormalize(query).split(' ').filter(Boolean).every((t) => hay.includes(t));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { removeDiacritics, slugifyVN, searchNormalize, matchesSearch };
