# Mobile language support

Mobile POS supports the same 18 languages as POS: English, Tamil, Hindi,
Malayalam, Kannada, Telugu, Sinhala, Nepali, Arabic, French, Spanish,
Portuguese, Indonesian, Thai, German, Swahili, Dutch and Italian.

All 198 current mobile messages are supplied for every language, including
onboarding, authorization, PIN recovery, sales, UPI confirmation, printing,
offline status and errors. Language selection is available before sign-in and
under More. The selection persists locally and works offline. Regional device
tags select their base language. Arabic uses right-to-left layout and receipts.
Shop-entered product, customer and branch names are not automatically translated.

Shared terminology is imported from the POS language packs. Existing mobile
translations are retained. Newly completed mobile-only messages are machine
translated drafts, with sampled review of payment and recovery wording; they
have not received native-speaker review. The non-English packs therefore remain
labelled beta. Complete key coverage measures availability, not linguistic approval.
No translation service is called by the shipped application; every string is bundled.

## Maintenance

`src/i18n/en.json` defines the message keys. `imported.json` contains shared POS
translations; `mobile.json` overrides or completes the mobile wording. Add new
messages to every language in the same change. `npm test` checks completeness,
locale detection and literal UI message references. Browser tests exercise setup,
offline checkout and language persistence in all 18 languages on a narrow viewport.

To refresh shared POS terminology, run:

```powershell
node scripts/import-translations.mjs C:/Users/Kayal/POS/languages
```

The generated coverage file includes both shared and mobile translations.
Review imported changes before committing; never fill gaps with English just to
pass a coverage check. English remains a defensive runtime fallback for unknown
future keys, not the normal experience for supported messages.

Amounts accept local digit shapes and decimal dot, comma or Arabic decimal mark.
Thousands/grouping separators are not accepted in input. Displayed amounts and
dates follow the selected locale. Printer glyph support depends on the phone's
print service and printer; physical-device and thermal-printer testing is still needed.
