# Connection and PIN unlock

The setup screen has one server field with adjacent Wi-Fi discovery, QR scan and
pairing-code icons. A shop code, hostname, private IP, full URL or supported
pairing payload is normalized internally. Public HTTP addresses upgrade to HTTPS;
a bare private address defaults to the Captain/till port 5555. Explicit ports and
URLs are preserved. Pairing codes are submitted only to the selected shop server.

Wi-Fi discovery runs in the installed phone app. It probes the current private
IPv4 /24 on ports 5555, 5000 and 80, with bounded concurrency, timeouts and cancel.
Only matching runtime-info responses appear as Posnic servers. No credentials are
sent during discovery. Larger subnets, isolated guest Wi-Fi, IPv6-only networks,
custom ports and blocked firewall rules may require manual address entry. Browser
preview explains that it cannot discover the phone's LAN. Discovery results locate
servers; they do not grant trust or bypass sign-in/capability checks.

The remembered account (username, password, address and token) uses OS SecureStore
on native devices. Set a 4–6 digit unlock PIN after login or under More. Mobile
ports the local-unlock rules from POS/src/pin-lock.js; it does
not reuse a manager approval PIN or transfer a desktop device's PIN record.

New native PIN enrollment uses PBKDF2-HMAC-SHA256 with 600,000 iterations on a
background worker (CommonCrypto on iOS, Java crypto on Android). It encrypts the
remembered account with AES-256-GCM,
random salt/nonce and an install secret, then removes the unwrapped stored account
and legacy token. Backgrounding or Lock now drops the unlocked key/token from the
vault. The PIN never goes to the server. Five failed attempts require a fresh
password login for the same shop, branch and staff identity; paid sales and the
local database are retained. Existing OS-protected database encryption remains
independent of the PIN. No biometric dependency is added.

Records identify their key-derivation algorithm; existing untagged scrypt records
retain the legacy derivation path. A failed first enrollment preserves the signed-in
account and does not save a partial PIN. The first iOS pilot used the JavaScript
scrypt path and could time out; the native module fixes new iOS enrollments.

Cloud browser authorization waits for the mobile app to return to the foreground
before exchanging the one-use grant or pairing with the shop. Safari background
suspension must not consume a grant while the app cannot receive the response.
Cancellation removes the foreground listener; returning after expiry requires a
fresh authorization. The app does not blindly retry consumed one-use credentials.

The browser preview keeps vault secrets in memory only. Native persistence and
Wi-Fi discovery must be exercised on a phone; simulated discovery, SQLite,
cryptographic vault and browser interaction tests are not physical-device tests.
The matching 0.1.3 POS build implements pairing/bootstrap/sale ingestion; enable
the branch under desktop Settings → Mobile POS. Older servers require an update.

Verified route failover from the parallel connection work is documented separately
in CONNECTION_RECOVERY.md when present. It requires authenticated shared-ledger
metadata; discovery alone never authorizes sales to switch servers.
