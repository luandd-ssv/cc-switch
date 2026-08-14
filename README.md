<div align="center">

# cc-switch

**One CLI for many Claude Code accounts — switch instantly, no re-authentication.**

Create as many accounts as you need, log in once each, then jump between them with a single command.
Skills, agents, and conversation history stay shared; only credentials change.

[![npm](https://img.shields.io/npm/v/%40luandd-ssv%2Fcc-switch?color=cb3837&logo=npm)](https://www.npmjs.com/package/@luandd-ssv/cc-switch)
[![CI](https://github.com/luandd-ssv/cc-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/luandd-ssv/cc-switch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-8b5cf6)
![Dependencies](https://img.shields.io/badge/runtime%20deps-1-10b981)

**English** | [Tiếng Việt](README.vi.md)

</div>

```sh
# Multiple Claude Code accounts — login once per account, switch forever
cc-switch add work && cc-switch add personal

cc-switch use work
cc-switch run --continue

cc-switch use personal
cc-switch run -p "review this PR"

cc-switch list
cc-switch status        # login state, quota, shared-link health, last active
cc-switch dashboard     # same data as a local web page, with reset countdowns
```

| You want… | Command pattern |
|-----------|-----------------|
| Several Claude Code accounts | `cc-switch add <name>` → `cc-switch use <name>` → `cc-switch run` |
| Switch without re-login | `cc-switch use <other>` |
| Resume a past session | `cc-switch run -- --resume` (a picker; `--continue` jumps to the newest) |
| See account health at a glance | `cc-switch status` |
| Watch quota across accounts | `cc-switch dashboard` |
| Keep one account's history private | `cc-switch add <name> --no-share-history` |

- 🔁 **Multi-account switcher** — as many identities as you need; log in once, switch forever
- 🧰 **Full passthrough** — `cc-switch run [args...]` ≡ `claude [args...]` (`--continue`, `--resume`, `-p`, …)
- 🤝 **Shared workspace** — agents, skills, and session history stay linked to `~/.claude` by default
- 📊 **Quota per account** — 5-hour and 7-day utilization with exact reset countdowns, auto-refreshed from each account's own cache
- 🔔 **"Use this one next"** — the web dashboard notifies when a window is about to roll over with quota left in it
- 📋 **Status report** — login state, shared-link health, and last-active time for every account
- 🧹 **Isolated by design** — each account's credentials live in their own `CLAUDE_CONFIG_DIR`, nothing else touched

---

## Mental model

```text
                    ┌───────────────────────────────────┐
                    │          Claude Code CLI           │
                    │   agents · skills · session history │
                    └──────────────────┬──────────────────┘
                                       │  cc-switch run
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
         account: work            account: personal          account: client
      CLAUDE_CONFIG_DIR A       CLAUDE_CONFIG_DIR B       CLAUDE_CONFIG_DIR C
      (own credentials)         (own credentials)         (own credentials, isolated history)
```

Every **cc-switch account** is a named profile under `~/.cc-switch/accounts/<name>`.
Switching only changes **which credentials** `claude` runs with — not your agents, skills, or (by default) your project history.

| Piece | Shared across accounts? |
|-------|--------------------------|
| Credentials (`.credentials.json`, `.claude.json`) | No — one set per account |
| `agents/`, `skills/` | Yes, always |
| Session history (`projects/`) | Yes by default, opt out with `--no-share-history` |

---

## Install

```sh
npm install -g @luandd-ssv/cc-switch

# Already installed? Upgrade with @latest and check what you got:
npm install -g @luandd-ssv/cc-switch@latest
cc-switch --version
```

Upgrading touches only the CLI. Your accounts live in `~/.cc-switch` and are left alone, so you stay logged in.

**Requirements:** Node 18+, plus [`claude`](https://claude.com/claude-code) (`@anthropic-ai/claude-code`) on your PATH. CI runs the test suite on Windows, macOS, and Linux.

### Read this first on macOS

Claude Code stores subscription credentials in the encrypted macOS Keychain, and `CLAUDE_CONFIG_DIR` does not relocate them — Anthropic's [credential management docs](https://code.claude.com/docs/en/iam) place `.credentials.json` under the config directory "on Linux or Windows" only. Every cc-switch account on macOS therefore shares a single Keychain login. Settings, agents, skills, and conversation history still separate per account, so credential isolation — the reason to reach for this tool — holds on Windows and Linux, but not on macOS. `cc-switch status` repeats this caveat when it runs there.

---

## Quick start

```sh
cc-switch add work          # Claude prompts Anthropic login on first run
cc-switch add personal

cc-switch use work
cc-switch run                # logs in the first time, straight in after that

cc-switch use personal       # switch — no re-login for `work` when you come back
cc-switch run

cc-switch list
cc-switch status
```

`add` creates an account. The first `run` against it triggers the normal Claude Code OAuth login; every `run` after that reuses the cached credentials. Everything after `run` passes through to `claude` untouched, including quoted phrases and paths containing spaces:

```sh
cc-switch run -p "summarise the auth module"
cc-switch run --add-dir "C:\Program Files\my app"
```

`cc-switch run` exits with the code `claude` returned, so it composes in scripts and CI.

To keep one account's conversation history private instead of shared:

```sh
cc-switch add client --no-share-history
```

Credentials (`.credentials.json`, `.claude.json`) stay separate per account regardless of this flag.

---

## Commands

| Command | Description |
|---------|-------------|
| `cc-switch add <name>` | Create an account (`--no-share-history` to keep its history private) |
| `cc-switch use <name>` | Set the active account |
| `cc-switch run [claude args...]` (alias `code`) | Launch `claude` as the active account, all flags pass through |
| `cc-switch list` | List every account, `*` marks the active one |
| `cc-switch current` | Print the active account's name |
| `cc-switch status` | Login state, cached quota, shared-link health, and last-active time per account |
| `cc-switch dashboard` | Serve the same data as a local web page with reset countdowns and notifications |
| `cc-switch remove <name>` | Delete an account (refuses on the active one) |
| `cc-switch --version` | Print the installed version |

---

## Status report

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

QUOTA  (auto-refreshed via "claude -p /usage" when a cache is older than 3 min)
   ACCOUNT   PLAN    5H   7D   RESET IN  AS OF
   personal  max_5x  -    12%  -         09:31 (5h ago)
*  work      max_5x  59%  8%   42m       06:44 (12m ago)

1 suggestion:
  - Use work now: 5h window resets in 42m with only 59% used. Spend it before it rolls over.
```

`LOGIN` reads each account's `.credentials.json`, so it shows which accounts have finished OAuth and which still need a first `run`. `SHARED LINKS` reports each linked directory as `shared`, `local` (a real directory you created), `unlinked`, `absent` (nothing to link to under `~/.claude` yet), or `BROKEN`. Anything needing attention prints as a note underneath, with the command that fixes it.

Add `--json` to feed the same data to a script:

```sh
cc-switch status --json
```

The report reads the filesystem on request — it starts no server and no background process. If any account's quota cache is older than the staleness threshold (3 minutes by default — Claude Code has its own internal cooldown on actually re-fetching quota, and staying above it is what keeps a refresh meaningful), it first runs `claude -p "/usage"` for that account to bring it up to date; pass `--no-refresh` for an offline-only read, or `--stale-after <minutes>` to change the threshold. Values below 3 are raised to 3 — that cooldown is Claude Code's, not cc-switch's, and polling under it only produces refreshes that change nothing. The `QUOTA` header always states the threshold that was actually applied.

---

## Quota

Claude Code caches the rate-limit response it receives into `.claude.json`, and cc-switch gives every account its own copy of that file. Reading it is how `status` and `dashboard` show per-account quota **without spending quota to find out how much is left**.

A percentage can now go stale for at most a few minutes: whenever `status` or `dashboard` finds a cache older than the threshold, it runs `claude -p "/usage"` for that account, which is the same call that writes this cache in the first place. In testing that call reported no measurable quota cost and took a few seconds of wall time, but it *is* a real Claude Code process rather than a plain file read — if you would rather nothing ran on your behalf, `--no-refresh` keeps both commands to the on-disk cache, exactly as they behaved before. Accounts that are logged out are skipped, since there is nothing to refresh, and an account whose refresh fails is not retried until the staleness window has passed again.

Once a window's `resets_at` has passed, the cached percentage describes an allowance the server has already replaced, so it prints as `-` (`—` on the web page) instead of a stale number. The **countdown is exact either way**, because `resets_at` is an absolute timestamp.

`AS OF` says when each account's cache was last written — by the auto-refresh above, or by an ordinary `cc-switch run`. If a refresh runs but the timestamp doesn't move, cc-switch surfaces a note: that almost always means the account's saved login has expired and needs a fresh `cc-switch run`.

### Web dashboard

```sh
cc-switch dashboard              # http://127.0.0.1:6769/
cc-switch dashboard --port 8080 --open
```

The page shows a stat strip (accounts, active account, which account to use next, next 5-hour reset), a card per account with 5-hour and 7-day meters plus reset countdowns, an accounts table (plan, email, organization, login, history mode, link health), and the last session recorded per account — cost, input/output/cache tokens, and the models it used, all straight from `.claude.json`.

**Notifications.** The toggle in the header is **on by default**; browsers require a click before granting permission, so the page offers an *Allow notifications* button on first open. From then on it notifies when an account's **5-hour window is about to roll over with quota still unused** — the case where switching to that account first wastes nothing:

> **Use work now** — 5h window resets in 42m with only 59% used. Spend it before it rolls over.

A window crosses into "about to roll over" on the clock, not on a refresh, so the page decides every 30 seconds against its own clock. `--interval` governs something else: how often the page polls, and — since that poll is also the staleness threshold — how old a cache is allowed to get before that poll actively refreshes it via `claude -p "/usage"`. Each window notifies once (the dedupe key includes `resets_at`, so the next window notifies again), and an account that is logged out is never suggested — its leftover quota cannot be spent without a fresh login. Tune the rule, or turn the page into a faster-refreshing wallboard:

| Flag | Default | Meaning |
|------|---------|---------|
| `--port <n>` | `6769` | Port to listen on |
| `--host <addr>` | `127.0.0.1` | Loopback address to bind — `127.0.0.1`, `localhost` or `::1`; anything wider is refused |
| `--open` | off | Open the dashboard in your browser |
| `--interval <minutes>` | `3` | How often the page polls, and the staleness threshold for the active refresh that poll triggers |
| `--no-refresh` | off | Never actively refresh; only read whatever is already cached on disk |
| `--reset-within <minutes>` | `60` | Suggest an account whose 5-hour window resets within this long |
| `--headroom-below <percent>` | `70` | Only suggest an account that has used at most this much of the window |

Two limits, stated plainly: notifications need the tab open (there is no service worker and no background process), and the server serves loopback only, because the page reports the account holder's email, organization and project paths. It rejects requests carrying a non-local `Host` header — the header is what separates a genuine request from a name an attacker pointed at `127.0.0.1` — and `--host` refuses to bind anywhere but loopback, since a `Host` header is trivially forged by anything that is not a browser while a browser on another device would be refused anyway.

---

## How it works

`cc-switch run` reads the active account and launches `claude` with `CLAUDE_CONFIG_DIR` pointing at `~/.cc-switch/accounts/<name>/claude-home`. Claude Code caches credentials inside that directory, so returning to an account skips the login.

`~/.claude/agents`, `~/.claude/skills`, and — by default — `~/.claude/projects` (session transcripts) are linked into every account's `claude-home`, so `claude --continue` and `--resume` reach the same history no matter which account you're in. `use` and `run` refresh these links on every switch, so a directory added under `~/.claude` later gets picked up automatically; recreating the account is never required.

On macOS and Linux, `cc-switch` resolves `claude` on your PATH and spawns it, passing arguments as a list — no shell sits in between. On Windows, npm installs `claude` as a `.cmd` shim, and Node refuses to spawn one without a shell; `cc-switch` builds the `cmd.exe` command line itself and quotes each argument, so spaces, backslashes, and characters such as `&` or `|` reach `claude` as written instead of splitting the argument or running a second command. One limit survives: `cmd.exe` expands `%VAR%` before the shim starts, so an argument holding `%PATH%` arrives expanded. A native `claude.exe` install avoids that path.

---

## Notes

Per-account metadata lives in `~/.cc-switch/accounts/<name>/account.json`. Account directories are created with `0700` permissions, since Claude Code stores its credentials inside them.

This release supports one provider (Anthropic). The dashboard reports quota and the last session Claude Code recorded per account; it does not scan session transcripts, so lifetime token totals and 30-day spend charts sit outside its scope.

Account names stay local to the machine and sync nowhere. Two colleagues each naming an account "work" still hold two independent accounts, each pointing at its own Claude Code identity.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute or cut a release.

---

## License

[MIT](LICENSE)
