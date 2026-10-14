/*
 * Turning "two chicken biryani and three coffee" into an order.
 *
 * The recogniser is the easy half to add and the hard half to trust. A
 * restaurant is loud, dish names are proper nouns, and generic speech
 * recognition mangles proper nouns more than anything else: "biryani" comes
 * back as "biriyani", "briyani", "bryani", sometimes "brianni".
 *
 * What saves it is that the answer is never open-ended. The words are matched
 * against THIS shop's menu, which is a few hundred items rather than a
 * language, so a mangled word usually has exactly one plausible neighbour.
 * That is also why voice matching is allowed to be tolerant where typing is
 * not: a waiter who types has seen what they typed, and a waiter who speaks
 * has not seen anything yet.
 *
 * TWO LAYERS, ON PURPOSE.
 *
 *   understand()  what was said, as dishes and quantities. It has no opinion
 *                 about what to DO with them.
 *   commands()    what was MEANT: add these, take those off, make it three,
 *                 send it to the kitchen. A waiter at a table talks in verbs,
 *                 and an app that only hears nouns makes them tap for the
 *                 rest.
 *
 * The verbs are a fixed list rather than anything cleverer, because a
 * restaurant needs the same dozen every night and a misread verb is worse
 * than a misread dish: "remove" heard as "add" doubles an order instead of
 * halving it. Where a shop has an AI provider configured the server can do
 * the reading instead (see voice-order-ui.js); this is what every shop gets.
 *
 * Nothing here orders anything. It produces commands for something else to
 * carry out, and the one that reaches a kitchen is never carried out without
 * a person pressing a button first.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VoiceOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* Spoken numbers, up to what anybody says in one breath at a table. Above
     twenty people say the digits, which the digit branch already handles. */
  const WORDS = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20,
    /* Recognisers hear these for small numbers more often than not. */
    to: 2, too: 2, for: 4, ate: 8,

    /*
     * TAMIL, because this app is used in Tamil Nadu and a waiter counting
     * plates does it in Tamil whatever language the rest of the sentence is
     * in. "rendu chicken biryani" is two, and it is what gets said.
     *
     * Spelled the way a recogniser set to English transcribes the sound, and
     * several ways each, because it guesses differently every time.
     *
     * A FEW OF THESE ARE NOT GUESSES. `rentu`, `eezhu`, `onpathu`, `paththu`
     * are what the Tamil script for those numbers romanises to in
     * sounds-like.js - so a shop whose voice language is ta-IN, whose
     * recogniser hands back Tamil letters, counts too. They look like
     * misspellings and they are the exact output of a deterministic table;
     * change that table and these have to move with it.
     */
    onnu: 1, ondru: 1, onru: 1, onnum: 1, oru: 1,
    rendu: 2, irandu: 2, rendo: 2, rentu: 2,
    moonu: 3, moondru: 3, munu: 3,
    naalu: 4, naangu: 4, nalu: 4,
    anju: 5, ainthu: 5, anchu: 5,
    aaru: 6, aru: 6,
    ezhu: 7, elu: 7, eezhu: 7,
    ettu: 8,
    onbathu: 9, onbadhu: 9, onpathu: 9,
    pathu: 10, patthu: 10, paththu: 10,

    /*
     * HINDI, for the same reason one town over.
     *
     * "do" is DELIBERATELY ABSENT even though it is Hindi for two. It is also
     * the commonest English auxiliary verb there is, and "do you have chicken
     * biryani" would come through as two of something called "have chicken
     * biryani" - which matches nothing, so a perfectly good question becomes
     * a silence. Two is the one number a waiter can always say another way.
     */
    ek: 1, teen: 3, chaar: 4, paanch: 5, saat: 7, aath: 8, nau: 9, das: 10,
  };

  /*
   * NUMBERS THAT ONLY SURVIVE IN THEIR OWN SCRIPT.
   *
   * "do" is left out of the table above on purpose: it is Hindi for two and
   * also the commonest English auxiliary there is, so "do you have chicken
   * biryani" would come through as two of something. That ambiguity is a fact
   * about LATIN LETTERS and nothing else. \u0926\u094B is two and cannot be anything
   * else, so it is read as two before it is ever romanised into the word that
   * would have to be thrown away.
   *
   * Anything else a shop counts in reaches the table above intact, which is
   * why this holds exactly one entry rather than a second copy of the list.
   */
  const SCRIPT_WORDS = { '\u0926\u094B': '2' };

  /*
   * HOW A DISH IS WANTED, as opposed to which dish it is.
   *
   * "chicken biryani without onion" is one line with a note on it, not a
   * biryani and a mystery. The note is what the kitchen ticket needs and the
   * app has carried a field for it all along - the cart calls it
   * item_description, and the notes modal on the menu writes the same field -
   * so a spoken requirement lands exactly where a typed one does.
   *
   * ONLY MARKER-INTRODUCED CLAUSES ARE TAKEN, never a bare adjective. No dish
   * is called "something without onion", so splitting on "without" is safe;
   * plenty of dishes are called "Plain Dosa" or "Spicy Chicken", and a rule
   * that stripped bare adjectives would quietly search for the wrong dish.
   */
  const MARKERS = new Set([
    'without', 'no', 'with', 'extra', 'more', 'less', 'light', 'hold', 'skip',
    'add', 'minus', 'not',
  ]);

  /*
   * How much of it, which is a note and not a quantity.
   *
   * A half plate is one line on a bill, not half a line, and "one by two" -
   * one drink poured into two cups - is ordered by the hundred every morning
   * in every tea shop in the state. Both change what the kitchen does and
   * neither changes how many.
   */
  const PORTIONS = [
    { say: ['one', 'by', 'two'], note: 'One by two' },
    { say: ['one', 'by', 'three'], note: 'One by three' },
    { say: ['half', 'plate'], note: 'Half plate' },
    { say: ['full', 'plate'], note: 'Full plate' },
    { say: ['quarter', 'plate'], note: 'Quarter plate' },
    { say: ['half'], note: 'Half' },
    { say: ['quarter'], note: 'Quarter' },
  ];

  const MAX = 99;

  /*
   * What a waiter says to change an order, grouped by what it means.
   *
   * Multi-word phrases are listed so they can be matched before their parts:
   * "take off" is a removal, "take" alone is nothing, and "send to kitchen"
   * must be seen before "to" is read as the number two.
   *
   * Removal is the shorter, more careful list. An extra way to say "add" that
   * is wrong costs one line somebody deletes; an extra way to say "remove"
   * that is wrong costs a dish the table asked for. "without" and "no" are
   * deliberately absent - "biryani without onion" and "no ice" are notes on a
   * dish, not dishes taken off.
   */
  const VERBS = {
    add: [
      'add', 'put', 'get me', 'get us', 'give me', 'give us', 'bring', 'bring me',
      'i want', 'we want', 'i need', 'we need', "i'd like", 'i would like', 'we would like',
      'order', 'also', 'plus', 'one more', 'another', 'include',
    ],
    remove: [
      'remove', 'delete', 'cancel', 'take off', 'take out', 'take away', 'minus', 'drop',
      'scrap', 'strike', 'no more', 'less', 'fewer', 'get rid of',
    ],
    set: ['make it', 'make that', 'change it to', 'change to', 'change that to', 'set', 'instead'],
    /* Whole-utterance commands: no dish follows them. */
    place: [
      'send to kitchen', 'send it to kitchen', 'send to the kitchen', 'send it to the kitchen',
      'send this to the kitchen', 'send the order', 'send it', 'send order', 'place order',
      'place the order', 'place this order', 'fire it', 'fire the order', 'submit order',
      'submit the order', 'confirm order', 'confirm the order', "that's all", 'thats all',
      'that is all', 'that will be all', 'all done', 'done', 'finish', 'finished', 'go ahead',
      'punch it', 'punch the order',
    ],
    clear: [
      'clear the cart', 'clear cart', 'clear everything', 'clear it', 'clear all', 'start over',
      'start again', 'empty the cart', 'empty cart', 'cancel everything', 'cancel the order',
      'cancel order', 'cancel all', 'remove everything', 'remove all', 'delete everything',
      'delete all', 'scrap it', 'scrap the order', 'forget it', 'forget that',
    ],
    show: [
      'show cart', 'show the cart', 'show me the cart', 'show order', 'show the order',
      "what's in the cart", 'whats in the cart', 'what is in the cart', 'read it back',
      'read back', 'read the order', 'repeat', 'repeat the order', 'what did i say',
      'what do we have', 'what have we got',
    ],
  };

  /* Longest phrase first, so "take off" is found before "take" could be. */
  const VERB_LIST = Object.keys(VERBS)
    .flatMap((verb) => VERBS[verb].map((phrase) => ({ verb, words: phrase.split(' ') })))
    .sort((a, b) => b.words.length - a.words.length);

  /* Words that carry no order in them. Stripped once, AFTER verbs are found,
     so every rule after this sees "chicken biryani" and not "some of the
     chicken biryani for the table please". */
  const FILLER = new Set([
    'please', 'kindly', 'the', 'some', 'of', 'um', 'uh', 'er', 'like', 'just', 'then', 'so',
    'okay', 'ok', 'now', 'can', 'could', 'you', 'we', 'i', 'me', 'us', 'for', 'table', 'them',
    'it', 'this', 'that', 'those', 'these',
  ]);

  /**
   * Split what was said into one phrase per dish.
   *
   * People separate items with commas, with "and", and with nothing at all.
   * The first two are reliable; the third is not, and is left alone rather
   * than guessed at - a wrong split invents an item that was never ordered.
   */
  function phrases(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/\band\b/g, ',')
      .replace(/\bplus\b/g, ',')
      .split(/[,;\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /**
   * Pull the quantity off the front of one phrase.
   *
   * "two chicken biryani" -> 2, "chicken biryani"
   * "chicken biryani"     -> 1, "chicken biryani"
   *
   * Only the front. A number later in the phrase belongs to the dish -
   * "chicken 65" is a name, not sixty-five chickens - and that distinction is
   * the difference between an order and an incident.
   */
  function quantityOf(phrase) {
    const words = String(phrase || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { quantity: 1, term: '' };

    const digits = words[0].match(/^(\d{1,2})$/);
    if (digits && words.length > 1) {
      return { quantity: clamp(Number(digits[1])), term: words.slice(1).join(' ') };
    }

    const spoken = WORDS[words[0]];
    if (spoken && words.length > 1) {
      return { quantity: clamp(spoken), term: words.slice(1).join(' ') };
    }

    return { quantity: 1, term: words.join(' ') };
  }

  const clamp = (n) => Math.min(Math.max(n, 1), MAX);

  /**
   * Split "chicken biryani without onion" into the dish and the note.
   *
   *   "chicken biryani without onion" -> biryani,  "Without onion"
   *   "no sugar coffee"               -> coffee,   "No sugar"
   *   "half plate chicken 65"         -> chicken 65, "Half plate"
   *   "one by two tea"                -> tea,      "One by two"
   *   "chicken biryani"               -> biryani,  ""
   *
   * A MARKER AFTER THE DISH takes everything to the end, because that is how
   * anybody says it: the dish, then how they want it. A marker BEFORE the dish
   * takes itself and one word - "no sugar coffee", "extra spicy biryani" -
   * because the dish is what follows and swallowing more would eat it.
   *
   * If nothing is left to order, nothing is split. "no onion" on its own is
   * somebody amending the line before, not a dish called onion, and returning
   * an empty term would have the matcher search for nothing and find the first
   * thing on the menu.
   */
  function splitNote(term) {
    let words = String(term || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { term: '', note: '' };

    const notes = [];

    /* Portions first, and anywhere in the phrase: "tea one by two" and "one by
       two tea" are the same order said by two people. */
    for (const portion of PORTIONS) {
      const at = runAt(words, portion.say);
      if (at === -1) continue;
      const rest = words.slice(0, at).concat(words.slice(at + portion.say.length));
      /* Only if a dish survives it. "Half" alone is not an order. */
      if (!rest.length) continue;
      notes.push(portion.note);
      words = rest;
    }

    /* Then the first marker, if one is left. */
    for (let i = 0; i < words.length; i += 1) {
      if (!MARKERS.has(words[i])) continue;

      if (i > 0) {
        const clause = words.slice(i);
        notes.push(sentence(clause.join(' ')));
        words = words.slice(0, i);
      } else {
        /* Leading: the marker and one word, and only if a dish is left. */
        if (words.length < 3) break;
        notes.push(sentence(words.slice(0, 2).join(' ')));
        words = words.slice(2);
      }
      break;
    }

    return { term: words.join(' '), note: notes.join(', ') };
  }

  /** Where a run of words starts inside another, or -1. */
  function runAt(words, run) {
    for (let i = 0; i + run.length <= words.length; i += 1) {
      let hit = true;
      for (let k = 0; k < run.length; k += 1) {
        if (words[i + k] !== run[k]) {
          hit = false;
          break;
        }
      }
      if (hit) return i;
    }
    return -1;
  }

  /* A note goes on a kitchen ticket, so it reads like something written for a
     person rather than a fragment of a transcript. */
  const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  /*
   * Words that make "less" and "fewer" a REQUIREMENT rather than a removal.
   *
   * "less" is in the remove verbs, and rightly - "less coffee" takes one off.
   * But "less spicy" takes nothing off anything; it is the single most common
   * thing said about food in this country, and reading it as a removal both
   * loses the requirement and deletes a dish nobody cancelled.
   */
  const TASTE = new Set([
    'spicy', 'spice', 'salt', 'salty', 'sugar', 'sweet', 'oil', 'oily', 'masala',
    'chilli', 'chili', 'ghee', 'butter', 'ice', 'water', 'milk', 'gravy',
  ]);

  /**
   * What was said, as a list of things to look up.
   *
   * @param {string} text  a transcript
   * @returns {Array<{quantity: number, term: string}>}
   */
  function parse(text) {
    /*
     * HOW IT IS WANTED COMES OFF FIRST, then how many.
     *
     * The other order does not work, and "one by two tea" is why: quantityOf
     * sees a leading "one", takes it as the count, and hands on "by two tea" -
     * from which the portion has already been eaten and can never be
     * recovered. The requirement has to be lifted out while it is still whole.
     *
     * It falls out nicely for the rest too: "two chicken biryani without
     * onion" loses the onion, and what is left is an ordinary "two chicken
     * biryani" for the counter to read.
     */
    return phrases(text)
      .map((phrase) => {
        const wanted = splitNote(phrase);
        const counted = quantityOf(wanted.term);
        return { quantity: counted.quantity, term: counted.term, note: wanted.note };
      })
      .filter((line) => line.term.length > 1);
  }

  /**
   * How close two words are, as a count of single-character edits.
   *
   * Only used for speech, and capped: a word is either nearly right or it is a
   * different word, and allowing three or four edits turns "coffee" into
   * "toffee" into "taffy" and puts something nobody ordered on the bill.
   */
  function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;

    /*
     * Two swapped letters count as one edit, not two.
     *
     * Transposition is the commonest way both a recogniser and a thumb get a
     * word wrong - "briyani" for "biryani" is two adjacent letters exchanged.
     * Plain Levenshtein charges two for that, which put the correct dish out
     * of reach of a one-edit budget while leaving genuinely different words
     * just as far away. Counting it as one is what makes a tight budget
     * usable: it forgives the common mistake without widening the net.
     */
    const rows = [Array.from({ length: b.length + 1 }, (_, i) => i)];
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(rows[i - 1][j] + 1, current[j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          value = Math.min(value, rows[i - 2][j - 2] + 1);
        }
        current[j] = value;
        best = Math.min(best, value);
      }
      if (best > limit) return limit + 1;
      rows.push(current);
    }
    return rows[a.length][b.length];
  }

  /**
   * Match one spoken phrase to a menu item.
   *
   * The exact search runs first and usually wins: constraining to one shop's
   * menu does most of the work, and a transcript is often right. Only when
   * nothing matches at all is the tolerant pass tried, and it reports how it
   * matched so the screen can show a near-miss differently from a certainty.
   *
   * @param {Array} indexed  from ItemSearch.index()
   * @param {string} term
   * @param {object} search  the ItemSearch module
   * @returns {{item: object, exact: boolean}|null}
   */
  function matchOne(indexed, term, search) {
    /*
     * CERTAIN FIRST, THEN LIKELY, THEN ROUGH - and the caller is told which.
     *
     * `numbers` rewrites spoken numerals to digits, so "chicken sixty five"
     * reaches Chicken 65, which is how every board in Tamil Nadu writes it.
     * That is a deterministic rewrite rather than a guess, so a hit is as
     * certain as a typed one.
     *
     * `heard` also allows a PHONETIC match, so "briyani", "panner" and
     * "thosai" reach the right dish. That one is a guess, and it is reported
     * as a near match so the screen shows it to be confirmed rather than
     * adding it silently. Running both in one call would have collapsed that
     * distinction and quietly turned every guess into a certainty.
     */
    const found = search.search(indexed, term, { numbers: true });
    if (found.length) return { item: found[0], exact: true };

    const heard = search.search(indexed, term, { heard: true });
    if (heard.length) return { item: heard[0], exact: false };

    /* One edit for a short word, two for a long one. A five-letter word three
       edits away is a different word. */
    const spoken = search.fold(term);
    const limit = spoken.length > 7 ? 2 : 1;

    let best = null;
    let bestScore = limit + 1;
    for (const entry of indexed) {
      /* Compared word by word: a transcript gets one word wrong, not the
         whole name, and comparing whole names would let a long name absorb
         the difference. */
      for (const word of entry.words) {
        for (const said of spoken.split(' ')) {
          if (said.length < 4) continue; // too short to correct safely
          const d = distance(said, word, limit);
          if (d < bestScore) {
            bestScore = d;
            best = entry.item;
          }
        }
      }
    }
    return best ? { item: best, exact: false } : null;
  }

  /**
   * Everything that was said, matched against the menu.
   *
   * @returns {Array<{quantity, term, item, exact, found}>} in the order spoken
   */
  function understand(text, indexed, search) {
    return parse(text).map((line) => {
      const match = matchOne(indexed, line.term, search);
      return {
        quantity: line.quantity,
        term: line.term,
        /* Goes on the cart line and onto the kitchen ticket, in the same field
           the notes modal on the menu writes. parse() lifted it out. */
        note: line.note,
        item: match ? match.item : null,
        exact: !!(match && match.exact),
        found: !!match,
      };
    });
  }

  /* ------------------------------------------------------------- commands */

  /**
   * Words, lower-cased, with the punctuation a recogniser adds taken off.
   *
   * A comma is a token of its own, never glued to the word before it. The
   * first version left "kitchen," as one word, so "two dosa, send to kitchen,"
   * never matched "send to kitchen" and the order went in as three dishes -
   * one of them a kitchen. Two tests caught it before a waiter did.
   */
  function wordsOf(text) {
    /*
     * Into Latin letters first, if the page has the module that can.
     *
     * Everything below this line - and every table in this file - is written
     * in a-z, so a transcript in Tamil or Devanagari was reduced to spaces by
     * the filter two lines down and the sentence arrived here empty. Romanised
     * first, "\u0BB0\u0BC6\u0BA3\u0BCD\u0B9F\u0BC1 \u0B9A\u0BBF\u0B95\u0BCD\u0B95\u0BA9\u0BCD" is "rentu chikkan", which the number table and
     * the phonetic matcher both understand.
     *
     * Optional, like everywhere else this module is reached: a page that did
     * not load it keeps the behaviour it had.
     */
    let said = String(text || '');
    for (const [written, digits] of Object.entries(SCRIPT_WORDS)) {
      if (said.includes(written)) said = said.split(written).join(` ${digits} `);
    }
    const phonetics = sounds();
    return String((phonetics && phonetics.roman(said)) || said)
      .toLowerCase()
      .replace(/[.!?;]+/g, ' , ')
      .replace(/,/g, ' , ')
      .replace(/[^a-z0-9,'\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * The phonetic module, if the page loaded it.
   *
   * Read through globalThis, never the UMD wrapper's own parameter - that
   * throws inside this factory, and it has cost a round before.
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

  /** The verb phrase that starts at this position, if any. */
  function verbAt(words, at) {
    /*
     * "less spicy" is not a removal.
     *
     * "less" and "fewer" earn their place in the remove verbs - "less coffee"
     * takes one off - but "less spicy" takes nothing off anything, and reading
     * it as a removal both loses the requirement and deletes a dish nobody
     * cancelled. The same word, two jobs, told apart by what follows it.
     */
    if ((words[at] === 'less' || words[at] === 'fewer') && TASTE.has(words[at + 1])) {
      return null;
    }

    for (const entry of VERB_LIST) {
      const n = entry.words.length;
      if (at + n > words.length) continue;
      let hit = true;
      for (let k = 0; k < n; k++) {
        if (words[at + k] !== entry.words[k]) {
          hit = false;
          break;
        }
      }
      if (hit) return { verb: entry.verb, length: n };
    }
    return null;
  }

  /**
   * What was MEANT, as a list of commands in the order they were said.
   *
   *   "add two coffee"                        -> [add 2 Coffee]
   *   "remove one coffee"                     -> [remove 1 Coffee]
   *   "two biryani and take off the coffee"   -> [add 2 Biryani, remove 1 Coffee]
   *   "make it three coffee"                  -> [set 3 Coffee]
   *   "send it to the kitchen"                -> [place]
   *   "two dosa, send to kitchen"             -> [add 2 Dosa, place]
   *   "clear the cart"                        -> [clear]
   *
   * Words before any verb are an addition, because that is what a waiter
   * reading an order off a table is doing. A verb starts a new command and
   * owns every dish until the next verb. "send to kitchen" and its kin own
   * nothing and are moved to the END whatever position they were said in -
   * "send it, and two more coffee" means both, in the only order that makes
   * sense. "clear" goes FIRST, so what follows is added to an empty cart.
   *
   * @returns {Array<{verb: string, lines: Array}>}
   */
  function commands(text, indexed, search) {
    const words = wordsOf(text);
    const out = [];
    let current = null;
    let trailing = null; // place / show, carried out last
    let clearFirst = false;

    const open = (verb) => {
      current = { verb, words: [] };
      out.push(current);
    };

    for (let i = 0; i < words.length; ) {
      const hit = verbAt(words, i);
      if (hit) {
        if (hit.verb === 'place' || hit.verb === 'show') {
          trailing = hit.verb;
        } else if (hit.verb === 'clear') {
          clearFirst = true;
        } else {
          open(hit.verb);
        }
        i += hit.length;
        continue;
      }
      if (words[i] === ',') {
        /* A comma inside a command separates dishes, which understand()
           already handles; kept in place for it. */
        if (current) current.words.push(',');
        i += 1;
        continue;
      }
      if (!current) open('add');
      current.words.push(words[i]);
      i += 1;
    }

    const result = [];
    if (clearFirst) result.push({ verb: 'clear', lines: [] });

    for (const command of out) {
      /* Strip the filler here, AFTER verbs were found: "i want" is a verb and
         "i" is filler, and the verb has to win. */
      const cleaned = command.words
        .filter((w) => w === ',' || !FILLER.has(w))
        .join(' ')
        .replace(/\s+,\s*/g, ', ');
      const lines = understand(cleaned, indexed, search);
      if (lines.length) result.push({ verb: command.verb, lines });
    }

    if (trailing) result.push({ verb: trailing, lines: [] });
    return result;
  }

  return {
    parse, phrases, quantityOf, understand, matchOne, distance, commands, splitNote,
    WORDS, VERBS, MARKERS, PORTIONS,
  };
});
