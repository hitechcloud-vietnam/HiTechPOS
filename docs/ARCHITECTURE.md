# Kiến trúc HiTechPOS

## Tổng quan

```
                    Khách hàng / chủ cửa hàng
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
   app.hitechpos.vn                  <shop>.hitechpos.vn
   ┌──────────────────────┐          ┌───────────────────────────────┐
   │ Control plane        │          │ Posnic shard (upstream/pos/   │
   │ apps/control-plane   │          │ api/shard.js)                 │
   │ - đăng ký, gói cước  │  install │ Host → cửa hàng → AsyncLocal- │
   │ - thanh toán payOS/  │ ───────► │ Storage tenant scope → app    │
   │   Pay2S              │          │ Express Posnic (889 endpoint) │
   │ - cấp phát tenant    │          └──────────────┬────────────────┘
   └─────────┬────────────┘                         │ đọc registry
             │ ghi                                  │ (60 s / khi miss)
             ▼                                      ▼
   MongoDB control DB (hitechpos_control)    MongoDB tenant DBs
   tenants · accounts · payments             hitech_t_<subdomain> (mỗi shop 1 DB)
             ▲
             │ webhook/IPN đã ký
     payOS · Pay2S
```

Ứng dụng đi kèm (thừa hưởng Posnic, kết nối tới `<shop>.hitechpos.vn`):
POS web (`upstream/pos/frontend`), POS di động (`upstream/mobile-app`), Captain gọi món (`upstream/captain`), ứng dụng chủ cửa hàng (`upstream/business`), màn hình bếp KDS (kitchen board trong API).

## Hợp đồng control plane ↔ Posnic shard

Posnic đã có sẵn chế độ đa tenant (`api/src/db/tenant-context.js`, `tenant-connections.js`, `shard.js`) nhưng phần *control plane* (đăng ký, thu phí, cấp phát) của Posnic Cloud là mã đóng. HiTechPOS tự xây phần này và ghi đúng định dạng shard đọc:

| Trường `tenants` | Ý nghĩa | Bên dùng |
|---|---|---|
| `subdomain`, `hosts[]`, `webDomain` | Các hostname cửa hàng trả lời (`shop-hosts.js`) | shard |
| `tenantDb` | Tên CSDL riêng `hitech_t_<subdomain>` | shard |
| `secrets.{JWT_SECRET,SESSION_SECRET,ENCRYPTION_KEY,KIOSK_API_KEY}` | AES-256-GCM `v1:iv:tag:ct`, khoá `TENANT_SECRET_KEY` | shard |
| `provisioned`, `suspended`, `instance` | Có phục vụ không / bị khoá / thuộc máy shard nào | shard |
| `status`, `plan`, `subscription`, `industry`, `ownerAccountId`, `licenseId`, `taxCode` | Dữ liệu SaaS | control plane |

Quy trình đăng ký (`apps/control-plane/src/tenants.js`):
1. Kiểm tra tên miền con (DNS-safe, danh sách giữ chỗ), tạo tài khoản chủ (scrypt).
2. Ghi bản ghi tenant với secret sinh ngẫu nhiên đã niêm phong, gói `trial` 14 ngày.
3. Gọi `POST /api/install/add` của Posnic **qua shard** với header `SHARD_SHOP_HEADER` → tạo người dùng quản trị, chi nhánh, thuế; `businessType` lấy từ mẫu ngành.
4. Thành công → `active`; thất bại → `install_failed` + `suspended`.

## Thanh toán

`packages/payment-core` định nghĩa hợp đồng adapter (`createCheckout`, `verifyCallback`, `getStatus?`, `cancel?`) và **sổ nhật ký** – nơi duy nhất đổi trạng thái giao dịch:

- callback trùng → bỏ qua (theo `eventKey`);
- số tiền khác yêu cầu → `review`, không bao giờ tự `paid`;
- `paid` là trạng thái cuối; chuyển khoản sau khi link hết hạn vẫn được ghi nhận;
- HTTP không tự retry lệnh tạo thanh toán (tránh trừ tiền hai lần), từ chối redirect;
- chữ ký phản hồi/webhook được xác thực, so sánh constant-time.

Gói cước dùng nhật ký này cho thanh toán thuê bao. Cùng hợp đồng sẽ dùng cho thanh toán bán hàng tại quầy (lộ trình giai đoạn 2), cạnh VietQR tĩnh ngoại tuyến (`packages/vietqr`).

## Mẫu ngành nghề

`packages/industry-presets` mô tả 15 ngành bằng 34 cờ tính năng. Mỗi cờ ghi rõ:
- **native** – Posnic đã có (bàn, KOT/KDS, biến thể, modifier, cân, công nợ, tích điểm…);
- **partial** – Posnic có nền tảng, HiTechPOS cần mở rộng (quy đổi đơn vị khi bán, lô/hạn dùng, tính giờ, giao hàng);
- **extension** – HiTechPOS phải xây mới (IMEI/bảo hành, trả góp, lịch hẹn, hoa hồng, thẻ liệu trình, FEFO, đơn thuốc, liên thông dược quốc gia, in tem ly, đặt bánh có cọc, định lượng nguyên liệu, **hoá đơn điện tử VN**).

`posnicModuleSettings(id)` trả về các công tắc `module_*` cần ghi tường minh sau khi cài đặt (Posnic coi thiếu = bật).
