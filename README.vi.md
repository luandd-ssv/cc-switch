<div align="center">

# cc-switch

**Một CLI cho nhiều tài khoản Claude Code — chuyển ngay lập tức, không cần đăng nhập lại.**

Tạo bao nhiêu tài khoản tùy ý, đăng nhập một lần cho mỗi tài khoản, rồi chuyển qua lại chỉ với một lệnh.
Agents, skills và lịch sử hội thoại vẫn dùng chung; chỉ credentials là tách riêng.

[![npm](https://img.shields.io/npm/v/%40luandd-ssv%2Fcc-switch?color=cb3837&logo=npm)](https://www.npmjs.com/package/@luandd-ssv/cc-switch)
[![CI](https://github.com/luandd-ssv/cc-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/luandd-ssv/cc-switch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-8b5cf6)
![Dependencies](https://img.shields.io/badge/runtime%20deps-1-10b981)

[English](README.md) | **Tiếng Việt**

</div>

```sh
# Nhiều tài khoản Claude Code — đăng nhập một lần cho mỗi tài khoản, chuyển mãi mãi
cc-switch add work && cc-switch add personal

cc-switch use work
cc-switch run --continue

cc-switch use personal
cc-switch run -p "review this PR"

cc-switch list
cc-switch status        # trạng thái đăng nhập, link chia sẻ, lần dùng gần nhất
```

| Bạn muốn… | Kịch bản lệnh |
|-----------|-----------------|
| Nhiều tài khoản Claude Code | `cc-switch add <name>` → `cc-switch use <name>` → `cc-switch run` |
| Chuyển tài khoản không phải đăng nhập lại | `cc-switch use <account khác>` |
| Tiếp tục phiên làm việc cũ | `cc-switch run -- --continue` (lịch sử dùng chung) |
| Xem nhanh tình trạng từng tài khoản | `cc-switch status` |
| Giữ riêng lịch sử của một tài khoản | `cc-switch add <name> --no-share-history` |

- 🔁 **Chuyển đổi đa tài khoản** — bao nhiêu định danh tùy ý; đăng nhập một lần, chuyển mãi mãi
- 🧰 **Chuyển tiếp toàn bộ tham số** — `cc-switch run [args...]` ≡ `claude [args...]` (`--continue`, `--resume`, `-p`, …)
- 🤝 **Không gian làm việc dùng chung** — agents, skills và lịch sử phiên vẫn link về `~/.claude` mặc định
- 📋 **Báo cáo trạng thái** — trạng thái đăng nhập, tình trạng link chia sẻ, lần hoạt động gần nhất cho từng tài khoản
- 🧹 **Cô lập theo thiết kế** — credentials của mỗi tài khoản nằm trong `CLAUDE_CONFIG_DIR` riêng, không đụng gì khác

---

## Mô hình hoạt động

```text
                    ┌───────────────────────────────────┐
                    │            Claude Code CLI         │
                    │   agents · skills · lịch sử phiên   │
                    └──────────────────┬──────────────────┘
                                       │  cc-switch run
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
        account: work             account: personal          account: client
      CLAUDE_CONFIG_DIR A       CLAUDE_CONFIG_DIR B       CLAUDE_CONFIG_DIR C
      (credentials riêng)       (credentials riêng)       (credentials riêng, lịch sử riêng)
```

Mỗi **account cc-switch** là một profile được đặt tên dưới `~/.cc-switch/accounts/<name>`.
Chuyển tài khoản chỉ đổi **credentials nào** mà `claude` dùng để chạy — không đụng đến agents, skills, hay (mặc định) lịch sử dự án.

| Thành phần | Dùng chung giữa các account? |
|-------|--------------------------|
| Credentials (`.credentials.json`, `.claude.json`) | Không — mỗi account một bộ riêng |
| `agents/`, `skills/` | Có, luôn luôn |
| Lịch sử phiên (`projects/`) | Có theo mặc định, tắt bằng `--no-share-history` |

---

## Cài đặt

```sh
npm install -g @luandd-ssv/cc-switch
```

**Yêu cầu:** Node 18+, cùng với [`claude`](https://claude.com/claude-code) (`@anthropic-ai/claude-code`) trong PATH. CI chạy bộ test trên Windows, macOS và Linux.

### Đọc trước nếu dùng macOS

Claude Code lưu credentials subscription trong macOS Keychain đã mã hóa, và `CLAUDE_CONFIG_DIR` không di chuyển được chúng — [tài liệu quản lý credentials](https://code.claude.com/docs/en/iam) của Anthropic chỉ đặt `.credentials.json` dưới config directory "trên Linux hoặc Windows". Vì vậy mọi account cc-switch trên macOS đều dùng chung một login Keychain. Settings, agents, skills và lịch sử hội thoại vẫn tách riêng theo từng account, nên việc cô lập credentials — lý do chính để dùng công cụ này — chỉ đúng trên Windows và Linux, không đúng trên macOS. `cc-switch status` sẽ nhắc lại lưu ý này khi chạy trên macOS.

---

## Bắt đầu nhanh

```sh
cc-switch add work          # Claude hỏi đăng nhập Anthropic ở lần chạy đầu
cc-switch add personal

cc-switch use work
cc-switch run                # đăng nhập lần đầu, các lần sau vào thẳng

cc-switch use personal       # chuyển — không cần đăng nhập lại khi quay về `work`
cc-switch run

cc-switch list
cc-switch status
```

`add` tạo một account. Lần `run` đầu tiên với account đó sẽ kích hoạt đăng nhập OAuth Claude Code bình thường; mọi lần `run` sau sẽ dùng lại credentials đã lưu. Mọi thứ sau `run` được chuyển tiếp nguyên vẹn sang `claude`, kể cả cụm từ có dấu ngoặc kép và đường dẫn chứa dấu cách:

```sh
cc-switch run -p "summarise the auth module"
cc-switch run --add-dir "C:\Program Files\my app"
```

`cc-switch run` thoát với đúng mã mà `claude` trả về, nên dùng được trong script và CI.

Muốn giữ riêng lịch sử hội thoại của một account thay vì dùng chung:

```sh
cc-switch add client --no-share-history
```

Credentials (`.credentials.json`, `.claude.json`) luôn tách riêng theo từng account, bất kể cờ này.

---

## Danh sách lệnh

| Lệnh | Mô tả |
|---------|-------------|
| `cc-switch add <name>` | Tạo một account (`--no-share-history` để giữ riêng lịch sử) |
| `cc-switch use <name>` | Đặt account đang hoạt động |
| `cc-switch run [claude args...]` (alias `code`) | Chạy `claude` với account đang hoạt động, mọi tham số được chuyển tiếp |
| `cc-switch list` | Liệt kê mọi account, `*` đánh dấu account đang hoạt động |
| `cc-switch current` | In tên account đang hoạt động |
| `cc-switch status` (alias `dashboard`) | Trạng thái đăng nhập, tình trạng link chia sẻ, lần hoạt động gần nhất của từng account |
| `cc-switch remove <name>` | Xóa một account (từ chối nếu đó là account đang hoạt động) |
| `cc-switch --version` | In phiên bản đang cài |

---

## Báo cáo trạng thái

```sh
cc-switch status
```

```text
platform       linux
config root    /home/you/.cc-switch
shared from    /home/you/.claude
claude binary  /usr/local/bin/claude
active account work

   ACCOUNT   HISTORY   LOGIN  LAST ACTIVE       SHARED LINKS
   client    isolated  no     never             agents:shared skills:shared
   personal  shared    yes    2026-08-12 09:31  agents:shared skills:shared projects:shared
*  work      shared    yes    2026-08-13 06:44  agents:shared skills:shared projects:shared
```

`LOGIN` đọc `.credentials.json` của từng account, nên cho biết account nào đã hoàn tất OAuth và account nào còn cần chạy `run` lần đầu. `SHARED LINKS` báo mỗi thư mục link là `shared`, `local` (thư mục thật bạn tự tạo), `unlinked`, `absent` (chưa có gì để link dưới `~/.claude`), hoặc `BROKEN`. Bất cứ điều gì cần chú ý sẽ in thành ghi chú bên dưới, kèm lệnh để sửa.

Thêm `--json` để lấy cùng dữ liệu đó cho script:

```sh
cc-switch status --json
```

Báo cáo đọc filesystem theo yêu cầu — không khởi động server hay tiến trình nền nào. Số lượng token và chi phí nằm ngoài phạm vi này, vì cc-switch không ghi lại cả hai.

---

## Cơ chế hoạt động

`cc-switch run` đọc account đang hoạt động rồi chạy `claude` với `CLAUDE_CONFIG_DIR` trỏ vào `~/.cc-switch/accounts/<name>/claude-home`. Claude Code lưu cache credentials trong thư mục đó, nên quay lại một account sẽ bỏ qua bước đăng nhập.

`~/.claude/agents`, `~/.claude/skills`, và — mặc định — `~/.claude/projects` (transcript phiên làm việc) được link vào `claude-home` của mọi account, nên `claude --continue` và `--resume` đều thấy cùng một lịch sử bất kể đang ở account nào. `use` và `run` làm mới các link này mỗi lần chuyển, nên một thư mục thêm vào dưới `~/.claude` sau này sẽ tự động được nhận diện; không bao giờ cần tạo lại account.

Trên macOS và Linux, `cc-switch` tự resolve `claude` trên PATH rồi spawn trực tiếp, truyền tham số dưới dạng danh sách — không qua shell trung gian. Trên Windows, npm cài `claude` dưới dạng shim `.cmd`, và Node từ chối spawn shim này nếu không qua shell; `cc-switch` tự dựng dòng lệnh `cmd.exe` và tự quote từng tham số, nên dấu cách, dấu gạch chéo ngược, và các ký tự như `&` hay `|` đến `claude` đúng như đã gõ thay vì bị tách tham số hoặc chạy lệnh thứ hai. Một giới hạn còn tồn tại: `cmd.exe` khai triển `%VAR%` trước khi shim chạy, nên tham số chứa `%PATH%` sẽ đến nơi ở dạng đã khai triển. Bản cài `claude.exe` gốc (native) tránh được đường này.

---

## Ghi chú

Metadata của từng account nằm ở `~/.cc-switch/accounts/<name>/account.json`. Thư mục account được tạo với quyền `0700`, vì Claude Code lưu credentials bên trong đó.

Bản phát hành này hỗ trợ một nhà cung cấp (Anthropic) và không có dashboard chi phí/sử dụng.

Tên account chỉ có ý nghĩa cục bộ trên máy, không đồng bộ đi đâu cả. Hai đồng nghiệp cùng đặt tên account là "work" vẫn là hai account độc lập, mỗi cái trỏ vào một định danh Claude Code riêng.

Xem [CONTRIBUTING.md](CONTRIBUTING.md) để đóng góp hoặc phát hành bản mới.

---

## Giấy phép

[MIT](LICENSE)
