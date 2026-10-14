/*
 * The microphone, and what happens to the cart when somebody speaks.
 *
 * WHAT IS SAID GOES INTO THE CART. Owner: "as soon as you heard text you need
 * to convert as cart and what said need to show the cart. if user say add 2
 * chicken briyani cart needs to get added. if user says remove 2 chicken
 * briyani remove it."
 *
 * So a spoken "add two coffee" adds two coffee, a spoken "take off the
 * coffee" takes it off, and the panel shows the cart as it now stands with
 * the lines that just changed marked. Every quantity there is a stepper and
 * every line can be struck, because "three coffee" heard as two is one tap
 * to fix and a whole order to say again. The cart is the right place for
 * this to be reversible: nothing in it has reached a kitchen.
 *
 * ONE THING IS NOT DONE ON A WORD. "send it to the kitchen" puts a button on
 * the panel that says exactly that, and a person presses it. A cart can be
 * corrected; a ticket on the pass cannot, and the one failure worse than not
 * hearing an order is confidently firing the wrong one. The owner asked for
 * the words to place the order, and they do - one tap later.
 *
 * HELD, LIKE A VOICE NOTE, OR TAPPED. Press and speak and let go; or tap and
 * it listens until tapped again. Slide left to cancel, up to lock. While it
 * listens the button breathes and five bars follow the voice, so from across
 * a table the one question - is it hearing me - has an answer.
 *
 * THE PANEL NEVER COVERS THE BILL BAR. It sits above it, and there is no
 * backdrop: the menu behind stays live, the bill button stays live. The
 * first version dimmed the whole screen and the owner's words were "bottom
 * buttons are in active". A panel is a thing beside the work, not over it.
 *
 * WHO DOES THE READING. Every shop gets voice-order.js, a fixed list of verbs
 * and a tolerant match against the menu - no key, no network. A shop that has
 * configured an AI provider gets the model instead, through the till, which
 * hears accents and local-language dish names better; and if the till does
 * not answer quickly the local reading is used, because a waiter is standing
 * at a table. Either way the answer is the same shape and the same code
 * carries it out.
 *
 * LOOKS LIKE THE REST OF THE APP. Every colour and size here is a token from
 * design.css, with the same values as fallbacks for a page that has not
 * loaded it. One accent, on the one thing to press; the rest is ink and line.
 */

(function () {
  'use strict';

  const PANEL_ID = 'posnic-voice-panel';
  const BUTTON_ID = 'posnic-voice-mic';
  const STYLE_ID = 'posnic-voice-style';

  const TAP_MS = 350;
  const CANCEL_PX = 90;
  const LOCK_PX = 80;
  /* How long the till gets to read the words with its model before the
     handset reads them itself. A person is waiting. */
  const SERVER_MS = 3000;

  let fromServer = null;
  let canListen = null;
  /* Whether the till has a model to read with. null until asked. */
  let serverReads = null;

  let session = null;
  let held = null;
  let locked = false;
  let ticker = null;

  /* What the panel shows: the cart as it stands, what just changed, which of
     those were a guess, and anything said that could not be placed at all. */
  let view = {
    cart: [],
    changed: {},
    /* item id -> the words actually said, for a line matched roughly.
       "briyani" resolving to Chicken Biryani is usually right and sometimes
       the wrong biryani, and the waiter can only check it if told. */
    rough: {},
    unplaced: [],
    said: '',
    status: '',
    pendingPlace: false,
    /*
     * WHICH OF THREE THINGS THIS PANEL IS: 'listening', 'review' or 'done'.
     *
     * It used to be one screen doing all three at once, which is why nobody
     * could tell what state it was in - and why the dishes were already on the
     * bill before anybody had agreed to them.
     */
    stage: 'listening',
    /* Understood, and NOT yet applied. The whole point of the review. */
    proposed: null,
    /* From the server's understanding, when it has one: what goes with the
       order, one sentence to read back, and the table named. */
    suggestions: [],
    summary: '',
    table: null,
  };

  /* ------------------------------------------------------------- helpers */

  const $ = (id) => document.getElementById(id);

  const escapeHtml = (text) =>
    String(text == null ? '' : text).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  const say = (message) => {
    if (typeof showToast === 'function') showToast(message);
    else if (typeof showErrorPopup === 'function') showErrorPopup(message);
  };

  function buzz(pattern) {
    try {
      if (window.CaptainPhone) CaptainPhone.vibrate(pattern);
      else if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* not every device has one */
    }
  }

  /**
   * The menu, indexed for searching.
   *
   * Reuses the index the search box built where there is one, otherwise the
   * saved menu out of IndexedDB - NOT the page's own `products`, a top-level
   * `let` in a classic script that is not on `window` and reads as undefined
   * from here. The stored copy also survives the server being unreachable.
   */
  async function menuIndex() {
    if (window._itemSearchIndex && window._itemSearchIndex.length) return window._itemSearchIndex;
    if (typeof getData !== 'function') return [];
    try {
      const stored = await getData('products');
      return Array.isArray(stored) && stored.length ? ItemSearch.index(stored) : [];
    } catch (e) {
      return [];
    }
  }

  async function cartNow() {
    if (typeof getCartData !== 'function') return [];
    try {
      const rows = await getCartData();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  /* -------------------------------------------------------------- styles */

  /*
   * Injected once. Tokens from design.css with the same values as fallbacks,
   * so the panel is the same object on a page that loaded the stylesheet and
   * one that did not. No gradients, one accent, everything else ink and line.
   */
  function styles() {
    if ($(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${BUTTON_ID}{flex:0 0 auto;margin-left:6px;width:32px;height:32px;border:1px solid var(--line-strong,#cbd5e1);
  border-radius:50%;background:var(--surface,#fff);color:var(--ink,#0f172a);font-size:13px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;touch-action:none;-webkit-user-select:none;
  user-select:none;-webkit-touch-callout:none;position:relative;transition:border-color .15s,color .15s}
#${BUTTON_ID}[data-recording="true"]{border-color:var(--bad,#dc2626);color:var(--bad,#dc2626)}
/*
 * LISTENING, as three rings leaving the button.
 *
 * One ring on a 1.2s loop read as a blink: it appeared, vanished, appeared,
 * and the gap in between looked like something had stopped. Three rings on a
 * 2.4s cycle, each starting 0.8s after the last, means one is always leaving
 * and one is always arriving - so the edge of the button is never still, and
 * the motion reads as continuous rather than repeated.
 *
 * transform and opacity only. Both are composited, so this costs no layout
 * and no paint on the cheap Android a restaurant actually buys - which is the
 * device most likely to be holding a live microphone open at the time.
 */
#${BUTTON_ID} .vm-ring{position:absolute;inset:0;border-radius:50%;border:2px solid var(--bad,#dc2626);
  opacity:0;pointer-events:none;will-change:transform,opacity}
#${BUTTON_ID}[data-recording="true"] .vm-ring{animation:posnic-voice-ring 2.4s cubic-bezier(.22,.61,.36,1) infinite}
#${BUTTON_ID}[data-recording="true"] .vm-ring:nth-child(2){animation-delay:.8s}
#${BUTTON_ID}[data-recording="true"] .vm-ring:nth-child(3){animation-delay:1.6s}
@keyframes posnic-voice-ring{
  0%{transform:scale(1);opacity:.55}
  70%{opacity:.12}
  100%{transform:scale(2.6);opacity:0}}

/*
 * And the centre alive under them.
 *
 * On the ICON, not the button. A transform on the button is the coordinate
 * system its rings expand in, so the two multiply and the rings pulse wider
 * every time the button breathes out - a wobble rather than a wave.
 */
#${BUTTON_ID}[data-recording="true"] i{animation:posnic-voice-breathe 2s ease-in-out infinite}
@keyframes posnic-voice-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}

@media (prefers-reduced-motion:reduce){
  #${BUTTON_ID}[data-recording="true"] i,
  #${BUTTON_ID}[data-recording="true"] .vm-ring{animation:none}
  #${BUTTON_ID}[data-recording="true"] .vm-ring:first-child{opacity:.4}}

#${PANEL_ID}{position:fixed;left:0;right:0;z-index:60;background:var(--surface,#fff);color:var(--ink,#0f172a);
  border-top:1px solid var(--line,#e2e8f0);box-shadow:0 -2px 16px rgba(15,23,42,.08);
  font:var(--t-base,15px)/1.45 var(--font,system-ui,-apple-system,'Segoe UI',sans-serif);
  max-height:68vh;display:none;flex-direction:column}
#${PANEL_ID}[data-open="true"]{display:flex}
#${PANEL_ID} .vp-head{display:flex;align-items:center;gap:var(--s3,12px);padding:var(--s3,12px) var(--s4,16px) 0}
#${PANEL_ID} .vp-status{font-size:var(--t-xs,12px);font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink-soft,#475569)}
#${PANEL_ID} .vp-status[data-live="true"]{color:var(--bad,#dc2626)}
#${PANEL_ID} .vp-time{font-variant-numeric:tabular-nums;color:var(--ink-soft,#475569);font-size:var(--t-sm,13px)}
#${PANEL_ID} .vp-close{margin-left:auto;width:36px;height:36px;border:0;background:none;color:var(--ink-faint,#94a3b8);
  font-size:22px;line-height:1;cursor:pointer;border-radius:50%}
/*
 * THE TRANSCRIPT, AS A TRANSCRIPT.
 *
 * Owner: "i want live transcribe and what you understood both side by side...
 * left what you talked in text. right what you extracted and modifieble."
 *
 * This was one italic line with an ellipsis on the end, sitting above an orb
 * that filled the panel - so somebody talking watched a 13px strip they could
 * not read being truncated, and reasonably concluded the thing had hung. It is
 * a column of its own now: it wraps, it scrolls, and the last words said stay
 * in view.
 */
#${PANEL_ID} .vp-said{flex:1 1 auto;min-height:0;overflow:auto;color:var(--ink,#0f172a);
  font-size:var(--t-base,15px);line-height:1.5;overflow-wrap:anywhere}
#${PANEL_ID} .vp-said:empty::before{content:attr(data-empty);color:var(--ink-faint,#94a3b8)}
/* A caret, so an open microphone that has heard nothing yet still looks
   awake. The one state this panel must never look like is stuck. */
#${PANEL_ID}[data-stage="listening"] .vp-said::after{content:'';display:inline-block;width:2px;height:1em;
  margin-left:3px;vertical-align:-2px;background:var(--bad,#dc2626);
  animation:posnic-voice-caret 1.1s steps(1) infinite}
@keyframes posnic-voice-caret{0%,49%{opacity:1}50%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){
  #${PANEL_ID}[data-stage="listening"] .vp-said::after{animation:none}}
/*
 * THE WAVE.
 *
 * scaleY on a fixed-height bar rather than an animated height: height is a
 * layout property and animating it on nine bars sixty times a second is how a
 * phone starts dropping frames while it is also holding a microphone open.
 *
 * Two modes, and the difference is honest rather than cosmetic. Where the
 * audio is going to a server the app is holding the stream itself and can
 * measure it, so the bars REACT to the voice. Where the phone's own
 * recogniser is listening there is no stream to measure - it owns the
 * microphone - so the bars run an ambient travelling wave instead. It says
 * "listening", which is true, and it does not pretend to be somebody's voice,
 * which would not be.
 */
#${PANEL_ID} .vp-bars{display:flex;align-items:center;justify-content:center;gap:3px;height:24px;
  margin:var(--s2,8px) var(--s4,16px) 0}
#${PANEL_ID} .vp-bars span{width:4px;height:22px;border-radius:2px;background:var(--bad,#dc2626);
  transform:scaleY(.12);transform-origin:center;transition:transform .12s cubic-bezier(.22,.61,.36,1);
  will-change:transform}
#${PANEL_ID} .vp-bars[data-ambient="true"] span{transition:none;
  animation:posnic-voice-wave 1.4s ease-in-out infinite}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(1){animation-delay:0s}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(2){animation-delay:.1s}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(3){animation-delay:.2s}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(4){animation-delay:.3s}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(5){animation-delay:.4s}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(6){animation-delay:.3s}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(7){animation-delay:.2s}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(8){animation-delay:.1s}
#${PANEL_ID} .vp-bars[data-ambient="true"] span:nth-child(9){animation-delay:0s}
@keyframes posnic-voice-wave{0%,100%{transform:scaleY(.15)}50%{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){
  #${PANEL_ID} .vp-bars[data-ambient="true"] span{animation:none;transform:scaleY(.4)}}
#${PANEL_ID} .vp-note{padding:var(--s2,8px) var(--s4,16px) 0;font-size:var(--t-sm,13px);color:var(--ink-soft,#475569)}
#${PANEL_ID} .vp-lines{flex:1 1 auto;min-height:0;overflow:auto}
#${PANEL_ID} .vp-row{display:flex;align-items:center;gap:var(--s2,8px);padding:var(--s2,8px) 0;
  border-bottom:1px solid var(--line,#e2e8f0)}
#${PANEL_ID} .vp-row:last-child{border-bottom:0}
#${PANEL_ID} .vp-row[data-changed="up"]{background:var(--accent-soft,#eef2ff);margin:0 calc(-1*var(--s4,16px));
  padding-left:var(--s4,16px);padding-right:var(--s4,16px)}
#${PANEL_ID} .vp-row[data-changed="down"]{opacity:.85}
/*
 * THE ORDER ARRIVING, in the sequence it was said.
 *
 * Six lines appearing in one frame is a flicker; a person cannot read a list
 * that was already finished before their eye reached it. Staggered, the rows
 * land one after another and somebody watching sees their own sentence being
 * written down, which is the whole reassurance the panel exists to give.
 *
 * The delay is capped at the eighth row. A table ordering twenty things
 * should not wait a second and a half for the last one to admit it exists.
 */
#${PANEL_ID}[data-fresh="true"] .vp-row,
#${PANEL_ID}[data-fresh="true"] .vp-prop{animation:posnic-voice-land 300ms cubic-bezier(.22,.61,.36,1) both}
#${PANEL_ID}[data-fresh="true"] .vp-row:nth-of-type(1),
#${PANEL_ID}[data-fresh="true"] .vp-prop:nth-of-type(1){animation-delay:0ms}
#${PANEL_ID}[data-fresh="true"] .vp-row:nth-of-type(2),
#${PANEL_ID}[data-fresh="true"] .vp-prop:nth-of-type(2){animation-delay:45ms}
#${PANEL_ID}[data-fresh="true"] .vp-row:nth-of-type(3),
#${PANEL_ID}[data-fresh="true"] .vp-prop:nth-of-type(3){animation-delay:90ms}
#${PANEL_ID}[data-fresh="true"] .vp-row:nth-of-type(4),
#${PANEL_ID}[data-fresh="true"] .vp-prop:nth-of-type(4){animation-delay:135ms}
#${PANEL_ID}[data-fresh="true"] .vp-row:nth-of-type(5),
#${PANEL_ID}[data-fresh="true"] .vp-prop:nth-of-type(5){animation-delay:180ms}
#${PANEL_ID}[data-fresh="true"] .vp-row:nth-of-type(6),
#${PANEL_ID}[data-fresh="true"] .vp-prop:nth-of-type(6){animation-delay:225ms}
#${PANEL_ID}[data-fresh="true"] .vp-row:nth-of-type(7),
#${PANEL_ID}[data-fresh="true"] .vp-prop:nth-of-type(7){animation-delay:270ms}
#${PANEL_ID}[data-fresh="true"] .vp-row:nth-of-type(n+8),
#${PANEL_ID}[data-fresh="true"] .vp-prop:nth-of-type(n+8){animation-delay:315ms}
@keyframes posnic-voice-land{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){
  #${PANEL_ID}[data-fresh="true"] .vp-row,
  #${PANEL_ID}[data-fresh="true"] .vp-prop{animation:none}}
#${PANEL_ID} .vp-row[data-unplaced="true"]{color:var(--warn,#b45309)}
#${PANEL_ID} .vp-step{width:34px;height:34px;border:1px solid var(--line-strong,#cbd5e1);border-radius:8px;
  background:var(--surface,#fff);color:var(--ink,#0f172a);font-size:18px;font-weight:700;line-height:1;cursor:pointer}
#${PANEL_ID} .vp-qty{min-width:26px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
#${PANEL_ID} .vp-name{flex:1;min-width:0;padding-left:var(--s1,4px)}
#${PANEL_ID} .vp-delta{font-size:var(--t-xs,12px);font-weight:700;color:var(--ink-soft,#475569)}
#${PANEL_ID} .vp-rough{font-size:var(--t-xs,12px);color:var(--warn,#b45309)}
/* How it was wanted. In the accent rather than the warning colour: a
   requirement is something the waiter asked for, not something that
   went wrong.

   NOT .vp-note - that class is already the panel's status line, and
   reusing it restyled the status line to bold accent 12px as a side
   effect nobody asked for. A Playwright strict-mode violation caught
   the duplicate before the styling was noticed. */
#${PANEL_ID} .vp-want{font-size:var(--t-xs,12px);color:var(--accent,#4f46e5);font-weight:600}
#${PANEL_ID} .vp-x{border:0;background:none;color:var(--ink-faint,#94a3b8);font-size:20px;cursor:pointer;
  width:34px;height:34px;line-height:1}
#${PANEL_ID} .vp-empty{padding:var(--s4,16px) 0;color:var(--ink-soft,#475569)}

/*
 * LISTENING IS A BIGGER MOMENT THAN A STRIP OF BARS.
 *
 * Owner: "when mic listening and stop i need some proper animation and bigger
 * area. that part not handled well."
 *
 * It was a 24px row of bars above a cart. Somebody holding a phone to take an
 * order has one question - is it hearing me - and a detail that small at the
 * top of a busy panel does not answer it across a table in a loud room.
 *
 * So while the microphone is open the panel IS the microphone: a large orb
 * with rings leaving it, the bars under it at a size worth looking at, and
 * nothing else competing.
 */
/* The right-hand column KEEPS WORKING while the microphone is open - that is
   the entire point of the split. Only the status note steps aside. */
#${PANEL_ID}[data-stage="listening"] .vp-note{display:none}
#${PANEL_ID} .vp-ear{display:none;flex-direction:column;align-items:center;gap:var(--s2,8px);
  margin-top:auto;padding-top:var(--s3,12px)}
#${PANEL_ID}[data-stage="listening"] .vp-ear{display:flex}
#${PANEL_ID} .vp-orb{position:relative;width:72px;height:72px;border-radius:50%;
  display:grid;place-items:center;background:var(--bad,#dc2626);color:#fff;font-size:28px;
  box-shadow:0 8px 30px rgba(220,38,38,.32)}
#${PANEL_ID} .vp-orb-ring{position:absolute;inset:0;border-radius:50%;border:2px solid var(--bad,#dc2626);
  opacity:0;will-change:transform,opacity;
  animation:posnic-voice-orb 2.4s cubic-bezier(.22,.61,.36,1) infinite}
#${PANEL_ID} .vp-orb-ring:nth-child(2){animation-delay:.8s}
#${PANEL_ID} .vp-orb-ring:nth-child(3){animation-delay:1.6s}
@keyframes posnic-voice-orb{0%{transform:scale(1);opacity:.5}70%{opacity:.1}100%{transform:scale(2.1);opacity:0}}
#${PANEL_ID}[data-stage="listening"] .vp-bars{height:34px;margin:0}
#${PANEL_ID}[data-stage="listening"] .vp-bars span{width:5px;height:30px}
#${PANEL_ID} .vp-ear-hint{font-size:var(--t-sm,13px);color:var(--ink-soft,#475569);text-align:center}
/* Stopping is a primary action and lives in the actions row with every other
   one, so the button that ends the current step is always in the same place.
   Red because it belongs to the microphone, which is the only red on screen -
   it is what somebody looks for the moment they finish talking. */
#${PANEL_ID} .vp-btn[data-act="stop"]{border-color:transparent;background:var(--bad,#dc2626);color:#fff}

/* The review: one row per line, sized for a thumb and a glance. */
#${PANEL_ID} .vp-prop{display:flex;align-items:flex-start;gap:var(--s3,12px);padding:var(--s3,12px) 0;
  border-bottom:1px solid var(--line,#e2e8f0)}
#${PANEL_ID} .vp-prop:last-child{border-bottom:0}
#${PANEL_ID} .vp-prop-qty{flex:0 0 40px;height:40px;border-radius:var(--radius,12px);
  background:var(--accent-soft,#eef2ff);color:var(--accent,#4f46e5);display:grid;place-items:center;
  font-weight:800;font-size:var(--t-lg,17px);font-variant-numeric:tabular-nums}
#${PANEL_ID} .vp-prop[data-kind="remove"] .vp-prop-qty{background:#fee2e2;color:#b91c1c}
#${PANEL_ID} .vp-prop[data-kind="missing"] .vp-prop-qty{background:var(--surface-sunk,#f8fafc);color:var(--ink-faint,#94a3b8)}
#${PANEL_ID} .vp-prop-what{flex:1;min-width:0;font-size:var(--t-base,15px);line-height:1.35}
#${PANEL_ID} .vp-prop-verb{color:var(--ink-soft,#475569);font-weight:600}
#${PANEL_ID} .vp-prop-note{display:block;margin-top:2px;font-size:var(--t-xs,12px);font-weight:600;
  color:var(--accent,#4f46e5)}
#${PANEL_ID} .vp-prop-why{display:block;margin-top:2px;font-size:var(--t-xs,12px);color:var(--warn,#b45309)}
#${PANEL_ID} .vp-prop-act{flex:0 0 auto;min-height:36px;padding:0 var(--s3,12px);font-size:var(--t-sm,13px)}
@media (prefers-reduced-motion:reduce){#${PANEL_ID} .vp-orb-ring{animation:none;opacity:.35}}
#${PANEL_ID} .vp-actions{display:flex;gap:var(--s2,8px);padding:var(--s2,8px) var(--s4,16px)
  calc(var(--s3,12px) + env(safe-area-inset-bottom,0px))}
#${PANEL_ID} .vp-btn{flex:1;min-height:44px;border:1px solid var(--line-strong,#cbd5e1);border-radius:var(--radius,12px);
  background:var(--surface,#fff);color:var(--ink,#0f172a);font:inherit;font-weight:700;cursor:pointer}
#${PANEL_ID} .vp-btn[data-primary="true"]{flex:2;border-color:transparent;background:var(--accent,#4f46e5);
  color:var(--accent-ink,#fff)}
#${PANEL_ID} .vp-btn:disabled{opacity:.5;cursor:default}
/* The microphone again, beside two buttons that need their words more. */
#${PANEL_ID} .vp-btn[data-icon="true"]{flex:0 0 48px;padding:0;font-size:18px}

/*
 * TWO COLUMNS: what was said, and what that became.
 *
 * Owner: "lets say you split left and right. left what you talked in text.
 * right what you extracted and modifieble. basically items quantity. below
 * confirm button ... existing addeded to cart also should be there."
 *
 * Side by side rather than one after the other, because the only question a
 * waiter has here is whether the right column matches the left, and two
 * things you have to scroll between cannot be compared at all.
 */
#${PANEL_ID} .vp-split{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr);
  flex:1 1 auto;min-height:0;overflow:hidden}
#${PANEL_ID} .vp-side{display:flex;flex-direction:column;min-width:0;min-height:0;
  padding:var(--s3,12px) var(--s4,16px)}
#${PANEL_ID} .vp-side + .vp-side{border-left:1px solid var(--line,#e2e8f0)}
#${PANEL_ID} .vp-side-head{margin:0 0 var(--s2,8px);font-size:var(--t-xs,12px);font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint,#94a3b8)}
/* Narrower than a one-handed phone in portrait. Below this a column cannot
   hold a dish name, and stacking beats breaking every word in half. */
@media (max-width:359px){
  #${PANEL_ID} .vp-split{grid-template-columns:minmax(0,1fr)}
  #${PANEL_ID} .vp-side + .vp-side{border-left:0;border-top:1px solid var(--line,#e2e8f0)}}
/* What separates the lines just heard from the ones already on the bill. */
#${PANEL_ID} .vp-group{margin:var(--s3,12px) 0 var(--s1,4px);padding-top:var(--s2,8px);
  border-top:1px solid var(--line,#e2e8f0);font-size:var(--t-xs,12px);font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint,#94a3b8)}
#${PANEL_ID} .vp-group:first-child{margin-top:0;padding-top:0;border-top:0}
/*
 * THE QUANTITY, AS A CONTROL, BEFORE IT IS COMMITTED.
 *
 * Three heard as two used to be fixable only on the bill - which meant the
 * wrong number went onto the bill first, and on a busy night it stayed there.
 */
#${PANEL_ID} .vp-prop-stack{flex:0 0 34px;display:flex;flex-direction:column;align-items:center;gap:2px}
#${PANEL_ID} .vp-prop-stack .vp-step{width:34px;height:26px;font-size:15px}
#${PANEL_ID} .vp-prop-stack .vp-prop-qty{flex:0 0 auto;width:34px;height:auto;padding:1px 0;
  font-size:var(--t-base,15px)}
`;
    (document.head || document.body).appendChild(style);
  }

  /* -------------------------------------------------------------- button */

  function micButton() {
    let button = $(BUTTON_ID);
    if (button) return button;
    const host = document.querySelector('.product-search-inner');
    if (!host) return null;

    styles();
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'Hold or tap to say the order');
    /* Rings first, icon last, so .vm-ring:nth-child(2) and (3) are rings two
       and three. With the icon first they were rings ONE and two, and the
       third never got its delay - two rings left together and the gap the
       stagger exists to fill came straight back. */
    button.innerHTML =
      '<span class="vm-ring"></span><span class="vm-ring"></span><span class="vm-ring"></span>' +
      '<i class="fas fa-microphone"></i>';

    button.addEventListener('pointerdown', onPress);
    button.addEventListener('pointermove', onMove);
    button.addEventListener('pointerup', onRelease);
    button.addEventListener('pointercancel', onRelease);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    host.appendChild(button);
    return button;
  }

  function paint(recording) {
    const button = $(BUTTON_ID);
    if (!button) return;
    button.setAttribute('data-recording', recording ? 'true' : 'false');
    /* Ready for the next time it opens, whichever path listens then. */
    if (!recording) resetLevel();
  }

  /* --------------------------------------------------------------- panel */

  function panel() {
    let element = $(PANEL_ID);
    if (element) return element;
    styles();

    element = document.createElement('div');
    element.id = PANEL_ID;
    element.setAttribute('data-open', 'false');
    element.setAttribute('role', 'region');
    element.setAttribute('aria-label', 'Order by voice');
    element.innerHTML = `
      <div class="vp-head">
        <span class="vp-status" id="${PANEL_ID}-status"></span>
        <span class="vp-time" id="${PANEL_ID}-time"></span>
        <button type="button" class="vp-close" id="${PANEL_ID}-close" aria-label="Close">&times;</button>
      </div>
      <div class="vp-split">
        <section class="vp-side" aria-label="What was said">
          <h3 class="vp-side-head">You said</h3>
          <div class="vp-said" id="${PANEL_ID}-said" data-empty="Waiting for you to speak..."></div>
          <div class="vp-ear">
            <div class="vp-orb">
              <span class="vp-orb-ring"></span><span class="vp-orb-ring"></span><span class="vp-orb-ring"></span>
              &#127908;
            </div>
            <div class="vp-bars" id="${PANEL_ID}-bars" data-ambient="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
            <div class="vp-ear-hint" id="${PANEL_ID}-hint">Keep talking. It is being written down.</div>
          </div>
        </section>
        <section class="vp-side" aria-label="What was understood">
          <h3 class="vp-side-head">The order</h3>
          <div class="vp-lines" id="${PANEL_ID}-lines"></div>
        </section>
      </div>
      <div class="vp-note" id="${PANEL_ID}-note"></div>
      <div class="vp-actions" id="${PANEL_ID}-actions"></div>`;

    document.body.appendChild(element);

    const close = $(`${PANEL_ID}-close`);
    if (close) {
      close.addEventListener('click', () => {
        /*
         * CLOSING THE PANEL CLOSES THE MICROPHONE.
         *
         * This was hidePanel alone, so tapping the cross while it was
         * listening took the panel off the screen and left the recogniser
         * running behind it - holding the microphone, still costing a paid
         * provider money, and with no way back to it short of pressing the mic
         * again. Owner: "top close button just closed. nothing happened."
         *
         * Nothing is applied on the way out. Anything already agreed to is on
         * the order and stays there; anything merely heard is dropped, which
         * is what closing something without confirming it means everywhere
         * else.
         */
        if (session) abandon();
        else hidePanel();
      });
    }

    /* One listener for every stepper and strike, because the rows are redrawn
       on every change and listeners on them would be redrawn too. */
    element.addEventListener('click', (event) => {
      const target = event && event.target;
      const control = target && typeof target.closest === 'function' ? target.closest('[data-act]') : null;
      if (!control) return;
      const act = control.getAttribute('data-act');
      const id = control.getAttribute('data-id');
      if (act === 'more') bump(id, 1);
      else if (act === 'less') bump(id, -1);
      else if (act === 'strike') strike(id);
      else if (act === 'place') confirmPlace();
      else if (act === 'search') searchFor(control.getAttribute('data-term'));
      /* Speaking again is the natural "more" after speaking. */
      else if (act === 'again') {
        hidePanel();
        setTimeout(() => {
          const mic = $(BUTTON_ID);
          if (mic) mic.click();
        }, 120);
      }
      else if (act === 'confirm') confirm();
      else if (act === 'stop') finish();
      /* Changing what was understood, before it is carried out. */
      else if (act === 'prop-more') editProposed(control.getAttribute('data-ci'), control.getAttribute('data-li'), 1);
      else if (act === 'prop-less') editProposed(control.getAttribute('data-ci'), control.getAttribute('data-li'), -1);
      else if (act === 'prop-drop') dropProposed(control.getAttribute('data-ci'), control.getAttribute('data-li'));
      else if (act === 'bill') {
        /* The dishes are already on the bill; this is the way to look at it. */
        window.location.href = 'cart.html';
      }
      else if (act === 'unplaced-drop') dropUnplaced(control.getAttribute('data-term'));
      else if (act === 'pick') pickCandidate(control.getAttribute('data-id'), Number(control.getAttribute('data-qty')) || 1, control.getAttribute('data-term'));
      else if (act === 'suggest') takeSuggestion(control.getAttribute('data-id'));
    });
    return element;
  }

  /**
   * Sit exactly on top of whatever bar is at the bottom, never over it.
   *
   * Measured rather than assumed, and not by one class name. This page has
   * had two bottom bars in its life - a `.bill-bar` and, before it, a fixed
   * footer holding #next-btn - and a panel that knew only one of them sat at
   * bottom:0 on the other and covered the Next button, which is precisely
   * the complaint this panel exists to fix. So: every fixed ancestor of the
   * Next button and the bill bar are candidates, and the first one that is
   * actually on screen at the bottom edge sets the offset.
   */
  function place() {
    const element = panel();
    element.style.bottom = `${bottomBarHeight()}px`;
  }

  function bottomBarHeight() {
    const candidates = [];
    const bill = document.querySelector('.bill-bar');
    if (bill) candidates.push(bill);
    let node = document.getElementById('next-btn');
    while (node && node !== document.body) {
      candidates.push(node);
      node = node.parentElement || null;
    }

    const viewport = Number(window.innerHeight) || 0;
    if (!viewport) return 0;

    for (const candidate of candidates) {
      if (!candidate || typeof candidate.getBoundingClientRect !== 'function') continue;
      let fixed = false;
      try {
        fixed = typeof getComputedStyle === 'function' && getComputedStyle(candidate).position === 'fixed';
      } catch (e) {
        fixed = false;
      }
      if (!fixed) continue;
      const box = candidate.getBoundingClientRect();
      if (!box || !box.height) continue;
      /*
       * On screen and touching the bottom edge - or ON ITS WAY there.
       *
       * The bill bar slides up over 220ms when the first item lands, and the
       * panel is placed the instant the words are applied, while the bar is
       * still mid-slide and measures as off-screen. Read only the geometry and
       * the panel takes bottom:0, then the bar arrives underneath it and the
       * bill button is covered - the exact complaint. So a bar that has
       * declared where it is going (.is-up) is measured by its height now,
       * and a transitionend re-places the panel for good measure.
       */
      const arriving = candidate.classList && candidate.classList.contains('is-up');
      if (arriving || (box.top < viewport && box.bottom >= viewport - 2)) {
        return Math.round(box.height);
      }
    }
    return 0;
  }

  /* The bar moves after the panel is placed; follow it. Bound once. */
  (function followTheBar() {
    if (typeof document.addEventListener !== 'function') return;
    document.addEventListener('transitionend', (event) => {
      const target = event && event.target;
      if (!target || !target.classList || !target.classList.contains('bill-bar')) return;
      const element = $(PANEL_ID);
      if (element && element.getAttribute('data-open') === 'true') place();
    });
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', () => {
        const element = $(PANEL_ID);
        if (element && element.getAttribute('data-open') === 'true') place();
      });
    }
  })();

  function showPanel() {
    place();
    panel().setAttribute('data-open', 'true');
  }

  function hidePanel() {
    const element = $(PANEL_ID);
    if (element) element.setAttribute('data-open', 'false');
  }

  const setText = (id, text) => {
    const element = $(`${PANEL_ID}-${id}`);
    if (element) element.textContent = text || '';
  };

  /*
   * How loud it is, if anybody can tell.
   *
   * Only the server path can: it holds the audio stream itself and meters it.
   * The phone's own recogniser owns the microphone and hands back words, never
   * samples - so on that path this is never called and the bars stay on their
   * ambient wave, which says "listening" without pretending to be a voice.
   *
   * The first real level switches the ambient animation off for good, because
   * a CSS animation and an inline transform fight over the same property and
   * the winner changes between frames.
   */
  let smoothed = 0;

  function setLevel(level) {
    const bars = $(`${PANEL_ID}-bars`);
    if (!bars || !bars.children || !bars.children.length) return;
    bars.setAttribute('data-ambient', 'false');

    const v = Math.max(0, Math.min(1, level));

    /*
     * Smoothed towards the reading rather than snapped to it.
     *
     * Speech is not loud continuously - it has a gap between every syllable -
     * and bars that follow the raw meter twitch between full and flat several
     * times a word. Rising fast and falling slow is how every level meter ever
     * built behaves, and it is why they look like sound rather than noise.
     */
    smoothed = v > smoothed ? v : smoothed + (v - smoothed) * 0.25;

    /* Tallest in the middle, so a voice reads as a wave and silence as a flat
       line - the shape people already know from every phone. */
    const shape = [0.35, 0.55, 0.75, 0.9, 1, 0.9, 0.75, 0.55, 0.35];
    for (let i = 0; i < bars.children.length; i++) {
      const scale = 0.12 + 0.88 * smoothed * shape[i] * (0.85 + 0.15 * Math.random());
      bars.children[i].style.transform = `scaleY(${Math.min(1, scale).toFixed(3)})`;
    }
  }

  /** Back to the ambient wave, for the next time the microphone opens. */
  function resetLevel() {
    smoothed = 0;
    const bars = $(`${PANEL_ID}-bars`);
    if (!bars) return;
    bars.setAttribute('data-ambient', 'true');
    for (const bar of bars.children) bar.style.transform = '';
  }

  function setTime(seconds) {
    const whole = Math.floor(seconds);
    setText('time', `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`);
  }

  /* ------------------------------------------------------------- gesture */

  function onPress(event) {
    if (session && locked) {
      event.preventDefault();
      finish();
      return;
    }
    if (session) return;
    event.preventDefault();
    if (event.target && event.target.setPointerCapture) {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch (e) {
        /* older WebView */
      }
    }
    held = { x: event.clientX, y: event.clientY, at: Date.now(), locked: false };
    begin();
  }

  function onMove(event) {
    if (!held || held.locked || locked || !session) return;
    const dx = held.x - event.clientX;
    const dy = held.y - event.clientY;
    if (dx > CANCEL_PX) {
      abandon();
      return;
    }
    if (dy > LOCK_PX) {
      held.locked = true;
      setText('status', 'Listening, hands free. Tap the mic to stop');
      buzz(20);
      return;
    }
    setText('status', dx > CANCEL_PX / 3 ? 'Keep sliding to cancel' : 'Listening. Slide left to cancel, up to lock');
  }

  function onRelease() {
    if (!held) return;
    if (held.locked) {
      locked = true;
      return;
    }
    const quick = Date.now() - held.at < TAP_MS;
    held = null;
    if (quick) {
      /* A tap listens until the next tap, the way a voice note does. */
      locked = true;
      setText('status', 'Listening. Tap the mic again when done');
      return;
    }
    finish();
  }

  /* ----------------------------------------------------------- recording */

  function begin() {
    locked = false;
    if (canListen === false) {
      say('Voice ordering is not available on this phone.');
      held = null;
      return;
    }
    try {
      session = Speech.start({
        fromServer,
        onPartial: livePreview,
        onLevel: setLevel,
      });
    } catch (error) {
      session = null;
      held = null;
      say((error && error.message) || 'Could not listen just now.');
      return;
    }

    paint(true);
    buzz(15);
    view.said = '';
    view.status = '';
    view.stage = 'listening';
    view.proposed = null;
    /* A fresh round. Last round's marks belong to last round. */
    view.changed = {};
    view.unplaced = [];
    view.pendingPlace = false;
    showPanel();
    const opening = $(PANEL_ID);
    if (opening) opening.setAttribute('data-stage', 'listening');
    const status = $(`${PANEL_ID}-status`);
    if (status) status.setAttribute('data-live', 'true');
    setText('status', 'Listening');
    setText('said', '');
    setText('note', '');
    setTime(0);
    renderLines();
    renderActions();

    /*
     * THE ORDER AS IT STANDS, from the moment the microphone opens.
     *
     * Owner: "existing addeded to cart also should be there. so captain can
     * finalize and send it." A waiter adding a fourth round needs the three
     * already down in front of them while they say it - not after.
     *
     * Not awaited: the microphone is already open and the read is local.
     */
    cartNow().then((rows) => {
      view.cart = rows;
      if (view.stage === 'listening') renderLines();
    });

    ticker = setInterval(() => {
      if (!session) return;
      const seconds = session.seconds();
      setTime(seconds);
      if (seconds >= Speech.MAX_SECONDS) finish();
    }, 200);
  }

  /**
   * Words as they arrive, read as they arrive.
   *
   * Nothing is applied yet - the recogniser rewrites its own sentence several
   * times before it settles - but the panel already shows what it would do,
   * so a waiter can see "2 Coffee" forming and stop talking when it is right.
   */
  async function livePreview(text) {
    view.said = text || '';
    setText('said', view.said);
    if (!view.said) return;
    try {
      /*
       * READ AS THEY ARRIVE, into the right-hand column.
       *
       * The recogniser rewrites its own sentence several times before it
       * settles, so none of this is applied - but the column fills while
       * somebody is still talking, and they can stop the moment it is right.
       * Before this the panel showed an orb and one truncated line, which is
       * why an open microphone looked like a hung one.
       */
      view.proposed = VoiceOrder.commands(view.said, await menuIndex(), ItemSearch);
      if (view.stage === 'listening') renderLines();
    } catch (e) {
      /* a preview is a nicety; a bad partial must not end the recording */
    }
  }

  function abandon() {
    if (session) {
      try {
        session.cancel();
      } catch (e) {
        /* already stopped */
      }
    }
    session = null;
    locked = false;
    held = null;
    clearInterval(ticker);
    paint(false);
    hidePanel();
    buzz([10, 40, 10]);
  }

  async function finish() {
    const current = session;
    if (!current) return;
    session = null;
    held = null;
    locked = false;
    clearInterval(ticker);
    paint(false);
    buzz(15);
    const status = $(`${PANEL_ID}-status`);
    if (status) status.setAttribute('data-live', 'false');

    let heard = '';
    try {
      heard = await current.stop();
    } catch (error) {
      hidePanel();
      say((error && error.message) || 'Could not listen just now.');
      return;
    }
    if (!heard) {
      hidePanel();
      say('Nothing was heard. Try again, closer to the phone.');
      return;
    }
    /* Between the microphone closing and the review appearing there is a
       moment of matching against the menu. Saying so beats a blank panel. */
    setText('status', 'Reading it back');
    setText('said', heard);
    await absorb(heard);
  }

  /* ----------------------------------------------------------- the reading */

  /** A short line saying what a list of commands will do. */
  function describe(commands) {
    /*
     * WHAT HAPPENED, IN THE PAST TENSE.
     *
     * This read "add 2 Chicken Biryani" - an instruction, as though it were
     * still waiting to be carried out. It was already done by the time these
     * words were drawn, and a screen describing a completed thing as a pending
     * one is why somebody sits looking for the button that does it.
     */
    const parts = [];
    for (const command of commands) {
      if (command.verb === 'place') parts.push('ready to send');
      else if (command.verb === 'clear') parts.push('cleared the order');
      else if (command.verb === 'show') parts.push('here it is');
      else {
        const names = command.lines
          .map((l) => `${l.quantity} ${l.item ? l.item.name : l.term + '?'}`)
          .join(', ');
        parts.push(
          `${command.verb === 'remove' ? 'Took off' : command.verb === 'set' ? 'Made it' : 'Added'} ${names}`
        );
      }
    }
    return parts.join(' · ');
  }

  /**
   * The till reads the words with its model, if it has one, else the handset.
   *
   * Asked once whether the till can, and not again: the answer does not
   * change between one order and the next, and a round trip on every press
   * is a waiter waiting.
   */
  async function serverCanRead() {
    if (serverReads !== null) return serverReads;
    if (typeof POSNIC === 'undefined' || !POSNIC.api || typeof POSNIC.api.get !== 'function') {
      serverReads = false;
      return false;
    }
    try {
      const answer = await POSNIC.api.get('/items/aiAvailability');
      serverReads = !!(answer && answer.data && answer.data.available === true);
    } catch (e) {
      serverReads = false;
    }
    return serverReads;
  }

  async function readOnServer(text, indexed) {
    const items = indexed.map((entry) => ({ id: entry.item.id, name: entry.item.name })).slice(0, 400);
    const byId = new Map(indexed.map((entry) => [String(entry.item.id), entry.item]));
    const call = POSNIC.api.post('/sales/voiceIntent', { text, items });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SERVER_MS));
    const answer = await Promise.race([call.catch(() => null), timeout]);
    const commands = answer && answer.data && Array.isArray(answer.data.commands) ? answer.data.commands : null;
    if (!commands) return null;
    const extra = answer.data;
    view.summary = String(extra.summary || '').slice(0, 160);
    view.table = extra.table ? String(extra.table) : null;
    view.suggestions = (Array.isArray(extra.suggestions) ? extra.suggestions : [])
      .map((sug) => ({ item: byId.get(String(sug.item_id)) || null, why: String(sug.why || '') }))
      .filter((sug) => sug.item);

    /* Into the shape the local parser produces, so one path carries it out. */
    const out = [];
    for (const c of commands) {
      if (c.verb === 'place' || c.verb === 'clear' || c.verb === 'show') {
        out.push({ verb: c.verb, lines: [] });
        continue;
      }
      const item = c.item_id != null ? byId.get(String(c.item_id)) || null : null;
      out.push({
        verb: c.verb,
        lines: [{
          quantity: c.quantity || 1,
          term: c.said || '',
          item,
          found: !!item,
          exact: !!item,
          /* "no onion" stays with the dish it was said for */
          note: String(c.note || '').trim(),
          /* for a dish that did not match: the dishes it might have been */
          candidates: (Array.isArray(c.candidates) ? c.candidates : [])
            .map((cid) => byId.get(String(cid)) || null)
            .filter(Boolean),
        }],
      });
    }
    return out;
  }

  async function resolve(text) {
    const indexed = await menuIndex();
    if (await serverCanRead()) {
      const fromModel = await readOnServer(text, indexed);
      if (fromModel) return { commands: fromModel, by: 'server' };
    }
    return { commands: VoiceOrder.commands(text, indexed, ItemSearch), by: 'device' };
  }

  /**
   * Carry the commands out on the cart, and show what that did.
   *
   * add and remove go straight to the cart through the same function the
   * menu's own buttons use, so stock limits and negative-stock rules are the
   * same whichever way an item arrives. "set" is a difference against what is
   * there now. "place" is NOT carried out - it puts the button on the panel.
   */
  async function absorb(heard) {
    view.said = heard;
    view.changed = {};
    view.unplaced = [];
    view.pendingPlace = false;
    view.suggestions = [];
    view.summary = '';
    view.table = null;

    const { commands } = await resolve(heard);

    /*
     * UNDERSTOOD, NOT DONE.
     *
     * Owner: "what you understood just show properly. or confirm button to add
     * to cart. i need world class ux and proper mechanism."
     *
     * This called apply() here, so the bill changed before the panel had drawn
     * a single word of what it thought it had heard. A waiter then read the
     * screen to find out what had ALREADY happened to their order, which is
     * the wrong way round: a person should read it to decide whether it should
     * happen at all.
     *
     * So the commands are held. Nothing reaches the cart until somebody
     * presses the button that says how many items it will add.
     */
    view.proposed = commands;
    view.stage = 'review';
    view.cart = await cartNow();
    view.status = describe(commands) || 'Nothing to change';
    /* One render's worth of arrival. Left on, every tap of a stepper would
       replay the whole list, which turns an event into a tic. */
    view.fresh = true;
    render();
    view.fresh = false;

    /*
     * And on the menu behind the panel, the rows that changed.
     *
     * The panel is a summary; the menu is where the waiter's picture of the
     * order lives. Lighting the rows there in the order they were said means
     * closing the panel leaves somebody looking at a menu that agrees with
     * what they just heard back, rather than one that looks untouched.
     */
    /* The menu behind is lit when the order is actually taken, not when it is
       proposed - see confirm(). */
  }

  /**
   * Take the order that was read back, now that somebody has agreed to it.
   *
   * Everything up to here was a proposal on a screen. This is the moment the
   * bill changes, and it happens because a person pressed a button that said
   * how many items it would add - not because a recogniser returned a string.
   */
  async function confirm() {
    if (!view.proposed) return;

    const touched = await apply(view.proposed);
    view.proposed = null;
    view.stage = 'done';
    view.cart = await cartNow();
    view.fresh = true;
    render();
    view.fresh = false;

    /*
     * And on the menu behind the panel, the rows that changed.
     *
     * The panel is a summary; the menu is where the waiter's picture of the
     * order lives. Lighting the rows there in the order they were said means
     * closing the panel leaves somebody looking at a menu that agrees with
     * what they just agreed to.
     */
    if (touched.length && typeof MenuScreen !== 'undefined' && MenuScreen.heard) {
      MenuScreen.heard(touched);
    }
    buzz(15);
  }

  async function apply(commands) {
    /* Which rows moved, in the order they were spoken. */
    const touched = [];
    const change = async (id, delta) => {
      if (!delta) return;
      if (typeof updateQuantity !== 'function') return;
      try {
        await updateQuantity(id, delta);
        view.changed[id] = (view.changed[id] || 0) + delta;
      } catch (e) {
        /* one line failing must not lose the rest of the order */
      }
    };

    for (const command of commands) {
      if (command.verb === 'clear') {
        if (typeof saveCartData === 'function') {
          try {
            await saveCartData([]);
          } catch (e) {
            /* nothing to clear */
          }
        }
        continue;
      }
      if (command.verb === 'place') {
        view.pendingPlace = true;
        continue;
      }
      if (command.verb === 'show') continue;

      for (const line of command.lines) {
        if (!line.found) {
          view.unplaced.push({ term: line.term, quantity: line.quantity, verb: command.verb, candidates: line.candidates || [] });
          continue;
        }
        const id = line.item.id;
        if (!touched.includes(id)) touched.push(id);
        /* Heard cleanly the second time settles a line that was doubtful the
           first, which is what saying it again is for. */
        if (line.exact) delete view.rough[id];
        else view.rough[id] = line.term;
        if (command.verb === 'add') await change(id, line.quantity);
        else if (command.verb === 'remove') await change(id, -line.quantity);
        else if (command.verb === 'set') {
          const now = (await cartNow()).find((row) => row.id === id);
          await change(id, line.quantity - (now ? now.quantity : 0));
        }

        /*
         * HOW IT WAS WANTED, onto the line.
         *
         * "chicken biryani without onion" is one dish with a note, and the
         * note is the half the kitchen cannot guess. It goes in the same field
         * the notes modal on the menu writes, so a spoken requirement and a
         * typed one are the same thing by the time anybody downstream reads
         * it - the cart row shows it, and it prints on the ticket.
         *
         * Only ever added, never cleared: saying a dish again without
         * repeating the requirement does not withdraw it. Somebody who wants
         * the onion back takes it off the line by hand, which is a decision
         * worth making on purpose.
         */
        if (line.note && command.verb !== 'remove' && typeof setCartItemNotes === 'function') {
          try {
            const now = (await cartNow()).find((row) => row.id === id);
            const had = (now && now.notes) || '';
            const already = had.toLowerCase().includes(line.note.toLowerCase());
            await setCartItemNotes(id, had && !already ? had + ', ' + line.note : (already ? had : line.note));
          } catch (e) {
            /* the dish is on the bill either way; a lost note is not a lost
               order, and the waiter can still see what was heard */
          }
        }
      }
    }
    return touched;
  }

  /* ------------------------------------------------------------- review */

  /** What the proposal would do, counted in the units a button speaks in. */
  function proposedCount() {
    let add = 0;
    let off = 0;
    let verbs = 0;
    for (const command of view.proposed || []) {
      if (!command.lines || !command.lines.length) {
        if (command.verb === 'place' || command.verb === 'clear') verbs += 1;
        continue;
      }
      for (const line of command.lines) {
        if (!line.found) continue;
        if (command.verb === 'remove') off += line.quantity;
        else add += line.quantity;
      }
    }
    return { add, off, verbs };
  }

  /**
   * The words on the button that commits the proposal.
   *
   * It says what it will do in the units of the thing it does. "Confirm" and
   * "OK" say nothing; "Add 3 items" is the sentence somebody is deciding
   * about, so it belongs on the control that decides it.
   */
  function commitLabel() {
    const { add, off, verbs } = proposedCount();
    const items = (count) => `${count} ${count === 1 ? 'item' : 'items'}`;
    if (add && off) return 'Update the order';
    if (add) return `Add ${items(add)}`;
    if (off) return `Take off ${items(off)}`;
    if (verbs) return 'Do it';
    return '';
  }

  /** A line of the proposal, reached by where it sits after a redraw. */
  function proposedLine(ci, li) {
    const command = (view.proposed || [])[Number(ci)];
    if (!command || !command.lines) return null;
    return command.lines[Number(li)] || null;
  }

  /**
   * Change what was understood, BEFORE it is carried out.
   *
   * The one thing the old panel could not do. A quantity misheard by one had
   * to be fixed on the bill afterwards, which meant the wrong number went onto
   * the bill first - and on a busy night it stayed there.
   */
  function editProposed(ci, li, delta) {
    const line = proposedLine(ci, li);
    if (!line) return;
    line.quantity = Math.max(0, (Number(line.quantity) || 0) + delta);
    /* Stepped down to nothing is a line somebody has decided against. */
    if (!line.quantity) return dropProposed(ci, li);
    render();
  }

  function dropProposed(ci, li) {
    const command = (view.proposed || [])[Number(ci)];
    if (!command || !command.lines) return;
    command.lines.splice(Number(li), 1);
    /* The command itself is left in place even when empty: apply() walks an
       empty line list to nothing, and removing it would shift the index every
       other row on screen was drawn with. */
    render();
  }

  /**
   * What was understood, laid out to be CHECKED AND CHANGED rather than read
   * after the fact.
   *
   * One row per line, sized for a thumb: the quantity as a stepper, the dish,
   * what was asked for with it, and - where the match was a guess - the words
   * actually said, so the one line that might be wrong is the one that looks
   * different.
   *
   * While the microphone is still open the rows are read-only. They are
   * rebuilt from the transcript several times a second at that point, and a
   * stepper whose value is overwritten a moment after it is pressed is worse
   * than no stepper at all.
   */
  function proposalHtml() {
    const rows = [];
    const live = view.stage === 'listening';

    (view.proposed || []).forEach((command, ci) => {
      if (command.verb === 'place' || command.verb === 'show' || command.verb === 'clear') {
        rows.push(`
          <div class="vp-prop" data-kind="verb">
            <span class="vp-prop-what">${
              command.verb === 'place'
                ? '&#128228; Send it to the kitchen'
                : command.verb === 'clear'
                  ? '&#128465; Clear the order first'
                  : '&#128065; Read the order back'
            }</span>
          </div>`);
        return;
      }

      (command.lines || []).forEach((line, li) => {
        if (!line.found) {
          rows.push(`
            <div class="vp-prop" data-kind="missing">
              <span class="vp-prop-qty">?</span>
              <span class="vp-prop-what">
                <strong>${escapeHtml(line.term)}</strong>
                <span class="vp-prop-why">not on this menu</span>
              </span>
              ${
                live
                  ? ''
                  : `<button type="button" class="vp-btn vp-prop-act" data-act="search"
                       data-term="${escapeHtml(line.term)}">Find</button>`
              }
            </div>`);
          return;
        }

        const verb =
          command.verb === 'remove' ? 'Take off' : command.verb === 'set' ? 'Make it' : '';

        rows.push(`
          <div class="vp-prop" data-kind="${escapeHtml(command.verb)}">
            ${
              live
                ? `<span class="vp-prop-qty">${line.quantity}</span>`
                : `<span class="vp-prop-stack">
                     <button type="button" class="vp-step" data-act="prop-more"
                       data-ci="${ci}" data-li="${li}" aria-label="One more">+</button>
                     <span class="vp-prop-qty">${line.quantity}</span>
                     <button type="button" class="vp-step" data-act="prop-less"
                       data-ci="${ci}" data-li="${li}" aria-label="One fewer">&minus;</button>
                   </span>`
            }
            <span class="vp-prop-what">
              ${verb ? `<span class="vp-prop-verb">${verb}</span> ` : ''}
              <strong>${escapeHtml(line.item.name)}</strong>
              ${line.note ? `<span class="vp-prop-note">${escapeHtml(line.note)}</span>` : ''}
              ${
                line.exact
                  ? ''
                  : `<span class="vp-prop-why">heard "${escapeHtml(line.term)}" &ndash; check this one</span>`
              }
            </span>
            ${
              live
                ? ''
                : `<button type="button" class="vp-x" data-act="prop-drop"
                     data-ci="${ci}" data-li="${li}" aria-label="Drop this line">&times;</button>`
            }
          </div>`);
      });
    });

    if (!rows.length) {
      return `<div class="vp-empty">${
        live ? 'Nothing matched yet.' : 'Nothing on this menu matched what was said.'
      }</div>`;
    }
    return `<div class="vp-group">${live ? 'Hearing' : 'To add'}</div>${rows.join('')}`;
  }

  /**
   * What is already on the order.
   *
   * Owner: "existing addeded to cart also should be there. so captain can
   * finalize and send it." The panel used to replace the order with the last
   * thing said, so a waiter taking a table in three breaths could never see
   * the whole thing without closing the panel and going to the bill.
   */
  function cartHtml(heading) {
    const rows = [];
    for (const row of view.cart) {
      const delta = view.changed[row.id] || 0;
      rows.push(`
        <div class="vp-row" data-changed="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">
          <button type="button" class="vp-step" data-act="less" data-id="${escapeHtml(row.id)}" aria-label="One fewer">&minus;</button>
          <span class="vp-qty">${row.quantity}</span>
          <button type="button" class="vp-step" data-act="more" data-id="${escapeHtml(row.id)}" aria-label="One more">+</button>
          <span class="vp-name">${escapeHtml(row.name)}${
            delta ? ` <span class="vp-delta">${delta > 0 ? '+' : ''}${delta}</span>` : ''
          }${
            row.notes ? `<div class="vp-want">${escapeHtml(row.notes)}</div>` : ''
          }${
            view.rough[row.id]
              ? `<div class="vp-rough">heard "${escapeHtml(view.rough[row.id])}" - check this one</div>`
              : ''
          }</span>
          <button type="button" class="vp-x" data-act="strike" data-id="${escapeHtml(row.id)}" aria-label="Remove">&times;</button>
        </div>`);
    }
    for (const miss of view.unplaced) {
      rows.push(`
        <div class="vp-row" data-unplaced="true">
          <span class="vp-name"><strong>${escapeHtml(miss.term)}</strong>
            <div style="font-size:var(--t-xs,12px)">not on this menu</div></span>
          ${(miss.candidates || []).length ? `<div class="vp-maybe" style="flex:1 1 100%;font-size:var(--t-xs,12px)">Did you mean: ${miss.candidates.map((c) => `<button type="button" class="vp-btn vp-chip" style="flex:0 0 auto;min-height:30px;padding:0 10px;margin:2px 4px 2px 0" data-act="pick" data-id="${escapeHtml(c.id)}" data-qty="${miss.quantity || 1}" data-term="${escapeHtml(miss.term)}">${escapeHtml(c.name)}</button>`).join('')}</div>` : ''}
          <button type="button" class="vp-btn" style="flex:0 0 auto;min-height:34px;padding:0 10px" data-act="search" data-term="${escapeHtml(miss.term)}">Search</button>
          <button type="button" class="vp-x" data-act="unplaced-drop" data-term="${escapeHtml(miss.term)}" aria-label="Dismiss">&times;</button>
        </div>`);
    }

    /* What goes with what was ordered, one tap each. From the shop's own
       menu, never a dish already in the cart - the server checks. Below the
       order rather than among them: it is an offer, not a line. */
    if (view.suggestions.length) {
      rows.push(`
        <div class="vp-row vp-suggest" data-suggest="true" style="flex-wrap:wrap">
          <span class="vp-name" style="flex:1 1 100%;font-size:var(--t-xs,12px)">Goes well:</span>
          ${view.suggestions.map((sug) => `<button type="button" class="vp-btn vp-chip" style="flex:0 0 auto;min-height:30px;padding:0 10px;margin:2px 4px 2px 0" data-act="suggest" data-id="${escapeHtml(sug.item.id)}" title="${escapeHtml(sug.why)}">+ ${escapeHtml(sug.item.name)}</button>`).join('')}
        </div>`);
    }

    const title = heading ? `<div class="vp-group">${heading}</div>` : '';
    return rows.length ? title + rows.join('') : `${title}<div class="vp-empty">Nothing on the order yet.</div>`;
  }

  /* --------------------------------------------------------------- render */

  /**
   * The right-hand column: what was just heard, then what was already down.
   *
   * Both at once, because the question "is this right" is asked of the whole
   * order and not of the last sentence.
   */
  function renderLines() {
    const host = $(`${PANEL_ID}-lines`);
    if (!host) return;

    if (view.stage === 'done') {
      host.innerHTML = cartHtml('');
      return;
    }
    const parts = [proposalHtml()];
    /* Only when there IS something already down. An empty section under a
       heading that promises one is a screen apologising for itself. */
    if (view.cart.length || view.unplaced.length) parts.push(cartHtml('Already on the order'));
    host.innerHTML = parts.join('');
  }

  /**
   * The one or two or three things to press, by stage.
   *
   * Owner: "below confirm button. so that user can confirm and send to
   * kitchen." Sending is the end of the job, so it is the primary action once
   * the order is on the bill - not only when somebody happened to say the
   * words "send it to the kitchen".
   */
  function renderActions() {
    const actions = $(`${PANEL_ID}-actions`);
    if (!actions) return;

    /* While it is listening there is exactly one thing to do. */
    if (view.stage === 'listening') {
      actions.innerHTML =
        '<button type="button" class="vp-btn" data-primary="true" data-act="stop">Stop &amp; check the order</button>';
      return;
    }

    if (view.stage === 'review') {
      const label = commitLabel();
      actions.innerHTML = `
        <button type="button" class="vp-btn" data-act="again">&#127908; Say again</button>
        <button type="button" class="vp-btn" data-primary="true" data-act="confirm" ${
          label ? '' : 'disabled'
        }>${label || 'Nothing to add'}</button>`;
      return;
    }

    const count = view.cart.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
    const money = view.cart.reduce(
      (sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.final_price || row.price) || 0),
      0
    );

    /* Speaking again is the natural "more" after speaking, so it keeps its
       place on the left - as a microphone, because the two buttons beside it
       need their words more than it does. */
    actions.innerHTML = `
      <button type="button" class="vp-btn" data-icon="true" data-act="again"
        aria-label="Say more" title="Say more">&#127908;</button>
      <button type="button" class="vp-btn" data-act="bill" ${count ? '' : 'disabled'}>${
        count ? '&#8377;' + money.toFixed(0) : 'Bill'
      }</button>
      <button type="button" class="vp-btn" data-primary="true" data-act="place" ${
        count ? '' : 'disabled'
      }>Send ${count ? count + ' ' : ''}to kitchen</button>`;
  }

  function render() {
    showPanel();
    const panel = $(PANEL_ID);
    if (panel) {
      panel.setAttribute('data-fresh', view.fresh ? 'true' : 'false');
      panel.setAttribute('data-stage', view.stage || 'done');
    }

    /*
     * ONE STATE AT A TIME, NAMED.
     *
     * listening - the microphone is open
     * review    - this is what I understood; shall I?
     * done      - it is on the order
     *
     * The panel used to say "Heard" through all three, which is why nobody
     * could tell which one they were in.
     */
    setText(
      'status',
      view.stage === 'listening'
        ? 'Listening'
        : view.stage === 'review'
          ? 'Is this right?'
          : view.pendingPlace
            ? 'Ready to send'
            : 'On the order'
    );
    setText('said', view.said);
    /* The server's read-back when it gave one, the panel's own account
       otherwise - and nothing at all while the order is still being checked,
       because the review says what it is for itself. */
    setText('note', view.stage === 'review' ? '' : view.summary || view.status);
    renderLines();
    renderActions();
  }

  /* ------------------------------------------------------------ editing */

  /* "Did you mean" - the dish that did not match, resolved by a tap. */
  async function pickCandidate(id, quantity, term) {
    view.unplaced = view.unplaced.filter((miss) => miss.term !== term);
    await bump(id, quantity || 1);
  }

  /* "Goes well" - taken, so it leaves the suggestions and joins the cart. */
  async function takeSuggestion(id) {
    view.suggestions = view.suggestions.filter((sug) => sug.item.id !== id);
    await bump(id, 1);
  }

  async function bump(id, delta) {
    if (typeof updateQuantity !== 'function') return;
    try {
      await updateQuantity(id, delta);
      view.changed[id] = (view.changed[id] || 0) + delta;
    } catch (e) {
      /* stock limit, most likely; the row simply does not move */
    }
    view.cart = await cartNow();
    render();
  }

  async function strike(id) {
    const row = view.cart.find((r) => r.id === id);
    if (row && typeof updateQuantity === 'function') {
      try {
        await updateQuantity(id, -row.quantity);
        view.changed[id] = (view.changed[id] || 0) - row.quantity;
      } catch (e) {
        /* nothing to do */
      }
    }
    view.cart = await cartNow();
    render();
  }

  function dropUnplaced(term) {
    view.unplaced = view.unplaced.filter((m) => m.term !== term);
    render();
  }

  /** Hand a dish that could not be placed to the search box, by name. */
  function searchFor(term) {
    hidePanel();
    const input = document.querySelector('.product-search-inner input');
    if (!input) return;
    if (term) {
      input.value = term;
      try {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) {
        /* older WebView */
      }
    }
    if (typeof input.focus === 'function') input.focus();
  }

  /**
   * The one action a word never takes by itself.
   *
   * Pressed by a person who has just read the cart. Goes through the cart
   * page's own placing function where it exists, so voice and thumb place an
   * order the same way; where it does not, to the cart page, which has it.
   */
  function confirmPlace() {
    if (!view.cart.length) return;
    view.pendingPlace = false;
    hidePanel();
    if (typeof kioskPlaceOrder === 'function') {
      kioskPlaceOrder();
      return;
    }
    if (typeof window !== 'undefined' && window.location) window.location.href = 'cart.html';
  }

  /* ----------------------------------------------------------------- start */

  document.addEventListener('DOMContentLoaded', async () => {
    canListen = await Speech.available(fromServer);
    if (!canListen) return;
    micButton();
    document.addEventListener('pointerup', onRelease);
    document.addEventListener('pointercancel', onRelease);
    document.addEventListener('pointermove', onMove);
    /* Learned in the background so the first press does not pay for it. */
    serverCanRead();
  });

  window.POSNIC_VOICE_UI = {
    begin,
    finish,
    /* The step between hearing and doing. Nothing reaches the cart without
       it, which is why the tests have to call it too. */
    confirm,
    abandon,
    absorb,
    render,
    menuIndex,
    onPress,
    onMove,
    onRelease,
    bump,
    strike,
    /* Changing what was heard BEFORE it is carried out. Public because the
       panel's buttons are drawn into HTML and cannot be pressed in a test. */
    editProposed,
    dropProposed,
    commitLabel,
    confirmPlace,
    hidePanel,
    describe,
    pickCandidate,
    takeSuggestion,
    /* What the panel currently holds, for tests: the fake DOM they run in
       never registers markup the panel builds, so state is the truth. */
    snapshot: () => ({
      unplaced: view.unplaced.map((m) => ({ term: m.term, quantity: m.quantity, candidates: (m.candidates || []).map((c) => c.id) })),
      suggestions: view.suggestions.map((sug) => ({ id: sug.item.id, name: sug.item.name, why: sug.why })),
      summary: view.summary,
      status: view.status,
      table: view.table,
    }),
    get view() {
      return view;
    },
    get pendingPlace() {
      return view.pendingPlace;
    },
    get unplaced() {
      return view.unplaced;
    },
    get recording() {
      return !!session;
    },
    useServerSettings(value) {
      fromServer = value || null;
    },
    async refreshAvailability() {
      canListen = await Speech.available(fromServer);
      return canListen;
    },
    get canListen() {
      return canListen;
    },
    set canListen(value) {
      canListen = value;
    },
    set serverReads(value) {
      serverReads = value;
    },
  };
})();
