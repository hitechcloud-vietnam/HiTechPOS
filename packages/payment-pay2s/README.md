# @hitechpos/payment-pay2s

Adapter Pay2S (https://docs.pay2s.vn) – cổng thanh toán chuyển khoản/QR, nhận IPN.

| API Pay2S | Hàm |
|---|---|
| `POST /v1/gateway/api/create` | `client.createPayment()` / `provider.createCheckout()` |
| IPN (server-to-server) | `client.verifyIpn()` / `provider.verifyCallback({ body })` |
| Redirect về `redirectUrl` | `client.verifyRedirect(query)` (chỉ để hiển thị, không dùng để chốt đơn) |

Môi trường: `sandbox` → `https://sandbox-payment.pay2s.vn`, `production` → `https://payment.pay2s.vn`.

Chữ ký: HMAC-SHA256 (hex) trên danh sách trường cố định nối `key=value&…`, `bankAccounts` ký dưới dạng `bankAccounts=Array`; callback mang chữ ký ở `m2signature`. Vector kiểm thử sinh từ `pay2s-node` 0.3.0.

> ⚠️ Trước khi chạy production: đối chiếu danh sách trường ký, mã `resultCode` thành công (adapter coi `0` là thành công) và định dạng phản hồi IPN với hợp đồng tài khoản Pay2S của doanh nghiệp. Tài liệu docs.pay2s.vn không truy cập được từ môi trường build lúc viết code.

```js
const { createPay2SProvider } = require('@hitechpos/payment-pay2s');
const pay2s = createPay2SProvider({
  environment: 'sandbox',
  accessKey: process.env.PAY2S_ACCESS_KEY,
  partnerCode: process.env.PAY2S_PARTNER_CODE,
  secretKey: process.env.PAY2S_SECRET_KEY,
});
```
