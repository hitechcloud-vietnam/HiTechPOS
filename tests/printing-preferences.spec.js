import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';

for(const [width,language] of [[320,'ta'],[800,'ar']]) {
  test(`printer guidance preserves settings navigation offline at ${width}px in ${language}`,async({page})=>{
    await page.addInitScript(code=>localStorage.setItem('posnic.language',code),language);
    await page.setViewportSize({width,height:900});
    await onTheMenu(page,'nothing');
    await page.evaluate(()=>localStorage.setItem('printing-draft','keep'));
    await page.route('https://smoke.posnic.io/api/**',route=>route.abort());
    await page.goto('/me.html#preferences');
    await page.locator('a[href="#printers"]').click();
    const panel=page.locator('[data-me-page=printers]');
    await expect(panel).toBeVisible();
    await expect(page.locator('.me-title')).toHaveText(await page.evaluate(()=>I18N.t('Printing')));
    await expect(panel.locator('.me-printer-info .me-note')).toHaveText(Array(2).fill(await page.evaluate(()=>I18N.t('Managed on desktop POS'))));
    await expect(panel.locator('input,select')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-artifacts/printing-${language}-${width}.png`,fullPage:true});
    await page.goBack();
    await expect(page.locator('[data-me-page=preferences]')).toBeVisible();
    await page.locator('a[href="#printers"]').click();
    await page.reload();
    await expect(panel).toBeVisible();
    await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
    await expect(page).toHaveURL(/#preferences$/);
    await expect(page.locator('a[href="#printers"]')).toBeFocused();
    expect(await page.evaluate(()=>localStorage.getItem('printing-draft'))).toBe('keep');
    await page.locator('a[href="#printers"]').click();
    await panel.locator('a[href="kot-management.html"]').click();
    await expect(page).toHaveURL(/kot-management.html$/);
  });
}
