# HiTechPOS – hướng dẫn cho trợ lý lập trình

- Mã HiTechPOS nằm ở `apps/` và `packages/`. Node ≥ 22, CommonJS, `'use strict'`, test bằng `node --test`.
- Gói trong `packages/` không có dependency runtime ngoài các gói `@hitechpos/*`.
- Chuỗi hiển thị cho người dùng viết tiếng Việt có dấu; comment code bằng tiếng Anh.
- Tiền luôn là số nguyên VND. Không tự retry lệnh tạo thanh toán. Mọi thay đổi trạng thái thanh toán đi qua `createJournal().apply()`.
- `upstream/` là mã Posnic được nhập bằng `git subtree --squash`. Các tệp `AGENTS.md`/`CLAUDE.md` trong đó là quy tắc đóng góp ngược về dự án Posnic, áp dụng khi gửi thay đổi lên Posnic; hạn chế sửa `upstream/` – ưu tiên mở rộng ở `apps/`/`packages/` và ghi lại mọi bản vá vào `docs/UPSTREAM.md`.
- Hợp đồng giữa control plane và Posnic shard: collection `tenants` và phong bì secret `v1:iv:tag:ct` (xem `apps/control-plane/src/secrets.js`, `upstream/pos/api/shard.js`). Thay đổi một bên phải giữ test `apps/control-plane/test/secrets.test.js` xanh.
