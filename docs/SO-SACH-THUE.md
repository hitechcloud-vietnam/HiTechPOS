# Sổ sách & báo cáo thuế cho hộ kinh doanh

> **Số liệu tham khảo – cần kế toán xác nhận.** Tỷ lệ thuế, ngưỡng doanh thu, cách xếp nhóm ngành nghề và bố cục mẫu sổ dưới đây là cách hiểu của nhóm phát triển, **chưa được kế toán/cơ quan thuế xác nhận**. Mọi màn hình, tệp CSV và bản in đều ghi dòng lưu ý này. Chủ cửa hàng cần đối chiếu với kế toán trước khi kê khai.

## Chức năng

Trang `/so-sach` (sau khi đăng nhập tài khoản chủ cửa hàng) cho phép:

1. Chọn kỳ: **tháng**, **quý** hoặc **năm**. Ranh giới kỳ tính theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7): ví dụ tháng 10/2026 là từ 00:00 01/10/2026 đến hết 23:59:59 31/10/2026 giờ Việt Nam.
2. Xem **sổ chi tiết doanh thu** theo bố cục mẫu **S1-HKD**: ngày ghi sổ, số hiệu và ngày chứng từ, diễn giải, doanh thu chia theo 4 nhóm ngành nghề, tổng cộng, ghi chú. Có hai cách ghi:
   - *Mỗi ngày một dòng* (mặc định): một dòng doanh thu bán hàng mỗi ngày (số hiệu chứng từ là mã đơn đầu … cuối), một dòng hàng bán bị trả lại mỗi ngày;
   - *Mỗi đơn một dòng*: từng đơn bán và từng lượt trả hàng.
3. Xem **tổng hợp kỳ để tự khai**: doanh thu từng nhóm ngành nghề, thuế GTGT và thuế TNCN theo tỷ lệ % trên doanh thu, tình trạng so với ngưỡng doanh thu không chịu thuế, số thuế tạm tính phải nộp của kỳ.
4. **Tải CSV** (UTF-8 có BOM, xuống dòng CRLF, tiêu đề tiếng Việt; chọn dấu phẩy hoặc dấu chấm phẩy – Excel cài đặt vùng Việt Nam thường cần dấu chấm phẩy), **tải bản in HTML** (trang A4 ngang, mở bằng trình duyệt rồi in), hoặc **In** trực tiếp (CSS in A4, ẩn các nút điều khiển, có ô ký tên).
5. **Xếp nhóm ngành nghề theo danh mục hàng**: mặc định theo ngành của cửa hàng (mẫu ngành trong `packages/industry-presets`), chủ cửa hàng đổi được cho từng danh mục, cho hàng chưa phân loại, cho phụ phí (phí giao hàng, phí phục vụ…) và nhóm mặc định. Cấu hình lưu trên bản ghi tenant (`taxLedgerSettings`).

Chưa có xuất XLSX: tạo tệp XLSX cần một bộ nén zip; để không thêm thư viện, CSV có BOM là định dạng mở bằng Excel.

## Số liệu lấy từ đâu

Dữ liệu đọc từ CSDL bán hàng Posnic của cửa hàng (`hitech_t_<subdomain>`, collection `sales`, `items`, `categories`) – chỉ đọc, không ghi.

| Trường hợp | Cách ghi sổ |
|---|---|
| Đơn đã thanh toán (`payment_status` = `Paid`) | Doanh thu ngày bán = `sales_total` (số tiền khách phải trả sau chiết khấu, làm tròn, gồm thuế và phụ phí) |
| Đơn bán chịu / thu chưa đủ (`Partialy Paid`, không phải đơn bàn đang mở) | Ghi doanh thu ngày bán, có ghi chú và cảnh báo |
| Đơn lưu tạm (`Hold`), đơn bàn chưa thanh toán, đơn online chờ duyệt/bị từ chối, đơn đã huỷ | Không ghi; số đơn bị loại hiển thị dưới bảng tổng hợp |
| Trả hàng (`items_return[].returnArray`) | Dòng âm vào **ngày trả hàng**, bằng số tiền đã hoàn (`itemsTotalAmount`); kỳ chứa ngày bán không bị sửa |

Doanh thu một đơn được chia cho các nhóm ngành nghề theo tỷ trọng tiền của từng dòng hàng lúc bán (lấy từ `business_item_origin` nếu đơn đã có trả hàng) và phụ phí.

### Xếp nhóm một dòng hàng (thứ tự ưu tiên)

1. Chủ cửa hàng đã chọn nhóm cho danh mục của dòng (theo mã danh mục, rồi theo tên);
2. Quy tắc theo danh mục của mẫu ngành (ví dụ Spa: “Sản phẩm bán lẻ” → phân phối hàng hoá);
3. Mặt hàng là dịch vụ trong Posnic (`item_kind = service`) → nhóm dịch vụ;
4. Nhóm mặc định của chủ cửa hàng, nếu không có thì nhóm mặc định của mẫu ngành.

Nếu dòng bán không ghi danh mục, hệ thống tra danh mục của mặt hàng trong collection `items`.

## Làm tròn (đều có kiểm thử)

- Tiền luôn là số nguyên đồng.
- Doanh thu một đơn = `sales_total` làm tròn đến đồng (nửa đồng làm tròn ra xa số 0).
- Chia doanh thu một đơn cho các nhóm theo **phương pháp phần dư lớn nhất**: tổng các phần luôn đúng bằng doanh thu đơn; khi phần dư bằng nhau, đồng lẻ thuộc về nhóm đứng trước.
- Thuế tính **theo từng nhóm** trên doanh thu thuần của nhóm trong kỳ, làm tròn **nửa đồng lên** bằng số học số nguyên chính xác; tổng thuế = tổng các số thuế đã làm tròn của từng nhóm.
- Nhóm có doanh thu thuần âm trong kỳ (trả hàng nhiều hơn bán) có thuế bằng 0 và có cảnh báo.

## Bảng cấu hình (một bảng duy nhất)

Tệp: `apps/control-plane/src/tax-ledger-config.js`, hằng `TAX_TABLE`. Tỷ lệ ghi bằng **phần vạn** (100 = 1%) để tính chính xác.

| Cột S1-HKD | Nhóm ngành nghề (`id`) | Tỷ lệ GTGT | Tỷ lệ TNCN |
|---|---|---|---|
| (1) | Phân phối, cung cấp hàng hoá (`phan_phoi`) | 1% | 0,5% |
| (2) | Dịch vụ, xây dựng không bao thầu nguyên vật liệu (`dich_vu`) | 5% | 2% |
| (3) | Sản xuất, vận tải, dịch vụ có gắn với hàng hoá, xây dựng có bao thầu nguyên vật liệu (`sx_vt`) | 3% | 1,5% |
| (4) | Hoạt động kinh doanh khác (`khac`) | 2% | 1% |

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `annualThreshold` | 500.000.000 đ | Doanh thu năm từ mức này trở xuống: không phải nộp GTGT, TNCN theo tỷ lệ trên doanh thu |
| `thresholdMode` | `whole` | Năm vượt ngưỡng thì tính thuế trên toàn bộ doanh thu năm |
| `gtgtReductionPercent` | 0 | % giảm tỷ lệ GTGT (ví dụ 20 → 1% thành 0,8%); mặc định không giảm |
| `version` | `tham-khao-2026-10` | In trên mọi bản xuất để biết bảng nào đã dùng |

Cũng trong tệp này: `INDUSTRY_DEFAULTS` (nhóm mặc định theo từng mẫu ngành và ngoại lệ theo danh mục), `SERVICE_ITEM_GROUP`, `S1_HKD` (tiêu đề, ký hiệu cột, ô ký tên của mẫu sổ).

**Ngưỡng và kỳ:** ngưỡng là theo năm. Báo cáo tháng/quý so doanh thu năm đã ghi nhận đến hiện tại với ngưỡng:
- *Đã vượt ngưỡng* → thuế phải nộp tạm tính của kỳ = thuế tính được;
- *Chưa vượt ngưỡng* (năm chưa kết thúc) → thuế phải nộp tạm tính bằng 0, số thuế “nếu vượt ngưỡng” vẫn hiển thị để tham khảo; nếu sau đó cả năm vượt ngưỡng thì các kỳ trước cũng phải tính thuế;
- *Không vượt ngưỡng* (năm đã kết thúc) → không phải nộp.

Đổi một giá trị: chỉ sửa `TAX_TABLE`, giữ chú thích `// UNVERIFIED: cần kế toán xác nhận` cho tới khi kế toán xác nhận, cập nhật tài liệu này và chạy `npm test -w apps/control-plane`.

## Các điểm cần kế toán xác nhận

Mỗi điểm dưới đây có chú thích `// UNVERIFIED: cần kế toán xác nhận` trong mã:

1. **Ngưỡng doanh thu không chịu thuế** 500 triệu đồng/năm. Mức này đã thay đổi qua các thời kỳ (100 triệu theo hướng dẫn trước đây, các mức cao hơn theo các luật sau này); 500 triệu là mức nhóm phát triển hiểu là áp dụng từ 2026, chưa xác nhận.
2. **Cách áp ngưỡng**: tính thuế trên toàn bộ doanh thu năm khi vượt ngưỡng (`whole`), hay chỉ trên phần vượt ngưỡng đối với một số loại thuế theo quy định mới. Hiện chỉ cài đặt `whole`.
3. **Tỷ lệ % GTGT và TNCN** của 4 nhóm (theo Phụ lục I Thông tư 40/2021/TT-BTC) còn áp dụng sau cải cách thuế hộ kinh doanh năm 2026 hay không. Các hoạt động có tỷ lệ riêng (cho thuê tài sản, đại lý xổ số/bảo hiểm, bán hàng đa cấp…) chưa được mô hình hoá.
4. **Giảm tỷ lệ GTGT** cho hộ kinh doanh theo các chính sách giảm thuế GTGT: phạm vi hàng hoá/dịch vụ được giảm xác định theo từng mặt hàng, chưa mô hình hoá nên mặc định không giảm.
5. **Làm tròn**: đơn vị làm tròn (đồng) và việc làm tròn theo từng nhóm rồi cộng lại.
6. **Doanh thu tính thuế** là toàn bộ số tiền thu của khách (gồm thuế đã thu, phụ phí, sau chiết khấu); hàng trả lại được trừ vào kỳ có ngày trả hàng.
7. **Bán chịu / thu chưa đủ** được ghi doanh thu tại ngày bán.
8. **Xếp nhóm ngành nghề theo mẫu ngành**: dịch vụ ăn uống (cà phê, nhà hàng) và tiệm bánh tự sản xuất vào nhóm (3); karaoke/bida, spa/salon vào nhóm (2); bán lẻ hàng hoá vào nhóm (1); bảng `INDUSTRY_DEFAULTS`.
9. **Mặt hàng dịch vụ** (`item_kind = service`) mặc định vào nhóm (2); dịch vụ gắn với bán hàng hoá có thể thuộc nhóm (3).
10. **Phụ phí** (phí giao hàng, phí phục vụ) mặc định theo nhóm mặc định của cửa hàng.
11. **Bố cục mẫu S1-HKD** (Thông tư 88/2021/TT-BTC): ký hiệu cột A–E và 1–4, dòng tiêu đề, ô ký tên; và việc ghi **mỗi ngày một dòng** từ bảng kê bán hàng thay vì từng hoá đơn.

## API (chủ cửa hàng, cần đăng nhập)

| Phương thức | Đường dẫn | Ghi chú |
|---|---|---|
| GET | `/api/shop/tax-ledger?period=2026-10` | `period`: `YYYY-MM`, `YYYY-Qn`, `YYYY`; `detail=day` (mặc định) hoặc `sale` |
| GET | `/api/shop/tax-ledger/export.csv?period=…` | `sep=semicolon` để dùng dấu chấm phẩy |
| GET | `/api/shop/tax-ledger/export.html?period=…` | Trang in A4 độc lập |
| GET | `/api/shop/tax-ledger/settings` | Danh mục và nhóm đang áp dụng |
| PUT | `/api/shop/tax-ledger/settings` | `{ defaultGroup?, chargeGroup?, categoryGroups?: [{ key, name?, group }] }`; `group: null` trả về mặc định |

Cửa hàng luôn lấy từ phiên đăng nhập (`req.account.tenantId`), không bao giờ từ URL hay nội dung yêu cầu.

## Mã nguồn

- `apps/control-plane/src/tax-ledger-config.js` – bảng cấu hình thuế, nhóm theo ngành, bố cục S1-HKD
- `apps/control-plane/src/tax-ledger.js` – kỳ, xếp nhóm, ghi sổ, tổng hợp, làm tròn, đọc dữ liệu cửa hàng
- `apps/control-plane/src/tax-ledger-export.js` – CSV và trang in HTML
- `apps/control-plane/src/tax-ledger-router.js` – Express router
- `apps/control-plane/public/so-sach.html`, `so-sach.js`, `so-sach.css` – giao diện
- `apps/control-plane/test/tax-ledger.test.js` – kiểm thử
