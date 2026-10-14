# @hitechpos/einvoice-vn

Hoá đơn điện tử Việt Nam cho HiTechPOS: một **mô hình hoá đơn chuẩn** (tính tiền, thuế, đọc số thành chữ, kiểm tra hợp lệ) độc lập với nhà cung cấp, cộng ba adapter **Viettel S-Invoice**, **MISA meInvoice**, **Mắt Bão** và một **provider giả lập** để phát triển/kiểm thử.

Khung pháp lý: Nghị định 123/2020/NĐ-CP (sửa đổi bởi Nghị định 70/2025/NĐ-CP), Thông tư 78/2021/TT-BTC (sửa đổi bởi Thông tư 32/2025/TT-BTC), gồm cả **hoá đơn điện tử khởi tạo từ máy tính tiền** cho bán lẻ.

Không có dependency runtime ngoài `@hitechpos/payment-core` (HTTP không tự retry) và `@hitechpos/vn-locale` (thuế GTGT, MST, CCCD, đọc số).

> ⚠️ Tài liệu gốc của cả ba nhà cung cấp **không truy cập được** khi viết gói này. Mọi endpoint/trường được lấy từ SDK/mã nguồn mở (ghi rõ nguồn ở từng file) và **phải xác minh lại** trước khi bật môi trường thật – xem mục [Cần xác minh với tài liệu gốc](#cần-xác-minh-với-tài-liệu-gốc).

## Dùng nhanh

```js
const { buildInvoice, createProvider, withIssueGuard } = require('@hitechpos/einvoice-vn');

const invoice = buildInvoice({
  refId: sale.id,                     // khoá idempotency = mã đơn hàng HiTechPOS
  invoiceType: 'GTGT',                // 'GTGT' (mẫu 1) | 'BANHANG' (mẫu 2)
  fromCashRegister: true,             // hoá đơn khởi tạo từ máy tính tiền
  series: '1C26MAA',                  // ký hiệu mẫu số + ký hiệu hoá đơn (hoặc templateCode '1' + series 'C26MAA')
  issueDate: sale.completedAt,        // thời điểm lập hoá đơn
  paymentMethod: 'TM/CK',             // 'TM' | 'CK' | 'TM/CK'
  pricesIncludeVat: true,             // giá bán lẻ đã gồm thuế (mặc định false)
  seller: { taxCode: '0100109106', name: 'Công ty ...', address: '...', phone: '...' },
  buyer: {},                          // rỗng = khách lẻ không lấy hoá đơn
  lines: [
    { code: 'CF01', name: 'Cà phê sữa', unit: 'ly', quantity: 2, unitPrice: 35000, vatRate: 8 },
    { name: 'Ly giữ nhiệt', unit: 'cái', quantity: 1, kind: 'promotion', vatRate: 10 },
    { name: 'Chiết khấu thành viên', kind: 'discount', amount: 5000, vatRate: 8 },
    { name: 'Cảm ơn quý khách', kind: 'note' },
  ],
});

const misa = withIssueGuard(createProvider('misa', tenant.einvoice.misa), { store: durableStore });
const issued = await misa.issue(invoice);
// { provider, refId, transactionId, providerInvoiceId, invoiceNo, templateCode, series,
//   lookupCode, lookupUrl?, taxAuthorityCode, issuedAt, status: 'issued' | 'pending' }
```

## Mô hình hoá đơn chuẩn (`src/invoice.js`)

`buildInvoice(input, { now })` kiểm tra toàn bộ và trả về đối tượng **đã đóng băng** (deep freeze). Mọi lỗi được gom lại trong một `EInvoiceError` mã `einvoice_invalid` (422), `details.errors = [{ field, message }]` với thông báo tiếng Việt.

| Trường | Quy tắc |
|---|---|
| `refId` | bắt buộc, ≤ 64 ký tự `[A-Za-z0-9._:-]`; khoá idempotency |
| `invoiceType` | `GTGT` → mẫu số `1`; `BANHANG` → mẫu số `2` (mẫu 3–6 không hỗ trợ) |
| `series` | 6 ký tự `C/K` + 2 số năm + 1 chữ loại + 2 chữ tự đặt; năm phải trùng năm lập (giờ Việt Nam) |
| `fromCashRegister` | bắt buộc ký hiệu dạng `C..M..` (có mã CQT, chữ **M**); chữ M không được dùng cho hoá đơn thường |
| `issueDate` | hợp lệ, không ở tương lai (dung sai 5 phút) |
| `currency`/`exchangeRate` | chỉ `VND` / `1` |
| `seller.taxCode` | `isValidTaxCode` (10 số có checksum, `-xxx` chi nhánh, 12 số cá nhân/hộ KD) |
| `buyer` | có MST ⇒ bắt buộc tên đơn vị/người mua + địa chỉ; email, SĐT (`normalizeVNPhone`), CCCD 12 số được kiểm tra |
| `lines[].kind` | `goods` (hàng hoá/dịch vụ), `promotion` (khuyến mại, thành tiền 0), `discount` (chiết khấu thương mại, giảm nhóm thuế suất), `note` (dòng ghi chú) |
| `lines[].vatRate` | GTGT: `0`, `5`, `8`, `10`, `'KCT'`, `'KKKNT'`; hoá đơn bán hàng: không ghi |
| `lines[].discount` | chiết khấu dòng, số nguyên VND, chỉ cho `goods` |

**Cách tính (xác định, số nguyên VND):**

- thành tiền dòng = `quantity × unitPrice` làm tròn nửa xa 0 (`0.35 kg × 285.000 = 99.750`);
- thuế GTGT tính **trên tổng từng nhóm thuế suất** (như dòng tổng hợp in trên hoá đơn, dùng `computeInvoiceTotals` của vn-locale), rồi phân bổ ngược về từng dòng; chênh lệch làm tròn dồn vào dòng lớn nhất (dòng đầu tiên nếu bằng nhau) ⇒ tổng các dòng luôn khớp tổng nhóm;
- `pricesIncludeVat: true`: tiền chưa thuế của nhóm = `round(gross × 100 / (100 + r))`, `unitPriceNet` của dòng có thể có 2 số lẻ;
- chiết khấu thương mại vượt tiền hàng của nhóm, hoặc tổng âm ⇒ lỗi;
- `totals = { saleAmount, lineDiscount, tradeDiscount, tradeDiscountVat, net, vat, gross, groups[{vatRate,label,net,vat,gross}], amountInWords }`, `amountInWords` = `numberToVietnameseWords(gross)` (vd. “Một trăm bốn mươi sáu nghìn bảy trăm đồng”).

Mỗi dòng có giá trị đã tính: `amountNet` (thành tiền trước CK, chưa thuế), `discountNet`, `netAmount` (sau CK, chưa thuế), `vatAmount`, `totalAmount`, `unitPriceNet`. Dòng `discount` lưu giá trị dương.

## Hợp đồng provider (`src/provider.js`)

```
issue(invoice)            -> IssueResult        (không bao giờ tự retry)
getStatus(ref, options?)  -> IssueResult        (status 'not_found' nếu không có)
getPdf?(ref, options?)    -> { pdf: Buffer, fileName }
cancel?/replace?/adjust?  -> einvoice_not_supported (501) khi chưa hỗ trợ
```

`ref` là `refId` (chuỗi), `{ refId }` hoặc `{ providerInvoiceId }`. Trạng thái: `draft`, `pending` (đã nhận, chờ ký/chờ mã CQT), `issued`, `rejected`, `cancelled`, `replaced`, `adjusted`, `not_found`.

`createEInvoiceRegistry()` giống registry của payment-core; `createProvider(id, config, { transport, now, timeoutMs })` tạo adapter theo id (`viettel`, `misa`, `matbao`).

### Idempotency và kết quả không xác định

1. Mỗi adapter gửi một khoá phía nhà cung cấp **suy ra cố định từ `refId`** (`transactionIdFor(refId)`: giữ nguyên nếu là UUID, ngược lại là UUID kiểu v5 từ SHA-1) – Viettel `transactionUuid`, MISA `RefID`, Mắt Bão `MTChieu` (+ `KTraMTChieuTrung: 1`).
2. `issue` là lệnh tạo: timeout, lỗi mạng, HTTP 5xx/408/429, phản hồi không đọc được hoặc thiếu số hoá đơn ⇒ `einvoice_outcome_unknown`. **Không retry**; phải gọi `getStatus(refId)` để đối soát.
3. `withIssueGuard(provider, { store })` thêm chốt cục bộ theo `refId`: đã phát hành ⇒ trả kết quả cũ, không gọi provider; đang phát hành ⇒ `einvoice_issue_in_progress`; kết quả không rõ hoặc `einvoice_duplicate` ⇒ chặn cho tới khi `reconcile(refId)` hỏi provider (thấy hoá đơn ⇒ ghi nhận; `not_found`/`rejected` ⇒ cho phát hành lại). `store` mặc định là `Map` trong bộ nhớ – production nên truyền store bền vững (`get/set/delete`, sync hoặc async).
4. Token: cache tới trước khi hết hạn 60 giây (Viettel `expires_in`; MISA/Mắt Bão đọc `exp` của JWT, nếu không có dùng `tokenTtlMs`). Gặp 401 (HTTP hoặc mã lỗi trong body): **lệnh đọc** đăng nhập lại và gọi lại **một lần**; **lệnh tạo/huỷ** chỉ xoá token, trả lỗi `einvoice_credentials_rejected`.

### Mã lỗi

| code | status | ý nghĩa |
|---|---|---|
| `einvoice_invalid` | 422 | hoá đơn/tham số không hợp lệ |
| `einvoice_configuration_invalid` | 422 | thiếu/sai cấu hình adapter |
| `einvoice_not_supported` | 501 | thao tác chưa hỗ trợ |
| `einvoice_outcome_unknown` | 502 (409 từ guard) | đã gửi lệnh tạo, chưa rõ kết quả ⇒ đối soát |
| `einvoice_rejected` | 502 | nhà cung cấp từ chối (`details.providerCode`) |
| `einvoice_duplicate` | 409 | khoá tham chiếu đã tồn tại ⇒ đối soát |
| `einvoice_issue_in_progress` | 409 | refId đang được phát hành |
| `einvoice_credentials_rejected` | 502 | đăng nhập/token bị từ chối |
| `einvoice_not_found` | 404 | không tìm thấy hoá đơn |
| `einvoice_unavailable`, `einvoice_response_invalid` | 502 | lệnh đọc thất bại |

Nội dung phản hồi của nhà cung cấp chỉ nằm trong `details`, không đưa vào `message`.

## Cấu hình nhà cung cấp

Tất cả nhận `{ environment: 'sandbox' | 'production', baseUrl?, lookupUrlTemplate? }` (mặc định `sandbox`; `lookupUrlTemplate` như `https://.../tra-cuu?code={code}` để dựng `lookupUrl`) và tuỳ chọn thứ hai `{ transport = fetch, now, timeoutMs = 60000 }`.

### Viettel S-Invoice – `createViettelProvider`

```js
createViettelProvider({
  username: '0100109106',      // tài khoản API (SDK dùng luôn làm supplierTaxCode)
  password: '...',
  supplierTaxCode: '0100109106', // tuỳ chọn, mặc định = username
  templateCode: '1/001',       // mã mẫu theo Viettel (lấy bằng getTemplates()), mặc định = mẫu số chuẩn '1'/'2'
  environment: 'production',
});
```

| Môi trường | baseUrl mặc định |
|---|---|
| production | `https://api-vinvoice.viettel.vn` (SDK) |
| sandbox | `https://demo-sinvoice.viettel.vn` (**chưa xác minh**) |

Hàm: `issue`, `getStatus` (theo `transactionUuid`), `getPdf`, `getTemplates`; `cancel/replace/adjust` ⇒ `einvoice_not_supported`.

### MISA meInvoice – `createMisaProvider`

```js
createMisaProvider({
  appId: '...', taxCode: '0100109106', username: '...', password: '...',
  signType: 5,                 // mặc định: 5 nếu fromCashRegister, ngược lại 2 (HSM)
  withTaxAuthorityCode: true,  // cờ invoiceWithCode cho status/Download
  fromCashRegister: true,      // cờ invoiceCalcu cho status/Download
  sendEmail: true,             // IsSendEmail khi người mua có email
  tokenTtlMs: 43200000,        // dùng khi token không phải JWT
  environment: 'sandbox',
});
```

| Môi trường | baseUrl mặc định |
|---|---|
| sandbox | `https://testapi.meinvoice.vn` |
| production | `https://api.meinvoice.vn` |

SignType: 1 = USB/file (ký phía client – không dùng được từ server), 2 = HSM đồng bộ, 3 = HSM bất đồng bộ (phải poll `getStatus`), 5 = máy tính tiền không ký. `issue` từ chối `signType: 5` cho hoá đơn không phải máy tính tiền. Hàm: `issue`, `getStatus` (theo RefID `inputType=2` hoặc TransactionID `inputType=1`), `getPdf`, `getTemplates`; `cancel/replace/adjust` ⇒ `einvoice_not_supported`.

### Mắt Bão – `createMatBaoProvider`

```js
createMatBaoProvider({
  taxCode: '0302712571-999',   // MST đăng nhập (trường MST)
  username: 'admin', password: '...',
  currencyCode: '704',         // DVTTe; SDK ví dụ dùng '704' (mã số ISO của VND)
  tokenTtlMs: 3600000,
  environment: 'sandbox',
});
```

| Môi trường | baseUrl mặc định |
|---|---|
| sandbox | `https://demo-api-hddt.matbao.in:11443` |
| production | `https://api-hddt.matbao.in:11443` |

Hàm: `issue`, `getStatus` (tra `invoice-detail` trong khoảng ngày: `options.issueDate` ±1 ngày, hoặc `from/to`, mặc định 90 ngày gần nhất, rồi khớp `MTChieu`), `getPdf`, `getTemplates`, `cancel` (xoá bỏ – xem lưu ý pháp lý); `replace/adjust` ⇒ `einvoice_not_supported`. Mã lỗi: 305/304 ⇒ `einvoice_duplicate`; 300 (“đã tạo nháp”) ⇒ `einvoice_rejected` với `details.draftCreated = true`; 401/402 ⇒ hết hạn token.

### Provider giả lập – `createMockProvider`

Cấp số tuần tự theo từng `templateCode + series`, trùng `refId` trả lại hoá đơn cũ; `failNextIssue('unknown' | 'lost' | 'rejected')` để kiểm thử luồng đối soát.

## Bảng ánh xạ trường

| Mô hình chuẩn | Viettel (`createInvoice`) | MISA (`InvoiceData[0]`) | Mắt Bão (`create-invoice[0]`) |
|---|---|---|---|
| `refId` → `transactionIdFor` | `generalInvoiceInfo.transactionUuid` | `RefID` | `MTChieu` (+ `MaTraCuu` = UUID bỏ gạch, in hoa) |
| `invoiceType` | `invoiceType` `'1'`/`'2'` ⚠️ | `InvoiceName` ⚠️ | (theo `KHMSHDon`) |
| `templateCode` | `templateCode` (cấu hình riêng) | trong `InvSeries` | `KHMSHDon` |
| `series` | `invoiceSeries` | `InvSeries` = `templateCode+series` ⚠️ | `KHHDon` |
| `fromCashRegister` | (chữ M trong ký hiệu) ⚠️ | `IsInvoiceCalculatingMachine`, `SignType` 5 | (chữ M trong ký hiệu) ⚠️ |
| `issueDate` | `invoiceIssuedDate` (epoch ms) | `InvDate` `YYYY-MM-DD` giờ VN | `NLap` ISO-8601 |
| `currency`, `exchangeRate` | `currencyCode`, `exchangeRate` | `CurrencyCode`, `ExchangeRate` | `DVTTe` (`'704'`), `TGia` |
| `paymentMethod` | `payments[0].paymentMethod(Name)` | `PaymentMethodName` | `HTTToan` |
| `note` | `invoiceNote` | `Note` ⚠️ | `GChu` |
| `seller.*` | `sellerInfo.sellerLegalName/TaxCode/AddressLine/PhoneNumber/Email/BankName/BankAccount` | (theo tài khoản) | (theo tài khoản) |
| `buyer.companyName` | `buyerLegalName` | `BuyerLegalName` | `NMua_Ten` |
| `buyer.name` | `buyerName` | `BuyerFullName` | `NMua_HVTNMHang` |
| khách lẻ | `buyerName` = “Khách lẻ không lấy hoá đơn”, `buyerNotGetInvoice` ⚠️ | `BuyerLegalName` = “Khách lẻ…” | `NMua_Ten` = “Khách lẻ…” |
| `buyer.taxCode/address/phone/email/code` | `buyerTaxCode/AddressLine/PhoneNumber/Email/Code` | `BuyerTaxCode/Address/PhoneNumber/Email/Code` | `NMua_MST/DChi/SDThoai/DCTDTu/MKHang` |
| `buyer.citizenId` | `buyerIdNo` ⚠️ | `AccountObjectIdentificationNumber` ⚠️ | `NMua_CCCDan` |
| `line.kind` | `selection` 1/1/3/2 ⚠️ | `ItemType` 1/2/3/4 ⚠️ | `TChat` 1/2/3/4 |
| `lineNo, code, name, unit, quantity` | `lineNumber, itemCode, itemName, unitName, quantity` | `LineNumber, ItemCode, ItemName, UnitName, Quantity` | `STT, MHHDVu, THHDVu, DVTinh, SLuong` |
| `unitPriceNet` | `unitPrice` | `UnitPrice` | `DGia` |
| `amountNet` | `itemTotalAmountWithoutTax` | `Amount(OC)` | `ThTienChuaCK` |
| `discountNet` | `itemDiscount` | `DiscountAmount(OC)`, `DiscountRate` | `STCKhau`, `TLCKhau` |
| `netAmount` | `itemTotalAmountAfterDiscount` | `AmountWithoutVAT(OC)` | `ThTien` |
| `vatRate` | `taxPercentage` (KCT −1, KKKNT −2 ⚠️) | `VATRateName` `'8%'`/`'KCT'`/`'KKKNT'` | `TSuat` (KCT −1, KKKNT −2) |
| `vatAmount`, `totalAmount` | `taxAmount` | `VATAmount(OC)`, `AmountAfterTax` | `TThue`, `TgTien` |
| `totals.groups` | `taxBreakdowns[]` | `TaxRateInfo[]` | (không gửi) |
| `totals.saleAmount` | `summarizeInfo.sumOfTotalLineAmountWithoutTax` | `TotalSaleAmount(OC)` | – |
| `totals.tradeDiscount` | `summarizeInfo.discountAmount` ⚠️ | dòng `ItemType` 3 | `TTCKTMai` |
| `totals.net` | `totalAmountWithoutTax` | `TotalAmountWithoutVAT(OC)` | `TgThTien` ⚠️ |
| `totals.vat` | `totalTaxAmount` | `TotalVATAmount(OC)` | `TgTThue` |
| `totals.gross` | `totalAmountWithTax` | `TotalAmount(OC)` | `TgTTTBSo` |
| `totals.amountInWords` | `totalAmountWithTaxInWords` | `TotalAmountInWords` | `TgTTTBChu` |

Kết quả trả về: Viettel `result.invoiceNo` (vd. `C26MAA42` ⇒ `providerInvoiceId`, `invoiceNo: '42'`), `reservationCode` ⇒ `lookupCode`, `codeOfTax` ⇒ `taxAuthorityCode`. MISA `TransactionID` ⇒ `providerInvoiceId`/`lookupCode`, `InvNo`, `InvCode`. Mắt Bão `MaSoHDon` ⇒ `providerInvoiceId`, `SHDon`, `MCCQT`, `TThaiHDon`. Ký hiệu `C…` chưa có mã CQT ⇒ `status: 'pending'`.

## Lưu ý pháp lý (để kế toán/khách hàng xác nhận)

- **Hoá đơn khởi tạo từ máy tính tiền** (NĐ 123 Điều 11, sửa đổi bởi NĐ 70/2025): dành cho doanh nghiệp, hộ/cá nhân kinh doanh bán lẻ trực tiếp đến người tiêu dùng (bán lẻ, ăn uống, nhà hàng, khách sạn, dịch vụ…), có kết nối chuyển dữ liệu điện tử với cơ quan thuế. Từ 01/06/2025, NĐ 70 bắt buộc nhóm hộ/cá nhân kinh doanh có doanh thu từ 1 tỷ đồng/năm trở lên thuộc các ngành này sử dụng. Ký hiệu có mã CQT dạng `C` + năm + **`M`** + 2 chữ (vd. `1C26MAA`); mã CQT được sinh theo cấu trúc riêng, **không bắt buộc chữ ký số** của người bán (MISA `SignType 5`). Gói này kiểm tra ký hiệu; việc đăng ký sử dụng (mẫu 01/ĐKTĐ-HĐĐT) và chuyển dữ liệu do nhà cung cấp thực hiện.
- **Thời điểm lập hoá đơn** (NĐ 123 Điều 9, sửa đổi bởi NĐ 70): bán hàng hoá là thời điểm chuyển giao quyền sở hữu/quyền sử dụng **không phân biệt đã thu tiền hay chưa**; cung cấp dịch vụ là khi hoàn thành, hoặc khi thu tiền nếu thu trước/trong khi cung cấp (trừ tiền đặt cọc bảo đảm). Với POS: lập hoá đơn ngay khi chốt đơn bán (`issueDate` = thời điểm hoàn tất giao dịch), không đợi đối soát thanh toán; đơn huỷ trước khi giao không lập. `issueDate` ở tương lai bị từ chối; ký hiệu năm phải khớp năm lập.
- **Khách lẻ không lấy hoá đơn**: hoá đơn bán cho người tiêu dùng không yêu cầu có thể không có tên, địa chỉ, MST người mua; nhà cung cấp vẫn cần một tên người mua nên gói dùng chuỗi `ANONYMOUS_BUYER_NAME` = “Khách lẻ không lấy hoá đơn”. Khi người mua cung cấp MST thì bắt buộc tên đơn vị và địa chỉ; người mua là cá nhân có thể ghi số định danh/CCCD (`citizenId`, NĐ 70).
- **Hàng khuyến mại** ghi tên, số lượng, thành tiền 0 (`kind: 'promotion'`); **chiết khấu thương mại** ghi thành dòng riêng giảm trừ theo đúng nhóm thuế suất (`kind: 'discount'`).
- **Thuế suất 8%**: mức giảm 2% theo các nghị quyết của Quốc hội (gần nhất NQ 204/2025/QH15); kiểm tra hiệu lực và danh mục hàng hoá loại trừ trước khi áp dụng.
- **Sai sót**: từ NĐ 70/2025, hoá đơn đã lập có sai sót được xử lý bằng **điều chỉnh hoặc thay thế** (kèm thông báo mẫu 04/SS-HĐĐT khi cần), không tự ý huỷ. `cancel` của Mắt Bão chỉ là khả năng kỹ thuật; host phải quyết định trường hợp được phép. `replace/adjust` chưa được triển khai ở phiên bản này.

## Nguồn tham khảo đã dùng

| Nhà cung cấp | Nguồn (dữ liệu, không thực thi) |
|---|---|
| Viettel | npm `viettel-s-invoice@1.0.10` (MIT, không chính thức): `lib/viettel-s-invoice.js`, `lib/interfaces/viettel-s-invoice.d.ts`, `lib/constants/index.js`, `README.md` |
| Mắt Bão | npm `@redonvn/matbao-invoice-sdk@1.0.2`: `dist/services/matbao-invoice.service.js`, `dist/types/index.d.ts`, `dist/constants.js`, `README.md`. (`matbao-partner-sdk@1.0.2` là API đối tác ký HMAC cho chứng thư số, không phải API hoá đơn – không dùng.) |
| MISA | Không có SDK trên npm. Đối chiếu 4 dự án mã nguồn mở cùng trích `doc.meinvoice.vn/itg`: `ahc0403-commits/globospossystem` `supabase/functions/_shared/meinvoice.ts`; `congtydetmaygiausang-eng/mimin-erp` `apps/web/src/lib/meinvoice.ts`; `apexspace9-a11y/tkpro` `lightbill/server/src/MisaEInvoiceService.php`; `thanhdat-89/hocvien` `Website/quan-ly-hv/reporting/MEINVOICE-RESEARCH.md`. (`mrhuychien/erpnextvn` `e_invoicing/misa.py` mô tả endpoint `/v1/auth/getToken` mâu thuẫn với các nguồn trên – bị loại.) |

## Cần xác minh với tài liệu gốc

Các mục dưới đây **không** có trong nguồn đã đọc hoặc chỉ có ở một nguồn; trong mã nguồn được đánh dấu `UNVERIFIED`.

**Viettel S-Invoice**
1. Host sandbox `https://demo-sinvoice.viettel.vn` (SDK chỉ có production `https://api-vinvoice.viettel.vn`).
2. `generalInvoiceInfo.invoiceType` theo TT78 (`'1'` GTGT, `'2'` bán hàng) và định dạng `templateCode` (vd. `1/001`); `adjustmentType: '1'` cho hoá đơn gốc.
3. `itemInfo.selection`: 1 hàng hoá, 2 ghi chú, 3 chiết khấu; cách thể hiện hàng khuyến mại (`itemNote`) và dòng chiết khấu (dấu dương hay âm, `isIncreaseItem`).
4. `taxPercentage` −1 (KCT) / −2 (KKKNT); cách gửi dòng của hoá đơn bán hàng (không có thuế suất).
5. `buyerInfo.buyerIdNo` (CCCD), `buyerNotGetInvoice` (giá trị `'1'`), `summarizeInfo.discountAmount`.
6. Hoá đơn máy tính tiền trên Viettel: có endpoint/cờ riêng hay chỉ cần ký hiệu chữ `M`.
7. Mã lỗi khi trùng `transactionUuid` (adapter chỉ nhận diện theo chữ “trùng/duplicate/exist/đã tồn tại”) và Viettel có trả lại hoá đơn cũ hay không.
8. Giá trị `status` trong `searchInvoiceByTransactionUuid` (để nhận diện hoá đơn đã huỷ/thay thế), và phản hồi khi không tìm thấy.
9. Giá trị `errorCode` thành công của `getInvoiceRepresentationFile` (adapter chỉ dựa vào `fileToBytes`).
10. Endpoint huỷ/thay thế/điều chỉnh (`cancelTransactionInvoice`, …) – chưa triển khai.
11. Thời hạn token khi không có `expires_in`.

**MISA meInvoice** (toàn bộ mới được xác minh chéo qua mã nguồn cộng đồng)
1. Đường dẫn token: `/api/integration/auth/token` (3 nguồn) – tài liệu được trích dẫn có ví dụ curl dùng `/api/integration/invoice/token`.
2. `InvSeries` gồm cả mẫu số (`1C26MAA`) hay chỉ 6 ký tự; trường `InvTemplateNo` (chỉ mimin-erp).
3. `ItemType`: 2 = khuyến mại (mimin-erp ghi 2 = “phí”), 3 = chiết khấu, 4 = ghi chú; dấu của dòng chiết khấu.
4. `InvoiceName` cho hoá đơn GTGT/bán hàng/máy tính tiền; `Note`; `AccountObjectIdentificationNumber` (CCCD); `AmountAfterTax`; `ContactName`.
5. Header `CompanyTaxCode` (chỉ mimin-erp).
6. Thời hạn token (các nguồn giả định 14 ngày; adapter dùng `exp` của JWT, nếu không có thì `tokenTtlMs` mặc định 12 giờ).
7. Mã lỗi xác thực trong body (`UnAuthorize`, `InvalidAppID`, `InactiveAppID` theo ghi chú nghiên cứu) và mã lỗi trùng `RefID`.
8. Cấu trúc phản hồi `status` (trường trạng thái phát hành/gửi thuế/huỷ) và `Download` (`Data` base64 trong mảng JSON-string).
9. `SignType` 3 (bất đồng bộ) và luồng eSign; body của `/invoice/cancel`, `/publishview`, `/sendemail` – chưa triển khai.
10. URL tra cứu công khai (để dựng `lookupUrl`; hiện chỉ qua `lookupUrlTemplate`).

**Mắt Bão**
1. Cấu trúc `Data` trả về của `create-invoice`, `invoice-detail`, `download-invoice` (adapter đọc `MaSoHDon|InvID`, `SHDon|No`, `MCCQT`, `TThaiHDon|MaTTHDon`, `MTChieu|SO`, `Pdf|PDF|FilePdf`).
2. `TSuat` −1 = KCT, −2 = KKKNT (chú thích trong SDK mâu thuẫn) và `TSuat` cho hoá đơn bán hàng.
3. `DVTTe` là `'704'` (theo ví dụ SDK) hay `'VND'`; định dạng `NLap` (ISO-8601 UTC theo ví dụ SDK).
4. `TgThTien` là tổng trước hay sau chiết khấu thương mại; dấu số tiền của dòng `TChat` 3.
5. Độ dài tối đa của `MTChieu`/`MaTraCuu` (adapter gửi UUID 36 ký tự / 32 ký tự hex).
6. Cờ/tham số riêng cho hoá đơn máy tính tiền (ngoài chữ `M` trong `KHHDon`).
7. Thời hạn token (adapter mặc định 1 giờ nếu token không phải JWT).
8. Hiệu lực pháp lý của `cancel-invoice` sau NĐ 70/2025.

**Chung**: tập chữ cái hợp lệ ở vị trí thứ 4 của ký hiệu sau TT 32/2025 (gói chỉ ràng buộc chữ `M` cho máy tính tiền).

## Kiểm thử

```sh
npm test -w @hitechpos/einvoice-vn   # hoặc: cd packages/einvoice-vn && node --test
```

Kiểm thử dùng transport giả (không gọi mạng): toán học hoá đơn (nhiều thuế suất, chiết khấu, giá gồm thuế, đọc số), ánh xạ payload/URL/header của từng adapter, cache token và đăng nhập lại khi 401, không retry lệnh tạo, ánh xạ lỗi, chốt idempotency và đối soát.
