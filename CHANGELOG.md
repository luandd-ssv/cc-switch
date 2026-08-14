# Changelog

## 0.3.0 — 2026-08-14

### Added

- Quota refreshes itself. Until now a percentage was only as fresh as that account's last run, so an account left alone for a day reported day-old numbers. `status` and `dashboard` now run `claude -p "/usage"` for any account whose cache is older than the staleness threshold — the same call that writes the cache in the first place — and read the result back. `--no-refresh` keeps either command to the on-disk cache exactly as before; `cc-switch status --stale-after <minutes>` moves the threshold.
- The threshold has a floor of 3 minutes. Claude Code has its own internal cooldown before it will re-fetch quota, so asking for less produces refreshes that change nothing and look indistinguishable from a failure. A lower `--stale-after` or `--interval` is raised to the floor, and both the `QUOTA` header and the dashboard footer state the threshold that was actually applied rather than the one requested.
- Refresh outcomes are reported rather than swallowed. A refresh that runs and leaves the cache untouched means the saved login has most likely expired — the child still exits cleanly, so nothing else would reveal it — and prints as a note naming the account. A non-zero exit is kept separate, since that points at the `claude` install rather than at any account's login. `--json` carries the same detail in `quotaRefresh` and `refreshed`.
- Refreshes are bounded on every axis: at most 3 run at once, each child is killed after 20 seconds (with its whole process tree, so a `.cmd` shim's child cannot outlive it), and the pass as a whole gives up after 25 seconds and leaves the rest for the next call. Overlapping callers — two dashboard tabs, a manual refresh landing mid-poll — join one attempt per account instead of each spawning their own.
- An account that fails to refresh is not retried until the staleness window has passed again. Staleness alone could not rate-limit this: an account with no cache at all has no timestamp to compare against, so a cache that never materialises would otherwise spawn a process on every single command and every poll.

### Changed

- The dashboard's `--interval` now defaults to 3 minutes rather than 60, and doubles as the staleness threshold: by the time a poll lands, the previous one has already made sure the cache is no older than that. Notification timing is unaffected — a window crosses into "about to roll over" on the clock, and the page still decides that every 30 seconds against its own.
- `LAST ACTIVE` follows real activity again. It used to include `.claude.json`'s mtime, which an automatic refresh rewrites every time it runs — that column would have read "just now" forever for any refreshed account. It now follows `history.jsonl` and the session start Claude Code records, and treats `.credentials.json` as a last-resort fallback only, since that file is rewritten whenever the OAuth token is rotated — something a refresh triggers on its own.
- `/api/status` performs a refresh only for requests the page itself made. The endpoint used to be a pure read, so a cross-origin `GET` — which needs no preflight and carries a loopback `Host` like any genuine request — was harmless; now that it can spawn processes, any page the user happened to visit could have triggered them. Cross-site callers still get the cached read.

### Fixed

- A report no longer mixes two clocks. Refreshing takes seconds, which left `generatedAt` stamped before the data it described: "as of" ages came out negative, and a window that rolled over mid-refresh still counted as fresh. The clock is re-stamped and every account re-read once a refresh has run, unless the caller pinned its own `now`.
- `Ctrl+C` on `cc-switch dashboard` exits promptly. The graceful close waits for in-flight responses, which can now be blocked on a refresh's child processes, so that wait has a 2-second deadline instead of the full refresh budget.

## 0.2.1 — 2026-08-13

### Documented

- How to upgrade an existing install. The Install section only showed the first install, so nothing told an existing user to pull a new version, or that upgrading leaves `~/.cc-switch` — and therefore their logins — untouched. Code is unchanged from 0.2.0; this release exists so the README on npm carries the note.

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
