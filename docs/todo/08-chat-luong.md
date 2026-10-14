# 08 – Chất lượng, test, CI

- Bộ test node của Posnic (`cd upstream/pos && node --test "tests/*.test.js"`) có ~41 lỗi sẵn từ mã gốc (cash-tender/payment-integrity, logo ESC/POS, bản phát hành Mac, môi trường jsdom “vm.Context”). Chưa nằm trong CI. Sửa dần rồi thêm job CI.
- Hai test Posnic API đôi khi quá thời gian khi chạy song song trên máy tải cao: `captain-transfer.test.js` (afterAll), `offline-recovery.test.js` (5 s). `combined-seating-order.test.js` có lúc lỗi do tranh chấp đồng thời. Theo dõi trên CI; nếu lặp lại thì tăng timeout hoặc sửa điều kiện tranh chấp – không bỏ qua test.
- Job “Browser end-to-end” (`scripts/e2e-ui.mjs`) mới thêm: bật `E2E_UI_STRICT=1` trên CI khi mục 4.1 xong.
- Control plane: test Mongo thật chỉ chạy khi có `MONGO_TEST_URI`; cân nhắc thêm job CI có Mongo.
