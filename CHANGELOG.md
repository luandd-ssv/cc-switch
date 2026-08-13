# Changelog

## 0.1.0

- Ra mắt bản đầu: quản lý nhiều tài khoản Claude Code (`add`/`list`/`use`/`current`/`remove`/`run`), mỗi tài khoản một `CLAUDE_CONFIG_DIR` riêng nên không phải đăng nhập lại.
- Mặc định chia sẻ `agents/`, `skills/`, và lịch sử hội thoại (`~/.claude/projects`) giữa các tài khoản; tắt phần lịch sử bằng `--no-share-history`.
- Thông báo rõ ràng thay vì lỗi khó hiểu khi không tìm thấy `claude` trên PATH.
