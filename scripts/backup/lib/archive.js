'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { BSON } = require('mongodb');

/*
 * Reader for mongodump's --archive format (mongo-tools common/archive), used
 * to check a backup without a running mongod:
 *
 *   magic        uint32 LE 0x8199e26d
 *   prelude      header BSON { concurrent_collections, version,
 *                              server_version, tool_version }
 *                one BSON per namespace { db, collection, metadata, size, type }
 *                terminator  int32 -1 (0xffffffff)
 *   body         blocks of: namespace header BSON { db, collection, EOF:false }
 *                           followed by document BSONs, then a terminator;
 *                and per namespace a final header { EOF:true, CRC } + terminator.
 *
 * With --gzip the whole stream is gzipped. Documents are counted, never
 * decoded, so a large archive is read at gunzip speed with constant memory.
 */

const MAGIC = 0x8199e26d;
const TERMINATOR = -1;
const MAX_DOC = 64 * 1024 * 1024;

class ArchiveError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function createParser() {
  let buf = Buffer.alloc(0);
  let state = 'magic';
  let current = null;
  const out = { header: null, namespaces: [], counts: {}, eof: {}, bytes: 0 };

  /* Returns the next int32-prefixed item: TERMINATOR, a Buffer, or null when
     more input is needed. */
  function next() {
    if (buf.length < 4) return null;
    const len = buf.readInt32LE(0);
    if (len === TERMINATOR) {
      buf = buf.subarray(4);
      return TERMINATOR;
    }
    if (len < 5 || len > MAX_DOC) throw new ArchiveError('archive_corrupt', `bad BSON length ${len}`);
    if (buf.length < len) return null;
    const doc = buf.subarray(0, len);
    buf = buf.subarray(len);
    return doc;
  }

  function push(chunk) {
    out.bytes += chunk.length;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (state === 'magic') {
        if (buf.length < 4) return;
        if (buf.readUInt32LE(0) !== MAGIC) throw new ArchiveError('archive_not_mongodump', 'not a mongodump archive (bad magic number)');
        buf = buf.subarray(4);
        state = 'header';
        continue;
      }
      const item = next();
      if (item === null) return;
      if (state === 'header') {
        if (item === TERMINATOR) throw new ArchiveError('archive_corrupt', 'missing prelude header');
        out.header = BSON.deserialize(item);
        state = 'prelude';
      } else if (state === 'prelude') {
        if (item === TERMINATOR) { state = 'body'; continue; }
        const meta = BSON.deserialize(item);
        out.namespaces.push({ db: meta.db, collection: meta.collection, type: meta.type || 'collection', size: Number(meta.size || 0) });
      } else if (state === 'body') {
        if (item === TERMINATOR) continue;
        const h = BSON.deserialize(item);
        const ns = `${h.db}.${h.collection}`;
        if (h.EOF) { out.eof[ns] = true; state = 'eof'; continue; }
        current = ns;
        out.counts[ns] = out.counts[ns] || 0;
        state = 'docs';
      } else if (state === 'docs') {
        if (item === TERMINATOR) { state = 'body'; current = null; continue; }
        out.counts[current] += 1;
      } else if (state === 'eof') {
        if (item !== TERMINATOR) throw new ArchiveError('archive_corrupt', 'EOF header without terminator');
        state = 'body';
      }
    }
  }

  function end() {
    if (state !== 'body' || buf.length) throw new ArchiveError('archive_truncated', `archive ended unexpectedly (state ${state}, ${buf.length} trailing bytes)`);
    for (const n of out.namespaces) {
      const ns = `${n.db}.${n.collection}`;
      n.documents = out.counts[ns] || 0;
      n.complete = !!out.eof[ns] || n.type === 'view';
    }
    return out;
  }
  return { push, end };
}

/* Reads a (gzipped when the name ends in .gz) archive file. */
async function readArchive(file, { gzip = /\.gz$/.test(file) } = {}) {
  const parser = createParser();
  const stages = [fs.createReadStream(file)];
  if (gzip) stages.push(zlib.createGunzip());
  /* A parse error is kept aside: thrown from inside the pipeline it would
     surface as the pipeline's own abort/premature-close error instead. */
  let parseError = null;
  try {
    await pipeline(...stages, async (source) => {
      for await (const chunk of source) {
        try {
          parser.push(chunk);
        } catch (e) {
          parseError = e;
          return;
        }
      }
    });
  } catch (e) {
    if (parseError) throw parseError;
    if (e instanceof ArchiveError) throw e;
    if (e && e.code === 'Z_BUF_ERROR') throw new ArchiveError('archive_truncated', 'gzip stream truncated');
    if (e && typeof e.code === 'string' && e.code.startsWith('Z_')) throw new ArchiveError('archive_corrupt', `gzip: ${e.code}`);
    throw e;
  }
  if (parseError) throw parseError;
  return parser.end();
}

/*
 * Checks an archive against what the manifest expected for `db`: every
 * expected collection is present and complete, nothing from another
 * database is inside. Collections created while the dump ran are extra, not
 * an error. Returns { ok, problems[], collections{name: documents} }.
 */
function checkArchive(parsed, { db, collections = [] }) {
  const problems = [];
  const found = {};
  for (const n of parsed.namespaces) {
    if (n.db !== db) problems.push(`unexpected database ${n.db} in archive`);
    else {
      found[n.collection] = n.documents;
      if (!n.complete) problems.push(`collection ${n.collection} has no end marker`);
    }
  }
  for (const c of collections) if (!(c in found)) problems.push(`collection ${c} missing from archive`);
  return { ok: problems.length === 0, problems, collections: found };
}

module.exports = { readArchive, createParser, checkArchive, ArchiveError, MAGIC };
