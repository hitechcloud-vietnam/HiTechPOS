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
| `pos/frontend/login.html`, `index.html` | Tiêu đề/meta/JSON-LD HiTechPOS, logo, favicon, theme `#0b6bcb`; liên kết “Dựa trên Posnic (AGPL-3.0) · Mã nguồn”; ẩn thẻ tải ứng dụng desktop bằng `<style>#posnic_app_card{display:none}` (xoá khối style để hiện lại) | Thương hiệu HiTechPOS, nghĩa vụ AGPL §13; HiTechPOS chưa có bản desktop | Không |
| `pos/frontend/dashboard.html`, `forgotpassword.html`, `ssoauth.html`, `customersearch.html`, `customerview.html`, `customersMailPrint.html`, `error-*.html`, `layouts/{sidebar,header,about,footer}.html` | Logo/favicon/tiêu đề HiTechPOS (khoá `lang_app_name`, `lang_app_title`, `lang_about_hitechpos`, `lang_hitechpos_company`); liên kết mã nguồn AGPL trong hộp thoại Giới thiệu | Thương hiệu, AGPL | Không |
| `pos/frontend/modules/sales_write.html` | Đặt `<lang class="lang_action">` vào trong `span.sale_table_head_text`/`return_table_head_text` | `sales.js` ghi vào span làm chữ bị lặp (“Hành ĐộngHành Động”) | Có |
| `pos/frontend/static/images/logo/hitechpos*.svg`, `favicon/hitechpos.ico`, `icons-pwa/hitechpos-*.png`, `static/manifest.webmanifest`, `static/offline.html`, `sw-template.js` | Tệp mới + manifest/offline/thông báo đẩy dùng tên và icon HiTechPOS | Thương hiệu PWA | Không |
| `pos/tests/pwa-install.test.js`, `pos/tests/frontend-discovery-files.test.js` | Kỳ vọng apple-touch-icon và SEO/JSON-LD theo HiTechPOS | Test ghim thương hiệu Posnic | Không |
| `pos/languages/vi.json` | Sửa ~1.000 chuỗi (thuật ngữ POS: Khách lẻ, Khách đưa, Tiền thừa trả khách, Lưu tạm, CK, Tạm tính, Kết ca, Tồn kho…); Posnic→HiTechPOS ở tên sản phẩm; placeholder giữ nguyên (kiểm tra 4.752 khoá, 0 lệch) | Bản dịch máy sai nghĩa | Một phần |
| `pos/languages/_english.json` | Thêm 7 khoá HiTechPOS; bỏ 5 khoá không còn dùng | Test i18n “English map not stale” | Không |
| `pos/frontend/static/script/js/core/money-format.js` (mới) + `pos/frontend/pages_css_js_map.json` | Ghim dấu phân cách mặc định của `$.number` về `.`/`,`; thêm `PosnicPro.money` (số lẻ theo ISO 4217, nhóm chữ số theo quốc gia shop, `parse` đọc được "101.430,98"); hiển thị số đã định dạng trên ô giỏ hàng/tổng tiền bằng CSS mà không đổi text dữ liệu | Trình duyệt tiếng Việt ghi "101.430,98", code đọc lại bằng cách bỏ dấu phẩy nên tóm tắt bán hàng in Tạm tính ₫ 101.43; VND phải hiện số nguyên "25.000" | Có |
| `pos/frontend/static/script/js/core/{tender-receipt,receipt-data,receipt-designer}.js`, `modules/js/{sales,sales_view,dashboard,items_v2,kot_v2,users}.js` | Đọc/hiển thị tiền theo số lẻ và dấu phân cách của tiền tệ shop | Hoá đơn và màn hình bán hàng hiện “₫ 25000.00”, đọc sai “135.000” | Có |
| `pos/src/escpos-receipt.js`, `pos/api/src/helpers/bill-payload.js`, `pos/api/src/controllers/users.controller.js` | ESC/POS nhóm chữ số theo `currencyGroup/currencyDecimal`; payload mang dấu phân cách theo `country_id`; đăng nhập trả `currency_code` | Máy in nhiệt in “₫135000”; trình duyệt chỉ biết ký hiệu ₫ | Có |
| `pos/tests/zero-decimal-money.test.js`, `pos/api/tests/unit/helpers/bill-payload-money-marks.test.js` (mới) | Test hồi quy cho lỗi đọc lại số và định dạng VND | | Có |
| `pos/api/src/helpers/limits.js` (+ test `helpers/limits-per-shop.test.js`) | Bộ nhớ đệm giới hạn gói theo từng DB shop; thêm `userLimit`, `itemLimit` | Cache dùng chung tiến trình áp giới hạn của shop này cho shop khác trong shard; HiTechPOS bán gói theo số nhân viên/mặt hàng | Có (phần cache) |
| `pos/api/src/controllers/users.controller.js`, `items.controller.js`, `models/branch.model.js` | Chặn thêm nhân viên/mặt hàng vượt gói (HTTP 402); thông điệp giới hạn chi nhánh không nhắc “Posnic plan” | Áp gói cước HiTechPOS | Không |
| `pos/api/src/constants/customers.constants.js` (+ test `customers-vn-tax-id.test.js`) | Mã số thuế khách hàng nhận cả GSTIN Ấn Độ lẫn MST Việt Nam (10, 10-3, 12 số); mã bưu chính 5–6 số | API khách hàng từ chối MST Việt Nam nên hoá đơn điện tử B2B không lấy được MST người mua | Có (dạng tổng quát hoá) |
| `pos/languages/vi.json`, `_english.json` | `lang_qrpay`, `lang_razorpay` → “QR chuyển khoản”; khoá mới `lang_qr_customer_display`, `lang_qr_money_received` | Việt hoá, nút mới trong hộp thoại QR | Không |
| `pos/frontend/modals/sales.html`, `sales.js` | Nút “Màn hình khách” và “Đã nhận tiền” trong hộp thoại QR khi id là `htp_…` | Thu ngân xác nhận VietQR chuyển khoản trực tiếp | Không |
| `pos/api/src/routes/sales.routes.js` | Route `GET /sales/hitechQrConfirm` (quyền `sales.write`) | Như trên | Không |
| `pos/api/src/constants/categories.constants.js` | Mẫu tên danh mục chấp nhận chữ/số mọi ngôn ngữ (`\p{L}\p{M}\p{N}`) | Tên “Cà phê” bị từ chối – chặn chủ shop Việt nhập danh mục | Có |
