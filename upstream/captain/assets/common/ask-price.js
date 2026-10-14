/*
 * TODAY'S PRICE, ASKED BEFORE THE DISH GOES ON THE ORDER.
 *
 * Owner, from a live table at a client: two fish reached the kitchen worth
 * nothing. "zero price items are actually dyanmic pricing. its based current
 * price. so if you find that kind of item we need to allow captain to update
 * the price and give order."
 *
 * A whole fish, a crab, a lobster: the shop cannot print a number on the card
 * because it does not know one until the morning's market. The catalogue
 * carries no selling price, so every screen showed 0.00 and every layer below
 * believed it.
 *
 * This is the one question that fixes that, and it is deliberately ONE
 * question: a waiter is standing at a table with a phone in one hand. A number
 * pad, a name, and two buttons.
 *
 * Self-contained - its own markup and its own styles, injected once - because
 * it is needed on the ordering screen and inside the add-to-an-order sheet,
 * and those are two different pages that must not answer this differently.
 */
(function (root) {
  'use strict';

  let asking = null;
  let quickTax = null;
  function taxPreview() {
    const box = document.getElementById('ask-price-tax');
    if (!box) return;
    box.hidden = !quickTax || wantsName;
    if (box.hidden) return;
    const amount = readPrice(document.getElementById('ask-price-input').value);
    const base = amount.ok ? amount.value : 0;
    const tax = Math.round(base * Number(quickTax.rate)) / 100;
    const t = key => root.I18N?.t?.(key) || key;
    box.replaceChildren();
    for (const [label, value] of [[t('Amount'), base], [quickTax.name + ' (' + quickTax.rate + '%)', tax], [t('Total'), base + tax]]) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;margin-top:8px';
      const name = document.createElement('span'); name.textContent = label;
      const money = document.createElement('strong'); money.translate = false;
      money.textContent = root.CaptainMoney?.display ? root.CaptainMoney.display(value) : value.toFixed(2);
      row.append(name, money); box.append(row);
    }
  }

  function ensure() {
    if (document.getElementById('ask-price-scrim')) return;

    const style = document.createElement('style');
    style.id = 'ask-price-style';
    style.textContent = `
      #ask-price-scrim {
        position: fixed; inset: 0; z-index: 2147483645;
        display: none; align-items: center; justify-content: center;
        padding: 20px; background: rgba(15, 23, 42, .62);
        backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
      }
      #ask-price-scrim.is-open { display: flex; }
      #ask-price-card {
        width: min(340px, 100%); box-sizing: border-box;
        padding: 22px 20px 18px; border-radius: 18px;
        background: #fff; color: #1f2937;
        box-shadow: 0 24px 60px rgba(15, 23, 42, .3);
      }
      #ask-price-dish {
        margin: 0 0 4px; font-size: 17px; font-weight: 800; color: #0f172a;
      }
      #ask-price-why {
        margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: #64748b;
      }
      #ask-price-field {
        display: flex; align-items: center; gap: 8px;
        border: 2px solid #e2e8f0; border-radius: 12px; padding: 0 14px;
        min-height: 56px;
      }
      #ask-price-field:focus-within { border-color: #2563eb; }
      #ask-price-sign { font-size: 20px; font-weight: 700; color: #64748b; }
      #ask-price-input {
        flex: 1 1 auto; min-width: 0; border: 0; outline: none;
        /* 18px or larger, or iOS zooms the whole page on focus and the waiter
           loses the table behind it. */
        font-size: 22px; font-weight: 700; color: #0f172a; background: none;
      }
      #ask-price-warn {
        margin: 10px 2px 0; font-size: 13px; color: #b42318; min-height: 18px;
      }
      #ask-price-buttons { display: flex; gap: 10px; margin-top: 16px; }
      #ask-price-buttons button {
        flex: 1 1 0; min-height: 48px; border-radius: 12px;
        font-size: 15px; font-weight: 700; cursor: pointer;
      }
      #ask-price-cancel { border: 1.5px solid #cbd5e1; background: #fff; color: #475569; }
      #ask-price-ok { border: 0; background: #ff7a3c; color: #fff; }
    `;
    style.textContent += `
      #ask-price-scrim{padding:16px;overflow-y:auto;align-items:center}
      #ask-price-card{font-family:Inter,system-ui,sans-serif;width:min(420px,100%);max-height:calc(100dvh - 32px);overflow-y:auto;background:var(--surface,#fff);color:var(--ink,#192638);border:1px solid var(--line,#dde4ed);border-radius:16px;padding:22px}
      #ask-price-dish{font:650 20px/1.35 Inter,system-ui,sans-serif;color:var(--ink,#192638);overflow-wrap:anywhere}
      #ask-price-why{color:var(--ink-soft,#627083)}
      #ask-price-field{background:var(--surface,#fff);border:1px solid var(--line,#dde4ed)}
      #ask-price-field:focus-within{border-color:var(--accent,#2458db);box-shadow:0 0 0 2px var(--accent-soft,#edf3ff)}
      #ask-price-input{font:600 24px/1.5 Inter,system-ui,sans-serif;color:var(--ink,#192638);width:100%;padding:8px 0}
      #ask-price-sign{color:var(--ink-soft,#627083)}
      #ask-price-buttons button{font:600 14px Inter,system-ui,sans-serif;border-radius:10px}
      #ask-price-cancel{background:var(--surface,#fff);color:var(--ink,#192638);border:1px solid var(--line,#dde4ed)}
      #ask-price-ok{background:var(--accent,#2458db);color:var(--accent-ink,#fff)}
    `;
    document.head.appendChild(style);

    const scrim = document.createElement('div');
    scrim.id = 'ask-price-scrim';
    scrim.innerHTML =
      '<div id="ask-price-card" role="dialog" aria-modal="true" aria-labelledby="ask-price-dish" aria-describedby="ask-price-why">' +
      '<p id="ask-price-dish"></p>' +
      '<p id="ask-price-why">Priced on the day. Enter what this one costs.</p>' +
      '<div id="ask-price-field">' +
      '<span id="ask-price-sign">&#8377;</span>' +
      '<input id="ask-price-input" type="text" inputmode="decimal" ' +
      'autocomplete="off" aria-label="Price per item" placeholder="0">' +
      '</div>' +
      '<div id="ask-price-tax" aria-live="polite" hidden></div>' +
      '<p id="ask-price-warn"></p>' +
      '<div id="ask-price-buttons">' +
      '<button type="button" id="ask-price-cancel">Cancel</button>' +
      '<button type="button" id="ask-price-ok">Add</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(scrim);

    const input = scrim.querySelector('#ask-price-input');

    /* Enter is what a number pad offers, so it must do the obvious thing. */
    input.addEventListener('input', taxPreview);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        settle(true);
      }
    });
    scrim.querySelector('#ask-price-ok').addEventListener('click', () => settle(true));
    scrim.querySelector('#ask-price-cancel').addEventListener('click', () => settle(false));
    /* Tapping the dark outside cancels, the way every other sheet here does. */
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) settle(false);
    });
  }

  /**
   * What counts as a price.
   *
   * Refused here as well as on the server, so a waiter is told at the table
   * rather than after the order has travelled. The ceiling catches the
   * likeliest mistake by far: a thumb on a phone keyboard.
   */
  function readPrice(said) {
    const clean = String(said == null ? '' : said).replace(/[^0-9.]/g, '');
    if (!clean) return { ok: false, why: 'Enter a price.' };
    const n = Number(clean);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, why: 'Enter a price.' };
    if (n > 1000000) return { ok: false, why: 'That looks too high. Check it.' };
    return { ok: true, value: Math.round(n * 100) / 100 };
  }

  /*
   * THE SAME SHEET ASKS TWO QUESTIONS.
   *
   * A price, and - when a waiter presses the quick sale mark with nothing
   * typed - what the thing is called. One sheet rather than two because it is
   * one habit: the keyboard lands in the same place and Enter does the same
   * thing, and a waiter mid-service should not have to learn a second dialog.
   */
  let wantsName = false;

  function settle(confirmed) {
    if (!asking) return;
    const scrim = document.getElementById('ask-price-scrim');
    const input = document.getElementById('ask-price-input');
    const warn = document.getElementById('ask-price-warn');

    if (!confirmed) {
      const done = asking;
      asking = null;
      scrim.classList.remove('is-open');
      done(null);
      return;
    }

    if (wantsName) {
      const said = String(input.value || '').trim().slice(0, 60);
      if (!said) {
        warn.textContent = 'What is it called?';
        input.focus();
        return;
      }
      const named = asking;
      asking = null;
      scrim.classList.remove('is-open');
      named(said);
      return;
    }

    const read = readPrice(input.value);
    if (!read.ok) {
      warn.textContent = read.why;
      input.focus();
      return;
    }

    const done = asking;
    asking = null;
    scrim.classList.remove('is-open');
    done(read.value);
  }

  /**
   * Ask, and resolve with a price or with null if the waiter backed out.
   *
   * @param {string} dishName what is being priced, so the question names it
   * @param {number} [suggested] a price already on the line, when changing one
   * @returns {Promise<number|null>}
   */
  function askPrice(dishName, suggested, tax) {
    ensure();
    /* A second question over the first would leave one promise unsettled for
       ever, and the screen behind it waiting on it. */
    if (asking) settle(false);

    wantsName = false;
    quickTax = tax || null;
    const scrim = document.getElementById('ask-price-scrim');
    const input = document.getElementById('ask-price-input');
    document.getElementById('ask-price-dish').translate = !dishName;
    document.getElementById('ask-price-dish').textContent = dishName || 'This dish';
    document.getElementById('ask-price-warn').textContent = '';
    /* Put back whatever the name question changed: one sheet, two jobs, and
       the second must not inherit the first's furniture. */
    const sign = document.getElementById('ask-price-sign');
    if (sign) sign.style.display = '';
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('aria-label', 'Price per item');
    document.getElementById('ask-price-why').textContent = 'Enter the price per item before adding it to the order.';
    input.setAttribute('placeholder', '0');
    input.value = Number(suggested) > 0 ? String(suggested) : '';
    if (quickTax) document.getElementById('ask-price-why').textContent = root.I18N?.t?.('Excluding tax') || 'Excluding tax';
    taxPreview();

    scrim.classList.add('is-open');
    /* After the sheet is on screen, or a phone keyboard opens against nothing
       and the field scrolls out from under it. */
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);

    return new Promise((resolve) => {
      asking = resolve;
    });
  }

  /**
   * Ask what a one-off is called, and resolve with the name or null.
   *
   * Owner: "quick sale not clickable until text added." The mark used to do
   * nothing until something was typed in the search box, and nudge the
   * placeholder - which reads as a dead button, because a button that does
   * nothing IS a dead button however good its reason.
   */
  function askName(suggested) {
    ensure();
    if (asking) settle(false);

    wantsName = true;
    taxPreview();
    const scrim = document.getElementById('ask-price-scrim');
    const input = document.getElementById('ask-price-input');

    document.getElementById('ask-price-dish').translate = true;
    document.getElementById('ask-price-dish').textContent = 'Something not on the menu';
    document.getElementById('ask-price-warn').textContent = '';
    /* The rupee sign belongs to a price. */
    const sign = document.getElementById('ask-price-sign');
    if (sign) sign.style.display = 'none';
    input.setAttribute('inputmode', 'text');
    input.setAttribute('aria-label', 'Item name');
    document.getElementById('ask-price-why').textContent = 'Enter the item name, then set its price.';
    input.setAttribute('placeholder', 'What is it called?');
    input.value = String(suggested || '');

    scrim.classList.add('is-open');
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);

    return new Promise((resolve) => {
      asking = resolve;
    });
  }

  root.POSNIC = root.POSNIC || {};
  root.POSNIC.askPrice = askPrice;
  root.POSNIC.askName = askName;
  /* Exported so the rule about what counts as a price can be tested without a
     browser, and so the server's copy of it can be checked against this one. */
  root.POSNIC.readPrice = readPrice;

  if (typeof module === 'object' && module.exports) {
    module.exports = { askPrice, askName, readPrice };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
