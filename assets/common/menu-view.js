/*
 * Turning a shop's menu into the rows a person reads.
 *
 * WHY THIS IS ITS OWN FILE. The old markup was built inside two different
 * functions in two different files - one for the ordinary list, one for search
 * results - and they had drifted. The search rows showed "Stock: 4" and the
 * ordinary rows showed "Stock: 4" minus what was already in the cart; one knew
 * about discounts and the other did not. Nobody decided that. It happened
 * because the same thing was written twice.
 *
 * So a dish is drawn in exactly one place, here, and both callers use it.
 *
 * It is also the only part of the screen that can be tested at a desk. Every
 * rule below - a struck-through price only when there is a discount, silence
 * rather than "0 min", an icon when there is no photograph - is a decision
 * somebody can get wrong later, and each one has a test because of that.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MenuView = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* globalThis inside here, never `root` - see assets/common/self-test.js for
     the emulator round that rule cost. */

  const escape = (value) =>
    String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /**
   * A description as one line of plain text.
   *
   * Shops paste from Word, from WhatsApp, and from their own website, so a
   * description arrives with tags in it, sometimes escaped once and sometimes
   * twice. None of that belongs in a list being scanned - and a stray <div>
   * rendered as markup would break the row it sits in.
   */
  function plain(value) {
    let text = String(value == null ? '' : value);
    /* Escaped-once markup, which is how most of it arrives. */
    text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    text = text.replace(/<[^>]*>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ');
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * The veg mark this dish carries, or none.
   *
   * Shops spell it every way there is, because the field has been free text
   * for years: "veg", "Vegetarian", "non-veg", "nonveg", "2", "egg". Guessing
   * wrong here is worse than showing nothing, so anything unrecognised shows
   * nothing at all.
   */
  function diet(value) {
    const said = String(value == null ? '' : value)
      .trim()
      .toLowerCase();
    if (!said) return '';
    if (/^(egg|eggetarian|contains[ _-]?egg)$/.test(said)) return 'egg';
    /* "non" first: "non-veg" contains "veg", and testing for veg first marks
       every chicken dish green. That is not a cosmetic bug. */
    if (/non|nv|2/.test(said)) return 'nonveg';
    if (/veg|v|1/.test(said)) return 'veg';
    return '';
  }

  /** What this dish costs now, what it cost before, and the saving. */
  /**
   * Is this dish priced on the day rather than on the card?
   *
   * Whole fish, crab, lobster: the shop cannot print a number because it does
   * not know one until the morning's market. Two of them went out of a real
   * kitchen worth nothing, because every layer took the missing price
   * literally - the row showed 0.00 and the order was accepted.
   *
   * THE FLAG CONTRACT: daily_price says the rate comes from the market, and
   * price_set_on says when somebody last entered it. Priced TODAY the dish is
   * ordinary and the waiter is asked nothing - which is the whole point of the
   * shop setting it when they open, and the difference between a handset that
   * helps and one that interrogates. Priced YESTERDAY it is not ordinary:
   * yesterday's rate for a pomfret is not today's, and charging it quietly is
   * worse than the zero this started as, because it looks right on the bill.
   *
   * `open_price` is always-ask and stays that way: the shop is saying the
   * price is settled at the counter, every single time.
   *
   * A shop that has set no flag at all says the same thing by leaving the
   * price empty, which is how these dishes are set up today, so that counts
   * too - this has to work before the flag reaches every shop.
   */
  function askPrice(product) {
    if (!product) return false;
    if (product.open_price === true) return true;
    if (product.daily_price === true && !pricedToday(product.price_set_on)) return true;
    return !(Number(product.price) > 0);
  }

  /**
   * Was that price entered today, on this handset's calendar?
   *
   * The phone's day, not the server's. The handset is standing in the shop, so
   * they are the same day; and the server decides in the SHOP's timezone and
   * refuses anything stale, so the worst a wrong answer here can do is ask a
   * waiter for a number that is already on the screen.
   *
   * An absent or unreadable date is "not today", which is the safe way round:
   * a question, rather than a stale price carried onto a bill.
   */
  /*
   * THE TRADING DAY STARTS AT SEVEN IN THE MORNING, NOT AT MIDNIGHT.
   *
   * Owner: "daily price starts in the morning only. means 7am. not midnight
   * coz up to 1am restaurant might open."
   *
   * A kitchen sets its fish prices when it opens and serves until one. On a
   * calendar day those prices expire in the middle of service: at midnight the
   * handset would start asking waiters for numbers they were given at eleven
   * that morning, and the till would refuse the dishes until somebody re-typed
   * them - during the last push of the night.
   *
   * Shifting the clock back seven hours before the date is read moves the
   * boundary into the dead hour instead. A price entered at 11am is still
   * current at half past midnight and goes stale at 7am, when the shop is
   * opening anyway and about to set the new day's rates.
   *
   * The same seven as the till. Four screens ask this question separately and
   * must answer it the same way, or a waiter is asked for a price the bill
   * already knows.
   */
  const DAY_STARTS_AT_HOUR = 7;

  function tradingDay(d) {
    const shifted = new Date(d.getTime() - DAY_STARTS_AT_HOUR * 60 * 60 * 1000);
    return `${shifted.getFullYear()}-${shifted.getMonth() + 1}-${shifted.getDate()}`;
  }

  function pricedToday(setOn) {
    if (!setOn) return false;
    const when = new Date(setOn);
    if (Number.isNaN(when.getTime())) return false;
    return tradingDay(when) === tradingDay(new Date());
  }

  function pricing(product) {
    const price = Number(product.price) || 0;
    const off = Number(product.discount_price) || 0;
    const now = Math.max(0, price - off);
    /* A struck-through price identical to the price is noise, and a "0% off"
       is worse than noise. */
    const discounted = off > 0 && now < price;
    return {
      now,
      was: discounted ? price : 0,
      percent: discounted ? Math.round((off / price) * 100) : 0,
    };
  }

  // Presentation only: retain the server's catalogue values for ordering.
  function displayPricing(product, mode = globalThis.CaptainPhone?.priceMode() || 'including') {
    const storedPrice = product.selling_price ?? product.subtotal;
    const normalized = storedPrice != null && Number.isFinite(Number(storedPrice));
    const cost = pricing(normalized ? { ...product, price: Number(storedPrice) } : product);
    const rate = Math.max(0, Number(product.tax) || 0) / 100;
    const inclusive = product.tax_type === 'inclusive';
    const factor = globalThis.CaptainMoney?.current?.().factor || 100;
    const round = n => Math.round((n + Number.EPSILON) * factor) / factor;
    const extra = Math.max(0, Number(product.tax_price) || 0);
    const total = normalized && Number.isFinite(Number(product.final_price)) ? Number(product.final_price) :
      inclusive ? cost.now : cost.now + (extra || cost.now * rate);
    const tax = inclusive ? (rate ? total - total / (1 + rate) : 0) : (extra || cost.now * rate);
    const before = round(total - tax);
    const effectiveRate = rate || (before > 0 ? tax / before : 0);
    const convert = n => mode === 'excluding' ? (inclusive ? n / (1 + effectiveRate) : n) : (inclusive ? n : n * (1 + effectiveRate));
    return { ...cost, now: round(mode === 'excluding' ? before : total),
      was: cost.was ? round(convert(cost.was)) : 0, tax: round(tax),
      label: tax > 0 ? (mode === 'excluding' ? 'Excluding tax' : 'Including tax') : '' };
  }

  function priceLabel(cost) {
    if (!cost.label) return '';
    return '<span class="dish-tax">' + escape(globalThis.I18N?.t(cost.label) || cost.label) +
      (cost.label === 'Excluding tax' ? ' · + ' + money(cost.tax) : '') + '</span>';
  }

  /** Whether it can be ordered, and what to say if not. */
  function stock(product, inCart) {
    const unlimited = product.negative_stock === true;
    const have = Number(product.available_quantity) || 0;
    if (unlimited) return { out: false, left: null };
    const left = Math.max(0, have - (inCart || 0));
    return {
      out: have <= 0,
      /* Said only when it is nearly gone. "47 left" is not information a
         waiter needs while taking an order; "2 left" is the whole order. */
      left: !left || left > 5 ? null : left,
    };
  }

  const money = (amount, symbol) => typeof CaptainMoney !== 'undefined' ? escape(symbol ? CaptainMoney.format(amount,{currency:symbol}) : CaptainMoney.display(amount)) : escape(symbol || '₹') + (Number(amount) || 0).toFixed(2);

  /**
   * One dish, one row.
   *
   * `quantity` is how many are already on the bill, which decides whether the
   * button is ADD or a stepper. Both occupy the same box so the row never
   * changes height - a list that reflows under a thumb is a list that gets the
   * wrong thing tapped.
   */
  function dish(product, quantity, options) {
    const opts = options || {};
    const qty = Number(quantity) || 0;
    const id = escape(product.id);
    const held = stock(product, qty);
    const cost = displayPricing(product);
    const mark = diet(product.diet);
    const note = plain(product.description);
    const prep = Number(product.prep_minutes) || 0;
    const periods = globalThis.ServingPeriods?.describe(product) || [];
    const serving = periods.map(period => '<span class="dish-serving' + (period.active ? ' is-current' : '') + '"><span translate="no">' + escape(period.name) + '</span>' + '<span data-serving-active' + (period.active ? '' : ' hidden="hidden"') + '><span aria-hidden="true"> · </span><span>Available</span></span>' + '</span>').join('');
    const popular = opts.popular instanceof Set && opts.popular.has(String(product.id));

    /*
     * Whether there IS a photograph is decided before it is resolved.
     *
     * The resolver substitutes a placeholder for an empty path, because the
     * cart and the frequent strip render a bare <img> and an empty `src` makes
     * a browser re-request the page itself. Asking it first would hand this
     * row a grey square and the icon below would never be reached.
     */
    const photo = product.img || product.image || product.item_image;
    const image = photo ? (opts.image ? opts.image(photo) : photo) : '';

    const classes = ['dish'];
    if (held.out) classes.push('is-out');
    else if (qty > 0) classes.push('is-in');

    /*
     * The number, where a waiter will read it without looking for it.
     *
     * Shown on every row rather than only on a card by the till, because that
     * is how anybody learns them: the number sits beside the dish they are
     * tapping anyway, and after a week they stop tapping and start typing.
     */
    const number = opts.numbers instanceof Map ? opts.numbers.get(String(product.id)) : null;
    const numberMark = number
      ? '<span class="dish-no" aria-label="Number ' + number + '">' + number + '</span>'
      : '';

    /*
     * The picture, or the dish's own icon.
     *
     * `onerror` matters more here than it looks: a shop's images live on the
     * till, and a handset that has walked out of Wi-Fi range gets a broken
     * image glyph in every row. Falling back to the icon keeps the menu
     * looking like a menu when the network does not cooperate.
     */
    const media = image
      ? '<img class="dish-photo" src="' +
        escape(image) +
        '" alt="" loading="lazy" ' +
        'onerror="MenuView.noPhoto(this)" data-icon="' +
        escape(product.icon || '') +
        '">'
      : '<div class="dish-icon" aria-hidden="true">' + escape(product.icon || '\u{1f37d}') + '</div>';

    let action;
    if (held.out) {
      action = '<div class="dish-outmark">Sold out</div>';
    } else if (qty > 0) {
      action =
        '<div class="dish-step">' +
        '<button type="button" class="btn-decrease" data-id="' +
        id +
        '" aria-label="One fewer">−</button>' +
        '<span class="dish-qty" id="qty-' +
        id +
        '">' +
        qty +
        '</span>' +
        '<button type="button" class="btn-increase" data-id="' +
        id +
        '" aria-label="One more">+</button>' +
        '</div>';
    } else {
      action = '<button type="button" class="dish-add btn-add" data-id="' + id + '">ADD</button>';
    }

    return (
      '<div class="' +
      classes.join(' ') +
      '" data-id="' +
      id +
      '" data-category="' +
      escape(product._categoryKey || '') +
      '">' +
      '<div class="dish-text">' +
      (mark ? '<span class="dish-diet is-' + mark + '" title="' + mark + '"></span>' : '') +
      (popular ? '<span class="dish-badge">Bestseller</span>' : '') +
      (periods.length ? '<div class="dish-serving-periods" data-serving="' + escape(JSON.stringify({serving_periods:product.serving_periods,serving_time_zone:product.serving_time_zone})) + '">' + serving + '</div>' : '') +
      '<p class="dish-name" translate="no">' +
      numberMark +
      escape(globalThis.ItemLanguage ? globalThis.ItemLanguage.name(product) : product.name) +
      '</p>' +
      '<div class="dish-price">' +
      /*
       * "Today's price" rather than 0.00. A zero on a menu row reads as free,
       * and a waiter who believes it sends a table a fish for nothing.
       */
      (askPrice(product) ? '<span class="dish-ask">Today\'s price</span>' : money(cost.now, opts.currency)) +
      (cost.was
        ? '<span class="dish-was">' +
          money(cost.was, opts.currency) +
          '</span><span class="dish-off">' +
          cost.percent +
          '% off</span>'
        : '') +
      '</div>' +
      (!askPrice(product) ? priceLabel(cost) : '') +
      (note ? '<p class="dish-note" translate="no">' + escape(note) + '</p>' : '') +
      (prep ? '<div class="dish-prep">⏱ ' + prep + ' <span>min</span></div>' : '') +
      '</div>' +
      '<div class="dish-media">' +
      media +
      '<div class="dish-action">' +
      action +
      '</div>' +
      (held.left ? '<div class="dish-left">Only ' + held.left + ' left</div>' : '') +
      '</div>' +
      '</div>'
    );
  }

  /**
   * A photograph that did not load, replaced by the icon.
   *
   * Called from the img's own onerror. Swapping the element rather than hiding
   * it keeps the row's geometry, so a menu on a bad connection settles into
   * shape once instead of jittering as each image gives up.
   */
  function noPhoto(img) {
    if (!img || !img.parentNode) return;
    const icon = img.getAttribute('data-icon') || '\u{1f37d}';
    const tile = img.ownerDocument.createElement('div');
    tile.className = 'dish-icon';
    tile.setAttribute('aria-hidden', 'true');
    tile.textContent = icon;
    img.parentNode.replaceChild(tile, img);
  }

  /**
   * The menu, in the order a shop put it in.
   *
   * `products` is what loadProducts built: a category key to a list of dishes.
   * The "all" key it also builds is skipped - it is every dish over again, and
   * drawing it would double the menu.
   */
  /*
   * THE TILL'S FLAT LIST, AS SECTIONS.
   *
   * IndexedDB hands back one long list, and every screen that draws the menu
   * wants it grouped by category in the shop's own order. Two screens grouping
   * it separately is two chances to group it differently, and a dish's NUMBER
   * is its position in that order: a difference is a waiter reading 33 off the
   * wall and tapping something else.
   *
   * So the grouping lives here once, and the card on the wall and the picker
   * in the hand cannot drift apart without this function changing.
   */
  function fromFlat(list, options) {
    const grouped = {};
    for (const item of list || []) {
      const key = item.category_name || 'Menu';
      (grouped[key] = grouped[key] || []).push(item);
    }
    return sections(grouped, options || {});
  }

  function sections(products, options) {
    const opts = options || {};
    const out = [];
    for (const key of Object.keys(products || {})) {
      if (key === 'all') continue;
      const items = products[key] || [];
      if (!items.length) continue;
      out.push({
        key,
        name: items[0].category_name || key.replace(/_/g, ' '),
        /* Where the shop put this category on its card. Number.MAX_VALUE for
           an item stored before this was recorded, so an old cache sinks to
           the bottom rather than jumping to the front. */
        at: Math.min(...items.map((i) => num(i.category_sort))),
        items,
      });
    }

    /*
     * THE SHOP'S OWN ORDER.
     *
     * A menu is not alphabetical and it is not arbitrary: starters come before
     * mains and desserts come last, because that is the order somebody eats in
     * and the order the shop arranged its card in.
     *
     * These arrive keyed by category name out of IndexedDB, which hands rows
     * back sorted by id - so the sections came out in whatever order the items
     * happened to have been created in, which put Desserts second on a real
     * shop's menu. indexedDB.js records the position the server sent.
     */
    out.sort((a, b) => a.at - b.at);

    for (const section of out) {
      section.items = section.items.slice().sort((a, b) => {
        /*
         * Sold out sinks, within its section and never out of it.
         *
         * A dish that is off today belongs under its own heading, so a waiter
         * can say "the biryani is finished". Moved to the bottom of the whole
         * menu it would look as though it had been taken off the card.
         */
        if (opts.soldOutLast !== false) {
          const aOut = stock(a, 0).out ? 1 : 0;
          const bOut = stock(b, 0).out ? 1 : 0;
          if (aOut !== bOut) return aOut - bOut;
        }
        return num(a.item_sort) - num(b.item_sort);
      });
    }
    return out;
  }

  /** A sort position, or the back of the queue if there is not one. */
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER);

  /** Every section, drawn. */
  function render(list, cart, options) {
    const cartMap = cart instanceof Map ? cart : new Map();
    let html = '';
    for (const section of list) {
      html +=
        '<section class="menu-section" id="sec-' +
        escape(section.key) +
        '" data-category="' +
        escape(section.key) +
        '">' +
        '<div class="menu-section-head">' +
        '<span class="menu-section-name" translate="no">' +
        escape(section.name) +
        '</span>' +
        '<span class="menu-section-count">' +
        section.items.length +
        '</span>' +
        '</div>' +
        '<div class="menu-section-items">';
      for (const item of section.items) {
        const line = cartMap.get(item.id);
        html += dish(item, line ? line.quantity : 0, options);
      }
      html += '</div></section>';
    }
    return html;
  }

  /**
   * A NUMBER FOR EVERY DISH, the way a counter till has always had one.
   *
   * Owner: "self manage number. app user itself auto assign 1 to 200 for 200
   * items. if enter 33 then it shows."
   *
   * The oldest trick in the trade and still the fastest: a waiter who sells the
   * same forty dishes learns their numbers in a week and stops reading at all.
   * Typing two digits beats typing four letters and beats scrolling outright.
   *
   * THE NUMBER COMES FROM THE SHOP'S OWN MENU ORDER, not from this phone.
   * Nothing is stored and nothing is assigned: it is the position of the dish
   * in the menu the till sends, counted straight through the sections. So
   * every handset in the building shows the same number for the same dish,
   * without agreeing about anything - and a card printed from the same order
   * matches all of them. A number a phone invented for itself would be a
   * number on one phone, which is worse than no number at all.
   *
   * IT MOVES WHEN THE SHOP MOVES A DISH, and that is why typing a number
   * SHOWS the dish rather than adding it. A waiter's memory of 33 can go stale
   * between a Monday and a Tuesday; the name on the row is what stops a stale
   * memory becoming a wrong plate. Confirmed by a tap, never fired blind.
   */
  function numbers(list) {
    const map = new Map();
    let n = 0;
    for (const section of list || []) {
      for (const item of section.items || []) {
        n += 1;
        map.set(String(item.id), n);
      }
    }
    return map;
  }

  /** The dish a number names, or nothing if the menu is shorter than that. */
  function atNumber(list, wanted) {
    const want = Number(wanted);
    if (!Number.isFinite(want) || want < 1) return null;
    let n = 0;
    for (const section of list || []) {
      for (const item of section.items || []) {
        n += 1;
        if (n === want) return item;
      }
    }
    return null;
  }

  /** The jump index across the top. */
  function rail(list, options) {
    const opts = options || {};
    let html = '';
    for (let i = 0; i < list.length; i += 1) {
      html +=
        '<button type="button" translate="no" class="menu-chip' +
        (i === 0 && opts.markFirst !== false ? ' is-here' : '') +
        '" data-category="' +
        escape(list[i].key) +
        '">' +
        escape(list[i].name) +
        '</button>';
    }
    return html;
  }

  /** Nothing to show, said in words rather than left blank. */
  function nothing(said, why) {
    return (
      '<div class="menu-nothing">' +
      '<div class="menu-nothing-face">\u{1f50d}</div>' +
      '<div class="menu-nothing-said">' +
      escape(said) +
      '</div>' +
      (why ? '<div class="menu-nothing-why">' + escape(why) + '</div>' : '') +
      '</div>'
    );
  }

  return {
    dish,
    sections,
    render,
    rail,
    nothing,
    noPhoto,
    plain,
    diet,
    pricing,
    displayPricing,
    priceLabel,
    /* Exported because the screens have to ask the same question before they
       put a dish in a cart, and two answers to it is how one of them sends a
       free fish. */
    askPrice,
    fromFlat,
    numbers,
    atNumber,
    /* Exported so a test can ask when this screen turns its day. Four
       surfaces answer that separately and must agree; nothing in the app
       calls it. */
    dayStartsAtHour: () => DAY_STARTS_AT_HOUR,
    stock,
    escape,
  };
});
