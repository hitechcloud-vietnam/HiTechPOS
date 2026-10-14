# Đồng bộ mã nguồn Posnic

`upstream/` được nhập bằng `git subtree --squash` (không kéo lịch sử Posnic):

| Thư mục | Kho | Nhánh | Commit nhập |
|---|---|---|---|
| `upstream/pos` | https://github.com/Posnic/POS | develop | d57241e |
| `upstream/business` | https://github.com/Posnic/posnic-business | main | b3e3340 |
| `upstream/mobile-app` | https://github.com/Posnic/Mobile-App | main | 5052e7c |
| `upstream/captain` | https://github.com/Posnic/captain | main | 814f8cc |
| `upstream/extension-dojo` | https://github.com/Posnic/posnic-extension-dojo | main | 09aa373 |

Cập nhật:

```sh
git subtree pull --prefix upstream/pos https://github.com/Posnic/POS develop --squash
```

Quy tắc:
- Hạn chế sửa trực tiếp `upstream/`. Mỗi bản vá cục bộ phải ghi vào bảng dưới đây để khi `subtree pull` biết cần giữ gì; ưu tiên gửi bản vá ngược về Posnic.
- Sau mỗi lần cập nhật chạy `npm test` và bộ test của Posnic: `cd upstream/pos/api && npm ci && MONGOMS_SYSTEM_BINARY=<đường dẫn mongod> npx jest -c jest.ci.config.js tests/unit` (test `secrets.test.js` đối chiếu trực tiếp `upstream/pos/api/shard.js`).

## Bản vá cục bộ

| Tệp | Thay đổi | Lý do | Gửi ngược Posnic? |
|---|---|---|---|
| `pos/api/src/db/model-registry.js` | Proxy model trả về hàm gán ở cấp module (`Sale.xxxModel = …`) khi model theo tenant không có | Ở chế độ shard đa tenant, mọi hàm `Sale.*Model` gán ở cấp module đều lỗi “is not a function” (ví dụ QR) | Có – lỗi chung của Posnic |
| `pos/api/src/models/sale.model.js` | Nhánh HiTechPOS trong `generateQrCodeModel`, `getQrStatusModel`, `qrCodeCloseModel`; nạp `../config` sau nhánh này | Ô QR của màn hình bán hàng dùng cổng HiTechPOS (VietQR/payOS/Pay2S) thay Razorpay; `config/index.js` đòi biến môi trường đơn shop | Một phần (lazy config) |
| `pos/api/src/services/hitech-pay.js` | Tệp mới – adapter gọi control plane bằng khoá `HITECH_POS_KEY` của shop | Như trên | Không |
| `pos/frontend/static/script/js/modules/js/sales.js` | Nhãn ô Qrpay dùng i18n `lang_razorpay`; `PosnicPro.sales.paymentLabel` dịch “Cash”/“Card” khi hiển thị (giữ khoá nội bộ) | Hiển thị “QR chuyển khoản”, “Tiền mặt”, “Thẻ” | Có |
| `pos/api/tests/unit/db/model-registry-module-helpers.test.js` | Test mới cho bản vá `model-registry` | | Có |
| `pos/api/src/helpers/limits.js` (+ test `helpers/limits-per-shop.test.js`) | Bộ nhớ đệm giới hạn gói theo từng DB shop; thêm `userLimit`, `itemLimit` | Cache dùng chung tiến trình áp giới hạn của shop này cho shop khác trong shard; HiTechPOS bán gói theo số nhân viên/mặt hàng | Có (phần cache) |
| `pos/api/src/controllers/users.controller.js`, `items.controller.js`, `models/branch.model.js` | Chặn thêm nhân viên/mặt hàng vượt gói (HTTP 402); thông điệp giới hạn chi nhánh không nhắc “Posnic plan” | Áp gói cước HiTechPOS | Không |
| `pos/api/src/constants/customers.constants.js` (+ test `customers-vn-tax-id.test.js`) | Mã số thuế khách hàng nhận cả GSTIN Ấn Độ lẫn MST Việt Nam (10, 10-3, 12 số); mã bưu chính 5–6 số | API khách hàng từ chối MST Việt Nam nên hoá đơn điện tử B2B không lấy được MST người mua | Có (dạng tổng quát hoá) |
| `pos/languages/vi.json`, `_english.json` | `lang_qrpay`, `lang_razorpay` → “QR chuyển khoản”; khoá mới `lang_qr_customer_display`, `lang_qr_money_received` | Việt hoá, nút mới trong hộp thoại QR | Không |
| `pos/frontend/modals/sales.html`, `sales.js` | Nút “Màn hình khách” và “Đã nhận tiền” trong hộp thoại QR khi id là `htp_…` | Thu ngân xác nhận VietQR chuyển khoản trực tiếp | Không |
| `pos/api/src/routes/sales.routes.js` | Route `GET /sales/hitechQrConfirm` (quyền `sales.write`) | Như trên | Không |
| `pos/api/src/constants/categories.constants.js` | Mẫu tên danh mục chấp nhận chữ/số mọi ngôn ngữ (`\p{L}\p{M}\p{N}`) | Tên “Cà phê” bị từ chối – chặn chủ shop Việt nhập danh mục | Có |
