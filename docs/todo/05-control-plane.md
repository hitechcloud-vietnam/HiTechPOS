# 05 – Control plane (`apps/control-plane`)

## 5.1 Onboarding tạo bàn/phòng mẫu cho karaoke/bida
- `packages/industry-presets` đã có `sampleTables` và `sampleTablePayloads(id, itemIds)`; `src/onboarding.js` chưa gọi. Thêm bước gọi `POST /api/setting/addTableOrderData` của shard với tư cách chủ shop sau bước tạo mặt hàng, ghi kết quả vào `tenant.onboarding`.

## 5.2 Đại lý (`src/partners.js`)
- Hoàn tiền chưa có trạng thái trong journal thanh toán → đảo hoa hồng phải làm tay qua `/reverse`.
- Hai lần thanh toán mở cùng lúc trước khi trả đều được giảm giá kỳ đầu.
- Đếm “N tháng đầu” dựa trên `payments.list` (giới hạn 200 dòng ở Mongo).
- Mã giới thiệu chưa hiển thị trong `/account` của chủ shop.

## 5.3 Sổ sách thuế (`src/tax-ledger*.js`)
- Chưa có index cho truy vấn đơn bán theo thời gian → báo cáo cả năm của shop lớn có thể chậm: thêm index trong DB shop (`sales`: `sales_date`, `status`).
- Chưa xuất XLSX (cần bộ ghi zip nhỏ, không thêm dependency).
- Danh sách 11 điểm cần kế toán xác nhận: `docs/SO-SACH-THUE.md`.

## 5.4 Đăng nhập app Business qua Cloud (`src/business-cloud.js`)
- Ánh xạ chủ shop → user Posnic bằng email, ghim vào `tenant.businessOwnerUserId` lần đầu. Nên ghi id này ngay lúc cài đặt (trình cài đặt Posnic `/api/install/add` cần trả về id).
- Giả định control plane với tới DB của mọi shop (cùng cụm Mongo). Khi tách shard ra cụm khác cần đường gọi qua shard thay cho `shopBridge`.
- Mục 5 của hợp đồng (`/api/mobile/*` cho Captain và Mobile POS) chưa làm: `upstream/business/docs/HITECHPOS_SERVER_CONTRACT.md`.

## 5.5 Gỡ route cũ
- `POST /api/admin/tenants/:id/suspend|resume` cũ không ghi nhật ký; trang quản trị mới đã dùng `/api/admin/tenants/:id/actions/*`. Gỡ route cũ sau khi kiểm tra không còn ai gọi.
