# Captain interface languages

Captain includes 30 interface languages: English, Tamil, Hindi, Malayalam, Kannada, Telugu, Sinhala, Nepali, Arabic, French, Spanish, Portuguese, Indonesian, Thai, German, Swahili, Dutch, Italian, Bengali, Marathi, Gujarati, Urdu, Simplified Chinese, Traditional Chinese, Japanese, Korean, Russian, Turkish, Vietnamese, and Malay.

All translations ship in the APK and work without a server or translation service. Choose a language before connecting on the setup screen, or in the app's language setting. The choice belongs to this phone. Arabic and Urdu use a right-to-left layout; addresses remain left-to-right.

## Editing translations

Edit `assets/common/locales/<code>.json`. The English sentence is the key. Retain each `{0}`, `{1}`, and other substitution exactly; translated sentences can reorder them. Keep shop and product brands unchanged. Use ordinary restaurant language and short button labels. Never translate a shop's item names, notes, prices, or table identifiers; their rendered elements use `translate="no"`.

`en.json` is the message inventory, and `manifest.json` is the language list. New interface messages must be added to every catalog. Markup, dynamic status messages, placeholders, accessibility labels, and counts all need coverage. Messages supplied by an external server that are not in the catalog fall back to the original text.

After editing, run `npm run i18n:build`, `npm run check:translations`, and `npm test`. The generated `languages.js` is committed for classic browser scripts and native packaging; tests reject a stale bundle, missing entries, or damaged substitution tokens.

## Review status

Existing matching translations were reused from POS. New translations are drafts and need review by native speakers on the restaurant floor, especially long error messages and terminology. Coverage checks establish that entries exist, not linguistic accuracy. `reviewed` is false until a native speaker has reviewed Captain's full flow in that language. English remains the default until the user chooses another language.

When reviewing, check setup and pairing, login and unlock, tables, item selection, cart, sending offline, reconnecting, cancelled orders, bill requests, order history and personal settings. Test long names and narrow phones, and confirm the translated status changes after a retry.
