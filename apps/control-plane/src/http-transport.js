'use strict';

const http = require('node:http');
const https = require('node:https');

/*
 * A fetch-compatible transport over node:http.
 *
 * The shard listens on 6000 by default, and WHATWG fetch refuses that port
 * outright ("bad port" - it is on the Fetch spec's blocked list because of
 * X11). Internal calls therefore cannot use globalThis.fetch. Only what the
 * installer needs is implemented: method, headers, string body, timeout
 * signal; the result is a standard Response.
 */
function nodeHttpTransport(url, { method = 'GET', headers = {}, body, signal } = {}) {
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, { method, headers, signal }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const headerPairs = Object.entries(res.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, String(v)]]));
        const status = res.statusCode || 500;
        const nullBody = status === 204 || status === 304;
        resolve(new Response(nullBody ? null : Buffer.concat(chunks), { status, headers: headerPairs }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

module.exports = { nodeHttpTransport };
