# Tham chiếu biến môi trường

Tài liệu tra cứu cho [DEPLOYMENT.md](../DEPLOYMENT.md). Mọi giá trị mặc định dưới đây được đối chiếu với mã nguồn (tệp ghi ở cột cuối hoặc đầu mục); những gì không kiểm chứng được ghi rõ.

Quy ước cột **Bắt buộc**: **có** – thiếu thì tiến trình dừng; **nên** – chạy được nhưng thiếu chức năng hoặc sai hành vi production; **–** – tuỳ chọn.

## 1. Biến được ghi ở đâu

| Tệp | Ai đọc | Ghi chú |
|---|---|---|
| `/etc/hitechpos/control-plane.env` | `deploy/ecosystem.config.js` (khi chạy `pm2 start/reload`), `scripts/backup/*` (chỉ `CONTROL_URI`, `CONTROL_DB`, `TENANT_MONGO_URI`) | Do `deploy/bootstrap-secrets.sh` tạo, quyền 0600 |
| `/etc/hitechpos/shard.env` | `deploy/ecosystem.config.js` | Như trên |
| `/etc/hitechpos/backup.env` | `scripts/backup/*.sh` | Chép từ `deploy/backup.env.example` |
| `/etc/caddy/caddy.env` (đề xuất) | systemd unit của Caddy (`EnvironmentFile=`) | `CLOUDFLARE_API_TOKEN`, `ACME_EMAIL` |

Định dạng tệp: mỗi dòng `KEY=VALUE`, dòng bắt đầu bằng `#` bị bỏ qua, dấu nháy bao quanh giá trị được bỏ. Ba điều đã kiểm chứng khi chạy thật:

1. **PM2 đọc tệp env bằng quyền của người chạy lệnh `pm2`.** `envFile()` trong `deploy/ecosystem.config.js` bỏ qua tệp không tồn tại, còn tệp có mà không đọc được (ví dụ `root:root 0600` do `sudo bootstrap-secrets.sh` tạo trong khi PM2 chạy bằng `hitechpos`) làm `pm2 start` dừng với `cannot read /etc/hitechpos/<tệp> (EACCES)`. Thiếu tệp hẳn thì tiến trình dừng với `[control-plane] fatal: CONTROL_URI must be set` / `[shard] fatal: CONTROL_URI or MONGODB_URI must be set`.
2. **Một số biến bị `ecosystem.config.js` ghi đè sau khi đọc tệp**, đặt trong tệp env không có tác dụng:
   - control plane: `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4100`, `SHARD_URL=http://127.0.0.1:6000`, `SHARD_SHOP_HEADER=x-hitech-shop`;
   - shard: `POSNIC_BRAND_DIR=<repo>/deploy/brand`, `NODE_ENV=production`, `SHARD_HOST=127.0.0.1`, `SHARD_PORT=6000`, `SHARD_SHOP_HEADER=x-hitech-shop`.
   Muốn đổi cổng/địa chỉ thì sửa `deploy/ecosystem.config.js` (và `deploy/Caddyfile`, `on_demand_tls ask`).
3. **Đừng `source` các tệp này trong shell.** URI MongoDB chứa `&` (`?replicaSet=rs0&authSource=admin`); `. shard.env` sẽ chạy phần sau `&` như một lệnh nền và biến bị cắt cụt. Các script trong repo đọc tệp dạng dữ liệu, không thực thi. Khi cần dùng biến trong lệnh tay: `env "CONTROL_URI=$(sudo grep '^CONTROL_URI=' /etc/hitechpos/shard.env | cut -d= -f2-)" …`.

Đổi giá trị: `pm2 reload deploy/ecosystem.config.js --update-env`. **Xoá** một biến thì phải `pm2 delete <tên> && pm2 start deploy/ecosystem.config.js --only <tên> && pm2 save` – `reload --update-env` giữ lại biến cũ (đã kiểm chứng với PM2 6.0.13).

Mật khẩu trong URI MongoDB/SMTP phải mã hoá URL (`@` → `%40`, `:` → `%3A`, `/` → `%2F`…). Dùng mật khẩu chỉ gồm chữ và số (ví dụ `openssl rand -hex 24`) để khỏi phải nghĩ tới việc này.

## 2. Control plane (`apps/control-plane`)

Đọc trong `apps/control-plane/src/config.js` (trừ khi ghi khác).

| Biến | Bắt buộc | Mặc định | Ý nghĩa / ví dụ |
|---|---|---|---|
| `PUBLIC_URL` | **nên** | `http://localhost:4100` | Địa chỉ công khai, **không** có `/` cuối: `https://app.hitechpos.vn`. Dùng để dựng URL webhook gửi cho payOS/Pay2S (`/webhooks/...`), URL webhook hiển thị cho shop, `returnUrl`/`cancelUrl`, liên kết trong email, trang khách `/pay/...`, issuer của ứng dụng Business. Sai giá trị = webhook của cổng thanh toán đi nhầm chỗ |
| `CONTROL_URI` | **có** (trừ `STORE=memory`) | – | URI MongoDB chứa control DB, không ghi tên DB: `mongodb://hitechpos:<mk>@127.0.0.1:27017/?replicaSet=rs0&authSource=admin`. Cũng là kết nối mà `shopBridge` dùng để ghi vào DB của từng shop (xem [Mở rộng](../DEPLOYMENT.md#mở-rộng)) |
| `CONTROL_DB` | – | `hitechpos_control` | Tên control DB. **Phải trùng** `CONTROL_DB` của shard và của sao lưu |
| `TENANT_SECRET_KEY` | **có** | – (`STORE=memory`: 64 số 0) | 64 ký tự hex (32 byte). Khoá AES-256-GCM niêm phong secret của shop (`tenants.secrets`), khoá API payOS/Pay2S và mật khẩu HĐĐT của shop. **Phải trùng** shard. Sai độ dài: `TENANT_SECRET_KEY must be 64 hex characters` (`src/secrets.js`) |
| `SESSION_SECRET` | **có** (trừ `STORE=memory`) | – | Ký JWT phiên chủ shop (hạn 7 ngày) và (dẫn xuất) phiên đối tác `/doi-tac`. Khác hẳn `SESSION_SECRET` của shard |
| `ADMIN_API_KEY` | **nên** | – | Header `X-Admin-Key` cho `/api/admin/*`, `/admin`, `/metrics`. Không đặt = mọi API quản trị trả `401` |
| `METRICS_TOKEN` | – | – | Token riêng cho máy scrape: `Authorization: Bearer <token>` trên `/metrics`. `bootstrap-secrets.sh` **không** tạo biến này |
| `READYZ_SHARD` | – | bật | `0`/`false`/`no` = `/readyz` không thăm dò shard |
| `READYZ_TIMEOUT_MS` | – | `1500` | Thời gian tối đa mỗi bước kiểm tra của `/readyz` |
| `SHARD_URL` | **nên** | – (ecosystem: `http://127.0.0.1:6000`) | Shard dùng để chạy trình cài đặt Posnic cho shop mới và cho `/readyz`. **Không đặt** = đăng ký vẫn “thành công” nhưng không cài gì (log `SHARD_URL not set: … registered without running the Posnic installer`) – chỉ dùng khi phát triển |
| `SHARD_SHOP_HEADER` | – | `x-hitech-shop` | Header chọn shop khi control plane gọi shard. Phải trùng shard |
| `SHARD_INSTANCE` | – | – | Ghi vào trường `instance` của **shop mới đăng ký**. Xem [Nhiều shard](../DEPLOYMENT.md#nhiều-shard-shard_instance) |
| `POSNIC_KEY` / `POSNIC_SECRET` | **có** khi có shard | – | Khoá gọi `POST /api/install/add` của Posnic (header `x-posnic-key`/`x-posnic-secret`). Phải trùng shard; lệch = shop `install_failed` |
| `SHOP_BASE_DOMAINS` | – | `hitechpos.vn` | Danh sách cách nhau bởi dấu phẩy. Tên miền **đầu tiên** dùng cho URL shop (`<sub>.<tên miền>`), header cài đặt, đích CNAME của tên miền riêng, `handoff.origin` của ứng dụng Business; mọi tên miền trong danh sách được trả lời ở `/internal/tls-ask`. Phải trùng shard |
| `TENANT_DB_PREFIX` | – | `hitech_t_` | Tiền tố tên DB của shop: `<tiền tố><subdomain, '-'→'_'>`. Chỉ áp dụng cho shop **mới**; shop cũ giữ `tenantDb` đã ghi |
| `TENANT_MONGO_URI` | – | `CONTROL_URI` | `src/server.js`. Kết nối đọc/ghi DB shop của: bước onboarding ghi tiêu đề hoá đơn, worker hoá đơn điện tử, sổ sách thuế. **Không** áp dụng cho `shopBridge` (vẫn dùng `CONTROL_URI`) và shard luôn đọc DB shop trên cụm của `CONTROL_URI` của nó – nên để trống |
| `EINVOICE_WORKER_INTERVAL_MS` | – | `60000` | `src/server.js`. Chu kỳ worker tự phát hành hoá đơn điện tử; `0` = tắt |
| `STORE` | – | `mongo` | `memory` = dữ liệu trong RAM, mất khi khởi động lại. **Không bao giờ dùng ở production** |
| `PORT` / `HOST` | – | `4100` / `127.0.0.1` | Bị `ecosystem.config.js` ghi đè (4100 / 127.0.0.1) |
| `SAAS_VAT_RATE` | – | `KCT` | Thuế GTGT trên phí thuê bao: `KCT` hoặc số (`10`). Cần kế toán xác nhận (`docs/LICENSING.md`) |
| `GRACE_DAYS` | – | `7` | Số ngày sau khi hết hạn gói trước khi job `expiry` tạm khoá shop |
| `SMTP_URL` | **nên** | – | URL nodemailer: `smtps://user%40hitechpos.vn:<mk>@smtp.example.vn:465` hoặc `smtp://…:587` (STARTTLS). Không đặt = email chỉ ghi log – **chủ shop không đặt lại mật khẩu được** vì liên kết chỉ có trong email |
| `MAIL_FROM` | – | `HiTechPOS <no-reply@hitechpos.vn>` | `src/notify.js`. Địa chỉ gửi; tên miền phải có SPF/DKIM/DMARC |
| `SOURCE_URL` | – | `https://github.com/hitechcloud-vietnam/HiTechPOS` | Đích của `/source` (nghĩa vụ AGPL §13). Trỏ đúng commit/tag đang chạy nếu có thể |
| `BUSINESS_CLOUD_ISSUER` | – | `PUBLIC_URL` | Issuer cho ứng dụng HiTechPOS Business ([BUSINESS-APP.md](../BUSINESS-APP.md)) |
| `BUSINESS_CLOUD_CORS_ORIGINS` | – | rỗng | Origin của bản xem thử web Expo, cách nhau bởi dấu phẩy. Production để trống |
| `PAYOS_CLIENT_ID` | – | – | Có giá trị thì bật payOS cho **phí thuê bao của nền tảng** |
| `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` | khi bật payOS | – | Từ my.payos.vn (kênh thanh toán của HiTechCloud) |
| `PAYOS_PARTNER_CODE` | – | – | Gửi header `x-partner-code` (chỉ khi payOS cấp mã đối tác) |
| `PAY2S_ACCESS_KEY` | – | – | Có giá trị thì bật Pay2S cho phí thuê bao |
| `PAY2S_ENV` | khi bật Pay2S | **`sandbox`** | `sandbox` → `https://sandbox-payment.pay2s.vn`, `production` → `https://payment.pay2s.vn`. **Mặc định là sandbox** – production phải đặt `production` |
| `PAY2S_PARTNER_CODE`, `PAY2S_SECRET_KEY` | khi bật Pay2S | – | Từ tài khoản Pay2S |
| `PAY2S_PARTNER_NAME` | – | – | Tên hiển thị gửi kèm yêu cầu tạo thanh toán |
| `NODE_ENV` | – | – | Control plane không đọc biến này |

Không cấu hình được bằng biến môi trường (hằng trong mã, chỉ đổi bằng sửa mã/`config` khi nhúng): giới hạn tần suất (`config.rateLimits`: chung 600/phút/IP, đăng nhập 20/15 phút/IP, đăng ký 10/giờ/IP, quản trị 300/15 phút/IP, `/pos/v1` 300/phút/khoá, webhook 6000/phút/IP), `config.partners.cookieDays` (30), tần suất job `expiry`/`reminders` (mỗi giờ).

## 3. Posnic shard (`upstream/pos/api/shard.js`)

Chỉ liệt kê biến có ý nghĩa với HiTechPOS. Posnic đọc hơn 150 biến khác (AI, S3, WhatsApp, SMS, Razorpay…) cho các tính năng HiTechPOS không dùng – để trống.

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|---|---|---|---|
| `CONTROL_URI` | **có** (hoặc `MONGODB_URI`) | – | Một kết nối dùng cho cả registry (`<CONTROL_DB>.tenants`) **và** mọi DB shop (`mongoose.connection.useDb(tenantDb)`). Vì vậy mọi DB shop mà shard phục vụ phải nằm trên cùng cụm với control DB. DB mặc định trong đường dẫn URI (không ghi = `test`) chứa vài collection cấp tiến trình (giới hạn đăng nhập `rate_limits`, chỉ mục rỗng) – đã quan sát khi chạy thật; không được sao lưu và mất cũng không sao |
| `MONGODB_URI` | – | – | Dự phòng cho `CONTROL_URI`; một số script Posnic đọc biến này. `bootstrap-secrets.sh` đặt bằng `CONTROL_URI` – giữ như vậy |
| `CONTROL_DB` | **có** | – | Phải trùng control plane. Thiếu: `CONTROL_DB must be set` |
| `TENANT_SECRET_KEY` | **có** | – | Phải trùng control plane. Shop có secret không mở được thì **không được phục vụ** (log `[shard] <shop>: secrets could not be opened (...); not served`, khách thấy 404) |
| `SHOP_BASE_DOMAINS` | **có** trên thực tế | **`posnic.io`** (`src/utils/shop-hosts.js`) | Shard trả lời `<subdomain>.<mỗi tên miền>`; cũng là danh sách tên miền được phép xuất hiện trong liên kết email của Posnic. Quên đặt = mọi shop 404 |
| `SHARD_SHOP_HEADER` | **có** | – (tắt) | Ecosystem đặt `x-hitech-shop`. Thiếu thì trình cài đặt của control plane (gọi `127.0.0.1:6000` kèm header) không tới được shop nào → shop mới `install_failed` |
| `SHARD_PORT` (hoặc `PORT`) / `SHARD_HOST` | – | `6000` / `127.0.0.1` | Ecosystem ghi đè. Cổng 6000 nằm trong danh sách “bad port” của `fetch` – mọi lời gọi nội bộ dùng `node:http` |
| `SHARD_RELOAD_MS` | – | `60000` (tối thiểu 1000) | Chu kỳ nạp lại registry. Mọi thay đổi trên bản ghi tenant (tạm khoá, mở lại, secret mới như `HITECH_POS_KEY`, tên miền riêng) có hiệu lực trên shard sau tối đa chừng này. Hostname lạ còn kích hoạt nạp lại ngay (tối đa 1 lần/10 s) |
| `SHARD_POOL_SIZE` | – | `20` | Kích thước pool mongoose dùng chung cho mọi shop (registry dùng pool riêng 5) |
| `SHARD_INSTANCE` | – | – | Chỉ phục vụ tenant có `instance` bằng giá trị này. Đặt khi có hơn một shard |
| `SHARD_REGISTRY_FILE` | – | – | Registry từ tệp JSON (bản demo của Posnic). **Không dùng ở production** |
| `POSNIC_KEY` / `POSNIC_SECRET` | **có** | – | Phải trùng control plane. Thiếu: trình cài đặt trả `503 Installation is not configured` |
| `HITECH_PAY_URL` | **có** cho thanh toán QR | – | URL nội bộ của control plane, ví dụ `http://127.0.0.1:4100`. Thiếu: ô QR báo `HITECH_PAY_URL is not configured` |
| `POSNIC_BRAND_DIR` | – | – (ecosystem: `<repo>/deploy/brand`) | Logo/tên/URL thương hiệu trên hoá đơn và `/brand.json`. Bị ecosystem ghi đè – tuỳ biến thương hiệu bằng cách sửa `deploy/brand/` trong repo |
| `NODE_ENV` | **có** = `production` | – | Bật `trust proxy` (1 hop), cookie `Secure; SameSite=None`. Ecosystem đặt sẵn |
| `SESSION_SECRET` | **nên** | ngẫu nhiên mỗi tiến trình | Khoá ký cookie `express-session` **dùng chung cả tiến trình** (`app.js`). Không đặt: log `[config] SESSION_SECRET is not set...` và phiên `express-session` (ví dụ chi nhánh đang chọn) mất sau mỗi lần khởi động lại. `bootstrap-secrets.sh` hiện **không** ghi biến này vào `shard.env` – thêm một giá trị ngẫu nhiên riêng (không dùng lại của control plane). Phiên nằm trong DB của từng shop nên khoá chung không cho phép dùng cookie của shop này ở shop khác |
| `DEFAULT_TIMEZONE` | – | `UTC` (báo cáo bán hàng), `Asia/Kolkata` (`src/utils/date-preference.js`) | Chỉ dùng khi chi nhánh **không** có `time_zone`. Onboarding của HiTechPOS đặt `Asia/Ho_Chi_Minh` cho chi nhánh, nên đây chỉ là lưới an toàn; nên đặt `Asia/Ho_Chi_Minh` |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USERNAME`, `EMAIL_PASSWORD`, `EMAIL_FROM`, `EMAIL_SECURE` | – | – | SMTP của chính Posnic (email do máy bán hàng gửi). Chưa kiểm chứng trong HiTechPOS |
| `JWT_SECRET`, `ENCRYPTION_KEY`, `KIOSK_API_KEY`, `CSRF_SECRET`, `PUBLIC_BASE_URL` | **không đặt** | – | Ở chế độ shard đa tenant các khoá này lấy theo từng shop (`currentSecret` từ chối dùng biến môi trường); `CSRF_SECRET`/`PUBLIC_BASE_URL` đặt ở cấp tiến trình sẽ dùng chung cho mọi shop |

Shard nạp thêm `upstream/pos/api/.env` (và `.env` ở thư mục làm việc) bằng `dotenv` nếu tệp tồn tại – **không** tạo tệp này trên máy production; biến trong đó lặng lẽ bổ sung vào tiến trình.

## 4. Sao lưu (`scripts/backup`)

Xem bảng trong [DEPLOYMENT.md – Sao lưu & khôi phục](../DEPLOYMENT.md#sao-lưu--khôi-phục). Bổ sung các biến đọc trong mã nhưng chưa có trong bảng đó:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BACKUP_ENV_FILE` | `/etc/hitechpos/backup.env` | Tệp cấu hình sao lưu |
| `BACKUP_CONTROL_ENV_FILE` | `/etc/hitechpos/control-plane.env` | Nguồn dự phòng cho `CONTROL_URI`/`CONTROL_DB`/`TENANT_MONGO_URI` |
| `BACKUP_KEEP_FAILED_DAYS` | `3` | Giữ thư mục `<giờ>.failed` |
| `BACKUP_MONGO_TIMEOUT_MS` | `10000` | Timeout chọn máy chủ khi đọc danh sách shop |
| `BACKUP_LOCK_FILE`, `BACKUP_LOCK_WAIT` | `$BACKUP_DIR/.lock`, `0` | Khoá dùng chung giữa sao lưu và khôi phục |
| `MONGODUMP_EXTRA_ARGS`, `MONGORESTORE_EXTRA_ARGS` | – | Tham số thêm cho công cụ |
| `BACKUP_S3_EXTRA_ARGS`, `BACKUP_RCLONE_EXTRA_ARGS` | – | Tham số thêm khi tải lên |
| `NODE` | `node` | Đường dẫn Node khi `node` không có trên `PATH` của root (ví dụ cài bằng nvm) – đặt được trong `backup.env` |

## 5. Caddy

| Biến | Ý nghĩa |
|---|---|
| `ACME_EMAIL` | Email đăng ký ACME (`{$ACME_EMAIL}` trong `deploy/Caddyfile`) |
| `CLOUDFLARE_API_TOKEN` | Token API Cloudflare quyền *Zone → DNS → Edit* (và *Zone → Zone → Read*) cho zone `hitechpos.vn`, dùng cho chứng chỉ wildcard qua DNS-01. Nhà cung cấp DNS khác: biến theo module `caddy-dns/<nhà cung cấp>` |

## 6. Biến lúc build ứng dụng di động (không phải máy chủ)

| Biến | Ứng dụng | Ý nghĩa |
|---|---|---|
| `EXPO_PUBLIC_HITECHPOS_CLOUD_ORIGIN` | `upstream/business` | Origin control plane; phải trùng `PUBLIC_URL`/`BUSINESS_CLOUD_ISSUER` |
| `HITECHPOS_CLOUD_SUFFIX`, `HITECHPOS_ACCOUNT_ORIGIN` | `upstream/captain` (`scripts/hitechpos-config.js`) | Hậu tố tên miền shop (mặc định `.hitechpos.vn`), trang tài khoản (mặc định `https://app.hitechpos.vn`) |
