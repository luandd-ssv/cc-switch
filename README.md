# cc-switch

Run several Claude Code accounts on one machine and switch between them with a single command. No re-authentication.

Each account gets its own `CLAUDE_CONFIG_DIR`, so credentials never mix. Your `agents/`, `skills/`, and by default your conversation history stay linked to `~/.claude`, so your setup follows you into whichever account you are using.

The tool talks to Claude Code (Anthropic). DeepSeek support sits on the shelf rather than cancelled.

## Install

```bash
npm install -g cc-switch
```

You need Node 18 or newer, plus `claude` (the `@anthropic-ai/claude-code` package) on your PATH. CI runs the test suite on Windows, macOS, and Linux.

### Read this first on macOS

Claude Code stores subscription credentials in the encrypted macOS Keychain, and `CLAUDE_CONFIG_DIR` does not relocate them. Anthropic's [credential management docs](https://code.claude.com/docs/en/iam) place `.credentials.json` under the config directory "on Linux or Windows" only. Every cc-switch account on macOS therefore shares a single Keychain login. Settings, agents, skills, and conversation history still separate per account, so the identity behind the requests stays the same. Credential isolation, the reason to reach for this tool, holds on Windows and Linux. `cc-switch status` repeats this caveat when it runs on macOS.

## Usage

```bash
cc-switch add personal
cc-switch add work

cc-switch list
cc-switch status
cc-switch use work

cc-switch run
cc-switch run -- --continue

cc-switch current
cc-switch remove work
```

`add` creates an account. The first `run` against it triggers the normal Claude Code OAuth login. After that, `use` then `run`.

Everything after `run` passes through to `claude` untouched, including quoted phrases and paths containing spaces:

```bash
cc-switch run -p "summarise the auth module"
cc-switch run --add-dir "C:\Program Files\my app"
```

`cc-switch run` exits with the code `claude` returned, so it composes in scripts and CI.

## Status dashboard

`cc-switch status` (aliased to `cc-switch dashboard`) shows the state of every account in one screen:

```
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

`LOGIN` reads the per-account `.credentials.json`, so it tells you which accounts have finished their OAuth login and which still need a first `run`. `SHARED LINKS` reports each linked directory as `shared`, `local` (a real directory you created), `unlinked`, `absent` (nothing to link to under `~/.claude` yet), or `BROKEN`. Anything needing attention prints as a note underneath, along with the command that fixes it.

Add `--json` to feed the same data to a script:

```bash
cc-switch status --json
```

The report reads the filesystem on request and starts no server or background process. Token counts and spend sit outside its scope, since cc-switch records neither.

## Sharing conversation history

`cc-switch` links `~/.claude/projects`, the directory holding Claude Code session transcripts, into each account. `claude --continue` and `--resume` then reach the same history from any account.

To seal an account's history off, pass `--no-share-history`:

```bash
cc-switch add work --no-share-history
```

Reach for the flag on an account that needs its project history private, such as a dedicated client identity. Credentials (`.credentials.json`, `.claude.json`) stay separate per account regardless of the flag.

`use` and `run` refresh these links, so a directory you add under `~/.claude` later gets picked up on the next switch. Recreating the account is never required.

## How it works

`cc-switch run` reads the active account and launches `claude` with `CLAUDE_CONFIG_DIR` pointing at `~/.cc-switch/accounts/<name>/claude-home`. Claude Code caches credentials inside that directory, so returning to an account skips the login.

On macOS and Linux, `cc-switch` resolves `claude` on your PATH and spawns it, passing arguments as a list. No shell sits in between.

On Windows, npm installs `claude` as a `.cmd` shim, and Node refuses to spawn one without a shell. `cc-switch` builds the `cmd.exe` command line itself and quotes each argument, so spaces, backslashes, and characters such as `&` or `|` reach `claude` as written instead of splitting the argument or running a second command. One limit survives: `cmd.exe` expands `%VAR%` before the shim starts, so an argument holding `%PATH%` arrives expanded. A native `claude.exe` install avoids that path.

## Notes

Per-account metadata lives in `~/.cc-switch/accounts/<name>/account.json`. Account directories are created with `0700` permissions, since Claude Code stores its credentials inside them.

This release supports one provider (Anthropic) and ships no usage dashboard.

Account names stay local to the machine and sync nowhere. Two colleagues each naming an account "work" still hold two independent accounts, each pointing at its own Claude Code identity.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute or cut a release.
