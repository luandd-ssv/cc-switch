import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  lstatSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { withTempHome } from "./helpers.js";
import { ensureClaudeHome } from "../src/workspace.js";
import { claudeHomeDir } from "../src/accounts.js";

let home;
beforeEach(() => {
  home = withTempHome();
  const globalClaudeDir = path.join(home.dir, ".claude");
  mkdirSync(path.join(globalClaudeDir, "agents"), { recursive: true });
  mkdirSync(path.join(globalClaudeDir, "skills"), { recursive: true });
  mkdirSync(path.join(globalClaudeDir, "projects", "-demo-project"), {
    recursive: true,
  });
  writeFileSync(
    path.join(globalClaudeDir, "projects", "-demo-project", "session.jsonl"),
    "{}\n"
  );
});
afterEach(() => {
  home.restore();
});

test("shareHistory: true links agents, skills, and projects", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  const dir = claudeHomeDir("work");
  for (const name of ["agents", "skills", "projects"]) {
    const linked = path.join(dir, name);
    assert.ok(existsSync(linked), `${name} should exist`);
    assert.ok(lstatSync(linked).isSymbolicLink(), `${name} should be a symlink/junction`);
  }
});

test("shareHistory: false links agents/skills but not projects", async () => {
  await ensureClaudeHome("work", { shareHistory: false });
  const dir = claudeHomeDir("work");
  assert.ok(existsSync(path.join(dir, "agents")));
  assert.ok(existsSync(path.join(dir, "skills")));
  assert.ok(!existsSync(path.join(dir, "projects")));
});

test("defaults to sharing history when no option is passed", async () => {
  await ensureClaudeHome("work");
  assert.ok(existsSync(path.join(claudeHomeDir("work"), "projects")));
});

test("is idempotent: a second call leaves healthy links alone", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await ensureClaudeHome("work", { shareHistory: true });
  const link = path.join(claudeHomeDir("work"), "projects");
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.ok(existsSync(path.join(link, "-demo-project", "session.jsonl")));
});

test("links a shared dir that only appeared after the account was created", async () => {
  const globalClaudeDir = path.join(home.dir, ".claude");
  rmSync(path.join(globalClaudeDir, "skills"), { recursive: true, force: true });

  await ensureClaudeHome("work", { shareHistory: true });
  assert.ok(!existsSync(path.join(claudeHomeDir("work"), "skills")));

  // The user installs a skill later on, so the directory shows up.
  mkdirSync(path.join(globalClaudeDir, "skills"), { recursive: true });
  await ensureClaudeHome("work", { shareHistory: true });
  assert.ok(existsSync(path.join(claudeHomeDir("work"), "skills")));
});

test("rebuilds a link whose target has gone away", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  const link = path.join(claudeHomeDir("work"), "agents");

  // Repoint the link at a directory that then disappears, which is what a
  // moved home directory looks like from the account's side.
  const stale = path.join(home.dir, "old-home", "agents");
  mkdirSync(stale, { recursive: true });
  rmSync(link, { recursive: true, force: true });
  symlinkSync(stale, link, process.platform === "win32" ? "junction" : "dir");
  rmSync(path.join(home.dir, "old-home"), { recursive: true, force: true });
  assert.ok(!existsSync(link), "link should be dangling now");

  await ensureClaudeHome("work", { shareHistory: true });
  assert.ok(existsSync(link), "dangling link should have been rebuilt");
});

test("never replaces a real directory with a link", async () => {
  const home2 = claudeHomeDir("work");
  mkdirSync(path.join(home2, "agents"), { recursive: true });
  writeFileSync(path.join(home2, "agents", "local-only.md"), "mine\n");

  await ensureClaudeHome("work", { shareHistory: true });

  assert.ok(!lstatSync(path.join(home2, "agents")).isSymbolicLink());
  assert.ok(existsSync(path.join(home2, "agents", "local-only.md")));
});

test("skips linking a shared dir that doesn't exist globally yet", async () => {
  const other = withTempHome();
  try {
    await ensureClaudeHome("fresh", { shareHistory: true });
    const dir = claudeHomeDir("fresh");
    assert.ok(!existsSync(path.join(dir, "agents")));
    assert.ok(!existsSync(path.join(dir, "projects")));
  } finally {
    other.restore();
  }
});
