# Ứng dụng chủ cửa hàng HiTechPOS Business

Ứng dụng di động cho chủ cửa hàng (mã nguồn `upstream/business`, dựa trên Posnic Business) xem doanh thu, mặt hàng, tồn kho, ca thu ngân và phê duyệt giảm giá từ xa. Ứng dụng **không bán hàng được**.

Có ba cách bắt đầu trên màn hình chào:

| Lựa chọn | Máy chủ | Đăng nhập bằng |
|---|---|---|
| **Tiếp tục với HiTechPOS Cloud** | `https://app.hitechpos.vn` (control plane) → chuyển sang `https://<cửa-hàng>.hitechpos.vn` | Tài khoản chủ cửa hàng HiTechPOS (email + mật khẩu dùng ở trang quản lý tài khoản) |
| Máy chủ riêng | `https://<cửa-hàng>.hitechpos.vn` (Posnic shard) | Tên đăng nhập/mật khẩu nhân viên của cửa hàng |
| Xem cửa hàng mẫu | không cần máy chủ | – |

Tài liệu này mô tả lựa chọn đầu tiên – phần máy chủ đã được xây ở `apps/control-plane/src/business-cloud.js`. Đặc tả gốc (đọc từ mã ứng dụng) ở `upstream/business/docs/HITECHPOS_SERVER_CONTRACT.md`.

## Chủ cửa hàng kết nối thế nào

1. Mở ứng dụng HiTechPOS Business → **Tiếp tục với HiTechPOS Cloud**.
2. Ứng dụng hiện một **mã đối chiếu 6 ký tự** và mở trình duyệt tới trang `https://app.hitechpos.vn/api/business/v1/authorize?request=…`.
3. Trên trang đó:
   - nếu trình duyệt đang đăng nhập trang tài khoản HiTechPOS thì được dùng luôn; nếu chưa, nhập **email và mật khẩu tài khoản chủ cửa hàng**;
   - kiểm tra mã đối chiếu trên trang **trùng** với mã trên điện thoại (chỉ tiếp tục nếu chính bạn vừa bấm kết nối);
   - nếu tài khoản có nhiều cửa hàng, **chọn cửa hàng** muốn xem; cửa hàng đang bị khoá hoặc chưa sẵn sàng hiện mờ, không chọn được;
   - bấm **Cho phép kết nối** (hoặc **Từ chối**).
4. Quay lại ứng dụng (trên điện thoại trang sẽ tự mở lại ứng dụng qua `vn.hitechpos.business://authorized`). Ứng dụng tự hoàn tất sau vài giây và từ đó làm việc trực tiếp với `https://<cửa-hàng>.hitechpos.vn`; phiên đăng nhập do cửa hàng cấp, hiệu lực 30 ngày.

Khi phê duyệt một yêu cầu giảm giá, ứng dụng xin **xác nhận lại danh tính**: lặp lại các bước trên, trang luôn bắt nhập lại mật khẩu (không dùng phiên trình duyệt sẵn có), phải chọn **đúng cửa hàng đang kết nối**.

Mật khẩu chỉ nhập trên trang của `app.hitechpos.vn`, không bao giờ đi tới ứng dụng; liên kết mở lại ứng dụng không mang mã nào.

### Điều kiện để kết nối được

- Cửa hàng thuộc tài khoản đang đăng nhập, đã cài đặt xong (`status: active`), không bị tạm khoá.
- Trong cửa hàng có **người dùng quản trị (super_admin/admin) cùng email** với tài khoản chủ – chính là người dùng tạo lúc đăng ký. Lần kết nối đầu tiên control plane ghi nhớ người dùng này (`tenants.businessOwnerUserId`), nên sau đó đổi email trong cửa hàng vẫn kết nối được. Nếu không tìm thấy, trang báo “Không tìm thấy tài khoản quản trị…”; khi đó dùng lựa chọn *Máy chủ riêng*.
- Người dùng đó được gán ít nhất một chi nhánh, chi nhánh có tiền tệ VND và múi giờ `Asia/Ho_Chi_Minh` (bước onboarding đã đặt sẵn). Thiếu thì cửa hàng trả `409 branch_configuration_required`.

### Khi nào kết nối bị huỷ

- Yêu cầu quá **10 phút** chưa hoàn tất.
- Chủ cửa hàng **đổi hoặc đặt lại mật khẩu** sau khi đăng nhập trên trang mà trước khi điện thoại nhận chuyển giao.
- Cửa hàng bị **tạm khoá** trong lúc chờ.
- Người dùng quản trị trong cửa hàng bị vô hiệu hoá, hoặc đổi mật khẩu/phiên bản xác thực (cửa hàng kiểm tra lại khi đổi).
- Mở lại liên kết ở tab khác: tab cũ và phiên đăng nhập trên tab cũ mất hiệu lực.

Mọi trường hợp trên: quay lại ứng dụng và bắt đầu lại.

## Phần đã xây (kỹ thuật)

Router Express `createBusinessCloudRouter({ store, config, now, logger, shopLink })` gắn ở `/api/business/v1` của control plane:

| Endpoint | Ai gọi | Kết quả |
|---|---|---|
| `GET /discovery` | ứng dụng | đúng 6 khoá: `product`, `apiVersion: 1`, `issuer` (= `PUBLIC_URL`), `authorization: "business-cloud-pkce-v1"`, `audience`, `reporting: "unavailable"` – schema phía ứng dụng là strict |
| `POST /requests` | ứng dụng | `{codeChallenge, deviceName, stepUp?}` → `{request, authorizationUrl, expiresIn: 600, interval: 5}`; `authorizationUrl` đúng bằng `issuer + "/api/business/v1/authorize?request=" + request` |
| `GET /authorize?request=` | trình duyệt | trang `public/business-signin.html` + `.js` + `.css` (phục vụ qua `/api/business/v1/assets/…`) |
| `POST /authorize/login`, `/authorize/session`, `/authorize/decision` | trang đăng nhập | đăng nhập bằng mật khẩu / bằng token phiên `hitechpos_token` có sẵn; chọn cửa hàng; cho phép/từ chối |
| `POST /token` | ứng dụng (thăm dò 5 s/lần) | `202 {"error":{"code":"authorization_pending"}}` → `200 {"handoff":{"origin","request"}}` **một lần duy nhất**; từ chối/bị huỷ `403`; hết hạn, không biết, sai verifier hoặc đã dùng `410` |

Luồng dữ liệu:

```
điện thoại ── POST /requests ─────────────► control plane: business_requests (TTL 10 phút, _id = sha256(request))
trình duyệt ─ /authorize → login → decision ► trạng thái approved + cửa hàng + người dùng quản trị
điện thoại ── POST /token (verifier) ───────► kiểm PKCE S256, mật khẩu chưa đổi, cửa hàng còn mở
                                            ► ghi 1 dòng business_authorizations vào hitech_t_<shop> (shopBridge)
                                            ◄ {handoff:{origin:"https://<shop>.hitechpos.vn", request}}
điện thoại ── POST <shop>/api/business/v1/token (cùng verifier) ► shard exchange() → pb1_… 30 ngày (step-up: 10 phút)
```

- **Không sửa mã shard.** `exchange()` của Posnic (`upstream/pos/api/src/services/business-access.js`) vốn nhận dòng `authorization: 'cloud-browser'` và tự kiểm lại người dùng, `authVersion`, chi nhánh, quyền trước khi cấp phiên. Control plane đã có quyền ghi DB của shop (`shopBridge`, như `setQrGateway`), nên không cần khoá bí mật riêng cho từng shop. Dòng ghi vào shop dựng bằng `apps/control-plane/src/business-handoff.js` (không phụ thuộc gì), có hiệu lực 5 phút; mã `handoff.request` mới sinh ở mỗi lần chuyển giao, chỉ lưu dạng băm.
- Lưu trữ: repo `store.businessRequests` (`insert`, `findById`, `update(id, expected, patch)` có điều kiện) ở `store/memory.js` và `store/mongo.js` (collection `business_requests`, chỉ mục TTL `expiresAt`). `shopBridge.businessOwner()` và `shopBridge.insertBusinessAuthorization()` trong `store/mongo.js`. Bộ nhớ tạm (`STORE=memory`) không có `shopBridge` nên bước cho phép trả `503 shop_link_unavailable`.
- Bảo mật trang: CSP có nonce, không script inline, `frame-ancestors 'none'`, `form-action 'self'`; token CSRF trong trang phải khớp cookie `hb_consent` (HttpOnly, SameSite=Strict, Secure) và giá trị băm lưu trên yêu cầu; chỉ nhận POST JSON có `Origin` = issuer; email không tồn tại vẫn tốn một lần scrypt. So sánh bí mật bằng `timingSafeEqual`. Log không chứa giá trị từ request.
- Giới hạn tần suất (`security.js`): `/requests` 20/phút/IP, `/token` 30/phút cho mỗi IP+yêu cầu và 240/phút/IP, trang 60/phút/IP, đăng nhập 20/15 phút/IP. Ghi đè bằng `config.rateLimits.{businessRequests,businessToken,businessTokenIp,businessPages,businessLogin}`.
- Lỗi luôn là JSON `{"error":{"code":"…"}}` (trang đăng nhập có thêm `message` tiếng Việt), không chuyển hướng.

### Cấu hình

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `PUBLIC_URL` | – | Issuer của discovery; phải đúng `https://app.hitechpos.vn` (trùng `EXPO_PUBLIC_HITECHPOS_CLOUD_ORIGIN` của bản build ứng dụng) |
| `BUSINESS_CLOUD_ISSUER` | `PUBLIC_URL` | Ghi đè issuer nếu control plane có nhiều tên miền |
| `BUSINESS_CLOUD_CORS_ORIGINS` | rỗng | Origin của bản xem thử web (`expo start --web`, ví dụ `http://localhost:8081`), cách nhau bởi dấu phẩy; chỉ áp cho `/discovery`, `/requests`, `/token` |
| `SHOP_BASE_DOMAINS` | `hitechpos.vn` | Tên miền đầu tiên tạo `handoff.origin = https://<subdomain>.<tên miền>` |

### Kiểm thử

```sh
npm test -w apps/control-plane                       # gồm test/business-cloud.test.js
cd upstream/pos/api && TZ=Asia/Kolkata MONGOMS_SYSTEM_BINARY=<mongod> \
  npx jest -c jest.ci.config.js tests/unit/services/business-access-hitechpos-cloud.test.js --forceExit
```

Test thứ hai chạy `shopBridge` thật của control plane trên mongod rồi đổi dòng đó bằng `exchange()` của shard, nên lệch hợp đồng ở bên nào cũng hỏng ngay.

## Chưa làm

- Dòng trạng thái của `upstream/business/docs/HITECHPOS_SERVER_CONTRACT.md` chưa cập nhật (thư mục đó đang được đổi thương hiệu).
- Mục 5 của đặc tả: `/api/mobile/*` cho ứng dụng POS di động và Captain.
- Trang xác nhận riêng của shard vẫn liên kết `com.posnic.business://authorized` (mục 6 đặc tả).
