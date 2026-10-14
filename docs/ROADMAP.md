# Lộ trình HiTechPOS

## Giai đoạn 0 – Nền móng (hoàn thành trong PR này)
- [x] Nhập mã Posnic POS, Mobile App, Captain, Business, extension Dojo (`upstream/`, git subtree)
- [x] Control plane SaaS: đăng ký, tên miền con, gói cước VND, dùng thử 14 ngày, khoá khi hết hạn + thời gian ân hạn
- [x] Cấp phát tenant tương thích `shard.js` (kiểm thử chéo với mã Posnic)
- [x] Thanh toán thuê bao qua payOS và Pay2S, sổ nhật ký idempotent
- [x] VietQR ngoại tuyến, bộ địa phương hoá VN, 15 mẫu ngành nghề

## Giai đoạn 1 – Đưa vào vận hành thử (pilot)
- [ ] Đối chiếu hợp đồng Pay2S (trường ký, `resultCode`, phản hồi IPN) với tài khoản thật; chạy sandbox payOS/Pay2S
- [ ] Triển khai MongoDB replica set, shard, control plane, TLS wildcard `*.hitechpos.vn`, sao lưu
- [ ] Ghi `posnicModuleSettings` + nạp `sampleItems` tiếng Việt sau khi cài đặt cửa hàng
- [ ] Bản dịch `upstream/pos/languages/vi.json`: rà soát thuật ngữ bán lẻ VN; mặc định ngôn ngữ vi, tiền tệ VND, múi giờ Asia/Ho_Chi_Minh
- [ ] Mẫu hoá đơn K80/K58 tiếng Việt (số tiền bằng chữ, MST, VAT theo nhóm thuế suất)
- [ ] Trang quản trị nội bộ (danh sách tenant, khoá/mở, giao dịch cần review)
- [ ] Email/Zalo OA thông báo dùng thử sắp hết, gia hạn thành công

## Giai đoạn 2 – Thanh toán tại quầy
- [ ] Extension thanh toán Posnic cho payOS/Pay2S theo mô hình `upstream/extension-dojo` (POS tạo QR động, nhận webhook, chốt hoá đơn)
- [ ] VietQR tĩnh: chọn tài khoản ngân hàng của shop, đối soát thủ công
- [ ] Ví MoMo / ZaloPay / VNPay-QR (adapter mới trên `payment-core`)

## Giai đoạn 3 – Tuân thủ Việt Nam
- [ ] **Hoá đơn điện tử** (Nghị định 123/2020, 70/2025; Thông tư 78/2021, 32/2025): adapter nhà cung cấp (VNPT, Viettel, MISA, BKAV, EasyInvoice…), hoá đơn khởi tạo từ máy tính tiền
- [ ] Báo cáo thuế hộ kinh doanh (kê khai theo doanh thu), sổ sách theo Thông tư 88/2021
- [ ] Bảo vệ dữ liệu cá nhân (Nghị định 13/2023, Luật BVDLCN 2025): đồng ý, xuất/xoá dữ liệu khách hàng

## Giai đoạn 4 – Mở rộng ngành nghề (cờ `hitechExtension`)
- [ ] Bán theo đơn vị quy đổi (thùng/lốc/chai) với giá riêng
- [ ] Lô – hạn dùng, xuất FEFO, liên thông Cơ sở dữ liệu Dược quốc gia
- [ ] IMEI/serial, bảo hành, trả góp
- [ ] Tính tiền theo giờ (karaoke/bida), lịch hẹn – hoa hồng – thẻ liệu trình (spa)
- [ ] Định lượng nguyên liệu (F&B, tiệm bánh), đặt hàng trước có cọc, in tem ly
- [ ] Kết nối giao hàng GHN/GHTK/Ahamove, sàn TMĐT

## Giai đoạn 5 – Kinh doanh
- [ ] Đại lý/white-label (Posnic hỗ trợ brand-seed), tên miền riêng cho gói Doanh nghiệp
- [ ] API công khai, webhook cho đối tác
