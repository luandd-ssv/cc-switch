# Đóng góp cho cc-switch

## Chạy thử cục bộ

```bash
npm install
npm test
npm link   # cài "cc-switch" global từ thư mục này để thử tay
```

## Test

Test dùng `node:test` — có sẵn trong Node, không kéo thêm dependency — nằm ở `test/*.test.js`. Mỗi test tự tạo một `$HOME`/`%USERPROFILE%` tạm (xem `test/helpers.js`), nên chạy test không đụng vào `~/.cc-switch` hay `~/.claude` thật trên máy bạn.

## Phát hành bản mới

1. Ghi lại thay đổi vào `CHANGELOG.md`.
2. `npm version patch|minor|major` — tự bump version trong `package.json`, tạo commit và tag git.
3. `git push --follow-tags`.
4. `npm publish` (cần `npm login` trước; nếu publish dưới scope riêng của công ty, thêm `--access restricted` hoặc trỏ registry nội bộ qua `.npmrc`).

## Quy ước

- Không thêm dependency ngoài trừ khi thật sự cần thiết — CLI này cố tình giữ nhẹ (hiện chỉ có `commander`).
- Tên account chỉ có ý nghĩa cục bộ trên máy đang chạy — hai người dùng cùng đặt tên "work" không liên quan gì đến nhau, không có đồng bộ giữa các máy.
