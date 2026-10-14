#!/usr/bin/env node

/*
 * WHAT IS STILL IN ENGLISH.
 *
 * The Tamil pack is keyed by the English sentence, so a sentence nobody has
 * translated shows English. That is the right failure - a waiter reads the
 * word rather than a key - and it is also a failure nobody can SEE, because
 * a screen half in English looks like a screen, not like a bug report.
 *
 * So this reads every sentence the app puts on a screen out of the markup,
 * asks the pack whether it knows it, and prints what is missing. Run it
 * before adding to the pack, and again afterwards to see what moved:
 *
 *     npm run tamil
 *
 * It reads MARKUP ONLY, which is the honest limit and is stated in the output.
 * Plenty of what a waiter reads is built in script, and a string assembled
 * from pieces at runtime cannot be found by reading source. This is a tool for
 * pointing at the next hundred words, not a claim about the whole app.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Sentences that are not sentences: a shop's own words, a symbol, a number. */
const NOT_WORDS = [
  /^[\s\d.,:%+-]*$/,
  /^[^a-z]*$/, /* SHOUTED abbreviations and icons carry no language */
  /^\$\{/, /* a template hole, not a sentence */
  /^&[a-z]+;$/,
];

const isWorth = (said) =>
  said.length > 2 && said.length < 900 && !NOT_WORDS.some((rule) => rule.test(said));

/*
 * AS THE BROWSER WOULD READ IT.
 *
 * The runtime compares against the text in the DOM, which is decoded: the
 * markup says `Apply &amp; Add` and a waiter reads "Apply & Add". Reporting
 * the encoded form would send somebody to write a key that can never match,
 * and the sentence would stay English with a translation sitting right there.
 */
const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&hellip;': '…',
  '&nbsp;': ' ',
  '&times;': '×',
  '&rarr;': '→',
  '&larr;': '←',
  '&middot;': '·',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

const decoded = (said) =>
  said.replace(/&[a-z#0-9]+;/gi, (entity) => {
    const known = ENTITIES[entity.toLowerCase()];
    if (known != null) return known;
    const numbered = entity.match(/^&#(\d+);$/);
    return numbered ? String.fromCodePoint(Number(numbered[1])) : entity;
  });

/** Every sentence the markup puts on a screen, and which files show it. */
function fromMarkup() {
  const found = new Map();

  const note = (said, file) => {
    const text = decoded(said).replace(/\s+/g, ' ').trim();
    if (!isWorth(text)) return;
    if (!found.has(text)) found.set(text, new Set());
    found.get(text).add(file);
  };

  for (const name of fs.readdirSync(ROOT)) {
    if (!name.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(ROOT, name), 'utf8');

    /* Script and style hold text nobody reads as language. */
    const readable = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    for (const m of readable.matchAll(/>([^<>]+)</g)) note(m[1], name);
    for (const m of readable.matchAll(/(?:placeholder|title|aria-label)="([^"]+)"/gi)) {
      note(m[1], name);
    }
  }

  return found;
}

/** The pack, read the way a page reads it. */
function pack() {
  const catalog = path.join(ROOT, 'assets', 'common', 'locales', 'ta.json');
  if (fs.existsSync(catalog)) return JSON.parse(fs.readFileSync(catalog, 'utf8'));
  const source = fs.readFileSync(path.join(ROOT, 'assets', 'common', 'lang-ta.js'), 'utf8');
  const root = {};
  // eslint-disable-next-line no-new-func
  new Function('window', 'globalThis', source)(root, root);

  if (root.POSNIC_LANG_TA) return root.POSNIC_LANG_TA;
  throw new Error('The Tamil pack did not hand its words over. Has lang-ta.js changed shape?');
}

function main() {
  const words = pack();
  const onScreen = fromMarkup();

  const missing = [...onScreen.entries()].filter(([said]) => !words[said]);
  const covered = onScreen.size - missing.length;
  const percent = onScreen.size ? Math.round((covered / onScreen.size) * 100) : 100;

  process.stdout.write(`Tamil: ${covered} of ${onScreen.size} sentences in the markup (${percent}%)\n`);
  process.stdout.write(`The pack holds ${Object.keys(words).length} in all, including what scripts draw.\n\n`);

  if (!missing.length) {
    process.stdout.write('Nothing in the markup is left in English.\n');
  } else {
    process.stdout.write('Still English:\n');
    for (const [said, files] of missing.sort((a, b) => b[1].size - a[1].size)) {
      process.stdout.write(`  ${said}\n      ${[...files].join(', ')}\n`);
    }
  }

  process.stdout.write(
    '\nMarkup only. What a script builds at runtime is not readable from source,\n' +
      'so this points at the next words to translate rather than scoring the app.\n'
  );

  return missing.length;
}

if (require.main === module) main();

module.exports = { fromMarkup, pack, isWorth, decoded };
