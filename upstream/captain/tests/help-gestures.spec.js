import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';

for (const [width,language] of [[320,'ta'],[800,'ar']]) {
  test(`gesture guide works offline and Back preserves the draft at ${width}px in ${language}`,async({page})=>{
    await page.addInitScript(code=>localStorage.setItem('posnic.language',code),language);
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({colorScheme:'dark'});
    await onTheMenu(page,'nothing');
    await page.evaluate(()=>localStorage.setItem('guide-draft','keep'));
    await page.goto('/help.html');
    await expect(page.locator('#help-retry')).toBeEnabled();
    await page.evaluate(()=>{POSNIC.net.check=async()=>false;});
    await page.locator('#help-retry').click();
    const guide=page.locator('#help-gestures'), summary=guide.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(guide).toHaveAttribute('open','');
    const labels=await page.evaluate(()=>['Using gestures','Pull down at the top of a list to refresh.','Swipe left or right on order details to change orders. Arrow buttons work too.','Use Back to return. Confirm before discarding unsaved changes.','Search by item name or code. Adding an item clears the search.'].map(key=>I18N.t(key)));
    await expect(summary).toHaveText(labels[0]);
    await expect(guide.locator('li')).toHaveText(labels.slice(1));
    expect(labels[0]).not.toBe('Using gestures');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-artifacts/help-gestures-${language}-${width}.png`,fullPage:true});
    await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
    await expect(guide).not.toHaveAttribute('open','');
    await expect(summary).toBeFocused();
    await expect(page).toHaveURL(/help.html$/);
    expect(await page.evaluate(()=>localStorage.getItem('guide-draft'))).toBe('keep');
    await page.locator('#help-back').click();
    await expect(page).toHaveURL(/me.html$/);
  });
}
