# Captain 1.3.43 release candidate

This is a local test candidate, not a published release. Source is the
`codex/ios-test-build` integration worktree based on `af4cf7c`, including
uncommitted changes. The authoritative evidence and remaining gates are in
`current-flow-acceptance.json` and `visual-mismatch-ledger.json`.

## Changes included

- Compact table and guest entry, naturally sorted tables, occupied states,
  custom table entry and numbered takeaway orders.
- Direct item notes, separate kitchen batches, fresh notes on Add again,
  compact quantity/service controls and Undo for unsent cancellations.
- Tax-inclusive order totals, bill review, split bills, mixed payments and
  collection controls. Collection defaults on as requested; an explicit saved
  disabled preference is preserved. Server permissions remain enforced.
- Discoverable paper scanning and order references; kitchen voice recording,
  replay and configured cloud storage integration.
- Light/dark appearance controls, offline Inter, themed loading states and
  the selected item, kitchen and payment feedback animations.
- Offline order recovery and clear Order sync messages; 30 language bundles
  with 1,145 keys each and no missing keys in the visible-message audit.
- Failed readiness refreshes clear stale ready indicators. Rapid editor
  reopen waits for dialog/history cleanup. Older order rows retain safely
  escaped kitchen notes, with cancellation strike-through.
- Web packaging excludes tests, build helpers and archived presentation code;
  all 365 local script references are checked during the build.

## Verification

- 653 Captain unit tests passed after the current functional fixes.
- 74 backend bill/payment/takeaway/voice/settings tests passed, plus 164
  table/transfer/takeaway-number/pricing tests.
- 22 paired HTTP integration checks passed; the manager setup browser check
  passed separately rather than being counted as a skipped success.
- A real browser journey against an isolated POS/Mongo database completed
  sign-in, order creation, an item-note update and confirmed cash payment.
  No live customer orders or payments were used.
- All 905 current named browser cases passed across recorded batches and targeted reruns, reconciled against the current 86-file inventory. A single full release-hook run remains pending.
- Signed Android builds passed package/signature checks. Build success does
  not establish native runtime verification.
- The local POS 1.9.2 installer built successfully. Its SHA-256 is
  `b85fa597c2105633de40925ee5afa0df890f61b402d06f5507a9721debc8d691`.
  Runtime dependency, packaged module and VC runtime checks passed. It is
  unsigned and has not been publicly released or installation-tested.

## Gates still open

- Full release-hook check and complete per-screen visual comparison.
- Current Android and iOS runtime verification. Automatic approval review
  rejected the previous Android self-test launch with “blocked by policy”;
  no equivalent retry was attempted.
- A processed TestFlight build, current cloud scan/voice end-to-end evidence,
  and physical printer/speaker verification.
- Final source review, human-attributed commit, protected-branch integration,
  versioned publication and download verification.

Do not tag these local artifacts as fully released until those gates are
resolved or their scope is explicitly changed by the user.

Current signed Android candidate: `test-builds/captain-1.3.43-rc.20261005-382fd2a0.apk`.
SHA-256: `382fd2a0278cf30062732329f35920c6d01a29845233caa55ede7e6150d4316c`.

Latest user direction (2026-10-05): integrate through develop and main, publish the APK on GitHub for user testing; no further local POS installer build. This supersedes waiting for full native/visual verification before a test release. Branch protections still apply. The APK listed above predates Quick sale tax and must be rebuilt.
