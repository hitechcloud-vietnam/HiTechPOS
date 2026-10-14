# Sổ tay vận hành HiTechPOS

Dành cho người trực vận hành. Cài đặt và cấu hình: [DEPLOYMENT.md](../DEPLOYMENT.md); biến môi trường: [ENV.md](ENV.md). Việc vận hành còn mở: [todo/07-van-hanh.md](../todo/07-van-hanh.md).

Các lệnh giả định mã ở `/opt/hitechpos`, PM2 chạy bằng user `hitechpos`, và:

```sh
alias hpm2='sudo -u hitechpos pm2'
ADMIN_API_KEY=$(sudo grep '^ADMIN_API_KEY=' /etc/hitechpos/control-plane.env | cut -d= -f2-)
```

## Việc thường ngày

| Việc | Lệnh |
|---|---|
| Trạng thái tiến trình | `hpm2 ls` (cột `↺` = số lần khởi động lại; tăng liên tục là đang crash hoặc chạm `max_memory_restart`) |
| Log | `hpm2 logs hitechpos-shard --lines 200 --nostream`, `hpm2 logs hitechpos-control-plane --lines 200 --nostream`; tệp ở `/home/hitechpos/.pm2/logs/` |
| Sức khoẻ | `curl -s http://127.0.0.1:4100/readyz`, `curl -s -H "X-Admin-Key: $ADMIN_API_KEY" http://127.0.0.1:4100/api/admin/ops \| jq '{ready, jobs, einvoices, payments}'` |
| Khởi động lại một dịch vụ | `cd /opt/hitechpos && hpm2 reload deploy/ecosystem.config.js --only hitechpos-shard --update-env` |
| Sao lưu ngay | `sudo systemctl start hitechpos-backup && journalctl -u hitechpos-backup -n 20 --no-pager` |
| Lần sao lưu gần nhất | `ls -1 /var/backups/hitechpos \| tail -3`, `jq '.ok' /var/backups/hitechpos/<run>/manifest.json` |
| Tạm khoá / mở lại shop | `/admin`, hoặc `curl -X POST -H "x-admin-key: $ADMIN_API_KEY" http://127.0.0.1:4100/api/admin/tenants/<id>/suspend` (`/resume`). Có hiệu lực trên shard sau ≤ 60 s |
| Giao dịch lệch tiền | `curl -s -H "x-admin-key: $ADMIN_API_KEY" 'http://127.0.0.1:4100/api/admin/payments?status=review' \| jq`; sau khi đối chiếu sao kê: `POST /api/admin/payments/<orderCode>/accept` với `{"note":"UNC …"}` |
| Migration | [DEPLOYMENT.md – Migration](../DEPLOYMENT.md#migration-theo-từng-shop) |
| Phát hành bản mới | [DEPLOYMENT.md – Phát hành](../DEPLOYMENT.md#phát-hành-nâng-cấp-quay-lui) |

Hằng tuần: xem `manifest.json` của bản sao lưu, dung lượng đĩa (`df -h /var/lib/mongodb /var/backups`), `hitechpos_einvoice_jobs{state="unknown"}`, giao dịch `review`, shop `install_failed` trong `/admin`. Hằng quý: [diễn tập khôi phục](../DEPLOYMENT.md#diễn-tập-khôi-phục-thảm-hoạ).

## Sự cố

Mỗi mục: **Triệu chứng → Nguyên nhân → Cách sửa**. Các mục có dấu ✔ đã được tái hiện khi viết tài liệu.

### Tiến trình không khởi động: `CONTROL_URI must be set` ✔

- **Triệu chứng:** `hpm2 ls` báo `errored`/khởi động lại liên tục; log `[control-plane] fatal: CONTROL_URI must be set` hoặc `[shard] fatal: CONTROL_URI or MONGODB_URI must be set`.
- **Nguyên nhân:** thiếu `/etc/hitechpos/*.env` hoặc tệp thiếu dòng. (Tệp có nhưng sai quyền thì `pm2 start` báo ngay `cannot read /etc/hitechpos/… (EACCES)` – tệp do `sudo bootstrap-secrets.sh` tạo thuộc `root`, PM2 chạy bằng `hitechpos`.)
- **Cách sửa:** `sudo -u hitechpos test -r /etc/hitechpos/control-plane.env && echo ok`; sửa quyền như [DEPLOYMENT.md – Quyền tệp](../DEPLOYMENT.md#quyền-tệp); rồi `hpm2 delete all && hpm2 start deploy/ecosystem.config.js && hpm2 save`.

Các lỗi khởi động khác của control plane (✔): `TENANT_SECRET_KEY must be 64 hex characters`, `SESSION_SECRET must be set`; của shard: `CONTROL_DB must be set`, `TENANT_SECRET_KEY is not set; a shard cannot open any shop`.

### Gọi shard bằng `fetch` báo `bad port`

- **Triệu chứng:** script/công cụ tự viết gọi `http://127.0.0.1:6000` bằng `fetch` (Node hoặc trình duyệt) thất bại ngay với `bad port`.
- **Nguyên nhân:** 6000 nằm trong danh sách cổng bị chặn của chuẩn Fetch (X11). Control plane và shard dùng `node:http` (`apps/control-plane/src/http-transport.js`, `upstream/pos/api/src/services/hitech-pay.js`) nên không bị.
- **Cách sửa:** dùng `curl` hoặc `node:http`; không đổi cổng shard chỉ vì lý do này (cổng 6000 được ghi ở ecosystem, Caddyfile, compose).

### Shop mới hoặc thay đổi của shop chưa có tác dụng (≤ 60 s) ✔

- **Triệu chứng:** vừa bật VietQR/payOS/Pay2S, ô QR ở máy bán hàng báo **“Cửa hàng vừa bật thanh toán QR, vui lòng thử lại sau ít phút.”** (bản cũ trước v0.2.0 hiện lỗi tiếng Anh `no HITECH_POS_KEY for the shop in context`); hoặc vừa tạm khoá shop mà shop vẫn đăng nhập được; vừa mở lại mà vẫn thấy “This shop is suspended.”; tên miền riêng vừa xác minh mà shard trả 404.
- **Nguyên nhân:** shard giữ registry shop trong bộ nhớ, nạp lại mỗi `SHARD_RELOAD_MS` (60 s). Hostname chưa biết làm shard nạp ngay, nhưng tối đa một lần/10 s; thay đổi trên shop đã biết (secret mới, `suspended`) chỉ thấy ở lần nạp định kỳ. Đo được: QR sẵn sàng sau 34 s, tạm khoá có hiệu lực sau 55 s.
- **Cách sửa:** chờ tối đa 60 s. Cần ngay thì `hpm2 reload … --only hitechpos-shard` (mất phiên đang dở nếu shard không có `SESSION_SECRET`). Không hạ `SHARD_RELOAD_MS` ở production (mỗi lần nạp đọc toàn bộ `tenants` và giải mã secret).

### Ô QR báo `HITECH_POS_KEY`/`HITECH_PAY_URL`, “Cửa hàng chưa kết nối thanh toán QR HiTechPOS.”

- **Nguyên nhân / cách sửa:**
  - `HITECH_PAY_URL is not configured`: thiếu biến trong `shard.env` → thêm `HITECH_PAY_URL=http://127.0.0.1:4100`, reload shard.
  - “Cửa hàng chưa kết nối…”: shop chưa bật phương thức nào ở `/account`.
  - `HiTechPOS payments answered 401`: khoá nội bộ của shop bị thu hồi ở `/account` → lưu lại cấu hình thanh toán để cấp khoá mới, chờ 60 s.
  - `429` từ `/pos/v1`: mọi máy bán hàng của một shop dùng chung khoá nội bộ, hạn mức 300 yêu cầu/phút/khoá (thăm dò trạng thái QR mỗi 2–3 s/máy). Shop có rất nhiều máy cùng mở QR có thể chạm hạn mức.

### Đăng ký shop báo `tenant_install_failed`

- **Triệu chứng:** `/api/signup` trả `502 tenant_install_failed`; trong `/admin` shop có `status: install_failed`, `suspended: true`, `installError` là mã ngắn.
- **Nguyên nhân theo `installError`:**
  - `installer_http_401`: `POSNIC_KEY`/`POSNIC_SECRET` khác nhau giữa hai tệp env;
  - `installer_http_503`: shard thiếu `POSNIC_KEY`/`POSNIC_SECRET`;
  - `installer_http_404`: shard không nhận ra shop sau 4 lần thử (~33 s): thiếu `SHARD_SHOP_HEADER` ở shard, `SHOP_BASE_DOMAINS` khác nhau (shard mặc định `posnic.io`!), `CONTROL_DB` khác nhau, `TENANT_SECRET_KEY` khác nhau (log shard `secrets could not be opened`), hoặc shard có `SHARD_INSTANCE` khác control plane;
  - `ECONNREFUSED`, hoặc mã/thông báo timeout (sau 60 s): shard không chạy hoặc treo.
- **Cách sửa:** sửa cấu hình, reload hai tiến trình. Shop lỗi đã giữ tên miền con: xoá bản ghi tenant và tài khoản chủ trong control DB (sau khi chắc chắn không có dữ liệu) để khách đăng ký lại, hoặc liên hệ khách. Chưa có lệnh cài lại cho shop đã lỗi.
- **Lưu ý:** đăng ký thành công bình thường mất 1–15 s vì trình cài đặt chờ shard nạp registry (✔ đo được 14 s).

### Đăng ký “thành công” nhưng không vào được shop

- **Triệu chứng:** shop `active` nhưng `https://<shop>.hitechpos.vn` không có dữ liệu/không đăng nhập được; log control plane `SHARD_URL not set: … registered without running the Posnic installer`.
- **Nguyên nhân:** control plane chạy không có `SHARD_URL` (chạy tay ngoài PM2) – chế độ phát triển.
- **Cách sửa:** luôn chạy bằng `deploy/ecosystem.config.js`.

### Trang shop trả JSON “Welcome to the Posnic API v2”, `/login.html` 404 ✔

- **Nguyên nhân:** chưa build giao diện (`upstream/pos/frontend/public/` trống) – thư mục này bị `.gitignore`, phải build ở mỗi lần triển khai.
- **Cách sửa:** `(cd upstream/pos/frontend && npm ci && npm run build:assets)`; không cần khởi động lại shard.

### Mọi shop 404 “No shop is served at this address.”

- **Nguyên nhân:** shard không có shop nào (`[shard] serving 0 hostname(s)`): sai `CONTROL_DB`, sai cụm Mongo, `SHOP_BASE_DOMAINS` không phải `hitechpos.vn`, `SHARD_INSTANCE` đặt mà shop không có trường `instance` (✔), hoặc `TENANT_SECRET_KEY` sai (từng shop: `secrets could not be opened … not served`).
- **Cách sửa:** đối chiếu bốn biến chung giữa `shard.env` và `control-plane.env`; với `SHARD_INSTANCE` xem [DEPLOYMENT.md – Nhiều shard](../DEPLOYMENT.md#nhiều-shard-shard_instance). **Không** “sửa” bằng cách đổi `TENANT_SECRET_KEY` sang giá trị mới.

### Tên miền riêng của shop không có HTTPS (Caddy `on_demand` + `ask`)

- **Triệu chứng:** trình duyệt báo lỗi TLS cho `pos.cuahang.vn`; log Caddy (`journalctl -u caddy`) báo endpoint `ask` từ chối tên miền hoặc không gọi được `ask`.
- **Nguyên nhân:** Caddy chỉ xin chứng chỉ khi `http://127.0.0.1:4100/internal/tls-ask?domain=<tên>` trả `200`. Trả `404` khi tên miền chưa được xác minh TXT, thuộc shop bị tạm khoá, hoặc shop không có gói `custom-domain`; trả `403` nếu yêu cầu không đến thẳng từ loopback (đi qua proxy, có `X-Forwarded-For`); lỗi kết nối nếu control plane không chạy hoặc cổng trong Caddyfile khác 4100.
- **Cách sửa:** `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:4100/internal/tls-ask?domain=pos.cuahang.vn'` trên máy Caddy. 404 → shop bấm “Xác minh” ở `/account` (cần TXT `_hitechpos.<tên miền>` và CNAME về `<sub>.hitechpos.vn`; kiểm bằng `dig +short TXT _hitechpos.pos.cuahang.vn`). Sau khi xác minh, shard cần ≤ 60 s để nhận tên mới. Chứng chỉ đã cấp vẫn còn hiệu lực khi shop bị khoá (shard trả 403 nội dung).

### Chứng chỉ wildcard không cấp được

- **Triệu chứng:** log Caddy lỗi DNS-01 cho `*.hitechpos.vn`; `caddy validate` báo `API token '…' appears invalid` (✔ khi token rỗng/sai dạng) hoặc `module not registered: dns.providers.cloudflare` (binary không có module).
- **Cách sửa:** `caddy list-modules | grep dns.providers`; kiểm `/etc/caddy/caddy.env` có `CLOUDFLARE_API_TOKEN` và unit đọc `EnvironmentFile`; token cần quyền DNS Edit của đúng zone; sau nhiều lần lỗi Let's Encrypt áp giới hạn tần suất – chờ rồi thử lại.

### `npm ci` của Posnic API treo hoặc lỗi mạng

- **Nguyên nhân:** `upstream/pos/api/package-lock.json` trỏ 163 gói tới `registry.npmmirror.com` – thường chậm/bị chặn từ máy chủ ngoài Trung Quốc.
- **Cách sửa:** luôn dùng `--replace-registry-host=registry.npmmirror.com --registry=https://registry.npmjs.org/` (như CI, ✔). Container staging (`deploy/docker-compose.yml`) chưa có tham số này – cài trước trên host.

### Khách nhận `429` / “Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.” ✔

- **Nguyên nhân:** giới hạn tần suất trong bộ nhớ của control plane (đăng nhập 20 lần/15 phút/IP, đăng ký 10/giờ/IP, quản trị 300/15 phút/IP, chung 600/phút/IP, `/pos/v1` 300/phút/khoá). Phản hồi có `Retry-After` (đăng nhập: 900 s). Nhiều người dùng chung một IP công cộng (quán, văn phòng, mạng di động CGNAT) có thể chạm hạn mức đăng nhập/đăng ký. Nếu **mọi** khách đều bị: IP mà control plane thấy là của một proxy/CDN (Cloudflare mây cam, LB thứ hai) – `trust proxy` chỉ tin một hop.
- **Cách sửa:** chờ hết cửa sổ, hoặc `hpm2 reload … --only hitechpos-control-plane` (xoá toàn bộ bộ đếm – chỉ khi cần thiết). Bỏ proxy CDN cho `app.`/`*.` hoặc chỉ để một proxy trước control plane. Đổi hạn mức cần sửa mã (`config.rateLimits`).

### Hoá đơn điện tử kẹt ở trạng thái `unknown`

- **Triệu chứng:** `hitechpos_einvoice_jobs{state="unknown"} > 0`; POS/API nhận `409 einvoice_outcome_unknown` (“Lần phát hành trước chưa rõ kết quả, cần đối soát trước khi phát hành lại.”); `/account` → lỗi hoá đơn.
- **Nguyên nhân:** lệnh tạo hoá đơn đã gửi nhưng không rõ kết quả (timeout, lỗi mạng, HTTP 5xx/408/429, phản hồi không đọc được). Hệ thống **không bao giờ** tự gửi lại để tránh phát hành trùng.
- **Cách sửa:** đối soát – hỏi nhà cung cấp xem hoá đơn có tồn tại không:
  - chủ shop: `/account` → Hoá đơn điện tử → Đối soát (`POST /api/shop/einvoices/<refId>/reconcile`);
  - máy POS/tích hợp: `POST /pos/v1/einvoices/<refId>/reconcile` (khoá API của shop).
  Thấy hoá đơn → ghi nhận `done`; nhà cung cấp trả không tìm thấy/từ chối → được phát hành lại. Nếu nhà cung cấp đang lỗi, chờ rồi đối soát lại; kiểm tra tường lửa ra (Mắt Bão dùng cổng 11443). Không xoá bản ghi trong collection `einvoices` bằng tay.

### Shop bị tạm khoá ✔

- **Triệu chứng:** `https://<shop>.hitechpos.vn` trả `403` “This shop is suspended.” (chữ tiếng Anh, do shard trả); máy POS gọi `/pos/v1` nhận `401`; chứng chỉ tên miền riêng mới không được cấp.
- **Nguyên nhân (`suspendedReason` trong `/admin`):** `subscription_expired` (job `expiry` mỗi giờ: hết hạn gói + `GRACE_DAYS` ngày; email “tạm ngưng” được gửi), `install_failed`, hoặc do người vận hành (`manual`/lý do nhập).
- **Cách sửa:** hết hạn – shop thanh toán ở `/account` là tự mở lại; hoặc `/admin` → gia hạn/mở lại (có nhật ký). Dữ liệu shop không bị xoá. Hiệu lực trên shard sau ≤ 60 s.

### Webhook thanh toán bị từ chối

- **Triệu chứng:** log `[webhook:payos] rejected: <mã>`, `[webhook:shop:pay2s] rejected: …`, `[webhook:shop:bank-feed] rejected: pay2s_bank_feed_unauthorized`; giao dịch không chuyển `paid`.
- **Nguyên nhân:** sai checksum/secret key (đổi khoá ở nhà cung cấp mà chưa cập nhật), webhook của shop A trỏ URL shop B, token biến động số dư khác (so khớp chính xác, phân biệt hoa thường), `PUBLIC_URL` sai nên URL đăng ký với cổng sai; `/webhooks/payos` trả 404 khi nền tảng chưa cấu hình payOS.
- **Cách sửa:** đối chiếu URL ở `/account` (shop) hoặc `PUBLIC_URL` + `/webhooks/<cổng>` (nền tảng); nhập lại khoá. Giao dịch đã trả tiền mà không có webhook: chủ shop xác nhận tay (VietQR), hoặc người vận hành `accept` giao dịch `review` sau khi đối chiếu sao kê. Không bao giờ tự tạo lại lệnh thanh toán thay khách.

### Email không tới

- **Triệu chứng:** log `[notify] (no SMTP) …` (chưa đặt `SMTP_URL`) hoặc `[notify] <loại> to <email> failed: …`.
- **Cách sửa:** kiểm `SMTP_URL` (mã hoá URL ký tự đặc biệt), mở cổng ra 465/587, SPF/DKIM/DMARC. Thông báo lỗi không được gửi lại tự động: gửi lại email chào mừng qua `/admin` (`resend-welcome`); chủ shop tự yêu cầu lại email đặt mật khẩu.

### Máy bán hàng bị đăng xuất sau mỗi lần triển khai

- **Nguyên nhân:** `shard.env` không có `SESSION_SECRET` → khoá ký cookie `express-session` ngẫu nhiên mỗi lần khởi động (log `[config] SESSION_SECRET is not set…`).
- **Cách sửa:** thêm một giá trị ngẫu nhiên riêng vào `shard.env`, `hpm2 reload deploy/ecosystem.config.js --only hitechpos-shard --update-env` (✔).

### `502` trong lúc triển khai

- **Nguyên nhân:** PM2 `fork` khởi động lại tiến trình (shard ~2–3 s); Caddyfile gốc không giữ yêu cầu chờ.
- **Cách sửa:** thêm `lb_try_duration 30s` / `lb_try_interval 250ms` vào `reverse_proxy` ([Caddyfile khuyến nghị](../DEPLOYMENT.md#cấu-hình-caddy)) – đo được từ 16/40 yêu cầu lỗi xuống 0/40.

### Sao lưu/khôi phục lỗi

| Mã thoát/log | Ý nghĩa | Cách sửa |
|---|---|---|
| `69` `mongodump not found` | Thiếu Database Tools | Cài `mongodb-database-tools` hoặc đặt `MONGO_TOOLS_DIR` |
| `69` `node not found` | root không có `node` trên PATH (nvm) | `NODE=/đường/dẫn/node` trong `backup.env` |
| `64` `BACKUP_MONGO_URI (or CONTROL_URI) is not set` | Không đọc được cấu hình | Kiểm `backup.env`/`control-plane.env` |
| `75` | Một lần sao lưu/khôi phục khác đang chạy | Chờ; xem `journalctl -u hitechpos-backup` |
| `1` + thư mục `<run>.failed` | Có DB dump hoặc kiểm tra lỗi | Đọc log (20 dòng cuối của mongodump được in) |
| `2` | Tải lên kho ngoài lỗi (bản cục bộ tốt) | Khoá S3/rclone, mạng |
| khôi phục: `unexpected error: 13` sau `document(s) restored` | User khôi phục chỉ có vai trò `restore` – dữ liệu **đã ghi**, bước so số document không có quyền đọc (✔) | Thêm vai trò `backup` cho user khôi phục; chạy lại với `--drop` |
| khôi phục: mã `3` `already has N collection(s)` | DB đích có dữ liệu | Thêm `--drop` hoặc chọn `--to-db` khác |
| systemd: `Read-only file system` | `BACKUP_DIR` ngoài `ReadWritePaths` | Sửa unit |

### Bộ nhớ shard tăng / khởi động lại liên tục

- **Triệu chứng:** `↺` của `hitechpos-shard` tăng, log PM2 `exceeds memory limit` (ngưỡng 2500 MB).
- **Cách sửa:** xem số shop (`serving N hostname(s)`), `nodejs_eventloop_lag`; tăng RAM hoặc tách shop sang shard thứ hai ([Mở rộng](../DEPLOYMENT.md#mở-rộng)). Ghi lại số đo để cập nhật bảng cỡ máy.

## Liên hệ và leo thang

Điền khi đưa vào vận hành: người trực, số điện thoại hỗ trợ shop (shop không bán được hàng là sự cố khẩn), đầu mối kỹ thuật của payOS, Pay2S, Viettel/MISA/Mắt Bão, nhà cung cấp hạ tầng, nhà cung cấp DNS. Quy trình báo cáo sự cố dữ liệu cá nhân theo Nghị định 13/2023/NĐ-CP do pháp chế công ty xác định.
