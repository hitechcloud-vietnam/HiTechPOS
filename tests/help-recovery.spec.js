import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
test('an outage cannot cover settings or prevent reaching recovery and saved orders',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.goto('/me.html');
 await expect(page.locator('a[href="help.html"]')).toBeVisible();
 await page.evaluate(()=>POSNIC.net.setOffline());
 await expect(page.locator('#posnic-offline')).not.toBeVisible();
 await page.locator('a[href="help.html"]').click();
 await expect(page.locator('#help-retry')).toBeEnabled();
 await expect(page.locator('#help-status')).toHaveText('Connected over the internet');
 await page.evaluate(()=>{POSNIC.net.check=async()=>{POSNIC.net.setOffline();return false;};localStorage.setItem('help-test-cart','keep');});
 await page.locator('#help-retry').click();
 await expect(page.locator('#help-status')).toHaveText('Not connected');
 await expect(page.locator('#help-retry')).toBeEnabled();
 await expect(page.locator('#posnic-offline')).not.toBeVisible();
 await page.locator('#help-pending').click();
 await page.locator('#pending-back').click();
 await expect(page).toHaveURL(/help.html$/);
 await page.locator('#help-back').click();
 await expect(page).toHaveURL(/me.html$/);
 expect(await page.evaluate(()=>localStorage.getItem('help-test-cart'))).toBe('keep');
});
test('a session check that returns false is never described as connected',async({page})=>{
 await onTheMenu(page,'nothing');await page.goto('/help.html');
 await expect(page.locator('#help-retry')).toBeEnabled();
 await page.evaluate(()=>{POSNIC.net.check=async()=>false;});
 await page.locator('#help-retry').click();
 await expect(page.locator('#help-status')).toHaveText('Not connected');
 await page.locator('#help-server').click();
 await expect(page).toHaveURL(/index.html$/);
});


test('an old address check cannot confirm a newly selected server',async({page})=>{
 await onTheMenu(page,'nothing');await page.goto('/help.html');
 await expect(page.locator('#help-status')).toHaveText('Connected over the internet');
 await page.evaluate(()=>{POSNIC.net.check=()=>new Promise(resolve=>{window.finishOldCheck=resolve;});});
 await page.locator('#help-retry').click();
 await expect(page.locator('#help-status')).toHaveText('Checking');
 await page.evaluate(()=>POSNIC.server.adopt('http://192.168.1.20:5555/api'));
 await expect(page.locator('#help-address')).toHaveText('http://192.168.1.20:5555/api');
 await expect(page.locator('#help-status')).toHaveText('Not connected');
 await expect(page.locator('#help-retry')).toBeEnabled();
 await page.evaluate(()=>window.finishOldCheck(true));
 await expect(page.locator('#help-status')).toHaveText('Not connected');
 await page.evaluate(()=>{POSNIC.net.check=async()=>true;});
 await page.locator('#help-retry').click();
 await expect(page.locator('#help-status')).toHaveText('Connected in the shop');
});

test('a late failed check cannot erase a new server connection',async({page})=>{
 await onTheMenu(page,'nothing');await page.goto('/help.html');
 await expect(page.locator('#help-retry')).toBeEnabled();
 await page.evaluate(()=>{POSNIC.net.check=()=>new Promise((resolve,reject)=>{window.failOldCheck=reject;});});
 await page.locator('#help-retry').click();
 await page.evaluate(()=>{POSNIC.server.adopt('http://192.168.1.21:5555/api');POSNIC.net.check=async()=>true;});
 await page.locator('#help-retry').click();
 await expect(page.locator('#help-status')).toHaveText('Connected in the shop');
 await page.evaluate(()=>window.failOldCheck(new Error('old request failed')));
 await expect(page.locator('#help-status')).toHaveText('Connected in the shop');
 await expect(page.locator('#help-retry')).toBeEnabled();
});

test('a stalled recovery unlocks retry and its late response cannot finish a newer check',async({page})=>{
 await onTheMenu(page,'nothing');await page.goto('/help.html');
 await expect(page.locator('#help-status')).toHaveText('Connected over the internet');
 await page.clock.install();
 await page.evaluate(()=>{POSNIC.net.check=()=>new Promise(resolve=>{window.finishTimedOutCheck=resolve;});});
 await page.locator('#help-retry').click();
 await expect(page.locator('#help-status')).toHaveText('Checking');
 await page.clock.fastForward(20001);
 await expect(page.locator('#help-status')).toHaveText('Not connected');
 await expect(page.locator('#help-retry')).toBeEnabled();
 await page.evaluate(()=>{POSNIC.net.check=()=>new Promise(resolve=>{window.finishNewCheck=resolve;});});
 await page.locator('#help-retry').click();
 await page.evaluate(()=>window.finishTimedOutCheck(true));
 await expect(page.locator('#help-status')).toHaveText('Checking');
 await expect(page.locator('#help-retry')).toBeDisabled();
 await page.evaluate(()=>window.finishNewCheck(true));
 await expect(page.locator('#help-status')).toHaveText('Connected over the internet');
 await expect(page.locator('#help-retry')).toBeEnabled();
 await page.locator('#help-back').click();
 await expect(page).toHaveURL(/me.html$/);
});
