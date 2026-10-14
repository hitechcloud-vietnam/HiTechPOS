/*
 * Finding an item while somebody is standing at a table waiting.
 *
 * The search was `name.includes(term)`. That finds "Chicken Biryani" from
 * "biry" and from nothing else. It does not find it from "chick biry", because
 * two words are one substring that never appears; and it does not find it from
 * "cb", which is what a waiter who sells it two hundred times a day actually
 * types.
 *
 * Every counter-facing till does the same four things, and they are the four
 * here, in the order they rank:
 *
 *   exact        the whole name, typed out
 *   prefix       the name starts with what was typed
 *   word start   any word in the name starts with it: "biry" finds Chicken
 *                Biryani, "masala dosa" finds Masala Dosa Paper Roast
 *   initials     the first letters of the words: "cb" finds Chicken Biryani,
 *                "mdp" finds Masala Dosa Paper
 *
 * Multi-token and AND-ed, so "chick 65" narrows rather than widens: every
 * token has to match something, which is how a long menu gets down to one row
 * in three or four keystrokes.
 *
 * Deliberately NOT fuzzy in the edit-distance sense. A waiter who types "birani"
 * would be helped by it, but so would every wrong row, and picking the wrong
 * item on a bill is worse than typing one more letter. Prefixes and initials
 * are predictable: the same keystrokes always produce the same order.
 *
 * Pure and exported, so the ranking is testable without a browser. The ranking
 * IS the feature; a change that quietly demotes the row somebody expects first
 * is invisible until a shop complains that the app "got slower to use".
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ItemSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* Ranks. Lower sorts first; the gaps leave room to insert a rank later
     without renumbering the ones around it. */
  const EXACT = 0;
  const PREFIX = 10;
  const WORD_START = 20;
  const INITIALS = 30;
  const CONTAINS = 40;
  /*
   * Last, and only for speech. See the `heard` option on search().
   *
   * A waiter who TYPES has seen what they typed; a waiter who SPEAKS has seen
   * nothing yet, so the two deserve different tolerances. Typing stays exactly
   * as predictable as it was.
   */
  const SOUNDS = 50;

  /**
   * Fold a string down to what a comparison should actually see.
   *
   * Diacritics are stripped so "Crème Brûlée" is reachable from a keyboard
   * that has no accents, which is most of the ones in a kitchen. Punctuation
   * becomes space so "Chicken-65" and "Chicken 65" behave the same, and both
   * are findable by "65".
   */
  function fold(value) {
    /*
     * Romanised first, so a shop whose own dish names are stored in Tamil or
     * Devanagari is searchable - by a thumb typing Latin, and by a recogniser
     * handing back either. Both sides of every comparison go through here, so
     * they meet whichever script each of them started in.
     */
    const phonetics = sounds();
    return String((phonetics && phonetics.roman(value)) || value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  const tokensOf = (value) => fold(value).split(' ').filter(Boolean);

  /**
   * The phonetic module, if the page loaded it.
   *
   * Optional on purpose: a page that only lists items has no use for it, and
   * item-search must not stop working because a script tag is missing. Read
   * through globalThis, never `root` - `root` is the UMD wrapper's parameter
   * and referencing it inside this factory throws, which cost a whole round to
   * find once already. See assets/common/self-test.js.
   */
  function sounds() {
    if (globalThis.SoundsLike) return globalThis.SoundsLike;
    if (typeof require === 'function') {
      try {
        return require('./sounds-like.js');
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /* Spoken numbers, for names that contain one. */
  const UNITS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19,
  };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  /**
   * "chicken sixty five" -> "chicken 65".
   *
   * THE DISH IS CALLED CHICKEN 65. It is one of the most ordered things on a
   * Tamil Nadu menu, it is written with digits on every board in the state,
   * and nobody says "chicken six five" - so a recogniser hands back
   * "sixty five" and the search looked for a dish spelled that way and found
   * nothing at all.
   *
   * The same applies to typing it out, so this is not gated behind speech.
   * It runs only as a SECOND attempt, after the term as given has found
   * nothing, so no existing search changes its ranking.
   */
  function numerals(term) {
    const words = tokensOf(term);
    const out = [];

    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];

      if (TENS[word] !== undefined) {
        /* "sixty five" is one number, "sixty" alone is another. */
        const next = words[i + 1];
        if (next && UNITS[next] !== undefined && UNITS[next] < 10 && UNITS[next] > 0) {
          out.push(String(TENS[word] + UNITS[next]));
          i += 1;
          continue;
        }
        out.push(String(TENS[word]));
        continue;
      }

      if (UNITS[word] !== undefined) {
        out.push(String(UNITS[word]));
        continue;
      }

      out.push(word);
    }

    return out.join(' ');
  }

  /**
   * Split "3 cb" into three of whatever "cb" finds.
   *
   * Adding three of something meant finding it and then tapping plus three
   * times. Every till lets you say the number first, and a waiter taking a
   * table of six says "three biryani" before they say which biryani.
   *
   * Only a leading number followed by something else counts. A bare "65" is a
   * search for Chicken 65, not an order for sixty-five of the next thing
   * touched, and "2 65" is two of it. The number is capped because a slipped
   * finger on a phone keypad should not send ninety-nine mains to a kitchen.
   *
   * @param {string} value what was typed
   * @returns {{quantity: number, term: string}}
   */
  function parseTerm(value) {
    /*
     * The space is optional, because a thumb in a hurry does not type one.
     *
     * "2 cb" worked and "2cb" did not, which is a distinction nobody typing at
     * a table is making on purpose. The number has to be followed by a LETTER
     * for the no-space form to count, so "chicken 65" is still a dish and not
     * sixty-five of something - the rule that keeps a number inside a name
     * safe is that a name's digits are not at the front.
     */
    const text = String(value || '');
    const match = text.match(/^\s*(\d{1,2})\s+(\S.*)$/) || text.match(/^\s*(\d{1,2})([a-z].*)$/i);
    if (!match) return { quantity: 1, term: text };
    const quantity = Math.min(Math.max(Number(match[1]), 1), 99);
    return { quantity, term: match[2] };
  }

  /** First letter of each word: "Masala Dosa Paper" -> "mdp". */
  const initialsOf = (words) => words.map((w) => w[0]).join('');

  /**
   * How well one item matches one token, or null for no match.
   *
   * @param {{name: string, code?: string}} indexed  an item prepared by index()
   * @param {string} token  a single folded search token
   */
  function scoreToken(indexed, token) {
    if (!token) return null;
    if (indexed.name === token) return EXACT;
    if (indexed.name.startsWith(token)) return PREFIX;

    /* A code is matched whole, never partially: half a barcode is a
       coincidence, not an intent. */
    if (indexed.code && indexed.code === token) return EXACT;

    for (const word of indexed.words) {
      if (word.startsWith(token)) return WORD_START;
    }
    if (indexed.initials.startsWith(token) && token.length > 1) return INITIALS;
    if (indexed.name.includes(token)) return CONTAINS;
    return null;
  }

  /**
   * Prepare items once, so typing does not redo this per keystroke.
   *
   * The old search flattened every category and lowercased every name on every
   * input event. On a menu of a few hundred items that is work repeated for
   * each letter, on the device least able to spare it.
   */
  function index(items) {
    const ear = sounds();
    return (items || []).flatMap((item) => [item.name, ...(item.translations || []).map(row => row.name)].filter(Boolean).map(alias => {
      const name = fold(alias);
      const words = name.split(' ').filter(Boolean);
      return {
        item,
        name,
        words,
        initials: initialsOf(words),
        /* Computed once here, not per keystroke: on the cheap Android a
           restaurant actually buys, a few hundred names re-keyed on every
           letter is the difference between a list and a stutter. */
        sounds: ear ? ear.words(item.name) : [],
        code: fold(item.sku || item.code || item.barcode_id || '') || null,
      };
    }));
  }

  /**
   * Search prepared items.
   *
   * @param {Array} indexed  from index()
   * @param {string} term    what was typed
   * @returns {Array} the original items, best match first
   */
  function search(indexed, term, options = {}) {
    const popular = options.popular instanceof Set ? options.popular : new Set();
    if (!tokensOf(term).length) return (indexed || []).map((entry) => entry.item);

    /*
     * THREE ATTEMPTS, EACH ONLY IF THE ONE BEFORE FOUND NOTHING.
     *
     * Strictly additive, which is the whole safety argument: a search that
     * matched something today matches exactly the same things in the same
     * order tomorrow, because the later passes never run for it. The only
     * searches that change are the ones that used to come back empty.
     *
     * The two extra passes are separate options ON PURPOSE, because they carry
     * different certainty. `numbers` rewrites spoken numerals to digits, which
     * is deterministic - a hit is as good as a typed one. `heard` also allows
     * a phonetic match, which is a GUESS, and a caller that turns it on must
     * present what comes back as something to confirm rather than as a fact.
     * Reporting a guess as a certainty is how the wrong dish reaches a
     * kitchen without anybody being asked.
     */
    const first = rank(indexed, tokensOf(term), popular);
    if (first.length) return first;

    /*
     * "chicken sixty five" is Chicken 65, written the way every board in Tamil
     * Nadu writes it. A deterministic rewrite, not a guess, so a caller may
     * treat a hit here as a certainty.
     */
    if (options.numbers || options.heard) {
      const asDigits = numerals(term);
      if (asDigits !== fold(term)) {
        const second = rank(indexed, tokensOf(asDigits), popular);
        if (second.length) return second;
      }
    }

    /*
     * And finally, what it SOUNDS like - for speech only.
     *
     * A waiter who types has seen what they typed and can fix it; a waiter who
     * speaks has seen nothing yet, and "biriyani" coming back as "briyani" is
     * not their mistake to fix. Typing stays exactly as predictable as it was:
     * the same keystrokes always produce the same order.
     */
    if (options.heard) {
      const heard = byEar(indexed, term, popular);
      if (heard.length) return heard;
    }

    return [];
  }

  /** One pass of the ranked match, over already-folded tokens. */
  function rank(indexed, tokens, popular) {
    if (!tokens.length) return [];

    const hits = [];
    for (const entry of indexed || []) {
      let total = 0;
      let matchedAll = true;

      for (const token of tokens) {
        const score = scoreToken(entry, token);
        if (score === null) {
          matchedAll = false;
          break;
        }
        /* The worst token decides the rank, so one weak match cannot be
           carried by a strong one: "chick zzz" must not rank above "chick". */
        total = Math.max(total, score);
      }
      if (matchedAll) hits.push({ entry, score: total });
    }

    /*
     * Within a rank, what the shop actually sells wins.
     *
     * "cb" matches Chicken Biryani and Creme Brulee equally well by initials,
     * and nothing in the text can separate them - but a shop that sells two
     * hundred biryanis a day and one dessert a week has already answered. The
     * popular set comes from the frequent-items the app fetches anyway, so
     * this costs no extra request.
     *
     * A tiebreak, deliberately, not a rank of its own: a popular item must
     * never outrank a better textual match, or typing more letters would move
     * the row somebody was aiming at.
     */
    return order(hits, popular);
  }

  /*
   * Within a rank, what the shop actually sells wins.
   *
   * "cb" matches Chicken Biryani and Creme Brulee equally well by initials,
   * and nothing in the text can separate them - but a shop that sells two
   * hundred biryanis a day and one dessert a week has already answered. The
   * popular set comes from the frequent-items the app fetches anyway, so this
   * costs no extra request.
   *
   * A tiebreak, deliberately, not a rank of its own: a popular item must never
   * outrank a better textual match, or typing more letters would move the row
   * somebody was aiming at.
   */
  function order(hits, popular) {
    const rankOf = (entry) => (popular.has(String(entry.item.id)) ? 0 : 1);
    hits.sort((a, b) =>
      a.score - b.score ||
      rankOf(a.entry) - rankOf(b.entry) ||
      a.entry.name.length - b.entry.name.length ||  // the shorter name is the likelier intent
      a.entry.name.localeCompare(b.entry.name)
    );
    const seen = new Set();
    return hits.map((hit) => hit.entry.item).filter(item => {
      const key = item.id == null ? item : String(item.id);
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  }

  /**
   * What it sounded like, when nothing it was spelled like matched.
   *
   * EVERY WORD SAID HAS TO LAND. Scoring a fraction and taking the best would
   * match "chicken biryani" to "Mutton Biryani" on the strength of the half
   * that is right, which is the one mistake nobody would forgive at a table.
   * So a hit means every spoken word was heard somewhere in the name, and a
   * name with fewer spare words wins - "biryani" alone prefers plain Biryani
   * over Chicken Biryani Family Pack.
   */
  function byEar(indexed, term, popular) {
    const ear = sounds();
    if (!ear) return [];

    const spoken = ear.words(term);
    if (!spoken.length) return [];

    /*
     * At least one sound with some substance in it.
     *
     * A one-sound key is most of the dictionary, so a phrase made entirely of
     * them ("a", "uh", "the") would match half the menu. One solid word earns
     * the phrase a hearing; the short ones still have to land, which is what
     * keeps "zzzz briyani" from passing as "briyani".
     */
    if (!spoken.some((sound) => sound.length >= ear.ENOUGH)) return [];

    const hits = [];
    for (const entry of indexed || []) {
      if (!entry.sounds || !entry.sounds.length) continue;

      const pool = entry.sounds.slice();
      let heard = 0;
      for (const one of spoken) {
        const at = pool.indexOf(one);
        if (at === -1) break;
        pool.splice(at, 1);
        heard += 1;
      }
      if (heard !== spoken.length) continue;

      hits.push({ entry, score: SOUNDS + pool.length });
    }
    return order(hits, popular);
  }

  return {
    fold, index, search, scoreToken, parseTerm, numerals,
    RANK: { EXACT, PREFIX, WORD_START, INITIALS, CONTAINS, SOUNDS },
  };
});
