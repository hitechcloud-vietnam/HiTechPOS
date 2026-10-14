/*
 * THE REQUESTS PANEL, ON THE PHONE IN THE WAITER'S HAND.
 *
 * Owner: "when customer aks for change. cancel then desktop or captain app
 * clearly can see the changes."
 *
 * The till has had a dock for this. The handset had nothing at all, which is
 * the wrong way round: the waiter is the one standing next to the customer,
 * and was the only member of staff who could not be told that table nine had
 * asked to drop a dish. They found out when the food came back.
 *
 * WHY A SHEET AND NOT A PAGE. A waiter is on the floor view with tables in
 * front of them and a customer looking at them. A request that needs an answer
 * in the next two minutes cannot live behind a navigation, so it comes to
 * them: a button that carries the count, and a sheet over the screen.
 *
 * IT DECIDES NOTHING OF ITS OWN. Accept and refuse go through the same
 * endpoint the till's dock and the console queue use, so there is one
 * implementation of what accepting a cancellation means and this is a third
 * door onto it rather than a third copy of it.
 *
 * NOTHING HERE MAY THROW. A handset that crashes on the floor view because a
 * queue could not be read is worse than one that shows no queue: the waiter
 * still has tables to serve.
 */

(function () {
  'use strict';

  /* The same pace the till polls at. Two members of staff looking at one
     queue should not see it change at different times. */
  const EVERY_MS = 20000;
  const SHEET_ID = 'posnic-requests';
  const BUTTON_ID = 'posnic-requests-open';

  let rows = [];
  let open = false;
  let busy = {};
  let timer = 0;

  /* What each question is called, on this screen, in this app's own words.
     The keys come from Requests.askedFor; the sentences are ours. */
  const WORDS = {
    cancel_order: 'Cancel the whole order',
    remove_everything: 'Remove everything on the order',
    remove_one: 'Remove an item',
    remove_some: 'Remove some items',
    fewer: 'Asked for fewer',
    table_calling: 'Table is calling',
    already_cancelled: 'Customer cancelled this',
    new_order: 'New order',
  };

  /*
   * What "yes" and "no" mean, which depends on the kind.
   *
   * Mirrored from the till's dock and the console queue, because the approval
   * state machine wants the STATE for a new order and the customer's wish for
   * a request. Sending "accept" for a new order gets "unknown state" back.
   */
  const VERBS = {
    new: { yes: 'accepted', no: 'rejected' },
    cancel: { yes: 'cancel', no: 'keep' },
    change: { yes: 'accept', no: 'keep' },
    gone: { yes: 'seen', no: 'seen' },
    /* Nothing to decide: acknowledging IS the answer. */
    waiter: { yes: 'seen', no: 'seen' },
  };

  const esc = (value) =>
    String(value == null ? '' : value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );

  function ago(order) {
    const minutes = Requests.minutesSince(order.created_date);
    if (minutes === null) return '';
    if (minutes < 1) return 'just now';
    return minutes === 1 ? '1 minute ago' : minutes + ' minutes ago';
  }

  /** One line of the order, before and after. */
  function lineHtml(row) {
    const name = esc(row.name);
    if (row.state === 'same') return '<li class="same">' + row.was + ' &times; ' + name + '</li>';
    if (row.state === 'gone') return '<li class="gone">' + name + ' <b>REMOVED</b></li>';
    if (row.state === 'added')
      return '<li class="moved">+ ' + row.now + ' &times; ' + name + '</li>';
    return '<li class="moved">' + name + ' <b>' + row.was + ' &rarr; ' + row.now + '</b></li>';
  }

  function cardHtml(order) {
    const kind = Requests.kindOf(order);
    const id = String(order.sale_id || '');
    const lines = Requests.linesOf(order).map(lineHtml).join('');
    const where = order.destination
      ? 'Table ' + esc(order.destination)
      : esc(order.fulfilment || '');
    const working = busy[id] ? ' is-working' : '';

    return (
      '<li class="rq-card" data-kind="' + esc(kind) + '" data-order="' + esc(id) + '">' +
      '<div class="rq-top">' +
      '<span class="rq-what">' + esc(WORDS[Requests.askedFor(order)] || 'New order') + '</span>' +
      '<span class="rq-when">' + esc(ago(order)) + '</span>' +
      '</div>' +
      '<div class="rq-who">' +
      (order.sales_id ? '<b>' + esc(order.sales_id) + '</b>' : '') +
      (order.token_id ? '<span>Token ' + esc(order.token_id) + '</span>' : '') +
      (where ? '<span>' + where + '</span>' : '') +
      '</div>' +
      (lines ? '<ul class="rq-lines">' + lines + '</ul>' : '') +
      /* Already off: one button, and it says what it does. Two buttons on
         something nobody can decide is two ways to be confused. */
      (kind === 'gone' || kind === 'waiter'
        ? '<div class="rq-do"><button type="button" class="rq-yes' +
          working +
          '" data-do="yes">Got it</button></div>'
        : '<div class="rq-do">' +
          '<button type="button" class="rq-no' + working + '" data-do="no">Leave it</button>' +
          '<button type="button" class="rq-yes' + working + '" data-do="yes">Do it</button>' +
          '</div>') +
      '</li>'
    );
  }

  function sheet() {
    let element = document.getElementById(SHEET_ID);
    if (element) return element;
    element = document.createElement('div');
    element.id = SHEET_ID;
    element.className = 'rq-sheet';
    element.hidden = true;
    element.innerHTML =
      '<div class="rq-shade"></div>' +
      '<div class="rq-panel" role="dialog" aria-label="Customer requests">' +
      '<div class="rq-head"><b>Customer requests</b>' +
      '<button type="button" class="rq-close" aria-label="Close">&times;</button></div>' +
      /* The switch lives in the panel rather than a settings screen: the
         moment somebody wants to silence calls is the moment they are
         looking at one. */
      '<label class="rq-mute"><input type="checkbox" class="rq-mute-box">' +
      '<span>Do not call me to tables</span></label>' +
      '<ul class="rq-list"></ul></div>';
    document.body.appendChild(element);

    element.addEventListener('change', (event) => {
      if (event.target.classList.contains('rq-mute-box')) mute(event.target.checked);
    });

    element.addEventListener('click', (event) => {
      if (event.target.closest('.rq-close') || event.target.classList.contains('rq-shade')) {
        open = false;
        paint();
        return;
      }
      const button = event.target.closest('[data-do]');
      if (button) decide(button);
    });
    return element;
  }

  function button() {
    let element = document.getElementById(BUTTON_ID);
    if (element) return element;
    element = document.createElement('button');
    element.id = BUTTON_ID;
    element.type = 'button';
    element.className = 'rq-open';
    element.hidden = true;
    element.addEventListener('click', () => {
      open = true;
      paint();
    });
    document.body.appendChild(element);
    return element;
  }

  /*
   * A WAITER WHO IS NOT TAKING CALLS.
   *
   * Owner: "captain app can switch off if he wants."
   *
   * Per DEVICE, not per shop, and deliberately. Four handsets on a floor are
   * four people, and the one running the bar has no business being buzzed by
   * table nine - while the shop as a whole absolutely still wants the call
   * answered by somebody. A shop-wide setting would turn one person's
   * preference into everybody's blind spot.
   *
   * It silences the CALLS only. A customer asking to cancel an order is a
   * decision somebody has to make, and there is no reading of "switch it off"
   * that should hide one of those.
   */
  const MUTED_KEY = 'posnic.calls-muted';

  function muted() {
    try {
      return localStorage.getItem(MUTED_KEY) === 'yes';
    } catch (e) {
      /* A browser with storage blocked hears calls, which is the safer way
         round: a waiter who cannot silence them is inconvenienced, one who
         is silenced without knowing it leaves a table sitting. */
      return false;
    }
  }

  function mute(on) {
    try {
      if (on) localStorage.setItem(MUTED_KEY, 'yes');
      else localStorage.removeItem(MUTED_KEY);
    } catch (e) {
      /* Nothing to do about it, and nothing worth breaking the panel for. */
    }
    paint();
  }

  /** What this handset should be shown, which is not always everything. */
  function forThisHandset(all) {
    const waiting = Requests.waiting(all);
    if (!muted()) return waiting;
    return waiting.filter((row) => Requests.kindOf(row) !== 'waiter');
  }

  /*
   * A HANDSET THAT MAKES A NOISE.
   *
   * Owner: "desktop app and captain mobile apps getting notification...
   * coz everytime its annoying people see waiters to turn back."
   *
   * The panel drew the call and counted it, and said nothing at all. A phone
   * in an apron pocket showing a silent badge is the exact problem this
   * feature was built to solve, moved onto a smaller screen: somebody still
   * has to think to look. So a request that arrives makes a sound and, where
   * the device can, a buzz - and the buzz is the half that works through
   * cloth, in a room with a blender running.
   *
   * ONCE PER REQUEST, NEVER REPEATED. The till's alarm repeats because it
   * stands on a counter nobody is facing. A phone that keeps buzzing in a
   * pocket is a phone somebody silences for the whole shift, and the switch
   * below would then be taking the cancellations down with the calls - which
   * is precisely what it was written not to do.
   */

  /* The same two patterns the till and the console use, so a shop running all
     three hears one product rather than three. */
  const NOTES = {
    received: [
      [784, 0.11, 0.35],
      [1047, 0.16, 0.35],
    ],
    waiting: [
      [988, 0.15, 0.5],
      [740, 0.15, 0.5],
      [988, 0.26, 0.5],
    ],
  };

  /* And the same two shapes as vibration: one tap, or three insistent ones. */
  const BUZZ = { received: 120, waiting: [120, 90, 120] };

  /* What has already been said, by id and by WHY. An order that was waiting
     for approval and then has a cancellation asked about it is news again. */
  let said = Object.create(null);
  let sounds = null;

  const keyOf = (row) => String(row.sale_id || '') + ':' + Requests.kindOf(row);

  function audio() {
    if (sounds) return sounds;
    try {
      const Maker =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : typeof webkitAudioContext !== 'undefined'
            ? webkitAudioContext
            : null;
      sounds = Maker ? new Maker() : null;
    } catch (e) {
      /* No audio on this device. The buzz and the badge carry it. */
      sounds = null;
    }
    return sounds;
  }

  function tone(which) {
    if (window.CaptainPhone?.enabled("sound") === false) return false;
    const ctx = audio();
    if (!ctx) return false;
    try {
      /* A WebView refuses audio until something has been tapped. A waiter has
         tapped their way to this screen, so this normally resumes. */
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      let at = ctx.currentTime;
      (NOTES[which] || NOTES.received).forEach((note) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = note[0];
        osc.type = 'sine';
        /* Short ramps at both ends: a square start and stop is heard as a
           click, which is what makes a synthesised tone sound cheap. */
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(note[2], at + 0.012);
        gain.gain.setValueAtTime(note[2], at + note[1] - 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + note[1]);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + note[1] + 0.01);
        at += note[1];
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function buzz(which) {
    if (window.CaptainPhone) return CaptainPhone.vibrate(BUZZ[which] || BUZZ.received);
    try {
      /* Android gives a WebView this; iOS does not, and silently having no
         vibration is fine - the tone is still made. */
      if (typeof navigator === 'undefined') return false;
      if (typeof navigator.vibrate !== 'function') return false;
      navigator.vibrate(BUZZ[which] || BUZZ.received);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Say something about what is new, at most once.
   *
   * @param {Array} shown       what this handset is being shown
   * @param {Array} everything  what is waiting, including what it is not
   */
  function announce(shown, everything) {
    let ring = '';
    (shown || []).forEach((row) => {
      if (said[keyOf(row)]) return;
      /* A new order is the brief chime; anything somebody has to DECIDE - a
         call, a cancellation, a change - is the longer, louder one. One ring
         for a poll however much arrived in it, because three buzzes at once
         is not three times the information. */
      if (Requests.kindOf(row) !== 'new') ring = 'waiting';
      else if (!ring) ring = 'received';
    });

    /*
     * Remembered from EVERYTHING waiting rather than only from what was
     * shown, so turning the switch back off does not buzz about a call that
     * has been standing there all along. Somebody un-muting has chosen to
     * start hearing calls, not to be startled by an old one.
     *
     * Replaced rather than added to, which forgets what has gone: the same
     * table calling again later is news again rather than silence.
     */
    const now = Object.create(null);
    (everything || []).forEach((row) => {
      now[keyOf(row)] = true;
    });
    said = now;

    if (!ring) return false;
    tone(ring);
    buzz(ring);
    return true;
  }

  function paint() {
    try {
      const waiting = forThisHandset(rows);
      /* Before anything is drawn, because a waiter looking the other way is
         the whole reason this panel exists. */
      announce(waiting, Requests.waiting(rows));
      const tab = button();
      /* No requests, no button. A control that is always there and usually
         does nothing is a control people stop seeing. */
      tab.hidden = waiting.length === 0;
      tab.textContent = waiting.length === 1 ? '1 request' : waiting.length + ' requests';

      const box = sheet();
      /*
       * Still openable while muted, so the switch can be turned back off.
       * A panel that hides itself the moment somebody silences it is a
       * panel they cannot un-silence.
       */
      box.hidden = !open;
      if (box.hidden) return;
      const check = box.querySelector('.rq-mute-box');
      if (check) check.checked = muted();
      box.querySelector('.rq-list').innerHTML = waiting.map(cardHtml).join('');
    } catch (e) {
      /* See the note at the top: the waiter still has tables to serve. */
      console.warn('requests panel could not be drawn:', e && e.message);
    }
  }

  async function decide(element) {
    const card = element.closest('.rq-card');
    if (!card) return;
    const id = card.getAttribute('data-order');
    const kind = card.getAttribute('data-kind');
    const verbs = VERBS[kind] || VERBS.new;
    const decision = element.getAttribute('data-do') === 'yes' ? verbs.yes : verbs.no;
    if (busy[id]) return;

    busy[id] = true;
    paint();
    try {
      /*
       * A call is not an order and has no approval to give, so it is marked
       * SEEN through its own door rather than run through a state machine
       * that has no state for it.
       */
      await POSNIC.api.post(
        kind === 'waiter'
          ? '/sales/waiterCalls/' + encodeURIComponent(id) + '/seen'
          : '/sales/' + encodeURIComponent(id) + '/approval',
        { decision }
      );
      /* Taken off the list here rather than waiting for the next poll: twenty
         seconds of a card that has already been answered is twenty seconds in
         which somebody answers it again. */
      rows = rows.filter((row) => String(row.sale_id) !== String(id));
    } catch (e) {
      console.warn('could not answer the request:', e && e.message);
    }
    delete busy[id];
    paint();
  }

  /*
   * NOT WHILE SOMEBODY IS CHOOSING A SERVER, and not before there is one.
   *
   * This polled from the moment the page loaded, whatever else was happening.
   * Two things went wrong with that, and the second is the one that matters:
   *
   *   On a handset with no shop yet it dialled nothing, repeatedly.
   *
   *   On the CONNECT screen it dialled the OLD address while somebody was
   *   typing a new one - and a failed request wakes resolution, so the app ran
   *   a discovery sweep against the very address being corrected. The health
   *   loop has always held off for exactly this reason (see net.start), and
   *   this is the same rule, borrowed rather than reinvented.
   *
   * The interval keeps running: it simply has nothing to do until the editor
   * closes, which is what makes the queue appear by itself afterwards.
   */
  function notYet() {
    try {
      if (!POSNIC.server || !POSNIC.server.isConfigured) return true;
      return !!(POSNIC.net && POSNIC.net.choosingServer && POSNIC.net.choosingServer());
    } catch (e) {
      /* If that cannot even be asked, this is not the screen to find out on. */
      return true;
    }
  }

  async function look() {
    if (notYet()) return;
    try {
      const answer = await POSNIC.api.get('/sales/pendingOnlineOrders');
      /*
       * The calls ride in their own key, never mixed into the orders: a
       * handset running an older build reads `data` and is unaffected, where
       * a merged list would have it draw a table's call as a NEW ORDER with
       * an accept button that means nothing.
       *
       * Shaped into rows the rest of this file already understands, so the
       * card, the count and the answer all work without knowing anything new.
       * `sale_id` carries the CALL's id because that is what the answer is
       * posted against.
       */
      const orders = (answer && answer.data) || [];
      const calls = (answer && answer.calls) || [];
      rows = (Array.isArray(orders) ? orders : []).concat(
        (Array.isArray(calls) ? calls : []).map((call) => ({
          sale_id: String(call.call_id || ''),
          call_id: String(call.call_id || ''),
          destination: String(call.table_number || ''),
          created_date: call.called_at || null,
          items: [],
        }))
      );
    } catch (e) {
      /* An unreachable till is not an empty queue. Keeping what was last seen
         beats blanking the panel while a waiter is reading it. */
    }
    paint();
  }

  function start() {
    if (timer) return;
    look();
    timer = setInterval(look, EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) look();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.PosnicRequests = {
    look,
    paint,
    cardHtml,
    muted,
    mute,
    saw(next) {
      rows = next || [];
      paint();
    },
    toggle(on) {
      open = !!on;
      paint();
    },
  };
})();
