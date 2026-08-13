# Changelog

## 0.2.0 — 2026-08-13

### Added

- `cc-switch status` reports every account in one screen: login state, history mode, last activity, and the state of each shared link. Problems print as notes with the command that fixes them. `--json` emits the same data for scripts. The report reads the filesystem on request and starts no server.
- Per-account quota. `status` gained a `QUOTA` block showing 5-hour and 7-day utilization, the countdown to each reset, and when that account last refreshed its own cache. Claude Code writes the rate-limit response into `.claude.json`, and every cc-switch account owns a copy, so this costs no API call and spends no quota. A percentage whose window has already rolled over prints as `-` rather than as a current figure; the countdown stays exact because `resets_at` is absolute.
- `cc-switch dashboard` serves that data as a local web page: quota meters per account, an accounts table with plan/email/organization, and the last session Claude Code recorded per account (cost, tokens, models). Flags: `--port`, `--host`, `--open`, `--interval`, `--reset-within`, `--headroom-below`. The page reports the account holder's email, organization and project paths, so the server refuses any request whose `Host` header is not local, and `--host` accepts loopback addresses only: a `Host` header is trivially forged by anything that is not a browser, and a browser on another device would be refused regardless, so a wider bind would open the port without making the page reachable.
- Browser notifications on the dashboard, on by default. An account is suggested when its 5-hour window resets within 60 minutes while at most 70% of it has been used — the case where spending it first wastes nothing. The page evaluates that against its own clock every 30 seconds, so the alert does not wait on the hourly re-read of `.claude.json`; `--interval` governs only that re-read. Each window notifies once, and a logged-out account is never suggested. Notifications need the tab open; there is no service worker and no background process.
- `cc-switch --version`.
- CI runs the suite on macOS alongside Windows and Linux.

### Changed

- `cc-switch dashboard` is now the web dashboard rather than an alias for `cc-switch status`. Use `cc-switch status` for the terminal report.

### Fixed

- Arguments reach `claude` intact on Windows. The previous `shell: true` spawn concatenated argv without escaping, so `cc-switch run -p "explain this repo"` arrived as three separate arguments, paths containing spaces broke, and an argument holding `&` or `|` ran a second command. `cc-switch` now resolves the binary itself and quotes each argument for `cmd.exe`.
- `cc-switch run` reports a signal-killed `claude` as `128 + signal` rather than success, so `cc-switch run … && next-step` no longer continues after a crash.
- `use` and `run` re-apply the shared links. Running `cc-switch add` before `~/.claude` existed used to leave an account with nothing shared and no way to repair it short of deleting and re-adding.
- A shared link whose target has moved away is rebuilt instead of being treated as healthy. Detecting this needed `fs.stat` in place of `fs.access`, which succeeds on a Windows junction pointing at a deleted directory.
- `cc-switch remove <name>` fails on an unknown account instead of printing `Removed account …` and exiting 0.
- A `name` field inside `account.json` no longer overrides the directory it lives in, which could point an account at another account's `CLAUDE_CONFIG_DIR`.
- `cc-switch add` writes `account.json` after building the workspace, so a failure part-way leaves nothing behind and the command can be re-run.
- Account directories are created with mode `0700`, since Claude Code writes its credentials inside them.
- Resolving `claude` on PATH now requires a real, executable file, and accepts quoted PATH entries such as `"C:\Program Files\x"`.

### Documented

- Claude Code stores subscription credentials in the macOS Keychain, and `CLAUDE_CONFIG_DIR` does not relocate them. Accounts on macOS therefore share one login, and isolation covers settings and history only. Credential isolation holds on Windows and Linux. `cc-switch status` repeats the caveat on macOS.
- `cmd.exe` expands `%VAR%` before the npm shim starts, so an argument containing `%PATH%` arrives expanded on Windows. A native `claude.exe` install avoids that path.

## 0.1.0

- First release. Manage several Claude Code accounts (`add`, `list`, `use`, `current`, `remove`, `run`), each with its own `CLAUDE_CONFIG_DIR`, so switching skips re-authentication.
- Share `agents/`, `skills/`, and conversation history (`~/.claude/projects`) across accounts by default. `--no-share-history` keeps an account's history to itself.
- Report a clear message when `claude` is missing from PATH instead of failing obscurely.
