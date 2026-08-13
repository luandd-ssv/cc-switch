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
cc-switch status        # đăng nhập, quota, link chia sẻ, lần dùng gần nhất
cc-switch dashboard     # cùng dữ liệu đó dưới dạng web, kèm đếm ngược tới mốc reset
```

| Bạn muốn… | Kịch bản lệnh |
|-----------|-----------------|
| Nhiều tài khoản Claude Code | `cc-switch add <name>` → `cc-switch use <name>` → `cc-switch run` |
| Chuyển tài khoản không phải đăng nhập lại | `cc-switch use <account khác>` |
| Tiếp tục phiên làm việc cũ | `cc-switch run -- --resume` (hiện danh sách; `--continue` vào thẳng phiên mới nhất) |
| Xem nhanh tình trạng từng tài khoản | `cc-switch status` |
| Theo dõi quota của mọi tài khoản | `cc-switch dashboard` |
| Giữ riêng lịch sử của một tài khoản | `cc-switch add <name> --no-share-history` |

- 🔁 **Chuyển đổi đa tài khoản** — bao nhiêu định danh tùy ý; đăng nhập một lần, chuyển mãi mãi
- 🧰 **Chuyển tiếp toàn bộ tham số** — `cc-switch run [args...]` ≡ `claude [args...]` (`--continue`, `--resume`, `-p`, …)
- 🤝 **Không gian làm việc dùng chung** — agents, skills và lịch sử phiên vẫn link về `~/.claude` mặc định
- 📊 **Quota theo từng tài khoản** — mức dùng khung 5 giờ và 7 ngày kèm đếm ngược chính xác tới mốc reset, đọc từ cache của chính tài khoản đó
- 🔔 **"Nên dùng tài khoản này"** — dashboard web thông báo khi một khung 5 giờ sắp trôi qua mà quota vẫn còn
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

# Đã cài rồi? Nâng cấp bằng @latest rồi kiểm tra lại:
npm install -g @luandd-ssv/cc-switch@latest
cc-switch --version
```

Nâng cấp chỉ thay phần CLI. Các account nằm trong `~/.cc-switch` và không bị chạm tới, nên bạn vẫn đang đăng nhập như cũ.

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
| `cc-switch status` | Trạng thái đăng nhập, quota trong cache, tình trạng link chia sẻ, lần hoạt động gần nhất của từng account |
| `cc-switch dashboard` | Mở trang web local với cùng dữ liệu đó, kèm đếm ngược mốc reset và thông báo |
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

QUOTA  (read from each account's cache, no API calls)
   ACCOUNT   PLAN    5H   7D   RESET IN  AS OF
   personal  max_5x  -    12%  -         09:31 (5h ago)
*  work      max_5x  59%  8%   42m       06:44 (12m ago)

1 suggestion:
  - Use work now: 5h window resets in 42m with only 59% used. Spend it before it rolls over.
```

`LOGIN` đọc `.credentials.json` của từng account, nên cho biết account nào đã hoàn tất OAuth và account nào còn cần chạy `run` lần đầu. `SHARED LINKS` báo mỗi thư mục link là `shared`, `local` (thư mục thật bạn tự tạo), `unlinked`, `absent` (chưa có gì để link dưới `~/.claude`), hoặc `BROKEN`. Bất cứ điều gì cần chú ý sẽ in thành ghi chú bên dưới, kèm lệnh để sửa.

Thêm `--json` để lấy cùng dữ liệu đó cho script:

```sh
cc-switch status --json
```

Báo cáo đọc filesystem theo yêu cầu — không khởi động server hay tiến trình nền nào.

---

## Quota

Claude Code lưu lại phản hồi giới hạn (rate limit) mà nó nhận được vào `.claude.json`, và cc-switch cho mỗi account một bản riêng của file đó. Đọc file này là cách `status` và `dashboard` hiện quota theo từng account mà **không gọi API nào, cũng không tốn quota chỉ để biết còn lại bao nhiêu**.

Điều đó có một hệ quả cần hiểu rõ: con số phần trăm chỉ mới đến lần chạy gần nhất của account đó. cc-switch không bao giờ trình bày số cũ như thể nó còn đúng — khi mốc `resets_at` của một khung đã trôi qua, phần trăm trong cache đang nói về một hạn mức mà server đã thay bằng hạn mức mới, nên nó in ra `-` (`—` trên trang web) thay vì con số cũ. **Phần đếm ngược thì luôn chính xác**, vì `resets_at` là mốc thời gian tuyệt đối.

`AS OF` cho biết mỗi account làm mới cache của nó lần cuối khi nào. Muốn làm mới thì phải chạy account đó (`cc-switch use <name> && cc-switch run`) — theo thiết kế, không có cách nào khác.

### Dashboard web

```sh
cc-switch dashboard              # http://127.0.0.1:6769/
cc-switch dashboard --port 8080 --open
```

Trang gồm: dải thống kê (số account, account đang hoạt động, account nên dùng tiếp, mốc reset 5 giờ gần nhất), một card cho mỗi account với thanh đo khung 5 giờ và 7 ngày kèm đếm ngược, bảng account (gói, email, tổ chức, đăng nhập, chế độ lịch sử, tình trạng link), và phiên gần nhất của từng account — chi phí, token vào/ra/cache, model đã dùng, tất cả lấy trực tiếp từ `.claude.json`.

**Thông báo.** Nút bật/tắt trên header **mặc định là bật**; trình duyệt đòi phải có một cú click mới cấp quyền, nên lần đầu mở trang sẽ có nút *Allow notifications*. Sau đó trang thông báo khi một account **sắp hết khung 5 giờ mà quota vẫn còn chưa dùng** — đúng trường hợp mà chuyển sang account đó trước thì không bỏ phí gì:

> **Use work now** — 5h window resets in 42m with only 59% used. Spend it before it rolls over.

Một khung bước vào trạng thái "sắp hết" theo đồng hồ chứ không theo nhịp làm mới, nên trang tự quyết định mỗi 30 giây theo đồng hồ của chính nó, còn `--interval` chỉ quyết định bao lâu đọc lại phần trăm từ đĩa. Mỗi khung chỉ thông báo một lần (khóa chống trùng có chứa `resets_at`, nên khung kế tiếp lại thông báo bình thường), và account đã đăng xuất thì không bao giờ được gợi ý — quota còn lại của nó không tiêu được nếu chưa đăng nhập lại. Có thể điều chỉnh quy tắc, hoặc biến trang thành bảng theo dõi cập nhật nhanh hơn:

| Tham số | Mặc định | Ý nghĩa |
|------|---------|---------|
| `--port <n>` | `6769` | Cổng lắng nghe |
| `--host <addr>` | `127.0.0.1` | Địa chỉ loopback để bind — `127.0.0.1`, `localhost` hoặc `::1`; rộng hơn thì bị từ chối |
| `--open` | tắt | Mở dashboard trong trình duyệt |
| `--interval <minutes>` | `60` | Bao lâu trang đọc lại quota từ đĩa |
| `--reset-within <minutes>` | `60` | Gợi ý account có khung 5 giờ reset trong khoảng thời gian này |
| `--headroom-below <percent>` | `70` | Chỉ gợi ý account đã dùng tối đa mức này của khung |

Hai giới hạn, nói thẳng: thông báo cần giữ tab mở (không có service worker, không có tiến trình nền), và server chỉ phục vụ loopback, vì trang có hiện email, tổ chức và đường dẫn project của chủ tài khoản. Nó từ chối request mang `Host` không phải local — header đó là thứ phân biệt request thật với một tên miền mà kẻ tấn công trỏ về `127.0.0.1` — và `--host` không cho bind ra ngoài loopback, bởi header `Host` thì thứ gì không phải trình duyệt cũng giả được, còn trình duyệt trên máy khác thì đằng nào cũng bị từ chối.

---

## Cơ chế hoạt động

`cc-switch run` đọc account đang hoạt động rồi chạy `claude` với `CLAUDE_CONFIG_DIR` trỏ vào `~/.cc-switch/accounts/<name>/claude-home`. Claude Code lưu cache credentials trong thư mục đó, nên quay lại một account sẽ bỏ qua bước đăng nhập.

`~/.claude/agents`, `~/.claude/skills`, và — mặc định — `~/.claude/projects` (transcript phiên làm việc) được link vào `claude-home` của mọi account, nên `claude --continue` và `--resume` đều thấy cùng một lịch sử bất kể đang ở account nào. `use` và `run` làm mới các link này mỗi lần chuyển, nên một thư mục thêm vào dưới `~/.claude` sau này sẽ tự động được nhận diện; không bao giờ cần tạo lại account.

Trên macOS và Linux, `cc-switch` tự resolve `claude` trên PATH rồi spawn trực tiếp, truyền tham số dưới dạng danh sách — không qua shell trung gian. Trên Windows, npm cài `claude` dưới dạng shim `.cmd`, và Node từ chối spawn shim này nếu không qua shell; `cc-switch` tự dựng dòng lệnh `cmd.exe` và tự quote từng tham số, nên dấu cách, dấu gạch chéo ngược, và các ký tự như `&` hay `|` đến `claude` đúng như đã gõ thay vì bị tách tham số hoặc chạy lệnh thứ hai. Một giới hạn còn tồn tại: `cmd.exe` khai triển `%VAR%` trước khi shim chạy, nên tham số chứa `%PATH%` sẽ đến nơi ở dạng đã khai triển. Bản cài `claude.exe` gốc (native) tránh được đường này.

---

## Ghi chú

Metadata của từng account nằm ở `~/.cc-switch/accounts/<name>/account.json`. Thư mục account được tạo với quyền `0700`, vì Claude Code lưu credentials bên trong đó.

Bản phát hành này hỗ trợ một nhà cung cấp (Anthropic). Dashboard báo quota và phiên gần nhất mà Claude Code ghi lại cho từng account; nó không quét transcript phiên, nên tổng token trọn đời và biểu đồ chi phí 30 ngày nằm ngoài phạm vi.

Tên account chỉ có ý nghĩa cục bộ trên máy, không đồng bộ đi đâu cả. Hai đồng nghiệp cùng đặt tên account là "work" vẫn là hai account độc lập, mỗi cái trỏ vào một định danh Claude Code riêng.

Xem [CONTRIBUTING.md](CONTRIBUTING.md) để đóng góp hoặc phát hành bản mới.

---

## Giấy phép

[MIT](LICENSE)
