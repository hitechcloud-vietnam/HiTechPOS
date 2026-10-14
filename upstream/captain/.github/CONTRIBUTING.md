# Contributing to Captain

Contributions of every kind are welcome: bug reports, fixes, features, and
reports of how this behaves on a real shop floor, which is the thing we cannot
test for ourselves.

## Getting started

```bash
git clone https://github.com/Posnic/captain.git
cd captain
npm install
npm run dev            # http://localhost:5173
npx playwright test    # the whole suite, about 30 seconds
```

You do not need an Android or iOS toolchain to work on the app itself. It is a
web app in a native shell, so most changes can be made and tested in a browser.

You do need a server to talk to. Either run a [Posnic POS](https://github.com/Posnic/POS)
locally, or point the app at a shop you control through Server settings.

## What makes a change easy to accept

**Say why in the commit message, not just what.** The diff already says what
changed. What it cannot say is the situation that made the old code wrong. A
message that names the failure - which screen, what the user saw, why the
obvious fix is not the right one - is worth more than a tidy subject line.

**A test that would have caught it.** Every rule worth keeping in this app has
one, and they read as sentences: *a failed order is NOT replayed on the other
server*. If you are fixing a bug, the test should fail before your fix.

**Leave the wire alone unless you mean to change it.** Some strings here are
not ours: `sale_method`, the `tableorders` shape, and the endpoint paths are
what the server stores and reports on. Renaming one to match a rename in the
app splits a shop's history in two.

## Things that will surprise you

- **The app chooses its own server.** Pinned, then the shop's Wi-Fi, then the
  cloud address, re-decided whenever the active one stops answering. See the
  comment at the top of `config.js`; it explains the order and the rule that
  stops a device drifting onto a different shop.
- **Most reads are POSTs.** They carry a branch id in the body. So "GET is
  safe to retry" is not a usable rule here, and the replay allowlist in
  `config.js` is explicit for that reason.
- **Nothing loads from a CDN.** The app has to work on a shop's Wi-Fi with the
  internet down. `tests/offline-first.spec.js` enforces it, because a single
  `<script src="https://...">` silently disables every modal on the two screens
  the kitchen uses most.

## Style

Match the file you are editing. Comments explain *why*, and are worth writing
where the reason is not obvious from the code; there is no need to narrate what
the next line does.

## Reporting a security problem

Do not open an issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree your work is licensed under AGPL-3.0-only, the same
licence as the project.
