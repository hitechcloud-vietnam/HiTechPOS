# 06 – Ứng dụng di động (`upstream/business`, `upstream/captain`, `upstream/mobile-app`)

Chi tiết từng app: `HITECHPOS.md` trong thư mục app.

- Thiết kế và thay icon/logo: Captain `assets/common/posnic-mark.svg` + icon Capacitor; Mobile `assets/icon.png`, `adaptive-icon.png`, `app-mark.svg`, `posnic.svg`, wordmark trong `src/components/Brand.tsx`; Business `assets/posnic-icon.png`.
- Ký và phát hành: Apple team/provisioning của HiTechPOS (`IOS_TEAM_ID`), khoá ký Play, keystore Captain, trang cửa hàng ứng dụng, dự án Expo push với khoá FCM/APNs.
- Liên kết chính sách bảo mật/xoá tài khoản trong Mobile vẫn trỏ Posnic; manifest tải iOS của Captain trỏ release GitHub của Posnic.
- Mobile và Business chưa có bản dịch tiếng Việt (mặc định tiếng Anh); chưa có màn “Giới thiệu” để ghi công “dựa trên Posnic (AGPL-3.0)”.
- Shard: trang đồng ý trong `upstream/pos/api/src/routes/business-access.routes.js` còn quay về `com.posnic.business://authorized` (đổi sang `vn.hitechpos.business://authorized`); helper ghép cặp/CORS còn nhắc `posnic.io`.
- Captain: 10 test trình duyệt trong `floor-line-actions.spec.js` đọc tệp trên máy Windows của tác giả gốc, `kitchen-message.test.js` bắt buộc Edge → sửa để chạy được trên CI Linux.
