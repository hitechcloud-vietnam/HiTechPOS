# Giấy phép & tuân thủ

> Tài liệu tóm tắt để định hướng kỹ thuật, không phải tư vấn pháp lý.

## AGPL-3.0-only
Toàn bộ mã Posnic là **AGPL-3.0-only**. HiTechPOS là tác phẩm phái sinh và phát hành cùng giấy phép (`LICENSE`). Hệ quả với mô hình SaaS:

- **Điều 13 (tương tác qua mạng)**: người dùng tương tác với HiTechPOS qua mạng phải được cung cấp *mã nguồn tương ứng* của phiên bản đang chạy, bao gồm mọi sửa đổi. Cách làm: kho mã công khai (hoặc trang tải mã nguồn) + liên kết “Mã nguồn” trong giao diện POS và control plane, gắn đúng commit đang triển khai.
- Không được thêm điều khoản hạn chế; giữ nguyên thông báo bản quyền Posnic.
- Có thể thu phí dịch vụ (hosting, hỗ trợ, thanh toán) – AGPL không cấm kinh doanh.
- Muốn đóng mã một phần cần thoả thuận cấp phép riêng với chủ sở hữu bản quyền Posnic.

## Thành phần bên thứ ba
- Gói cài đặt desktop Posnic đóng kèm **MongoDB Community Server (SSPL-1.0)**. SaaS HiTechPOS dùng MongoDB như CSDL nội bộ (không cung cấp MongoDB như một dịch vụ) – không phát sinh nghĩa vụ SSPL; nếu dùng MongoDB Atlas thì theo điều khoản Atlas.
- Xem `upstream/pos/THIRD-PARTY-NOTICES.md`.

## Thương hiệu
“Posnic” là thương hiệu của dự án Posnic. HiTechPOS dùng thương hiệu riêng; chỉ ghi “dựa trên Posnic” để ghi công.

## Pháp lý Việt Nam liên quan
- Thuế GTGT: sản phẩm/dịch vụ phần mềm thuộc diện không chịu thuế (cấu hình `SAAS_VAT_RATE=KCT`, cần kế toán xác nhận cho từng gói kèm phần cứng/dịch vụ khác).
- Hoá đơn điện tử cho phí thuê bao: phát hành qua nhà cung cấp HĐĐT của Phố Tuệ/HiTechCloud.
- Dữ liệu cá nhân của chủ shop và khách hàng cuối: Nghị định 13/2023/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân 2025.
