/*
 * A PIN UNLOCKS, A PASSWORD AUTHENTICATES.
 *
 * Owner: "username password not saved already. everytime i need to enter...
 * may we can register like one more native auth like face, fignerprint pincode
 * as per handset. its easy than username password everytime."
 *
 * Two separate things were wrong and only one of them was this.
 *
 * THE TYPING was the token: a handset credential lasted 24 hours, so a waiter
 * who does not know the shop password needed a manager at the start of every
 * service. That is fixed on the server, and a phone now stays signed in for
 * thirty days.
 *
 * WHICH LEAVES A DIFFERENT PROBLEM, and it is the one this file is for. A
 * phone that stays signed in for a month is a phone that anybody who picks it
 * up can take orders on. The answer is not to make the waiter type a password
 * again - that is where the app started - it is a lock that costs four digits.
 *
 * The rule is the till's, and it is the whole design:
 *
 *     a PIN unlocks, a password authenticates.
 *
 * A PIN can only resume a session a password already established on this
 * phone. Sign out deliberately and the phone forgets you; the way back in is
 * the password. So a four-digit number is never a credential - it cannot get
 * anybody into a shop they were not already signed into on this device.
 *
 * FINGERPRINT AND FACE are deliberately not here. They need a native plugin,
 * which changes the Android build, and a real phone with a real sensor to
 * prove the prompt appears at all. Shipping that unverified into a shop is how
 * the kitchen audio spent a week silent. The seam is ready: `unlock()` is the
 * only door, and a sensor becomes one more way through it.
 *
 * OFF UNLESS SOMEBODY TURNS IT ON. An update must never start demanding a
 * number nobody has been given.
 */
(function (root) {
  'use strict';

  const STORE = 'posnic.lock';
  const DIGITS = 4;

  /*
   * How many wrong tries before the PIN is forgotten.
   *
   * Not a lockout, which would strand a waiter mid-service with a queue: the
   * PIN is forgotten and the password is asked for instead, which is the thing
   * that can actually get them back in. Five is enough to survive a pocket and
   * few enough to be worth nothing to somebody guessing.
   */
  const TRIES = 5;

  function read() {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(value) {
    try {
      if (value) localStorage.setItem(STORE, JSON.stringify(value));
      else localStorage.removeItem(STORE);
      return true;
    } catch (e) {
      /* Private mode, or storage full. A lock that cannot be stored is not a
         lock, and pretending otherwise would lock somebody out of a phone that
         had never really been locked. */
      return false;
    }
  }

  /*
   * Stored as a hash with a salt, never as the number.
   *
   * localStorage on a handset is not a secret store and this does not pretend
   * to be one: somebody with the phone unlocked and a debugger can read the
   * hash. What it stops is the thing that actually happens, which is the PIN
   * being legible to anybody who glances at the storage panel, and it costs
   * four lines.
   */
  async function digest(pin, salt) {
    const text = String(salt) + ':' + String(pin);
    try {
      const bytes = new TextEncoder().encode(text);
      const hashed = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hashed))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (e) {
      /* No SubtleCrypto on this WebView. A weaker fold is still better than
         the number in the clear, and the alternative is refusing to offer a
         lock at all on the oldest phones, which are the ones most likely to be
         handed round. */
      let sum = 0;
      for (let i = 0; i < text.length; i += 1) sum = (sum * 31 + text.charCodeAt(i)) >>> 0;
      return 'weak-' + sum.toString(16);
    }
  }

  const newSalt = () => {
    try {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (e) {
      return String(Date.now()) + String(Math.random()).slice(2);
    }
  };

  const looksLikeAPin = (pin) => new RegExp('^\\d{' + DIGITS + '}$').test(String(pin || ''));

  /** Has somebody set one on this phone? */
  function isSet() {
    if (root.CaptainAccess && root.CaptainAccess.pinSet) return true;
    const held = read();
    return !!(held && held.hash && held.salt);
  }

  /**
   * Set or replace the PIN.
   *
   * @returns {Promise<boolean>} false when it is not four digits, or when
   *   storage refused it - in which case nothing was locked.
   */
  async function set(pin) {
    if (root.CaptainAccess) { try { return await root.CaptainAccess.setPin(pin); } catch (e) { return false; } }
    if (!looksLikeAPin(pin)) return false;
    const salt = newSalt();
    return write({ salt, hash: await digest(pin, salt), left: TRIES });
  }

  /** Forget it. The password is then the only way back in. */
  function clear() {
    if (root.CaptainAccess?.pinSet) { void root.CaptainAccess.removePin(); return true; }
    return write(null);
  }

  /**
   * Try a PIN.
   *
   * @returns {Promise<{ok: boolean, left: number, forgotten: boolean}>}
   *   `forgotten` means the tries ran out and the PIN is gone, so the caller
   *   must ask for the password rather than offering the pad again.
   */
  async function check(pin) {
    if (root.CaptainAccess?.pinSet) { try { return await root.CaptainAccess.unlock(pin); } catch (e) { return {ok:false,left:0,forgotten:true,message:e.message}; } }
    const held = read();
    if (!held) return { ok: false, left: 0, forgotten: true };

    if (await digest(pin, held.salt) === held.hash) {
      /* A good try restores the count. Somebody who fat-fingers one digit on
         Monday must not arrive at Friday with one try left. */
      write({ salt: held.salt, hash: held.hash, left: TRIES });
      if (root.CaptainAccess) { await root.CaptainAccess.setPin(pin); write(null); }
      return { ok: true, left: TRIES, forgotten: false };
    }

    const left = Math.max(0, (Number(held.left) || TRIES) - 1);
    if (left === 0) {
      clear();
      return { ok: false, left: 0, forgotten: true };
    }

    write({ salt: held.salt, hash: held.hash, left });
    return { ok: false, left, forgotten: false };
  }

  /** How many tries are left before the password is asked for. */
  function triesLeft() {
    const held = read();
    if (!held) return 0;
    return Number(held.left) || TRIES;
  }

  /* --------------------------------------------------------------- the pad */

  let asking = null, checking = false, priorFocus = null, background = [];

  function pad() {
    if (document.getElementById('posnic-lock')) return;

    const style = document.createElement('style');
    style.textContent = `
      #posnic-lock {
        position: fixed; inset: 0; z-index: 2147483646;
        display: none; align-items: center; justify-content: center;
        background: var(--surface,#fff); color: var(--ink,#17243a); padding: max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom)); overflow:auto; box-sizing:border-box;
        font: 16px/1.5 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
      }
      #posnic-lock.is-open { display: flex; }
      #posnic-lock-card { width: min(320px, 100%); text-align: center; }
      #posnic-lock-who { font-size: 24px; font-weight: 650; margin: 0 0 4px; }
      #posnic-lock-why { font-size: 14px; color: var(--ink-soft,#647084); margin: 0 0 22px; }
      #posnic-lock-dots { display: flex; gap: 14px; justify-content: center; margin-bottom: 8px; }
      .posnic-lock-dot {
        width: 14px; height: 14px; border-radius: 50%;
        border: 2px solid var(--line,#cbd5e1); box-sizing: border-box;
      }
      .posnic-lock-dot.is-on { background: var(--accent,#2459de); border-color: var(--accent,#2459de); }
      #posnic-lock-warn { min-height: 20px; font-size: 13px; color: var(--bad,#b33336); margin-bottom: 14px; }
      #posnic-lock-keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; direction:ltr; }
      #posnic-lock-keys button {
        min-height: 62px; border: none; border-radius: 12px;
        background: var(--surface-sunk,#f4f7fb); color: var(--ink,#17243a); font-size: 24px; font-weight: 500;
        cursor: pointer;
      }
      #posnic-lock-keys button:active { background: var(--accent-soft,#edf2ff); }
      #posnic-lock-password {
        margin-top: 18px; background: none; border: none; color: var(--ink-soft,#647084);
        font-size: 14px; min-height:48px; padding:12px; cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const screen = document.createElement('div');
    screen.id = 'posnic-lock';
    screen.setAttribute('role','dialog'); screen.setAttribute('aria-modal','true'); screen.setAttribute('aria-labelledby','posnic-lock-why');
    screen.innerHTML =
      '<div id="posnic-lock-card">' +
      '<p id="posnic-lock-who"></p>' +
      '<p id="posnic-lock-why">Enter your PIN</p>' +
      '<div id="posnic-lock-dots"></div>' +
      '<div id="posnic-lock-warn" role="alert"></div>' +
      '<div id="posnic-lock-keys"></div>' +
      '<button type="button" id="posnic-lock-password">Use my password instead</button>' +
      '</div>';
    document.body.appendChild(screen);

    const dots = screen.querySelector('#posnic-lock-dots');
    for (let i = 0; i < DIGITS; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'posnic-lock-dot';
      dots.appendChild(dot);
    }

    const keys = screen.querySelector('#posnic-lock-keys');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach((key) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = key;
      if (!key) { button.style.visibility = 'hidden'; button.tabIndex = -1; }
      if (key === '⌫') button.setAttribute('aria-label', root.I18N?.t('Remove') || 'Remove');
      button.addEventListener('click', () => press(key));
      keys.appendChild(button);
    });

    screen.querySelector('#posnic-lock-password').addEventListener('click', () => {if (!checking) settle(false);});
    window.addEventListener('captain:back', event => {if(!asking)return;event.preventDefault();event.stopImmediatePropagation();if(!checking)settle(false);},true);
    screen.addEventListener('keydown', event => {
      if (!asking) return;
      if (/^\d$/.test(event.key) || event.key === 'Backspace') {event.preventDefault();void press(event.key === 'Backspace' ? '⌫' : event.key);}
      if (event.key === 'Escape') {event.preventDefault();if(!checking)settle(false);}
      if (event.key === 'Tab') {
        const buttons=[...screen.querySelectorAll('button')].filter(button=>!button.disabled && button.tabIndex !== -1);
        if (!buttons.length) {event.preventDefault();return;}
        const first=buttons[0],last=buttons[buttons.length-1];
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
      }
    });
  }

  let entered = '';
  /* Set while a PIN is being chosen rather than checked, so the pad sends the
     digits there instead of to the door. */
  let choosing = null;

  function paint() {
    const dots = document.querySelectorAll('.posnic-lock-dot');
    dots.forEach((dot, i) => dot.classList.toggle('is-on', i < entered.length));
  }

  async function press(key) {
    if (!asking || checking) return;
    if (key === '⌫') {
      entered = entered.slice(0, -1);
      paint();
      return;
    }
    if (!/^\d$/.test(key) || entered.length >= DIGITS) return;

    entered += key;
    paint();
    if (entered.length < DIGITS) return;

    checking = true;
    document.querySelectorAll('#posnic-lock button').forEach(button=>button.disabled=true);
    try {
    if (choosing) {
      const digits = entered;
      entered = '';
      paint();
      await choosing(digits);
      return;
    }

    const said = await check(entered);
    entered = '';
    paint();

    if (said.ok) return settle(true);

    const warn = document.getElementById('posnic-lock-warn');
    if (said.forgotten) {
      /* Out of tries. The PIN is gone, so offering the pad again would be
         asking for something that can no longer work. */
      if (warn) warn.textContent = said.message || (root.CaptainAccess ? 'Ask your manager to reconnect this phone. Your orders are saved.' : 'Too many tries. Sign in with your password.');
      setTimeout(() => settle(false), 1200);
      return;
    }
    if (warn) {
      warn.textContent =
        said.left === 1 ? 'Wrong PIN. One try left.' : 'Wrong PIN. ' + said.left + ' tries left.';
    }
    } finally {checking=false;document.querySelectorAll('#posnic-lock button').forEach(button=>button.disabled=false);}
  }

  function settle(unlocked) {
    if (!asking) return;
    const done = asking;
    asking = null;
    entered = '';
    const screen = document.getElementById('posnic-lock');
    if (screen) screen.classList.remove('is-open');
    for (const [node,wasInert] of background) node.inert=wasInert;
    background=[];priorFocus?.focus?.({preventScroll:true});
    done(unlocked);
  }

  function showPad(screen) {
    priorFocus = document.activeElement;
    background = [...document.body.children].filter(node=>node!==screen).map(node=>[node,node.inert]);
    background.forEach(([node])=>node.inert=true);
    screen.classList.add('is-open');
    root.I18N?.apply(screen);
    screen.querySelector('#posnic-lock-keys button')?.focus();
  }

  /**
   * Ask for the PIN.
   *
   * @param {string} [who] whose phone this is, so a shared handset says which
   *   account is about to be unlocked rather than just demanding digits.
   * @param {{why?: string, escape?: string}} [options] what the pad says it
   *   is asking for, and what the way out of it is called.
   * @returns {Promise<boolean>} false means use the password instead - either
   *   because they asked, or because the tries ran out.
   */
  function unlock(who, options) {
    if (!isSet()) return Promise.resolve(true);

    pad();
    if (asking) settle(false);

    const screen = document.getElementById('posnic-lock');
    document.getElementById('posnic-lock-who').textContent = who || '';
    /*
     * RESET WHAT CHOOSE() WROTE. There is one pad and it does two jobs, so
     * a phone that has just set a PIN would otherwise be asked to "Enter it
     * again" the next time it was asked to unlock.
     *
     * The words are arguments because the pad asks for the same four digits
     * for different reasons - to open the app, and to prove somebody may
     * turn the lock off - and "Use my password instead" is an answer to
     * only one of them.
     */
    document.getElementById('posnic-lock-why').textContent =
      (options && options.why) || 'Enter your PIN';
    document.getElementById('posnic-lock-password').textContent =
      (options && options.escape) || 'Use my password instead';
    document.getElementById('posnic-lock-warn').textContent = '';
    entered = '';
    paint();
    showPad(screen);

    return new Promise((resolve) => {
      asking = resolve;
    });
  }

  /**
   * Choose a PIN, on the same pad it will be entered on.
   *
   * Twice, because a number typed once and never seen again is a number
   * somebody locks themselves out with on the first morning. The same pad
   * rather than a form, so the thing they practise is the thing they will do.
   *
   * @returns {Promise<boolean>} false if they backed out.
   */
  function choose() {
    pad();
    if (asking) settle(false);

    const screen = document.getElementById('posnic-lock');
    const who = document.getElementById('posnic-lock-who');
    const why = document.getElementById('posnic-lock-why');
    const warn = document.getElementById('posnic-lock-warn');
    const out = document.getElementById('posnic-lock-password');

    who.textContent = 'Lock this phone';
    why.textContent = 'Choose a 4 digit PIN';
    warn.textContent = '';
    out.textContent = 'Not now';
    entered = '';
    paint();
    showPad(screen);

    let first = null;
    choosing = async (digits) => {
      if (first === null) {
        first = digits;
        why.textContent = 'Enter it again';
        return;
      }
      if (digits !== first) {
        first = null;
        why.textContent = 'Choose a 4 digit PIN';
        warn.textContent = 'Those did not match. Start again.';
        return;
      }
      const stored = await set(digits);
      if (!stored) { first = null; why.textContent = 'Choose a 4 digit PIN'; warn.textContent = 'Could not save. Please try again.'; return; }
      choosing = null;
      out.textContent = 'Use my password instead';
      settle(stored);
    };

    return new Promise((resolve) => {
      asking = (ok) => {
        choosing = null;
        out.textContent = 'Use my password instead';
        resolve(ok);
      };
    });
  }

  root.POSNIC = root.POSNIC || {};
  root.POSNIC.lock = { isSet, set, clear, check, triesLeft, unlock, choose, DIGITS, TRIES };

  if (typeof module === 'object' && module.exports) {
    module.exports = root.POSNIC.lock;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
