import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runClaude } from "../src/run.js";

// Launching the real CLI is the one thing that behaves differently on every
// platform: an npm .cmd shim through cmd.exe on Windows, a shebang script on
// macOS and Linux. So we stand up a fake `claude` on a scratch PATH and check
// that arguments survive the trip intact on whichever OS is running the suite.
const isWin = process.platform === "win32";
let dir;
let outFile;
let env;

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-e2e-"));
  outFile = path.join(dir, "argv.json");

  writeFileSync(
    path.join(dir, "print-args.mjs"),
    'import { writeFileSync } from "node:fs";\n' +
      'writeFileSync(process.env.CC_SWITCH_TEST_OUT, JSON.stringify({\n' +
      '  argv: process.argv.slice(2),\n' +
      '  configDir: process.env.CLAUDE_CONFIG_DIR ?? null,\n' +
      '}));\n' +
      'process.exit(Number(process.env.CC_SWITCH_TEST_EXIT || 0));\n'
  );

  if (isWin) {
    // Mirrors the shim npm generates for a global install.
    writeFileSync(
      path.join(dir, "fakeclaude.cmd"),
      '@echo off\r\nnode "%~dp0print-args.mjs" %*\r\n'
    );
  } else {
    const script = path.join(dir, "fakeclaude");
    writeFileSync(script, '#!/bin/sh\nexec node "$(dirname "$0")/print-args.mjs" "$@"\n');
    chmodSync(script, 0o755);
  }

  env = {
    ...process.env,
    PATH: dir + path.delimiter + (process.env.PATH ?? ""),
    Path: dir + path.delimiter + (process.env.Path ?? ""),
    CC_SWITCH_TEST_OUT: outFile,
    CLAUDE_CONFIG_DIR: path.join(dir, "claude-home"),
  };
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("forwards arguments verbatim, spaces and shell metacharacters included", async () => {
  // Deliberately nasty: a quoted phrase, a Windows path with a trailing
  // backslash, embedded quotes, and characters cmd.exe would otherwise treat
  // as operators. %VAR% is left out because cmd.exe expands it before the
  // shim runs and a raw command line cannot escape a percent sign.
  const args = [
    "-p",
    "explain this repo",
    "--add-dir",
    "C:\\Program Files\\my app",
    "--trailing",
    "C:\\dir\\",
    "--quoted",
    'say "hi" now',
    "--meta",
    "a&b|c>d^e;f$g",
  ];

  const code = await runClaude(args, env, "fakeclaude");
  assert.equal(code, 0);

  const result = JSON.parse(readFileSync(outFile, "utf8"));
  assert.deepEqual(result.argv, args);
  assert.equal(result.configDir, path.join(dir, "claude-home"));
});

// On macOS and Linux every launch takes the direct-spawn branch. Driving a
// real executable by absolute path exercises that same branch on Windows too,
// so the path Linux/macOS depend on is covered wherever the suite runs.
test("spawns a non-shim executable directly, without a shell", async () => {
  const args = [
    path.join(dir, "print-args.mjs"),
    "--phrase",
    "explain this repo",
    "--meta",
    "a&b|c;d$e",
  ];

  const code = await runClaude(args, env, process.execPath);
  assert.equal(code, 0);

  const result = JSON.parse(readFileSync(outFile, "utf8"));
  assert.deepEqual(result.argv, args.slice(1));
});

test("propagates the child's exit code", async () => {
  const code = await runClaude([], { ...env, CC_SWITCH_TEST_EXIT: "7" }, "fakeclaude");
  assert.equal(code, 7);
});

test("does not execute injected commands", async () => {
  const canary = path.join(dir, "pwned.txt");
  const payload = isWin ? `x & echo pwned > "${canary}"` : `x; touch "${canary}"`;

  await runClaude(["--note", payload], env, "fakeclaude");

  const result = JSON.parse(readFileSync(outFile, "utf8"));
  assert.deepEqual(result.argv, ["--note", payload]);
  assert.throws(() => readFileSync(canary), "injected command must not have run");
});
