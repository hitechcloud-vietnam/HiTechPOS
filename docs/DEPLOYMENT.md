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

## Triển khai một máy (PM2 + Caddy)

```sh
# 1. MongoDB replica set (rs0) đã chạy, Node 22, PM2, Caddy có module DNS
sudo MONGO_URI='mongodb://user:pass@127.0.0.1:27017/?replicaSet=rs0&authSource=admin' deploy/bootstrap-secrets.sh
npm ci --omit=dev
(cd upstream/pos/api && npm ci --omit=dev --ignore-scripts)   # lockfile Posnic trỏ registry.npmmirror.com; thêm
#   --replace-registry-host=registry.npmmirror.com --registry=https://registry.npmjs.org/ nếu mirror bị chặn
pm2 start deploy/ecosystem.config.js && pm2 save
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

DNS: `app.hitechpos.vn` và `*.hitechpos.vn` trỏ về máy chủ. Sau khi chạy, mở `https://app.hitechpos.vn/admin` với `ADMIN_API_KEY` trong `/etc/hitechpos/control-plane.env`.

Đặt `POSNIC_BRAND_DIR=<repo>/deploy/brand` cho tiến trình shard để hoá đơn PDF/A4 in logo và tên HiTechPOS.

Lưu ý đã kiểm chứng khi chạy thật:
- Cổng 6000 của shard bị `fetch` của trình duyệt/Node chặn (“bad port”) – control plane gọi shard bằng `node:http`, và shard chỉ nghe trên `127.0.0.1` sau Caddy.
- Secret mới của shop (ví dụ `HITECH_POS_KEY` khi bật thanh toán QR) có hiệu lực sau ≤ 60 giây (chu kỳ nạp registry của shard).

## Các bước
1. Tạo MongoDB replica set, bật xác thực, sao lưu định kỳ (mỗi shop một DB `hitech_t_*`, control DB `hitechpos_control`) – xem [Sao lưu & khôi phục](#sao-lưu--khôi-phục).
2. `cd upstream/pos/api && npm ci --omit=dev`, chạy `node shard.js` (PM2/systemd). Kiểm tra lại các biến Posnic bắt buộc khác trong `upstream/pos/api/src/config` và `docs/CLOUD_OPERATIONS.md` của Posnic.
3. `npm ci --omit=dev` ở gốc, chạy `node apps/control-plane/src/server.js`.
4. Đăng ký webhook:
   - payOS: trong my.payos.vn hoặc `client.confirmWebhook('https://app.hitechpos.vn/webhooks/payos')` (route phải chạy trước khi xác nhận).
   - Pay2S: IPN gửi tới `https://app.hitechpos.vn/webhooks/pay2s` (được truyền tự động trong `ipnUrl`).
5. Lập lịch `POST /api/admin/jobs/enforce-expiry` (header `x-admin-key`) – server cũng tự chạy mỗi giờ.

`deploy/docker-compose.yml` là cấu hình tham khảo cho máy staging, chưa được kiểm thử tự động.

## Giám sát

| Endpoint | Dùng cho | Xác thực |
|---|---|---|
| `GET /healthz` | Liveness: tiến trình còn trả lời (không kiểm tra CSDL) | – |
| `GET /readyz` | Readiness: ping control DB và (nếu đặt `SHARD_URL`) shard, mỗi bước tối đa `READYZ_TIMEOUT_MS` (mặc định 1500 ms). `200` hoặc `503` kèm JSON, không chứa URI/secret | – |
| `GET /metrics` | Prometheus (text 0.0.4) | `Authorization: Bearer $METRICS_TOKEN` hoặc `X-Admin-Key` |
| `GET /api/admin/ops` | Tóm tắt JSON cho trang quản trị | `X-Admin-Key` |

Biến môi trường của control plane: `METRICS_TOKEN` (token riêng cho máy scrape, khác `ADMIN_API_KEY`), `READYZ_SHARD=0` để `/readyz` bỏ qua shard, `READYZ_TIMEOUT_MS`.

Chỉ số chính: `hitechpos_http_requests_total` / `hitechpos_http_request_duration_seconds` (nhãn `method`, `route` là **mẫu route** như `/pos/v1/payments/:orderCode`, `status`), `hitechpos_tenants{status}`, `hitechpos_tenants_suspended`, `hitechpos_payments{status,provider}`, `hitechpos_einvoice_jobs{state}` (`pending`/`done`/`unknown`), `hitechpos_job_last_success_timestamp_seconds{job}` (`expiry`, `reminders`, `einvoice_worker`; 0 = chưa chạy từ khi khởi động), `hitechpos_control_db_up`, cùng `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `nodejs_eventloop_lag_seconds{quantile}`. Số liệu theo trạng thái đọc từ control DB và được đệm 15 giây.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: hitechpos-control-plane
    scheme: https
    authorization: { credentials: '<METRICS_TOKEN>' }
    static_configs: [{ targets: ['app.hitechpos.vn'] }]
```

Cảnh báo gợi ý: `hitechpos_control_db_up == 0`; `time() - hitechpos_job_last_success_timestamp_seconds{job="einvoice_worker"} > 600` (chỉ khi `hitechpos_job_interval_seconds > 0`); `hitechpos_einvoice_jobs{state="unknown"} > 0` (cần đối soát); tỉ lệ `status=~"5.."` tăng.

## Sao lưu & khôi phục

`scripts/backup/backup.sh` sao lưu **từng shop** (DB `tenantDb` của mọi bản ghi trong `tenants`) và **control DB** bằng `mongodump --archive --gzip`, mỗi lần chạy một thư mục theo giờ UTC:

```
/var/backups/hitechpos/20261014T191500Z/
  manifest.json                 shop, DB, danh sách collection mong đợi, kết quả kiểm tra
  hitechpos_control.archive.gz
  hitech_t_<shop>.archive.gz …
  SHA256SUMS                    kiểm được bằng `sha256sum -c SHA256SUMS`
```

Các bước của một lần chạy: khoá (`flock`, lần chạy thứ hai thoát mã 75 – không bao giờ chạy chồng) → đọc danh sách shop từ control DB → `mongodump` từng DB (một shop lỗi không chặn các shop khác) → **kiểm tra**: đọc từng archive (không cần mongod), mọi collection có trong DB lúc bắt đầu phải nằm trong archive và có dấu kết thúc, ghi SHA256 → đổi tên thư mục từ `.partial` thành tên chính thức → tải lên kho ngoài (nếu cấu hình) → dọn theo chính sách giữ lại. Lần chạy lỗi được giữ lại dạng `<giờ>.failed` (`BACKUP_KEEP_FAILED_DAYS`, mặc định 3 ngày) và script thoát mã khác 0: `1` sao lưu/kiểm tra lỗi, `2` tải lên lỗi (bản cục bộ vẫn tốt), `64` cấu hình, `69` thiếu công cụ, `75` đang có lần chạy khác.

### Cài đặt

1. Cài **MongoDB Database Tools** (`mongodump`, `mongorestore`; gói `mongodb-database-tools`) – nếu không nằm trên `PATH`, đặt `MONGO_TOOLS_DIR`. Thiếu công cụ thì script dừng ngay với thông báo rõ ràng.
2. `sudo install -m 600 deploy/backup.env.example /etc/hitechpos/backup.env` rồi sửa. Không đặt gì thì script dùng `CONTROL_URI`/`CONTROL_DB`/`TENANT_MONGO_URI` trong `/etc/hitechpos/control-plane.env`. Nên tạo user Mongo riêng có vai trò `backup` (và `restore` cho khôi phục). URI được truyền cho mongodump qua tệp cấu hình tạm 0600, không hiện trong `ps` hay log.
3. Lập lịch – chọn **một**:
   - systemd: `sudo cp deploy/systemd/hitechpos-backup.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now hitechpos-backup.timer` (02:15 giờ Việt Nam; xem log: `journalctl -u hitechpos-backup`).
   - cron: `sudo cp deploy/cron/hitechpos-backup /etc/cron.d/` (19:15 UTC = 02:15 ICT, log ở `/var/log/hitechpos-backup.log`).
   Sửa `/opt/hitechpos` trong hai tệp trên thành thư mục chứa mã nguồn.
4. Chạy thử: `sudo scripts/backup/backup.sh --no-upload` rồi xem `manifest.json`.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BACKUP_DIR` | `/var/backups/hitechpos` | Thư mục lưu (0700) |
| `BACKUP_MONGO_URI` / `BACKUP_TENANT_MONGO_URI` | `CONTROL_URI` / `TENANT_MONGO_URI` | Cụm chứa control DB / DB của shop |
| `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY` | 7 / 4 | Giữ bản mới nhất của N **ngày có bản sao lưu** gần nhất và của M tuần ISO gần nhất; bản mới nhất luôn được giữ |
| `BACKUP_TZ_OFFSET_MINUTES` | 420 | Múi giờ để chia ngày/tuần (UTC+7) |
| `BACKUP_S3_URI`, `BACKUP_S3_ENDPOINT` | – | Tải lên S3/S3-compatible bằng `aws s3 cp` (cần aws CLI; khoá qua `AWS_*` hoặc profile) |
| `BACKUP_RCLONE_REMOTE` | – | Tải lên bằng `rclone copy` (ví dụ `offsite:hitechpos-backup/prod`) |

Chính sách giữ lại chỉ áp dụng cho thư mục cục bộ; trên kho ngoài hãy đặt lifecycle rule của bucket (ví dụ xoá sau 35 ngày) và bật mã hoá phía máy chủ.

**Bảo mật:** archive của control DB chứa secret shop đã niêm phong và mật khẩu chủ shop đã băm; archive của shop chứa toàn bộ dữ liệu bán hàng. Giữ quyền 0700/0600 và giới hạn quyền truy cập bucket. `TENANT_SECRET_KEY` **không** nằm trong bản sao lưu – thiếu khoá này thì khôi phục control DB cũng không mở được secret của shop; lưu khoá ngoại tuyến, tách khỏi bản sao lưu.

### Khôi phục một shop

```sh
# Khôi phục song song vào DB khác để đối chiếu/trích dữ liệu (không ảnh hưởng shop đang chạy)
sudo scripts/backup/restore-tenant.sh photue --to-db hitech_restore_photue
# Chọn lần sao lưu cụ thể, chỉ kiểm tra (không ghi gì)
sudo scripts/backup/restore-tenant.sh photue --from 20261014T191500Z --to-db hitech_restore_photue --dry-run
# Khôi phục đè lên DB thật của shop
curl -X POST -H "x-admin-key: $ADMIN_API_KEY" https://app.hitechpos.vn/api/admin/tenants/<id>/suspend
sudo scripts/backup/restore-tenant.sh photue --yes
curl -X POST -H "x-admin-key: $ADMIN_API_KEY" https://app.hitechpos.vn/api/admin/tenants/<id>/resume
```

- `<shop>` là tên miền con, id tenant hoặc tên DB; mặc định lấy lần sao lưu thành công mới nhất.
- Trước khi ghi, script kiểm tra SHA256 và nội dung archive; sau khi ghi, so số document từng collection với archive.
- `--to-db` từ chối DB đang là DB của shop khác, control DB và `admin`/`local`/`config`; DB đích đã có dữ liệu thì phải thêm `--drop`.
- Khôi phục tại chỗ cần `--yes` và thay (`--drop`) mọi collection có trong archive; collection tạo sau thời điểm sao lưu được giữ nguyên. Bản ghi tenant, secret, gói cước trong control DB **không** bị đụng tới.
- Khôi phục toàn bộ control DB (sự cố lớn) làm thủ công: `mongorestore --archive=<run>/hitechpos_control.archive.gz --gzip --drop` sau khi dừng control plane và shard.
