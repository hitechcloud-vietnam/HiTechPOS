# @hitechpos/vn-locale

Tiện ích cho thị trường Việt Nam dùng trong HiTechPOS: định dạng/đọc tiền VND, đọc số thành chữ,
thuế GTGT, kiểm tra số điện thoại / mã số thuế / CCCD, ngày giờ theo múi giờ Việt Nam, danh sách
34 tỉnh/thành (từ 1/7/2025), danh sách ngân hàng (mã BIN NAPAS) và xử lý tiếng Việt không dấu.
Không có phụ thuộc runtime.

```js
const vn = require('@hitechpos/vn-locale');

vn.formatVND(1250000);                    // "1.250.000 ₫"
vn.formatVND(1250000, { style: 'code' }); // "1.250.000 VND"
vn.parseVND('1,250,000 VND');             // 1250000
vn.roundVND(12345, 500);                  // 12500 (làm tròn tiền mặt; mode: 'nearest' | 'up' | 'down')

vn.numberToVietnameseWords(1250000);      // "Một triệu hai trăm năm mươi nghìn đồng"
vn.numberToVietnameseWords(105, { zeroTens: 'lẻ' });   // "Một trăm lẻ năm đồng"
vn.numberToVietnameseWords(24, { useTu: true });       // "Hai mươi tư đồng"
vn.numberToVietnameseWords(1e12, { currency: false }); // "Một nghìn tỷ"

vn.computeVAT({ amount: 110000, rate: 10, inclusive: true }); // { net: 100000, vat: 10000, gross: 110000, rate: 10 }
vn.computeInvoiceTotals([{ amount: 100000, rate: 10 }, { quantity: 2, unitPrice: 50000, rate: 8 }]);

vn.normalizeVNPhone('+84 912 345 678'); // "0912345678"
vn.isValidTaxCode('0100112437');        // true
vn.isValidTaxCode('0100112437-001');    // true (đơn vị phụ thuộc)
vn.isValidCCCD('001090012345');         // true

vn.formatDateTimeVN(new Date());        // "14:30 14/10/2026" (Asia/Ho_Chi_Minh)
vn.removeDiacritics('Phở Tuệ');         // "Pho Tue"
vn.matchesSearch('Trà sữa trân châu', 'tra sua'); // true
vn.findProvince('Bình Dương').name;     // "Thành phố Hồ Chí Minh"
vn.findBank('vietcombank').bin;         // "970436"
```

## Ghi chú

- **Làm tròn**: mọi phép làm tròn dùng "nửa xa số 0" (half away from zero) trên số nguyên VND.
- **Thuế GTGT**: `VAT_RATES` gồm 0, 5, 8, 10, `'KCT'` (không chịu thuế), `'KKKNT'` (không kê khai,
  tính nộp thuế). Mức 8% là mức giảm theo các Nghị quyết giảm thuế GTGT của Quốc hội — cần kiểm tra
  thời hạn hiệu lực và phạm vi hàng hóa. `computeInvoiceTotals` tính thuế trên tổng từng nhóm thuế suất.
- **Mã số thuế**: 10 chữ số, chữ số thứ 10 là số kiểm tra:
  `tổng = Σ dᵢ × [31,29,23,19,17,13,7,5,3]ᵢ`, `kiểm tra = 10 − (tổng mod 11)`; nếu kết quả là 10
  thì mã không hợp lệ. Hỗ trợ dạng chi nhánh `0123456789-001`. Mã 12 chữ số (MST cá nhân = số định
  danh/CCCD) chỉ kiểm tra định dạng.
- **Số điện thoại**: chỉ di động (03x, 05x, 07x, 08x, 09x theo đầu số hiện hành), chưa hỗ trợ số cố định.
- **Tỉnh/thành**: 34 đơn vị theo Nghị quyết 202/2025/QH15 (6 thành phố trực thuộc trung ương +
  28 tỉnh). `id` là slug ổn định do HiTechPOS đặt, **không phải** mã đơn vị hành chính chính thức;
  `mergedFrom` liệt kê các tỉnh cũ được sáp nhập.
- **Ngân hàng**: mã BIN theo danh sách NAPAS/VietQR; kiểm tra lại trước khi thêm mới.
