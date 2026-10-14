# Security policy

Captain carries a shop's orders and a staff member's credential on a device
that gets left on a counter. We take reports seriously and appreciate
responsible disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Email **security@posnic.com** with:

- A description of the issue and its impact
- Steps to reproduce (proof of concept if possible)
- The Captain version affected

We aim to acknowledge reports within 72 hours and to ship fixes for confirmed
vulnerabilities in the next release. We will credit you in the release notes
unless you prefer otherwise.

## The security model, stated plainly

| Protected against | How |
|---|---|
| A stranger reading a shop's orders | Every screen past sign-in needs the bearer token the server issues. The app never holds a shared device key. |
| The app drifting onto another shop's server | A server is adopted automatically only once it is recorded as holding the shop this device signed in to, proved by a shop key from the server. |
| A stranger on the shop Wi-Fi impersonating the till | A server must identify itself as Posnic before the app will use it. Any other reply on the port is ignored. |
| A stale credential being replayed forever | A refused token is dropped on the first 401 rather than resent. |

## What this does not protect against

*A phone somebody else is holding.* The token is in the device's own storage.
An unlocked, signed-in handset can take orders, which is the same exposure as
an unlocked till: manage it with the device lock and by signing out.

*Plain HTTP on the shop's own network.* A till holds no certificate, so traffic
to it is unencrypted and readable by anyone already on that Wi-Fi. This is a
deliberate trade: requiring TLS on a LAN address would mean no shop could use
its own till without running a certificate authority. The cloud address is
always HTTPS.

*A malicious server the user typed in themselves.* Pinning an address is an
explicit choice and is honoured as one.

If you are assessing Captain for a business where the shop network is not
trusted, use the cloud address rather than the LAN one, and say so here if
something in this list looks wrong for your case.
