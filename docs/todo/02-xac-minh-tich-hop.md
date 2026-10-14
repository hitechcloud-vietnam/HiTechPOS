# 02 – Xác minh tích hợp với tài liệu gốc

Môi trường phát triển ban đầu bị chặn mạng tới tài liệu nhà cung cấp, nên một số chi tiết được đánh dấu `UNVERIFIED` trong mã. Cần mở mạng tới: docs.pay2s.vn, pay2s.vn, payos.vn, api.vietqr.io, doc.meinvoice.vn, viettelsolution.com.vn, matbao.in.

| Việc | Tệp | Số điểm `UNVERIFIED` |
|---|---|---|
| MISA meInvoice | `packages/einvoice-vn/src/providers/misa.js` | 11 |
| Viettel S-Invoice | `packages/einvoice-vn/src/providers/viettel.js` | 12 |
| Mắt Bão API-Proxy-HDDT | `packages/einvoice-vn/src/providers/matbao.js` | 7 |
| Pay2S thanh toán + biến động số dư | `packages/payment-pay2s/src/*.js` (trường ký, `bankAccounts`, webhook bank-feed theo pay2s-node 0.3.0) | xem comment đầu tệp |
| Danh sách ngân hàng VietQR | `packages/vn-locale` `banks.json` (58 mục, đối chiếu `https://api.vietqr.io/v2/banks`) | – |

Tiêu chí hoàn thành mỗi nhà cung cấp:
1. Đối chiếu từng điểm `UNVERIFIED` với tài liệu; sửa mã/test nếu lệch, xoá đánh dấu.
2. Chạy thật trên sandbox của nhà cung cấp: tạo → tra cứu → (huỷ/điều chỉnh với hoá đơn điện tử) → webhook, ghi lại kết quả trong PR.
3. Cập nhật `docs/API.md` và trang trợ giúp `apps/control-plane/public/help/hoa-don-dien-tu.html` / `cau-hinh-thanh-toan.html` nếu quy trình thay đổi.
