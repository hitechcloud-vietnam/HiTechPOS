# @hitechpos/payment-core

Hợp đồng chung cho mọi cổng thanh toán của HiTechPOS.

- `createProviderRegistry()` – đăng ký các adapter (`payos`, `pay2s`, …) theo hợp đồng `createCheckout` / `verifyCallback`.
- `createJournal()` – sổ nhật ký thanh toán, nơi **duy nhất** thay đổi trạng thái giao dịch:
  - callback trùng (`eventKey`) bị bỏ qua;
  - `paid` là trạng thái cuối, hủy muộn chỉ được ghi nhận, không áp dụng;
  - số tiền nhận khác số tiền yêu cầu → `review` (không bao giờ tự động `paid`);
  - khách chuyển khoản sau khi link hết hạn vẫn được ghi nhận `paid`.
- `requestJson()` – HTTP không tự retry (tránh trừ tiền hai lần), từ chối redirect.
- `transferDescription()` – nội dung chuyển khoản ASCII, giới hạn độ dài theo NAPAS/cổng.
- `generateOrderCode()` – mã đơn số nguyên an toàn cho payOS.

```js
const { createJournal } = require('@hitechpos/payment-core');
const journal = createJournal();
await journal.open({ orderCode, provider: 'payos', amount: 199000, purpose: 'subscription' });
const { payment } = await journal.apply(await provider.verifyCallback({ body: rawBody }));
```
