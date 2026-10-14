# HiTechPOS

**Nền tảng POS SaaS đa ngành cho thị trường Việt Nam** – phát triển bởi HiTechCloud-VN / Phố Tuệ Software Solutions JSC, xây dựng trên mã nguồn mở [Posnic](https://github.com/Posnic) (AGPL-3.0).

- ☁️ **SaaS đa cửa hàng**: mỗi cửa hàng một tên miền `ten-cua-hang.hitechpos.vn` và một cơ sở dữ liệu riêng, phục vụ bởi *Posnic shard* (một tiến trình – nhiều cửa hàng).
- 💳 **Thanh toán Việt Nam**: [payOS](https://payos.vn/docs/), [Pay2S](https://docs.pay2s.vn), VietQR NAPAS 247 – cho cả phí thuê bao và **thanh toán tại quầy** (tiền về thẳng tài khoản shop, tự xác nhận qua biến động số dư Pay2S), tích hợp sẵn ô QR của màn hình bán hàng.
- 🧾 **Hoá đơn điện tử**: Viettel S-Invoice, MISA meInvoice, Mắt Bão; hoá đơn khởi tạo từ máy tính tiền; không bao giờ phát hành trùng.
- 🏪 **Đa ngành nghề**: 15 mẫu ngành dựng sẵn (tạp hóa, cà phê, nhà hàng, karaoke/bida, thời trang, nhà thuốc, điện thoại, spa, VLXD, mẹ & bé, mỹ phẩm, tiệm bánh, nhà sách, nông sản, bán lẻ khác).
- 🇻🇳 **Địa phương hoá**: định dạng VND, đọc số tiền bằng chữ, thuế GTGT 0/5/8/10/KCT/KKKNT, MST, số điện thoại, 34 tỉnh/thành sau sáp nhập 2025, danh sách ngân hàng NAPAS.

## Cấu trúc kho mã

```
apps/
  control-plane/        Đăng ký cửa hàng, gói cước, thanh toán, cấp phát tenant (Express + MongoDB)
packages/
  payment-core/         Hợp đồng cổng thanh toán + sổ nhật ký giao dịch (idempotent, chống thanh toán thiếu)
  payment-payos/        Adapter payOS (chữ ký đối chiếu SDK chính thức)
  payment-pay2s/        Adapter Pay2S (IPN, m2signature)
  vietqr/               Sinh/giải mã mã VietQR EMVCo, CRC16
  vn-locale/            Tiền tệ, số thành chữ, VAT, MST, SĐT, tỉnh/thành, ngân hàng
  industry-presets/     Mẫu ngành nghề → cấu hình Posnic
  einvoice-vn/          Hoá đơn điện tử: mô hình chuẩn + Viettel / MISA / Mắt Bão
upstream/               Mã nguồn Posnic (git subtree --squash)
  pos/                  Posnic POS: API Express + MongoDB, giao diện web, ứng dụng desktop, shard.js
  mobile-app/           POS di động (React Native/Expo)
  captain/              Ứng dụng gọi món cho phục vụ (Capacitor)
  business/             Ứng dụng chủ cửa hàng (React Native/Expo)
  extension-dojo/       Mẫu extension thanh toán của Posnic
docs/                   Kiến trúc, lộ trình, giấy phép, triển khai
deploy/                 docker-compose tham khảo
```

## Chạy thử

Yêu cầu Node.js ≥ 22.

```sh
npm install
npm test                                  # ~140 test, không cần mạng/CSDL
STORE=memory npm run start:control-plane  # http://127.0.0.1:4100 – đăng ký, /account – quản lý cửa hàng
```

Chạy đầy đủ (MongoDB + Posnic shard + control plane) xem [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Tài liệu

- [Kiến trúc](docs/ARCHITECTURE.md)
- [Lộ trình phát triển](docs/ROADMAP.md)
- [Giấy phép & tuân thủ AGPL](docs/LICENSING.md)
- [Triển khai](docs/DEPLOYMENT.md)
- [Đồng bộ mã nguồn Posnic](docs/UPSTREAM.md)

## Giấy phép

AGPL-3.0-only, kế thừa từ Posnic. Vì HiTechPOS cung cấp phần mềm qua mạng (SaaS), **người dùng phải được truy cập mã nguồn tương ứng** – xem [docs/LICENSING.md](docs/LICENSING.md).
