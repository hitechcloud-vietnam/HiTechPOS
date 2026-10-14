# Provider extension delivery

## Boundaries

Posnic core owns payment permissions, immutable quotes, reserved stock,
sale creation, recovery locks and the durable payment journal. Those records
must survive provider uninstall. The provider owns Dojo request/response
translation and provider-specific configuration validation. It must not write
directly to sales or inventory collections.

No extension frame receives a merchant key. Host calls use the prepared payment
identity, not a renderer-supplied charge amount. Verified capture is required
before recording a paid sale. Unknown outcomes remain unresolved and must not
be retried as a fresh charge. Already adjusted goods are deducted only once.

## Milestones

- [x] Public source repository and synthetic transport tests.
- [ ] Generic server-side payment-provider loading contract and manifest capability.
- [ ] Move the host's provider dependency to this package with regression coverage.
- [ ] Encrypted credentials, manager settings and terminal selection.
- [ ] Checkout progress, signature handling, cancellation and recovery UI.
- [ ] Verified reconciliation of unknown provider outcomes.
- [ ] Durable refunds and connection to normal refund permissions/history.
- [ ] Signed install/update ZIP, disable/remove protection for unresolved payments.
- [ ] User/developer guides and compatible-host version declarations.
- [ ] Sandbox tests with Dojo developer access and a test terminal.
- [ ] Provider go-live requirements and authorized terminal acceptance.

Existing host integration tests already exercise a durable operation journal,
frozen sale documents and simulated capture without double deduction. They
remain in the Posnic host repository; they are not production acceptance.

## Public release policy

Development code is public now. Production availability requires the above
gates; do not mark a release stable based only on mocks. Releases will contain
signed runtime packages, checksums, compatibility information, change notes
and matching source. Signing keys and merchant credentials are never published.
Installing an update must not require a paid Posnic subscription.

Reference documentation for implementation review:
- https://docs.dojo.tech/api
- https://docs.dojo.tech/payments/accept-payments/in-person-payments/pay-at-counter/terminals/step-by-step-guide
- https://docs.dojo.tech/payments/accept-payments/in-person-payments/pay-at-counter/go-live-checklist-f2f
