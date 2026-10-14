# Nhật ký thay đổi

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo [SemVer](https://semver.org/lang/vi/). Phát hành: gắn tag `vX.Y.Z` trên `main`, hoặc chạy tay workflow **Release** (Actions → Release → Run workflow, nhánh `main`, nhập phiên bản); workflow tạo tag và bản phát hành với nội dung mục tương ứng dưới đây.

## [0.2.1] - 2026-10-14

### Thêm
- **Tài liệu triển khai chi tiết** `docs/DEPLOYMENT.md`: từ máy chủ Ubuntu 24.04 trống đến production (DNS, tường lửa, Node/PM2, Caddy có TLS wildcard và tên miền riêng, MongoDB replica set có xác thực, cài đặt và build, bí mật, khởi chạy và danh sách kiểm tra bằng `curl`, cổng thanh toán, hoá đơn điện tử, email, ứng dụng Business, migration theo shop, nâng cấp/rollback, phát hành, mở rộng, giám sát, sao lưu/khôi phục, diễn tập thảm hoạ, bảo mật vận hành). Các bước đã được chạy thử; phần chưa chạy được ghi rõ.
- `docs/deploy/ENV.md` (mọi biến môi trường) và `docs/deploy/RUNBOOK.md` (vận hành hằng ngày, ~20 sự cố theo dạng triệu chứng → nguyên nhân → cách sửa).
- Trang `/billing/cancel` cho khách huỷ thanh toán phí thuê bao (trước đây 404).

### Sửa
- `deploy/bootstrap-secrets.sh` sinh `SESSION_SECRET` cho shard (trước đây phiên máy bán hàng mất sau mỗi lần khởi động lại).
- `deploy/ecosystem.config.js` báo lỗi rõ khi tệp env có nhưng không đọc được, thay vì khởi động với môi trường rỗng.
- Test Captain: regex tên miền thoát dấu chấm (CodeQL).

## [0.2.0] - 2026-10-14

Bản phát hành đầu tiên dùng được cho thử nghiệm với cửa hàng thật (xem phần “Còn lại” trước khi bán chính thức).

### Thêm
- **Đa cửa hàng (SaaS):** control plane đăng ký → cài shop Posnic → Việt hoá dữ liệu theo 15 ngành; shard Posnic phục vụ mọi shop; secret niêm phong AES-256-GCM theo shop; tên miền riêng (TXT + CNAME, TLS theo yêu cầu).
- **Thanh toán:** phí thuê bao qua payOS/Pay2S; thanh toán tại quầy VietQR/payOS/Pay2S về tài khoản shop, xác nhận tự động qua biến động số dư Pay2S, màn hình cho khách; danh sách 58 ngân hàng theo VietQR.
- **Hoá đơn điện tử:** Viettel S-Invoice, MISA meInvoice, Mắt Bão; chống phát hành trùng; tự phát hành từ đơn bán.
- **Máy bán hàng:** tiếng Việt, tiền VND ở mọi màn hình/báo cáo/PDF, hoá đơn in kiểu Việt Nam (VAT theo thuế suất, số tiền bằng chữ), tính tiền theo giờ cho karaoke/bida/sân, thương hiệu HiTechPOS.
- **Quản lý:** `/account` cho chủ shop; `/admin` cho vận hành (tìm shop, thao tác có nhật ký, doanh thu, MRR, chuyển đổi, rời bỏ); `/so-sach` sổ doanh thu S1-HKD và tổng hợp kê khai hộ kinh doanh; `/doi-tac` chương trình đại lý.
- **Trang công khai:** trợ giúp `/help`, bảng giá, tính năng, ngành nghề, điều khoản và chính sách bảo mật (dự thảo).
- **Ứng dụng di động:** Business (đăng nhập qua HiTechPOS Cloud bằng PKCE), Captain, Mobile POS mang thương hiệu HiTechPOS.
- **Vận hành:** PM2 + Caddy, `/readyz`, `/metrics` (Prometheus), sao lưu/khôi phục từng shop, migration theo shop, email thông báo.
- **Kiểm thử:** unit control plane và package, bộ unit Posnic API, e2e API, e2e trình duyệt (Playwright) trong CI.

### Bảo mật
- Webhook của shop chỉ xác nhận được đơn bán của chính shop đó; giới hạn tần suất theo khoá API của từng shop; xác nhận chuyển khoản tại quầy chống CSRF; so khớp chính xác token biến động số dư; giữ chỗ tên miền con dễ bị dùng để lừa đảo; hiển thị dữ liệu nhà cung cấp dạng chữ.

### Còn lại
- Xem [`plan.md`](plan.md) và [`docs/todo/`](docs/todo/README.md): các quyết định kinh doanh/pháp lý, xác minh tích hợp với tài liệu gốc (điểm `UNVERIFIED`), xác minh email khi đăng ký, phát hành ứng dụng di động.

## [0.1.0] - 2026-10-14

### Thêm
- Nhập mã Posnic (POS, Business, Mobile, Captain, extension) vào `upstream/`, gói thanh toán payOS/Pay2S, VietQR, định dạng Việt Nam, preset ngành nghề, control plane ban đầu, CI.
