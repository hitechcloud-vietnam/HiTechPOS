/*
 * What a word SOUNDS like, for a menu spoken in Indian English.
 *
 * WHY NOT SOUNDEX OR METAPHONE. Both were built for English surnames in
 * American census records. They fold the confusions an American clerk makes
 * and keep the ones that matter here: Soundex puts "paneer" and "panner" in
 * different buckets, and separates "dosa" from "thosai", which are the same
 * word written by two people. Running an algorithm tuned for Massachusetts
 * over a Tamil Nadu menu is worse than running nothing, because it looks like
 * it works.
 *
 * WHAT ACTUALLY GOES WRONG HERE. A recogniser trained on English transcribes
 * Indian food words by ear, and the same dish comes back a dozen ways:
 *
 *   biryani / biriyani / briyani / bryani / biriani
 *   paneer / panner / paner / panir
 *   dosa / dosai / thosai / dhosa
 *   parotta / porotta / barotta
 *   vada / wada / vadai
 *   gobi / gopi / gobhi
 *
 * Every one of those is the same handful of substitutions:
 *
 *   - ASPIRATION IS SPELLING, NOT SOUND. th/t, dh/d, bh/b, kh/k, ph/f are one
 *     sound each to the speaker. A transcript picks whichever it likes.
 *   - VOICING SLIDES. p/b, t/d, k/g, s/z - Tamil has no voicing contrast in
 *     the same places English does, so a recogniser guesses and guesses badly.
 *   - v AND w ARE ONE LETTER. "vada" and "wada" are not two words.
 *   - VOWELS ARE NOISE. They carry almost nothing in a dish name and they are
 *     where a recogniser errs most: biryani, biriyani and bryani differ only
 *     in vowels and are the same order.
 *   - DOUBLED LETTERS ARE A WRITING CHOICE. panner, paneer, paner.
 *
 * So the key is a consonant skeleton with those classes folded together. It is
 * deliberately coarse. It is the LAST thing tried, after exact and prefix
 * matching have failed, and anything it finds is shown to the waiter to
 * confirm rather than added silently - so a wrong guess costs a tap, and a
 * right one saves an order.
 *
 * WHAT IS DELIBERATELY KEPT APART. l and r stay different, and m and n stay
 * different: folding those would put "rice" and "lice" in one bucket for no
 * gain, because they are not the confusions that actually happen.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SoundsLike = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /*
   * Consonants that a listener here cannot reliably tell apart, one letter per
   * class. The letter chosen to stand for a class is arbitrary; only the
   * grouping matters.
   */
  const CLASS = {
    /* Voicing, and v/w, which are one letter to the speaker. */
    b: 'B', p: 'B', v: 'B', w: 'B',
    /*
     * f STANDS ALONE, and this was a real bug rather than a nicety.
     *
     * Folding f in with p and b - which is defensible, since Tamil has no f
     * and "coffee" is said "kaapi" - put "coffee" and "gobi" in the same
     * bucket, both KB. A waiter asking for a coffee and being offered Gobi
     * Manchurian is exactly the kind of confident wrong answer this whole file
     * exists to avoid.
     *
     * The trade is that "copy" no longer reaches "coffee". That is the right
     * way round: a wrong item on a bill costs an argument at a table, and a
     * missed match costs saying it again.
     */
    f: 'F',
    c: 'K', k: 'K', g: 'K', q: 'K',
    d: 'T', t: 'T',
    s: 'S', z: 'S', j: 'S', x: 'S',
    m: 'M',
    n: 'N',
    l: 'L',
    r: 'R',
    h: '',
    y: '',
  };

  /*
   * The shortest key worth trusting.
   *
   * A one-sound key is most of the dictionary. "tea" and "toe" both reduce to
   * T, and a word that short has already been caught by exact or prefix
   * matching before anything here is reached.
   */
  const ENOUGH = 2;

  const VOWELS = 'aeiou';

  /**
   * The sound of one word.
   *
   * Returns '' for anything with no consonants in it, which the callers treat
   * as "no opinion" rather than as a match - otherwise every vowel-only noise
   * a recogniser emits would match every other one.
   */
  /*
   * A MENU SAID IN THE SCRIPT IT IS SAID IN.
   *
   * Owner: "multi language possible or not? i know chatgpt supports".
   *
   * Set a shop's voice language to ta-IN and the recogniser stops handing back
   * "rendu chicken biryani" and starts handing back the Tamil for it. Every
   * normaliser downstream of here throws away anything outside a-z, so the key
   * came out empty, the search found nothing, and not one item reached the
   * cart - while the microphone, the waveform and the transcript on screen all
   * went on looking perfectly healthy. The settings screen RECOMMENDED that
   * language, which made it a trap rather than a limitation.
   *
   * WHY A TRANSLITERATION AND NOT A SECOND MATCHER. Everything below drops
   * vowels and folds aspiration and voicing, so the only thing a romanisation
   * has to get right is roughly which CONSONANTS were said. That is a table,
   * not an algorithm, and the tolerance already built into key() absorbs the
   * rest: "சிக்கன் பிரியாணி" romanises to "chikkan piriyaani", which is not how
   * anybody spells it and lands on SKNBRN all the same - the same key as
   * "Chicken Biryani".
   *
   * It is deliberately NOT a correct transliteration. Where being accurate and
   * being CONSISTENT WITH HOW THE MENU IS SPELLED disagree, spelling wins: ழ
   * becomes "zh" rather than the l-ish sound it really is, because a shop that
   * writes "Kuzhambu" in Latin needs both sides to fold the same way.
   *
   * Two scripts, because they are the two the estate speaks. Adding a third is
   * a table and nothing else.
   */
  const INDIC = /[\u0900-\u097F\u0B80-\u0BFF]/;

  /* Consonants. The value is what it contributes BEFORE its vowel. */
  const CONSONANTS = {
    /* Tamil */
    '\u0B95': 'k', '\u0B99': 'ng', '\u0B9A': 'ch', '\u0B9E': 'n',
    '\u0B9F': 't', '\u0BA3': 'n', '\u0BA4': 'th', '\u0BA8': 'n',
    '\u0BA9': 'n', '\u0BAA': 'p', '\u0BAE': 'm', '\u0BAF': 'y',
    '\u0BB0': 'r', '\u0BB1': 'r', '\u0BB2': 'l', '\u0BB3': 'l',
    '\u0BB4': 'zh', '\u0BB5': 'v', '\u0BB6': 'sh', '\u0BB7': 'sh',
    '\u0BB8': 's', '\u0BB9': 'h', '\u0B9C': 'j',
    /* Devanagari */
    '\u0915': 'k', '\u0916': 'kh', '\u0917': 'g', '\u0918': 'gh',
    '\u0919': 'ng', '\u091A': 'ch', '\u091B': 'chh', '\u091C': 'j',
    '\u091D': 'jh', '\u091E': 'n', '\u091F': 't', '\u0920': 'th',
    '\u0921': 'd', '\u0922': 'dh', '\u0923': 'n', '\u0924': 't',
    '\u0925': 'th', '\u0926': 'd', '\u0927': 'dh', '\u0928': 'n',
    '\u092A': 'p', '\u092B': 'ph', '\u092C': 'b', '\u092D': 'bh',
    '\u092E': 'm', '\u092F': 'y', '\u0930': 'r', '\u0932': 'l',
    '\u0933': 'l', '\u0935': 'v', '\u0936': 'sh', '\u0937': 'sh',
    '\u0938': 's', '\u0939': 'h',
  };

  /*
   * Vowel signs, and the vowels they are spelled as HERE.
   *
   * Long i is "ee" and long u is "oo" rather than "ii" and "uu", which is not
   * the scholarly choice and is the one that works: the numbers a waiter says
   * are matched as WORDS, and the table they are matched against holds "teen"
   * and "moonu" because that is how people write them down.
   */
  const SIGNS = {
    /* Tamil */
    '\u0BBE': 'aa', '\u0BBF': 'i', '\u0BC0': 'ee', '\u0BC1': 'u',
    '\u0BC2': 'oo', '\u0BC6': 'e', '\u0BC7': 'ee', '\u0BC8': 'ai',
    '\u0BCA': 'o', '\u0BCB': 'oo', '\u0BCC': 'au',
    /* Devanagari */
    '\u093E': 'aa', '\u093F': 'i', '\u0940': 'ee', '\u0941': 'u',
    '\u0942': 'oo', '\u0943': 'ri', '\u0947': 'e', '\u0948': 'ai',
    '\u094B': 'o', '\u094C': 'au',
  };

  /* Vowels standing on their own, at the start of a word. */
  const LONE_VOWELS = {
    /* Tamil */
    '\u0B85': 'a', '\u0B86': 'aa', '\u0B87': 'i', '\u0B88': 'ee',
    '\u0B89': 'u', '\u0B8A': 'oo', '\u0B8E': 'e', '\u0B8F': 'ee',
    '\u0B90': 'ai', '\u0B92': 'o', '\u0B93': 'oo', '\u0B94': 'au',
    /* Devanagari */
    '\u0905': 'a', '\u0906': 'aa', '\u0907': 'i', '\u0908': 'ee',
    '\u0909': 'u', '\u090A': 'oo', '\u090B': 'ri', '\u090F': 'e',
    '\u0910': 'ai', '\u0913': 'o', '\u0914': 'au',
  };

  /* The vowel-killer. A consonant followed by one of these is bare. */
  const VIRAMA = { '\u0BCD': 1, '\u094D': 1 };

  /* Marks that add a sound of their own, or none. The nukta changes which
     letter it sits on, and every letter it makes folds into the same class as
     the letter it sat on, so it is dropped rather than tabulated. */
  const MARKS = {
    '\u0B82': 'n', '\u0902': 'n', '\u0901': 'n', '\u0903': 'h',
    '\u0BB0\u0BCD': 'r', '\u093C': '', '\u0BC3': 'r',
  };

  const DIGITS = {
    '\u0BE6': '0', '\u0BE7': '1', '\u0BE8': '2', '\u0BE9': '3',
    '\u0BEA': '4', '\u0BEB': '5', '\u0BEC': '6', '\u0BED': '7',
    '\u0BEE': '8', '\u0BEF': '9',
    '\u0966': '0', '\u0967': '1', '\u0968': '2', '\u0969': '3',
    '\u096A': '4', '\u096B': '5', '\u096C': '6', '\u096D': '7',
    '\u096E': '8', '\u096F': '9',
  };

  /**
   * The same words, in letters the rest of this file can read.
   *
   * A no-op for anything already in Latin, which is almost every call, so the
   * cost of supporting two more scripts is one regex test per word.
   *
   * @param {string} text
   * @returns {string}
   */
  function roman(text) {
    const said = String(text == null ? '' : text);
    if (!INDIC.test(said)) return said;

    const letters = Array.from(said);
    let out = '';

    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];

      if (DIGITS[letter]) {
        out += DIGITS[letter];
        continue;
      }
      if (VIRAMA[letter] || MARKS[letter] !== undefined) {
        out += MARKS[letter] || '';
        continue;
      }
      if (SIGNS[letter] !== undefined) {
        out += SIGNS[letter];
        continue;
      }
      if (LONE_VOWELS[letter] !== undefined) {
        out += LONE_VOWELS[letter];
        continue;
      }

      const sound = CONSONANTS[letter];
      if (sound === undefined) {
        out += letter;
        continue;
      }

      const next = letters[i + 1];
      if (next !== undefined && VIRAMA[next]) {
        /* Spelled with no vowel after it, and that is the end of it. */
        out += sound;
        i += 1;
        continue;
      }
      if (next !== undefined && SIGNS[next] !== undefined) {
        out += sound + SIGNS[next];
        i += 1;
        continue;
      }

      /*
       * THE INHERENT VOWEL, AND WHERE IT GOES SILENT.
       *
       * A bare consonant carries an "a" - except at the end of a word, where
       * Hindi simply does not say it. Spell it there anyway and "\u0924\u0940\u0928" comes
       * out "teena", which is not a word in the table of numbers a waiter is
       * matched against, and three stops being a quantity.
       */
      const ends = next === undefined || !INDIC.test(next);
      out += ends ? sound : sound + 'a';
    }

    return out;
  }

  function key(word) {
    const letters = roman(String(word || ''))
      .toLowerCase()
      .normalize('NFD')
      /* Accents off: a transcript may or may not carry them and they never
         distinguish two dishes on the same menu. */
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]/g, '');

    if (!letters) return '';

    /*
     * Digraphs first, before any letter is classed on its own.
     *
     * "sh" and "ch" are single sounds, and both slide towards s here -
     * "chapati" and "shapati" are the same order. Doing this after the
     * per-letter pass would turn "ch" into two consonants and make every word
     * containing it a syllable too long.
     */
    const sounds = letters
      /*
       * Soft c and soft g, before anything else classes them as K.
       *
       * "rice" came out RK, which is not a sound anybody makes, and it put
       * rice next to nothing and away from everything. Same for "juice" and
       * "ginger".
       */
      .replace(/c(?=[eiy])/g, 's')
      .replace(/g(?=[eiy])/g, 'j')
      .replace(/sch/g, 's')
      .replace(/[cs]h/g, 's')
      .replace(/zh/g, 's')
      .replace(/ck/g, 'k')
      .replace(/qu/g, 'k')
      /* Aspiration is spelling, not sound. */
      .replace(/ph/g, 'f')
      .replace(/gh/g, 'g')
      .replace(/kh/g, 'k')
      .replace(/bh/g, 'b')
      .replace(/dh/g, 'd')
      .replace(/th/g, 't')
      .replace(/jh/g, 'j');

    /*
     * A word that STARTS with a vowel is marked, because that is a real
     * difference somebody hears: "idli" and "dal" are not near each other, and
     * dropping the leading vowel would put them one letter apart.
     */
    let out = VOWELS.includes(sounds[0]) ? 'A' : '';
    let last = '';

    for (const letter of sounds) {
      if (VOWELS.includes(letter)) continue;
      const sound = CLASS[letter];
      if (!sound) continue;
      /* Doubled letters are a writing choice: paneer, panner, paner. */
      if (sound === last) continue;
      out += sound;
      last = sound;
    }

    /* Consonants are what carries a dish name. A "word" with none of them is
       a recogniser clearing its throat. */
    return out === 'A' ? '' : out;
  }

  /**
   * Whether two words would be heard as the same word.
   *
   * Short keys are required to match exactly. A two-sound key like "KB" covers
   * an enormous number of words, so allowing any slack there matches
   * everything; a longer key has earned the right to be forgiven a sound.
   */
  function alike(a, b) {
    const left = key(a);
    const right = key(b);
    if (left.length < ENOUGH || right.length < ENOUGH) return false;
    return left === right;
  }

  /**
   * How well one spoken phrase sounds like a dish name, 0 to 1.
   *
   * Word by word rather than as one run of sounds. A recogniser gets ONE word
   * of a name wrong, not all of it, and comparing whole names lets a long name
   * absorb a wrong word - "chicken biryani" would match "mutton biryani" on
   * the strength of the half that is right, which is the one mistake nobody
   * would forgive at a table.
   *
   * Scored against the number of words SAID, so hearing "biryani" against
   * "Chicken Biryani" is a partial match rather than a miss, while hearing
   * "chicken biryani" against "Chicken Biryani Family Pack" is still 1.
   */
  function score(said, name) {
    const spoken = words(said);
    const target = words(name);
    if (!spoken.length || !target.length) return 0;

    const pool = target.slice();
    let hit = 0;

    for (const one of spoken) {
      const at = pool.indexOf(one);
      if (at === -1) continue;
      pool.splice(at, 1);
      hit += 1;
    }

    return hit / spoken.length;
  }

  /** Every word of a phrase, as sounds, with the meaningless ones dropped. */
  function words(text) {
    /*
     * EVERY REAL WORD IS KEPT, even one that reduces to a single sound.
     *
     * These were filtered by length once, and it quietly broke the guarantee
     * the callers depend on: "zzzz briyani" reduces to ["S", "BRN"], the "S"
     * was dropped as too short, and the phrase then matched Chicken Biryani as
     * though the waiter had only said "briyani". A word the caller must
     * account for cannot be one this function has thrown away.
     *
     * Only genuinely empty keys go - a vowel on its own, punctuation, a
     * recogniser clearing its throat. Whether a phrase has enough substance to
     * be matched at ALL is a separate question, and the caller asks it with
     * ENOUGH.
     */
    return roman(String(text || ''))
      .split(/[^A-Za-z0-9]+/)
      .map(key)
      .filter(Boolean);
  }

  return { key, alike, score, words, roman, ENOUGH };
});
