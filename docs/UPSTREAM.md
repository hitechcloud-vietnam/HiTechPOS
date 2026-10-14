# Đồng bộ mã nguồn Posnic

`upstream/` được nhập bằng `git subtree --squash` (không kéo lịch sử Posnic):

| Thư mục | Kho | Nhánh | Commit nhập |
|---|---|---|---|
| `upstream/pos` | https://github.com/Posnic/POS | develop | d57241e |
| `upstream/business` | https://github.com/Posnic/posnic-business | main | b3e3340 |
| `upstream/mobile-app` | https://github.com/Posnic/Mobile-App | main | 5052e7c |
| `upstream/captain` | https://github.com/Posnic/captain | main | 814f8cc |
| `upstream/extension-dojo` | https://github.com/Posnic/posnic-extension-dojo | main | 09aa373 |

Cập nhật:

```sh
git subtree pull --prefix upstream/pos https://github.com/Posnic/POS develop --squash
```

Quy tắc:
- Hạn chế sửa trực tiếp `upstream/`. Mỗi bản vá cục bộ phải ghi vào bảng dưới đây để khi `subtree pull` biết cần giữ gì; ưu tiên gửi bản vá ngược về Posnic.
- Sau mỗi lần cập nhật chạy `npm test` (test `secrets.test.js` đối chiếu trực tiếp `upstream/pos/api/shard.js`).

## Bản vá cục bộ

_(chưa có)_
