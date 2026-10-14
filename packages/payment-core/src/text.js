'use strict';

/*
 * Bank transfer descriptions travel through NAPAS and are frequently stripped
 * to ASCII by the receiving bank. Providers also cap them (payOS: 25 chars for
 * accounts not linked through payOS, Pay2S: 10-32 alphanumerics). Building
 * them here keeps the reconciliation key predictable.
 */
function toAscii(text) {
  return String(text == null ? '' : text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function transferDescription(text, { max = 25, allowSpaces = true } = {}) {
  const pattern = allowSpaces ? /[^A-Za-z0-9 ]+/g : /[^A-Za-z0-9]+/g;
  return toAscii(text).replace(pattern, allowSpaces ? ' ' : '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

module.exports = { toAscii, transferDescription };
