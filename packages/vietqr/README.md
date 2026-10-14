# @hitechpos/vietqr

Tạo mã VietQR (chuyển khoản nhanh NAPAS 247, chuẩn EMVCo Merchant-Presented QR) **ngoại tuyến**,
giúp máy POS hiển thị mã QR chuyển khoản mà không cần cổng thanh toán. Không có phụ thuộc runtime;
dùng thư viện vẽ QR bất kỳ ở phía giao diện để hiển thị chuỗi payload.

```js
const { buildVietQR, decodeVietQR, parseEMV, verifyCRC, vietQrImageUrl } = require('@hitechpos/vietqr');

// QR tĩnh (khách tự nhập số tiền)
buildVietQR({ bin: '970436', accountNumber: '1234567890' });

// QR động: có số tiền + nội dung chuyển khoản
const payload = buildVietQR({
  bin: '970436',             // Vietcombank (xem findBank trong @hitechpos/vn-locale)
  accountNumber: '1234567890',
  amount: 1250000,
  addInfo: 'Thanh toán HD0001', // => "Thanh toan HD0001"
});

verifyCRC(payload);    // true
decodeVietQR(payload); // { bin: '970436', accountNumber: '1234567890', amount: 1250000, dynamic: true, ... }
parseEMV(payload);     // cây TLV [{ id, length, value, children? }]

// Ảnh QR qua dịch vụ công khai img.vietqr.io (cần Internet)
vietQrImageUrl({ bin: '970436', accountNumber: '1234567890', amount: 50000, addInfo: 'HD01', accountName: 'NGUYEN VAN A' });
// https://img.vietqr.io/image/970436-1234567890-compact2.png?amount=50000&addInfo=HD01&accountName=NGUYEN%20VAN%20A
```

## Cấu trúc payload

| Trường | Giá trị |
|---|---|
| `00` | `01` (phiên bản) |
| `01` | `11` tĩnh / `12` động (mặc định động khi có số tiền; ghi đè bằng `dynamic`) |
| `38` | `00` GUID `A000000727`; `01` { `00` BIN, `01` số TK/số thẻ }; `02` `QRIBFTTA` (tài khoản) hoặc `QRIBFTTC` (thẻ) |
| `53` | `704` (VND) |
| `54` | số tiền, số nguyên |
| `58` | `VN` |
| `62` | `08` nội dung chuyển khoản |
| `63` | CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), 4 ký tự hex in hoa, tính trên toàn bộ chuỗi kể cả `6304` |

**Nội dung chuyển khoản** (`addInfo`) được chuẩn hóa: bỏ dấu tiếng Việt (kể cả đ/Đ), chỉ giữ
chữ, số và khoảng trắng, cắt tối đa **25 ký tự** — giới hạn an toàn thường dùng vì nhiều ứng dụng
ngân hàng từ chối ký tự đặc biệt hoặc nội dung dài. Có thể gọi riêng `sanitizeAddInfo(text)`.
