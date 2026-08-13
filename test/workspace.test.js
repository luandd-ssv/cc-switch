import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, lstatSync } from "node:fs";
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
