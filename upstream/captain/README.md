# Captain for Posnic POS

The mobile order-taking companion for
[Posnic open-source POS and billing software](https://www.posnic.com/).
Restaurant floor staff can take an order at the table, send it to the kitchen,
manage KOTs and look up what a table has already had. Captain talks to the
[Posnic/POS](https://github.com/Posnic/POS) server, either the till on the
shop's own Wi-Fi or the shop's cloud address.

Android and iOS, built with Capacitor. Source under AGPL-3.0.

**[Download the latest build](../../releases/latest)** - APK for Android, IPA
for iOS.

## Connecting a handset for the first time

Three ways, offered as a choice, because whoever is holding a new phone may
know nothing about the shop:

| | |
|---|---|
| **Scan** | Point at a QR code by the till. Nothing to know, nothing to type. |
| **Search this Wi-Fi** | Finds the till by itself, when the phone is on the shop network and POSNIC is running. |
| **Type it** | A shop code (`demo`), or a till address (`192.168.1.5:5555`). |

A scanned code may carry a bare shop code, a full address, or a link with
either in a `server=` parameter, because that code gets made by whatever is to
hand and reprinted by somebody in a year.

## Which server the app talks to

The app is not shipped pointing at one address. It chooses, in this order, and
re-chooses whenever the one it is on stops answering:

1. **A pinned address.** Set in Server settings (the gear on the login screen).
   An explicit choice is never overridden.
2. **The shop's own server on this Wi-Fi.** Fastest, and keeps working when the
   shop's internet is down. Found by asking `/api/runtime-info`: a Posnic
   server identifies itself there, so a printer answering on port 5555 is not
   mistaken for a till.
3. **The shop's online address.** A shop code becomes
   `https://<code>.posnic.io/api`; a shop on its own domain can be entered in
   full.

A request that fails because the Wi-Fi dropped mid-service is retried once
against the other address rather than surfacing as an error.

**The app will only move itself onto a server it has proved holds the same
shop.** Signing in records a shop key against the address it came from; an
address whose recorded key does not match is offered to the user but never
selected on its own. Two Posnic tills on one estate's Wi-Fi is not
hypothetical.

### Setting it up on a handset

- On the shop Wi-Fi: open Server settings and tap **Find server on this Wi-Fi**.
- Away from the shop, or with no till on the network: type the **shop code**
  (for example `azure`) and tap Test, then Save & Use.
- **Automatic** clears a pin and lets the app choose between the two again.

### The client

Everything hangs off one global, `POSNIC`, in `config.js`:

| | |
|---|---|
| `POSNIC.server` | which address, and how it is chosen |
| `POSNIC.session` | the credential from sign-in |
| `POSNIC.api` | `get` / `post` / `raw`, throwing `ApiError` |
| `POSNIC.net` | reachability and the offline overlay |

Nothing else in the app builds a URL, attaches a credential, or decides what a
failure means. Call `POSNIC.api` and handle an `ApiError`, which carries a
machine-readable `code` so a caller branches on the reason rather than matching
English against a message.

State lives in two localStorage keys, `posnic.server` and `posnic.session`.

### What the server has to provide

`POST /api/users/kioskMobileLogin` returns a bearer-token grant:

```json
{ "tokenType": "Bearer", "token": "...", "expiresIn": 86400,
  "shopKey": "...", "user": { "id": "...", "name": "..." }, "branches": [] }
```

and ordinary HTTP for failures: `400` missing credentials, `401` wrong
credentials, `429` locked out (with `Retry-After`), `500` our fault. The order,
KOT and history routes refuse an anonymous caller, so without the token the app
signs in and then loads nothing.

## Offline

Every script and stylesheet is served from the app itself; nothing is fetched
from a CDN. That is enforced by `tests/offline-first.spec.js`, because a single
`<script src="https://...">` silently disables every Bootstrap modal on the KOT
and order-history screens when the shop's internet is out.

## Tests

```powershell
npm.cmd install
npm.cmd run check
```

`check` runs both suites - the unit tests and the browser tests - which is
everything this project has.

**They run before a commit, not on a server.** There is no test workflow on
GitHub for this repository: the checks live in a hook, and the hook is the gate.
`npm install` arms it, so a fresh clone is gated from the first commit without
anybody reading this paragraph. If it ever says it could not:

```powershell
git config core.hooksPath .githooks
```

A clone where that is unset commits with no checks at all and looks exactly
like one that ran them, which is why it is not left to a step somebody has to
remember.

It takes about six minutes, which is the honest price of having no second
opinion downstream. Commit in batches rather than every few lines, and use
`git commit --no-verify` when you are only saving your place - knowing that
nothing after you will catch it.

### On a real phone

Some failures only happen inside an Android WebView - a fetch that behaves
differently under Capacitor, a request shape the platform refuses - and no
amount of desktop Chromium proves anything about those. With a phone plugged in
(USB debugging on) or an emulator running:

```powershell
npm.cmd run check:device
npm.cmd run check:device -- https://your-shop.posnic.io/api
```

It builds the APK, installs it, starts it pointed at a server and reads back
the one line the app prints about its own networking. With nothing attached it
says so and stops - it is a tool for when you have changed how the app talks to
a server, not a gate, because a gate that needs somebody to find a phone is a
gate that gets switched off.

### Before a release

Two checks that do not run on every commit, because one needs an Android and
the other takes a few seconds nobody should pay per commit:

```powershell
npm.cmd run check:native
npm.cmd run check:device
```

`check:native` lays out the Android project from scratch, syncs the bundle and
the plugins, and confirms the files `build-apk.js` patches are still where it
expects them. **No SDK, no Java, no phone** - about five seconds. It is what
catches a Capacitor upgrade that moves something, which would otherwise surface
at a tag with a shopkeeper waiting.

`check:device` is the real thing on a real Android, and the release build is
the last word.

### What still runs on GitHub

`release.yml`, and nothing else. Building a signed APK needs a JDK, an Android
SDK, a keystore and a macOS runner for the iOS half, and none of that belongs
on a laptop.

## Building it yourself

Both platforms build with whatever credentials are present, so an unsigned
build always works and needs nothing set up.

### Android

Needs a JDK 17+ and the Android SDK (platform 34, build-tools 34.0.0).
`build-apk.js` finds a toolchain under `.android-build-tools/`, in
`ANDROID_HOME`, or where Android Studio puts one.

```bash
npm install
node build-apk.js            # debug
node build-apk.js --release  # signed; needs npm run setup:release-signing
```

### iOS

macOS only: an iOS binary is produced by Xcode, and Apple ships Xcode for
nothing else.

```bash
npm install
node build-ipa.js            # unsigned unless IOS_TEAM_ID and friends are set
```

An unsigned build proves the app compiles and produces an inspectable `.ipa`.
It will not install on a device; that needs a distribution certificate.

### Releases

Tagging builds both platforms and publishes them where people can download
them without a GitHub account:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Signing in CI is by repository secret, never a file in the repo:
`ANDROID_KEYSTORE_BASE64` and friends for Android, `IOS_CERT_P12` and friends
for iOS. Absent, the release carries clearly-labelled unsigned builds.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE).
