import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
async function open(page) {
  await onTheMenu(page,'nothing');
  await page.route('**/captain/v1/profile', async route=>route.fulfill({json:{id:'user-1',name:route.request().method()==='POST'?route.request().postDataJSON().name:'Staff',email:'staff@example.test',phone:'+919000000000'}}));
  await page.goto('/me.html#account');
}
test('profile edits persist through the API and Back returns to the account page',async({page})=>{
  await open(page);await page.locator('#me-profile').click();
  await expect(page.locator('#profile-name')).toHaveValue('Staff');
  await page.locator('#profile-name').fill('Floor captain');
  await page.locator('#profile-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Saved');
  await page.locator('#me-back').click();
  await expect(page.locator('#me-who')).toHaveText('Floor captain');
  await expect(page.locator('#me-password')).toBeVisible();
});

test('stalled profile loading offers retry and ignores an expired response',async({page})=>{
  await open(page);
  await page.clock.install();
  await page.evaluate(()=>{POSNIC.api.get=()=>new Promise(resolve=>{window.finishOldProfile=resolve;});});
  await page.locator('#me-profile').click();
  await expect(page.locator('.profile-page [role=status]')).toHaveText('Loading...');
  await page.clock.fastForward(20001);
  await expect(page.locator('[data-profile-retry]')).toBeVisible();
  await page.evaluate(()=>{POSNIC.api.get=async()=>({id:'user-1',name:'Current staff',email:'staff@example.test'});});
  await page.locator('[data-profile-retry]').click();
  await expect(page.locator('#profile-name')).toHaveValue('Current staff');
  await page.locator('#profile-name').fill('Unsaved name');
  await page.evaluate(()=>window.finishOldProfile({id:'user-1',name:'Old name'}));
  await expect(page.locator('#profile-name')).toHaveValue('Unsaved name');
});

test('Back leaves a loading profile and its late response cannot replace the password screen',async({page})=>{
  await open(page);
  await page.evaluate(()=>{POSNIC.api.get=()=>new Promise(resolve=>{window.finishOldProfile=resolve;});});
  await page.locator('#me-profile').click();
  await page.locator('#me-back').click();
  await expect(page.locator('#me-password')).toBeVisible();
  await page.locator('#me-password').click();
  await page.locator('#currentPassword').fill('Keep this draft');
  await page.evaluate(()=>window.finishOldProfile({id:'user-1',name:'Old name'}));
  await expect(page.locator('#currentPassword')).toHaveValue('Keep this draft');
  await expect(page.locator('#profile-name')).toHaveCount(0);
});
test('password validation preserves typing and a successful change keeps saved orders on the phone',async({page})=>{
  await open(page);const posts=[];
  await page.route('**/captain/v1/password',route=>{posts.push(route.request().postDataJSON());return route.fulfill({json:{saved:true,reauthenticate:true}})});
  await page.evaluate(()=>localStorage.setItem('profile-test-preserved','saved-order'));
  await page.locator('#me-password').click();
  await page.locator('#currentPassword').fill('old-secret-123');
  await page.locator('#newPassword').fill('new-secret-123');
  await page.locator('#confirmPassword').fill('mismatch');
  await page.locator('#profile-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toContainText('repeat');expect(posts).toHaveLength(0);
  await expect(page.locator('#newPassword')).toHaveValue('new-secret-123');
  await page.locator('#confirmPassword').fill('new-secret-123');
  await page.locator('#profile-form button[type=submit]').click();
  await expect(page).toHaveURL(/index.html/);
  expect(posts).toHaveLength(1);
  expect(await page.evaluate(()=>localStorage.getItem('profile-test-preserved'))).toBe('saved-order');
});

for (const action of ['header', 'cancel', 'native', 'browser']) {
  test(`unsaved profile survives declined ${action} Back`, async ({page}) => {
    await open(page);
    await page.locator('#me-back').click();
    await page.locator('a[href="#account"]').click();
    await page.locator('#me-profile').click();
    await page.locator('#profile-name').fill('Unsaved captain');
    const leave = async () => {
      if (action === 'header') await page.locator('#me-back').click();
      else if (action === 'cancel') await page.locator('[data-profile-back]').click();
      else if (action === 'native') await page.evaluate(() => window.dispatchEvent(new Event('captain:back', {cancelable:true})));
      else await page.goBack();
    };
    await leave();
    await expect(page.locator('#captain-discard h2')).toHaveText('Discard changes?');
    await page.locator('#captain-discard [data-confirm-action=keep]').click();
    await expect(page.locator('#profile-name')).toHaveValue('Unsaved captain');
    await expect(page.locator('.me-title')).toHaveText('Profile details');
    await expect(page).toHaveURL(/#account$/);
    // Use the visible Back button after a declined browser history traversal.
    await page.locator('#me-back').click();
    await page.locator('#captain-discard [data-confirm-action=discard]').click();
    await expect(page.locator('#me-password')).toBeVisible();
  });
}

test('failed password save preserves the draft and cancel requires confirmation', async ({page}) => {
  await open(page);
  await page.route('**/captain/v1/password', route => route.fulfill({status:400,json:{message:'incorrect'}}));
  await page.locator('#me-password').click();
  await page.locator('#currentPassword').fill('wrong-secret');
  await page.locator('#newPassword').fill('new-secret-123');
  await page.locator('#confirmPassword').fill('new-secret-123');
  await page.locator('#profile-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('The current password is incorrect.');
  await page.locator('#me-back').click();
 await page.locator('#captain-discard [data-confirm-action=keep]').click();
  await expect(page.locator('#newPassword')).toHaveValue('new-secret-123');
  await page.locator('[data-profile-back]').click();
 await page.locator('#captain-discard [data-confirm-action=discard]').click();
  await expect(page.locator('#me-password')).toBeVisible();
});


async function phoneScreen(page) {
  await open(page);
  await page.locator('#me-profile').click();
  await page.locator('#profile-name').fill('Draft name');
  await page.locator('[data-profile-phone]').click();
  await page.locator('#phone-password').fill('staff-password');
}
const challenge = {challenge:'phone-challenge',expiresAt:'2099-01-01T00:00:00Z',retryAfter:60};

test('phone verification saves only after confirmation and preserves the name draft', async ({page}) => {
  await phoneScreen(page);
  const posts=[];
  await page.route('**/captain/v1/profile/phone/*', route => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({json:route.request().url().endsWith('/start') ? challenge : {saved:true,phone:'+919111111111'}});
  });
  await page.locator('#phone-number').fill('+91 91111 11111');
  await page.locator('[data-phone-send]').click();
  await expect(page.locator('#phone-code')).toBeVisible();
  await expect(page.locator('[data-phone-resend]')).toBeDisabled();
  await page.locator('#phone-code').fill('012345');
  await page.locator('#phone-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Saved');
  await expect(page.locator('#profile-name')).toHaveValue('Draft name');
  await expect(page.locator('.profile-detail').last()).toContainText('+919111111111');
  expect(posts).toEqual([{phone:'+919111111111',currentPassword:'staff-password'},{challenge:'phone-challenge',code:'012345'}]);
});

test('expired code can be resent, invalid code keeps typing, and native Back steps out', async ({page}) => {
  await phoneScreen(page);
  let starts=0, verifies=0;
  await page.route('**/captain/v1/profile/phone/*', route => {
    if(route.request().url().endsWith('/start')) { starts++; return route.fulfill({json:challenge}); }
    verifies++;
    return route.fulfill({status:verifies===1?400:409,json:{message:'Invalid'}});
  });
  await page.locator('#phone-number').fill('+919111111111');
  await page.locator('[data-phone-send]').click();
  await page.locator('#phone-code').fill('123456');
  await page.locator('#phone-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Check the verification code.');
  await expect(page.locator('#phone-code')).toHaveValue('123456');
  await page.locator('#phone-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Request a new verification code.');
  await page.locator('[data-phone-resend]').click();
  await expect.poll(()=>starts).toBe(2);
  await expect(page.locator('#phone-code')).toHaveValue('');
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('#phone-number')).toHaveValue('+919111111111');
  await page.locator('[data-profile-back]').click();
  await expect(page.locator('#profile-name')).toHaveValue('Draft name');
  await expect(page.locator('.profile-detail').last()).toContainText('+919000000000');
});

for(const status of [400,404,503]) test(`phone start failure ${status} preserves the number`,async({page})=>{
  await phoneScreen(page);
  await page.route('**/captain/v1/profile/phone/start',route=>route.fulfill({status,json:{message:'Unavailable'}}));
  await page.locator('#phone-number').fill('+919111111111');
  await page.locator('[data-phone-send]').click();
  await expect(page.locator('#profile-message')).toContainText(status===400?'current password is incorrect':status===404?'too old':'SMS settings');
  await expect(page.locator('#phone-number')).toHaveValue('+919111111111');
  await expect(page.locator('[data-phone-send]')).toBeEnabled();
});


for (const width of [320,768]) test(`phone change fits ${width}px and clears password when leaving`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await phoneScreen(page);
  await expect(page.locator('#phone-password')).toHaveAttribute('autocomplete','current-password');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('[data-profile-back]').click();
  await page.locator('[data-profile-phone]').click();
  await expect(page.locator('#phone-password')).toHaveValue('');
  await expect(page.locator('#phone-number')).toHaveValue('+919000000000');
});


test('Back resumes an existing phone code without another SMS and changing number respects cooldown',async({page})=>{
  await phoneScreen(page);
  let sends=0;
  await page.route('**/captain/v1/profile/phone/start',route=>{sends++;return route.fulfill({json:challenge});});
  await page.locator('#phone-number').fill('+919111111111');
  await page.locator('[data-phone-send]').click();
  await page.locator('#phone-code').fill('123');
  await page.locator('[data-profile-back]').click();
  await expect(page.locator('[data-phone-send]')).toHaveText('Continue');
  await expect(page.locator('[data-phone-send]')).toBeEnabled();
  await page.locator('#phone-number').fill('+919222222222');
  await expect(page.locator('[data-phone-send]')).toBeDisabled();
  await expect(page.locator('[data-phone-send]')).toContainText('Send verification code');
  await page.locator('#phone-number').fill('+91 91111 11111');
  await page.locator('[data-phone-send]').click();
  await expect(page.locator('#phone-code')).toHaveValue('123');
  expect(sends).toBe(1);
});


async function emailScreen(page) {
  await open(page);
  await page.locator('#me-profile').click();
  await page.locator('#profile-name').fill('Draft name');
  await page.locator('[data-profile-email]').click();
  await page.locator('#phone-password').fill('staff-password');
}
test('email change verifies normalized address and retains profile name draft',async({page})=>{
  await emailScreen(page);
  const posts=[];
  await page.route('**/captain/v1/profile/email/*',route=>{
    posts.push(route.request().postDataJSON());
    return route.fulfill({json:route.request().url().endsWith('/start')?challenge:{saved:true,email:'new@example.test'}});
  });
  await expect(page.locator('#phone-number')).toHaveAttribute('type','email');
  await page.locator('#phone-number').fill('NEW@EXAMPLE.TEST');
  await page.locator('[data-phone-send]').click();
  await page.locator('#phone-code').fill('123456');
  await page.locator('[data-profile-back]').click();
  await page.locator('[data-phone-send]').click();
  await expect(page.locator('#phone-code')).toHaveValue('123456');
  await page.locator('#phone-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Saved');
  await expect(page.locator('.profile-detail').first()).toContainText('new@example.test');
  await expect(page.locator('#profile-name')).toHaveValue('Draft name');
  expect(posts).toEqual([{email:'new@example.test',currentPassword:'staff-password'},{challenge:'phone-challenge',code:'123456'}]);
});
for (const status of [409,503]) test(`email failure ${status} preserves original profile and editable draft`,async({page})=>{
  await emailScreen(page);
  await page.route('**/captain/v1/profile/email/start',route=>route.fulfill({status,json:{message:'failure'}}));
  await page.locator('#phone-number').fill('new@example.test');
  await page.locator('[data-phone-send]').click();
  await expect(page.locator('#profile-message')).toContainText(status===409?'unavailable':'email settings');
  await expect(page.locator('#phone-number')).toHaveValue('new@example.test');
  await page.locator('[data-profile-back]').click();
  await expect(page.locator('.profile-detail').first()).toContainText('staff@example.test');
  await expect(page.locator('#profile-name')).toHaveValue('Draft name');
});


for (const [width,language] of [[320,'ta'],[768,'ar']]) test(`contact screens fit ${width}px in ${language}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await open(page);
  await page.evaluate(language=>I18N.use(language),language);
  await page.route('**/captain/v1/profile',route=>route.fulfill({json:{id:'user-1',name:'Staff',email:'restaurant.floor.supervisor.with.long.address@example.test',phone:'+919000000000'}}));
  await page.reload();
  await page.locator('#me-profile').click();
  await expect(page.locator('[data-profile-email]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const row = await page.locator('.profile-detail').first().evaluate(el=>{
    const label=el.querySelector('span').getBoundingClientRect();
    const value=el.querySelector('strong').getBoundingClientRect();
    const button=el.querySelector('button').getBoundingClientRect();
    return {labelBottom:label.bottom,valueTop:value.top,buttonWidth:button.width,buttonHeight:button.height};
  });
  expect(row.valueTop).toBeGreaterThanOrEqual(row.labelBottom);
  expect(row.buttonWidth).toBeGreaterThanOrEqual(88);
  expect(row.buttonHeight).toBeGreaterThanOrEqual(48);
  await page.screenshot({path:`test-artifacts/profile-${language}-${width}.png`,fullPage:true});
  await page.locator('[data-profile-email]').click();
  await expect(page.locator('#phone-number')).toHaveAttribute('dir','ltr');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-artifacts/email-${language}-${width}.png`,fullPage:true});
});
