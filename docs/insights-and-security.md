# Insights and device security

Insights uses one branch and one date selection for sales, items, staff, invoice
payments, discounts, returns and hourly sales. Today and Yesterday use the branch
timezone; weeks start Monday. Last week is the previous completed week; Last 7
days excludes today. Custom dates cannot extend into the future. Today also links
directly to Yesterday and Last week.

The server must advertise `insightReporting: bounded-insights-v1` on discovery
when requested with `insights=1`. Older servers retain the existing trends and
item screens. Deploy the matching POS `/business/v1/insights` API before releasing
the app. No desktop publisher is required for this endpoint: it reads synced
cloud sales. Unsynced sales cannot appear until their originating device syncs.

Reports are bounded, not truncated. Large date ranges may be unavailable; use a
shorter range. Every report shows its verification time. Changing branch, dates
or account clears the prior result; refreshing does not retain stale totals.

## Meaning of the numbers

- Sales and returns contribute on their respective business dates.
- Item quantity rankings are separated by unit. Kilograms and pieces are never
  added together. Rankings use the full bounded source, not sums of daily top lists.
- Staff means the recorded invoice author. It does not establish who served the
  customer or collected payment. Staff reporting requires `reporting.manage`.
- Payments are current recorded payments on invoices dated in the selected
  period, not money collected during that period. Incomplete or inconsistent
  payment records suppress the payment section instead of inventing a breakdown.
- Up to 50 bill contributions are displayed; this is not a complete invoice export.
- Missing item facts or malformed discount values suppress those sections. ACL controls
  continue to apply independently to each report and to approvals and settings.

## Device settings

PIN remains enabled by default. A user can verify the existing PIN to disable it,
change it, or enable it again. With PIN disabled, credentials remain in the OS
secure store. Biometrics, when enabled, remain required. With both disabled, the
device session resumes without an app lock; the explicit Lock app action is hidden.
Sign-out removes both PIN-encrypted and PIN-disabled sessions.

Auto-lock offers immediately (default), one minute, or five minutes after leaving
the app. The privacy cover still hides content in the background. Language,
notification schedules, approval alerts, stock alerts, push settings, connected
devices, account/server and sign-out remain in More, subject to permissions.

New control labels cover the existing 18 locales. Several new explanatory
sentences remain English and need translation and human language review before a
fully localized release. Physical-device PIN, biometric and background timing
acceptance checks are still required; browser tests cannot verify OS secure storage.
