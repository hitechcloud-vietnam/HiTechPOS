# API HiTechPOS

Hai nhóm API:

- **API cửa hàng (Posnic)** tại `https://<shop>.hitechpos.vn/api/...`: toàn bộ nghiệp vụ bán hàng, hàng hoá, khách hàng… của Posnic. Xem [upstream/pos/docs/API.md](../upstream/pos/docs/API.md).
- **API nền tảng HiTechPOS** tại `https://app.hitechpos.vn`: thanh toán tại quầy, hoá đơn điện tử, cấu hình cửa hàng. Mô tả trong tài liệu này.

Mọi số tiền là **số nguyên VND**. Lỗi trả về dạng `{ "error": "<mã>", "message": "<tiếng Việt>", "details"? }`.

## Xác thực

| Ai | Cách | Lấy ở đâu |
|---|---|---|
| Máy POS / tích hợp | `Authorization: Bearer htp_live_…` | `/account` → *Khoá API cho máy bán hàng* (chỉ hiện một lần, lưu dạng băm) |
| Chủ cửa hàng (trang quản lý) | `Authorization: Bearer <JWT>` từ `POST /api/auth/login` | Hết hạn sau 7 ngày; đổi mật khẩu thì mọi phiên cũ bị huỷ |
| Nhân viên HiTechCloud | `X-Admin-Key` | `/etc/hitechpos/control-plane.env` |

Giới hạn tần suất mặc định: đăng nhập 20 lần/15 phút/IP, đăng ký 10 lần/giờ/IP, API POS 300 lần/phút/khoá. Vượt giới hạn trả `429` kèm `Retry-After`.

## Thanh toán tại quầy – `/pos/v1/payments`

### Tạo thanh toán
`POST /pos/v1/payments`

```json
{ "saleRef": "HD-000123", "amount": 85000, "method": "vietqr", "description": "Ban 5" }
```

- `saleRef`: mã hoá đơn phía POS, 1–64 ký tự `[A-Za-z0-9_.:-]`. **Idempotent**: gọi lại cùng `saleRef` + số tiền + phương thức thì nhận lại đúng giao dịch đang mở. Nếu đổi số tiền, giao dịch cũ bị huỷ và tạo giao dịch mới. Nếu hoá đơn đã thanh toán thì trả `409 sale_already_paid`.
- `method`: `vietqr` | `payos` | `pay2s`. Bỏ trống thì dùng phương thức mặc định của shop.

Phản hồi `201`:

```json
{
  "orderCode": 1791966752534703, "method": "vietqr", "status": "pending", "amount": 85000,
  "saleRef": "HD-000123", "qrPayload": "000201010212…6304ABCD",
  "qrImageUrl": "https://app.hitechpos.vn/api/public/pay/<shopId>/<orderCode>/qr.svg",
  "displayUrl": "https://app.hitechpos.vn/pay/<shopId>/<orderCode>",
  "checkoutUrl": null, "bank": { "bin": "970422", "bankName": "MB Bank", "accountNumber": "…", "accountName": "…" }
}
```

`displayUrl` là màn hình cho khách: hiện QR và tự chuyển xanh khi đã thanh toán. Mở trên màn hình phụ hoặc máy tính bảng.

### Trạng thái, xác nhận, huỷ
- `GET /pos/v1/payments/:orderCode` → `status`: `pending` | `paid` | `review` (số tiền nhận khác yêu cầu) | `cancelled` | `expired` | `failed`. Nên thăm dò mỗi 2–3 giây.
- `POST /pos/v1/payments/:orderCode/confirm` `{ "by": "Thu ngân A" }`: thu ngân xác nhận đã nhận chuyển khoản (chỉ dùng cho `vietqr`).
- `POST /pos/v1/payments/:orderCode/cancel`

Với `payos`/`pay2s`, trạng thái tự chuyển `paid` khi cổng gửi webhook. Với `vietqr`, trạng thái tự chuyển khi bật **biến động số dư Pay2S**, nếu không thì thu ngân phải xác nhận.

## Hoá đơn điện tử – `/pos/v1/einvoices`

`POST /pos/v1/einvoices`

```json
{
  "refId": "HD-000123",
  "paymentMethod": "TM",
  "pricesIncludeVat": true,
  "buyer": { "companyName": "Công ty ABC", "taxCode": "0101248141", "address": "…", "email": "ketoan@abc.vn" },
  "lines": [
    { "code": "CF01", "name": "Cà phê sữa đá", "unit": "ly", "quantity": 2, "unitPrice": 29000, "vatRate": 8 },
    { "name": "Chiết khấu thành viên", "kind": "discount", "amount": 5000, "vatRate": 8 }
  ]
}
```

- `vatRate`: `0 | 5 | 8 | 10 | "KCT" | "KKKNT"`; `kind`: `goods` (mặc định) | `promotion` | `discount` | `note`; `buyer` rỗng nghĩa là khách lẻ không lấy hoá đơn.
- Mỗi `refId` chỉ được phát hành **một** hoá đơn. Gọi lại thì nhận lại hoá đơn đã có. Nếu lần trước chưa rõ kết quả, API trả `409 einvoice_outcome_unknown` cho đến khi đối soát.
- `GET /pos/v1/einvoices/:refId`, `POST /pos/v1/einvoices/:refId/reconcile`, `GET /pos/v1/einvoices/:refId/pdf`.

Shop bật *Tự động phát hành khi chốt đơn* thì HiTechPOS tự phát hành cho đơn bán trên máy Posnic, POS không cần gọi API này.

## Webhook nhận từ cổng thanh toán

| URL | Nguồn | Xác thực |
|---|---|---|
| `/webhooks/payos`, `/webhooks/pay2s` | Thanh toán phí thuê bao HiTechPOS | Chữ ký payOS / `m2signature` Pay2S bằng khoá của HiTechCloud |
| `/webhooks/shop/:shopId/payos`, `/pay2s` | Thanh toán tại quầy của shop | Chữ ký bằng khoá riêng của shop đó |
| `/webhooks/shop/:shopId/bank-feed` | Biến động số dư Pay2S | `Authorization: Bearer <mã bảo mật shop đặt>` |

Webhook đã xác thực luôn được trả `200`. Webhook giả mạo bị trả `401`.

## Ví dụ

```sh
KEY=htp_live_xxx
curl -s -X POST https://app.hitechpos.vn/pos/v1/payments \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"saleRef":"HD-000123","amount":85000}'
```
