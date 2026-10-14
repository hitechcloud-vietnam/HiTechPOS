# Triển khai HiTechPOS lên production

Hướng dẫn đưa một máy **Ubuntu 24.04 LTS** trắng tới nền tảng HiTechPOS chạy thật: control plane `app.hitechpos.vn`, Posnic shard phục vụ `<cửa-hàng>.hitechpos.vn`, MongoDB replica set, Caddy (TLS wildcard + tên miền riêng của shop), PM2, sao lưu, giám sát.

Tài liệu đi kèm:

- [deploy/ENV.md](deploy/ENV.md) – tham chiếu **mọi** biến môi trường của control plane, shard, sao lưu, Caddy.
- [deploy/RUNBOOK.md](deploy/RUNBOOK.md) – vận hành hằng ngày và xử lý sự cố (triệu chứng → nguyên nhân → cách sửa).
- [ARCHITECTURE.md](ARCHITECTURE.md) (kiến trúc, hợp đồng control plane ↔ shard), [API.md](API.md), [BUSINESS-APP.md](BUSINESS-APP.md), [DOI-TAC.md](DOI-TAC.md), [UPSTREAM.md](UPSTREAM.md).
- Việc vận hành còn mở: [todo/07-van-hanh.md](todo/07-van-hanh.md); bảo mật còn mở: [todo/03-bao-mat.md](todo/03-bao-mat.md); xác minh tích hợp nhà cung cấp: [todo/02-xac-minh-tich-hop.md](todo/02-xac-minh-tich-hop.md).

Quy ước: lệnh có `sudo` chạy bằng tài khoản quản trị; lệnh `sudo -u hitechpos …` chạy bằng user dịch vụ. Tên miền ví dụ là `hitechpos.vn`, mã nguồn ở `/opt/hitechpos`. Các mục ghi **(chưa kiểm chứng)** là bước phụ thuộc hệ thống/nhà cung cấp bên ngoài không chạy được trong môi trường viết tài liệu – xem [Phạm vi kiểm chứng](#phạm-vi-kiểm-chứng).

## Mục lục

1. [Kiến trúc & yêu cầu](#kiến-trúc--yêu-cầu)
2. [Chuẩn bị máy chủ](#chuẩn-bị-máy-chủ)
3. [Lấy mã nguồn & cài đặt](#lấy-mã-nguồn--cài-đặt)
4. [Bí mật & cấu hình](#bí-mật--cấu-hình)
5. [Khởi chạy](#khởi-chạy)
6. [Sau khi chạy](#sau-khi-chạy)
7. [Migration theo từng shop](#migration-theo-từng-shop)
8. [Phát hành, nâng cấp, quay lui](#phát-hành-nâng-cấp-quay-lui)
9. [Mở rộng](#mở-rộng)
10. [Giám sát](#giám-sát) · [Sao lưu & khôi phục](#sao-lưu--khôi-phục) · [Diễn tập khôi phục thảm hoạ](#diễn-tập-khôi-phục-thảm-hoạ)
11. [Bảo mật vận hành](#bảo-mật-vận-hành)
12. [Xử lý sự cố](#xử-lý-sự-cố)
13. [Docker Compose (chỉ cho staging)](#docker-compose-chỉ-cho-staging)
14. [Phạm vi kiểm chứng](#phạm-vi-kiểm-chứng)

---

## Kiến trúc & yêu cầu

### Thành phần

| Dịch vụ | Mã | Lắng nghe | Tên miền | Tiến trình PM2 |
|---|---|---|---|---|
| Control plane (đăng ký, gói cước, thanh toán, HĐĐT, `/admin`, `/account`, trang công khai, `/help`) | `apps/control-plane/src/server.js` | `127.0.0.1:4100` | `app.hitechpos.vn` | `hitechpos-control-plane` |
| Posnic shard (API + giao diện bán hàng của mọi shop) | `upstream/pos/api/shard.js` | `127.0.0.1:6000` | `*.hitechpos.vn`, tên miền riêng đã xác minh | `hitechpos-shard` |
| MongoDB replica set `rs0` | – | `127.0.0.1:27017` (hoặc IP nội bộ) | – | systemd `mongod` |
| Caddy (TLS, reverse proxy) | `deploy/Caddyfile` | `:80`, `:443` | tất cả | systemd `caddy` |

Luồng chính (chi tiết ở [ARCHITECTURE.md](ARCHITECTURE.md)):

```
Internet ──443──► Caddy ─┬─ app.hitechpos.vn ─────────────► control plane :4100 ──┐
                         ├─ *.hitechpos.vn, tên miền riêng ► shard :6000 ─────────┤ (một cụm MongoDB)
                         │   (xoá header X-Hitech-Shop)      │  QR tại quầy        ▼
                         └─ on_demand_tls ask ─► :4100/internal/tls-ask        hitechpos_control
control plane ──node:http + X-Hitech-Shop──► shard (cài shop mới)               hitech_t_<shop> …
shard ──HITECH_PAY_URL──► control plane /pos/v1 (QR tại quầy)
payOS / Pay2S ──webhook──► app.hitechpos.vn/webhooks/...
```

Ba điều kiện mã nguồn đặt ra cho hạ tầng:

- **Một cụm MongoDB cho control DB và mọi DB shop của một shard.** Shard mở DB shop bằng chính kết nối `CONTROL_URI` (`mongoose.connection.useDb`), và `shopBridge` của control plane cũng ghi vào DB shop qua `CONTROL_URI`.
- **Shard và control plane dùng chung** `TENANT_SECRET_KEY`, `POSNIC_KEY`/`POSNIC_SECRET`, `CONTROL_DB`, `SHOP_BASE_DOMAINS`, `SHARD_SHOP_HEADER`.
- **Chỉ Caddy mở ra Internet.** Control plane tin đúng **một** proxy phía trước (`trust proxy 1`) để lấy IP khách cho giới hạn tần suất; shard cũng vậy khi `NODE_ENV=production`.

### Cỡ máy

Chưa có đo tải của HiTechPOS. Số liệu dưới đây dựa trên: đo của Posnic ghi trong `shard.js` (~125 MB cho runtime + ~6 MB mỗi shop), quan sát khi viết tài liệu (shard mới khởi động ~175 MB RSS, control plane ~90 MB), giới hạn trong `deploy/ecosystem.config.js` (shard `--max-old-space-size=2048`, tự khởi động lại ở 2,5 GB; control plane ở 800 MB), và số tệp WiredTiger mỗi shop (shop mới: 21 collection + 44 index ≈ 65 tệp; shop dùng nhiều tính năng có thể gấp vài lần). **Coi là điểm xuất phát, đo lại khi có tải thật.**

| Quy mô | Gợi ý | Ghi chú |
|---|---|---|
| Nhỏ – thử nghiệm, ≤ 50 shop | 1 máy 2 vCPU, 4 GB RAM, 60 GB SSD; MongoDB một node `rs0` cùng máy (`cacheSizeGB: 1`); swap 2–4 GB | Một máy hỏng = dừng toàn bộ; bắt buộc sao lưu ra ngoài máy |
| Vừa – 50–300 shop | Máy ứng dụng 4 vCPU/8 GB (Caddy + PM2); MongoDB 3 node (mỗi node 4 vCPU/8–16 GB, SSD) trong mạng riêng | Một tiến trình shard là một luồng Node: theo dõi `eventloop lag`, RAM shard; tăng `ulimit -n` của mongod |
| Lớn – > 300 shop | Nhiều máy shard (`SHARD_INSTANCE`), cụm MongoDB lớn hơn | Mọi shard vẫn phải dùng **một** cụm MongoDB với control DB (xem [Mở rộng](#mở-rộng)); hàng chục nghìn collection trên một cụm cần thử tải trước. Nếu dùng MongoDB Atlas, kiểm tra giới hạn số DB/collection của gói (Posnic cũng nêu điểm này trong `upstream/pos/docs/CLOUD_OPERATIONS.md`) |

Dung lượng dữ liệu: shop mới < 1 MB; Posnic ước tính 5–50 MB/năm cho mỗi máy bán hàng. Sao lưu nén gzip, giữ 7 bản ngày + 4 bản tuần theo mặc định – dự trù ~10 lần dung lượng DB cho `/var/backups`.

### Cổng

| Cổng | Hướng | Mở cho | Ghi chú |
|---|---|---|---|
| 22/tcp | vào | IP quản trị | SSH, chỉ dùng khoá |
| 80/tcp, 443/tcp | vào | Internet | Caddy. 80 cần cho thử thách HTTP-01/TLS-ALPN (chứng chỉ `app.`, tên miền riêng) và chuyển hướng HTTPS |
| 4100/tcp | – | chỉ `127.0.0.1` | Control plane. `/internal/tls-ask` chỉ trả lời yêu cầu loopback không có `X-Forwarded-For` |
| 6000/tcp | – | chỉ `127.0.0.1` | Shard. Lộ ra ngoài = ai cũng gửi được `X-Hitech-Shop` |
| 27017/tcp | – | `127.0.0.1` (1 node) hoặc mạng riêng giữa các node/máy ứng dụng (3 node) | **Không bao giờ mở ra Internet** |
| 2019/tcp | – | `127.0.0.1` | API quản trị của Caddy (mặc định) |

### DNS

| Bản ghi | Giá trị | Mục đích |
|---|---|---|
| `app.hitechpos.vn` A/AAAA | IP máy chạy Caddy | Control plane |
| `*.hitechpos.vn` A/AAAA | IP máy chạy Caddy | Mọi shop (`<sub>.hitechpos.vn`) |
| `hitechpos.vn`, `www.hitechpos.vn` | Máy chủ trang giới thiệu, hoặc chính máy này với khối chuyển hướng (xem [Caddyfile khuyến nghị](#cấu-hình-caddy)) | Chứng chỉ wildcard **không** phủ tên miền gốc. `www` nằm trong danh sách tên giữ chỗ nên không shop nào lấy được, nhưng nếu không có khối riêng thì `www.hitechpos.vn` rơi vào khối wildcard và shard trả 404 |
| TXT/SPF, DKIM, DMARC cho tên miền gửi mail | Theo nhà cung cấp SMTP | Xem [Email](#email-smtp-và-khả-năng-vào-hộp-thư) |
| CAA (tuỳ chọn) | `0 issue "letsencrypt.org"` (+ CA dự phòng của Caddy nếu dùng) | **(chưa kiểm chứng)** – Caddy mặc định có thể dùng ZeroSSL khi Let's Encrypt lỗi; thêm CAA thì phải cho phép cả CA đó |

Nếu DNS ở Cloudflare: để **DNS only** (mây xám) cho `app` và `*`. Bật proxy (mây cam) thì IP mà Caddy nhìn thấy là IP biên của Cloudflare: mọi khách dùng chung một hạn mức đăng nhập/đăng ký theo IP và bị `429` hàng loạt; tên miền riêng của shop (CNAME tới `<sub>.hitechpos.vn`) cũng không còn đi thẳng tới Caddy.

Tên miền riêng của shop (gói có `custom-domain`): chủ shop tự tạo `TXT _hitechpos.<tên miền> = hitechpos-verify=<mã>` và `CNAME <tên miền> → <sub>.hitechpos.vn` (trang `/account` hiển thị, `apps/control-plane/src/domains.js`). Control plane tự tra DNS TXT nên máy cần ra được cổng 53.

### Mạng đi ra

Mặc định Ubuntu cho phép mọi kết nối ra. Nếu lọc egress, mở tối thiểu:

| Đích | Cổng | Ai dùng | Nguồn |
|---|---|---|---|
| DNS resolver | 53 udp/tcp | control plane (xác minh tên miền riêng), mọi thứ | `domains.js` |
| `acme-v02.api.letsencrypt.org` (và CA dự phòng) | 443 | Caddy | |
| `api.cloudflare.com` (hoặc API của nhà cung cấp DNS) | 443 | Caddy (DNS-01 cho wildcard) | |
| `api-merchant.payos.vn` | 443 | control plane | `packages/payment-payos/src/client.js` |
| `payment.pay2s.vn`, `sandbox-payment.pay2s.vn` | 443 | control plane | `packages/payment-pay2s/src/client.js` |
| `api-vinvoice.viettel.vn` (production), `demo-sinvoice.viettel.vn` (sandbox – **chưa xác minh**, hỏi Viettel) | 443 | control plane | `packages/einvoice-vn/src/providers/viettel.js` |
| `api.meinvoice.vn`, `testapi.meinvoice.vn` | 443 | control plane | `misa.js` |
| `api-hddt.matbao.in`, `demo-api-hddt.matbao.in` | **11443** | control plane | `matbao.js` – cổng khác 443, hay bị quên khi lọc egress |
| Máy chủ SMTP | 465 hoặc 587 | control plane | `SMTP_URL` |
| `registry.npmjs.org`, `github.com`, kho apt (Ubuntu, NodeSource, MongoDB, Caddy) | 443 | cài đặt/nâng cấp | |
| Kho sao lưu ngoài (S3-compatible/rclone) | 443 | `scripts/backup/backup.sh` | |

VietQR **không** cần mạng ra: mã QR (chuẩn EMVCo/NAPAS) và ảnh SVG được control plane tự sinh (`packages/vietqr`, `/api/public/pay/.../qr.svg`). Chiều vào: payOS/Pay2S gọi webhook tới `https://app.hitechpos.vn/webhooks/...` – không giới hạn IP nguồn của các đường dẫn này (dải IP của nhà cung cấp chưa được xác minh; mọi webhook đều được kiểm chữ ký/token).

### Tường lửa (ufw)

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <IP-quản-trị> to any port 22 proto tcp   # hoặc: sudo ufw limit OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Chỉ khi MongoDB 3 node / máy ứng dụng tách riêng (mạng riêng 10.0.0.0/24 là ví dụ):
# sudo ufw allow from 10.0.0.0/24 to any port 27017 proto tcp
sudo ufw enable
sudo ufw status verbose
```

**(chưa kiểm chứng trên máy viết tài liệu – không có ufw.)** Lưu ý Docker ghi luật iptables riêng, bỏ qua ufw với cổng được publish – lý do `deploy/docker-compose.yml` chỉ publish trên `127.0.0.1`.

---

## Chuẩn bị máy chủ

### Hệ điều hành, giờ hệ thống, cập nhật tự động

```sh
sudo apt-get update && sudo apt-get -y full-upgrade
sudo apt-get install -y curl ca-certificates gnupg git build-essential jq unattended-upgrades
sudo timedatectl set-timezone UTC          # giữ UTC – xem dưới
timedatectl                                 # "System clock synchronized: yes"
sudo dpkg-reconfigure -plow unattended-upgrades
```

- **Giữ múi giờ hệ thống UTC.** Mã tự xử lý giờ Việt Nam (chi nhánh có `time_zone: Asia/Ho_Chi_Minh`, sổ sách/hoá đơn dùng UTC+7 cố định, timer sao lưu ghi rõ `Asia/Ho_Chi_Minh`). `deploy/cron/hitechpos-backup` giả định cron chạy theo UTC (`15 19 * * *` = 02:15 giờ VN); đổi múi giờ hệ thống thì phải sửa dòng cron.
- Đồng hồ phải được đồng bộ (`systemd-timesyncd` mặc định hoặc `chrony`): JWT, hạn link thanh toán, thời điểm lập hoá đơn điện tử (từ chối nếu ở tương lai quá 5 phút) đều dựa vào giờ máy.
- `unattended-upgrades` chỉ áp bản vá bảo mật Ubuntu; giữ MongoDB và Caddy ở phiên bản cố định: `sudo apt-mark hold mongodb-org mongodb-org-server mongodb-org-mongos mongodb-org-tools caddy` và nâng cấp có kế hoạch.

### Swap, giới hạn tệp, sysctl

```sh
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=1' | sudo tee /etc/sysctl.d/60-hitechpos.conf
echo 'vm.max_map_count=262144' | sudo tee -a /etc/sysctl.d/60-hitechpos.conf
sudo sysctl --system
```

- Swap chỉ là lưới an toàn cho đỉnh RAM; MongoDB khuyến nghị `swappiness` thấp.
- MongoDB mở một tệp cho mỗi collection và mỗi index (≈ 65 tệp cho một shop mới). Gói `mongodb-org` cài unit systemd với `LimitNOFILE=64000` **(chưa kiểm chứng – xem `systemctl show mongod -p LimitNOFILE`)**; từ vài trăm shop trở lên nâng lên:

  ```sh
  sudo systemctl edit mongod
  # [Service]
  # LimitNOFILE=1048576
  sudo systemctl daemon-reload && sudo systemctl restart mongod
  ```

- Transparent Huge Pages và các tham số khác: làm theo *Production Notes* đúng phiên bản MongoDB đang cài (khuyến nghị THP khác nhau giữa 7.0 và 8.0) **(chưa kiểm chứng)**.

### User dịch vụ

```sh
sudo adduser --system --group --home /home/hitechpos --shell /bin/bash hitechpos
sudo install -d -o hitechpos -g hitechpos -m 755 /opt/hitechpos
```

PM2, mã nguồn và log ứng dụng thuộc `hitechpos`; Caddy và MongoDB chạy bằng user của gói (`caddy`, `mongodb`); sao lưu chạy bằng root (đọc `/etc/hitechpos/*.env`).

### Node.js 22 và PM2

Dùng NodeSource để `node` nằm ở `/usr/bin/node` cho mọi user (systemd unit sao lưu, cron, PM2 khởi động cùng máy):

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
node -v                      # v22.x
sudo npm install -g pm2@6.0.13
```

nvm cũng dùng được, nhưng `node` khi đó chỉ có trong PATH của `hitechpos`: đặt `NODE=/home/hitechpos/.nvm/versions/node/<v>/bin/node` trong `/etc/hitechpos/backup.env` và chạy `pm2 startup` với PATH đầy đủ.

### Caddy có module DNS (chứng chỉ wildcard)

`*.hitechpos.vn` chỉ cấp được qua thử thách DNS-01, nên Caddy phải được build kèm module DNS của nhà cung cấp – bản Caddy trong kho apt không có. Có sẵn module cho Cloudflare (`github.com/caddy-dns/cloudflare`), Route 53, DigitalOcean, Google Cloud DNS, Azure, deSEC, PowerDNS, RFC 2136… (danh sách ở https://github.com/caddy-dns). Nếu nhà cung cấp DNS tên miền không có module, có thể uỷ quyền riêng `_acme-challenge.hitechpos.vn` (CNAME) sang một zone ở nhà cung cấp có module **(chưa kiểm chứng)**.

1. Cài gói Caddy chính thức để có user `caddy`, unit systemd và thư mục `/etc/caddy` (theo tài liệu Caddy, **chưa chạy trên máy viết tài liệu**):

   ```sh
   sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt-get update && sudo apt-get install -y caddy
   ```

2. Build bản có module (đã chạy khi viết tài liệu: Caddy v2.10.2 + `caddy-dns/cloudflare`, `xcaddy` v0.4.5). Caddy 2.10.2 cần Go ≥ 1.25; Go 1.22 của Ubuntu 24.04 tự tải toolchain mới nhờ `GOTOOLCHAIN=auto`. Nên build trên máy build rồi chép binary sang:

   ```sh
   sudo apt-get install -y golang-go
   export GOTOOLCHAIN=auto
   go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.5
   ~/go/bin/xcaddy build v2.10.2 --with github.com/caddy-dns/cloudflare --output ./caddy
   ./caddy list-modules | grep dns.providers      # dns.providers.cloudflare
   ```

3. Thay binary của gói bằng bản vừa build (cách Caddy khuyến nghị, **chưa kiểm chứng**):

   ```sh
   sudo dpkg-divert --divert /usr/bin/caddy.default --rename /usr/bin/caddy
   sudo install -m 755 ./caddy /usr/bin/caddy.custom
   sudo update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.default 10
   sudo update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.custom 50
   caddy version
   ```

4. Biến môi trường cho Caddy:

   ```sh
   sudo install -m 600 -o root -g root /dev/null /etc/caddy/caddy.env
   sudo tee /etc/caddy/caddy.env >/dev/null <<'EOF'
   ACME_EMAIL=ops@hitechpos.vn
   CLOUDFLARE_API_TOKEN=<token quyền Zone.DNS:Edit + Zone:Read cho hitechpos.vn>
   EOF
   sudo systemctl edit caddy
   # [Service]
   # EnvironmentFile=/etc/caddy/caddy.env
   ```

   Cấu hình Caddyfile ở bước [Khởi chạy](#cấu-hình-caddy).

### MongoDB 8.0 (replica set, xác thực, keyfile)

Code cần **replica set** (transaction/change stream của driver; mọi URI đều có `replicaSet=rs0`). MongoDB 7.0 hoặc 8.0 đều được; kho chính thức của MongoDB 8.0 hỗ trợ Ubuntu 24.04 – với 7.0 hãy kiểm tra bảng nền tảng hỗ trợ trước. Phiên bản dùng khi viết tài liệu: mongod 8.3.7, mongosh 2.5.8, Database Tools 100.13.0.

Cài (theo tài liệu MongoDB, **chưa chạy trên máy viết tài liệu** – không có mạng tới `repo.mongodb.org`):

```sh
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org     # gồm mongod, mongosh, mongodb-database-tools
```

Keyfile (bắt buộc khi bật xác thực trên replica set, kể cả một node):

```sh
sudo install -d -o mongodb -g mongodb -m 700 /etc/mongodb
openssl rand -base64 756 | sudo tee /etc/mongodb/keyfile >/dev/null
sudo chown mongodb:mongodb /etc/mongodb/keyfile && sudo chmod 400 /etc/mongodb/keyfile
```

`/etc/mongod.conf` (các khoá dưới đây đã chạy thật với mongod 8.3.7):

```yaml
storage:
  dbPath: /var/lib/mongodb
  # wiredTiger: { engineConfig: { cacheSizeGB: 1 } }   # máy dùng chung với ứng dụng
systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
net:
  port: 27017
  bindIp: 127.0.0.1            # 3 node: 127.0.0.1,<IP nội bộ của node>
replication:
  replSetName: rs0
security:
  authorization: enabled
  keyFile: /etc/mongodb/keyfile
processManagement:
  timeZoneInfo: /usr/share/zoneinfo
```

Khởi tạo replica set một node và user quản trị đầu tiên (ngoại lệ localhost của MongoDB cho phép hai lệnh này khi chưa có user):

```sh
sudo systemctl enable --now mongod
openssl rand -hex 24          # mật khẩu root – lưu vào trình quản lý mật khẩu
mongosh --quiet --eval "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })"
sleep 5
mongosh --quiet admin --eval "db.createUser({ user: 'root', pwd: '<mk-root>', roles: [{ role: 'root', db: 'admin' }] })"
```

`host` của member là địa chỉ mà **mọi** client dùng để kết nối (driver lấy danh sách máy từ cấu hình replica set). Một node, mọi client cùng máy: `127.0.0.1:27017`. Có client ở máy khác: dùng tên DNS nội bộ.

User cho ứng dụng và sao lưu (đã kiểm chứng: shard + control plane chạy đủ luồng đăng ký → cài shop → onboarding → QR → migration với `readWriteAnyDatabase`; `backup.sh` với `backup`; `restore-tenant.sh` cần **cả** `restore` và `backup` – chỉ `restore` thì bước đếm lại sau khi ghi lỗi `unexpected error: 13`):

```sh
umask 077
cat > ~/hitechpos-users.js <<EOF
const admin = db.getSiblingDB('admin');
admin.createUser({ user: 'hitechpos', pwd: '$(openssl rand -hex 24)', roles: [{ role: 'readWriteAnyDatabase', db: 'admin' }] });
admin.createUser({ user: 'hitechpos_backup', pwd: '$(openssl rand -hex 24)', roles: [{ role: 'backup', db: 'admin' }] });
admin.createUser({ user: 'hitechpos_restore', pwd: '$(openssl rand -hex 24)', roles: [{ role: 'restore', db: 'admin' }, { role: 'backup', db: 'admin' }] });
EOF
cat ~/hitechpos-users.js          # chép ba mật khẩu vào trình quản lý mật khẩu
mongosh --quiet "mongodb://root:<mk-root>@127.0.0.1:27017/admin?replicaSet=rs0" ~/hitechpos-users.js
shred -u ~/hitechpos-users.js
```

`readWriteAnyDatabase` là cần thiết vì mỗi shop là một DB mới `hitech_t_<shop>` tạo lúc đăng ký (MongoDB không có quyền theo tiền tố tên DB). Đặt mật khẩu chỉ gồm chữ và số (`openssl rand -hex 24`) để dùng thẳng trong URI.

Kiểm tra:

```sh
mongosh --quiet "mongodb://hitechpos:<mk>@127.0.0.1:27017/?replicaSet=rs0&authSource=admin" --eval "rs.status().members.map(m => m.stateStr)"
mongodump --version
```

**Replica set 3 node (chưa kiểm chứng – chỉ có một máy khi viết tài liệu):** cài như trên ở ba máy trong mạng riêng, cùng một keyfile (chép an toàn, quyền 400, chủ `mongodb`), `bindIp: 127.0.0.1,<IP riêng>`, mở 27017 giữa ba node và từ máy ứng dụng (ufw ở trên). Khởi tạo trên một node:

```js
rs.initiate({ _id: 'rs0', members: [
  { _id: 0, host: 'mongo1.internal:27017' },
  { _id: 1, host: 'mongo2.internal:27017' },
  { _id: 2, host: 'mongo3.internal:27017' },
] })
```

rồi tạo user trên primary và dùng URI `mongodb://hitechpos:<mk>@mongo1.internal:27017,mongo2.internal:27017,mongo3.internal:27017/?replicaSet=rs0&authSource=admin`. Nên chạy `backup.sh` với `readPreference=secondary` trong `BACKUP_MONGO_URI` để giảm tải primary.

### MongoDB Database Tools

`mongodump`/`mongorestore` cho `scripts/backup`. Gói `mongodb-org` đã kéo theo `mongodb-database-tools`; nếu MongoDB ở máy khác: `sudo apt-get install -y mongodb-database-tools` (cùng kho apt). Đặt ở chỗ khác thì khai `MONGO_TOOLS_DIR` trong `backup.env`.

---

## Lấy mã nguồn & cài đặt

Lần đầu (các lệnh `npm` và build giao diện dưới đây đã chạy thật trên bản sao sạch của repo):

```sh
sudo -u hitechpos git clone https://github.com/hitechcloud-vietnam/HiTechPOS.git /opt/hitechpos
cd /opt/hitechpos
sudo -u hitechpos git checkout v0.2.1          # luôn triển khai một tag đã phát hành

# 1. Control plane + các gói @hitechpos/* (workspaces)
sudo -u hitechpos npm ci --omit=dev --no-audit --no-fund

# 2. Posnic API (shard). Lockfile của Posnic trỏ một phần sang registry.npmmirror.com,
#    hay treo/bị chặn: thay host như CI. --ignore-scripts bỏ bước tải Chromium của
#    puppeteer (chỉ dùng cho WhatsApp của Posnic – HiTechPOS không dùng).
(cd upstream/pos/api && sudo -u hitechpos npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
   --replace-registry-host=registry.npmmirror.com --registry=https://registry.npmjs.org/)

# 3. Giao diện bán hàng web: build ra upstream/pos/frontend/public/ (thư mục bị .gitignore,
#    phải build ở mỗi lần triển khai). Lệnh giống job e2e-ui của CI.
(cd upstream/pos/frontend && sudo -u hitechpos npm ci --no-audit --no-fund && sudo -u hitechpos npm run build:assets)
ls upstream/pos/frontend/public/login.html
```

Thời gian đo được: (1) ~2 s, (2) ~15 s, (3) ~30 s. Thiếu bước 3 thì `https://<shop>.hitechpos.vn/` trả JSON `Welcome to the Posnic API v2` và `/login.html` 404.

Thương hiệu trên hoá đơn và `/brand.json` của shop lấy từ `deploy/brand/` (`brand.json`, `brand-logo.png`, `brand-login-logo.png`); `ecosystem.config.js` luôn trỏ `POSNIC_BRAND_DIR` vào thư mục này, nên tuỳ biến thương hiệu phải được commit vào repo (hoặc sửa ecosystem). Các khoá hợp lệ của `brand.json`: `enabled`, `name`, `url`, `accountUrl`, `supportUrl`, `downloadUrl`, `supportEmail` (chỉ https/email hợp lệ – [UPSTREAM.md](UPSTREAM.md)).

---

## Bí mật & cấu hình

### Sinh bí mật: `deploy/bootstrap-secrets.sh`

Cần Node (dùng để sinh số ngẫu nhiên) và URI của user `hitechpos`. Chạy **một lần**; script từ chối ghi đè nếu `/etc/hitechpos/shard.env` đã tồn tại.

```sh
cd /opt/hitechpos
sudo MONGO_URI='mongodb://hitechpos:<mk>@127.0.0.1:27017/?replicaSet=rs0&authSource=admin' sh deploy/bootstrap-secrets.sh
```

Để URI trong **nháy đơn** (có `&`). Script (đã chạy thử với thư mục đích trong vùng nháp):

- tạo `/etc/hitechpos/` (0700) và hai tệp 0600;
- sinh `TENANT_SECRET_KEY` (32 byte hex), `POSNIC_KEY` (16 byte), `POSNIC_SECRET` (32 byte), `SESSION_SECRET` (32 byte, mỗi tiến trình một giá trị riêng), `ADMIN_API_KEY` (24 byte);
- `shard.env`: `CONTROL_URI`, `MONGODB_URI`, `CONTROL_DB=hitechpos_control`, `TENANT_SECRET_KEY`, `SHOP_BASE_DOMAINS=hitechpos.vn`, `POSNIC_KEY`, `POSNIC_SECRET`, `HITECH_PAY_URL=http://127.0.0.1:4100`, `SESSION_SECRET` (khoá cookie express-session của shard);
- `control-plane.env`: `PUBLIC_URL=https://app.hitechpos.vn`, `CONTROL_URI`, `CONTROL_DB`, `TENANT_SECRET_KEY`, `SESSION_SECRET`, `ADMIN_API_KEY`, `SHOP_BASE_DOMAINS`, `POSNIC_KEY`, `POSNIC_SECRET`, `SAAS_VAT_RATE=KCT`, và dòng chú thích cho payOS/Pay2S.

### Bổ sung sau khi chạy script

```sh
hex() { node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }
# Shard: SESSION_SECRET đã có từ bản 0.2.1 của script; tệp tạo bằng bản cũ thì thêm:
grep -q '^SESSION_SECRET=' /etc/hitechpos/shard.env || echo "SESSION_SECRET=$(hex 32)" | sudo tee -a /etc/hitechpos/shard.env >/dev/null
echo "DEFAULT_TIMEZONE=Asia/Ho_Chi_Minh" | sudo tee -a /etc/hitechpos/shard.env >/dev/null
# Control plane: token cho Prometheus, SMTP
echo "METRICS_TOKEN=$(hex 24)" | sudo tee -a /etc/hitechpos/control-plane.env >/dev/null
sudo tee -a /etc/hitechpos/control-plane.env >/dev/null <<'EOF'
SMTP_URL=smtps://no-reply%40hitechpos.vn:<mk>@smtp.example.vn:465
MAIL_FROM=HiTechPOS <no-reply@hitechpos.vn>
EOF
```

Cấu hình thanh toán phí thuê bao (payOS/Pay2S) thêm sau, ở [mục 6](#thanh-toán-phí-thuê-bao-của-nền-tảng). Danh sách đầy đủ, mặc định và ý nghĩa: [deploy/ENV.md](deploy/ENV.md).

### Quyền tệp

PM2 chạy bằng `hitechpos` và đọc các tệp env **lúc chạy `pm2 start/reload`**; tệp có nhưng không đọc được làm `pm2 start` báo lỗi `cannot read /etc/hitechpos/… (EACCES)` (tệp không tồn tại thì được bỏ qua). Sao lưu chạy bằng root.

```sh
sudo chgrp hitechpos /etc/hitechpos && sudo chmod 750 /etc/hitechpos
sudo chown hitechpos:hitechpos /etc/hitechpos/shard.env /etc/hitechpos/control-plane.env
sudo chmod 600 /etc/hitechpos/*.env
sudo -u hitechpos test -r /etc/hitechpos/control-plane.env && echo ok
```

Không tạo `upstream/pos/api/.env` trên máy production – shard nạp tệp đó nếu có.

### Giữ `TENANT_SECRET_KEY`

- Khoá này mở **mọi** secret của mọi shop: khoá ký JWT/phiên của shop (`tenants.secrets`), khoá nội bộ QR (`HITECH_POS_KEY`), API key/checksum payOS, secret key Pay2S, token biến động số dư, mật khẩu nhà cung cấp hoá đơn điện tử.
- Mất khoá = mọi shop ngừng được phục vụ (shard bỏ qua shop không mở được secret) và mọi cấu hình thanh toán/HĐĐT phải nhập lại. Lộ khoá + bản sao control DB = lộ toàn bộ khoá thanh toán của các shop.
- **Không có công cụ xoay khoá.** Đổi giá trị trong tệp env là làm hỏng toàn bộ dữ liệu đã niêm phong; xoay khoá cần một script mở bằng khoá cũ và niêm phong lại bằng khoá mới cho mọi trường kể trên (chưa có trong repo).
- Lưu tối thiểu hai bản ngoại tuyến (trình quản lý mật khẩu của công ty + bản in niêm phong trong két), do hai người khác nhau giữ; **không** để cùng chỗ với bản sao lưu MongoDB. Ghi lại ngày tạo và ai giữ.

### Xoay các bí mật khác

| Bí mật | Cách đổi | Ảnh hưởng |
|---|---|---|
| `ADMIN_API_KEY` | Sinh mới, sửa `control-plane.env`, `pm2 reload deploy/ecosystem.config.js --only hitechpos-control-plane --update-env` | Trang `/admin` đang mở phải nhập lại khoá; script/giám sát dùng `X-Admin-Key` phải cập nhật. Không có dữ liệu nào phụ thuộc khoá cũ |
| `METRICS_TOKEN` | Như trên, đồng thời sửa cấu hình Prometheus | Vài lần scrape `401` trong lúc chuyển |
| `SESSION_SECRET` (control plane) | Như trên | Mọi chủ shop và đối tác bị đăng xuất (JWT cũ không còn hợp lệ); yêu cầu kết nối ứng dụng Business đang dở cần làm lại. Liên kết đặt lại mật khẩu không bị ảnh hưởng |
| `SESSION_SECRET` (shard) | Sửa `shard.env`, reload shard | Phiên `express-session` của máy bán hàng mất (như một lần khởi động lại) |
| `POSNIC_KEY`/`POSNIC_SECRET` | Đổi **cùng giá trị** ở cả hai tệp, reload cả hai tiến trình | Chỉ dùng khi cài shop mới; lệch nhau → shop mới `install_failed` |
| Mật khẩu MongoDB | `db.getSiblingDB('admin').changeUserPassword('hitechpos', passwordPrompt())`, sửa URI ở cả hai tệp (và `backup.env`), reload cả hai | Tiến trình chưa reload vẫn chạy bằng kết nối cũ cho tới khi mở kết nối mới – reload ngay |
| `TENANT_SECRET_KEY` | **Không xoay được** – xem trên | – |

---

## Khởi chạy

### PM2

```sh
cd /opt/hitechpos
sudo -u hitechpos pm2 start deploy/ecosystem.config.js
sudo -u hitechpos pm2 ls                        # hitechpos-shard, hitechpos-control-plane: online
sudo -u hitechpos pm2 logs --lines 50 --nostream
```

Log khởi động bình thường:

```
[shard] serving 0 hostname(s) across 0 shop(s)
[shard] listening on http://127.0.0.1:6000
[shard] pool 20, registry refresh 60s
[control-plane] http://127.0.0.1:4100 store=mongo providers=payos,pay2s
```

`providers=none` nghĩa là chưa cấu hình cổng thanh toán phí thuê bao. Dòng `[config] SESSION_SECRET is not set` của shard nghĩa là `shard.env` tạo bằng script cũ, chưa có `SESSION_SECRET` – xem bước [bổ sung](#bổ-sung-sau-khi-chạy-script). Tên tệp cấu hình phải kết thúc bằng `.config.js` – PM2 coi tệp tên khác là một script để chạy.

Khởi động cùng máy (**chưa kiểm chứng** – máy viết tài liệu không có systemd):

```sh
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u hitechpos --hp /home/hitechpos
sudo -u hitechpos pm2 save                      # ghi danh sách tiến trình vào ~/.pm2/dump.pm2
sudo systemctl status pm2-hitechpos
```

Chạy lại `pm2 save` sau mỗi lần thêm/xoá tiến trình.

Xoay log (đã chạy thử):

```sh
sudo -u hitechpos pm2 install pm2-logrotate
sudo -u hitechpos pm2 set pm2-logrotate:max_size 50M
sudo -u hitechpos pm2 set pm2-logrotate:retain 14
sudo -u hitechpos pm2 set pm2-logrotate:compress true
```

Log nằm ở `/home/hitechpos/.pm2/logs/`. Log có thể chứa email chủ shop (dòng `[notify]`) – là dữ liệu cá nhân, giữ quyền truy cập hẹp và thời hạn lưu hợp lý.

### Cấu hình Caddy

`deploy/Caddyfile` là cấu hình gốc (đã `caddy validate` thành công với bản build có module Cloudflare). Bản dưới đây bổ sung bốn điểm, cũng đã `caddy validate` và chạy thử các phần không cần chứng chỉ thật:

1. tên miền gốc/`www` chuyển về `app.`;
2. `/metrics` chỉ trả cho IP máy giám sát (vẫn cần token);
3. chặn `/api/install*` (trình cài đặt/xoá shop của Posnic) từ Internet – control plane gọi shard trực tiếp qua `127.0.0.1` nên không bị ảnh hưởng;
4. `lb_try_duration` giữ yêu cầu trong vài giây khi PM2 khởi động lại tiến trình. Đo khi viết tài liệu: reload shard dưới tải nhẹ, không có dòng này 16/40 yêu cầu nhận `502`; có dòng này 40/40 thành công.

```caddyfile
# /etc/caddy/Caddyfile - HiTechPOS (deploy/Caddyfile plus hardening)
{
	email {$ACME_EMAIL}
	on_demand_tls {
		ask http://127.0.0.1:4100/internal/tls-ask
	}
}

# Apex and www: send visitors to the public pages on the control plane.
hitechpos.vn, www.hitechpos.vn {
	redir https://app.hitechpos.vn{uri} permanent
}

app.hitechpos.vn {
	encode zstd gzip
	# /metrics only from the monitoring host (replace the example IP).
	@metrics_outside {
		path /metrics
		not remote_ip 203.0.113.10
	}
	respond @metrics_outside 403
	reverse_proxy 127.0.0.1:4100 {
		# Hold requests while PM2 restarts the process instead of answering 502.
		lb_try_duration 30s
		lb_try_interval 250ms
	}
}

(shop) {
	encode zstd gzip
	# Only the control plane (on localhost) may name a shop by header.
	request_header -X-Hitech-Shop
	# Posnic installer/cleanup: the control plane calls the shard directly.
	@installer path /api/install /api/install/*
	respond @installer 404
	reverse_proxy 127.0.0.1:6000 {
		header_up Host {host}
		lb_try_duration 30s
		lb_try_interval 250ms
	}
}

*.hitechpos.vn {
	tls {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}
	import shop
}

# Shops' own verified domains (on-demand certificates, asked of the control plane).
https:// {
	tls {
		on_demand
	}
	import shop
}
```

Nếu trang giới thiệu ở máy khác thì bỏ khối `hitechpos.vn, www.hitechpos.vn` (DNS của hai tên đó trỏ đi chỗ khác). Nhà cung cấp DNS khác Cloudflare: đổi dòng `dns cloudflare …` theo module tương ứng.

```sh
sudo cp /path/to/Caddyfile /etc/caddy/Caddyfile
sudo -u caddy env $(sudo cat /etc/caddy/caddy.env | xargs) caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
journalctl -u caddy -n 50 --no-pager          # "certificate obtained successfully" cho app. và *.
```

Phương án không có module DNS: bỏ khối `*.hitechpos.vn`; khi đó khối `https://` cấp chứng chỉ riêng cho từng `<shop>.hitechpos.vn` qua `on_demand` (endpoint `ask` chấp nhận mọi shop chưa bị khoá). Đổi lại là một chứng chỉ cho mỗi shop và giới hạn tần suất của Let's Encrypt (số chứng chỉ mỗi tuần cho một tên miền đăng ký) – chỉ hợp lý khi rất ít shop **(chưa kiểm chứng)**.

### Kiểm tra sau khi khởi chạy

Thay `$ADMIN_API_KEY`, `$METRICS_TOKEN` bằng giá trị trong `/etc/hitechpos/control-plane.env`. Các lệnh trên `127.0.0.1` đã chạy thật khi viết tài liệu, kết quả ghi bên phải.

```sh
# Trên máy chủ, không qua Caddy
curl -s http://127.0.0.1:4100/healthz            # {"ok":true,"store":"mongo","providers":[...]}
curl -s http://127.0.0.1:4100/readyz             # 200 {"ok":true,"checks":{"controlDb":{"ok":true,..},"shard":{"ok":true,"status":404,..}}}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4100/metrics                                      # 401
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:4100/metrics | grep control_db_up       # hitechpos_control_db_up 1
curl -s -H 'Host: khong-co.hitechpos.vn' http://127.0.0.1:6000/            # 404 No shop is served at this address.
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:4100/internal/tls-ask?domain=khong-co.hitechpos.vn'   # 404 (shop không tồn tại)
curl -s -H "X-Admin-Key: $ADMIN_API_KEY" http://127.0.0.1:4100/api/admin/ops | jq .ready

# Từ máy ngoài, qua Caddy
curl -sI https://app.hitechpos.vn/healthz | head -1                          # HTTP/2 200
curl -s -o /dev/null -w '%{http_code}\n' https://app.hitechpos.vn/metrics     # 403 (khác IP giám sát) hoặc 401 (Caddyfile gốc)
curl -s -o /dev/null -w '%{http_code}\n' 'https://app.hitechpos.vn/internal/tls-ask?domain=x.hitechpos.vn'   # 403
curl -s https://khong-co.hitechpos.vn/                                       # 404 No shop is served at this address.
# Header chọn shop bị Caddy xoá: vẫn 404 dù gửi tên một shop có thật
curl -s -H 'X-Hitech-Shop: <shop-có-thật>.hitechpos.vn' https://khong-co.hitechpos.vn/   # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<shop>.hitechpos.vn/api/install/add   # 404 (Caddyfile khuyến nghị)
# Chứng chỉ: wildcard cho shop, riêng cho app.
echo | openssl s_client -connect app.hitechpos.vn:443 -servername demo.hitechpos.vn 2>/dev/null \
  | openssl x509 -noout -subject -issuer -enddate -ext subjectAltName                  # DNS:*.hitechpos.vn
echo | openssl s_client -connect app.hitechpos.vn:443 -servername app.hitechpos.vn 2>/dev/null \
  | openssl x509 -noout -issuer -enddate
```

Phép thử header và `/api/install` đã chạy qua một Caddy cục bộ (HTTP và TLS nội bộ) đặt trước shard/control plane thật: gửi `X-Hitech-Shop` thẳng vào shard thì vào được shop (200), qua Caddy thì 404.

---

## Sau khi chạy

### Đăng ký shop đầu tiên (smoke test)

1. Mở `https://app.hitechpos.vn/`, đăng ký một shop thử (tên miền con 3–30 ký tự, không trùng danh sách giữ chỗ như `www`, `app`, `admin`, `demo`, `test`, tên ngân hàng/cổng thanh toán – `apps/control-plane/src/tenants.js`).
   Bằng API (đã chạy thật; mất ~14 s vì trình cài đặt chờ shard nạp registry):

   ```sh
   curl -s -X POST https://app.hitechpos.vn/api/signup -H 'content-type: application/json' -d '{
     "subdomain":"thu-nghiem-01","businessName":"Cà phê Thử Nghiệm","industry":"cafe-tra-sua",
     "ownerName":"Chủ quán","email":"ops+shop1@hitechpos.vn","phone":"0912345678","password":"<mật-khẩu ≥ 8 ký tự>"}' | jq .tenant
   ```

   Mong đợi `201`, `status: "active"`. `502 tenant_install_failed` → xem [RUNBOOK](deploy/RUNBOOK.md#đăng-ký-shop-báo-tenant_install_failed).
2. Trong `/admin` mở shop vừa tạo: mọi bước `onboarding` (`login`, `locale`, `taxes`, `payments`, `units`, `categories`, `items`, `receipt`, `modules`, `receiptTitles`) phải là `ok`.
3. Mở `https://thu-nghiem-01.hitechpos.vn/`, đăng nhập bằng email + mật khẩu vừa đăng ký, bán thử một đơn tiền mặt, in hoá đơn.
4. Ở `/account`: bật VietQR (ngân hàng, số tài khoản, tên chủ tài khoản), chờ **tối đa 60 s**, thử ô “QR chuyển khoản” ở màn hình bán hàng. Trong khoảng chờ, thu ngân thấy “Cửa hàng vừa bật thanh toán QR, vui lòng thử lại sau ít phút.” (đo được: 34 s).
5. Xoá shop thử khi xong: tạm khoá ở `/admin` (chưa có chức năng xoá shop).

### Trang quản trị `/admin`

`https://app.hitechpos.vn/admin` → nhập `ADMIN_API_KEY` và tên người thao tác. Khoá chỉ lưu trong `sessionStorage` của tab (đóng tab là mất), tên người thao tác lưu `localStorage` và đi vào nhật ký (`X-Admin-Actor`). Mọi thao tác (tạm khoá, mở lại, gia hạn, đổi gói, gửi lại email chào mừng, đặt lại mật khẩu, ghi chú) có nhật ký ở tab Audit. Dùng trình duyệt của máy quản trị tin cậy; không dán khoá vào máy dùng chung.

API quản trị khác (`X-Admin-Key`): `GET /api/admin/tenants`, `/api/admin/stats`, `/api/admin/payments?status=review`, `POST /api/admin/payments/:orderCode/accept` (chấp nhận giao dịch lệch tiền sau khi đối chiếu sao kê), `POST /api/admin/jobs/enforce-expiry`, `POST /api/admin/jobs/reminders` (hai job này cũng tự chạy mỗi giờ trong tiến trình).

### Thanh toán phí thuê bao của nền tảng

Chỉ cổng nào có khoá mới được bật (`providers=` trong log khởi động, `GET /api/plans` → `paymentProviders`). Thông tin trong dashboard nhà cung cấp dưới đây **chưa được kiểm chứng** (không truy cập được khi viết tài liệu) – xem thêm [todo/02-xac-minh-tich-hop.md](todo/02-xac-minh-tich-hop.md).

**payOS** (https://my.payos.vn, kênh thanh toán của HiTechCloud):

1. Lấy *Client ID*, *API Key*, *Checksum Key* của kênh; ghi vào `control-plane.env`:
   ```
   PAYOS_CLIENT_ID=...
   PAYOS_API_KEY=...
   PAYOS_CHECKSUM_KEY=...
   ```
2. `sudo -u hitechpos pm2 reload deploy/ecosystem.config.js --only hitechpos-control-plane --update-env`. Route `/webhooks/payos` chỉ tồn tại khi payOS đã được cấu hình (chưa cấu hình → `404`).
3. Đăng ký webhook `https://app.hitechpos.vn/webhooks/payos` trong my.payos.vn, hoặc từ máy chủ (payOS gửi một payload thử, route phải đang chạy và truy cập được từ Internet):
   ```sh
   cd /opt/hitechpos && sudo -u hitechpos env $(sudo grep -E '^PAYOS_(CLIENT_ID|API_KEY|CHECKSUM_KEY)=' /etc/hitechpos/control-plane.env | xargs) \
     node -e "require('@hitechpos/payment-payos').createPayOSClient({clientId:process.env.PAYOS_CLIENT_ID,apiKey:process.env.PAYOS_API_KEY,checksumKey:process.env.PAYOS_CHECKSUM_KEY}).confirmWebhook('https://app.hitechpos.vn/webhooks/payos').then(r=>console.log('ok',r),e=>{console.error(e.code||e.message);process.exit(1)})"
   ```
   (Lệnh đã chạy tới bước gọi mạng; môi trường viết tài liệu không ra được payOS nên nhận `payos_outcome_unknown`.)
4. Thử một giao dịch nhỏ thật: `/account` → chọn gói → thanh toán → kiểm tra `/admin` thấy giao dịch `paid` và hạn dùng được gia hạn.

**Pay2S** (https://pay2s.vn):

```
PAY2S_ENV=production            # mặc định là sandbox nếu bỏ trống
PAY2S_ACCESS_KEY=...
PAY2S_PARTNER_CODE=...
PAY2S_SECRET_KEY=...
PAY2S_PARTNER_NAME=HiTechPOS
```

IPN được gửi tự động trong mỗi yêu cầu (`ipnUrl = PUBLIC_URL + /webhooks/pay2s`); không cần đăng ký riêng, nhưng nếu tài khoản Pay2S có cấu hình IPN mặc định thì đặt cùng URL. Trước khi bật production, đối chiếu danh sách trường ký và mã `resultCode` thành công với hợp đồng Pay2S (`packages/payment-pay2s/README.md`).

Sau khi khách thanh toán, cổng chuyển về `/billing/return?orderCode=…` (trang có thật). Khách huỷ thì về `/billing/cancel?orderCode=…`: trang báo chưa thanh toán và đưa về `/account` để chọn lại.

### Thanh toán tại quầy của từng shop

Tiền bán hàng về thẳng tài khoản của shop; nền tảng không giữ tiền. Chủ shop tự cấu hình ở `/account` (trợ giúp: `/help/cau-hinh-thanh-toan`):

| Phương thức | Shop nhập | Shop phải cấu hình ở nhà cung cấp |
|---|---|---|
| VietQR | Ngân hàng, số tài khoản, tên chủ tài khoản | – (thu ngân bấm “Đã nhận tiền”, hoặc bật biến động số dư) |
| payOS | Client ID, API Key, Checksum Key của kênh payOS **của shop** | Webhook của kênh = `https://app.hitechpos.vn/webhooks/shop/<shopId>/payos` (trang `/account` hiển thị đúng URL) |
| Pay2S | Access key, Partner code, Secret key, môi trường (mặc định `production` với shop) | IPN gửi tự động tới `…/webhooks/shop/<shopId>/pay2s` |
| Biến động số dư Pay2S | Mã bảo mật ≥ 16 ký tự | Webhook biến động số dư trỏ `…/webhooks/shop/<shopId>/bank-feed`, header `Authorization: Bearer <mã bảo mật>`. Nội dung chuyển khoản bắt đầu bằng mã đơn → tự xác nhận |

Khoá của shop được niêm phong bằng `TENANT_SECRET_KEY`. Lần đầu bật bất kỳ phương thức nào, control plane cấp khoá nội bộ `HITECH_POS_KEY` cho shard và bật ô QR trong DB của shop – có hiệu lực trên máy bán hàng sau ≤ `SHARD_RELOAD_MS` (60 s).

### Hoá đơn điện tử

Mỗi shop dùng hợp đồng riêng với nhà cung cấp, cấu hình ở `/account` (trợ giúp `/help/hoa-don-dien-tu`):

| Nhà cung cấp | Trường kết nối | Ghi chú |
|---|---|---|
| Viettel S-Invoice | `username`, `password` (+ `supplierTaxCode`, `lookupUrlTemplate`) | Host sandbox **chưa xác minh** |
| MISA meInvoice | `appId`, `taxCode`, `username`, `password` (+ `lookupUrlTemplate`) | |
| Mắt Bão | `taxCode`, `username`, `password` (+ `lookupUrlTemplate`) | API ở cổng 11443 |
| Thử nghiệm (`mock`) | – | Không gửi cơ quan thuế; chỉ để thử luồng. Nhắc shop không dùng khi bán thật |

Quy trình đưa một shop lên thật: chọn môi trường **sandbox** (mặc định khi không chọn `production`) → nhập ký hiệu (ví dụ `1C26MAA` – năm trong ký hiệu phải trùng năm lập theo giờ VN) và thông tin người bán → phát hành thử một đơn → tra cứu trên cổng nhà cung cấp → đổi sang `production` và nhập tài khoản thật → bật “Tự động phát hành khi chốt đơn” nếu muốn (worker chạy mỗi `EINVOICE_WORKER_INTERVAL_MS`). Mọi endpoint/trường của ba nhà cung cấp còn đánh dấu `UNVERIFIED` trong `packages/einvoice-vn` – xác minh với tài liệu gốc trước khi shop đầu tiên dùng thật. Kết quả “không rõ” (`unknown`) cần đối soát: xem [RUNBOOK](deploy/RUNBOOK.md#hoá-đơn-điện-tử-kẹt-ở-trạng-thái-unknown).

### Email (SMTP) và khả năng vào hộp thư

Control plane gửi: chào mừng, nhắc hết dùng thử (3 và 1 ngày), đã nhận thanh toán, tạm khoá do hết hạn, **đặt lại mật khẩu** (liên kết chỉ có trong email – không có SMTP thì chủ shop không tự lấy lại mật khẩu được). Không có `SMTP_URL`, email chỉ được ghi log.

- `SMTP_URL` theo cú pháp nodemailer: `smtps://user:pass@host:465` (TLS ngay) hoặc `smtp://user:pass@host:587` (STARTTLS); mã hoá URL tên đăng nhập có `@` (`%40`).
- Tên miền trong `MAIL_FROM` (ví dụ `hitechpos.vn`) cần:
  - **SPF**: `hitechpos.vn TXT "v=spf1 include:<miền SPF của nhà cung cấp> -all"` (gộp với bản ghi SPF sẵn có – mỗi tên miền chỉ một bản ghi SPF);
  - **DKIM**: bản ghi `<selector>._domainkey.hitechpos.vn` do nhà cung cấp SMTP cấp;
  - **DMARC**: `_dmarc.hitechpos.vn TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@hitechpos.vn"` (bắt đầu với `p=none` vài tuần để đọc báo cáo).
- Kiểm tra: đăng ký một shop bằng hộp thư Gmail/Outlook thật, xem header `Authentication-Results` có `spf=pass dkim=pass dmarc=pass`. Lỗi gửi được ghi `[notify] <loại> to <email> failed: …` và **không** gửi lại (mỗi thông báo chỉ thử một lần).
- Địa chỉ hỗ trợ `hotro@hitechpos.vn` trên trang trợ giúp là tạm ([HUONG-DAN.md](HUONG-DAN.md)).

### Ứng dụng HiTechPOS Business (đăng nhập bằng tài khoản cloud)

Không cần cấu hình thêm nếu `PUBLIC_URL=https://app.hitechpos.vn` trùng `EXPO_PUBLIC_HITECHPOS_CLOUD_ORIGIN` của bản build ứng dụng. Control plane có tên miền khác thì đặt `BUSINESS_CLOUD_ISSUER`; `BUSINESS_CLOUD_CORS_ORIGINS` chỉ cho bản xem thử web. Kiểm tra: `curl -s https://app.hitechpos.vn/api/business/v1/discovery | jq` trả `issuer` đúng. Quy trình và điều kiện ở [BUSINESS-APP.md](BUSINESS-APP.md).

### Chương trình đối tác

Không có biến môi trường; tỷ lệ hoa hồng nhập cho từng đối tác (quyết định kinh doanh, [DOI-TAC.md](DOI-TAC.md)). Tạo đối tác qua API (chưa có giao diện trong `/admin`):

```sh
curl -s -X POST https://app.hitechpos.vn/api/admin/partners -H "X-Admin-Key: $ADMIN_API_KEY" -H 'content-type: application/json' \
  -d '{"name":"Đại lý mẫu","email":"daily@example.vn","phone":"0912345678","type":"dai_ly","commission":{"percent":10,"recurring":false}}'
# trả initialPassword một lần; đối tác đăng nhập ở https://app.hitechpos.vn/doi-tac, liên kết giới thiệu https://app.hitechpos.vn/r/<MÃ>
```

Số liệu trong ví dụ không phải chính sách của công ty. Đối soát hoa hồng còn thiếu: `POST /api/admin/partners/jobs/reconcile` (an toàn khi chạy lặp).

---

## Migration theo từng shop

Shard **không** chạy migration lúc khởi động. `upstream/pos/scripts/run-tenant-migrations.js` chạy sổ migration của Posnic (`upstream/pos/api/src/db/migrations/index.js`, ghi sổ cái `schema_migrations` trong từng DB shop) cho mọi shop trong `tenants` (cùng truy vấn với shard; tôn trọng `SHARD_INSTANCE`). Mặc định chỉ báo cáo.

```sh
cd /opt/hitechpos/upstream/pos
sudo grep '^CONTROL_URI=' /etc/hitechpos/shard.env | cut -d= -f2- | sudo -u hitechpos tee /home/hitechpos/.mongo-uri >/dev/null
sudo chmod 600 /home/hitechpos/.mongo-uri         # một lần; URI không xuất hiện trong `ps` như khi dùng --uri
# Báo cáo
sudo -u hitechpos node scripts/run-tenant-migrations.js --uri-file /home/hitechpos/.mongo-uri --control-db hitechpos_control
# Chạy
sudo -u hitechpos node scripts/run-tenant-migrations.js --uri-file /home/hitechpos/.mongo-uri --control-db hitechpos_control --apply
# Chỉ một migration / chỉ một DB
sudo -u hitechpos node scripts/run-tenant-migrations.js --uri-file /home/hitechpos/.mongo-uri --control-db hitechpos_control --only 003-vietnamese-default-bill --apply
sudo -u hitechpos node scripts/run-tenant-migrations.js --uri-file /home/hitechpos/.mongo-uri --db hitech_t_<shop>
```

Kết quả thật khi viết tài liệu (một shop mới):

```
  1 shop database(s)   (report only)
  docstest1: pending 001-business-cloud-daily-indexes, 002-repair-demo-document-lines, 003-vietnamese-default-bill
  Nothing was run. Re-run with --apply.
```

Sau `--apply`: `applied …`; chạy lại: `up to date`. Mã thoát: `0` ổn, `1` có shop lỗi (các shop khác vẫn chạy; lần sau thử lại) hoặc `--only` không khớp, `2` thiếu tham số. Biến dự phòng: `CONTROL_URI`/`MONGODB_URI`, `CONTROL_DB`, `SHARD_INSTANCE`.

Khi nào chạy:

- **Mỗi lần phát hành**, sau khi cài mã mới và **trước khi reload shard** (bước 5 của [quy trình](#triển-khai-một-phiên-bản)). Migration chỉ tiến, idempotent và phải tương thích với mã cũ đang chạy trong lúc chờ reload.
- Shop đăng ký sau lần chạy cuối hiện là `pending` cho mọi migration (trình cài đặt không ghi sổ cái) – vô hại; lần phát hành sau sẽ ghi nhận. Có thể đặt chạy `--apply` hằng đêm sau sao lưu.
- Lần đầu áp dụng lên các shop đang chạy (đặc biệt `003-vietnamese-default-bill`): chạy báo cáo, sao lưu, rồi `--apply`.

---

## Phát hành, nâng cấp, quay lui

### Phát hành một phiên bản (trên GitHub)

Phiên bản theo SemVer, ghi trong [CHANGELOG.md](../CHANGELOG.md) (mục `## [X.Y.Z] - YYYY-MM-DD`). Workflow `.github/workflows/release.yml` tạo bản phát hành GitHub với nội dung đúng mục CHANGELOG và tệp mã nguồn `hitechpos-vX.Y.Z.tar.gz`:

1. Thêm mục `## [X.Y.Z] - <ngày>` vào `CHANGELOG.md` qua PR, merge vào `main`; CI phải xanh (unit, Posnic API, e2e, e2e trình duyệt).
2. Chọn **một** trong hai:
   - GitHub → **Actions → Release → Run workflow**, nhánh `main`, nhập `X.Y.Z` (workflow tự tạo tag `vX.Y.Z`; từ chối nếu không chạy trên `main` hoặc CHANGELOG thiếu mục);
   - hoặc gắn tag trên `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Ghi trong mục CHANGELOG mọi việc vận hành cần làm khi nâng cấp (migration mới, biến môi trường mới, đổi Caddyfile).

Máy chủ chỉ triển khai **tag đã phát hành**; `SOURCE_URL` có thể trỏ tới trang release đó (nghĩa vụ AGPL §13 – [LICENSING.md](LICENSING.md)).

### Triển khai một phiên bản

Dựng bản mới trong thư mục riêng rồi hoán đổi, để không có lúc nào tiến trình đang chạy đọc lẫn tệp của hai phiên bản (`npm ci` xoá `node_modules` trước khi cài; nhiều module được `require` muộn). PM2 giữ đường dẫn `/opt/hitechpos/...` nên chỉ cần `reload`. Đã chạy thử trọn quy trình (hoán đổi + reload sau Caddy có `lb_try_duration`): 120/120 yêu cầu thành công, bản mới được phục vụ; hoán đổi ngược cũng chạy đúng.

```sh
V=v0.2.1
# 1. Sao lưu và kiểm tra hiện trạng
sudo systemctl start hitechpos-backup && journalctl -u hitechpos-backup -n 5 --no-pager
curl -s http://127.0.0.1:4100/readyz
# 2. Dựng bản mới cạnh bản đang chạy
sudo install -d -o hitechpos -g hitechpos /opt/hitechpos.new
sudo -u hitechpos git clone --branch "$V" --depth 1 https://github.com/hitechcloud-vietnam/HiTechPOS.git /opt/hitechpos.new
cd /opt/hitechpos.new
sudo -u hitechpos npm ci --omit=dev --no-audit --no-fund
(cd upstream/pos/api && sudo -u hitechpos npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
   --replace-registry-host=registry.npmmirror.com --registry=https://registry.npmjs.org/)
(cd upstream/pos/frontend && sudo -u hitechpos npm ci --no-audit --no-fund && sudo -u hitechpos npm run build:assets)
# 3. Đọc mục CHANGELOG của $V: biến môi trường mới? Caddyfile đổi?
# 4. Migration (bằng mã mới, trên dữ liệu thật) – báo cáo rồi chạy
(cd upstream/pos && sudo -u hitechpos node scripts/run-tenant-migrations.js --uri-file /home/hitechpos/.mongo-uri --control-db hitechpos_control)
(cd upstream/pos && sudo -u hitechpos node scripts/run-tenant-migrations.js --uri-file /home/hitechpos/.mongo-uri --control-db hitechpos_control --apply)
# 5. Hoán đổi thư mục và reload: shard trước (control plane cài shop qua shard), rồi control plane
sudo rm -rf /opt/hitechpos.prev
sudo mv /opt/hitechpos /opt/hitechpos.prev && sudo mv /opt/hitechpos.new /opt/hitechpos
cd /opt/hitechpos
sudo -u hitechpos pm2 reload deploy/ecosystem.config.js --only hitechpos-shard --update-env
sudo -u hitechpos pm2 reload deploy/ecosystem.config.js --only hitechpos-control-plane --update-env
sudo -u hitechpos pm2 save
# 6. Kiểm tra
curl -s http://127.0.0.1:4100/readyz; sudo -u hitechpos pm2 ls
```

Lưu ý:

- PM2 ở chế độ `fork`: `reload` = khởi động lại. Shard cần ~2–3 s để phục vụ lại (đo được 2,4 s), control plane ~1 s; Caddy với `lb_try_duration` giữ yêu cầu trong lúc đó. Shard không xử lý tín hiệu dừng nên yêu cầu đang dở lúc reload bị cắt; control plane đóng kết nối êm (SIGINT/SIGTERM).
- Đừng chạy shard ở chế độ cluster của PM2: các worker nền của Posnic (giá theo lịch, thông báo Business) và giới hạn tần suất trong bộ nhớ sẽ chạy trùng ở mỗi tiến trình.
- Cập nhật tại chỗ (`git pull` + `npm ci` trong `/opt/hitechpos`) vẫn chạy được cho bản vá nhỏ, nhưng có khoảng thời gian tiến trình đang chạy thấy mã/thư viện lẫn lộn.
- Nếu đổi tệp `/etc/hitechpos/*.env` cùng lúc: `--update-env` lấy giá trị mới; **xoá** biến cần `pm2 delete` + `pm2 start` ([ENV.md](deploy/ENV.md#1-biến-được-ghi-ở-đâu)).

### Quay lui

```sh
sudo mv /opt/hitechpos /opt/hitechpos.failed && sudo mv /opt/hitechpos.prev /opt/hitechpos
cd /opt/hitechpos
sudo -u hitechpos pm2 reload deploy/ecosystem.config.js --update-env && sudo -u hitechpos pm2 save
```

Migration không có chiều lùi. Mã cũ phải chạy được trên dữ liệu đã migrate (quy tắc khi viết migration); nếu không, khôi phục DB từ bản sao lưu ở bước 1 ([Sao lưu & khôi phục](#sao-lưu--khôi-phục)). Giữ `/opt/hitechpos.prev` tới lần phát hành sau.

### Cập nhật mã Posnic (`upstream/`)

Không làm trên máy chủ. Theo [UPSTREAM.md](UPSTREAM.md): `git subtree pull --prefix upstream/pos https://github.com/Posnic/POS develop --squash` trên một nhánh, giữ mọi bản vá cục bộ trong bảng của UPSTREAM.md, chạy `npm test` và bộ test Posnic, đảm bảo `apps/control-plane/test/secrets.test.js` xanh (hợp đồng phong bì secret với `shard.js`), rồi phát hành như một phiên bản bình thường. Migration mới của Posnic sẽ xuất hiện ở bước báo cáo migration.

---

## Mở rộng

### Nhiều shard (`SHARD_INSTANCE`)

- Shard có `SHARD_INSTANCE=<tên>` chỉ phục vụ tenant có `instance` bằng tên đó (đã kiểm chứng: shard `SHARD_INSTANCE=node-a` không phục vụ shop không có `instance` – `404`, log `serving 0 hostname(s) across 0 shop(s) on node-a`).
- Control plane ghi `instance = SHARD_INSTANCE` của **chính nó** vào shop mới và cài shop qua **một** `SHARD_URL`. Nghĩa là một control plane gửi mọi shop mới tới một shard; muốn chuyển shop mới sang máy khác thì đổi cặp `SHARD_INSTANCE`/`SHARD_URL` của control plane.
- Hệ thống bắt đầu với `SHARD_INSTANCE` trống thì các shop hiện có **không có** trường `instance`. Trước khi đặt `SHARD_INSTANCE` cho shard đầu tiên, gán trường này cho shop cũ, nếu không shard sẽ ngừng phục vụ chúng:
  ```js
  db.getSiblingDB('hitechpos_control').tenants.updateMany({ instance: { $exists: false } }, { $set: { instance: 'node-a' } })
  ```
- Caddy phải chuyển đúng hostname tới đúng shard. Wildcard `*.hitechpos.vn` chỉ trỏ được về một chỗ, nên khi có nhiều máy shard cần Caddy (hoặc LB) định tuyến theo hostname tới máy giữ shop đó – chưa có công cụ sinh cấu hình này. `/readyz` chỉ thăm dò `SHARD_URL`.
- Shard ở máy khác gọi control plane qua `HITECH_PAY_URL` (QR tại quầy): control plane phải nghe trên IP nội bộ (sửa `HOST` trong `ecosystem.config.js`) và tường lửa chỉ mở 4100 cho máy shard. Yêu cầu `/pos/v1` được giới hạn theo khoá API nên không bị ảnh hưởng bởi IP.

### Cụm MongoDB riêng – giới hạn hiện tại

Chưa hỗ trợ đặt DB shop ở cụm khác cụm của control DB:

- shard mở DB shop bằng chính kết nối `CONTROL_URI` (đọc registry và `useDb(tenantDb)` trên cùng client);
- `shopBridge` của control plane (bật ô QR, ghi giới hạn gói, dòng uỷ quyền ứng dụng Business, xuất dữ liệu shop) ghi vào DB shop qua `CONTROL_URI`, bỏ qua `TENANT_MONGO_URI` ([BUSINESS-APP.md](BUSINESS-APP.md) – “Control plane đã có quyền ghi DB của shop”);
- `TENANT_MONGO_URI` chỉ đổi kết nối của onboarding (tiêu đề hoá đơn), worker HĐĐT và sổ sách thuế.

Tách cụm theo shard cần sửa mã (registry đọc từ cụm control, DB shop ở cụm riêng; `shopBridge` theo cụm của shop). Đến lúc đó: mở rộng theo chiều dọc và dùng một replica set/cluster đủ lớn.

### Nhiều tiến trình control plane

Chạy được nhiều bản sau LB, với các lưu ý:

- giới hạn tần suất nằm trong bộ nhớ **từng tiến trình** (`express-rate-limit`) – N tiến trình = hạn mức thực tế gấp N, và khởi động lại là xoá bộ đếm;
- job `expiry`, `reminders`, worker HĐĐT chạy ở mọi tiến trình. Email được khoá theo `notices.<key>`, chống phát hành trùng dựa trên collection `einvoices`, nên an toàn nhưng làm việc thừa; có thể tắt worker ở các bản phụ bằng `EINVOICE_WORKER_INTERVAL_MS=0`;
- `trust proxy 1`: mỗi bản phải đứng sau đúng một proxy.

Hiện một tiến trình đủ cho quy mô nhỏ/vừa; ưu tiên chạy một bản. Việc dùng store chung cho giới hạn tần suất nằm trong [todo/07-van-hanh.md](todo/07-van-hanh.md).

---

## Giám sát

| Endpoint | Dùng cho | Xác thực |
|---|---|---|
| `GET /healthz` | Liveness: tiến trình còn trả lời (không kiểm tra CSDL) | – |
| `GET /readyz` | Readiness: ping control DB và (nếu đặt `SHARD_URL`) shard, mỗi bước tối đa `READYZ_TIMEOUT_MS` (mặc định 1500 ms). `200` hoặc `503` kèm JSON, lỗi là mã cố định (`timeout`, `unreachable`, `http_<mã>`), không chứa URI/secret. Shard được coi là sẵn sàng khi trả bất kỳ mã < 500 (bình thường là `404` cho host thăm dò `readyz.invalid`) | – |
| `GET /metrics` | Prometheus (text 0.0.4) | `Authorization: Bearer $METRICS_TOKEN` hoặc `X-Admin-Key`; Caddyfile khuyến nghị chỉ mở cho IP máy giám sát |
| `GET /api/admin/ops` | Tóm tắt JSON cho trang quản trị | `X-Admin-Key` |

Đã kiểm chứng: dừng shard → `/readyz` trả `503 {"ok":false,"checks":{…,"shard":{"ok":false,"error":"unreachable"}}}`; bật lại → `200`.

Biến môi trường liên quan: `METRICS_TOKEN` (token riêng cho máy scrape, khác `ADMIN_API_KEY`), `READYZ_SHARD=0` để `/readyz` bỏ qua shard, `READYZ_TIMEOUT_MS`.

Chỉ số chính: `hitechpos_http_requests_total` / `hitechpos_http_request_duration_seconds` (nhãn `method`, `route` là **mẫu route** như `/pos/v1/payments/:orderCode`, `status`), `hitechpos_tenants{status}`, `hitechpos_tenants_suspended`, `hitechpos_payments{status,provider}`, `hitechpos_einvoice_jobs{state}` (`pending`/`done`/`unknown`), `hitechpos_job_last_success_timestamp_seconds{job}`, `hitechpos_job_last_failure_timestamp_seconds{job}`, `hitechpos_job_last_duration_seconds{job}`, `hitechpos_job_interval_seconds{job}`, `hitechpos_job_runs_total{job}` (`expiry`, `reminders`, `einvoice_worker`; 0 = chưa chạy từ khi khởi động), `hitechpos_control_db_up`, `hitechpos_process_uptime_seconds`, cùng `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `nodejs_eventloop_lag_seconds{quantile}`, `nodejs_eventloop_lag_max_seconds`. Số liệu theo trạng thái đọc từ control DB và được đệm 15 giây. Chỉ số chỉ đến từ control plane; shard không có endpoint chỉ số – theo dõi shard qua `/readyz`, `pm2 ls` (RAM, số lần khởi động lại `↺`) và log.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: hitechpos-control-plane
    scheme: https
    authorization: { credentials: '<METRICS_TOKEN>' }
    static_configs: [{ targets: ['app.hitechpos.vn'] }]
  - job_name: hitechpos-readyz           # cần blackbox_exporter
    metrics_path: /probe
    params: { module: [http_2xx] }
    static_configs: [{ targets: ['https://app.hitechpos.vn/readyz'] }]
    relabel_configs:
      - { source_labels: [__address__], target_label: __param_target }
      - { target_label: __address__, replacement: '<blackbox>:9115' }
```

Cảnh báo gợi ý:

| Cảnh báo | Biểu thức | Hành động |
|---|---|---|
| Control DB mất kết nối | `hitechpos_control_db_up == 0` | Kiểm tra `mongod`, `rs.status()` |
| Shard không sẵn sàng | blackbox `probe_success{job="hitechpos-readyz"} == 0` trong 2 phút | `pm2 ls`, log shard |
| Worker HĐĐT đứng | `hitechpos_job_interval_seconds{job="einvoice_worker"} > 0 and time() - hitechpos_job_last_success_timestamp_seconds{job="einvoice_worker"} > 600` | Log `[control-plane] einvoice job` |
| Job hết hạn/nhắc không chạy | `time() - hitechpos_job_last_success_timestamp_seconds{job="expiry"} > 7200` (bỏ qua 1 giờ đầu sau khởi động) | Log control plane |
| Hoá đơn cần đối soát | `hitechpos_einvoice_jobs{state="unknown"} > 0` | [RUNBOOK](deploy/RUNBOOK.md#hoá-đơn-điện-tử-kẹt-ở-trạng-thái-unknown) |
| Giao dịch lệch tiền | `hitechpos_payments{status="review"} > 0` | Đối chiếu sao kê, `/api/admin/payments/:orderCode/accept` |
| Lỗi 5xx tăng | `sum(rate(hitechpos_http_requests_total{status=~"5.."}[5m])) > 0.1` | Log control plane |
| Event loop chậm | `nodejs_eventloop_lag_seconds{quantile="0.99"} > 0.5` | CPU, tác vụ nặng |
| Sao lưu thất bại | systemd `hitechpos-backup.service` failed / mail cron | Xem log sao lưu |
| Chứng chỉ sắp hết hạn | blackbox `probe_ssl_earliest_cert_expiry - time() < 14*86400` | Log Caddy (DNS token, giới hạn ACME) |
| Đĩa | node_exporter: `/var/lib/mongodb`, `/var/backups` > 80% | |

Theo [CLOUD_OPERATIONS.md của Posnic](../upstream/pos/docs/CLOUD_OPERATIONS.md): một shop không bán được hàng không chờ được tới sáng thứ Hai – cảnh báo phải có người trực nhận.

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

Không nằm trong bản sao lưu: `TENANT_SECRET_KEY` và các tệp `/etc/hitechpos/*.env` (giữ riêng – xem [Giữ TENANT_SECRET_KEY](#giữ-tenant_secret_key)), DB mặc định của shard (chỉ có bộ đếm đăng nhập), cấu hình Caddy/PM2.

Kết quả chạy thật khi viết tài liệu (user chỉ có vai trò `backup`):

```
[backup] plan: control DB + 1 shop database(s), 0 shop(s) skipped
[backup] dumped docs_test_control (4.0K, 0s)
[backup] dumped docs_test_t_docstest1 (16K, 0s)
[backup] verified docs_test_t_docstest1: 21 collection(s), 86 document(s)
[backup] run 20261014T153715Z complete: 2 database(s), 32K, 1s
[backup] retention: daily=7 weekly=4 tz=420min kept 1, removed 0
```

### Cài đặt

1. Cài **MongoDB Database Tools** (`mongodump`, `mongorestore`; gói `mongodb-database-tools`) – nếu không nằm trên `PATH`, đặt `MONGO_TOOLS_DIR`. Thiếu công cụ thì script dừng ngay với thông báo rõ ràng. `node` phải có trên `PATH` của root (NodeSource) hoặc đặt `NODE=` trong `backup.env`; script dùng driver `mongodb` trong `node_modules` ở gốc repo (`npm ci` đã cài).
2. `sudo install -m 600 deploy/backup.env.example /etc/hitechpos/backup.env` rồi sửa. Không đặt gì thì script dùng `CONTROL_URI`/`CONTROL_DB`/`TENANT_MONGO_URI` trong `/etc/hitechpos/control-plane.env` (tức là user ứng dụng). Nên dùng user riêng vai trò `backup`:
   ```
   BACKUP_MONGO_URI=mongodb://hitechpos_backup:<mk>@127.0.0.1:27017/?replicaSet=rs0&authSource=admin
   ```
   URI được truyền cho mongodump qua tệp cấu hình tạm 0600, không hiện trong `ps` hay log.
3. Lập lịch – chọn **một**:
   - systemd: `sudo cp deploy/systemd/hitechpos-backup.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now hitechpos-backup.timer` (02:15 giờ Việt Nam = 19:15 UTC, kiểm bằng `systemd-analyze calendar "*-*-* 02:15:00 Asia/Ho_Chi_Minh"`; xem log: `journalctl -u hitechpos-backup`). Unit dùng `ProtectSystem=strict` và chỉ cho ghi `/var/backups/hitechpos`: đổi `BACKUP_DIR` thì sửa cả `ReadWritePaths=`.
   - cron: `sudo cp deploy/cron/hitechpos-backup /etc/cron.d/` (19:15 UTC = 02:15 ICT, giả định máy chạy UTC; log ở `/var/log/hitechpos-backup.log`).
   Hai tệp trên trỏ `/opt/hitechpos` – khớp với thư mục cài đặt trong tài liệu này.
4. Chạy thử: `sudo scripts/backup/backup.sh --no-upload` rồi xem `manifest.json` và `sha256sum -c SHA256SUMS` trong thư mục vừa tạo.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BACKUP_DIR` | `/var/backups/hitechpos` | Thư mục lưu (0700) |
| `BACKUP_MONGO_URI` / `BACKUP_TENANT_MONGO_URI` | `CONTROL_URI` / `TENANT_MONGO_URI` (rồi `BACKUP_MONGO_URI`) | Cụm chứa control DB / DB của shop |
| `CONTROL_DB` | `hitechpos_control` | Control DB |
| `MONGO_TOOLS_DIR` | – | Thư mục chứa `mongodump`/`mongorestore` |
| `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY` | 7 / 4 | Giữ bản mới nhất của N **ngày có bản sao lưu** gần nhất và của M tuần ISO gần nhất; bản mới nhất luôn được giữ |
| `BACKUP_KEEP_FAILED_DAYS` | 3 | Giữ thư mục lỗi |
| `BACKUP_TZ_OFFSET_MINUTES` | 420 | Múi giờ để chia ngày/tuần (UTC+7) |
| `BACKUP_S3_URI`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_EXTRA_ARGS` | – | Tải lên S3/S3-compatible bằng `aws s3 cp` (cần aws CLI; khoá qua `AWS_*` trong `backup.env` hoặc profile) |
| `BACKUP_RCLONE_REMOTE`, `BACKUP_RCLONE_EXTRA_ARGS` | – | Tải lên bằng `rclone copy` (ví dụ `offsite:hitechpos-backup/prod`) |

Các biến ít dùng khác: [ENV.md](deploy/ENV.md#4-sao-lưu-scriptsbackup).

Chính sách giữ lại chỉ áp dụng cho thư mục cục bộ; trên kho ngoài hãy đặt lifecycle rule của bucket (ví dụ xoá sau 35 ngày), bật versioning/object lock nếu có và mã hoá phía máy chủ. Kho ngoài nên ở nhà cung cấp/khu vực khác máy chủ chính.

**Bảo mật:** archive của control DB chứa secret shop đã niêm phong và mật khẩu chủ shop đã băm; archive của shop chứa toàn bộ dữ liệu bán hàng và dữ liệu cá nhân của khách hàng cuối. Giữ quyền 0700/0600, giới hạn quyền truy cập bucket, dùng khoá truy cập chỉ ghi (không xoá) cho máy chủ nếu kho hỗ trợ. Muốn mã hoá phía khách trước khi tải lên, dùng remote `crypt` của rclone (`BACKUP_RCLONE_REMOTE=<remote-crypt>:…`) **(chưa kiểm chứng)**. `TENANT_SECRET_KEY` **không** nằm trong bản sao lưu – thiếu khoá này thì khôi phục control DB cũng không mở được secret của shop; lưu khoá ngoại tuyến, tách khỏi bản sao lưu.

### Khôi phục một shop

`restore-tenant.sh` cần user có **cả** vai trò `restore` và `backup` (hoặc quyền đọc mọi DB): chỉ `restore` thì dữ liệu đã được ghi nhưng bước so số document sau khi ghi lỗi `unexpected error: 13`. Script đọc `BACKUP_MONGO_URI` từ `backup.env` – khi khôi phục, chỉ định user khôi phục ngay trên dòng lệnh:

```sh
export BACKUP_MONGO_URI='mongodb://hitechpos_restore:<mk>@127.0.0.1:27017/?replicaSet=rs0&authSource=admin'
# Khôi phục song song vào DB khác để đối chiếu/trích dữ liệu (không ảnh hưởng shop đang chạy)
sudo -E scripts/backup/restore-tenant.sh photue --to-db hitech_restore_photue
# Chọn lần sao lưu cụ thể, chỉ kiểm tra (không ghi gì)
sudo -E scripts/backup/restore-tenant.sh photue --from 20261014T191500Z --to-db hitech_restore_photue --dry-run
# Khôi phục đè lên DB thật của shop
curl -X POST -H "x-admin-key: $ADMIN_API_KEY" https://app.hitechpos.vn/api/admin/tenants/<id>/suspend
sleep 60      # shard thấy trạng thái tạm khoá sau ≤ SHARD_RELOAD_MS
sudo -E scripts/backup/restore-tenant.sh photue --yes
curl -X POST -H "x-admin-key: $ADMIN_API_KEY" https://app.hitechpos.vn/api/admin/tenants/<id>/resume
```

- `<shop>` là tên miền con, id tenant hoặc tên DB; mặc định lấy lần sao lưu thành công mới nhất.
- Trước khi ghi, script kiểm tra SHA256 và nội dung archive; sau khi ghi, so số document từng collection với archive.
- `--to-db` từ chối DB đang là DB của shop khác, control DB và `admin`/`local`/`config`; DB đích đã có dữ liệu thì phải thêm `--drop` (không thì thoát mã 3). Khôi phục đè không có `--yes` thoát mã 64. Các trường hợp này đã chạy thử.
- Khôi phục tại chỗ cần `--yes` và thay (`--drop`) mọi collection có trong archive; collection tạo sau thời điểm sao lưu được giữ nguyên. Bản ghi tenant, secret, gói cước trong control DB **không** bị đụng tới.
- DB khôi phục song song không được shard phục vụ; xoá khi xong (`db.getSiblingDB('hitech_restore_photue').dropDatabase()`).
- Khôi phục toàn bộ control DB (sự cố lớn) làm thủ công: dừng control plane và shard (`pm2 stop all`), `mongorestore --uri=<uri user restore> --archive=<run>/hitechpos_control.archive.gz --gzip --drop --nsInclude='hitechpos_control.*'`, rồi `pm2 start all`.

## Diễn tập khôi phục thảm hoạ

Làm mỗi quý, trên một máy tạm (không đụng production), ghi lại thời gian thực tế (RTO) và tuổi bản sao lưu dùng được (RPO):

1. Dựng máy mới theo [Chuẩn bị máy chủ](#chuẩn-bị-máy-chủ) và [Lấy mã nguồn](#lấy-mã-nguồn--cài-đặt) (cùng tag đang chạy).
2. Lấy bản sao lưu mới nhất từ kho ngoài (không lấy từ máy production): `aws s3 cp --recursive s3://…/<run>/ /var/backups/hitechpos/<run>/` hoặc `rclone copy`. `cd` vào thư mục, `sha256sum -c SHA256SUMS`.
3. Lấy `TENANT_SECRET_KEY` từ nơi lưu ngoại tuyến (kiểm tra luôn quy trình hai người giữ khoá). Tạo `/etc/hitechpos/*.env` bằng `bootstrap-secrets.sh` rồi **thay** `TENANT_SECRET_KEY` (cả hai tệp) bằng khoá thật; `POSNIC_KEY`/`SESSION_SECRET`/`ADMIN_API_KEY` mới là được.
4. Khôi phục control DB rồi từng shop (đổi `<run>`):
   ```sh
   cd /var/backups/hitechpos/<run>
   mongorestore --uri='mongodb://hitechpos_restore:<mk>@127.0.0.1:27017/?replicaSet=rs0&authSource=admin' --archive=hitechpos_control.archive.gz --gzip --drop
   for a in hitech_t_*.archive.gz; do
     mongorestore --uri='mongodb://hitechpos_restore:<mk>@127.0.0.1:27017/?replicaSet=rs0&authSource=admin' --archive="$a" --gzip --drop || echo "FAILED $a"
   done
   ```
5. `pm2 start deploy/ecosystem.config.js`; log shard phải báo `serving N hostname(s) across N shop(s)` với N bằng số shop, **không** có dòng `secrets could not be opened` (nếu có: sai `TENANT_SECRET_KEY`).
6. Kiểm tra bằng `curl -H 'Host: <shop>.hitechpos.vn' http://127.0.0.1:6000/login.html` (200) và đăng nhập thử một shop qua file `hosts` của máy kiểm tra trỏ về máy tạm.
7. Ghi biên bản: thời gian từng bước, lỗi gặp phải, cập nhật tài liệu này. Huỷ máy tạm và dữ liệu.

---

## Bảo mật vận hành

Danh sách kiểm tra trước khi nhận shop thật:

- [ ] ufw chỉ mở 22 (giới hạn IP), 80, 443; `ss -ltnp` cho thấy 4100, 6000, 27017, 2019 chỉ nghe `127.0.0.1`/IP nội bộ.
- [ ] SSH chỉ dùng khoá, tắt đăng nhập root bằng mật khẩu; tài khoản quản trị có sudo được ghi danh.
- [ ] MongoDB bật `authorization` + `keyFile`, `bindIp` không có `0.0.0.0`; user ứng dụng/sao lưu/khôi phục tách riêng, không dùng `root` trong ứng dụng.
- [ ] Caddy xoá `X-Hitech-Shop` ở mọi khối phục vụ shop (cả khối `https://` của tên miền riêng); phép thử header trả 404 ([Kiểm tra](#kiểm-tra-sau-khi-khởi-chạy)).
- [ ] `/api/install*` bị chặn ở Caddy; `POSNIC_KEY`/`POSNIC_SECRET` dài, ngẫu nhiên.
- [ ] `/metrics` chỉ mở cho IP giám sát, dùng `METRICS_TOKEN` (không dùng `ADMIN_API_KEY` cho máy scrape).
- [ ] `ADMIN_API_KEY` chỉ những người vận hành được giao biết; nhập ở `/admin` trên máy tin cậy; xoay khi có người nghỉ việc.
- [ ] `/etc/hitechpos` 0750 `root:hitechpos`, tệp 0600; không có `upstream/pos/api/.env`; không commit bí mật vào repo.
- [ ] `TENANT_SECRET_KEY` có hai bản ngoại tuyến, tách khỏi bản sao lưu.
- [ ] Sao lưu hằng đêm thành công, có bản ngoài máy chủ, bucket hạn chế quyền + mã hoá; đã diễn tập khôi phục ít nhất một lần.
- [ ] `PAY2S_ENV=production` khi dùng thật; webhook payOS đã xác nhận; một giao dịch thật nhỏ đã đi trọn vòng.
- [ ] SMTP có SPF/DKIM/DMARC; email đặt lại mật khẩu tới được hộp thư.
- [ ] DNS ở chế độ DNS only (không qua proxy CDN) – nếu không, xem lại giới hạn tần suất theo IP.
- [ ] `unattended-upgrades` bật; theo dõi bản phát hành bảo mật của Node 22, MongoDB, Caddy.
- [ ] Các mục còn mở trong [todo/03-bao-mat.md](todo/03-bao-mat.md) đã được đánh giá (đặc biệt: chưa xác minh email khi đăng ký).

Pháp lý (định hướng, không phải tư vấn pháp lý – [LICENSING.md](LICENSING.md)):

- Nền tảng xử lý dữ liệu cá nhân của chủ shop (email, điện thoại) và khách hàng cuối (tên, số điện thoại, MST trên hoá đơn) – thuộc phạm vi **Nghị định 13/2023/NĐ-CP** và Luật Bảo vệ dữ liệu cá nhân 2025: cần chính sách bảo mật công bố (`/bao-mat` hiện là dự thảo), thoả thuận xử lý dữ liệu với shop (HiTechCloud là bên xử lý cho dữ liệu khách của shop), hồ sơ đánh giá tác động xử lý dữ liệu, và quy trình thông báo khi có sự cố.
- **Nơi đặt máy chủ**: dữ liệu bán hàng, hoá đơn của doanh nghiệp Việt Nam – nên đặt máy chủ và bản sao lưu tại Việt Nam, hoặc đánh giá yêu cầu chuyển dữ liệu ra nước ngoài trước khi dùng hạ tầng/kho sao lưu ở nước ngoài. Ghi rõ nhà cung cấp hạ tầng là bên xử lý phụ.
- Lưu trữ chứng từ/hoá đơn điện tử theo thời hạn của pháp luật kế toán – chính sách giữ bản sao lưu và xoá dữ liệu shop đã nghỉ cần kế toán/pháp chế xác nhận.
- AGPL-3.0 §13: `/source` phải dẫn tới mã nguồn tương ứng với bản đang chạy.

---

## Xử lý sự cố

Chi tiết từng trường hợp (triệu chứng → nguyên nhân → cách sửa) ở [deploy/RUNBOOK.md](deploy/RUNBOOK.md). Tóm tắt các bài học đã gặp khi chạy thật:

| Triệu chứng | Nguyên nhân nhanh |
|---|---|
| Gọi shard bằng `fetch` lỗi `bad port` | Cổng 6000 bị `fetch` chặn – mọi lời gọi nội bộ dùng `node:http` |
| QR báo “Cửa hàng vừa bật thanh toán QR…” | Secret mới của shop có hiệu lực sau ≤ 60 s (`SHARD_RELOAD_MS`) |
| Tạm khoá/mở lại shop chưa có tác dụng | Như trên – shard nạp registry mỗi 60 s |
| Tên miền riêng không có chứng chỉ | `on_demand_tls ask` trả 404 (chưa xác minh TXT, shop bị khoá, control plane không chạy) |
| `npm ci` của Posnic API treo | Lockfile trỏ `registry.npmmirror.com` – dùng `--replace-registry-host` |
| Khách nhận `429` hàng loạt | Giới hạn theo IP; CDN/proxy phía trước làm mọi người chung IP |
| HĐĐT `einvoice_outcome_unknown` | Phải đối soát (`reconcile`), không phát hành lại |
| Shop thấy “This shop is suspended.” | Shop bị khoá (hết hạn/thủ công/cài đặt lỗi) |

---

## Docker Compose (chỉ cho staging)

`deploy/docker-compose.yml` là cấu hình tham khảo cho một máy staging, **chưa được CI chạy**. Đã kiểm `docker compose config` (Compose v5) – cấu hình hợp lệ khi có đủ tệp env; chưa chạy container khi viết tài liệu.

Những gì tệp làm:

- `mongo` (`mongo:7`, `--replSet rs0 --bind_ip_all`, **không** xác thực; healthcheck tự `rs.initiate()`), volume `mongo-data`;
- `shard` (`node:22-bookworm-slim`, mount cả repo vào `/srv`, `npm ci --omit=dev && node shard.js`), lấy `TENANT_SECRET_KEY`, `POSNIC_KEY`, `POSNIC_SECRET` (bắt buộc), `SHOP_BASE_DOMAINS` (mặc định `hitechpos.vn`) từ môi trường/tệp `deploy/.env` của Compose; `HITECH_PAY_URL=http://control-plane:4100`;
- `control-plane` đọc `apps/control-plane/.env` (bắt buộc tồn tại – thiếu thì Compose báo `env file … not found`), ghi đè `HOST=0.0.0.0`, `CONTROL_URI`, `SHARD_URL=http://shard:6000`; publish **chỉ** `127.0.0.1:4100` vì control plane tin một proxy phía trước.

Cách chạy:

```sh
cp apps/control-plane/.env.example apps/control-plane/.env    # điền TENANT_SECRET_KEY, SESSION_SECRET, ADMIN_API_KEY, POSNIC_*, PUBLIC_URL
cat > deploy/.env <<'EOF'
TENANT_SECRET_KEY=<cùng giá trị với apps/control-plane/.env>
POSNIC_KEY=<cùng giá trị>
POSNIC_SECRET=<cùng giá trị>
SHOP_BASE_DOMAINS=staging.hitechpos.vn
EOF
(cd upstream/pos/frontend && npm ci && npm run build:assets)   # compose không build giao diện
docker compose -f deploy/docker-compose.yml up -d
```

Hạn chế cần biết:

- Hai nguồn cho cùng một bí mật (`apps/control-plane/.env` và `deploy/.env`) – lệch `TENANT_SECRET_KEY`/`POSNIC_*` là shard không mở được shop hoặc cài shop lỗi. `SHOP_BASE_DOMAINS` cũng phải trùng.
- Cổng shard **không** được publish: Caddy chạy trên host không tới được các shop. Thêm `docker-compose.override.yml` với `services: { shard: { ports: ["127.0.0.1:6000:6000"] } }` rồi dùng Caddyfile như production.
- Container `shard` chạy `npm ci --omit=dev` **không** có `--ignore-scripts` và **không** thay registry: có thể treo ở `registry.npmmirror.com` và tải Chromium của puppeteer. Nếu gặp, cài trước trên host bằng lệnh ở [Lấy mã nguồn](#lấy-mã-nguồn--cài-đặt) (repo được mount nên `node_modules` dùng chung).
- Repo được mount đọc-ghi: `npm ci` trong container ghi `node_modules` (chủ root) vào thư mục repo trên host.
- MongoDB không có xác thực và không có sao lưu; shard không có `SESSION_SECRET`. Không dùng cho dữ liệu thật.

---

## Phạm vi kiểm chứng

Tài liệu được viết ngày 2026-10-14 trên mã `main` sau v0.2.0. Đã **chạy thật** (Ubuntu 24.04, Node 22.22.0, mongod 8.3.7 replica set một node có `authorization` + `keyFile`, PM2 6.0.13, Caddy 2.10.2 build bằng xcaddy với `caddy-dns/cloudflare`, MongoDB Database Tools 100.13.0, mongosh 2.5.8; mọi cổng thử > 20000, DB tiền tố `docs_test_`, đã xoá sau khi thử):

- `bootstrap-secrets.sh` (ghi vào thư mục nháp; từ chối ghi đè), `sh -n`/`bash -n` các script; `systemd-analyze verify` unit sao lưu và `systemd-analyze calendar` của timer;
- tạo replica set, user `readWriteAnyDatabase`/`backup`/`restore`;
- `npm ci --omit=dev` (gốc), `npm ci` Posnic API với `--replace-registry-host`, build giao diện (`build:assets`), khởi động shard từ bản cài production-only;
- `pm2 start` bằng bản sao `deploy/ecosystem.config.js` (chỉ đổi đường dẫn tệp env và cổng), `pm2 reload --update-env`, hành vi xoá biến, `pm2-logrotate`, `pm2 save`;
- toàn bộ lệnh kiểm tra `curl` trên `127.0.0.1`; Caddy cục bộ (HTTP và TLS nội bộ) để thử xoá `X-Hitech-Shop`, chặn `/api/install`, giới hạn `/metrics`, `tls-ask` qua proxy, `lb_try_duration`; `caddy validate` cho `deploy/Caddyfile` và Caddyfile khuyến nghị;
- đăng ký shop qua API, onboarding, đăng nhập máy bán hàng qua `Host`, bật VietQR và thời gian chờ QR, tạm khoá/mở lại và thời gian shard áp dụng, `429` khi vượt giới hạn đăng nhập, `/readyz` khi shard dừng;
- `run-tenant-migrations.js` (báo cáo, `--apply`, `--only`, `--db`, biến dự phòng, tham số sai);
- `backup.sh --no-upload`, `sha256sum -c`, `restore-tenant.sh` (`--dry-run`, `--to-db`, `--drop`, tại chỗ `--yes`, từ chối control DB);
- `SHARD_INSTANCE`; quy trình hoán đổi thư mục phát hành + reload và quay lui;
- `docker compose config`.

**Chưa kiểm chứng** (đánh dấu trong bài): cài gói apt của MongoDB/Caddy/NodeSource, `ufw`, `pm2 startup`/systemd thật, chứng chỉ Let's Encrypt/DNS-01 thật, replica set 3 node, mọi bước trong dashboard payOS/Pay2S/nhà cung cấp HĐĐT/SMTP, gọi API thật của các nhà cung cấp, chạy container Docker.
