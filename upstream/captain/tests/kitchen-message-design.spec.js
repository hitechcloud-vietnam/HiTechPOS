import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";
for (const width of [320, 900])
  test(`kitchen voice uses shared design and preserves a recording on Back at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ colorScheme: "dark" });
    await onTheMenu(page, "nothing");
    let statusCalls = 0;
    await page.route("**/captain/v1/kitchen-audio/recordings",r=>r.fulfill({status:404,json:{message:"Not available"}}));
    await page.route("**/captain/v1/kitchen-audio/status", (route) => {
      statusCalls++;
      return route.fulfill({
        json: {
          jobs: [
            {
              id: "old",
              complete: true,
              targets: [{ label: "Kitchen <main>", status: "completed" }],
            },
          ],
        },
      });
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
        },
      });
      window.MediaRecorder = class {
        constructor() {
          this.state = "inactive";
          this.mimeType = "audio/webm";
        }
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          setTimeout(() => {
            this.ondataavailable({
              data: new Blob(["voice"], { type: "audio/webm" }),
            });
            this.onstop();
          }, 100);
        }
      };
    });
    await page.goto("/kitchen-message.html");
    await expect(page.locator(".voice-history-item")).toContainText(
      "Kitchen <main>",
    );
    await expect(page.locator(".voice-history-item main")).toHaveCount(0);
    await page.locator("#voice-refresh").click();
    await expect.poll(() => statusCalls).toBe(2);
    await page.locator("#voice-record").click();
    await expect(page.locator("#voice-status")).toHaveText("Recording…");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("captain:back", { cancelable: true })),
    );
    await expect(page).toHaveURL(/kot-management.html$/);
    await page.goto("/kitchen-message.html");
    await expect(page.locator("#voice-status")).toHaveText(
      "Voice note saved on this phone",
    );
    await expect(page.locator("#voice-send")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-artifacts/kitchen-voice-${width}.png`,
      fullPage: true,
    });
    await page.locator("#voice-discard").click();
    await expect(page.locator("#voice-record")).toBeVisible();
    const mic=page.locator('#voice-record');await mic.scrollIntoViewIfNeeded();
    const box=await mic.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();
    await expect(page.locator('#voice-composer')).toHaveAttribute('data-recording','true');
    await page.mouse.up();await expect(page.locator('#voice-play')).toBeVisible();
    await page.locator('#voice-discard').click();
    await page.mouse.move(x,y);await page.mouse.down();
    await expect(page.locator('#voice-composer')).toHaveAttribute('data-recording','true');
    await page.mouse.move(x-85,y);await expect(page.locator('#voice-status')).toHaveText('Release to discard');
    await page.mouse.up();await expect(page.locator('#voice-composer')).toHaveAttribute('data-has-recording','false');await expect(mic).toBeEnabled();
    const lockedBox=await mic.boundingBox(),lx=lockedBox.x+lockedBox.width/2,ly=lockedBox.y+lockedBox.height/2;
    await page.mouse.move(lx,ly);await page.mouse.down();
    await expect(page.locator('#voice-composer')).toHaveAttribute('data-recording','true');
    await page.mouse.move(lx,ly-85);await expect(page.locator('#voice-status')).toHaveText('Recording locked · Tap to pause');
    await page.mouse.up();await expect(page.locator('#voice-composer')).toHaveAttribute('data-recording','true');
    await mic.click();await expect(page.locator('#voice-play')).toBeVisible();await page.locator('#voice-discard').click();
    await page.locator(".me-back").click();
    await expect(page).toHaveURL(/kot-management.html$/);
  });

test('saved voice messages replay after reload without sending again',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await onTheMenu(page,'nothing');
 await page.route('**/captain/v1/kitchen-audio/status',r=>r.fulfill({status:503,json:{message:'Local speaker unavailable'}}));
 await page.route('**/captain/v1/kitchen-audio/recordings',r=>r.fulfill({json:{recordings:[{id:'saved-voice',created:'2026-10-04T08:00:00Z',duration:4000,storage:'cloud'}]}}));
 const wav=Buffer.alloc(44+64000);wav.write('RIFF',0);wav.writeUInt32LE(64036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(64000,40);
 let plays=0;await page.route('**/captain/v1/kitchen-audio/playback',r=>{plays++;return r.fulfill({json:{data:'data:audio/wav;base64,'+wav.toString('base64')}});});
 await page.goto('/kitchen-message.html');await expect(page.locator('.voice-history-play')).toBeVisible();
 await expect(page.locator('.voice-history-play')).toHaveCSS('background-color','rgb(37, 211, 102)');
 await page.locator('.voice-history-play').click();await expect.poll(()=>plays).toBe(1);await expect.poll(()=>page.locator('.voice-history-item audio').evaluate(a=>!a.paused && a.duration===2)).toBe(true);
 await page.reload();await page.locator('.voice-history-play').click();await expect.poll(()=>plays).toBe(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-artifacts/voice-message-replay-dark.png'});
});
