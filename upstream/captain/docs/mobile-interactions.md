# Captain mobile interactions

The same touch interactions work on phones and tablets. Gestures supplement visible controls; they do not submit orders, collect payment or cancel items.

| Interaction | Where it applies | Behaviour |
| --- | --- | --- |
| Pull down at the top | Active tables, menu, order history, My sales | Refresh in place. Keep cart, filters and selected day; keep the last loaded data on a failed refresh. |
| Pull down at the top of details | Active-table details, history order details | Refresh the currently open record. |
| Swipe left/right inside details | Active-table details, history order details | Next/previous table or filtered order; stop at the list ends. Reverse direction for right-to-left languages. |
| Previous/Next buttons | Same detail screens | Accessible alternative, with position indicator. Arrow keys work while the navigation controls have focus. |
| Drag header downward | Read-only detail panels, menu index, cart summary | Dismiss the panel/sheet. Visible Close/Back remains available. |
| System Back | Android navigation | Existing Back handler closes the current overlay/editor first and keeps unsent-work protection. |
| Escape | Active-table details | Close details; Bootstrap handles its modal Escape controls. |
| Scroll/flick | Lists and detail content | Normal scrolling below the top; do not turn scrolling into refresh. |
| Tap, keyboard typing, text selection, pinch zoom | Native/browser controls | Retain platform behaviour. Do not add double-tap or long-press actions that conflict with selection or zoom. |

## Boundaries

- Reserve the outer 24 CSS pixels for OS/browser edge navigation. Do not add a global swipe-to-back that can bypass unsaved-work checks.
- Ignore multi-touch, cancelled/short gestures, form fields, action buttons, selected text, horizontal scrollers and gestures while service is saving.
- Do not navigate between editable orders by swipe. Notes, order modification, split bills and payment dialogs require their explicit controls.
- Server discovery is an explicit scan, not a live data list. The number card is a printable cached menu; update it by refreshing the menu first.
- Detail lists are the currently loaded/filter-matching records, not an unbounded carousel. Later additions remain separate and unserved.
- Overlapping refreshes share a request. Late table-detail responses cannot replace a newer selection or reopen a closed panel.
- Refresh feedback respects reduced-motion preferences. Touch controls are at least 44 CSS pixels.

References: [Apple gestures](https://developer.apple.com/design/human-interface-guidelines/gestures/), [Android swipe-to-refresh](https://developer.android.com/develop/ui/views/touch-and-input/swipe), [Android gesture navigation](https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav).

Validation uses Chromium touch input, automated browser checks and Android/iOS builds. It does not substitute for physical Android/iPhone gesture testing or claim predictive-Back animation support.
