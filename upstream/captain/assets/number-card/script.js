/*
 * THE NUMBER CARD.
 *
 * Owner: "self manage number. app user itself auto assign 1 to 200 for 200
 * items. if enter 33 then it shows..."
 *
 * The numbers are already on every row in the app and in the add-item sheet.
 * This is the same list on one page, dense enough to print and read from
 * across a service counter, so a waiter can learn the ten dishes they sell
 * every day and stop searching for them at all.
 *
 * It computes NOTHING of its own. The grouping is MenuView.fromFlat and the
 * numbers are MenuView.numbers, which is what the picker calls, because a
 * card that disagreed with the app would send the wrong plate with more
 * confidence than no card at all.
 */

(function () {
  'use strict';

  const body = () => document.getElementById('card-body');

  /** Menu rows as the till stored them, or nothing if this phone has none. */
  async function menuRows() {
    try {
      const rows = await getData('products');
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  function draw(rows) {
    if (!rows.length) {
      body().innerHTML =
        '<p class="card-empty">No menu on this phone yet. Open the menu once while the till is reachable, then come back.</p>';
      return;
    }

    const list = MenuView.fromFlat(rows);
    const numbers = MenuView.numbers(list);

    let html = '';
    for (const section of list) {
      html += '<section class="card-group">';
      html += '<h2 translate="no">' + MenuView.escape(section.name) + '</h2>';
      html += '<ul>';
      for (const item of section.items) {
        const n = numbers.get(String(item.id));
        html +=
          '<li data-id="' +
          MenuView.escape(String(item.id)) +
          '"><span class="n">' +
          n +
          '</span><span class="d" translate="no">' +
          MenuView.escape(item.name || item.item_name || '') +
          '</span></li>';
      }
      html += '</ul></section>';
    }

    body().innerHTML = html;

    const stamp = document.getElementById('card-stamp');
    if (stamp) {
      /* Which printing this is. Two cards on a wall with no dates on them is
         how a shop ends up reading the old one. */
      stamp.textContent =
        rows.length + ' dishes, printed ' + new Date().toLocaleDateString();
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const back = document.getElementById('card-back');
    if (back) back.addEventListener('click', () => history.back());

    const print = document.getElementById('card-print');
    if (print) print.addEventListener('click', () => window.print());

    draw(await menuRows());
  });
})();
