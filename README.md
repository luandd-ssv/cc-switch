# cc-switch

Bạn có nhiều tài khoản Claude Code và ngán cảnh đăng nhập lại mỗi lần đổi qua đổi lại? `cc-switch` giải quyết đúng việc đó: gõ một lệnh, chuyển tài khoản, không cần xác thực lần nữa.

Mỗi tài khoản giữ một `CLAUDE_CONFIG_DIR` riêng, nên credentials của tài khoản này không lẫn vào tài khoản kia. Thư mục `agents/`, `skills/`, và — mặc định — cả lịch sử hội thoại vẫn trỏ chung về `~/.claude`, nên bạn mang theo toàn bộ setup của mình sang bất kỳ tài khoản nào đang dùng.

Bản hiện tại chỉ nói chuyện với Claude Code (Anthropic). Kế hoạch nối thêm DeepSeek đang tạm gác lại, chưa bỏ hẳn.

## Cài đặt

```bash
npm install -g cc-switch
```

Máy bạn cần có sẵn `claude` (gói `@anthropic-ai/claude-code`), nằm trong PATH.

## Cách dùng

```bash
cc-switch add personal
cc-switch add work

cc-switch list

cc-switch use work

cc-switch run
cc-switch run -- --continue

cc-switch current
cc-switch remove work
```

`add` tạo tài khoản mới; lần đầu bạn `run` nó, Claude Code sẽ hỏi đăng nhập OAuth như bình thường. Các lần sau, chỉ cần `use` rồi `run`.

## Chia sẻ lịch sử hội thoại

Thêm một tài khoản, `cc-switch` nối `~/.claude/projects` — nơi Claude Code cất transcript của mọi phiên làm việc — vào tài khoản đó. Vậy nên `claude --continue` hay `--resume` cho ra cùng một lịch sử, bất kể bạn đang đứng ở tài khoản nào.

Muốn tách riêng, thêm `--no-share-history`:

```bash
cc-switch add work --no-share-history
```

Dùng cờ này cho tài khoản cần giữ lịch sử dự án kín — chẳng hạn một identity riêng cho khách hàng. Credentials (`.credentials.json`, `.claude.json`) thì luôn tách biệt theo từng tài khoản, cờ này bật hay tắt không ảnh hưởng.

## Cơ chế hoạt động

`cc-switch run` tìm tài khoản đang active rồi khởi chạy `claude` với `CLAUDE_CONFIG_DIR` trỏ vào `~/.cc-switch/accounts/<name>/claude-home`. Vì mỗi thư mục này độc lập, Claude Code cache credentials riêng cho từng tài khoản — quay lại một tài khoản đã dùng, bạn không phải đăng nhập lần hai.

## Ghi chú

Metadata từng tài khoản nằm ở `~/.cc-switch/accounts/<name>/account.json`. Bản này mới hỗ trợ một provider (Anthropic) và chưa có dashboard theo dõi usage.

Tên tài khoản chỉ có ý nghĩa trên máy đang chạy — không đồng bộ giữa các máy. Hai đồng nghiệp cùng đặt tên "work" thì đó vẫn là hai tài khoản hoàn toàn độc lập, mỗi người tự trỏ vào Claude Code identity của riêng mình.

Muốn đóng góp hoặc phát hành bản mới, xem [CONTRIBUTING.md](CONTRIBUTING.md).
