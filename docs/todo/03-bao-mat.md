# 03 – Bảo mật còn mở

Các phát hiện nghiêm trọng của đợt rà soát đã sửa (xem lịch sử PR #2). Còn lại:

## 3.1 Cảnh báo CodeQL
Kết quả quét cục bộ bằng CodeQL 2.27.2, bộ `javascript-code-scanning` (cùng bộ GitHub dùng), trên `main` ngày 14/10/2026:
- **Mã HiTechPOS (`apps/`, `packages/`, `scripts/`): 0 cảnh báo.**
- **Mã Posnic nhập về (`upstream/`): 452 cảnh báo.** Đối chiếu `git blame`: chỉ 1 cảnh báo nằm trên dòng do HiTechPOS sửa (test Captain, đã sửa); còn lại đều là mã gốc Posnic.

| Quy tắc CodeQL | Số cảnh báo |
|---|---|
| `js/sql-injection` | 266 |
| `js/html-constructed-from-input` | 25 |
| `js/xss-through-dom` | 25 |
| `js/path-injection` | 18 |
| `js/redos` | 18 |
| `js/incomplete-multi-character-sanitization` | 13 |
| `js/identity-replacement` | 13 |
| `js/missing-rate-limiting` | 11 |
| `js/useless-regexp-character-escape` | 9 |
| `js/insufficient-password-hash` | 8 |
| `js/polynomial-redos` | 7 |
| `js/bad-tag-filter` | 6 |
| `js/incomplete-sanitization` | 5 |
| `js/unsafe-jquery-plugin` | 4 |
| `js/overly-large-range` | 4 |
| (các quy tắc khác) | 20 |

Theo thư mục: `upstream/pos` 435, `upstream/captain` 17

Việc cần làm:
- Rà theo mức độ: `js/sql-injection` (truy vấn Mongo dựng từ `req.body`/`req.query` – kiểm tra kiểu dữ liệu đầu vào hoặc ép `String()`), `js/path-injection` (`upstream/pos/api/app.js` ~dòng 728–751), `js/xss-through-dom` / `js/html-constructed-from-input` (frontend), `js/redos` (`customers.constants.js` dòng 124), `js/missing-rate-limiting`.
- Sửa nên gửi ngược về Posnic (ghi `docs/UPSTREAM.md`). Báo nhầm thì dismiss trên GitHub kèm lý do.
- Cách quét lại cục bộ: tải `codeql-bundle-linux64` từ github/codeql-action, `codeql database create db --language=javascript-typescript --source-root=.`, `codeql database analyze db codeql/javascript-queries:codeql-suites/javascript-code-scanning.qls --format=sarif-latest --output=cq.sarif`.
- Cấu hình CodeQL ở mức repo: bỏ chọn Java/Kotlin và Swift (repo không có mã ngôn ngữ đó).

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
