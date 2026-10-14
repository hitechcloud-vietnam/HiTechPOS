/*
 * "NO MORE FISH." SAID BY THE PERSON WHO HEARD IT.
 *
 * The kitchen tells the floor before it tells anybody with a keyboard. Until
 * now a waiter who heard it had to find whoever runs the till, and in the
 * minutes that took, three more tables ordered it, three more tickets printed,
 * and three tables were told no after they had already chosen.
 *
 * ONE QUESTION, AND IT NAMES THE DISH. A waiter is holding a phone in one hand
 * next to a table. The thing that can go wrong here is taking the wrong dish
 * off a live menu, so the dish is the largest thing on the sheet and the
 * button says what will happen rather than "OK".
 *
 * IT ASKS THE OPPOSITE QUESTION WHEN THE DISH IS ALREADY OFF, because the
 * gesture is the same one and a waiter who took the wrong dish off needs the
 * way back to be the thing they already know. Same sheet, same long press.
 *
 * FOR TODAY, NOT FOR EVER. The till records the day, not a stock level, so
 * tomorrow's service starts clean without anybody remembering to undo this.
 * The words say so, because "sold out" with no horizon is what makes a shop
 * afraid to use it.
 *
 * Self-contained, its own markup and styles injected once, because it is
 * reached from the menu, the order screen and the kitchen ticket screen, and
 * those three must not answer this differently.
 */
(function (root) {
  'use strict';

  let asking = null;

  function ensure() {
    if (document.getElementById('ask-run-out-scrim')) return;

    const style = document.createElement('style');
    style.id = 'ask-run-out-style';
    style.textContent = `
      #ask-run-out-scrim {
        position: fixed; inset: 0; z-index: 2147483645;
        display: none; align-items: center; justify-content: center;
        padding: 20px; background: rgba(15, 23, 42, .62);
        backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
      }
      #ask-run-out-scrim.is-open { display: flex; }
      #ask-run-out-card {
        width: min(340px, 100%); box-sizing: border-box;
        padding: 22px 20px 18px; border-radius: 18px;
        background: #fff; color: #1f2937;
        box-shadow: 0 24px 60px rgba(15, 23, 42, .3);
      }
      #ask-run-out-dish {
        margin: 0 0 4px; font-size: 17px; font-weight: 800; color: #0f172a;
      }
      #ask-run-out-why {
        margin: 0 0 18px; font-size: 13px; line-height: 1.5; color: #64748b;
      }
      #ask-run-out-buttons { display: flex; gap: 10px; }
      #ask-run-out-buttons button {
        flex: 1 1 0; min-height: 48px; border-radius: 12px;
        font-size: 15px; font-weight: 700; cursor: pointer;
      }
      #ask-run-out-cancel {
        border: 1px solid #e2e8f0; background: #fff; color: #334155;
      }
      #ask-run-out-ok { border: 0; background: #b45309; color: #fff; }
      #ask-run-out-ok.is-back { background: #15803d; }
    `;
    document.head.appendChild(style);

    const scrim = document.createElement('div');
    scrim.id = 'ask-run-out-scrim';
    scrim.innerHTML = `
      <div id="ask-run-out-card" role="dialog" aria-modal="true" aria-labelledby="ask-run-out-dish">
        <p id="ask-run-out-dish"></p>
        <p id="ask-run-out-why"></p>
        <div id="ask-run-out-buttons">
          <button type="button" id="ask-run-out-cancel">Cancel</button>
          <button type="button" id="ask-run-out-ok"></button>
        </div>
      </div>
    `;
    document.body.appendChild(scrim);

    scrim.querySelector('#ask-run-out-ok').addEventListener('click', () => settle(true));
    scrim.querySelector('#ask-run-out-cancel').addEventListener('click', () => settle(false));
    /* Tapping the dark outside cancels, the way every other sheet here does. */
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) settle(false);
    });
  }

  function settle(confirmed) {
    if (!asking) return;
    const { resolve, answer } = asking;
    asking = null;

    const scrim = document.getElementById('ask-run-out-scrim');
    if (scrim) scrim.classList.remove('is-open');

    /* null is "they backed out", which is not the same as "put it back on" -
       and false IS a real answer here, so the caller cannot use falsy. */
    resolve(confirmed ? answer : null);
  }

  const nameOf = (product) =>
    String((product && (product.name || product.item_name || product.product_name)) || '').trim();

  /**
   * Ask whether a dish has run out, or whether it is back on.
   *
   * @param {object} product the dish, as the menu holds it
   * @returns {Promise<boolean|null>} true to take it off, false to put it back,
   *   null if the waiter backed out
   */
  function askRunOut(product) {
    ensure();
    /* A second question over the first would leave one promise unsettled for
       ever, and the screen behind it waiting on it. */
    if (asking) settle(false);

    const off = !!(product && product.sold_out_today);
    /* Off already means the only useful question is the opposite one. */
    const answer = !off;

    const scrim = document.getElementById('ask-run-out-scrim');
    const ok = document.getElementById('ask-run-out-ok');

    document.getElementById('ask-run-out-dish').translate = !nameOf(product);
    document.getElementById('ask-run-out-dish').textContent = nameOf(product) || 'This dish';
    document.getElementById('ask-run-out-why').textContent = off
      ? 'This is off the menu today. Put it back and the floor can order it again straight away.'
      : 'Takes it off the menu for the rest of today. Nobody can order it, and tomorrow it comes back by itself.';

    ok.textContent = off ? 'Put back on' : 'It has run out';
    ok.classList.toggle('is-back', off);

    scrim.classList.add('is-open');

    return new Promise((resolve) => {
      asking = { resolve, answer };
    });
  }

  root.POSNIC = root.POSNIC || {};
  root.POSNIC.askRunOut = askRunOut;
})(typeof globalThis !== 'undefined' ? globalThis : window);
