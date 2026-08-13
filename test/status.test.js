import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { withTempHome } from "./helpers.js";
import { collectStatus, renderStatus } from "../src/status.js";
import { saveAccount, setCurrent, claudeHomeDir } from "../src/accounts.js";
import { ensureClaudeHome } from "../src/workspace.js";

// PATH is emptied so claudeBin is deterministic rather than dependent on
// whether the machine running the suite happens to have claude installed.
const NO_PATH = { PATH: "", Path: "" };
const onDisk = process.platform !== "darwin";

let home;
beforeEach(() => {
  home = withTempHome();
  for (const dir of ["agents", "skills", "projects"]) {
    mkdirSync(path.join(home.dir, ".claude", dir), { recursive: true });
  }
});
afterEach(() => {
  home.restore();
});

test("reports an empty install without throwing", async () => {
  const status = await collectStatus(NO_PATH);
  assert.deepEqual(status.accounts, []);
  assert.equal(status.current, null);
  assert.ok(status.warnings.some((w) => /No accounts yet/.test(w)));
  assert.ok(status.warnings.some((w) => /not on your PATH/.test(w)));
  assert.match(renderStatus(status), /No accounts\./);
});

test("reports link state, active account, and history mode", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });
  await ensureClaudeHome("client", { shareHistory: false });
  await saveAccount("client", { shareHistory: false });
  await setCurrent("work");

  const status = await collectStatus(NO_PATH);
  const work = status.accounts.find((a) => a.name === "work");
  const client = status.accounts.find((a) => a.name === "client");

  assert.equal(work.active, true);
  assert.equal(client.active, false);
  assert.equal(work.shareHistory, true);
  assert.deepEqual(
    work.links.map((l) => `${l.dir}:${l.state}`),
    ["agents:shared", "skills:shared", "projects:shared"]
  );
  // An isolated account is not reported as missing its history link, because
  // sharing history was never requested for it.
  assert.deepEqual(
    client.links.map((l) => l.dir),
    ["agents", "skills"]
  );
});

test("flags a broken link and says how to repair it", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });

  const link = path.join(claudeHomeDir("work"), "agents");
  const stale = path.join(home.dir, "gone", "agents");
  mkdirSync(stale, { recursive: true });
  rmSync(link, { recursive: true, force: true });
  symlinkSync(stale, link, process.platform === "win32" ? "junction" : "dir");
  rmSync(path.join(home.dir, "gone"), { recursive: true, force: true });

  const status = await collectStatus(NO_PATH);
  const agents = status.accounts[0].links.find((l) => l.dir === "agents");
  assert.equal(agents.state, "broken");
  assert.ok(status.warnings.some((w) => /agents link is broken/.test(w)));
});

test("marks a shared dir that does not exist globally as absent", async () => {
  rmSync(path.join(home.dir, ".claude", "skills"), { recursive: true, force: true });
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });

  const status = await collectStatus(NO_PATH);
  const skills = status.accounts[0].links.find((l) => l.dir === "skills");
  assert.equal(skills.state, "absent");
  assert.ok(status.warnings.some((w) => /skills does not exist yet/.test(w)));
});

test("detects login state from the per-account credentials file", async (t) => {
  if (!onDisk) {
    t.skip("macOS keeps credentials in the Keychain, so there is no file to read");
    return;
  }
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });

  let status = await collectStatus(NO_PATH);
  assert.equal(status.accounts[0].login.state, "logged-out");
  assert.equal(status.accounts[0].lastActive, null);

  writeFileSync(path.join(claudeHomeDir("work"), ".credentials.json"), "{}\n");
  status = await collectStatus(NO_PATH);
  assert.equal(status.accounts[0].login.state, "logged-in");
  assert.ok(status.accounts[0].lastActive, "lastActive should follow the credentials file");
});

test("warns that macOS cannot isolate credentials", async () => {
  const status = await collectStatus(NO_PATH);
  const warned = status.warnings.some((w) => /Keychain/.test(w));
  assert.equal(warned, !onDisk);
});

test("renders a quota section and a suggestion from the cached utilization", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });
  await setCurrent("work");

  // A suggestion is only offered for an account that can actually open a
  // session, so the fixture has to be logged in.
  writeFileSync(path.join(claudeHomeDir("work"), ".credentials.json"), "{}");

  const now = Date.parse("2026-08-13T08:00:00.000Z");
  writeFileSync(
    path.join(claudeHomeDir("work"), ".claude.json"),
    JSON.stringify({
      oauthAccount: { emailAddress: "dev@example.com", userRateLimitTier: "default_claude_max_5x" },
      cachedUsageUtilization: {
        fetchedAtMs: now - 5 * 60000,
        utilization: {
          five_hour: { utilization: 59, resets_at: new Date(now + 42 * 60000).toISOString() },
          // Already rolled over, so its percentage must not be reported.
          seven_day: { utilization: 76, resets_at: new Date(now - 60000).toISOString() },
        },
      },
    })
  );

  const status = await collectStatus(NO_PATH, { now });
  const text = renderStatus(status);

  assert.match(text, /QUOTA/);
  assert.match(text, /max_5x/);
  assert.match(text, /59%/);
  assert.match(text, /42m/);
  assert.doesNotMatch(text, /76%/);
  assert.match(text, /1 suggestion:/);
  assert.match(text, /Use work now/);
});

test("renders a table marking the active account", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });
  await setCurrent("work");

  const text = renderStatus(await collectStatus(NO_PATH));
  assert.match(text, /ACCOUNT/);
  assert.match(text, /\*\s+work/);
  assert.match(text, /agents:shared/);
});
