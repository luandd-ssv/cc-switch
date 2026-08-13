# Changelog

## Unreleased

### Added

- `cc-switch status` (aliased to `cc-switch dashboard`) reports every account in one screen: login state, history mode, last activity, and the state of each shared link. Problems print as notes with the command that fixes them. `--json` emits the same data for scripts. The report reads the filesystem on request and starts no server.
- `cc-switch --version`.
- CI runs the suite on macOS alongside Windows and Linux.

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
