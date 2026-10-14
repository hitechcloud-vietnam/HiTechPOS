# Chương trình đối tác (đại lý, cộng tác viên)

Mã nguồn: `apps/control-plane/src/partners.js` · giao diện: `/doi-tac` (`public/doi-tac.html`, `doi-tac.js`) · kiểm thử: `apps/control-plane/test/partners.test.js`.

Tài liệu này mô tả **cơ chế**. Tỷ lệ hoa hồng, ưu đãi cho khách, số tháng được tính hoa hồng… là **quyết định kinh doanh**, được cấu hình riêng cho từng đối tác khi tạo; mã nguồn không đặt sẵn mức nào và không có mức nào trong tài liệu này là chính sách của công ty.

## 1. Đối tác

Mỗi đối tác có:

| Trường | Ý nghĩa |
|---|---|
| `name`, `email`, `phone` | Liên hệ. Email là tên đăng nhập cổng đối tác, duy nhất. |
| `type` | `dai_ly` (đại lý) hoặc `cong_tac_vien` (cộng tác viên) – chỉ để phân loại. |
| `code` | Mã giới thiệu, chữ in hoa và số, 4–20 ký tự, duy nhất. Tự sinh nếu không nhập. **Không đổi được** sau khi tạo (liên kết đã phát ra ngoài). |
| `commission` | `{ percent, firstMonths, recurring }` – xem mục 4. Bắt buộc khi tạo. |
| `customerDiscount` | `{ percent }` hoặc trống – ưu đãi thêm cho khách, xem mục 3. |
| `status` | `active` · `suspended` (tạm ngưng: không nhận khách mới, không phát sinh hoa hồng mới, vẫn đăng nhập xem được) · `terminated` (chấm dứt: không đăng nhập được). |
| `payoutInfo`, `note` | Thông tin nhận tiền và ghi chú nội bộ (chỉ quản trị viên thấy). |

Tỷ lệ phần trăm được lưu dạng *basis point* (1% = 100) để mọi phép tính là số nguyên; tối đa 2 chữ số thập phân (ví dụ 12,5%).

## 2. Ghi nhận khách (attribution)

1. Đối tác gửi liên kết `https://<control-plane>/r/<MÃ>`. Liên kết này lưu mã vào cookie `htp_ref` (HttpOnly, SameSite=Lax, mặc định 30 ngày, cấu hình `config.partners.cookieDays`) rồi chuyển về trang đăng ký `/?ref=<MÃ>`. Mở liên kết của đối tác khác sau đó sẽ ghi đè cookie (lần nhấp cuối được tính).
2. Khi đăng ký, mã được lấy theo thứ tự: trường `referralCode` trong thân yêu cầu → `?ref=` → cookie.
3. Cửa hàng được gắn với đối tác **một lần duy nhất**, ngay khi tạo (bảng `partner_attributions`, khoá duy nhất theo cửa hàng; bản sao `tenant.referral`). Sau đó không đổi, kể cả khi có mã khác.
4. Bị bỏ qua **im lặng** (đăng ký vẫn thành công như bình thường): mã không tồn tại hoặc sai định dạng, đối tác không ở trạng thái `active`, và **tự giới thiệu** – email hoặc số điện thoại của chủ cửa hàng trùng với của đối tác.

## 3. Ưu đãi cho khách

Nếu đối tác có `customerDiscount.percent`, cửa hàng do đối tác giới thiệu được giảm thêm tỷ lệ đó cho **kỳ trả phí đầu tiên** (khi cửa hàng chưa có thanh toán thuê bao nào ở trạng thái `paid`).

- Áp dụng trên số tiền **sau** chiết khấu trả trước theo chu kỳ (`plans.js`), làm tròn xuống: `giảm = floor(net × tỷ lệ)`; thuế GTGT (nếu có) tính lại trên số tiền mới theo đúng quy tắc của `plans.js`.
- Ví dụ cơ chế: gói 1 197 000 ₫ (3 tháng), chiết khấu chu kỳ 59 850 ₫ → 1 137 150 ₫; ưu đãi 7,5% = 85 286,25 → **85 286 ₫**; còn **1 051 864 ₫**.
- Thực hiện qua hook `adjustQuote` trong `billing.checkout`; cửa hàng không có đối tác thì báo giá giữ nguyên tuyệt đối. Báo giá công khai `/api/plans/:id/quote` không biết cửa hàng nên không hiển thị ưu đãi; số tiền thật nằm trong kết quả `checkout`.
- Nếu chủ cửa hàng mở hai lần thanh toán trước khi thanh toán lần nào, cả hai đều được ưu đãi (chỉ một lần thường được thanh toán).

## 4. Hoa hồng

Phát sinh khi một thanh toán thuê bao chuyển sang `paid` (hook `onPaid` tại `billing.activate`, chạy cả với callback cổng thanh toán và khi quản trị viên chấp nhận giao dịch `review`).

**Cơ sở tính:** `net` của báo giá trong giao dịch – số tiền khách trả sau mọi chiết khấu (kể cả ưu đãi đối tác), **chưa gồm thuế GTGT**.

**Quy tắc (`commission`):**

| `recurring` | `firstMonths` | Được tính |
|---|---|---|
| `false` | trống | Chỉ lần thanh toán đầu tiên của cửa hàng. |
| `false` | N | Chỉ lần đầu tiên, tối đa N tháng của lần đó. |
| `true` | trống | Mọi lần thanh toán. |
| `true` | N | Mọi lần, cho tới khi đủ N tháng trả phí đầu tiên của cửa hàng. |

“Lần đầu”/“N tháng đầu” được đếm trên các thanh toán thuê bao `paid` trước đó của cửa hàng (theo thời điểm thanh toán), không tính các thanh toán đã hoàn tiền. Một lần thanh toán vượt quá phần còn lại được chia theo tháng, làm tròn xuống: `cơ sở = floor(net × tháng_được_tính / tháng_của_kỳ)`.

**Số tiền:** `hoa hồng = floor(cơ sở × tỷ lệ)` – luôn là số nguyên VND, làm tròn xuống.

**Không trùng lặp:** mỗi giao dịch có đúng một bút toán, khoá `C<orderCode>` (chỉ mục duy nhất). Webhook gửi lại, callback chạy song song, hay job đối soát chạy nhiều lần đều trả về cùng bút toán. Tỷ lệ và quy tắc được **chụp lại** trên bút toán, đổi cấu hình đối tác chỉ ảnh hưởng thanh toán sau đó.

**Đối soát:** `POST /api/admin/partners/jobs/reconcile` quét các thanh toán thuê bao `paid` và tạo bút toán còn thiếu (trường hợp tiến trình dừng giữa lúc ghi sổ thanh toán và ghi hoa hồng). Chạy bao nhiêu lần cũng an toàn.

## 5. Trạng thái và hoàn tiền

```
pending ──duyệt──► approved ──chi trả──► paid
   │                  │
   └──── hoàn tiền ───┴──► reversed
paid ──hoàn tiền──► bút toán điều chỉnh R<orderCode> (số âm): pending → approved → paid
```

- Duyệt và đánh dấu đã chi trả do quản trị viên thực hiện (kèm mã chứng từ chi trả `payoutRef`, ví dụ số UNC).
- Hoàn tiền khi hoa hồng **chưa chi**: bút toán chuyển `reversed`, không còn phải trả.
- Hoàn tiền khi hoa hồng **đã chi**: tạo bút toán điều chỉnh âm `R<orderCode>`, đi qua cùng quy trình duyệt; “paid” của bút toán âm nghĩa là đã khấu trừ/thu hồi.
- Sổ thanh toán (`payment-core`) không có trạng thái hoàn tiền, nên việc hoàn tiền được quản trị viên ghi nhận qua `POST /api/admin/partners/commissions/:orderCode/reverse`.

## 6. Cổng đối tác `/doi-tac`

Đối tác đăng nhập bằng email + mật khẩu (scrypt, như chủ cửa hàng). Phiên đối tác dùng khoá ký riêng (dẫn xuất từ `SESSION_SECRET`) và `aud` riêng: token đối tác **không** dùng được cho API chủ cửa hàng, token chủ cửa hàng không dùng được cho cổng đối tác, và không token nào thay được `X-Admin-Key`. Đổi mật khẩu đăng xuất mọi phiên cũ.

Đối tác chỉ thấy: liên kết/mã giới thiệu, quy tắc của mình, danh sách cửa hàng đã giới thiệu (**tên, gói, trạng thái, hạn dùng** – không có dữ liệu bán hàng, tên miền hay liên hệ của cửa hàng) và các bút toán hoa hồng.

| API | Mô tả |
|---|---|
| `POST /api/partners/auth/login` | `{ email, password }` → `{ token }` |
| `GET /api/partners/me` | Hồ sơ, liên kết giới thiệu, tổng theo trạng thái |
| `GET /api/partners/me/shops` | Cửa hàng đã giới thiệu |
| `GET /api/partners/me/commissions` | `{ totals, items }` |
| `POST /api/partners/me/password` | `{ currentPassword, newPassword }` → token mới |

## 7. API quản trị (header `X-Admin-Key`)

| API | Mô tả |
|---|---|
| `GET /api/admin/partners` | Danh sách đối tác, số cửa hàng, tổng hoa hồng |
| `POST /api/admin/partners` | Tạo đối tác. Không gửi `password` thì hệ thống sinh mật khẩu và trả về **một lần** (`initialPassword`). |
| `GET /api/admin/partners/:id` | Chi tiết, cửa hàng, hoa hồng |
| `PATCH /api/admin/partners/:id` | Sửa liên hệ, trạng thái, quy tắc, đặt lại mật khẩu (không sửa được `code`) |
| `GET /api/admin/partners/commissions?status=&partnerId=` | Bút toán hoa hồng |
| `GET /api/admin/partners/commissions.csv?status=&partnerId=` | Xuất CSV (UTF-8 có BOM để mở bằng Excel; ô văn bản bắt đầu bằng `= + - @` được thêm dấu `'` để tránh chèn công thức) |
| `POST /api/admin/partners/commissions/:key/approve` | `pending → approved` |
| `POST /api/admin/partners/commissions/:key/pay` | `approved → paid`, `{ payoutRef }` |
| `POST /api/admin/partners/commissions/:orderCode/reverse` | Hoàn tiền, `{ reason }` |
| `POST /api/admin/partners/jobs/reconcile` | Tạo bút toán còn thiếu |

`:key` là `C<orderCode>`, `R<orderCode>` hoặc chỉ `orderCode` (hiểu là `C`).

## 8. Lưu trữ

| Collection (Mongo) | Repo | Chỉ mục duy nhất |
|---|---|---|
| `partners` | `store.partners` | `code`, `email` |
| `partner_attributions` | `store.partnerAttributions` | `tenantId` |
| `partner_commissions` | `store.partnerCommissions` | `key` (`C<orderCode>` / `R<orderCode>`) |

Bản ghi tenant chỉ có thêm trường `referral` (shard Posnic bỏ qua). Các chỉ mục được tạo khi khởi động và được chờ trước lần ghi đầu tiên.

## 9. Cấu hình

`config.partners` (tuỳ chọn): `cookieDays` (mặc định 30), `tokenTtlSeconds` (mặc định 7 ngày). Mọi tỷ lệ hoa hồng/ưu đãi được nhập cho từng đối tác qua API quản trị.
