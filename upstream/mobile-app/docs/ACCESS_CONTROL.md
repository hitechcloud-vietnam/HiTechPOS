# Mobile POS access control

Mobile POS uses the POS user's effective `access` matrix, which already combines
their assigned role and per-user overrides. Device pairing and the local PIN do
not create a new role or elevate permissions. Use a separate staff account for
each operator; a pairing code authenticates the account for which it was issued.
Do not share an owner's pairing code with cashiers.

## Permission mapping

| Mobile action | Existing POS permission |
| --- | --- |
| Download selling catalogue, add items, hold/resume and complete a sale | `sales.write` |
| Quick sale | `sales.write` + `pos.quick_sale` + branch Quick Sale enabled |
| Create a customer with a sale | `customer.write` + selling permission at checkout |
| Reduce/remove an unpaid cart line | `sales.write` + `pos.void_line` |
| Print a receipt, automatic receipt, or printer test | `pos.reprint_receipt`; till API additionally requires `sales.write` |
| Change branch Mobile POS setup, issue pairing codes, revoke devices | `branch.write`; pairing also requires `sales.write` |
| Read branch Mobile POS setup | `branch.write` or existing `plan.read` |
| Confirm manual UPI payment | Selling permission and a branch-configured UPI account |
| Create live items, override prices, refunds, paid-sale voids, stock adjustments | Not supported by this app; unavailable even if a role grants them |

Manage roles and per-user overrides in the existing desktop Roles and Users
pages. The Features page only enables the Mobile POS module. Its configuration
stays on the Mobile POS module page.

Owners, admins and super admins retain the existing desktop top-account bypass.
Managers and other staff require explicit boolean permissions; missing values
deny access. Actions listed in `access.pos_manager_approval` are denied on mobile
because this app does not yet implement authenticated manager approval.

Receipt printing deliberately uses the existing reprint permission for both
first and subsequent prints. There is no independent tender-confirmation ACL in
this implementation: cash and configured manual UPI are available to sellers.
Local receipt history contains this operator's device receipts; it is not the
Business app's cross-staff sales reporting API.

## Enforcement and offline behavior

- The server derives permissions; the client cannot submit a role or permission
  matrix to authorize a sale. Sale grants are looked up server-side and bound to
  the tenant, branch, user, device and catalogue version.
- The server checks current sales/customer/quick-sale permissions before creating
  a new sale intent, plus the stored grant, prices, tax and offline period.
  Revoked paid offline sales remain locally available for review; they are not
  silently discarded. An already durable intent can resume its original effects
  idempotently, preventing duplicate stock deductions and payments.
- Receipt requests require the printing permission and a completed sale owned by
  the same staff user, branch and device. Local/system printing checks permission
  and expiry too.
- The local repository enforces cart permissions, including held-cart checkout.
  Removing an unpaid local line is locally enforced: the server receives only the
  final cart, so it cannot independently audit removed draft lines. A tamper-proof
  draft-edit audit would need a separate server-backed cart event protocol.
- Sync refreshes authorization before sending pending work. A bootstrap 401/403
  suspends cached action permissions while preserving carts, receipts and outbox.
  A later successful bootstrap restores current permissions. A network failure
  does not revoke an unexpired offline grant.
- A completely disconnected phone cannot learn about revocation immediately.
  Its existing branch-configured offline grant (1–72 hours) bounds normal app use.
  On reconnect, the server enforces the user's current access. PIN unlock does
  not renew the grant.
- New `voidLine` and `receiptPrint` fields default to denied for older servers and
  cached grants. Update the POS API and mobile app together, then refresh/sync.

## Verification

Mobile tests cover denied cart edits, stale quick/customer permissions, missing
printing grants, expiry, authorization suspension and preservation of paid work.
POS tests cover explicit manager denials, approval requirements, denied print
requests and current permissions overriding old grants, alongside existing
tenant, price, device revocation and idempotent sale integration tests.

Stock counts, adjustment approvals, hardware management and Business app access
must receive their own server-enforced existing-module permissions when those
workflows are implemented. Device authorization must never imply those grants.
