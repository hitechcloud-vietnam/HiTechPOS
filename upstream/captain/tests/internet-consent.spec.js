import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
test('Wi-Fi fallback explains delay, waits for consent and does not repeatedly prompt after refusal',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{
  POSNIC.server.pin('http://192.168.1.20:5555/api');
  window.switchResult=undefined;
  POSNIC.internetChoice.ask('https://smoke.posnic.io/api').then(v=>window.switchResult=v);
 });
 await expect(page.locator('#captain-internet-consent')).toBeVisible();
 await expect(page.locator('#captain-internet-consent')).toContainText('Orders may reach the kitchen more slowly');
 expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toContain('192.168.1.20');
 await page.getByRole('button',{name:'Stay on Wi-Fi',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.switchResult)).toBe(false);
 expect(await page.evaluate(()=>POSNIC.internetChoice.ask('https://smoke.posnic.io/api'))).toBe(false);
 await expect(page.locator('#captain-internet-consent')).toHaveCount(0);
 await page.locator('#captain-internet-choice').click();
 await expect(page.locator('#captain-internet-consent')).toBeVisible();
 await page.screenshot({path:'test-artifacts/internet-switch-consent.png'});
 await page.getByRole('button',{name:'Switch to internet',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>POSNIC.internetChoice.allowed('https://smoke.posnic.io/api'))).toBe(true);
});
