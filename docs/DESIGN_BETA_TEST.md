# Mobile design test build

The current control-by-control audit is [Mockup implementation checklist](MOCKUP_IMPLEMENTATION_CHECKLIST.md). It covers both approved galleries, their linked screens and desktop settings.

Use mobile **0.3.0-beta.9** with desktop **1.8.5-beta.6**. See the release's TEST-GUIDE.md for installation and shop tests. The desktop is the same verified installer supplied with mobile beta8; beta9 changes mobile only.

Test the favourites star without adding an item, switch to Favourites, restart, and sell from that list offline. Favourites belong to the cashier and branch. Verify Offline Data counts all downloaded thumbnails, not just the current catalogue page.

Then test the complete shift: pair → PIN → catalogue/scan/quick sale → customer → cash or staff-confirmed UPI → direct receipt → disconnect/restart → reconnect/sync → history and cloud status. Test pending-sale protection when switching users. Desktop settings are under Settings → Mobile POS; branch UPI accounts are under Branch payments, and paired phones under Devices.

Android direct printing supports Bluetooth Classic SPP and USB printer-class ESC/POS, with opt-in drawer pulse for the first cash receipt. System printing and Till printing remain separate routes. Physical hardware testing is still required. Card acquiring, automatic bank verification and iOS direct Bluetooth/USB are not claimed by this release.
