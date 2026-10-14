import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";

test('a payment conflict shows the server reason without claiming the server is offline', async ({ page }) => {
  await onTheMenu(page, 'nothing');
  await page.goto('/kot-management.html');
  await page.waitForFunction(() => !!window.CaptainPayments);
  await page.route('**/captain/v1/payments/table', r => r.fulfill({ status: 409, json: { error: { message: 'Refresh the table payment details.' } } }));
  await page.evaluate(() => CaptainPayments.open('6'));
  await expect(page.locator('#captain-payments')).toContainText('Refresh the table payment details.');
  await expect(page.locator('#captain-payments')).not.toContainText('Connect to the shop server');
});

async function setup(page) {
  await onTheMenu(page, "nothing");
  await page.route("**/captain/v1/payment-options", (r) =>
    r.fulfill({ json: { enabled: true } }),
  );
  await page.goto("/kot-management.html");
  await page.waitForFunction(() => !!window.CaptainPayments);
  const plan = {
    id: "plan1",
    table: "T1",
    currency: "₹",
    totalMinor: 10001,
    paidMinor: 0,
    dueMinor: 10001,
    version: 0,
    enabled: true,
    mixedPayment: true,
    methods: ["Cash", "Card", "Upi"],
    upiPayee: { id: "captain-test@invalid", name: "Test Branch" },
    guests: [
      { name: "Guest 1", totalMinor: 5001, paid: false },
      { name: "Guest 2", totalMinor: 5000, paid: false },
    ],
    payments: [],
  };
  await page.route("**/captain/v1/payments/table", (r) =>
    r.fulfill({ json: plan }),
  );
  await page.route("**/captain/v1/payments/release", (r) =>
    r.fulfill({ json: { released: true } }),
  );
  await page.evaluate(() => CaptainPayments.open("T1"));
  await expect(page.locator("#cp-guest")).toBeVisible();
  return plan;
}
test('split payment is optional, validates totals and retries one combined journal request', async ({page}) => {
  await setup(page);
  await expect(page.locator('#cp-mixed')).not.toBeChecked();
  await page.locator('#cp-mixed').check();
  await page.locator('[data-tender="Cash"]').fill('40');
  await page.locator('[data-tender="Card"]').fill('50');
  await page.locator('[data-action="record"]').click();
  await expect(page.locator('.cp-error')).toContainText('Payment amounts must equal the bill.');
  await page.locator('[data-tender="Card"]').fill('60.01');
  await page.locator('#cp-verified').check();
  const posts=[];
  await page.route('**/captain/v1/payments/record', r => {
    const body = r.request().postDataJSON(); posts.push(body);
    return posts.length === 1 ? r.fulfill({status:503,json:{message:'unconfirmed'}}) : r.fulfill({json:{id:'plan1',confirmed:body.request_id,totalMinor:10001,dueMinor:0,methods:['Cash','Card','Upi'],guests:[],payments:[{...body,id:body.request_id,changeMinor:0}]}});
  });
  await page.locator('[data-action="record"]').click();
  await expect(page.locator('.cp-review').last()).toContainText('₹60.01');
  await page.locator('[data-action="record"]').click();
  await expect(page.locator('.cp-error')).toContainText('Retry this request');
  await page.locator('[data-action="record"]').click();
  await expect(page.locator('#captain-payments')).not.toBeVisible();
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0].method).toBe('Mixed');
  expect(posts[0].tenders.map(row=>[row.method,row.amountMinor])).toEqual([['Cash',4000],['Card',6001]]);
});

test('mixed payment keeps the selected guest visible in entry and review', async ({page}) => {
  await setup(page);
  await page.locator('#cp-guest').selectOption('0');
  await page.locator('#cp-mixed').check();
  await expect(page.locator('.cp-paying-guest')).toContainText('Guest 1');
  await expect(page.locator('.cp-balance')).toContainText('₹50.01');
  await page.locator('[data-tender="Cash"]').fill('20');
  await page.locator('[data-tender="Card"]').fill('30.01');
  await page.locator('#cp-verified').check();
  await page.locator('[data-action="record"]').click();
  await expect(page.locator('.cp-review').first()).toContainText('Guest 1');
  await expect(page.locator('.cp-review').first()).toContainText('Split payment');
  await page.locator('[data-action="back"]').click();
  await expect(page.locator('[data-tender="Card"]')).toHaveValue('30.01');
  await page.locator('#cp-mixed').uncheck();
  await expect(page.locator('#cp-guest')).toHaveValue('0');
});

test("guest cash payment shows change and updates remaining balance; card requires confirmation", async ({
  page,
}) => {
  const plan = await setup(page);
  const posts = [];
  await page.route("**/captain/v1/payments/record", (r) => {
    const p = r.request().postDataJSON();
    posts.push(p);
    plan.guests[0].paid = true;
    return r.fulfill({
      json: {
        ...plan,
        version: 1,
        paidMinor: 5001,
        dueMinor: 5000,
        confirmed: p.request_id,
      },
    });
  });
  await page.locator("#cp-guest").selectOption("0");
  await page.locator("#cp-received").fill("60");
  await expect(page.locator("#cp-change")).toHaveText("₹9.99");
  await page.screenshot({
    path: "test-artifacts/captain-cash-payment.png",
    fullPage: true,
  });
  await page.locator("#captain-payments [data-action=record]").click();
  expect(posts).toHaveLength(0);
  await expect(page.locator(".cp-review")).toContainText("₹9.99");
  await page.locator("#captain-payments [data-action=record]").click();
  await expect(page.locator(".cp-balance strong")).toHaveText("₹50.00");
  expect(posts[0].amountMinor).toBe(5001);
  expect(posts[0].receivedMinor).toBe(6000);
  await expect(page.locator(".cp-receipt")).toContainText("₹9.99");
  await page.locator("[data-action=continue]").click();
  await page.locator("[data-method=Card]").click();
  await page.locator("#captain-payments [data-action=record]").click();
  expect(posts).toHaveLength(1);
  await expect(page.locator(".cp-error")).toContainText("verified");
  await page.screenshot({
    path: "test-artifacts/captain-card-payment.png",
    fullPage: true,
  });
});
test("uncertain request persists across closing and retries the same payment identifier", async ({
  page,
}) => {
  const plan = await setup(page);
  const posts = [];
  await page.route("**/captain/v1/payments/record", (r) => {
    posts.push(r.request().postDataJSON());
    return r.abort("failed");
  });
  await page.locator("#captain-payments [data-action=record]").click();
  expect(posts).toHaveLength(0);
  await page.locator("#captain-payments [data-action=record]").click();
  await expect(page.locator(".cp-error")).toContainText(
    "do not collect the money again",
  );
  await page.locator("#captain-payments footer [data-action=close]").click();
  await page.evaluate(() => CaptainPayments.open("T1"));
  await page.route("**/captain/v1/payments/record", (r) => {
    const body = r.request().postDataJSON();
    posts.push(body);
    return r.fulfill({
      json: {
        ...plan,
        dueMinor: 0,
        paidMinor: 10001,
        confirmed: body.request_id,
      },
    });
  });
  await page.locator("#captain-payments [data-action=record]").click();
  await expect(page.locator("#captain-payments")).not.toBeVisible();
  await expect(page.locator("#order-toast-message")).toContainText("Payment recorded");
  expect(
    posts.every((p) => JSON.stringify(p) === JSON.stringify(posts[0])),
  ).toBe(true);
});
test("cancel returns to active tables and releases an untouched payment draft", async ({
  page,
}) => {
  await setup(page);
  const requests = [];
  await page.route("**/captain/v1/payments/release", (r) => {
    requests.push(r.request().postDataJSON());
    return r.fulfill({ json: { released: true } });
  });
  await page.locator("#captain-payments footer [data-action=close]").click();
  await expect(page.locator("#captain-payments")).not.toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
});
test('enabled collection continues from split review without printing unpaid bills',async({page})=>{
 await setup(page);
 await page.locator('#captain-payments footer [data-action=close]').click();
 await page.route('**/sales/guestBills/table?**',r=>r.fulfill({json:{type:'success',data:{table:'T1',revision:'v1',currency:'₹',totalMinor:10001,guests:2,lines:[{id:'line1',name:'Soup',quantity:1,amountMinor:10001,components:[{key:'base',minor:10001}]}]}}}));
 const preparations=[];
 await page.route('**/captain/v1/payments/table',r=>{preparations.push(r.request().postDataJSON());return r.fulfill({json:{id:'p2',table:'T1',currency:'₹',totalMinor:10001,dueMinor:10001,paidMinor:0,version:0,enabled:true,methods:['Cash'],guests:[{name:'Guest 1',totalMinor:5001,paid:false},{name:'Guest 2',totalMinor:5000,paid:false}]}});});
 await page.evaluate(()=>GuestBills.open('T1'));
 await page.locator('#guest-bills [data-action=next]').click();
 await expect(page.locator('#guest-bills [data-action=next]')).toHaveText('Collect payment');
 await page.locator('#guest-bills [data-action=next]').click();
 await expect(page.locator('#captain-payments')).toBeVisible();
 expect(preparations[0].plan).toMatchObject({mode:'equal',guests:['Guest 1','Guest 2']});expect(preparations[0].revision).toBe('v1');
});
for (const code of ['ta','ur']) test(`payment controls fit a small ${code} phone`,async({page})=>{
 await page.addInitScript(code=>localStorage.setItem('posnic.language',code),code);
 await page.setViewportSize({width:320,height:740});await setup(page);
 expect(await page.locator('#captain-payments').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
 const box=await page.locator('#captain-payments [data-action=record]').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(740);
 const text=await page.locator('#captain-payments').innerText();expect(text).not.toContain('Amount received');
 await page.screenshot({path:`test-artifacts/captain-payment-${code}.png`,fullPage:true});
});


test("UPI QR encodes the exact full or guest amount and requires manual receipt confirmation", async ({ page }) => {
  const plan = await setup(page);
  const posts = [];
  await page.route("**/captain/v1/payments/record", r => {
    const body = r.request().postDataJSON(); posts.push(body);
    return r.fulfill({ json: { ...plan, dueMinor: 0, confirmed: body.request_id } });
  });
  await page.locator('[data-method="Upi"]').click();
  await page.addScriptTag({ path: "node_modules/jsqr/dist/jsQR.js" });
  const decode = () => page.evaluate(() => {
    const c = document.querySelector('#cp-qr canvas');
    const pixels = c.getContext('2d').getImageData(0,0,c.width,c.height);
    return jsQR(pixels.data,c.width,c.height)?.data;
  });
  let uri = new URL(await decode());
  expect(uri.searchParams.get('pa')).toBe('captain-test@invalid');
  expect(uri.searchParams.get('pn')).toBe('Test Branch');
  expect(uri.searchParams.get('am')).toBe('100.01');
  expect(uri.searchParams.get('cu')).toBe('INR');
  await page.locator('#cp-guest').selectOption('0');
  uri = new URL(await decode());
  expect(uri.searchParams.get('am')).toBe('50.01');
  await page.locator('[data-action="record"]').click();
  expect(posts).toHaveLength(0);
  await page.locator('#cp-verified').check();
  await page.locator('#cp-reference').fill('test-utr');
  await page.screenshot({path:'test-artifacts/captain-upi-qr.png',fullPage:true});
  await page.locator('[data-action="record"]').click();
  expect(posts).toHaveLength(0);
  await expect(page.locator(".cp-review")).toContainText("test-utr");
  await page.locator('[data-action="record"]').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].amountMinor).toBe(5001);
  expect(posts[0].upi).toEqual({...plan.upiPayee,verified:true});
  expect(posts[0].reference).toBe('test-utr');
});

test("UPI without branch details or with foreign currency cannot collect", async ({ page }) => {
  const plan = await setup(page);
  for (const patch of [{upiPayee:null},{upiPayee:{id:'test@invalid',name:'Test'},currencyCode:'USD'}]) {
    Object.assign(plan,patch);
    await page.locator('[data-action="close"]').first().click();
    await page.evaluate(() => CaptainPayments.open('T1'));
    await page.locator('[data-method="Upi"]').click();
    await expect(page.locator('#cp-qr')).toHaveCount(0);
    await expect(page.locator('[data-action="record"]')).toBeDisabled();
  }
});

test('payment review Back preserves entry and confirmation is blocked while saving',async({page})=>{
 const plan=await setup(page);const posts=[];let complete;
 await page.route('**/captain/v1/payments/record',async r=>{const body=r.request().postDataJSON();posts.push(body);await new Promise(resolve=>complete=resolve);return r.fulfill({json:{...plan,dueMinor:0,confirmed:body.request_id}});});
 await page.locator('#cp-received').fill('120');
 await page.locator('[data-action=record]').click();
 await expect(page.locator('.cp-review')).toContainText('₹19.99');expect(posts).toHaveLength(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(page.locator('#cp-received')).toHaveValue('120');
 await page.locator('[data-action=record]').click();
 await page.emulateMedia({colorScheme:'dark'});
 await page.screenshot({path:'test-artifacts/payment-review-dark.png',fullPage:true});
 await page.locator('[data-action=record]').click();
 await expect.poll(()=>posts.length).toBe(1);
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(page.locator('#captain-payments')).toBeVisible();
 await expect(page.locator('[data-action=record]')).toBeDisabled();
 complete();await expect(page.locator('#captain-payments')).toContainText('Payment recorded');
 await expect(page.locator('.cp-receipt')).toContainText('₹19.99');
 await page.locator('#captain-payments footer [data-action=close]').click();
 await expect(page.locator('#captain-payments')).not.toBeVisible();
 await expect(page.locator('#order-toast-message')).toContainText('Payment recorded');
});

test('confirmed full card payment returns to tables with a receipt toast', async ({page})=>{
 const plan=await setup(page);
 await page.route('**/captain/v1/payments/record',r=>{const body=r.request().postDataJSON();return r.fulfill({json:{...plan,dueMinor:0,paidMinor:plan.totalMinor,confirmed:body.request_id}});});
 await page.locator('[data-method=Card]').click();await page.locator('#cp-verified').check();
 await page.locator('[data-action=record]').click();await page.locator('[data-action=record]').click();
 await expect(page.locator('#captain-payments')).not.toBeVisible();
 await expect(page.locator('#order-toast-message')).toContainText('Payment recorded · ₹100.01 · Card');
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('posnic.payment:')))).toEqual([]);
});

for(const scenario of ['light','dark','partial','rejected','unconfirmed','reduced'])test(`gold payment celebration ${scenario}`,async({page})=>{
 await page.emulateMedia({colorScheme:scenario==='dark'?'dark':'light',reducedMotion:scenario==='reduced'?'reduce':'no-preference'});
 const plan=await setup(page);
 await page.route('**/captain/v1/payments/record',r=>{
  const body=r.request().postDataJSON();
  if(scenario==='rejected')return r.fulfill({status:503,json:{message:'Unavailable'}});
  return r.fulfill({json:{...plan,confirmed:scenario==='unconfirmed'?'wrong-id':body.request_id,paidMinor:body.amountMinor,dueMinor:scenario==='partial'?5000:0}});
 });
 if(scenario==='partial')await page.locator('#cp-guest').selectOption('0');
 await page.locator('#captain-payments [data-action=record]').click();
 await expect(page.locator('.cp-celebration')).toHaveCount(0);
 await page.locator('#captain-payments [data-action=record]').click();
 if(['rejected','unconfirmed'].includes(scenario)){
  await expect(page.locator('.cp-error')).toContainText('not confirmed');await expect(page.locator('.cp-celebration')).toHaveCount(0);
 }else if(scenario==='reduced'){
  await expect(page.locator('#captain-payments')).not.toBeVisible();await expect(page.locator('.cp-celebration')).toHaveCount(0);
 }else{
  const scene=page.locator('.cp-celebration');await expect(scene).toBeVisible();await expect(scene).toHaveCSS('pointer-events','none');
  if(scenario==='partial')await expect(page.locator('#captain-payments .cp-celebration')).toBeVisible();
  await scene.evaluate(el=>el.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=450;}));
  await page.screenshot({path:`test-artifacts/payment-gold-${scenario}.png`});
  await expect(scene).toHaveCount(0);
 }
});
