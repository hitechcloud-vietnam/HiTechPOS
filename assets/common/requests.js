/*
 * WHAT A CUSTOMER HAS ASKED FOR, ON THE HANDSET.
 *
 * Owner: "when customer aks for change. cancel then desktop or captain app
 * clearly can see the changes. what was before and what change customer
 * wahts? cancel item or cancel order."
 *
 * The desktop has had a dock for this for a while. The handset has had
 * NOTHING - no queue, no card, no notification - so a waiter walking the floor
 * could not see that table nine had asked to drop a dish, and found out when
 * the food arrived and was sent back. The one member of staff actually
 * standing next to the customer was the one who could not be told.
 *
 * WHAT THIS FILE IS. The reading, and only the reading: which kind of request
 * a row is, which question it asks, and what the order looks like before and
 * after. No fetching, no markup, no decisions - so it can be run in a test
 * without a screen, which is how the rest of this folder is built.
 *
 * THE SAME MEANINGS AS THE DESKTOP, WRITTEN SEPARATELY.
 * frontend/static/script/js/core/request-dock.js in the POS repository makes
 * the same five judgements. They cannot share a file - two repositories, two
 * bundles - so they are written twice and each names the other. If one of them
 * changes what "remove everything" means, change both: a waiter and a till
 * disagreeing about what a customer asked for is worse than either being
 * wrong on its own.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Requests = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /**
   * What kind of thing this row is.
   *
   * `gone` is the one with nothing to decide: the customer cancelled inside
   * the window the shop leaves open, so the order simply went. Nobody is
   * waiting on a yes - but a ticket may already be on the pass, and the person
   * carrying it needs to know before they carry it.
   */
  function kindOf(order) {
    if (!order) return '';
    /*
     * A TABLE ASKING FOR SOMEBODY.
     *
     * Its own kind because there is nothing to decide. The table wants a
     * person and the only answer is that one is coming, so the card gets one
     * button rather than a yes and a no - and it is answered through its own
     * door, not the approval state machine, which has no state for it.
     */
    if (order.call_id) return 'waiter';
    if (order.cancel_seen === false && order.customer_cancelled_at) return 'gone';
    if (order.cancel_requested === true) return 'cancel';
    if (order.change_requested && (order.change_requested.items || []).length) return 'change';
    return 'new';
  }

  /**
   * Which question this asks, in the words the answer is about.
   *
   * "Asked to change" covered a customer dropping one naan and a customer
   * emptying the order, which are not the same decision. Since adding never
   * becomes a request - more food needs nobody's permission - every change
   * request is something being taken away, and this says which.
   *
   * Returns a key rather than a sentence: the caller owns the words, because
   * the handset and the till do not share a dictionary.
   */
  function askedFor(order) {
    const kind = kindOf(order);
    if (kind === 'waiter') return 'table_calling';
    if (kind === 'gone') return 'already_cancelled';
    if (kind === 'cancel') return 'cancel_order';
    if (kind !== 'change') return 'new_order';

    const wants = (order.change_requested && order.change_requested.items) || [];
    const dropped = wants.filter((one) => !Number(one.quantity || 0)).length;
    const onOrder = (order.items || []).length;
    /* Every line gone is a cancellation in all but name, and a waiter who
       reads "remove some items" would carry the wrong news to the kitchen. */
    if (dropped && onOrder && dropped >= onOrder) return 'remove_everything';
    if (dropped === 1) return 'remove_one';
    if (dropped > 1) return 'remove_some';
    return 'fewer';
  }

  /**
   * The WHOLE order, before and after.
   *
   * Not only the lines that moved. "Chicken Biryani 2 to 1" tells a waiter
   * nothing about whether that is most of the order or a detail of it, and on
   * a handset there is no second screen to go and check on.
   *
   * @returns {Array<{name, was, now, state}>} state is 'same', 'moved',
   *   'gone' or 'added'
   */
  function linesOf(order) {
    if (!order) return [];
    /* A call is not about an order, so there are no lines to draw for it -
       just a table, and the card says that on its own. */
    if (order.call_id) return [];
    const wants = (order.change_requested && order.change_requested.items) || [];
    const asked = {};
    wants.forEach((one) => {
      asked[String(one.item_id || one.name || '')] = one;
    });

    const rows = (order.items || []).map((line) => {
      const key = String(line.item_id || line.name || '');
      const want = asked[key];
      const was = Number(line.quantity || 0);
      const now = want ? Number(want.quantity || 0) : was;
      return { name: line.name || '', was, now, state: stateOf(was, now, !!want) };
    });

    /* A dish the customer asked for that is not on the order has no line to
       sit on, so it gets one. They cannot ask for one any more - additions go
       straight to the pass - but a request made before that rule shipped is
       still in the queue and must still read correctly. */
    const seen = {};
    rows.forEach((r) => {
      seen[r.name] = true;
    });
    wants.forEach((one) => {
      const name = one.name || '';
      if (!name || seen[name]) return;
      const was = Number(one.was || 0);
      const now = Number(one.quantity || 0);
      rows.push({ name, was, now, state: stateOf(was, now, true) });
    });

    return rows;
  }

  function stateOf(was, now, moved) {
    if (!moved || was === now) return 'same';
    if (!now) return 'gone';
    if (!was) return 'added';
    return 'moved';
  }

  /**
   * How long ago, in whole minutes.
   *
   * The whole decision turns on this. "Cancel this?" is a different question
   * at forty seconds and at eleven minutes - one the kitchen has not started,
   * the other it has plated - and a timestamp makes somebody do that
   * arithmetic while a customer watches them.
   */
  function minutesSince(at, now = Date.now()) {
    const then = at ? new Date(at).getTime() : NaN;
    if (isNaN(then)) return null;
    return Math.max(0, Math.floor((now - then) / 60000));
  }

  /**
   * Which of these a waiter must act on, newest LAST.
   *
   * A queue is worked from the top and the person waiting longest should be
   * served first - the same order the till's dock uses, so two members of
   * staff looking at the same queue work it the same way.
   */
  function waiting(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => kindOf(row) !== '');
  }

  return { kindOf, askedFor, linesOf, minutesSince, waiting };
});
