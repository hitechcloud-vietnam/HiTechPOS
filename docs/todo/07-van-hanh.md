# 07 – Vận hành và triển khai

- Đặt `main` là nhánh mặc định trên GitHub (Settings → General → Default branch) – người có quyền admin repo làm.
- Migration theo từng shop: đưa `upstream/pos/scripts/run-tenant-migrations.js --apply` vào quy trình phát hành (sau khi cập nhật mã, trước khi reload shard). Lần đầu áp dụng `003-vietnamese-default-bill` cho các shop hiện có.
- Cài `mongodb-database-tools` trên máy chủ cho `scripts/backup` và chạy thử khôi phục định kỳ (diễn tập).
- Email: cấu hình SMTP, SPF/DKIM/DMARC cho tên miền gửi; thay địa chỉ hỗ trợ tạm.
- Đăng ký webhook payOS/Pay2S của nền tảng và kiểm tra bằng giao dịch thật nhỏ.
- Tài liệu triển khai chi tiết: `docs/DEPLOYMENT.md` (và `docs/deploy/` nếu có) – cập nhật khi quy trình thay đổi.
- Nhiều tiến trình control plane: giới hạn tần suất đang lưu trong bộ nhớ từng tiến trình → khi chạy nhiều bản cần store chung (Redis/Mongo).
