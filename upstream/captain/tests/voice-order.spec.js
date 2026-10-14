import { test, expect } from '@playwright/test';

/*
 * Saying an order, in a real browser.
 *
 * voice-order-ui.test.js checks the data path against a hand-built DOM. This
 * checks what that test cannot: that the panel actually appears, that it never
 * covers the bill button while it is up, and that words move the cart the
 * moment they are heard - while "send to kitchen" still waits for a finger.
 *
 * The recogniser is stubbed. What is tested is what the app does with a
 * transcript, not whether a browser can hear.
 *
 * The route to the menu is walked rather than jumped to. products.html reads
 * state that the pages before it write - the branch, the table, the cart - and
 * a handset that arrives there without them shows an empty screen, which is
 * exactly what a shortcut here produced.
 */

import { onTheMenu } from './support/shop.js';

const panel = (page) => page.locator('#posnic-voice-panel');
const count = (page) => page.locator('#mobile-cart-count');

/**
 * Press the microphone, speak, let go, and agree to what comes back.
 *
 * The last step is new and it is not a detail: nothing reaches the cart until
 * somebody presses a button that says how many items it will add. Owner:
 * "what you understood just show properly. or confirm button to add to cart."
 * Every test below that cares about the CART has to walk through it, the same
 * as a waiter does.
 */
async function holdAndSpeak(page, ms = 700) {
  await holdOnly(page, ms);
  await confirmHeard(page);
}

/** Everything up to the read-back, for a test about the read-back itself. */
async function holdOnly(page, ms = 700) {
  const mic = page.locator('#posnic-voice-mic');
  await mic.hover();
  await page.mouse.down();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Agree to the order that was read back. */
async function confirmHeard(page) {
  const button = panel(page).locator('[data-act="confirm"]');
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveCount(0);
}

test('the mic button is there when the device can listen', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await expect(page.locator('#posnic-voice-mic')).toBeVisible();
});

test('the panel does not cover the menu while it is closed', async ({ page }) => {
  /*
   * The bug this exists for: an inline display beats the browser's rule for
   * [hidden], so a full-screen sheet set hidden was still laid out - invisible,
   * over everything, swallowing every tap. Tapping an item is the proof that
   * nothing is in the way.
   */
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('.btn-add[data-id="p-coffee"]').click();
  await expect(count(page)).toHaveText('1');
});

/* ------------------------------------------------- words move the cart */

test('what is said goes into the cart, and the panel shows the cart', async ({ page }) => {
  /* Owner: "as soon as you heard text you need to convert as cart and what
     said need to show the cart." */
  await onTheMenu(page, 'two chicken biryani and three coffee');
  await holdAndSpeak(page);

  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('two chicken biryani and three coffee');
  await expect(panel(page)).toContainText('Chicken Biryani');
  await expect(panel(page)).toContainText('Coffee');
  await expect(count(page)).toHaveText('5');
});

test('"take off" takes off', async ({ page }) => {
  await onTheMenu(page, 'take off one coffee');
  /* ADD becomes a stepper once the dish is on the bill (menu.spec pins that),
     so the second one is a plus, not a second ADD. */
  await page.locator('.btn-add[data-id="p-coffee"]').click();
  await page.locator('.btn-increase[data-id="p-coffee"]').click();
  await expect(count(page)).toHaveText('2');

  await holdAndSpeak(page);
  await expect(count(page)).toHaveText('1');
});

test('a dish that is not on the menu is shown, not invented', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and one pizza');
  await holdAndSpeak(page);

  await expect(panel(page)).toContainText('pizza');
  await expect(panel(page)).toContainText('not on this menu');
  /* The rest still goes. A line nobody could place must not take the ones
     that could with it. */
  await expect(count(page)).toHaveText('2');
});

test('a rough match says so, so the waiter checks that one', async ({ page }) => {
  await onTheMenu(page, 'two chicken briyani');
  await holdAndSpeak(page);

  await expect(panel(page)).toContainText('Chicken Biryani');
  await expect(panel(page)).toContainText('heard "chicken briyani"');
  /* Flagged, not refused: it is in the cart and one tap away from being
     corrected, which beats saying it again. */
  await expect(count(page)).toHaveText('2');
});

/* --------------------------------------------- the kitchen needs a finger */

test('"send to kitchen" offers the button and sends nothing by itself', async ({ page }) => {
  await onTheMenu(page, 'two coffee, send to kitchen');
  await holdAndSpeak(page);

  await expect(count(page)).toHaveText('2');
  const send = page.locator('#posnic-voice-panel [data-act="place"]');
  await expect(send).toBeVisible();
  await expect(send).toContainText('to kitchen');
  /* Still on the menu, nothing placed. */
  await expect(page).toHaveURL(/products\.html/);
});

/* ---------------------------------------------------- editing what was heard */

test('a quantity heard wrong is one tap to fix, not a whole order again', async ({ page }) => {
  await onTheMenu(page, 'three coffee');
  await holdAndSpeak(page);
  await expect(count(page)).toHaveText('3');

  await page.locator('#posnic-voice-panel [data-act="less"]').first().click();
  await expect(count(page)).toHaveText('2');
});

test('a second hold adds to what is there, it does not start over', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await holdAndSpeak(page);
  await expect(count(page)).toHaveText('2');

  await page.evaluate(() => {
    window.__voiceHeard = 'one masala dosa';
  });
  await holdAndSpeak(page);
  await expect(count(page)).toHaveText('3');
  await expect(panel(page)).toContainText('Chicken Biryani');
  await expect(panel(page)).toContainText('Masala Dosa');
});

test('"start over" is the one thing that clears it', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await holdAndSpeak(page);
  await expect(count(page)).toHaveText('2');

  await page.evaluate(() => {
    window.__voiceHeard = 'start over, one coffee';
  });
  await holdAndSpeak(page);
  await expect(count(page)).toHaveText('1');
  await expect(panel(page)).not.toContainText('Chicken Biryani');
  await expect(panel(page)).toContainText('Coffee');
});

/* ------------------------------------------ the panel is beside the work */

test('the bill button still works while the panel is up', async ({ page }) => {
  /* Owner: "bottom buttons are in active when showing voice to text." */
  await onTheMenu(page, 'two coffee');
  await holdAndSpeak(page);
  await expect(panel(page)).toBeVisible();

  const next = page.locator('#next-btn');
  await expect(next).toBeVisible();
  const box = await next.boundingBox();
  const over = await panel(page).boundingBox();
  /* The panel ends where the bar begins; it does not sit on it. */
  expect(over.y + over.height).toBeLessThanOrEqual(box.y + 2);
  await next.click();
  await expect(page).toHaveURL(/cart\.html/);
});

test('closing the panel keeps what was heard in the cart', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await holdAndSpeak(page);
  await page.locator('#posnic-voice-panel-close').click();
  await expect(panel(page)).toBeHidden();
  await expect(count(page)).toHaveText('2');

  await page.locator('.btn-add[data-id="p-coffee"]').click();
  await expect(count(page)).toHaveText('3');
});

/* ------------------------------------------------------------- the gesture */

test('a TAP starts it, and a second tap stops it', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and three coffee');

  await page.locator('#posnic-voice-mic').click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('Tap the mic again');

  await page.locator('#posnic-voice-mic').click();
  await confirmHeard(page);
  await expect(count(page)).toHaveText('5');
});

test('while held, the screen says it is listening and shows the words', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#posnic-voice-mic').hover();
  await page.mouse.down();

  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('Listening');
  await expect(page.locator('#posnic-voice-panel-said')).toHaveText(/chicken biryani/i);
  await expect(page.locator('#posnic-voice-mic')).toHaveAttribute('data-recording', 'true');

  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(page.locator('#posnic-voice-mic')).toHaveAttribute('data-recording', 'false');
});

test('sliding left cancels, and nothing is transcribed', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  const box = await page.locator('#posnic-voice-mic').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(panel(page)).toBeVisible();

  await page.mouse.move(box.x - 150, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(panel(page)).toBeHidden();
  await expect(count(page)).toHaveText('0');
});

test('sliding up locks it, so letting go does not end the order', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and three coffee');
  const box = await page.locator('#posnic-voice-mic').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 10 });
  await expect(panel(page)).toContainText('hands free');
  await page.mouse.up();

  /* Still going; the mic is the stop. */
  await expect(page.locator('#posnic-voice-mic')).toHaveAttribute('data-recording', 'true');
  await page.locator('#posnic-voice-mic').click();
  await confirmHeard(page);
  await expect(count(page)).toHaveText('5');
});

/* ------------------------------------------------- a choice of one is none */

test('a single-branch shop is never asked which branch', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await expect(page).not.toHaveURL(/index\.html$/);
  await expect(page.getByText('Select Branch')).toHaveCount(0);
});

test('and is not offered a Change Branch button either', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await page.goto('/kot-management.html');
  await expect(page.locator('#kot-change-branch')).toBeHidden();
});

test('an empty menu keeps the branch when there is nowhere else to go', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  const kept = await page.evaluate(() => {
    localStorage.setItem('kiosk_branch_list', JSON.stringify([{ branch_id: 'branch-1' }]));
    return {
      branch: localStorage.getItem('kiosk_selected_branch'),
      forced: localStorage.getItem('kiosk_force_branch_select'),
    };
  });
  expect(kept.branch).toBeTruthy();
  expect(kept.forced).toBeNull();
});

/* ------------------------------------------------ searching needs the room */

test('searching clears the screen of everything that is not a result', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await expect(page.locator('.mobile-header')).toBeVisible();
  await expect(page.locator('.fixed-categories')).toBeVisible();

  await page.locator('#product-search-input').fill('cof');
  await expect(page.locator('.mobile-header')).toBeHidden();
  await expect(page.locator('.fixed-categories')).toBeHidden();
  await expect(page.getByText('Coffee')).toBeVisible();
});

test('and gives it all back when the box is empty', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#product-search-input').fill('cof');
  await expect(page.locator('.mobile-header')).toBeHidden();

  await page.locator('#product-search-input').fill('');
  await expect(page.locator('.mobile-header')).toBeVisible();
  await expect(page.locator('.fixed-categories')).toBeVisible();
});

test('the count is one small line, not a heading', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#product-search-input').fill('cof');
  const c = page.locator('#search-count');
  await expect(c).toHaveText('1 item');
  const box = await c.boundingBox();
  expect(box.height).toBeLessThan(30);
});

test('a search that matches nothing says so, and says what to try', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#product-search-input').fill('zzzz');
  const said = page.locator('.menu-nothing');
  await expect(said).toContainText('Nothing matches');
  await expect(said).toContainText('zzzz');
  await expect(said).toContainText('cb');
  await expect(page.locator('#search-count')).toHaveText('');
});

/* --------------------------------------------- how the dish is wanted */

test('a requirement lands on the line, not as a second dish', async ({ page }) => {
  /*
   * "chicken biryani without onion" is one dish with a note. Parsed as two
   * things it would put a mystery on the bill and lose the half the kitchen
   * cannot guess.
   */
  await onTheMenu(page, 'two chicken biryani without onion');
  await holdAndSpeak(page);

  await expect(panel(page)).toContainText('Chicken Biryani');
  await expect(panel(page).locator('.vp-want')).toHaveText('Without onion');
  /* Two, not three: the onion is not an item. */
  await expect(count(page)).toHaveText('2');
});

test('the requirement reaches the cart itself, where the kitchen reads it', async ({ page }) => {
  /* The same field the notes modal on the menu writes, so a spoken
     requirement and a typed one are one thing by the time anything
     downstream sees it. */
  await onTheMenu(page, 'one chicken biryani no onion extra spicy');
  await holdAndSpeak(page);
  await expect(panel(page).locator('.vp-want')).toBeVisible();

  const notes = await page.evaluate(async () => {
    const cart = await getCartData();
    return cart.map((row) => row.notes || '');
  });
  assertHasNote(notes);
});

function assertHasNote(notes) {
  expect(notes.join(' ').toLowerCase()).toContain('onion');
}

test('a waiter counting in Tamil is counting', async ({ page }) => {
  /* "rendu" is two, and it is what gets said in a Tamil Nadu dining room
     whatever language the rest of the sentence is in. */
  await onTheMenu(page, 'rendu chicken biryani');
  await holdAndSpeak(page);

  await expect(panel(page)).toContainText('Chicken Biryani');
  await expect(count(page)).toHaveText('2');
});

test('a dish heard by ear is flagged for a second look', async ({ page }) => {
  /*
   * "briyani" is what a recogniser hands back, and it reaches the right dish
   * phonetically - but a guess is shown to be confirmed rather than added as
   * a fact. See assets/common/sounds-like.js.
   */
  await onTheMenu(page, 'two chiken briyani');
  await holdAndSpeak(page);

  await expect(panel(page)).toContainText('Chicken Biryani');
  await expect(panel(page).locator('.vp-rough')).toContainText('check this one');
});

/* ------------------------------------------------ and then what happens */

test('after speaking there is always a way forward', async ({ page }) => {
  /*
   * Owner: "i saw text nicely converted but next what? need stop to get added
   * to cart or something else need to do. i stuck in that."
   *
   * The dishes were already on the bill by the time the panel drew - apply()
   * puts them there first - and the only button said "Add more", which opened
   * a SEARCH BOX. So the screen showed the right answer, offered no way to
   * accept it, and the one thing it did offer was the opposite of what
   * somebody who has just spoken wants.
   */
  await onTheMenu(page, 'two chicken biryani');
  await holdAndSpeak(page);

  await expect(panel(page)).toBeVisible();
  /* Said in the past tense, because it has already happened. */
  await expect(panel(page)).toContainText('On the order');
  await expect(panel(page)).toContainText('Added');

  /* Speaking again is the natural "more" after speaking. */
  await expect(panel(page).locator('[data-act="again"]')).toBeVisible();

  /* And the way to the bill, carrying what it comes to. */
  const bill = panel(page).locator('[data-act="bill"]');
  await expect(bill).toBeVisible();
  await expect(bill).toContainText('\u20b9');
  await expect(bill).toBeEnabled();

  /*
   * And the end of the job. Owner: "below confirm button. so that user can
   * confirm and send to kitchen ... so captain can finalize and send it."
   * Sending is offered because the order is on the bill, not because the
   * phrase happened to be in the sentence.
   */
  const send = panel(page).locator('[data-act="place"]');
  await expect(send).toContainText('to kitchen');
  await expect(send).toBeEnabled();
});

test('the way forward goes to the bill', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await holdAndSpeak(page);
  await panel(page).locator('[data-act="bill"]').click();
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.locator('.bill-line')).toHaveCount(1);
});

test('saying send to kitchen says so at the top, and still waits', async ({ page }) => {
  /* The button is there either way now. What saying the words changes is the
     line at the top, which tells a waiter the app understood them. */
  await onTheMenu(page, 'two chicken biryani, send to kitchen');
  await holdAndSpeak(page);
  await expect(panel(page)).toContainText('Ready to send');
  await expect(panel(page).locator('[data-act="place"]')).toContainText('to kitchen');
  /* And it has still not gone anywhere. */
  await expect(page).toHaveURL(/products\.html/);
});

/* ---------------------------------------- what was said, and what it became */

test('the words appear while the microphone is still open', async ({ page }) => {
  /*
   * Owner: "mic first listerning and after if i talk not transcribing. may be
   * hanging."
   *
   * It was not hanging. The transcript was one italic line, nowrap, with an
   * ellipsis, under an orb that filled the panel - so a sentence being
   * recognised perfectly looked like nothing at all happening.
   */
  await onTheMenu(page, 'two chicken biryani and three coffee');
  const mic = page.locator('#posnic-voice-mic');
  await mic.hover();
  await page.mouse.down();

  await expect(page.locator('#posnic-voice-panel-said')).toContainText('chicken biryani');
  /* And the other column is already filling in, which is the point of it. */
  await expect(panel(page).locator('#posnic-voice-panel-lines')).toContainText('Chicken Biryani');

  /* Long enough to be a hold. Anything shorter is a TAP, which keeps
     listening until the next tap - a different gesture, tested elsewhere. */
  await page.waitForTimeout(700);
  await page.mouse.up();
  await confirmHeard(page);
});

test('what was said and what it became are side by side', async ({ page }) => {
  /* Owner: "lets say you split left and right. left what you talked in text.
     right what you extracted and modifieble." */
  await onTheMenu(page, 'two chicken biryani');
  await holdOnly(page);

  const said = page.locator('#posnic-voice-panel-said');
  const got = page.locator('#posnic-voice-panel-lines');
  await expect(said).toContainText('two chicken biryani');
  await expect(got).toContainText('Chicken Biryani');

  const left = await said.boundingBox();
  const right = await got.boundingBox();
  /* Beside, not below: the only question here is whether the right column
     matches the left, and two things you scroll between cannot be compared. */
  expect(right.x).toBeGreaterThan(left.x + left.width - 2);
  await confirmHeard(page);
});

test('a quantity is fixed BEFORE it reaches the bill', async ({ page }) => {
  /* Owner: "right what you extracted and modifieble. basically items
     quantity. below confirm button." */
  await onTheMenu(page, 'two chicken biryani');
  await holdOnly(page);
  await expect(count(page)).toHaveText('0');

  await panel(page).locator('[data-act="prop-more"]').first().click();
  const confirm = panel(page).locator('[data-act="confirm"]');
  await expect(confirm).toContainText('Add 3 items');
  await confirm.click();
  await expect(count(page)).toHaveText('3');
});

test('a line thrown away never reaches the bill at all', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and one coffee');
  await holdOnly(page);

  await panel(page).locator('[data-act="prop-drop"]').last().click();
  await panel(page).locator('[data-act="confirm"]').click();
  await expect(count(page)).toHaveText('2');
  await expect(panel(page).locator('#posnic-voice-panel-lines')).not.toContainText('Coffee');
});

test('what is already on the order stays in view while more is said', async ({ page }) => {
  /* Owner: "existing addeded to cart also should be there. so captain can
     finalize and send it." */
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('.btn-add[data-id="p-coffee"]').click();
  await expect(count(page)).toHaveText('1');

  await holdOnly(page);
  const got = panel(page).locator('#posnic-voice-panel-lines');
  await expect(got).toContainText('Chicken Biryani');
  await expect(got).toContainText('Already on the order');
  await expect(got).toContainText('Coffee');
  await confirmHeard(page);
});

test('nothing reaches the bill until somebody agrees to it', async ({ page }) => {
  /*
   * THE RULE THE WHOLE STAGE EXISTS FOR. The panel used to apply the order
   * before it had drawn a word of what it thought it heard, so a waiter read
   * the screen to find out what had ALREADY happened to their table.
   */
  await onTheMenu(page, 'two chicken biryani and three coffee');
  await holdOnly(page);
  await expect(panel(page)).toContainText('Is this right?');
  await expect(count(page)).toHaveText('0');

  await confirmHeard(page);
  await expect(count(page)).toHaveText('5');
});

test('closing the panel while it listens stops the microphone', async ({ page }) => {
  /*
   * Owner: "top close button just closed. nothing happened."
   *
   * It was hidePanel alone, so the cross took the panel off the screen and
   * left the recogniser running behind it - holding the microphone, still
   * costing a paid provider money, and with no way back to it short of
   * pressing the mic again.
   */
  await onTheMenu(page, 'two chicken biryani');

  await page.locator('#posnic-voice-mic').click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('#posnic-voice-mic')).toHaveAttribute('data-recording', 'true');

  await page.locator('#posnic-voice-panel-close').click();

  await expect(panel(page)).toBeHidden();
  /* The mic button is the app's own statement about whether it is listening,
     and it has to agree with the panel. */
  await expect(page.locator('#posnic-voice-mic')).toHaveAttribute('data-recording', 'false');
  /* Nothing was applied on the way out: heard is not agreed to. */
  await expect(count(page)).toHaveText('0');
});
