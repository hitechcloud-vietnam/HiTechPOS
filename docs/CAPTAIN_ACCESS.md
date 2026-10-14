# Captain setup and remembered access

This implementation is in the `codex/captain-remembered-access` checkout. It needs the matching POS Captain API. Secure pairing is implemented for Android; iOS and web retain their existing address/password login. Community setup does not require a Posnic account.

## First setup

On the till, open Settings → Devices → Captain App → Approve a Captain phone. Select the waiter and generate a QR/code. The approval expires after five minutes and can be claimed once. If the till has several addresses, the manager selects the address reachable on the phone’s Wi-Fi.

On Android, choose **Scan your till’s QR**. Captain verifies a challenge against the QR secret before sending the pairing code. The returned authorization fixes the phone to that staff member, licensed shop and branch. Choose a four-digit daily PIN. An old address QR only selects an address; it never authorizes a phone.

Other connection options contain Wi-Fi search, pairing code and manual address. Search lists every compatible result and requires selection. A code by itself cannot locate an arbitrary offline server: choose an address and confirm it with the manager first. Existing address normalization understands shop codes, domains, URLs and local addresses.

Wi-Fi search first checks remembered local addresses, preserving custom ports, then scans port 5555 near the phone's current address before the rest of that subnet. Results are deduplicated. You can select a result while scanning or cancel and retry; late responses cannot overwrite that choice. Wi-Fi address lookup stops waiting after three seconds, and the subsequent search stops after twenty seconds with retry/QR guidance. For an unknown custom port or a different subnet, use the manager QR or explicit address. Guest Wi-Fi isolation can prevent local discovery even when both devices show the same network name.

The separate cloud buttons open the system browser for login/signup and explicit Captain consent. Passwords stay in that browser. The account service uses proof-bound polling and a Captain-only gateway grant. The Android return link is `com.posnic.captain://authorized`. Cloud setup tries reported local addresses with proof verification, then the approved HTTPS shop address. This happens during setup only.

## Daily use and recovery

Open Captain → enter the PIN → use the cached menu. An ordinary offline unlock makes no network request. The offline authorization lasts 24 hours from pairing/renewal; after that, a bounded renewal is required. Unlock cannot extend server authorization by itself.

Access tokens last 15 minutes. A rotating renewal credential is kept in an Android Keystore AES-GCM encrypted file, together with the salted PBKDF2 PIN verifier and failure counter. Five wrong attempts require manager recovery. The native vault locks when the app pauses. Android backup is disabled. Neither renewal credentials nor passwords are written to localStorage.

Renewal expires after 30 days of inactivity and extends on successful rotation. Concurrent requests share one renewal. The successor is saved before transmission; the server permits an identical lost-response retry for 60 seconds and rejects a different successor. A longer interruption during that narrow rotation recovery window can require re-pairing. Revoking the handset, removing branch/staff permission, changing account authorization or disabling Captain stops authorized requests and renewal.

Existing token sessions move to the vault before plaintext storage is removed. An old PIN migrates after successful verification. Legacy sessions retain their original server expiry; use manager pairing to gain renewable access.

Failed login, sign-out and re-pairing preserve the pending-order queue. Orders retain the original staff, shop, server and branch; a different identity cannot send them. Queue saturation/storage failure returns failure so the cart is kept. Sign-out clears local credentials immediately and attempts server revocation when reachable; managers can revoke an offline phone from the till. Unidentifiable legacy orders are retained for manager recovery rather than reassigned automatically.

The resilience follow-up adds automatic switching between verified addresses of the issuing server. In the desktop Captain page, open Connection settings and save the HTTPS internet address for that till before pairing. The app prefers local addresses, temporarily deprioritizes a failing address, and verifies a fresh session-bound HMAC challenge before sending credentials or orders through any address. A public address must reach the same issuing database (for example through the shop's existing secure reverse proxy). An independent cloud replica cannot prove a local-only session and is not a safe duplicate-free fallback. When no verified address works, orders remain on the phone. Existing phones receive address changes at their next successful renewal; older sessions without the proof key need re-pairing.

Checkout now saves a stable order ID and complete payload before clearing its cart or attempting the network. Pending orders are gray and explicitly labelled as not sent to the kitchen. A held checkout is reconciled after interruption so it cannot be sent while its old cart remains active. Background delivery is serial and uses bounded exponential retry delays up to one minute. A rejected order is marked Needs attention and does not block later orders. Access errors pause automatic delivery until explicit retry/reconnection. Retry never bypasses server duplicate protection. A signed-in staff session sees a compact connection panel instead of a blocking outage overlay. Orders can only be taken while the saved authorization is valid.

This implementation uses the existing persistent browser storage/IndexedDB inside the installed app. Clearing app data or uninstalling still removes unsent local orders; no server can recover orders it never received. Storage corruption is surfaced rather than silently overwriting the queue. Native runtime and real network testing are still required before production rollout.

## Related changes and deployment

- POS checkout: `C:/Users/Kayal/POS/.worktrees/pos-captain-access`, branch `codex/captain-session-api`.
- Account checkout: `C:/Users/Kayal/captain-account-api`, branch `codex/captain-account-approval`.
- Gateway checkout: `C:/Users/Kayal/captain-gateway`, branch `codex/captain-enrolment`.

Deploy Gateway `/v1/control/captain-grant` and the POS Captain API before enabling the updated account service. The new route prevents an older gateway from silently issuing a Mobile POS grant. Captain pair/session collections are local-only and must not be added to ordinary shop replication.

Nothing in this task has been merged, published or deployed. On 2026-09-26 the live `https://www.posnic.com/api/mobile/capabilities` returned HTTP 404. The app therefore reports cloud approval unavailable and offers local setup. Browser-flow tests use fixtures; they do not establish production cloud availability.

## Phone test

1. Run the matching desktop test build against a test shop and enable Captain. Do not run two desktop instances against the same database.
2. Put the phone and till on the same Wi-Fi. Select the staff member on the Captain setup page and scan the generated QR in the signed Android test APK.
3. Set the PIN, open a table and download the menu. Close/reopen Captain and unlock.
4. Disconnect the phone, take an order, then reconnect. Confirm the pending order reaches the original till once.
5. Revoke the phone on the till. Confirm renewal/order submission is refused, then recover with a fresh QR for the original staff/branch. Confirm pending orders remain.
6. Repeat code entry, a wrong/expired QR, five wrong PIN attempts and cancellation. Cloud approval needs the service deployment described above before a real account test.

Android compilation and release-signature verification passed. Java/native runtime behavior, camera permissions and external-browser return still need a physical-device run: the available emulator was offline. The Windows test package is unsigned; source/API/browser tests and packaged dependency loading were checked separately. See the adjacent delivery report for exact results and artifact paths.
