# Mobile POS visual refresh — 0.1.5

The official Posnic wordmark and receipt mark come from the POS repository's frontend/static/images/logo assets. The wordmark is rendered as a local vector through react-native-svg; no remote image request or additional font is needed. The launcher uses the same receipt mark.

The app uses blue primary actions, cool neutral backgrounds, white surfaces and a matching dark palette. Item tiles show a compact visual, name, price and the quantity added to the current sale; internal item codes stay hidden. A persistent sale bar separates the total from its label. Connection, language, PIN, payments and printer screens retain their existing actions.

Touch targets remain at least 44 points. Colour is accompanied by text for connection states. Labels wrap, the branch name truncates, RTL follows the chosen language, and prices use tabular numerals where useful. Press feedback is subtle and does not delay checkout.

Validation: TypeScript, 30 domain/storage/security tests, and eight browser scenarios covering onboarding, PIN, offline cash sales, held/quick sales, languages/RTL, the logo, light/dark mode and 320px layouts. The Android release build is a test APK signed with the same key as previous test builds.

Previews: previews/mobile-pos-light.png and previews/mobile-pos-dark.png.
