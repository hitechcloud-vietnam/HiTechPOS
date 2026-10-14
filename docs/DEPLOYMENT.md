# Triển khai

## Thành phần

| Dịch vụ | Mã | Cổng | Tên miền |
|---|---|---|---|
| Control plane | `apps/control-plane` | 4100 | `app.hitechpos.vn` |
| Posnic shard | `upstream/pos/api/shard.js` | 6000 | `*.hitechpos.vn` |
| MongoDB (replica set) | – | 27017 | nội bộ |

Reverse proxy (Nginx/Caddy/Traefik) kết thúc TLS: chứng chỉ wildcard `*.hitechpos.vn` (DNS-01), chuyển `app.` → control plane, còn lại → shard (giữ nguyên header `Host`). **Xoá header `x-hitech-shop` từ bên ngoài** ở proxy – chỉ control plane (mạng nội bộ) được gửi header này.

## Biến môi trường dùng chung
- `TENANT_SECRET_KEY` (64 hex) – **giống nhau** ở control plane và mọi shard; mất khoá = mất toàn bộ secret cửa hàng. Lưu trong secret manager.
- `POSNIC_KEY`/`POSNIC_SECRET` – khoá gọi trình cài đặt Posnic (`/api/install/add`).
- `SHARD_SHOP_HEADER=x-hitech-shop`, `SHOP_BASE_DOMAINS=hitechpos.vn`.

Control plane: xem `apps/control-plane/.env.example`.

## Các bước
1. Tạo MongoDB replica set, bật xác thực, sao lưu định kỳ (mỗi shop một DB `hitech_t_*`, control DB `hitechpos_control`).
2. `cd upstream/pos/api && npm ci --omit=dev`, chạy `node shard.js` (PM2/systemd). Kiểm tra lại các biến Posnic bắt buộc khác trong `upstream/pos/api/src/config` và `docs/CLOUD_OPERATIONS.md` của Posnic.
3. `npm ci --omit=dev` ở gốc, chạy `node apps/control-plane/src/server.js`.
4. Đăng ký webhook:
   - payOS: trong my.payos.vn hoặc `client.confirmWebhook('https://app.hitechpos.vn/webhooks/payos')` (route phải chạy trước khi xác nhận).
   - Pay2S: IPN gửi tới `https://app.hitechpos.vn/webhooks/pay2s` (được truyền tự động trong `ipnUrl`).
5. Lập lịch `POST /api/admin/jobs/enforce-expiry` (header `x-admin-key`) – server cũng tự chạy mỗi giờ.

`deploy/docker-compose.yml` là cấu hình tham khảo cho máy staging, chưa được kiểm thử tự động.
