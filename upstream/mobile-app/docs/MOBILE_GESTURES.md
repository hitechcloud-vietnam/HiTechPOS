# Mobile gestures and navigation

The same selling workflow supports Android and iPhone conventions. Gestures
supplement visible controls; a cashier must never need to discover a hidden
gesture to complete a sale. No gesture confirms payment, changes a quantity,
deletes a sale, or submits a print request.

## Interaction inventory

| Interaction                | Where and behaviour                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tap                        | Existing item selection, tabs, buttons and input focus; normal pressed feedback and accessible labels.                                                                                                                             |
| Vertical drag / fling      | Native scrolling for lists and forms. Horizontal gestures must be clearly horizontal before they claim a touch.                                                                                                                    |
| Pull down at the top       | Catalogue, held sales and receipts use the native refresh control, including short and empty lists. A spinner follows the existing single-flight sync. Visible Refresh controls remain available.                                  |
| Swipe left / right         | A receipt opened from history moves to the next / previous receipt in that history order. Arabic reverses the direction. It stops at the ends rather than wrapping. Previous / Next buttons and the position count are also shown. |
| Android system Back        | Returns to the appropriate parent screen (payment to cart, receipt detail to receipts, settings to More); the main Sell screen lets Android handle exit. A pending checkout operation blocks navigation.                           |
| iPhone leading-edge swipe  | Returns to the parent screen on release. The leading edge is mirrored in Arabic. This lightweight screen router does not provide UIKit's interactive transition animation.                                                         |
| Tap the current main tab   | Scrolls its list back to the top. Switching tabs also starts at the top.                                                                                                                                                           |
| iPhone status-bar tap      | The main scroll view is the single scroll-to-top target; the nested item grid and category strip opt out.                                                                                                                          |
| Drag to dismiss keyboard   | iPhone uses interactive dismissal; Android dismisses on drag. Tapping an actionable control while typing remains supported.                                                                                                        |
| Horizontal category scroll | The existing category strip remains independently scrollable; receipt paging is never active on the selling screen.                                                                                                                |
| Long-press text            | Native selection/copy is available for receipt numbers and existing editable fields. No custom long-press financial actions.                                                                                                       |
| Multi-touch / pinch        | Left to the platform. The app has no full-screen image/map viewer requiring custom zoom. Multi-touch cancels record paging.                                                                                                        |
| Screen-reader gestures     | Left to VoiceOver / TalkBack. Visible, labelled buttons provide alternatives to every custom navigation gesture.                                                                                                                   |

Double-tap-to-add, swipe-to-delete, drag-to-reorder sale lines, and swipe-to-pay
are deliberately not introduced: they have no necessary counterpart in this
simple checkout and could cause accidental financial or order changes.

## Data and safety

- Refresh uses the existing repository and sync worker. It refreshes the
  catalogue and local receipt/held-sale data without clearing search filters,
  the cart, or locally saved offline sales. It does not introduce a new API
  for downloading all historical server sales.
- Overlapping automatic/manual sync uses the existing single-flight guard.
  Failed connections retain local data and the existing offline status. Storage
  failures show the existing error message instead of an unhandled rejection.
- Receipt navigation snapshots the displayed IDs when a receipt is opened.
  Background updates may update the receipt itself, but cannot reorder the
  browsing sequence or make a swipe silently print/pay. Newly arrived records
  become part of the sequence when the user reopens history.
- The receipt saved immediately after checkout is a confirmation screen;
  receipt-to-receipt swipes are enabled only when browsing history.
- The first/last 28 screen points are excluded from receipt paging. iPhone's
  leading edge is used for Back; Android edges remain for OS navigation.
- Navigation requires a single-finger movement of at least 64 points, with
  horizontal movement at least 1.6 times vertical movement. A cancelled touch
  does nothing. Locked/busy screens cannot browse records.

## Validation

Unit tests cover gesture direction, Arabic mirroring, edges, diagonal/tiny
movements, multi-touch, and record boundaries. Browser touch tests exercise
the React Native responder wiring, detail button alternatives, preserved cart
after refresh, and exclusion of system-edge swipes. Existing browser tests
cover sales, PIN, appearance, and all supported languages.

Before a phone release, check native Android/iPhone pull-to-refresh (including
empty lists and offline mode), physical system Back, iPhone edge Back and
status-bar tap, keyboard dismissal, and VoiceOver/TalkBack. Browser tests do
not verify native refresh animations or OS gesture integration.

## Design references

- [Apple: Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures/)
- [React Native: RefreshControl](https://reactnative.dev/docs/refreshcontrol)
- [React Native: ScrollView](https://reactnative.dev/docs/scrollview)
- [React Native: BackHandler](https://reactnative.dev/docs/backhandler)
