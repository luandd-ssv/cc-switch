# Contributing to cc-switch

## Run it locally

```bash
npm install
npm test
npm link   # installs "cc-switch" globally from this directory for hands-on testing
```

`npm unlink -g cc-switch` removes the global link again.

## Tests

Tests live in `test/*.test.js` and run on `node:test`, which ships with Node and pulls in no dependency. Each test points `$HOME` and `%USERPROFILE%` at a scratch directory (see `test/helpers.js`), so running the suite leaves the real `~/.cc-switch` and `~/.claude` untouched.

`test/e2e-run.test.js` stands up a fake `claude` on a scratch PATH and checks that arguments survive the launch. Launching is the one part that differs per platform: an npm `.cmd` shim through `cmd.exe` on Windows, a shebang script on macOS and Linux. Keep that file passing on all three.

## Release

1. Record the changes in `CHANGELOG.md`.
2. `npm version patch|minor|major` bumps `package.json`, then commits and tags.
3. `git push --follow-tags`.
4. `npm publish`. Run `npm login` first. For a private company scope, add `--access restricted` or point at an internal registry through `.npmrc`.

## Conventions

- Add a dependency only when it earns its place. This CLI stays deliberately light, with `commander` as the sole runtime dependency.
- Account names mean something on the local machine and sync nowhere. Two people naming an account "work" hold two unrelated accounts.
- Reach for `fs.stat` over `fs.access` when a symlink's health matters. `fs.access` succeeds on a Windows junction whose target has been deleted.
- Keep `sharedDirsFor()` in `src/workspace.js` as the single source of truth for which directories an account links, so `status` cannot drift from what `ensureClaudeHome` maintains.
