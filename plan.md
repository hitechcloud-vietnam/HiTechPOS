# Kế hoạch HiTechPOS

Nền tảng POS SaaS đa ngành cho thị trường Việt Nam, xây trên Posnic (AGPL-3.0). Tài liệu này cho biết **đã có gì** và **còn gì**; chi tiết từng việc còn dở nằm trong [`docs/todo/`](docs/todo/README.md).

## Đã có (nhánh `main`)

| Mảng | Nội dung | Tài liệu |
|---|---|---|
| Đa cửa hàng | Control plane đăng ký → cài shop → Việt hoá dữ liệu theo 15 ngành; shard Posnic phục vụ mọi shop, secret niêm phong theo shop | `docs/ARCHITECTURE.md` |
| Thanh toán | Phí thuê bao qua payOS/Pay2S; thanh toán tại quầy VietQR/payOS/Pay2S về tài khoản shop, biến động số dư Pay2S, màn hình cho khách | `docs/API.md` |
| Hoá đơn điện tử | Viettel, MISA, Mắt Bão (+ giả lập), chống phát hành trùng, tự phát hành từ đơn bán | `docs/API.md` |
| Máy bán hàng | Tiếng Việt, tiền VND, hoá đơn in kiểu Việt Nam (VAT theo thuế suất, số tiền bằng chữ), tính tiền theo giờ karaoke/bida, thương hiệu HiTechPOS | `docs/UPSTREAM.md` |
| Quản lý | `/account` chủ shop, `/admin` vận hành (nhật ký thao tác, doanh thu, MRR), `/so-sach` sổ S1-HKD, `/doi-tac` đại lý | `docs/SO-SACH-THUE.md`, `docs/DOI-TAC.md` |
| Trang công khai | Trợ giúp `/help`, bảng giá, tính năng, ngành nghề, điều khoản & bảo mật (dự thảo) | `docs/HUONG-DAN.md` |
| Ứng dụng di động | Business (đăng nhập qua HiTechPOS Cloud), Captain, Mobile POS mang thương hiệu HiTechPOS | `docs/BUSINESS-APP.md` |
| Vận hành | PM2 + Caddy (TLS wildcard, tên miền riêng), `/readyz`, `/metrics`, sao lưu/khôi phục từng shop | `docs/DEPLOYMENT.md` |
| Kiểm thử | Unit control plane & package, ~13k test Posnic API, e2e API, e2e trình duyệt (Playwright) trong CI | `.github/workflows/ci.yml` |

## Còn lại – theo thứ tự ưu tiên

### P0 – trước khi bán cho khách thật
1. **Quyết định kinh doanh/pháp lý**: giới hạn tính năng theo gói, tiêu đề hoá đơn in, thông tin công ty, duyệt điều khoản/chính sách bảo mật, thuế phí thuê bao → [01](docs/todo/01-quyet-dinh.md).
2. **Xác minh tích hợp** Pay2S/payOS/VietQR/MISA/Viettel/Mắt Bão với tài liệu gốc và sandbox (30 điểm `UNVERIFIED` ở hoá đơn điện tử) → [02](docs/todo/02-xac-minh-tich-hop.md).
3. **Bảo mật**: xác minh email khi đăng ký, xử lý cảnh báo CodeQL còn mở, guard hoá đơn điện tử với lỗi lạ → [03](docs/todo/03-bao-mat.md).
4. **Vận hành**: `main` là nhánh mặc định, migration theo shop trong quy trình phát hành, SMTP/SPF/DKIM, diễn tập khôi phục → [07](docs/todo/07-van-hanh.md).

### P1 – hoàn thiện sản phẩm
5. Máy bán hàng: màn thanh toán (“default”, “Tổng SL 1.00”), định dạng tiền còn sót, “Bằng chữ” trên ESC/POS, thương hiệu Posnic còn sót, sửa dữ liệu giờ cũ → [04](docs/todo/04-may-ban-hang.md).
6. Control plane: tạo bàn/phòng mẫu khi onboarding karaoke/bida, `/api/mobile/*` cho Captain/Mobile, hoàn thiện đại lý & sổ sách → [05](docs/todo/05-control-plane.md).
7. Ứng dụng di động: icon, ký & phát hành, bản dịch tiếng Việt, liên kết chính sách → [06](docs/todo/06-ung-dung-di-dong.md).

### P2 – chất lượng
8. Lỗi test Posnic có sẵn, test chập chờn, job CI có Mongo thật → [08](docs/todo/08-chat-luong.md).

## Cách làm tiếp
- Đọc `CLAUDE.md` (quy ước mã) và `docs/UPSTREAM.md` (quy tắc sửa `upstream/`).
- Mỗi việc một nhánh + PR vào `main`; CI phải xanh (`npm test`, test Posnic API, e2e, e2e trình duyệt, CodeQL).
- Xong việc nào thì xoá mục tương ứng trong `docs/todo/` trong cùng PR.
- Chạy cục bộ: `npm ci`, `(cd upstream/pos/api && npm ci)`, `npm test`, `node scripts/e2e.mjs`, `node scripts/e2e-ui.mjs` (cần Chromium của Playwright).
