/*
 * Online orders that need somebody, in the waiter's hand.
 *
 * Owner: "request should go to desktop application and captain app. let him
 * confirm. anyone can confirm about that."
 *
 * Three things arrive here, and they are all one job - a person deciding:
 *
 *   waiting    an order held for approval, because the shop accepts by hand
 *   cancel     a customer has asked for their order to be called off
 *   change     a customer has asked for it to be changed: two to three,
 *              a naan added, a dish taken off
 *
 * The last two exist because a customer may change their own order for a
 * minute after placing it and only ask afterwards. Until now the asking
 * reached the till and nothing else, which is the wrong shape for a
 * restaurant: the person most likely to be holding a screen is the one
 * walking the floor.
 *
 * WHY IT POLLS. There is no socket between this handset and the shop's
 * server, and a request that waits for somebody to open a screen is a request
 * nobody answers. Twenty seconds is cheap - the queue is a handful of rows -
 * and it stops while the app is in the background, because a handset in a
 * pocket is not a person looking.
 *
 * NOTHING HERE DECIDES ANYTHING. Every answer goes to /sales/:id/approval,
 * the same door the till's own buttons use, and the server applies it through
 * the same code the customer's own plus and minus use - so a dish that went
 * off the menu while the request sat in the queue is still refused, whoever
 * pressed the button.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OnlineApprovals = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  /* Long enough not to be a load on a shop's own server, short enough that a
     customer who has just asked is not waiting on somebody's curiosity. */
  const EVERY_MS = 20000;

  let timer = null;
  let asking = false;
  let onChange = null;
  let last = [];

  function api() {
    return typeof POSNIC !== 'undefined' && POSNIC && POSNIC.api ? POSNIC.api : null;
  }

  /**
   * What each row is ASKING FOR, in one word.
   *
   * An order can carry more than one of these at once - a customer who asks
   * to change their order and then thinks better of the whole thing - and the
   * bigger decision wins, because answering "cancel" answers both.
   */
  function asks(order) {
    if (!order) return '';
    if (order.cancel_requested === true) return 'cancel';
    if (order.change_requested && Array.isArray(order.change_requested.items)) return 'change';
    return 'waiting';
  }

  /**
   * What the customer wants changed, in words a person can act on.
   *
   * "Chicken Biryani: 2 to 3", not a row of database ids. Whoever reads this
   * is standing up, holding a phone, with a table waiting.
   */
  function wording(order) {
    const items = (order && order.change_requested && order.change_requested.items) || [];
    return items.map((one) => {
      const name = String((one && one.name) || '').trim() || 'that item';
      const was = Number((one && one.was) || 0);
      const now = Number((one && one.quantity) || 0);
      if (!was) return '+ ' + now + ' × ' + name;
      if (!now) return 'Remove ' + name;
      return name + ': ' + was + ' → ' + now;
    });
  }

  /** Everything waiting on a person, newest last: the longest wait is first. */
  async function look() {
    if (asking) return last;
    const client = api();
    if (!client) return last;
    asking = true;
    try {
      const said = await client.get('/sales/pendingOnlineOrders');
      const rows = (said && said.data) || [];
      const before = last.map((row) => row.sale_id + ':' + asks(row)).join(',');
      last = Array.isArray(rows) ? rows : [];
      const now = last.map((row) => row.sale_id + ':' + asks(row)).join(',');
      /* Only when something actually changed. A handset that redraws every
         twenty seconds throws away whatever the waiter was in the middle of. */
      if (before !== now && typeof onChange === 'function') onChange(last);
      return last;
    } catch (e) {
      /* A shop that cannot be reached is not a shop with an empty queue: what
         was last known stays on screen rather than the list going blank. */
      return last;
    } finally {
      asking = false;
    }
  }

  /**
   * Answer one.
   *
   * @param {string} saleId
   * @param {'accept'|'accepted'|'reject'|'rejected'|'cancel'|'keep'} decision
   */
  async function decide(saleId, decision) {
    const client = api();
    if (!client || !saleId) return { ok: false, reason: 'no_server' };
    try {
      const said = await client.post('/sales/' + encodeURIComponent(saleId) + '/approval', {
        decision,
        reason: '',
      });
      const ok = !!(said && said.type === 'success');
      /* Answered or refused, look again: another handset or the till may have
         got there first, and the honest thing is to show the queue as it is. */
      await look();
      return { ok, message: (said && said.message) || '' };
    } catch (e) {
      return { ok: false, reason: 'not_answered', message: (e && e.message) || '' };
    }
  }

  /** What the two buttons mean for this row. */
  function choices(order) {
    const kind = asks(order);
    if (kind === 'cancel') {
      return { yes: { label: 'Cancel it', decision: 'cancel' }, no: { label: 'Keep the order', decision: 'keep' } };
    }
    if (kind === 'change') {
      return { yes: { label: 'Make the change', decision: 'accept' }, no: { label: 'Leave it as it is', decision: 'keep' } };
    }
    return { yes: { label: 'Accept', decision: 'accepted' }, no: { label: 'Reject', decision: 'rejected' } };
  }

  /** Start watching. `whenChanged` is called with the queue as it changes. */
  function watch(whenChanged) {
    onChange = typeof whenChanged === 'function' ? whenChanged : null;
    if (timer) return;
    look();
    timer = setInterval(() => {
      /* A handset in a pocket is not a person looking. */
      if (typeof document !== 'undefined' && document.hidden) return;
      look();
    }, EVERY_MS);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) look();
      });
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { watch, stop, look, decide, asks, wording, choices, EVERY_MS, queue: () => last };
});
