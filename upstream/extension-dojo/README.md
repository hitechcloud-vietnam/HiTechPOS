# Dojo Payments for Posnic

A free, open-source payment extension for Posnic Community Edition.

**Development preview — not yet installable or approved for live payments.**
No merchant credentials, terminal connection or real payment has been tested.
Dojo merchant, terminal and transaction fees are separate from this free software.

## Available code

The server-side Dojo transport supports terminal discovery, payment intents,
terminal sale sessions, status retrieval, signature decisions, cancellation
requests and low-level refund requests. It pins the provider HTTPS origin,
validates configuration and amounts, redacts provider errors and does not
automatically retry payment mutations.

This code was extracted from the Posnic host integration foundation. The host
still contains the existing implementation until a tested provider-loading
contract replaces it; this repository does not change deployed tills.

## Develop

Use Node.js 24. No dependencies are required for the transport tests.

```sh
npm test
```

Tests use synthetic responses and never contact Dojo. Passing them is not
provider certification or evidence of a successful terminal payment.

## Installation and releases

There is currently no installable extension ZIP. Once the host payment-provider
interface and acceptance gates are complete, signed ZIPs will be published in
GitHub Releases and listed in the Posnic extension catalogue. Source will remain
public here. Do not upload a repository source ZIP to the extension installer.

Configuration will live under Payments → Providers. Extensions will manage
installation and updates. Secrets belong in encrypted host configuration, never
in the browser, an extension frame, source control or downloaded packages.

See [the roadmap](docs/ROADMAP.md) for outstanding work and release gates.

## Licence

AGPL-3.0-only; see [LICENSE](LICENSE). Dojo is a third-party service. This project
does not claim Dojo endorsement or certification.
