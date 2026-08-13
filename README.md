<div align="center">

# cc-switch

**One CLI for many Claude Code accounts — switch instantly, no re-authentication.**

Create as many accounts as you need, log in once each, then jump between them with a single command.
Skills, agents, and conversation history stay shared; only credentials change.

[![npm](https://img.shields.io/npm/v/cc-switch?color=cb3837&logo=npm)](https://www.npmjs.com/package/cc-switch)
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
cc-switch status        # login state, shared-link health, last active
```

| You want… | Command pattern |
|-----------|-----------------|
| Several Claude Code accounts | `cc-switch add <name>` → `cc-switch use <name>` → `cc-switch run` |
| Switch without re-login | `cc-switch use <other>` |
| Resume a past session | `cc-switch run -- --continue` (history is shared) |
| See account health at a glance | `cc-switch status` |
| Keep one account's history private | `cc-switch add <name> --no-share-history` |

- 🔁 **Multi-account switcher** — as many identities as you need; log in once, switch forever
- 🧰 **Full passthrough** — `cc-switch run [args...]` ≡ `claude [args...]` (`--continue`, `--resume`, `-p`, …)
- 🤝 **Shared workspace** — agents, skills, and session history stay linked to `~/.claude` by default
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
npm install -g cc-switch
```

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
| `cc-switch status` (alias `dashboard`) | Login state, shared-link health, and last-active time per account |
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
```

`LOGIN` reads each account's `.credentials.json`, so it shows which accounts have finished OAuth and which still need a first `run`. `SHARED LINKS` reports each linked directory as `shared`, `local` (a real directory you created), `unlinked`, `absent` (nothing to link to under `~/.claude` yet), or `BROKEN`. Anything needing attention prints as a note underneath, with the command that fixes it.

Add `--json` to feed the same data to a script:

```sh
cc-switch status --json
```

The report reads the filesystem on request — it starts no server and no background process. Token counts and spend sit outside its scope, since cc-switch records neither.

---

## How it works

`cc-switch run` reads the active account and launches `claude` with `CLAUDE_CONFIG_DIR` pointing at `~/.cc-switch/accounts/<name>/claude-home`. Claude Code caches credentials inside that directory, so returning to an account skips the login.

`~/.claude/agents`, `~/.claude/skills`, and — by default — `~/.claude/projects` (session transcripts) are linked into every account's `claude-home`, so `claude --continue` and `--resume` reach the same history no matter which account you're in. `use` and `run` refresh these links on every switch, so a directory added under `~/.claude` later gets picked up automatically; recreating the account is never required.

On macOS and Linux, `cc-switch` resolves `claude` on your PATH and spawns it, passing arguments as a list — no shell sits in between. On Windows, npm installs `claude` as a `.cmd` shim, and Node refuses to spawn one without a shell; `cc-switch` builds the `cmd.exe` command line itself and quotes each argument, so spaces, backslashes, and characters such as `&` or `|` reach `claude` as written instead of splitting the argument or running a second command. One limit survives: `cmd.exe` expands `%VAR%` before the shim starts, so an argument holding `%PATH%` arrives expanded. A native `claude.exe` install avoids that path.

---

## Notes

Per-account metadata lives in `~/.cc-switch/accounts/<name>/account.json`. Account directories are created with `0700` permissions, since Claude Code stores its credentials inside them.

This release supports one provider (Anthropic) and ships no usage/cost dashboard.

Account names stay local to the machine and sync nowhere. Two colleagues each naming an account "work" still hold two independent accounts, each pointing at its own Claude Code identity.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute or cut a release.

---

## License

[MIT](LICENSE)
