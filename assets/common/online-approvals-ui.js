/*
 * The waiter's view of online orders waiting on somebody.
 *
 * Owner: "request should go to desktop application and captain app. let him
 * confirm. anyone can confirm about that."
 *
 * online-approvals.js knows WHAT is waiting; this is where a person sees it.
 * A bar across the top of the floor screen with a count, which opens into the
 * list. Nothing blocks the screen - the owner's standing rule - so a waiter
 * carrying three plates is never trapped in a dialog.
 *
 * WHY A BAR AND NOT A BADGE. A badge is for something that can wait. A
 * customer who has asked to cancel is standing at a table wondering whether
 * their food is coming, and the shop has taken their money's worth of
 * attention. The bar says how many and what the oldest one wants, and it does
 * not go away until the queue is empty.
 */

(function () {
  'use strict';

  const WORDS = {
    cancel: 'asked to cancel',
    change: 'asked for a change',
    waiting: 'waiting to be accepted',
  };

  function el(id) {
    return document.getElementById(id);
  }

  function approvals() {
    return typeof OnlineApprovals !== 'undefined' ? OnlineApprovals : null; // eslint-disable-line no-undef
  }

  /** The bar, made once and then only ever re-filled. */
  function bar() {
    let found = el('online-approvals-bar');
    if (found) return found;
    found = document.createElement('button');
    found.type = 'button';
    found.id = 'online-approvals-bar';
    found.className = 'online-approvals-bar';
    found.hidden = true;
    found.addEventListener('click', () => {
      const panel = el('online-approvals-panel');
      if (panel) panel.hidden = !panel.hidden;
    });
    const host = document.querySelector('.floor-header') || document.body;
    if (host.nextSibling) host.parentNode.insertBefore(found, host.nextSibling);
    else host.parentNode.appendChild(found);
    return found;
  }

  function panel() {
    let found = el('online-approvals-panel');
    if (found) return found;
    found = document.createElement('div');
    found.id = 'online-approvals-panel';
    found.className = 'online-approvals-panel';
    found.hidden = true;
    const line = bar();
    line.parentNode.insertBefore(found, line.nextSibling);
    return found;
  }

  /** One card: what is being asked, and the two answers. */
  function card(order, kit) {
    const kind = kit.asks(order);
    const box = document.createElement('div');
    box.className = 'online-approval';
    box.setAttribute('data-kind', kind);

    const head = document.createElement('div');
    head.className = 'online-approval-head';
    const who = document.createElement('strong');
    who.textContent = String(order.sales_id || '') + (order.token_id ? ' · Token ' + order.token_id : '');
    const what = document.createElement('span');
    what.className = 'online-approval-what';
    what.textContent = WORDS[kind] || WORDS.waiting;
    head.appendChild(who);
    head.appendChild(what);
    box.appendChild(head);

    if (order.destination) {
      const where = document.createElement('p');
      where.className = 'online-approval-where';
      where.textContent = String(order.destination);
      box.appendChild(where);
    }

    /* WHAT THEY ARE ASKING FOR, in dish names. Whoever reads this is standing
       up with a table waiting; a row of ids is not a decision anybody makes. */
    const asked = kind === 'change' ? kit.wording(order) : (order.items || []).map(
      (line) => String(line.quantity || 0) + ' × ' + String(line.name || '')
    );
    if (asked.length) {
      const list = document.createElement('ul');
      list.className = 'online-approval-lines';
      asked.forEach((one) => {
        const row = document.createElement('li');
        row.textContent = one;
        list.appendChild(row);
      });
      box.appendChild(list);
    }

    const buttons = document.createElement('div');
    buttons.className = 'online-approval-actions';
    const choice = kit.choices(order);
    [
      ['no', choice.no, 'online-approval-no'],
      ['yes', choice.yes, 'online-approval-yes'],
    ].forEach(([, which, css]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = css;
      button.textContent = which.label;
      button.addEventListener('click', async () => {
        /* Both off the moment one is pressed: the whole failure this guards
           against is a second tap on a screen that has not caught up. */
        [...buttons.querySelectorAll('button')].forEach((b) => {
          b.disabled = true;
        });
        await kit.decide(order.sale_id, which.decision);
      });
      buttons.appendChild(button);
    });
    box.appendChild(buttons);
    return box;
  }

  function paint(rows) {
    const kit = approvals();
    if (!kit) return;
    const line = bar();
    const list = panel();
    const waiting = (rows || []).length;

    if (!waiting) {
      line.hidden = true;
      list.hidden = true;
      list.textContent = '';
      return;
    }

    /* The oldest is first - it has waited longest - and it is the one the bar
       names, because that is the one somebody should deal with. */
    const oldest = rows[0];
    line.hidden = false;
    line.textContent =
      waiting +
      (waiting === 1 ? ' online order needs you' : ' online orders need you') +
      ' · ' +
      (WORDS[kit.asks(oldest)] || WORDS.waiting);

    list.textContent = '';
    rows.forEach((order) => list.appendChild(card(order, kit)));
  }

  function start() {
    const kit = approvals();
    if (!kit) return;
    kit.watch(paint);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.OnlineApprovalsUI = { paint, bar, panel, card };
})();
