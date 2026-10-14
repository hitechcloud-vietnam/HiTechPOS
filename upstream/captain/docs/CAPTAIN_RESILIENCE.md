# Captain resilient delivery test build

## What changed

- Save each order before network activity, with a stable idempotency key and staff/shop/branch ownership. Storage failure retains the cart. Interrupted checkout is recovered from its held queue entry.
- Continue ordering from cached data during outages within the saved authorization period. The connection panel does not cover checkout controls.
- Deliver waiting orders sequentially; retry network, timeout, rate-limit and server failures with increasing delays. One flush runs at a time. Each successful server acknowledgement removes only that order.
- Pause access errors. Keep rejected orders visible with the actual reason and a deliberate per-order retry. Continue delivering other valid orders after a validation rejection.
- Prefer local connections and switch to a verified HTTPS address when necessary. Before sending bearer or renewal credentials, challenge the address using a proof key kept in the encrypted Android session. The server's local-only session is the delivery authority.
- Configure the HTTPS address on Settings → Devices → Captain App → Connection settings. Newly paired phones receive it immediately; existing compatible sessions receive it on renewal.

## Scope of internet fallback

The domain must reach the same issuing database. A separate cloud replica is not an interchangeable writer: separate unique indexes do not prevent duplicate kitchen tickets across databases. Such an address fails the proof and receives neither credentials nor orders. The app retains those orders until the issuing authority is reachable. This work does not provision a reverse proxy or introduce a cross-database cloud relay. Internet fallback must be tested with the shop's actual routing.

New secure route switching applies to Android manager-paired sessions. Web/iOS keep their legacy authentication. Legacy queues still require the original server and a server that advertises duplicate-safe orders; manual retry cannot bypass this requirement.

First setup needs a reachable server and a downloaded menu. Cached offline authorization remains bounded to 24 hours after successful pairing/renewal. Revoked or expired authorization is not bypassed to continue sales. Clearing app data/uninstalling removes unsent local orders.

## Test artifacts

- Android: `C:/Users/Kayal/captain-onboarding/test-builds/captain-access/Captain-1.2.37-resilience-test.apk`.
- Windows: `C:/Users/Kayal/POS/.worktrees/pos-captain-access/test-builds/captain-resilience/Posnic-1.8.0-captain-resilience-test-win-x64.zip`. Extract the whole archive and run `Posnic.exe` against a test shop.

## Phone acceptance checks

Automated validation: 540 Captain unit tests passed, including proof-gated failover after a lost order response, rejection handling, concurrent flush prevention, authorization pauses, corrupt/full storage and renewal regression. The 93-case discovery/onboarding/order browser run passed 92 checks; its remaining source assertion expected the removed request race. After updating that expectation, the affected test and order UI recheck passed. All 12 POS Captain integration tests passed, including real HTTP route proof, manager-only settings and the manager browser page. The 6 existing server idempotency checks passed. API lint, attribution and whitespace checks passed. The Android release signature was verified. Windows packaging and archive integrity passed; packaged Captain source matches the checkout and the 60-module packaging check passed.

These are development checks and fixtures, not evidence of real-phone or production-domain operation. Native Android lifecycle/camera/Keystore behavior and full interactive Windows startup remain to be checked with the test builds. Nothing was deployed.

Final UI recheck: all four checkout resilience browser cases passed after the panel layout and retry-button polish. The phone-sized pending-order screenshot was inspected. Android version code is 10237; APK SHA-256 is `36515DFE2F0030F2E0A61634A8C054BE22E91C4BE47ED702B57BADAA79EA53CE`. Captain evidence is in `resilience-*.log` and `test-artifacts/captain-pending-order.png`; Windows/API evidence is under `test-builds/captain-resilience/evidence` in the POS checkout.

1. Pair using the updated desktop, set a PIN and load the menu. Verify the internet address is configured before pairing.
2. Disconnect Wi-Fi/internet, take an order, close/reopen the app and unlock. Confirm gray saved orders and usable cached menu.
3. Reconnect. Confirm each order creates one ticket, then disappears from the waiting list only after acknowledgement.
4. Block the local route while leaving the configured domain reachable. Confirm automatic internet delivery to the same till and subsequent return to local preference after its cooldown.
5. Point the fallback at a different server. Confirm it receives only proof requests and no credentials or orders.
6. Revoke the phone, reject an item, and simulate full local storage. Verify access stops retrying, rejected orders show their reason, and storage failures keep the cart.

No deployment, merge or production-device test is implied by these artifacts.
