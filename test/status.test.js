import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import os from "node:os";
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

// The quota auto-refresh rewrites .claude.json every time it runs, so that
// file's own mtime cannot be what LAST ACTIVE reads -- otherwise a refreshed
// account would report "just now" forever regardless of real use.
// project.lastStartTime, surfaced through the profile's lastSession, is not
// touched by that refresh, so it has to be what wins here instead.
test("LAST ACTIVE follows a real session, not a .claude.json write from the quota refresh", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });
  // No .credentials.json here on purpose: it is written at the real wall
  // clock, which would outrun this test's simulated `now` and mask the
  // exact thing this test checks. lastActive is compared to the fixture's
  // session time alone.

  const now = Date.parse("2026-08-14T09:00:00.000Z");
  const realSessionAt = now - 5 * 3600000; // a real session five hours ago
  writeFileSync(
    path.join(claudeHomeDir("work"), ".claude.json"),
    JSON.stringify({
      // A very recent cachedUsageUtilization simulates the file having just
      // been rewritten by a quota refresh moments ago.
      cachedUsageUtilization: {
        fetchedAtMs: now - 60000,
        utilization: { five_hour: { utilization: 10, resets_at: new Date(now + 3600000).toISOString() } },
      },
      projects: {
        "/repo": { lastStartTime: realSessionAt, lastSessionId: "abc" },
      },
    })
  );

  const status = await collectStatus(NO_PATH, { now });
  const work = status.accounts.find((a) => a.name === "work");
  assert.equal(Date.parse(work.lastActive), realSessionAt);
});

test("quota refresh state is reported so the QUOTA header never claims what didn't happen", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });

  const now = Date.now();
  writeFileSync(
    path.join(claudeHomeDir("work"), ".claude.json"),
    JSON.stringify({
      cachedUsageUtilization: {
        fetchedAtMs: now - 3600000,
        utilization: { five_hour: { utilization: 10, resets_at: new Date(now + 3600000).toISOString() } },
      },
    })
  );

  // NO_PATH means claude cannot be resolved, so refresh is off no matter
  // what the caller asked for -- yet the cache is old enough that a live
  // refresh would have fired if it were on, which is exactly the case the
  // header must not misreport.
  const status = await collectStatus(NO_PATH, { now });
  assert.deepEqual(status.quotaRefresh, { enabled: false, staleMinutes: null });
  const text = renderStatus(status);
  assert.match(text, /QUOTA {2}\(refresh disabled/);
  assert.doesNotMatch(text, /auto-refreshed/);
});

// A non-zero exit from claude itself (a broken install, an environment
// problem) must read as a refresh failure, not as "this account's login may
// have expired" -- the two point the reader at completely different fixes.
test("a claude that exits non-zero is reported as a refresh failure, not an expired login", async () => {
  const isWin = process.platform === "win32";
  const binDir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-status-bin-"));
  try {
    writeFileSync(path.join(binDir, "fake.mjs"), 'process.exit(9);\n');
    if (isWin) {
      writeFileSync(path.join(binDir, "claude.cmd"), '@echo off\r\nnode "%~dp0fake.mjs" %*\r\n');
    } else {
      const script = path.join(binDir, "claude");
      writeFileSync(script, '#!/bin/sh\nexec node "$(dirname "$0")/fake.mjs" "$@"\n');
      chmodSync(script, 0o755);
    }

    await ensureClaudeHome("work", { shareHistory: true });
    await saveAccount("work", { shareHistory: true });
    writeFileSync(path.join(claudeHomeDir("work"), ".credentials.json"), "{}");
    // On macOS every account reports login state "keychain", so a per-account
    // credentials file is not what makes an account eligible for a refresh
    // there -- an existing .claude.json is. Without one this test would skip
    // the refresh entirely on darwin and then assert against an undefined
    // warning. No cachedUsageUtilization in it on purpose: an absent cache is
    // stale by definition, which is what should trigger the refresh here.
    writeFileSync(path.join(claudeHomeDir("work"), ".claude.json"), JSON.stringify({ numStartups: 1 }));

    const env = {
      ...NO_PATH,
      PATH: binDir + path.delimiter + process.env.PATH,
      Path: binDir + path.delimiter + (process.env.Path ?? ""),
    };
    const status = await collectStatus(env);

    const warned = status.warnings.find((w) => w.startsWith("work:"));
    assert.match(warned, /refresh failed/);
    assert.match(warned, /code 9/);
    assert.doesNotMatch(warned, /may have expired/);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});
