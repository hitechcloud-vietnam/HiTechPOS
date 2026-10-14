/*
 * How long a table has been waiting, said the way a person says it.
 *
 * This is the whole point of the floor screen. A table with one ticket from
 * four minutes ago and a table with one from forty are the same box on the old
 * screen and completely different problems on a real floor.
 *
 * Kept out of the page so it can be tested at a desk: every rule here is a
 * judgement about when a restaurant should start worrying, and a judgement
 * nobody can see is a judgement nobody can correct.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FloorView = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* globalThis inside here, never `root` - see assets/common/self-test.js. */

  /*
   * WHEN A RESTAURANT SHOULD START WORRYING.
   *
   * Deliberately generous. A floor that turns amber at ten minutes and red at
   * twenty is a floor where everything is red by eight o'clock, and a screen
   * that is always red is a screen nobody looks at - which is worse than no
   * colour at all, because it also costs the times that genuinely matter.
   *
   * Twenty and forty-five: a table waiting three quarters of an hour on an
   * unpaid ticket is a real problem in any restaurant, and twenty minutes is
   * long enough that a normal kitchen has not yet failed anybody.
   */
  const WAITING = 20;
  const LATE = 45;

  /** How many whole minutes ago, or null if we were not told. */
  function minutesSince(iso, now) {
    if (!iso) return null;
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return null;
    const ms = (now === undefined ? Date.now() : now) - then;
    /*
     * A clock ahead of the server reads as the future. Clamped to zero rather
     * than shown as "-3m", which is the sort of thing that makes somebody stop
     * believing the rest of the screen.
     */
    return Math.max(0, Math.floor(ms / 60000));
  }

  /** fresh / waiting / late, or '' when there is no time to judge. */
  function age(minutes) {
    if (minutes === null || minutes === undefined) return '';
    if (minutes >= LATE) return 'late';
    if (minutes >= WAITING) return 'waiting';
    return 'fresh';
  }

  /**
   * The wait, in words.
   *
   * Rounded the way somebody would say it out loud. Nobody reports "87
   * minutes" - they say "an hour and a half" - and past two hours the minutes
   * have stopped carrying information anybody acts on.
   */
  function saidAs(minutes) {
    if (minutes === null || minutes === undefined) return '';
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + ' min';

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours >= 3) return hours + ' hr';
    return rest ? hours + ' hr ' + rest + ' min' : hours + ' hr';
  }

  /**
   * One table's line under its name: item quantity and order total.
   *
   * The amount is omitted when it is zero. A shop whose KOT flow does not
   * carry totals would otherwise show a column of confident, wrong zeroes.
   */
  function summary(detail, currency) {
    if (!detail) return '';
    const parts = [];
    const count = detail.item_count;
    if (Number.isFinite(count) && count >= 0) {
      const label = count === 1 ? '1 item' : '{0} items';
      parts.push((typeof I18N !== 'undefined' ? I18N.t(label) : label).replace('{0}', String(count)));
    }
    const amount = Number(detail.amount) || 0;
    if (detail.payableLabel) parts.push(detail.payableLabel);
    else if (amount > 0) parts.push(typeof CaptainMoney !== 'undefined' ? CaptainMoney.display(amount) : (currency || '₹') + amount.toFixed(0));
    return parts.join(' · ');
  }

  /**
   * The floor, oldest first.
   *
   * THE ORDER IS THE POINT. Alphabetical puts table 1 first whether it has
   * been waiting a minute or an hour, which is the same as no order at all.
   * The table that has been waiting longest is the one somebody should walk
   * to, so it is the one at the top - and a table with no time known sorts
   * last rather than first, because an unknown is not an emergency.
   */
  function order(details, now) {
    return (details || [])
      .map((detail) => ({
        ...detail,
        minutes: minutesSince(detail.since, now),
      }))
      .sort((a, b) => {
        if (a.minutes === null && b.minutes === null) {
          return String(a.table_number).localeCompare(String(b.table_number), undefined, {
            numeric: true,
            sensitivity: 'base',
          });
        }
        if (a.minutes === null) return 1;
        if (b.minutes === null) return -1;
        return b.minutes - a.minutes;
      });
  }

  /**
   * Detail for a table, from whichever shape the server sent.
   *
   * A handset can be pointed at a till that has not been updated yet, and that
   * one answers with names and nothing else. Everything here degrades to a
   * card with a name on it, which is exactly what the screen used to be - no
   * worse than before, rather than blank.
   */
  function detailFor(data, name) {
    const list = (data && data.table_details) || [];
    for (const row of list) {
      if (String(row.table_number) === String(name)) return row;
    }
    return null;
  }

  function itemCount(items) {
    return (items || []).reduce((sum, item) => {
      if (!item || item.return || item.cancelled || ['cancelled','canceled'].includes(String(item.status || '').toLowerCase())) return sum;
      const quantity = Number(item.item_quantity ?? item.quantity ?? item.sale_inline_item_qty);
      return sum + (Number.isFinite(quantity) ? Math.max(0, quantity) : 0);
    }, 0);
  }
  return { minutesSince, age, saidAs, summary, itemCount, order, detailFor, WAITING, LATE };
});
