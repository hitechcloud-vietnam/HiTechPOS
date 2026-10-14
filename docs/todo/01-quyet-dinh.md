# 01 – Quyết định của công ty

Mã nguồn đã có sẵn chỗ để áp dụng; chỉ cần quyết định rồi sửa cấu hình/nội dung.

## 1.1 Áp dụng thật giới hạn tính năng theo gói
- Hiện trạng: chỉ `custom-domain` bị chặn theo gói (`apps/control-plane/src/domains.js`). Hoá đơn điện tử, payOS/Pay2S, khoá API dùng được ở mọi gói; giới hạn số thiết bị không được kiểm tra; `white-label` có trong `plans.js` nhưng chưa làm.
- Cần quyết: tính năng nào thuộc gói nào; có bỏ `white-label` khỏi `plans.js` không.
- Hoàn thành khi: mỗi tính năng trả 402 `plan_feature_missing` ở gói không có (mẫu: `domains.js` `tenantWithFeature`), trang bảng giá (`public/bang-gia.html`, test `public-pages.test.js`) khớp.

## 1.2 Tiêu đề hoá đơn in
- Hiện trạng: máy bán hàng in “HOÁ ĐƠN BÁN HÀNG” (`upstream/pos/api/src/helpers/vn-bill.js`, `frontend/.../receipt-designer.js`), onboarding đặt tiêu đề “PHIẾU THANH TOÁN” (`apps/control-plane/src/onboarding.js`).
- Đề xuất: “PHIẾU THANH TOÁN” (theo Nghị định 123, “hoá đơn” là hoá đơn điện tử).
- Hoàn thành khi: một tiêu đề thống nhất ở cả hai nơi, test `tests/vietnamese-bill.test.js` cập nhật.

## 1.3 Thông tin pháp lý và hỗ trợ
- Điền MST, địa chỉ trụ sở, hotline, email hỗ trợ, người đại diện, email tiếp nhận yêu cầu dữ liệu cá nhân, nơi đặt máy chủ: các ô `<span class="ph">[…]</span>` trong `apps/control-plane/public/{dieu-khoan,bao-mat,bang-gia,tinh-nang}.html`; email `hotro@hitechpos.vn` (tạm) trong `public/help/`.
- Pháp chế duyệt `dieu-khoan.html`, `bao-mat.html` (Nghị định 13/2023 và luật bảo vệ dữ liệu cá nhân hiện hành) → bỏ banner dự thảo, bỏ `noindex`, thêm lại vào `public/sitemap.xml` và sửa test `public-pages.test.js`.
- Chính sách cần quyết: hoàn tiền, báo trước khi đổi giá, thời gian giữ dữ liệu sau khi tạm ngưng, SLA, giới hạn trách nhiệm, cơ quan giải quyết tranh chấp.

## 1.4 Thuế phí thuê bao
- `SAAS_VAT_RATE` mặc định `KCT` (không chịu thuế). Kế toán xác nhận; nếu chịu thuế, đặt biến môi trường và xem 1.5.
- Hiện không có hoá đơn điện tử cho phí thuê bao của chính HiTechCloud: cần quyết dùng nhà cung cấp nào và tích hợp vào `billing.js` (`activate`).

## 1.5 Chính sách đổi gói
- Hiện đổi gói áp dụng gói mới cho toàn bộ thời gian còn lại, không tính chênh lệch (`admin-console.js`, `billing.js`). Xác nhận đây là chính sách mong muốn.

## 1.6 Hoa hồng đại lý
- `docs/DOI-TAC.md`: không có mức mặc định, mỗi đại lý phải đặt khi tạo. Quyết định khung hoa hồng chuẩn.
