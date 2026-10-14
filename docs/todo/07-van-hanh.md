# 07 – Vận hành và triển khai

- Đặt `main` là nhánh mặc định trên GitHub (Settings → General → Default branch) – người có quyền admin repo làm.
- Migration theo từng shop: đưa `upstream/pos/scripts/run-tenant-migrations.js --apply` vào quy trình phát hành (sau khi cập nhật mã, trước khi reload shard). Lần đầu áp dụng `003-vietnamese-default-bill` cho các shop hiện có.
- Cài `mongodb-database-tools` trên máy chủ cho `scripts/backup` và chạy thử khôi phục định kỳ (diễn tập).
- Email: cấu hình SMTP, SPF/DKIM/DMARC cho tên miền gửi; thay địa chỉ hỗ trợ tạm.
- Đăng ký webhook payOS/Pay2S của nền tảng và kiểm tra bằng giao dịch thật nhỏ.
- Tài liệu triển khai chi tiết: `docs/DEPLOYMENT.md` (và `docs/deploy/` nếu có) – cập nhật khi quy trình thay đổi.
- Nhiều tiến trình control plane: giới hạn tần suất đang lưu trong bộ nhớ từng tiến trình → khi chạy nhiều bản cần store chung (Redis/Mongo).

## Phát hiện khi chạy thử tài liệu triển khai (14/10/2026)
- `restore-tenant.sh` cần user Mongo có **cả** vai trò `restore` và `backup` (bước đếm document sau khi khôi phục cần quyền đọc); tài liệu đã ghi đúng, có thể gộp thành một vai trò tuỳ biến.
- `deploy/ecosystem.config.js` đặt cứng `PORT`, `HOST`, `SHARD_URL`, `SHARD_PORT`, `POSNIC_BRAND_DIR`… sau khi đọc tệp env nên giá trị trong tệp env bị bỏ qua (xem `docs/deploy/ENV.md`). Cân nhắc cho tệp env ghi đè.
- `TENANT_MONGO_URI` chỉ được dùng một phần: `shopBridge` và shard luôn dùng `CONTROL_URI` → DB của shop chưa tách được sang cụm khác. `SHARD_INSTANCE` cần điền `instance` cho các tenant có sẵn; một control plane chỉ trỏ tới một `SHARD_URL`.
- `PAY2S_ENV` mặc định `sandbox` cho phí thuê bao nhưng `production` cho thanh toán tại quầy của shop – thống nhất và ghi rõ.
- `deploy/docker-compose.yml` (chỉ để staging): chưa publish cổng shard cho Caddy, `npm ci` của shard thiếu `--ignore-scripts` và cách tránh registry npmmirror, chưa build frontend, Mongo không xác thực, secret chia ở hai nơi.
- Shard ghi `rate_limits` vào DB mặc định của URI (`test`) khi `CONTROL_URI` không có tên DB – vô hại nhưng DB này không được sao lưu: đặt tên DB trong URI hoặc sửa shard.
