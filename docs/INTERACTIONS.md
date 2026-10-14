# Mobile interaction contract

- Native scrolling, momentum and top-of-list pull-to-refresh; visible Refresh as an accessible alternative. Follow each module's verified freshness policy, distinguish API checks from source freshness and coalesce duplicate requests. Authorization, integrity and authoritative-unavailability failures clear affected data; retained last-known values require an explicit bounded policy and label.
- Tap an item to open detail. Interior left/right swipes navigate the same permitted ordered list, with Previous/Next and no wrapping. Preserve filters and parent position. System edge gestures, multi-touch and vertical scrolling are not captured.
- Real accounts use a native stack for module pages and persistent Today/Inbox/More tabs. iPhone interactive Back and ordinary Android Back are delegated to that stack, with device testing still required. Android predictive-back animation is disabled as required by the current navigation library; do not claim it supported. The sample shell retains its own ordinary Android Back handling.
- Active bottom-tab reselection returns to root, then scrolls to top. Retain independent tab state. No horizontal cross-tab gesture.
- Native sheet dismissal/Cancel and keyboard dismissal where applicable, with unsaved-edit protection.
- Branch choice uses a modal; it is never shown for a single accessible branch. Notification schedule edits prompt before a navigation action discards them. Native Back/swipe cancellation still needs physical-device verification.
- Informational Inbox swipe read/unread actions and long-press context menus only when those features exist; each needs a visible accessible alternative.
- Native text selection/copy, proper keyboards, focus visibility, bounded pagination/Load more and retry states.
- Native share or pinch-to-zoom only if a permission-controlled shareable record/document viewer is introduced. No heavy report generation or charts added for gesture support.
- Reduced motion, screen-reader and switch/keyboard alternatives, text scaling and RTL. Haptics must respect the device's settings.
- Native stack and unsaved-change dialog transitions observe Reduce Motion. Tab labels have explicit accessible names and space that grows with text scale. Tab reselection scrolls its list to the top; tab contents keep their own scroll position.
- No swipe-to-approve, refund, change stock or delete audit records. Explicit financial confirmation and server verification are mandatory.

Device verification must include edge/vertical/multi-touch conflicts, interrupted refresh, scope changes during requests, offline data retention, first/last records, keyboard/back ordering and assistive technologies. Web tests do not substitute for these checks.

Navigation compatibility follows [React Navigation's native setup guidance](https://reactnavigation.org/docs/getting-started/). Android fragment restoration is configured through the checked-in Expo plugin, so regenerating native projects preserves it.
