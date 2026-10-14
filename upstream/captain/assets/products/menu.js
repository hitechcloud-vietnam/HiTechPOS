/*
 * The menu screen: one scroll, sections, and a rail that follows you.
 *
 * MenuView draws the rows. This drives the screen around them - which section
 * you are in, what the bill says, and what happens when a chip is tapped.
 *
 * THE ONE IDEA. The category rail does not FILTER. It reports. Tapping a chip
 * scrolls to that section; scrolling to a section lights its chip. The menu is
 * never rebuilt, so a scroll position is never lost, and a waiter taking "a
 * biryani, a Coke and a gulab jamun" makes that journey once instead of three
 * times with a rebuild in between.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MenuScreen = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  let watcher = null;
  /* The section the rail is currently pointing at, so an unchanged answer
     costs nothing - this runs on every scroll frame. */
  let here = '';
  /* Set while a chip-tap is animating. The scroll it causes passes over every
     section in between, and letting those light the rail makes it flicker
     through six categories on the way to the seventh. */
  let jumping = 0;

  const $ = (selector) => document.querySelector(selector);

  /**
   * Play a one-shot animation again, on an element that already has it.
   *
   * A CSS animation fires when the class ARRIVES, so re-adding a class that is
   * already there does nothing at all - which is exactly the case that matters
   * here, because the second and third taps on the same dish are the ones
   * somebody is least sure registered.
   *
   * Reading offsetWidth between the remove and the add forces the style to be
   * recalculated, so the browser sees the class genuinely leave and come back.
   * It is the standard trick and it is load-bearing: without the read, the two
   * changes are batched into one frame and cancel out.
   */
  function replay(element, className, ms) {
    if (!element) return;
    element.classList.remove(className);
    /* eslint-disable-next-line no-unused-expressions */
    void element.offsetWidth;
    element.classList.add(className);
    setTimeout(() => element.classList.remove(className), ms);
  }

  /**
   * Draw the whole menu.
   *
   * `products` is the category-keyed object loadProducts builds. Everything
   * else is the state a row needs to draw itself correctly the first time,
   * rather than being drawn wrong and corrected.
   */
  function draw(products, cartMap, options) {
    const opts = options || {};
    const list = MenuView.sections(globalThis.MealMenu ? MealMenu.apply(products) : products);
    const rail = $('#category-list');
    const body = $('#product-list');
    if (!body) return list;

    if (!list.length) {
      body.innerHTML = MenuView.nothing(
        'This branch has no items yet',
        'Ask whoever set up the till to add them, then pull to refresh.'
      );
      if (rail) rail.innerHTML = '';
      return list;
    }

    if (rail) rail.innerHTML = MenuView.rail(list);
    body.innerHTML = MenuView.render(list, cartMap, opts);

    stick();
    watch();
    indexRows(list);
    return list;
  }

  /**
   * How far down the sticky headings have to sit.
   *
   * The search box and the rail are both stuck to the top, so a section
   * heading that stops at 0 slides underneath them and disappears. Measured
   * rather than guessed, because the rail is not there while searching and the
   * header's height depends on the phone.
   */
  function stick() {
    const header = $('.mobile-header');
    const search = $('.fixed-heading');
    const rail = $('.fixed-categories');

    const headHigh = header ? header.offsetHeight : 0;
    /* offsetHeight is 0 for a `display: none` element, which is exactly what
       the rail is while searching - so the sums below are right in both
       states without anything having to know which state it is in. */
    const searchHigh = search ? search.offsetHeight : 0;
    const railHigh = rail ? rail.offsetHeight : 0;

    const root = document.documentElement.style;
    root.setProperty('--head-stick', headHigh + 'px');
    root.setProperty('--rail-stick', headHigh + searchHigh + 'px');

    const total = headHigh + searchHigh + railHigh;
    root.setProperty('--menu-stick', total + 'px');
    return total;
  }

  /**
   * Light the chip for whatever section the eye is on.
   *
   * IntersectionObserver rather than a scroll handler: the browser works out
   * what is on screen on its own thread, and a scroll handler that reads
   * getBoundingClientRect for twenty sections is how a list starts to stutter
   * on the cheap Android a restaurant actually buys.
   *
   * The top band is what counts - a section is "the one you are reading" when
   * its heading is near the top of the screen, not when any part of it is
   * visible, or a tall section and the stub below it would both qualify.
   */
  function watch() {
    if (watcher) watcher.disconnect();
    if (typeof IntersectionObserver !== 'function') return;

    const offset = stick();
    watcher = new IntersectionObserver(
      (entries) => {
        if (jumping) return;
        /* The topmost section currently crossing the band. Entries arrive in
           no useful order, so this picks rather than takes the last. */
        let best = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!best || entry.boundingClientRect.top < best.boundingClientRect.top) best = entry;
        }
        if (best) point(best.target.dataset.category);
      },
      {
        /* A band just under the stuck header, about a fifth of the screen
           tall. Everything else is ignored. */
        rootMargin: -(offset + 8) + 'px 0px -75% 0px',
        threshold: 0,
      }
    );
    document.querySelectorAll('.menu-section').forEach((section) => watcher.observe(section));
  }

  /** Say where we are, in the rail and in the index sheet. */
  function point(key) {
    if (!key || key === here) return;
    here = key;

    const chips = document.querySelectorAll('.menu-chip');
    let lit = null;
    chips.forEach((chip) => {
      const on = chip.dataset.category === key;
      chip.classList.toggle('is-here', on);
      if (on) lit = chip;
    });

    document.querySelectorAll('.menu-index-row').forEach((row) => {
      row.classList.toggle('is-here', row.dataset.category === key);
    });

    /*
     * And bring the lit chip into view - BY MOVING THE RAIL, NOT THE PAGE.
     *
     * A rail that says "you are in Desserts" while Desserts is off the
     * right-hand edge has told you nothing. This used to be scrollIntoView
     * with `inline: 'nearest'`, which looks like it only scrolls the rail and
     * does not: scrollIntoView walks every scrollable ancestor, the document
     * included, and it does it with its own smooth animation.
     *
     * TWO SMOOTH SCROLLS ON ONE SCROLLER DO NOT ADD UP - the second replaces
     * the first. goTo() starts the page moving and then calls this, so the
     * chip's animation cut the page's off partway and the section stopped
     * wherever it had got to. Tapping a chip near the right-hand end of the
     * rail, which is the case that makes the rail scroll at all, landed 80px
     * short; tapping one already on screen was fine. That is exactly the shape
     * of "sometimes the category jump does nothing".
     *
     * Setting scrollLeft on the rail itself cannot touch the document.
     */
    const rail = lit && lit.parentElement;
    if (rail && typeof rail.scrollTo === 'function' && rail.scrollWidth > rail.clientWidth) {
      const centred = lit.offsetLeft - (rail.clientWidth - lit.offsetWidth) / 2;
      const most = rail.scrollWidth - rail.clientWidth;
      rail.scrollTo({ left: Math.max(0, Math.min(most, centred)), behavior: 'smooth' });
    }
  }

  /**
   * Go to a section.
   *
   * Scrolled by hand rather than with scrollIntoView, because the heading has
   * to come to rest BELOW the stuck header and scrollIntoView puts it at zero,
   * which is underneath it.
   */
  function goTo(key) {
    const section = document.getElementById('sec-' + key);
    if (!section) return;

    const top = section.getBoundingClientRect().top + window.scrollY - stick() - 4;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

    /* Light it now rather than waiting for the scroll to arrive: a chip that
       responds when you release it feels connected to the tap, and one that
       responds half a second later feels like a guess that happened to work. */
    point(key);
    jumping += 1;
    setTimeout(() => {
      jumping = Math.max(0, jumping - 1);
    }, 700);
  }

  /* ------------------------------------------------------------ the index */

  /**
   * Every category at once, with counts.
   *
   * The rail is fine for six categories and useless for twenty-five, where the
   * one you want is always off the edge. This is the answer to "what else is
   * there", and it is the affordance a long menu lives or dies on.
   */
  function indexRows(list) {
    const holder = $('#menu-index-list');
    if (!holder) return;
    holder.innerHTML = list
      .map(
        (section) =>
          '<button type="button" class="menu-index-row" data-category="' +
          MenuView.escape(section.key) +
          '"><span translate="no">' +
          MenuView.escape(section.name) +
          '</span><span class="menu-index-count">' +
          section.items.length +
          '</span></button>'
      )
      .join('');

    const button = $('#menu-index-btn');
    /* One category is not an index. A shop with a single category gets no
       button rather than a button that scrolls to where it already is. */
    if (button) button.hidden = list.length < 2;
  }

  function openIndex() {
    const sheet = $('#menu-index');
    if (!sheet) return;
    sheet.hidden = false;
    document.body.classList.add('menu-index-open');
  }

  function closeIndex() {
    const sheet = $('#menu-index');
    if (!sheet) return;
    sheet.hidden = true;
    document.body.classList.remove('menu-index-open');
  }

  /* -------------------------------------------------------- the bill bar */

  /**
   * What is on the bill, and the way to it.
   *
   * Hidden while the bill is empty. A bar saying "0 items - ₹0.00 - View bill"
   * takes a strip of a small screen to say nothing, and trains people to
   * ignore the place where the total will eventually appear.
   */
  function bill(quantity, total, currency) {
    const bar = $('#bill-bar');
    if (!bar) return;
    const qty = Number(quantity) || 0;
    bar.classList.toggle('is-up', qty > 0);
    /* So the floating MENU pill can step up out of the bar's way rather than
       sitting on top of it. */
    document.body.classList.toggle('has-bill', qty > 0);

    const count = $('#bill-count');
    const sum = $('#bill-total');
    if (count) count.textContent = qty === 1 ? '1 item' : qty + ' items';

    const money = CaptainMoney.display(total);
    /*
     * Nudged only when the number actually MOVED.
     *
     * updateCart runs on every render, including ones that change nothing -
     * a redraw, a returning page. A bar that jumps when nothing happened is
     * worse than one that never jumps, because it stops meaning anything.
     */
    const moved = sum && sum.textContent !== money;
    if (sum) sum.textContent = money;

    if (moved && qty > 0) {
      replay(bar, 'is-bumped', 400);
      replay(sum, 'is-bumped', 360);
      replay(document.querySelector('.cart-count'), 'is-bumped', 420);
    }
  }

  /* -------------------------------------------------------------- a row */

  /**
   * One row changed, without redrawing the menu.
   *
   * Redrawing costs the scroll position, which on a menu somebody is halfway
   * down is the whole screen. So the button swaps in place and nothing else
   * moves - which is also why ADD and the stepper are the same size.
   */
  function setRow(id, quantity, product) {
    const row = document.querySelector('.dish[data-id="' + String(id).replace(/"/g, '\\"') + '"]');
    if (!row) return;
    const qty = Number(quantity) || 0;
    const slot = row.querySelector('.dish-action');
    if (!slot) return;

    /* Sold out stays sold out. Nothing here should be able to talk a row into
       offering a dish the kitchen has run out of. */
    if (row.classList.contains('is-out')) return;

    /* Where the finger was, before anything at the bottom of the screen. */
    replay(row, 'is-taking', 720);

    row.classList.toggle('is-in', qty > 0);

    if (qty > 0) {
      const shown = slot.querySelector('.dish-qty');
      if (shown) {
        shown.textContent = qty;
        /* The stepper is already there, so nothing arrives to be noticed. The
           number itself has to do the noticing. */
        replay(shown, 'is-bumped', 320);
      } else {
        slot.innerHTML =
          '<div class="dish-step">' +
          '<button type="button" class="btn-decrease" data-id="' +
          MenuView.escape(id) +
          '" aria-label="One fewer">−</button>' +
          '<span class="dish-qty" id="qty-' +
          MenuView.escape(id) +
          '">' +
          qty +
          '</span>' +
          '<button type="button" class="btn-increase" data-id="' +
          MenuView.escape(id) +
          '" aria-label="One more">+</button>' +
          '</div>';
      }
    } else {
      slot.innerHTML =
        '<button type="button" class="dish-add btn-add" data-id="' +
        MenuView.escape(id) +
        '">ADD</button>';
    }

    /* And what is left of it, if that is now worth saying. */
    const media = row.querySelector('.dish-media');
    if (media && product) {
      const left = MenuView.stock(product, qty).left;
      let mark = media.querySelector('.dish-left');
      if (left && !mark) {
        mark = document.createElement('div');
        mark.className = 'dish-left';
        media.appendChild(mark);
      }
      if (mark) {
        if (left) mark.textContent = 'Stock: ' + left;
        else mark.remove();
      }
    }
  }

  /**
   * These dishes arrived because somebody SAID so.
   *
   * Voice puts several lines on the bill in one go, and several rows changing
   * in the same frame is a flicker rather than an event. Staggered, each row
   * lands just after the one above it, so the order reads down the menu in the
   * sequence it was spoken - which is also the order it gets read back to the
   * table.
   *
   * 70ms apart: below about 50 the rows read as simultaneous, and above about
   * 100 a five-item order takes long enough that somebody starts scrolling
   * through it while it is still arriving.
   */
  function heard(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    ids.forEach((id, at) => {
      const row = document.querySelector('.dish[data-id="' + String(id).replace(/"/g, '\\"') + '"]');
      if (!row) return;
      setTimeout(() => replay(row, 'is-heard', 560), at * 70);
    });

    /* And put the first of them on screen, because a dish that was added out
       of sight was, to the waiter, not added. */
    const first = document.querySelector('.dish[data-id="' + String(ids[0]).replace(/"/g, '\\"') + '"]');
    if (first && first.scrollIntoView) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* ------------------------------------------------------------- wiring */

  /** The handlers that do not belong to any one render. */
  function start() {
    /* Delegated, so a redraw does not need them attached again. */
    document.addEventListener('click', (event) => {
      const chip = event.target.closest && event.target.closest('.menu-chip');
      if (chip) {
        goTo(chip.dataset.category);
        return;
      }
      const row = event.target.closest && event.target.closest('.menu-index-row');
      if (row) {
        closeIndex();
        /* After the sheet is gone, or the scroll lands against a screen that
           is about to change height. */
        setTimeout(() => goTo(row.dataset.category), 60);
        return;
      }
      if (event.target.closest && event.target.closest('#menu-index-btn')) {
        openIndex();
        return;
      }
      if (
        event.target.id === 'menu-index-scrim' ||
        (event.target.closest && event.target.closest('#menu-index-close'))
      ) {
        closeIndex();
      }
    });

    /* The stuck offsets change when the phone turns or the keyboard opens. */
    window.addEventListener('resize', stick);
    window.addEventListener('orientationchange', () => setTimeout(stick, 200));
  }

  return { draw, goTo, setRow, bill, stick, openIndex, closeIndex, start, point, heard };
});
