# Hướng dẫn sử dụng (Trung tâm trợ giúp)

Hướng dẫn cho chủ cửa hàng và thu ngân được phục vụ ngay trên control plane, tại **https://app.hitechpos.vn/help/** (chạy thử: `http://127.0.0.1:4100/help/`). Trang chủ (`/`) và trang quản lý (`/account`) có liên kết “Trợ giúp”.

| Trang | Nội dung |
|---|---|
| `/help/bat-dau` | Đăng ký dùng thử, chọn ngành nghề, máy bán hàng `<shop>.hitechpos.vn` và trang quản lý `/account`, dữ liệu mẫu |
| `/help/ban-hang` | Tạo đơn, tiền mặt, phương thức ghi nhận thủ công |
| `/help/thanh-toan-qr` | QR chuyển khoản VietQR/payOS/Pay2S, nút “Đã nhận tiền”, biến động số dư Pay2S, màn hình cho khách `/pay/...`, trạng thái, sự cố |
| `/help/cau-hinh-thanh-toan` | Cấu hình VietQR, payOS, Pay2S, webhook, mã bảo mật biến động số dư |
| `/help/hoa-don-dien-tu` | MISA meInvoice, Viettel S-Invoice, Mắt Bão; ký hiệu `1C26MAA`; tự động phát hành; đối soát |
| `/help/goi-cuoc` | Bảng giá, chu kỳ, gia hạn, hết hạn/tạm ngưng, giới hạn gói |
| `/help/ten-mien-rieng` | Tên miền riêng (TXT + CNAME) |
| `/help/tai-khoan` | Đổi/quên mật khẩu, khoá API, xuất dữ liệu |
| `/help/cau-hoi-thuong-gap` | Câu hỏi thường gặp, liên hệ hỗ trợ |

## Sửa nội dung

- Tệp tĩnh trong `apps/control-plane/public/help/`: mỗi trang một tệp `.html`, dùng chung `help.css` và `help.js` (không có script inline, hợp CSP).
- Ô tìm kiếm đọc `help/search-index.json` (mỗi mục: `u` đường dẫn kèm `#neo`, `t` tiêu đề, `p` trang, `x` nội dung). Thêm hoặc đổi tiêu đề mục thì cập nhật mục tương ứng trong tệp này.
- Chỉ mô tả tính năng đã có trong mã. Khi đổi giá/giới hạn trong `apps/control-plane/src/plans.js`, sửa bảng ở `goi-cuoc.html`.
- `apps/control-plane/test/help.test.js` kiểm tra mọi trang trả về 200, đúng tiêu đề, mọi liên kết nội bộ và neo `#...` giữa các trang trợ giúp, và mọi mục của chỉ mục tìm kiếm.
- Email hỗ trợ `hotro@hitechpos.vn` trên các trang là địa chỉ tạm, cần xác nhận trước khi chạy thật.
