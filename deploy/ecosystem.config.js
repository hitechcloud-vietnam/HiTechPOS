'use strict';
/*
 * PM2 process file for one HiTechPOS machine (control plane + Posnic shard).
 *   pm2 start deploy/ecosystem.config.js && pm2 save
 * Secrets come from /etc/hitechpos/*.env (0600), never from this file.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/* KEY=VALUE lines; comments and blanks ignored. Read here rather than through
   a PM2 option so it works on every PM2 version. Missing file -> {}. */
function envFile(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

module.exports = {
  apps: [
    {
      name: 'hitechpos-shard',
      cwd: path.join(root, 'upstream/pos/api'),
      script: 'shard.js',
      node_args: '--max-old-space-size=2048',
      env: { ...envFile('/etc/hitechpos/shard.env'), NODE_ENV: 'production', SHARD_HOST: '127.0.0.1', SHARD_PORT: '6000', SHARD_SHOP_HEADER: 'x-hitech-shop' },
      max_memory_restart: '2500M',
      kill_timeout: 15000,
    },
    {
      name: 'hitechpos-control-plane',
      cwd: root,
      script: 'apps/control-plane/src/server.js',
      env: { ...envFile('/etc/hitechpos/control-plane.env'), NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '4100', SHARD_URL: 'http://127.0.0.1:6000', SHARD_SHOP_HEADER: 'x-hitech-shop' },
      max_memory_restart: '800M',
      kill_timeout: 15000,
    },
  ],
};
