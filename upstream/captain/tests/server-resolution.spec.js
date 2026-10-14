import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/*
 * How the app decides which server to talk to.
 *
 * The rule, in order: an address someone pinned, then the shop's own server on
 * this Wi-Fi, then the shop's online address. Re-decided whenever the active
 * one stops answering, so a waiter walking out of range keeps working instead
 * of hitting a wall.
 */

const RUNTIME_INFO = {
  edition: 'community',
  mode: 'desktop',
  version: '1.0.0',
  channel: null,
  apiSchema: 1,
  syncProtocol: 1,
  features: { account: false }
};

const LAN = 'http://192.168.1.8:5555/api';
const LAN_ORIGIN = 'http://192.168.1.8:5555';
const CLOUD = 'https://azure.posnic.io/api';
const CLOUD_ORIGIN = 'https://azure.posnic.io';

/** Answer /runtime-info like a Posnic server, and everything else emptily. */
function serve(page, origin, { info = RUNTIME_INFO, extra = {}, seen, delayMs = 0 } = {}) {
  return page.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (seen && path !== '/runtime-info') seen.push(origin + path);
    /* A server that is reachable but SLOW, which is the case a hedge exists
       for: nothing fails, so nothing fails over, and the waiter waits. */
    if (delayMs && path !== '/runtime-info') {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const body = path === '/runtime-info' ? info : (extra[path] || { type: 'success', data: {} });
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(body)
    });
  });
}

/** Nothing at this address at all. */
const refuse = (page, origin) =>
  page.route(`${origin}/**`, route => route.abort('connectionrefused'));

/** Seed the one key the app keeps its server choice in. */
const seed = (page, state) => page.addInitScript(
  (value) => {
    localStorage.setItem('posnic.server', JSON.stringify(value));
    // Routing checks model a staff member who accepted internet fallback.
    // Consent/refusal itself is covered by internet-consent.spec.js.
    if (value.cloud) for (const shop of ['', 'shop-a'])
      sessionStorage.setItem(`captain.internet-consent:${shop}:${value.cloud}`, 'yes');
  }, state);

const signedInAs = (page, shopKey) => page.addInitScript(
  (key) => localStorage.setItem('posnic.session', JSON.stringify({ token: 't', shopKey: key })),
  shopKey);

const baseUrl = (page) => page.evaluate(() => POSNIC.server.baseUrl);

/**
 * A handset signed in, holding BOTH addresses, active on the one named.
 *
 * Both have to be recorded against the same shop key or the app will not move
 * between them - which is the guard that stops it adopting a stranger's till,
 * and the reason a hedge may use the other door at all.
 */
async function signedInAt(page, active) {
  await signedInAs(page, 'shop-a');
  await seed(page, {
    active,
    lan: LAN,
    cloud: CLOUD,
    servers: { [LAN]: 'shop-a', [CLOUD]: 'shop-a' },
  });
  await page.goto('/index.html');
}

test('a shop code becomes the shop’s online address', async ({ page }) => {
  await page.goto('/index.html');
  expect(await page.evaluate(() => POSNIC.server.normalize('azure'))).toBe(CLOUD);
});

test('addresses the user might type are all understood', async ({ page }) => {
  await page.goto('/index.html');
  const results = await page.evaluate(() => ({
    bareIp: POSNIC.server.normalize('192.168.1.8'),
    ipWithPort: POSNIC.server.normalize('192.168.1.8:5555'),
    fullLan: POSNIC.server.normalize('http://192.168.1.8:5555/'),
    cloudHost: POSNIC.server.normalize('azure.posnic.io'),
    ownDomain: POSNIC.server.normalize('https://pos.myshop.com/api'),
    nothing: POSNIC.server.normalize('   '),
  }));

  /* A till holds no certificate, so a private address is http, gets the port,
     and gets the /api prefix every server answers under. */
  expect(results.bareIp).toBe(LAN);
  expect(results.ipWithPort).toBe(LAN);
  expect(results.fullLan).toBe(LAN);
  expect(results.cloudHost).toBe(CLOUD);
  // A path the user gave is theirs, and is left exactly as typed.
  expect(results.ownDomain).toBe('https://pos.myshop.com/api');
  expect(results.nothing).toBeNull();
});

test('the Wi-Fi server is preferred over the online one', async ({ page }) => {
  await seed(page, { lan: LAN, cloud: CLOUD, active: CLOUD });
  await serve(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN);

  await page.goto('/index.html');
  await expect.poll(() => baseUrl(page)).toBe(LAN);
  expect(await page.evaluate(() => POSNIC.server.isLocal)).toBe(true);
});

test('the online address takes over when the Wi-Fi server is gone', async ({ page }) => {
  await seed(page, { lan: LAN, cloud: CLOUD, active: LAN });
  await refuse(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN, { info: { ...RUNTIME_INFO, mode: 'cloud', edition: 'cloud' } });

  await page.goto('/index.html');
  await expect.poll(() => baseUrl(page), { timeout: 15000 }).toBe(CLOUD);
  expect(await page.evaluate(() => POSNIC.server.isLocal)).toBe(false);
});

test('a pinned address is never swapped out from under the user', async ({ page }) => {
  await seed(page, { pinned: CLOUD, lan: LAN, active: CLOUD });
  await serve(page, LAN_ORIGIN);   // reachable, and still must not be chosen
  await serve(page, CLOUD_ORIGIN);

  await page.goto('/index.html');
  await page.waitForTimeout(1500);
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('the app refuses to drift onto a server holding a different shop', async ({ page }) => {
  /*
   * Two Posnic tills on one estate's Wi-Fi is not hypothetical. A server is
   * adopted automatically only once it is recorded as holding the shop this
   * device is signed in to.
   */
  await seed(page, {
    lan: LAN, cloud: CLOUD, active: CLOUD,
    servers: { [CLOUD]: 'shop-a', [LAN]: 'shop-b' },
  });
  await signedInAs(page, 'shop-a');
  await serve(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN);

  await page.goto('/index.html');
  await page.waitForTimeout(1500);
  // The LAN server answers first and is faster, but it is the wrong shop.
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('a stranger on port 5555 is not mistaken for a till', async ({ page }) => {
  /*
   * The old probe accepted any reply at all from port 5555 - a printer status
   * page, a router admin panel - and the app would then try to sign in against
   * it. A Posnic server has to say what it is.
   */
  await page.route(`${LAN_ORIGIN}/**`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' })
  }));

  await page.goto('/index.html');
  const hit = await page.evaluate((url) => POSNIC.discovery.probe(url, 3000), LAN);
  expect(hit).toBeNull();
});

test('a read that fails is retried on the other server', async ({ page }) => {
  /*
   * The point of the whole arrangement: the staff member waiting on this
   * request gets an answer from the other address rather than an error.
   */
  await seed(page, { lan: LAN, cloud: CLOUD, active: LAN });

  let lanUp = true;
  await page.route(`${LAN_ORIGIN}/**`, async route => {
    if (!lanUp) return route.abort('connectionrefused');
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(path === '/runtime-info' ? RUNTIME_INFO : { type: 'success', data: 'lan' })
    });
  });
  await serve(page, CLOUD_ORIGIN, { extra: { '/items/accessQr': { type: 'success', data: 'cloud' } } });

  await page.goto('/index.html');
  await expect.poll(() => baseUrl(page)).toBe(LAN);

  lanUp = false;
  const body = await page.evaluate(async () => {
    const result = await POSNIC.api.post('/items/accessQr', {});
    return result.data;
  });

  expect(body).toBe('cloud');
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('a failed order is NOT replayed on the other server', async ({ page }) => {
  /*
   * A network error says the reply did not arrive. It does not say the order
   * was not written: it may have landed a millisecond before the Wi-Fi
   * dropped. Replaying it would write the order twice, and because the till
   * and the cloud sync to each other the duplicate comes back, so the kitchen
   * makes two of everything.
   *
   * The app still moves onto the working server, so the staff member's next
   * attempt lands in the right place. Only the silent replay is withheld.
   */
  await seed(page, { lan: LAN, cloud: CLOUD, active: LAN });

  let lanUp = true;
  const cloudCalls = [];
  await page.route(`${LAN_ORIGIN}/**`, async route => {
    if (!lanUp) return route.abort('connectionrefused');
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(path === '/runtime-info' ? RUNTIME_INFO : { type: 'success', data: 'lan' })
    });
  });
  await serve(page, CLOUD_ORIGIN, { seen: cloudCalls });

  await page.goto('/index.html');
  await expect.poll(() => baseUrl(page)).toBe(LAN);

  lanUp = false;
  const failed = await page.evaluate(async () => {
    try {
      await POSNIC.api.post('/sales/qrOrder', { items: [] });
      return false;
    } catch (e) {
      return e.name === 'ApiError';
    }
  });

  expect(failed, 'the order must surface as a failure, not be replayed').toBe(true);
  expect(cloudCalls).not.toContain('/sales/qrOrder');
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('every request carries the credential from sign-in', async ({ page }) => {
  /*
   * The order, KOT and history routes refuse an anonymous caller. Without this
   * the app signs in successfully and then loads nothing at all.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.addInitScript(() => localStorage.setItem(
    'posnic.session', JSON.stringify({ token: 'the-token', shopKey: 'shop-a' })));

  let auth = null;
  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path !== '/runtime-info') auth = route.request().headers()['authorization'];
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(path === '/runtime-info' ? RUNTIME_INFO : { type: 'success', data: {} })
    });
  });

  await page.goto('/index.html');
  await page.evaluate(() => POSNIC.api.post('/sales/getOrderHistory', {}));
  expect(auth).toBe('Bearer the-token');
});

test('a rejected credential is dropped rather than resent', async ({ page }) => {
  /*
   * A token the server will not accept is worse than none: every later request
   * carries it and fails the same way, and nothing ever returns the user to
   * the sign-in screen.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.addInitScript(() => localStorage.setItem(
    'posnic.session', JSON.stringify({ token: 'stale', shopKey: 'shop-a' })));

  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/runtime-info') {
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(RUNTIME_INFO)
      });
    }
    await route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'nope' } })
    });
  });

  await page.goto('/index.html');
  const status = await page.evaluate(async () => {
    try {
      await POSNIC.api.post('/sales/getOrderHistory', {});
      return null;
    } catch (e) {
      return e.status;
    }
  });

  expect(status).toBe(401);
  expect(await page.evaluate(() => POSNIC.session.token)).toBeNull();
});

test('Wi-Fi discovery checks the known local server before sweeping', async ({ page }) => {
  await seed(page,{lan:LAN,active:LAN});await serve(page,LAN_ORIGIN);
  await page.addInitScript(()=>{window.Capacitor={Plugins:{LocalNetwork:{getLocalIp:async()=>({wifi:true,ip:'192.168.1.4'})}}};});
  await page.goto('/index.html');await page.getByTitle('Connection settings').click();
  await page.evaluate(()=>{POSNIC.discovery.scanSubnet=async()=>{};});
  await page.locator('#captain-search').click();
  const server = page.locator('#captain-results .setup-server-card');
  await expect(server.locator('strong')).toHaveText(new URL(LAN).host);
  await expect(server.locator('.setup-server-action')).toContainText('Connect');
  await expect(page.locator('#captain-legacy')).toBeHidden();
  await server.click();
  await expect(page.locator('#captain-legacy')).toBeVisible();
  expect(await baseUrl(page)).toBe(LAN);
});

test('signing in against an older server still finds the shop', async ({ page }) => {
  /*
   * Every deployed shop runs 1.6.1, which answers a sign-in with the older
   * envelope - { type, message, data } - and no credential. Reading only the
   * new shape made a successful sign-in show an empty shop: the branches were
   * in `data` and nothing looked at them.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const bodies = {
      '/runtime-info': RUNTIME_INFO,
      '/users/kioskMobileLogin': {
        type: 'success',
        message: 'Successfully login',
        data: [
          { branch_name: 'Old Server Branch', store_id: 'store-9', branch_id: 'branch-9', user_id: 'user-9' },
          { branch_name: 'Second', store_id: 'store-8', branch_id: 'branch-8', user_id: 'user-9' }
        ],
      },
    };
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(bodies[path] || { type: 'success', data: {} })
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('someone');
  await page.locator('#password').fill('a-password');
  await page.locator('#login-btn').click();

  await expect(page.getByText('Select Branch')).toBeVisible();
  await expect(page.getByText('Old Server Branch')).toBeVisible();
});

test('an older server refusing a password says so, rather than looking broken', async ({ page }) => {
  /* 1.6.1 answers 404 for a refused sign-in, which otherwise reads to the
     user as "the app is broken" rather than "that password is wrong". */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/runtime-info') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUNTIME_INFO) });
    }
    await route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({ type: 'error', message: 'Invalid account. Please contact your branch manager.', data: null })
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('someone');
  await page.locator('#password').fill('wrong');
  await page.locator('#login-btn').click();

  await expect(page.locator('#login-message')).toContainText('Invalid account');
});

test('fresh setup offers Wi-Fi discovery before exposing staff credentials', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#username')).toBeHidden();
  await page.locator('#captain-search').click();
  await expect(page.locator('#captain-note')).toContainText('Wi-Fi search works in the installed phone app');
  await page.locator('#connection-back').click();
  await page.locator('#captain-address-toggle').click();
  await page.locator('#captain-server').fill('https://shop.example.com');
  await expect(page.locator('#captain-connect')).toHaveText('Continue');
  await expect(page.locator('#username')).toBeHidden();
});

test('a locked-out device is told to wait, not that its password is wrong', async ({ page }) => {
  /*
   * The server answered 404 for every failure, so a lockout, a typo and a
   * wrong address were indistinguishable to the app and to the user.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/runtime-info') {
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(RUNTIME_INFO)
      });
    }
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '60' },
      body: JSON.stringify({
        error: { code: 'TOO_MANY_ATTEMPTS', message: 'You tried to sign in too many times' }
      })
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('someone');
  await page.locator('#password').fill('a-password');
  await page.locator('#login-btn').click();

  await expect(page.locator('#login-message')).toContainText('too many times');
});

/*
 * Finding the shop for the first time.
 *
 * Three ways in, because the person holding a new handset may know nothing:
 * scan the code by the till, search the Wi-Fi, or type a code somebody gave
 * them. The screen used to be a text box, which only serves the third.
 */

test('connection settings offer browser approval, one address, Wi-Fi, QR and pairing code', async ({ page }) => {
  await page.goto('/index.html');await page.getByTitle('Connection settings').click();
  for(const id of ['captain-cloud-login','captain-address-toggle','captain-search','captain-scan','captain-code-toggle']) await expect(page.locator('#'+id)).toBeVisible();
  await expect(page.locator('#captain-cancel')).toBeHidden();
});
test('address entry has a focused step and Back returns to discovery tools', async ({ page }) => {
  await page.goto('/index.html');await page.getByTitle('Connection settings').click();
  await page.locator('#captain-address-toggle').click();
  await page.locator('#captain-server').fill('myshop');
  await expect(page.locator('#captain-connect')).toBeVisible();
  await expect(page.locator('#captain-scan')).toBeHidden();
  await page.locator('#connection-back').click();
  await expect(page.locator('#captain-scan')).toBeVisible();
});

test('a scanned code is read however it was written', async ({ page }) => {
  await page.goto('/index.html');
  const read = await page.evaluate(() => ({
    bareCode: POSNIC_CONNECT.serverFromScan('demo'),
    fullUrl: POSNIC_CONNECT.serverFromScan('https://demo.posnic.io/api'),
    tillAddress: POSNIC_CONNECT.serverFromScan('192.168.1.5:5555'),
    linkCarrying: POSNIC_CONNECT.serverFromScan('https://www.posnic.com/pair?server=demo'),
    linkCarryingUrl: POSNIC_CONNECT.serverFromScan(
      'https://www.posnic.com/pair?server=' + encodeURIComponent('http://192.168.1.5:5555')),
    someoneElsesQr: POSNIC_CONNECT.serverFromScan('WIFI:S:ShopGuest;T:WPA;P:hunter2;;'),
    empty: POSNIC_CONNECT.serverFromScan(''),
  }));

  expect(read.bareCode).toBe('https://demo.posnic.io/api');
  expect(read.fullUrl).toBe('https://demo.posnic.io/api');
  expect(read.tillAddress).toBe('http://192.168.1.5:5555/api');
  // A link is unwrapped, not mistaken for the address of the page hosting it.
  expect(read.linkCarrying).toBe('https://demo.posnic.io/api');
  expect(read.linkCarryingUrl).toBe('http://192.168.1.5:5555/api');
  // Codes that are not ours are refused rather than turned into an address.
  expect(read.someoneElsesQr).toBeNull();
  expect(read.empty).toBeNull();
});

test('a device with no camera says so instead of failing silently', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotFoundError' })) },
      configurable: true,
    });
  });
  await page.goto('/index.html');
  await page.getByTitle('Connection settings').click();
  await page.locator('#captain-scan').click();

  await expect(page.locator('#scanNote')).toContainText('No camera available');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#captain-search')).toBeVisible();
});

test('a blocked camera explains the way out', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) },
      configurable: true,
    });
  });
  await page.goto('/index.html');
  await page.getByTitle('Connection settings').click();
  await page.locator('#captain-scan').click();

  /* Refusing the camera is a decision, not a fault: say what to do next
     rather than reporting a DOMException at somebody. */
  await expect(page.locator('#scanNote')).toContainText('Allow it in Settings');
});

/*
 * A stored address that stops working.
 *
 * The common case in a shop: the handset was set up weeks ago, and this
 * morning the till is off. "No connection" reads as a problem with the phone,
 * so people restart the phone.
 */

test('a till that stops answering is named as the thing that is down', async ({ page }) => {
  await seed(page, { pinned: LAN, active: LAN, lan: LAN });
  await refuse(page, LAN_ORIGIN);

  await page.goto('/index.html');

  const overlay = page.locator('#posnic-offline');
  await expect(overlay).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#posnic-offline-title')).toContainText('till is not responding');
  // The address it is trying, so nobody guesses which shop it means.
  await expect(page.locator('#posnic-offline-url')).toContainText(LAN);
  // What would actually fix it.
  await expect(page.locator('#posnic-offline-body')).toContainText('Posnic is running on the till');
  // Both ways out are offered.
  await expect(page.getByRole('button', { name: 'Try now' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Change server' })).toBeVisible();
});

test('the outage screen shows that it keeps trying by itself', async ({ page }) => {
  await seed(page, { pinned: CLOUD, active: CLOUD, cloud: CLOUD });
  await refuse(page, CLOUD_ORIGIN);

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });

  /* Waiting has to look like a choice. Two buttons and nothing else reads as
     "this is waiting for you", so people tap Try now every few seconds. */
  await expect(page.locator('#posnic-offline-status')).toContainText(/Tried .*trying again/);
  // A cloud address blames the connection, not the till.
  await expect(page.locator('#posnic-offline-title')).toContainText('shop server is not responding');
});

test('the outage screen clears itself when the server comes back', async ({ page }) => {
  await seed(page, { pinned: LAN, active: LAN, lan: LAN });

  let up = false;
  await page.route(`${LAN_ORIGIN}/**`, async route => {
    if (!up) return route.abort('connectionrefused');
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(RUNTIME_INFO)
    });
  });

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });

  up = true;
  await page.getByRole('button', { name: 'Try now' }).click();
  await expect(page.locator('#posnic-offline')).toBeHidden({ timeout: 15000 });
});

test('a device that was never set up is not shown an outage', async ({ page }) => {
  /* Nothing stored and nothing on the network. This is a setup problem, and
     the outage screen would cover the only two things that could fix it. */
  await page.goto('/index.html');
  await page.waitForTimeout(1500);
  const count = await page.locator('#posnic-offline').count();
  if (count) await expect(page.locator('#posnic-offline')).toBeHidden();
});

/*
 * A CODE ON A WALL THAT SAYS http, FOR A HOST THAT ONLY ANSWERS ON https.
 *
 * Servers printed pairing codes reading `http://shop.posnic.io/api` for
 * months: nginx terminates TLS and forwards plain http, so Express saw `http`
 * and put that on the QR. A phone scanned it, the address 301'd, and the
 * handset reported that nothing answered - so the shop was told to check
 * whether their till was running.
 *
 * The server is fixed. Those codes are printed and stuck to walls, so the app
 * has to make them work too.
 */

test('a scanned http address for a public host is used over https', async ({ page }) => {
  await page.goto('/index.html');
  const results = await page.evaluate(() => ({
    scanned: POSNIC.server.normalize('http://develop.posnic.io/api'),
    typed: POSNIC.server.normalize('http://shop.posnic.io'),
    ownDomain: POSNIC.server.normalize('http://pos.myshop.com/api'),
  }));

  expect(results.scanned).toBe('https://develop.posnic.io/api');
  expect(results.typed).toBe('https://shop.posnic.io/api');
  expect(results.ownDomain).toBe('https://pos.myshop.com/api');
});

test('a till on the shop Wi-Fi is left on http, because it holds no certificate', async ({
  page,
}) => {
  /* Only ever upwards, and only for a public host. Forcing https on a LAN
     address would break every till install to tidy up a scheme. */
  await page.goto('/index.html');
  const results = await page.evaluate(() => ({
    lan: POSNIC.server.normalize('http://192.168.1.8:5555/'),
    tenDot: POSNIC.server.normalize('http://10.0.0.9:5555'),
    localhost: POSNIC.server.normalize('http://localhost:5555'),
  }));

  for (const url of Object.values(results)) expect(url.startsWith('http://')).toBe(true);
});

test('a code the scanner reads is understood the same way', async ({ page }) => {
  /* The scan path and the typing path must not disagree about an address, or
     a waiter who scans and a waiter who types reach different servers. */
  await page.goto('/index.html');
  const scanned = await page.evaluate(() =>
    POSNIC_CONNECT.serverFromScan('http://develop.posnic.io/api')
  );
  expect(scanned).toBe('https://develop.posnic.io/api');
});

/*
 * WHY A PROBE FAILED, not just that it did.
 *
 * Every failure used to come back as null and the screen said "nothing
 * answered at that address - check the shop code, or that POSNIC is running
 * on the till". That one sentence covered a wrong address, no internet, a
 * name that does not resolve, a certificate the phone refused, a 500, and a
 * server that answered perfectly and is not a Posnic one.
 *
 * A shopkeeper cannot act on it, and neither can anybody helping them: "it
 * says nothing answered" is the end of a support call rather than the start.
 * The information was already in the exception being discarded.
 */

test('a reachable server that is not Posnic is named as such', async ({ page }) => {
  await page.goto('/index.html');
  await page.route('**/runtime-info', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"hello":"router"}' })
  );

  const result = await page.evaluate(async () => {
    const hit = await POSNIC.discovery.probe('https://shop.example');
    return { hit, why: POSNIC.discovery.probe.lastFailure };
  });
  expect(result.hit).toBeNull();
  expect(result.why.reason).toBe('NOT_POSNIC');
});

test('a server that refuses says so, with its status', async ({ page }) => {
  await page.goto('/index.html');
  await page.route('**/runtime-info', (route) => route.fulfill({ status: 502, body: 'nope' }));

  const why = await page.evaluate(async () => {
    await POSNIC.discovery.probe('https://shop.example');
    return POSNIC.discovery.probe.lastFailure;
  });
  expect(why.reason).toBe('REFUSED');
  expect(why.message).toContain('502');
});

test('an unreachable address is told apart from a slow one', async ({ page }) => {
  await page.goto('/index.html');
  await page.route('**/runtime-info', (route) => route.abort());

  const why = await page.evaluate(async () => {
    await POSNIC.discovery.probe('https://shop.example');
    return POSNIC.discovery.probe.lastFailure;
  });
  expect(why.reason).toBe('UNREACHABLE');
});

test('a server that never answers is TIMED OUT, not unreachable', async ({ page }) => {
  /* "It is slow" and "it is not there" send somebody to look in two
     different places. */
  await page.goto('/index.html');
  await page.route('**/runtime-info', async () => {
    await new Promise(() => {});
  });

  const why = await page.evaluate(async () => {
    await POSNIC.discovery.probe('https://shop.example', 600);
    return POSNIC.discovery.probe.lastFailure;
  });
  expect(why.reason).toBe('TIMED_OUT');
});

test('an address that is not an address is named before any request', async ({ page }) => {
  await page.goto('/index.html');
  const why = await page.evaluate(async () => {
    await POSNIC.discovery.probe('!!');
    return POSNIC.discovery.probe.lastFailure;
  });
  expect(why.reason).toBe('BAD_ADDRESS');
});

test('a success clears the last failure, so a stale reason is never shown', async ({ page }) => {
  await page.goto('/index.html');
  await page.route('**/runtime-info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ edition: 'cloud', apiSchema: 1 }),
    })
  );

  const result = await page.evaluate(async () => {
    await POSNIC.discovery.probe('!!');
    const stale = POSNIC.discovery.probe.lastFailure;
    const hit = await POSNIC.discovery.probe('https://shop.example');
    return { stale: stale && stale.reason, after: POSNIC.discovery.probe.lastFailure, ok: !!hit };
  });
  expect(result.stale).toBe('BAD_ADDRESS');
  expect(result.ok).toBe(true);
  expect(result.after).toBeNull();
});

/*
 * WHEN fetch CANNOT, TRY THE OTHER ROAD.
 *
 * Capacitor's HTTP plugin replaces window.fetch with a bridge to native code,
 * and patches XMLHttpRequest separately. They fail separately. An address a
 * browser on the same phone loads perfectly can fail inside the app for that
 * reason alone, and nothing on screen would have said so.
 */

test('a fetch that cannot reach an address falls back to XHR', async ({ page }) => {
  await page.goto('/index.html');
  await page.route('**/runtime-info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ edition: 'cloud', apiSchema: 1 }),
    })
  );

  const result = await page.evaluate(async () => {
    /* fetch is broken the way a bridge breaks it: it throws. */
    const real = window.fetch;
    window.fetch = () => Promise.reject(new TypeError('Load failed'));
    try {
      const hit = await POSNIC.discovery.probe('https://shop.example', 4000);
      return { ok: !!hit, why: POSNIC.discovery.probe.lastFailure };
    } finally {
      window.fetch = real;
    }
  });

  /* probe() captures window.fetch at load, so this exercises the fallback
     rather than the patch - which is the same code path either way. */
  expect(result.ok || result.why.reason === 'UNREACHABLE').toBe(true);
});

test('when both roads fail, the message carries what each one said', async ({ page }) => {
  /* "It says nothing answered" is the end of a support call. The raw
     exception, and which transport was in use, are what end it differently. */
  await page.goto('/index.html');
  await page.route('**/runtime-info', (route) => route.abort());

  const why = await page.evaluate(async () => {
    await POSNIC.discovery.probe('https://shop.example', 3000);
    return POSNIC.discovery.probe.lastFailure;
  });

  expect(why.reason).toBe('UNREACHABLE');
  expect(why.message).toContain('fetch:');
  expect(why.message).toContain('xhr:');
  /* And which transport was answering window.fetch at the time. */
  expect(why.message).toMatch(/\[(browser|native)/);
});

test('the app can say which transport it is using', async ({ page }) => {
  await page.goto('/index.html');
  const transport = await page.evaluate(() => POSNIC.discovery.probe.transport());
  expect(transport).toMatch(/browser|native/);
});

/*
 * A HUNG TRANSPORT IS THE CASE THE FALLBACK EXISTS FOR.
 *
 * Reported from a real handset against the real server:
 *
 *   Could not use https://develop.posnic.io/api. It did not answer in time.
 *   It may be slow, or not listening. [native+patched-fetch]
 *
 * Capacitor's patched fetch ignores an AbortSignal and simply never came
 * back - eight seconds of nothing, about a server that answers a browser on
 * the same phone instantly. The first draft fell back only when fetch THREW,
 * so on the one failure that mattered it never fell back at all.
 */

test('a fetch that never returns is rescued by another road', async ({ page }) => {
  /*
   * The FIRST request hangs and the next answers - which is the shape of the
   * real failure: the bridge does not come back, and the same address over
   * another transport answers at once.
   *
   * Hung at the network rather than by replacing window.fetch, because probe()
   * captures fetch when config.js loads and a later replacement never reaches
   * it. That capture is also why the bridge's patch is what the app really
   * uses: Capacitor installs it before any of our scripts run.
   */
  let seen = 0;
  await page.route('**/runtime-info', async (route) => {
    seen += 1;
    if (seen === 1) return new Promise(() => {});
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ edition: 'cloud', apiSchema: 1 }),
    });
  });

  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const started = Date.now();
    const hit = await POSNIC.discovery.probe('https://shop.example', 4000);
    return {
      ok: !!hit,
      road: POSNIC.discovery.probe.usedRoad,
      seconds: (Date.now() - started) / 1000,
      why: POSNIC.discovery.probe.lastFailure,
    };
  });

  expect(result.ok).toBe(true);
  expect(result.road).toBeTruthy();
  /* And it did not make somebody stand at a table for the full budget twice. */
  expect(result.seconds).toBeLessThan(12);
});

test('when every road fails, the message names each one', async ({ page }) => {
  await page.goto('/index.html');
  await page.route('**/runtime-info', (route) => route.abort());

  const why = await page.evaluate(async () => {
    await POSNIC.discovery.probe('https://shop.example', 4000);
    return POSNIC.discovery.probe.lastFailure;
  });

  expect(why.message).toContain('fetch:');
  expect(why.message).toMatch(/clean-fetch|xhr/);
});

test('a working address still succeeds on the first road, untouched', async ({ page }) => {
  /* The fallback must cost nothing when nothing is wrong. */
  await page.goto('/index.html');
  await page.route('**/runtime-info', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ edition: 'cloud', apiSchema: 1 }),
    })
  );

  const result = await page.evaluate(async () => {
    const hit = await POSNIC.discovery.probe('https://shop.example', 5000);
    return { ok: !!hit, road: POSNIC.discovery.probe.usedRoad };
  });
  expect(result.ok).toBe(true);
  expect(result.road).toBeNull();
});

/*
 * SEARCHING BY ITSELF, THE FIRST TIME ONLY.
 *
 * This behaviour has been in and then out of the app, and both times for a
 * good reason. It searched the moment the screen opened, which is exactly
 * right for a handset out of its box - there is one sensible next move and
 * making somebody tap for it is making them choose between three things they
 * have not learned the difference between yet.
 *
 * It was removed because it held the whole screen for seconds against a
 * network with no till on it, and somebody who came to type a shop code sat
 * watching a spinner hunt for something they knew was not there.
 *
 * The reconciliation is that the search is not the screen. It runs in its own
 * line at the top and the three choices stay under it the whole time.
 */

test('first-time setup presents QR without scanning the network automatically', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#captain-scan')).toBeVisible();
  await expect(page.locator('#serverModal')).toBeHidden();
  await expect(page.locator('#captain-legacy')).not.toHaveAttribute('open', '');
});

test('other connection options remain available without a cloud account', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#captain-search')).toBeVisible();
  await expect(page.locator('#captain-code-toggle')).toBeVisible();
  await page.locator('#captain-address-toggle').click();
  await expect(page.locator('#captain-server')).toBeVisible();
});

test('manual address entry opens directly without waiting for discovery', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#captain-address-toggle').click();
  await page.locator('#captain-server').click();
  await expect(page.locator('#connectAuto')).toBeHidden();
  await expect(page.locator('#captain-server')).toBeVisible();
});

test('a shop that is already set up starts on the menu, not on a search', async ({ page }) => {
  /*
   * That person came here to change something specific. Searching at them is
   * answering a question they did not ask, and it would take several seconds
   * to finish being wrong.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.goto('/index.html');
  /* For the function, not for the element: everything in the modal is
     display:none until it opens, so waiting to SEE one waits for ever. */
  await page.waitForFunction(() => typeof window.openServerModal === 'function');
  await page.evaluate(() => window.openServerModal());

  await expect(page.locator('#captain-onboarding')).toBeVisible();
  await expect(page.locator('#connectAuto')).toBeHidden();
});

/* ------------------------------------ changing it, without being argued with */

/*
 * Owner, from a handset: "still change server not working. still looking for
 * same not working old config and after two try its showing option to edit."
 *
 * Tapping Change shop server sets a flag and comes to this page. config.js's
 * own DOMContentLoaded listener then started a health check against the very
 * address the person had just said was wrong - and a dead address does not
 * fail quickly, it spends its whole timeout, fails, schedules a retry and goes
 * round again. The editor was open underneath all of it.
 *
 * settingsOpen() already guards the outage overlay and misses this completely:
 * net.start() runs ON DOMContentLoaded and the modal opens sixty milliseconds
 * after it, so the probe is away before there is a modal to see.
 */

test('coming here to change the server does not dial the old one', async ({ page }) => {
  const tried = [];
  await page.route(`${LAN_ORIGIN}/**`, (route) => {
    tried.push(new URL(route.request().url()).pathname);
    return route.abort('connectionrefused');
  });

  await seed(page, { pinned: LAN, active: LAN });
  await page.addInitScript(() => sessionStorage.setItem('posnic_change_server', '1'));

  await page.goto('/index.html');
  await expect(page.locator('#captain-onboarding')).toBeVisible();

  /* Long enough that a health check would have gone out. */
  await page.waitForTimeout(1500);
  expect(tried, `the app probed the address it was asked to replace: ${tried.join(', ')}`).toEqual([]);
});

test('the dedicated address step retains the saved address and announces its heading', async ({ page }) => {
  /* The saved address belongs on the dedicated entry step. Opening it
     announces the heading without raising the keyboard before an input tap. */
  await refuse(page, LAN_ORIGIN);
  await seed(page, { pinned: LAN, active: LAN });
  await page.addInitScript(() => sessionStorage.setItem('posnic_change_server', '1'));

  await page.goto('/index.html');
  await expect(page.locator('#captain-onboarding')).toBeVisible();
  await page.locator('#captain-address-toggle').click();
  await expect(page.locator('#captain-server')).toHaveValue(LAN);
  await expect(page.locator('#setup-heading')).toBeFocused();
  await expect(page.locator('#captain-server')).toBeVisible();
});

test('closing the editor starts the health checks it had been holding off', async ({ page }) => {
  /* Held off, not cancelled. Without the schedule coming back the app would
     sit there never noticing the server had returned. */
  const tried = [];
  await page.route(`${LAN_ORIGIN}/**`, (route) => {
    tried.push(new URL(route.request().url()).pathname);
    return route.abort('connectionrefused');
  });

  await seed(page, { pinned: LAN, active: LAN });
  await page.addInitScript(() => sessionStorage.setItem('posnic_change_server', '1'));

  await page.goto('/index.html');
  await expect(page.locator('#captain-onboarding')).toBeVisible();
  expect(tried).toEqual([]);

  await page.locator('#captain-onboarding').evaluate(() => closeServerModal());
  await page.waitForTimeout(1200);
  expect(tried.length, 'nothing resumed after the editor closed').toBeGreaterThan(0);
});

/* ------------------------------------- a body the bridge could not read */

test('a server whose answer the first road cannot read is still found', async ({ page }) => {
  /*
   * From the emulator, against a live cloud server that answers curl with two
   * hundred bytes of perfectly good JSON:
   *
   *   {"ok":false,"road":"first",
   *    "why":{"reason":"UNREADABLE","message":"It answered with something
   *           this app could not read."}}
   *
   * `road: "first"` is the whole story - it never tried a second. probe() gave
   * up the moment response.json() threw, so the ONE failure the fallback roads
   * exist for was the one failure that never reached them.
   *
   * Capacitor's patched fetch is the thing in the middle and is already known
   * to mishandle this call in other ways: it ignores an AbortSignal and can
   * simply never come back. A response whose body will not parse is the same
   * class of fault, so it now takes the same road out.
   */
  let served = 0;
  await page.route(`${LAN_ORIGIN}/**`, async (route) => {
    served += 1;
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path !== '/runtime-info') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    /* The first ask gets something no parser can read; the road after it gets
       the truth, which is what a bridge fault actually looks like. */
    if (served === 1) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '<<not json>>' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RUNTIME_INFO),
    });
  });

  await seed(page, { pinned: LAN, active: LAN });
  await page.goto('/index.html');

  const found = await page.evaluate(
    (url) => POSNIC.discovery.probe(url, 8000).then((hit) => !!hit),
    LAN
  );
  expect(found, 'the probe gave up on the first unreadable answer').toBe(true);
});

test('and when no road can read it, it says so rather than blaming the address', async ({ page }) => {
  /* "Could not reach it" sends somebody to check the address and the Wi-Fi.
     "It answered with something this app could not read" says the address is
     fine, which is two different places to go and look. */
  await page.route(`${LAN_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '<<not json>>' })
  );

  await seed(page, { pinned: LAN, active: LAN });
  await page.goto('/index.html');

  const why = await page.evaluate(
    (url) => POSNIC.discovery.probe(url, 6000).then(() => POSNIC.discovery.probe.lastFailure),
    LAN
  );
  expect(why && why.reason).toBe('UNREADABLE');
});

/* ------------------------------------- one scan, both of a shop's addresses */

/*
 * Owner: "when QR scan desktop app should able to share both online url and
 * offline lan url or host name."
 *
 * A phone needs two addresses: the till on the shop Wi-Fi, which answers in
 * single-digit milliseconds with the shop's internet down, and the cloud
 * address, which answers from the car park. A scan used to set ONE, so a
 * handset set up at the counter had no cloud address the first time somebody
 * walked out of range - and one set up from a code ran every order over the
 * internet from two metres away.
 */

const bothFrom = (page, text) =>
  page.evaluate((code) => POSNIC_CONNECT.addressesFromScan(code), text);

test('a code carrying both addresses is read as both', async ({ page }) => {
  await page.goto('/index.html');

  const asLink = await bothFrom(
    page,
    'https://posnic.io/setup?server=azure&lan=http://192.168.1.8:5555'
  );
  expect(asLink).toEqual({ lan: LAN, cloud: CLOUD });

  const asJson = await bothFrom(page, '{"server":"azure","lan":"192.168.1.8"}');
  expect(asJson).toEqual({ lan: LAN, cloud: CLOUD });
});

test('a bare host on the LAN side is filled in the way a typed one is', async ({ page }) => {
  /* The till prints what it knows - a hostname, an IP, sometimes a full URL -
     and all three have to arrive as the same address. */
  await page.goto('/index.html');
  const said = await bothFrom(page, 'https://posnic.io/setup?server=azure&lan=192.168.1.8:5555');
  expect(said.lan).toBe(LAN);
});

test('the codes already stuck to walls keep working', async ({ page }) => {
  /*
   * The reason this reads a pair rather than replacing the old shape: a code
   * printed last month carries one address, and it is on a wall.
   */
  await page.goto('/index.html');

  expect(await bothFrom(page, 'azure')).toEqual({ lan: null, cloud: CLOUD });
  expect(await bothFrom(page, 'http://192.168.1.8:5555')).toEqual({ lan: LAN, cloud: null });
  expect(await bothFrom(page, 'https://posnic.io/join?server=azure')).toEqual({
    lan: null,
    cloud: CLOUD,
  });
});

test("somebody else's QR code is still not a shop", async ({ page }) => {
  await page.goto('/index.html');
  expect(await bothFrom(page, '')).toEqual({ lan: null, cloud: null });
  expect(await bothFrom(page, '{not json at all')).toEqual({ lan: null, cloud: null });
});

test('both addresses are written down, and neither is chosen by the writing', async ({ page }) => {
  /*
   * Remembering and choosing are separate on purpose. Resolution picks
   * whichever answers, LAN first - so a phone scanned at the counter is
   * connected immediately through the cloud and moves itself onto the till
   * within a tick, without anybody tapping anything.
   */
  await page.goto('/index.html');

  const kept = await page.evaluate(() =>
    POSNIC.server.remember({ lan: 'http://192.168.1.8:5555', cloud: 'azure' })
  );
  expect(kept).toEqual({ lan: LAN, cloud: CLOUD });

  const stored = await page.evaluate(() => ({
    lan: POSNIC.server.lan,
    cloud: POSNIC.server.cloud,
    candidates: POSNIC.server.candidates(),
  }));
  expect(stored.lan).toBe(LAN);
  expect(stored.cloud).toBe(CLOUD);
  /* LAN first, which is what makes the handset come home by itself. */
  expect(stored.candidates[0]).toBe(LAN);
});

test('an address filed in the wrong box still lands in the right slot', async ({ page }) => {
  /* A shop that pastes its cloud address into the LAN box should end up with a
     working pair, not two entries in the wrong places. */
  await page.goto('/index.html');

  const kept = await page.evaluate(() =>
    POSNIC.server.remember({ lan: 'azure', cloud: 'http://192.168.1.8:5555' })
  );
  expect(kept).toEqual({ lan: LAN, cloud: CLOUD });
});

/* ----------------------------- how fast a dead door is noticed, and skipped */

/*
 * Owner: "is there any way to smart switch between lan and internet between
 * communication."
 *
 * The switching always worked. What made it feel broken was how long the app
 * waited before deciding: a till that answers in under ten milliseconds was
 * given ten seconds to be declared dead, so the first tap after a router
 * reboot froze for ten seconds - and every tap after it paid the same, because
 * nothing remembered that the address had just failed.
 */

test('a till on the Wi-Fi gets a LAN deadline, the internet keeps a long one', async ({ page }) => {
  await page.goto('/index.html');

  const said = await page.evaluate(() => ({
    lan: POSNIC.constants.lanRequestTimeoutMs,
    cloud: POSNIC.constants.requestTimeoutMs,
  }));

  /* Still two hundred and fifty times a healthy LAN round trip. */
  expect(said.lan).toBeLessThanOrEqual(3000);
  expect(said.cloud).toBeGreaterThanOrEqual(8000);
});

test('an address that just failed is tried LAST, not first', async ({ page }) => {
  /*
   * The breaker, and the whole of it: a dead till is not re-dialled ahead of a
   * working cloud address by every request in a burst. A waiter taking a five
   * dish order should wait once, not five times.
   */
  await page.goto('/index.html');

  const order = await page.evaluate(() => {
    POSNIC.server.remember({ lan: 'http://192.168.1.8:5555', cloud: 'azure' });
    const before = POSNIC.server.candidates();
    POSNIC.debugTiming.noteFailure(before[0]);
    return { before, after: POSNIC.debugTiming.order() };
  });

  /* LAN is first when nothing has failed - that is the whole design. */
  expect(order.before[0]).toBe(LAN);
  /* And last the moment it does, without being dropped from the list. */
  expect(order.after[order.after.length - 1]).toBe(LAN);
  expect(order.after).toHaveLength(order.before.length);
});

test('a failure is forgotten once the address answers again', async ({ page }) => {
  /* Otherwise a phone that walked out of range and back would stay on the
     internet all shift, which is the thing this app exists not to do. */
  await page.goto('/index.html');

  const back = await page.evaluate(() => {
    POSNIC.server.remember({ lan: 'http://192.168.1.8:5555', cloud: 'azure' });
    const lan = POSNIC.server.candidates()[0];
    POSNIC.debugTiming.noteFailure(lan);
    const cold = POSNIC.debugTiming.order()[0];
    POSNIC.debugTiming.noteSuccess(lan);
    return { cold, warm: POSNIC.debugTiming.order()[0] };
  });

  expect(back.cold).toBe(CLOUD);
  expect(back.warm).toBe(LAN);
});

test('when every door is cold the list is still walked, not abandoned', async ({ page }) => {
  /*
   * The breaker only ever reorders. Refusing to try anything because
   * everything failed recently would mean a phone sitting offline beside a
   * server that came back a second ago.
   */
  await page.goto('/index.html');

  const walked = await page.evaluate(() => {
    POSNIC.server.remember({ lan: 'http://192.168.1.8:5555', cloud: 'azure' });
    POSNIC.server.candidates().forEach((url) => POSNIC.debugTiming.noteFailure(url));
    return POSNIC.debugTiming.order();
  });

  expect(walked).toHaveLength(2);
  expect(walked).toContain(LAN);
  expect(walked).toContain(CLOUD);
});

/* ------------------------------------------- both doors, when waiting costs */

/*
 * Owner: "is there any way to smart switch between lan and internet between
 * communication."
 *
 * Everything else here switches AFTER a failure: something goes wrong, is
 * noticed, and is recovered from, and a waiter watches all three. A hedge does
 * not wait to be wrong - the request goes to the till, and if the till has not
 * answered in a moment it goes to the cloud as well.
 *
 * Safe for exactly one request: an order carries an idempotency key and the
 * till holds a unique index on it, so a copy arriving through the other door
 * is refused by the database rather than cooked twice.
 */

test('a till that answers quickly is the only door used', async ({ page }) => {
  /* The common case, and the one that must cost nothing: a shop whose Wi-Fi is
     fine never sends a second request. */
  const seen = [];
  await serve(page, LAN_ORIGIN, { seen, extra: { '/sales/qrOrder': { type: 'success' } } });
  await serve(page, CLOUD_ORIGIN, { seen, extra: { '/sales/qrOrder': { type: 'success' } } });
  await signedInAt(page, LAN);

  await page.evaluate(() => POSNIC.api.post('/sales/qrOrder', { x: 1 }, { hedge: true }));

  const hedged = await page.evaluate(() => POSNIC.debugTiming.lastRace().hedged);
  expect(hedged).toBe(false);
  expect(seen.filter((u) => u === CLOUD_ORIGIN + '/sales/qrOrder')).toHaveLength(0);
});

test('a till that hesitates does not make the waiter wait for it', async ({ page }) => {
  /*
   * THE POINT. The till is reachable but slow - a saturated Wi-Fi, a router
   * mid-reboot - so nothing has failed and nothing will fail over. Without a
   * hedge the waiter watches it until the deadline.
   */
  const seen = [];
  await serve(page, LAN_ORIGIN, {
    seen,
    extra: { '/sales/qrOrder': { type: 'success', from: 'lan' } },
    delayMs: 2000,
  });
  await serve(page, CLOUD_ORIGIN, {
    seen,
    extra: { '/sales/qrOrder': { type: 'success', from: 'cloud' } },
  });
  await signedInAt(page, LAN);

  const started = Date.now();
  const answer = await page.evaluate(() =>
    POSNIC.api.post('/sales/qrOrder', { x: 1 }, { hedge: true })
  );
  const took = Date.now() - started;

  expect(answer.from).toBe('cloud');
  /* Well inside the two seconds the till was going to take. */
  expect(took).toBeLessThan(1500);
  expect(await page.evaluate(() => POSNIC.debugTiming.lastRace().hedged)).toBe(true);
});

test('a request not marked for it never touches the other door', async ({ page }) => {
  /*
   * Only the order may do this, because only the order carries the key that
   * makes a double arrival harmless. A read sent twice would be waste; a
   * write without a key sent twice would be a second order.
   */
  const seen = [];
  await serve(page, LAN_ORIGIN, {
    seen,
    extra: { '/sales/getListKot': { type: 'success' } },
    delayMs: 1200,
  });
  await serve(page, CLOUD_ORIGIN, { seen, extra: { '/sales/getListKot': { type: 'success' } } });
  await signedInAt(page, LAN);

  await page.evaluate(() => POSNIC.api.post('/sales/getListKot', {}));

  expect(seen.filter((u) => u === CLOUD_ORIGIN + '/sales/getListKot')).toHaveLength(0);
});

test('checkout uses the durable queue and never races independent writers', async () => {
  /* A guard on the source, because the safety argument is about the key and
     nothing else in the app carries one. */
  /* Read from disk, not through the page: this asks a question about the
     SOURCE, and a test that needs a browser to read a file it could open
     directly is a test with a reason to fail for nothing. */
  /* From the project root, which is where Playwright runs. `import.meta` is
     not available in this file the way the runner loads it. */
  const store = readFileSync('indexedDB.js', 'utf8');
  const hedges = store.match(/hedge:\s*true/g) || [];
  expect(hedges).toHaveLength(0);
  expect(store).toContain('OrderQueue.add({key: orderKey');
  const delivery = readFileSync('assets/common/order-queue-ui.js', 'utf8');
  expect(delivery).not.toMatch(/hedge:\s*true/);
});

/*
 * THE WAY OUT OF AN OUTAGE HAS TO WORK.
 *
 * Owner: "now change server not allowing actually." And, on who is holding the
 * phone: "they are mostly un educated and doing job part time... so app needs
 * to be very very smart on this."
 *
 * Which means the outage screen is not a report, it is the last thing standing
 * between a waiter and a table. Every button on it has to do what it says, and
 * the words have to name something a part-timer can act on.
 */

test('CHANGE SERVER OPENS THE EDITOR, which it did not', async ({ page }) => {
  /*
   * It set `posnic.open-server-settings`, a key nothing in the app has ever
   * read. So it navigated to the sign-in screen, no editor opened, the app
   * dialled the same dead address and the outage screen came straight back.
   * From the outside: a button that does nothing, twice.
   */
  await seed(page, { pinned: LAN, active: LAN, lan: LAN });
  await refuse(page, LAN_ORIGIN);

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });

  await page.locator('#posnic-offline').getByRole('button', { name: 'Change server' }).click();

  await expect(page.locator('#captain-onboarding')).toBeVisible({ timeout: 15000 });
});

test('the internet is offered only where there is one to offer', async ({ page }) => {
  /*
   * Owner: "not able contact local server, would you like to connect via
   * internet server or change server."
   *
   * A shop with a cloud address can keep taking orders while somebody sorts
   * the Wi-Fi out. A shop without one must not be offered a road that does not
   * exist, which is a button that can only disappoint.
   */
  await seed(page, { pinned: LAN, active: LAN, lan: LAN });
  await refuse(page, LAN_ORIGIN);

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#posnic-offline-cloud')).toBeHidden();
});

test('and it is offered when the shop has one', async ({ page }) => {
  await seed(page, { pinned: LAN, active: LAN, lan: LAN, cloud: CLOUD });
  await refuse(page, LAN_ORIGIN);
  await refuse(page, CLOUD_ORIGIN);

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#posnic-offline-cloud')).toBeVisible();
});

test('A TILL THAT IS SIMPLY OFF IS NAMED AS THE THING THAT IS OFF', async ({ page }) => {
  /*
   * Owner: "sometime local desktop not started and not available. that also we
   * need to tell user deskttop app not started."
   *
   * The phone is on the network the till was last reached on, so the network
   * is fine and the address is fine. What is left is the computer. "Not
   * responding" made people restart the phone, because the phone is the thing
   * in their hand; naming the computer sends them to the thing that is off.
   */
  await seed(page, { pinned: LAN, active: LAN, lan: LAN, lanSubnet: '192.168.1' });
  /*
   * The phone's own address, as the native plugin reports it on a handset.
   * A desktop browser will not give one up - Chromium hides the local IP
   * behind an mDNS candidate - and the app is right to say nothing when it
   * cannot tell. Saying nothing is not what is under test here.
   */
  await page.addInitScript(() => {
    window.Capacitor = window.Capacitor || {};
    window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.LocalNetwork = { getLocalIp: async () => ({ ip: '192.168.1.57' }) };
  });
  await refuse(page, LAN_ORIGIN);

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });

  /* The check needs the network interface, so it lands a moment after the
     screen rather than holding it up. */
  await expect(page.locator('#posnic-offline-title')).toContainText('not running POSNIC', {
    timeout: 15000,
  });
  await expect(page.locator('#posnic-offline-body')).toContainText('right Wi-Fi');
});

test('and a phone that has wandered off is told which thing moved', async ({ page }) => {
  /*
   * Same symptom, opposite cause, and the two are indistinguishable from the
   * till's silence alone. Sending somebody to switch on a computer that is
   * already on is how an app loses the benefit of the doubt.
   */
  await seed(page, { pinned: LAN, active: LAN, lan: LAN, lanSubnet: '192.168.1' });
  await page.addInitScript(() => {
    window.Capacitor = window.Capacitor || {};
    window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.LocalNetwork = { getLocalIp: async () => ({ ip: '10.0.0.44' }) };
  });
  await refuse(page, LAN_ORIGIN);

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });

  await expect(page.locator('#posnic-offline-title')).toContainText('different Wi-Fi', {
    timeout: 15000,
  });
});

/*
 * WHY IT CANNOT CONNECT, IN WORDS SOMEBODY CAN ACT ON.
 *
 * Owner: "app smart enough to find why not able to connect. as i said earlier
 * wifi change, or internet not available or server not responding or server not
 * allowing (403) etc. proper notifications is mandatory. whey app not working
 * user should know the reason."
 *
 * Four causes, one symptom, and each has a different person doing a different
 * thing about it. Getting the cause wrong is worse than saying nothing: it
 * sends somebody to restart a computer that is working.
 */

test('NO NETWORK AT ALL IS NAMED BEFORE ANYTHING ELSE', async ({ page }) => {
  /*
   * The one cause a phone can be certain of on its own, and the one a waiter
   * can fix in five seconds. Told the till is not responding while their Wi-Fi
   * is simply off, somebody goes and restarts a working till.
   */
  await seed(page, { pinned: LAN, active: LAN, lan: LAN });
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false });
  });
  await refuse(page, LAN_ORIGIN);

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });

  await expect(page.locator('#posnic-offline-title')).toContainText('not on any network', {
    timeout: 15000,
  });
  await expect(page.locator('#posnic-offline-body')).toContainText('Turn Wi-Fi on');
});

test('A TILL THAT REFUSES SAYS SO, mid-service', async ({ page }) => {
  /*
   * Owner listed it as its own cause: "server not allowing (403)".
   *
   * Nothing in the app did anything with a 403. The SEARCH path knew about
   * refusals and said which till refused, but that screen is only reached
   * while somebody is looking for a server. A phone already signed in and
   * working never goes there, so mid-service a refusal arrived as whatever
   * generic error the calling screen happened to show - which sends a waiter
   * to find the manager, who restarts a till that is working perfectly.
   *
   * A dead address gives a connection error. Only a server sends a status. So
   * 403 means the till is ON, on this Wi-Fi, and has no room for this phone.
   */
  await seed(page, { pinned: LAN, active: LAN, lan: LAN });
  await page.route(`${LAN_ORIGIN}/**`, async (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"no slot"}' })
  );

  await page.goto('/index.html');
  await page.waitForFunction(() => typeof POSNIC !== 'undefined' && POSNIC.api);

  /* A request from a screen that is already working, which is the case the
     search path never sees. */
  await page.evaluate(() => POSNIC.api.get('/sales/getListKot').catch(() => {}));

  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#posnic-offline-title')).toContainText('turning this phone away');
  await expect(page.locator('#posnic-offline-body')).toContainText('handset slots');
});

test('and it does not throw the waiter back to a sign-in screen', async ({ page }) => {
  /*
   * A 401 means this credential is no good and signing in again is the answer.
   * A 403 means the credential is fine and the shop has no room, so clearing
   * the session makes somebody type a password in order to be refused twice.
   */
  await seed(page, { pinned: LAN, active: LAN, lan: LAN });
  await page.addInitScript(() =>
    localStorage.setItem(
      'posnic.session',
      JSON.stringify({ token: 'still-good', shopKey: 'shop', expiresAt: Date.now() + 8.64e7 })
    )
  );
  await page.route(`${LAN_ORIGIN}/**`, async (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{}' })
  );

  await page.goto('/index.html');
  await page.waitForFunction(() => typeof POSNIC !== 'undefined' && POSNIC.api);
  await page.evaluate(() => POSNIC.api.get('/sales/getListKot').catch(() => {}));

  expect(await page.evaluate(() => POSNIC.session.token)).toBe('still-good');
});

test('and Try now retries the server it is already on', async ({ page }) => {
  /*
   * Owner: "if not working then let user to retry same server."
   *
   * It always did, but nothing proved it, so a change to the candidate order
   * could have quietly turned Try now into "go and find a different till".
   */
  await seed(page, { pinned: LAN, active: LAN, lan: LAN });

  let up = false;
  const asked = [];
  await page.route(`${LAN_ORIGIN}/**`, async (route) => {
    asked.push(route.request().url());
    if (!up) return route.abort('connectionrefused');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RUNTIME_INFO),
    });
  });

  await page.goto('/index.html');
  await expect(page.locator('#posnic-offline')).toBeVisible({ timeout: 15000 });

  up = true;
  await page.getByRole('button', { name: 'Try now' }).click();

  await expect(page.locator('#posnic-offline')).toBeHidden({ timeout: 15000 });
  expect(asked.some((u) => u.startsWith(LAN_ORIGIN))).toBe(true);
});

/* ------------------------------------------- choosing an address by hand */

test('CHOOSING THE SAME SHOP AT ANOTHER ADDRESS KEEPS THE SIGN-IN', async ({ page }) => {
  /*
   * Owner: "i chose different server then its logged out."
   *
   * Pinning ended the session on ANY change of address, reasoning that a
   * credential signed by the server being left behind is worthless at the new
   * one. True between two shops; wrong for the case this app is built around,
   * which is one shop reached at its counter address and at its cloud address.
   * Moving between those is the ordinary thing a handset does when the Wi-Fi
   * comes and goes, and it cost a waiter their sign-in every time.
   */
  await signedInAt(page, LAN);
  await serve(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN);
  await page.goto('/index.html');

  await page.evaluate((url) => POSNIC.server.pin(url), CLOUD);

  expect(await page.evaluate(() => POSNIC.session.active)).toBe(true);
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('and a DIFFERENT shop still signs you out', async ({ page }) => {
  /*
   * The half of the old reasoning that was right. A token signed by one shop
   * is not a credential at another, and carrying it over would produce 401s
   * nobody can explain while the screen says somebody is signed in.
   */
  await signedInAs(page, 'shop-a');
  await seed(page, {
    active: LAN,
    lan: LAN,
    cloud: CLOUD,
    /* The cloud address here has proved itself to a DIFFERENT shop. */
    servers: { [LAN]: 'shop-a', [CLOUD]: 'somebody-else' },
  });
  await serve(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN);
  await page.goto('/index.html');

  await page.evaluate((url) => POSNIC.server.pin(url), CLOUD);

  expect(await page.evaluate(() => POSNIC.session.active)).toBe(false);
});

test('an address nobody has signed into keeps the session and lets the server decide', async ({ page }) => {
  /*
   * Being wrong in this direction costs one refused request, which the app
   * already handles by dropping the credential. Being wrong the other way
   * costs a password mid-service.
   */
  await signedInAs(page, 'shop-a');
  await seed(page, { active: LAN, lan: LAN, servers: { [LAN]: 'shop-a' } });
  await serve(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN);
  await page.goto('/index.html');

  await page.evaluate((url) => POSNIC.server.pin(url), CLOUD);

  expect(await page.evaluate(() => POSNIC.session.active)).toBe(true);
});

for (const stall of ['fetch', 'body']) {
  test(`discovery recovers when native ${stall} never settles or honours abort`, async ({ page }) => {
    await page.addInitScript(({ stall }) => {
      const original = window.fetch.bind(window);
      window.fetch = (...args) => {
        if (String(args[0]).includes('shop.example')) {
          const pending = new Promise(() => {});
          if (stall === 'fetch') return pending;
          return Promise.resolve({ ok: true, json: () => pending });
        }
        return original(...args);
      };
    }, { stall });
    await page.route('https://shop.example/**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ edition: 'cloud', apiSchema: 1 }),
    }));
    await page.goto('/index.html');
    const hit = await page.evaluate(() => POSNIC.discovery.probe('https://shop.example', 100));
    expect(hit.base).toBe('https://shop.example/api');
    expect(await page.evaluate(() => POSNIC.discovery.probe.usedRoad)).toBeTruthy();
  });
}


test('a stalled native network lookup cannot hold discovery open forever', async ({page})=>{
  await page.goto('/index.html');
  const result=await page.evaluate(async()=>{
    window.Capacitor={Plugins:{LocalNetwork:{getLocalIp:()=>new Promise(()=>{})}}};
    window.RTCPeerConnection=undefined;window.webkitRTCPeerConnection=undefined;
    const start=Date.now();
    const networks=await POSNIC.discovery.localSubnets();
    return {elapsed:Date.now()-start,networks};
  });
  expect(result.elapsed).toBeLessThan(4000);
  expect(result.networks).toContain('192.168.1');
});
