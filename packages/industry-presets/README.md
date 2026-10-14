# @hitechpos/industry-presets

Bộ cấu hình mẫu theo ngành nghề giúp HiTechPOS tương thích với nhiều mô hình kinh doanh tại Việt Nam. Khi chủ cửa hàng chọn ngành lúc đăng ký, preset quyết định: tính năng nào được bật, đơn vị tính, danh mục, hàng mẫu (giá VND, thuế GTGT), mẫu hóa đơn in, phương thức thanh toán, gói dịch vụ và ứng dụng khuyến nghị.

Gói này không có phụ thuộc runtime, chạy trên Node.js >= 22, giấy phép AGPL-3.0-only (kế thừa từ Posnic POS).

## Sử dụng

```js
const presets = require('@hitechpos/industry-presets');

presets.listPresets();                 // danh sách rút gọn cho màn hình đăng ký
presets.getPreset('cafe-tra-sua');     // preset đầy đủ, đã deep-freeze; id lạ -> ném lỗi
presets.resolveInstallPayload('tiem-banh');
// -> { businessType: 'bakery', register_demo: false }  (body cho POST /api/install/add của Posnic)
presets.posnicModuleSettings('nha-hang-quan-an');
// -> { quick_sale_enable: false, hardware_weight_machine_enable: false, module_captain_enable: true, ... }
presets.featureMatrix();               // ma trận tính năng x ngành cho tài liệu
```

### Luồng tạo cửa hàng đề xuất

1. Gọi `resolveInstallPayload(id)` và gửi kèm các trường còn lại tới `POST /api/install/add` của Posnic.
2. Ghi `posnicModuleSettings(id)` vào nhóm cài đặt `features` của chi nhánh. Posnic coi khóa `module_*` vắng mặt là **bật**, nên phải ghi tường minh (xem `scripts/module-defaults-backfill.js` phía upstream).
3. Tạo đơn vị tính, danh mục và `sampleItems` tiếng Việt. Mặc định `register_demo` là `false` vì dữ liệu demo của Posnic (`api/utils/demoData.js`) là tiếng Anh với giá theo Ấn Độ; truyền `{ demo: true }` nếu vẫn muốn dùng.
4. Các tính năng có `hitechExtension: true` chỉ hiển thị khi module mở rộng HiTechPOS tương ứng đã sẵn sàng.

## Cấu trúc preset

| Trường | Ý nghĩa |
| --- | --- |
| `id`, `name`, `description`, `icon` | Mã ngành, tên và mô tả tiếng Việt, từ khóa biểu tượng |
| `posnicBusinessType` | Giá trị gần nhất trong danh sách upstream: icecream, cafe, bakery, supermarket, kirana, grocery, textile, electrical, hardware |
| `features` | Đủ mọi khóa trong `FEATURE_KEYS`, mỗi khóa `{ enabled, posnic, hitechExtension }` |
| `units` | `{ code, name, conversions? }`; `conversions: [{ unit, factor }]` nghĩa là 1 đơn vị này = `factor` đơn vị kia |
| `categories` | Danh mục mặc định |
| `sampleItems` | 5–10 hàng mẫu `{ name, unit, price, vatRate, barcode? }`, giá là số nguyên VND |
| `settings` | Tham số riêng của ngành (size ly, block giờ, % phí phục vụ, % hoa hồng...) |
| `receipt` | `{ template: 'k80' \| 'k58', showVatBreakdown, footer }` |
| `payments` | Tập con của cash, vietqr, payos, pay2s, card, momo, zalopay, debt |
| `vatDefault` | 0, 5, 8, 10 hoặc `'KCT'` (không chịu thuế) |
| `recommendedPlan`, `recommendedApps` | Gói (free/basic/pro/enterprise) và ứng dụng (pos-web, mobile-pos, captain, business, kds) khuyến nghị |

Mã vạch trong hàng mẫu là mã nội bộ EAN-13 đầu `20`, không phải mã của nhà sản xuất.

### Lưu ý về thuế GTGT

Thuế suất trong hàng mẫu chỉ là giá trị gợi ý: mức 8% áp dụng theo chính sách giảm thuế GTGT 2% (Nghị quyết 204/2025/QH15, đến hết 31/12/2026); hàng chịu thuế tiêu thụ đặc biệt (bia, karaoke), sắt thép, sản phẩm công nghệ thông tin giữ 10%; thuốc, thiết bị y tế, nông sản tươi 5%; sách giáo khoa không chịu thuế. Chủ cửa hàng cần đối chiếu với kế toán trước khi xuất hóa đơn.

## Trạng thái tính năng so với Posnic

- **Có sẵn**: Posnic đã hỗ trợ, `hitechExtension: false`.
- **Một phần**: Posnic có nền tảng, HiTechPOS cần mở rộng (`hitechExtension: true`).
- **Mở rộng**: chưa có ở upstream, HiTechPOS sẽ xây dựng (`hitechExtension: true`, `posnic: null`).

Chi tiết tham chiếu mã nguồn upstream nằm trong `src/features.js` (trường `ref` và `note`).

| Tính năng | Khóa | Posnic | Trạng thái | TH | CF | NH | KB | TT | NT | DT | SP | VL | MB | MP | TB | VP | NS | KH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Quét mã vạch | `barcode` | `items.barcode_id / items.barcodes` | Có sẵn | ✓ |  |  |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bán nhanh tại quầy | `quickSale` | `quick_sale_enable` | Có sẵn | ✓ | ✓ |  | ✓ |  |  |  | ✓ |  |  |  | ✓ | ✓ | ✓ | ✓ |
| Đơn vị quy đổi (thùng/lốc/chai) | `unitConversion` | `items.purchase_unit + items.conversion_factor` | Một phần | ✓ |  |  |  |  | ✓ |  |  | ✓ | ✓ |  |  | ✓ | ✓ |  |
| Cân điện tử / bán theo cân | `weighing` | `hardware_weight_machine_enable` | Có sẵn | ✓ |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |
| Biến thể (size, màu) | `variants` | `variants` | Có sẵn |  | ✓ |  |  | ✓ |  | ✓ |  |  | ✓ | ✓ | ✓ |  |  |  |
| Topping / tùy chọn món | `modifiers` | `items.modifier_group_ids` | Có sẵn |  | ✓ | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |
| Sơ đồ bàn / phòng | `tables` | `tableorder` | Có sẵn |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| Gộp / tách / chuyển bàn | `mergeSplitTables` | `table_seating (combined seating) + captain-transfer` | Có sẵn |  |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| In phiếu bếp (KOT) | `kitchen` | `kitchen rounds (KOT)` | Có sẵn |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| Màn hình bếp (KDS) | `kds` | `kitchen-board` | Có sẵn |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| Ứng dụng gọi món Captain | `captainApp` | `module_captain_enable` | Có sẵn |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |  |
| Phí phục vụ / phụ thu | `serviceCharge` | `custom_charges_enable` | Có sẵn |  |  | ✓ | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| In tem ly / tem nhãn | `cupLabels` | — | Mở rộng |  | ✓ |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |
| Tính tiền theo giờ (block giờ) | `hourlyBilling` | `items.item_kind='service' + service_unit='hour'` | Một phần |  |  |  | ✓ |  |  |  |  |  |  |  |  |  |  |  |
| Bán dịch vụ (không tồn kho) | `services` | `items.item_kind='service'` | Có sẵn |  |  |  | ✓ |  |  |  | ✓ |  |  |  |  |  |  |  |
| Lịch hẹn | `appointments` | — | Mở rộng |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| Hoa hồng nhân viên kỹ thuật | `commissions` | — | Mở rộng |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| Thẻ liệu trình / gói dịch vụ | `servicePackages` | — | Mở rộng |  |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |
| Công nợ khách hàng | `debtLedger` | `module_credit_enable` | Có sẵn | ✓ |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |  |  | ✓ | ✓ | ✓ |
| Tích điểm khách hàng | `loyalty` | `loyalty` | Có sẵn | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| Giao hàng | `delivery` | `module_delivery_partners_enable` | Một phần |  | ✓ | ✓ |  | ✓ |  | ✓ |  | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |
| Đặt hàng online | `onlineOrdering` | `module_online_ordering_enable` | Có sẵn |  | ✓ | ✓ |  | ✓ |  |  |  |  | ✓ | ✓ |  |  |  |  |
| Đặt hàng trước / đặt cọc | `preorders` | — | Mở rộng |  |  |  |  |  |  |  |  |  |  |  | ✓ |  |  |  |
| Định lượng nguyên liệu / sản xuất | `recipes` | — | Mở rộng |  | ✓ | ✓ |  |  |  |  |  |  |  |  | ✓ |  |  |  |
| Ghi nhận hao hụt / hư hỏng | `wastage` | `inventory counts mode 'damage' | 'loss'` | Có sẵn | ✓ |  | ✓ |  |  | ✓ |  |  |  |  |  | ✓ |  | ✓ |  |
| Lô & hạn sử dụng | `batchExpiry` | `items.items_expiry_date` | Một phần | ✓ |  |  |  |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  | ✓ |  |
| Xuất kho FEFO (hết hạn trước xuất trước) | `fefo` | — | Mở rộng |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| Quản lý IMEI / số serial | `serialImei` | — | Mở rộng |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| Bảo hành | `warranty` | — | Mở rộng |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| Trả góp | `installments` | — | Mở rộng |  |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |
| Đổi / trả hàng | `returns` | `sales/returnSales` | Có sẵn | ✓ |  |  |  | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ |  | ✓ |
| Thuốc kê đơn | `prescriptions` | — | Mở rộng |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| Liên thông Cơ sở dữ liệu Dược quốc gia | `nationalPharmacyLink` | — | Mở rộng |  |  |  |  |  | ✓ |  |  |  |  |  |  |  |  |  |
| Hóa đơn điện tử | `einvoice` | — | Mở rộng | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Danh sách ngành

| Viết tắt | Mã | Tên | posnicBusinessType | Gói gợi ý |
| --- | --- | --- | --- | --- |
| TH | `tap-hoa-minimart` | Tạp hóa / Minimart / Siêu thị mini | `supermarket` | basic |
| CF | `cafe-tra-sua` | Cà phê / Trà sữa | `cafe` | basic |
| NH | `nha-hang-quan-an` | Nhà hàng / Quán ăn | `cafe` | pro |
| KB | `karaoke-bida` | Karaoke / Bida | `cafe` | pro |
| TT | `thoi-trang` | Thời trang / Giày dép | `textile` | basic |
| NT | `nha-thuoc` | Nhà thuốc | `supermarket` | pro |
| DT | `dien-thoai-dien-may` | Điện thoại / Điện máy | `electrical` | pro |
| SP | `spa-salon` | Spa / Salon / Nail | `supermarket` | pro |
| VL | `vat-lieu-xay-dung` | Vật liệu xây dựng | `hardware` | pro |
| MB | `me-va-be` | Mẹ & bé | `supermarket` | basic |
| MP | `my-pham` | Mỹ phẩm | `supermarket` | basic |
| TB | `tiem-banh` | Tiệm bánh | `bakery` | basic |
| VP | `sach-van-phong-pham` | Nhà sách / Văn phòng phẩm | `supermarket` | basic |
| NS | `nong-san-thuc-pham` | Nông sản / Thực phẩm tươi | `grocery` | free |
| KH | `khac` | Bán lẻ khác | `supermarket` | free |


## Thêm ngành mới

1. Tạo `src/presets/<id>.js` (khai báo `features` là mảng khóa được bật).
2. Thêm `id` vào `PRESET_ORDER` trong `src/index.js`.
3. Khóa tính năng mới phải được thêm vào `src/features.js` kèm ánh xạ Posnic.
4. Chạy `npm test` (dùng `node --test`).
