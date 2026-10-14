# 04 – Máy bán hàng (Posnic, `upstream/pos`)

Mọi bản vá phải ghi vào `docs/UPSTREAM.md`.

## 4.1 Màn hình thanh toán hiện “default” và “Tổng SL 1.00”
- `frontend/static/script/js/core/receipt-designer.js`: tổng số lượng là tổng thô (~dòng 252, nhãn ~dòng 357); “default” có lẽ là đơn vị đọc từ `#addSalesLineItemUnit_<id>`. Hiển thị số lượng theo định dạng Việt Nam (1, 1,5) và bỏ đơn vị “default”.
- Bật `E2E_UI_STRICT=1` khi chạy `scripts/e2e-ui.mjs` để kiểm.

## 4.2 Định dạng tiền còn sót
- `modules/js/report_kot.js` (~60 chỗ `toFixed(2)`), `invoices.js`/báo giá, bảng hoạt động trong `items.js`, `categories.js`, `customer_categories.js` (đang có test chốt đầu ra cũ).
- Phía server: placeholder tin nhắn `whatsapp.controller.js`, chuỗi biểu đồ mặt hàng trong `sales.controller.js` (~dòng 4331), chuỗi “Ask Posnic”, `totalAmountDue` ở dashboard, `auth-utils.controller.js` mặc định `currency_type: 'USD'`.
- Dùng `PosnicPro.money` (frontend) và `api/src/utils/money-text.js` (server). Test mẫu: `tests/vnd-views-reports-prints.test.js`.

## 4.3 In ấn
- ESC/POS in thô chưa có dòng “Bằng chữ” (`escpos-receipt.js`; hàm `amountInWords` ở `api/src/helpers/vn-bill.js`).
- Mẫu A4 cũ chưa Việt hoá (đơn bán A4 đã in qua receipt designer tiếng Việt).

## 4.4 Thương hiệu Posnic còn sót
- Tính năng AI “Ask Posnic” (~20 chuỗi vi) và liên kết posnic.com/account của nó.
- Liên kết hoá đơn qua SMS `www.posnic.com/...` (mã Brevo/MSG91), người gửi mặc định `info@posnic.com` trong `email.js`.
- Liên kết cập nhật bản desktop/Electron.
- Giữ nguyên ghi công AGPL và liên kết mã nguồn.

## 4.5 Tính tiền theo giờ
- Thông báo lỗi của API tính giờ (`api/src/services/table-time-billing.js`) còn tiếng Anh như phần còn lại của Posnic: map sang tiếng Việt ở `kot_v2.js`.
- Giá giờ tối đa 1.000.000 đ/giờ (trần kiểm giá mở); khung giờ luôn theo UTC+7.

## 4.6 Dữ liệu cũ lệch giờ
- Đơn bán lưu trước bản sửa múi giờ (`api/src/helpers/shop-wall-clock.js`) bị lệch +7 giờ. Viết migration dời lại thời điểm bán của các đơn tạo trước bản sửa (xác định theo thời điểm triển khai bản sửa và `_id`), chạy qua `scripts/run-tenant-migrations.js`.

## 4.7 Nhỏ, phát hiện khi chạy thử triển khai
- `POST /api/install/add` không có body trả 500 (`Cannot read properties of undefined (reading 'key')`) thay vì 401.
- Thông báo cho khách vẫn tiếng Anh: shop bị tạm ngưng (“This shop is suspended.”) và khi chưa build frontend (“Welcome to the Posnic API v2”) – `upstream/pos/api/shard.js`, `app.js`.
