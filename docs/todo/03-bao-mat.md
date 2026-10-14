# 03 – Bảo mật còn mở

Các phát hiện nghiêm trọng của đợt rà soát đã sửa (xem lịch sử PR #2). Còn lại:

## 3.1 Cảnh báo CodeQL
- Lần quét cuối báo các cảnh báo “mới” trên PR lớn, gồm cả mã Posnic có sẵn. Xem tại GitHub → Security → Code scanning (lọc `pr:` hoặc nhánh `main`).
- Mỗi cảnh báo: sửa nếu có đường khai thác thật; nếu là báo nhầm, dismiss kèm lý do. Hai cảnh báo trong `upstream/pos/src/main.js` là mã gốc Posnic (đã giải thích ở PR #2).
- Cấu hình CodeQL ở mức repo: bỏ chọn Java/Kotlin và Swift (repo không có mã ngôn ngữ đó, job báo lỗi).

## 3.2 Xác minh email khi đăng ký
- Hiện ai cũng có thể đăng ký bằng email người khác; email chào mừng (có tên cửa hàng do người đăng ký đặt) được gửi tới địa chỉ đó. Cần: gửi liên kết xác minh trước, chỉ kích hoạt cửa hàng/gửi chào mừng sau khi xác minh. Tệp: `apps/control-plane/src/app.js` (`/api/signup`), `notify.js`.
- Cùng lúc: giảm khả năng dò tài khoản (thời gian đăng nhập, `email_taken`).

## 3.3 Hoá đơn điện tử: lỗi không phải `EInvoiceError`
- `withIssueGuard` (`packages/einvoice-vn`) xoá dòng chống trùng với mọi lỗi không phải `EInvoiceError` (ví dụ `TypeError` khi đọc phản hồi 200), cho phép phát hành lại. Nên coi các lỗi này là “không rõ kết quả” (`unknown`) và bắt đối soát.

## 3.4 Xuất dữ liệu còn chứa secret của Posnic
- `/api/shop/export` (`store/mongo.js` `exportShop`): danh sách loại trừ thiếu một số trường secret của Posnic (khoá cổng thanh toán, mật khẩu SMTP). Bổ sung và thêm test.

## 3.5 Nhỏ
- `secrets.open` (`apps/control-plane/src/secrets.js`) nên cố định độ dài GCM tag = 16 (`authTagLength`). Giữ test `secrets.test.js` xanh.
- Shard: giới hạn tần suất theo từng shop phía shard; webhook đi ra của Posnic đang cho phép đích `127.0.0.1` ở production.
- `/metrics` truy cập được từ Internet (có token): cân nhắc giới hạn IP trong `deploy/Caddyfile`.
