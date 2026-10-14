# @hitechpos/payment-payos

Adapter payOS (https://payos.vn/docs/) – tạo link/QR VietQR chuyển khoản, nhận webhook.
Không phụ thuộc SDK; thuật toán chữ ký được kiểm thử bằng vector sinh từ SDK chính thức `@payos/node` 2.0.5.

| API payOS | Hàm |
|---|---|
| `POST /v2/payment-requests` | `client.createPaymentLink()` / `provider.createCheckout()` |
| `GET /v2/payment-requests/{id}` | `client.getPaymentLink()` / `provider.getStatus()` |
| `POST /v2/payment-requests/{id}/cancel` | `client.cancelPaymentLink()` |
| `POST /confirm-webhook` | `client.confirmWebhook(url)` |
| Webhook | `provider.verifyCallback({ body })` |

```js
const { createPayOSProvider } = require('@hitechpos/payment-payos');
const payos = createPayOSProvider({
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY,
});
const { checkoutUrl, qrCode } = await payos.createCheckout({
  orderCode, amount: 199000, description: 'Goi Co ban T10',
  returnUrl: 'https://app.hitechpos.vn/billing/return',
  cancelUrl: 'https://app.hitechpos.vn/billing/cancel',
});
```

Lưu ý vận hành:
- `description` tối đa 25 ký tự với tài khoản ngân hàng không liên kết qua payOS (adapter tự cắt và bỏ dấu).
- Phản hồi có chữ ký sai bị từ chối (`payos_response_signature_invalid`).
- Webhook chỉ coi `data.code === '00'` là đã thanh toán; luôn trả HTTP 200 cho webhook đã xác thực (kể cả đơn không tồn tại – payOS gửi payload thử khi `confirm-webhook`).
