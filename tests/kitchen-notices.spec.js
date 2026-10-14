import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

test('ready notices reach the ordering Captain, retain the draft, and do not repeat', async ({page}) => {
  await onTheMenu(page, 'nothing');
  await page.evaluate(() => {
    window.readyToneCount = 0;
    window.AudioContext = class {
      constructor() { window.readyToneCount++; this.currentTime = 0; }
      resume() { return Promise.resolve(); }
      createOscillator() { return {frequency:{value:0},connect(){},start(){},stop(){}}; }
      createGain() { return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}; }
    };
    CaptainPhone.set('sound', false);
  });
  const data = {actor:'me',scope:'shop:branch:me',tickets:[
    {id:'sale:c0',owner:'me',table:'4',items:[{id:'fish',name:'Fish',ready:2,served:0,collected:0,readyVersion:1}]},
    {id:'other:c0',owner:'other',table:'8',items:[{id:'rice',name:'Rice',ready:1,served:0,readyVersion:1}]},
  ]};
  await page.evaluate(() => { localStorage.setItem('captain-notice-test-draft', 'keep'); });
  await page.evaluate(data => CaptainKitchenNotices.consume(data), data);
  const notice=page.locator('.kitchen-ready-notice');
  await expect(notice).toContainText('Table 4: 2 × Fish');
  await expect(notice).not.toContainText('Rice');
  expect(await page.evaluate(() => window.readyToneCount)).toBe(0);
  await expect(notice.getByRole('link',{name:'View'})).toHaveAttribute('href','kot-management.html?filter=ready');
  await notice.getByRole('button',{name:'Close'}).click();
  await page.evaluate(data => CaptainKitchenNotices.consume(data), data);
  await expect(notice).toHaveCount(0);
  data.tickets[0].items[0].readyVersion = 2;
  data.tickets[0].items[0].ready = 3;
  await page.evaluate(() => CaptainPhone.set('sound', true));
  await page.evaluate(data => CaptainKitchenNotices.consume(data), data);
  await expect(notice).toContainText('3 × Fish');
  expect(await page.evaluate(() => window.readyToneCount)).toBe(1);
  await expect(page).toHaveURL(/products.html/);
  expect(await page.evaluate(() => localStorage.getItem('captain-notice-test-draft'))).toBe('keep');
});

test('takeaway notices have full number; already collected items do not notify', async ({page}) => {
  await onTheMenu(page, 'nothing');
  const data={actor:'me',scope:'shop:branch:me',tickets:[{id:'parcel:c0',owner:'me',takeaway:true,orderNumber:'104',items:[{id:'dish',name:'Rice',ready:1,collected:1,served:0,readyVersion:1}]}]};
  await page.evaluate(data => CaptainKitchenNotices.consume(data),data);
  await expect(page.locator('.kitchen-ready-notice')).toHaveCount(0);
  data.tickets[0].items[0].ready=2;
  await page.evaluate(data => CaptainKitchenNotices.consume(data),data);
  await expect(page.locator('.kitchen-ready-notice')).toContainText('Take Away 104: 1 × Rice');
});
