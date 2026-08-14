import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOnPath } from "../src/run.js";
import { readProfile } from "../src/quota.js";
import {
  REFRESH_DEFAULTS,
  clearRefreshBackoff,
  effectiveStaleMinutes,
  isStale,
  refreshQuota,
  refreshStale,
} from "../src/refresh.js";

// A tiny stand-in for `claude -p "/usage"`. It never touches the network --
// it just plays out the three ways the real command can end, controlled by
// CC_SWITCH_TEST_MODE, so refresh.js's handling of each is testable without
// a real account: "update" writes a fresh cachedUsageUtilization (a normal
// refresh), "noop" exits cleanly without touching the cache (what an expired
// login looks like from the outside), and "hang" never exits (what a wedged
// child looks like).
const isWin = process.platform === "win32";
let binDir;
let claudeBin;
let env;

before(() => {
  binDir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-refresh-bin-"));
  writeFileSync(
    path.join(binDir, "usage.mjs"),
    [
      'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
      'import path from "node:path";',
      "",
      'import { appendFileSync } from "node:fs";',
      "",
      "const home = process.env.CLAUDE_CONFIG_DIR;",
      'const mode = process.env.CC_SWITCH_TEST_MODE || "update";',
      'const file = path.join(home, ".claude.json");',
      "const logFile = process.env.CC_SWITCH_TEST_LOG;",
      "const delayMs = Number(process.env.CC_SWITCH_TEST_DELAY_MS || 0);",
      "",
      // Lets tests observe how many times, and how long, this fake binary
      // actually ran -- proof for the in-flight dedupe and concurrency cap,
      // which a fetchedAtMs check alone can't distinguish from "ran once".
      'if (logFile) appendFileSync(logFile, JSON.stringify({ event: "start", t: Date.now() }) + "\\n");',
      "if (delayMs > 0) { await new Promise((r) => setTimeout(r, delayMs)); }",
      "",
      // An unresolved promise alone does not keep Node's event loop alive --
      // with nothing else pending the process would exit 0 on its own, which
      // would make this indistinguishable from a real reply. The interval
      // gives it something to keep running for until the test kills it.
      'if (mode === "hang") { setInterval(() => {}, 60000); await new Promise(() => {}); }',
      'if (mode === "update") {',
      "  let base = {};",
      "  if (existsSync(file)) { try { base = JSON.parse(readFileSync(file, \"utf8\")); } catch {} }",
      "  base.cachedUsageUtilization = {",
      "    fetchedAtMs: Date.now(),",
      '    utilization: { five_hour: { utilization: 10, resets_at: new Date(Date.now() + 3600000).toISOString() } },',
      "  };",
      "  writeFileSync(file, JSON.stringify(base));",
      "}",
      "// mode \"noop\" falls through to here without writing anything.",
      'if (logFile) appendFileSync(logFile, JSON.stringify({ event: "end", t: Date.now() }) + "\\n");',
      'process.exit(Number(process.env.CC_SWITCH_TEST_EXIT || 0));',
    ].join("\n")
  );

  if (isWin) {
    writeFileSync(path.join(binDir, "fakeclaude.cmd"), '@echo off\r\nnode "%~dp0usage.mjs" %*\r\n');
  } else {
    const script = path.join(binDir, "fakeclaude");
    writeFileSync(script, '#!/bin/sh\nexec node "$(dirname "$0")/usage.mjs" "$@"\n');
    chmodSync(script, 0o755);
  }

  env = {
    ...process.env,
    PATH: binDir + path.delimiter + (process.env.PATH ?? ""),
    Path: binDir + path.delimiter + (process.env.Path ?? ""),
  };
  claudeBin = resolveOnPath("fakeclaude", env);
});

after(() => {
  rmSync(binDir, { recursive: true, force: true });
});

// The post-attempt cooldown is module state, so each case starts from a clean
// one instead of inheriting whatever the previous test left behind.
beforeEach(() => {
  clearRefreshBackoff();
});

function tempHome() {
  return mkdtempSync(path.join(os.tmpdir(), "cc-switch-refresh-home-"));
}

function tempLog() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-refresh-log-"));
  return path.join(dir, "invocations.log");
}

function readLog(logFile) {
  return readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("isStale treats a missing or unavailable cache as stale", () => {
  const now = Date.now();
  assert.equal(isStale(null, now, 300000), true);
  assert.equal(isStale({ available: false }, now, 300000), true);
  assert.equal(isStale({ available: true, fetchedAt: null }, now, 300000), true);
});

test("isStale compares fetchedAt against the threshold", () => {
  const now = Date.now();
  assert.equal(isStale({ available: true, fetchedAt: now - 60000 }, now, 300000), false);
  assert.equal(isStale({ available: true, fetchedAt: now - 600000 }, now, 300000), true);
});

test("refreshQuota skips without spawning when claude cannot be resolved", async () => {
  const home = tempHome();
  try {
    const result = await refreshQuota({ name: "work", home }, { PATH: "", Path: "" });
    assert.deepEqual(result, { name: "work", ok: false, attempted: false, reason: "claude-not-found" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("refreshQuota reports ok once the cache's fetchedAtMs moves", async () => {
  const home = tempHome();
  try {
    const result = await refreshQuota(
      { name: "work", home },
      { ...env, CC_SWITCH_TEST_MODE: "update" },
      { claudeBin }
    );
    assert.deepEqual(result, { name: "work", ok: true, attempted: true });

    const profile = await readProfile(home);
    assert.equal(profile.quota.available, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("refreshQuota reports no-update when the exit is clean but the cache never moves", async () => {
  const home = tempHome();
  try {
    const result = await refreshQuota(
      { name: "work", home },
      { ...env, CC_SWITCH_TEST_MODE: "noop" },
      { claudeBin }
    );
    assert.equal(result.ok, false);
    assert.equal(result.attempted, true);
    assert.equal(result.reason, "no-update");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The scenario this exists for: a token expired between two runs. The child
// exits 0 (nothing about the process looks wrong) but the timestamp it was
// supposed to move sits exactly where it started.
test("refreshQuota also catches an existing cache staying exactly where it was", async () => {
  const home = tempHome();
  try {
    writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        cachedUsageUtilization: {
          fetchedAtMs: Date.now() - 600000,
          utilization: { five_hour: { utilization: 90, resets_at: new Date(Date.now() + 1000).toISOString() } },
        },
      })
    );
    const result = await refreshQuota(
      { name: "work", home },
      { ...env, CC_SWITCH_TEST_MODE: "noop" },
      { claudeBin }
    );
    assert.equal(result.reason, "no-update");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("refreshQuota reports a timeout instead of hanging on a wedged child", async () => {
  const home = tempHome();
  try {
    const result = await refreshQuota(
      { name: "work", home },
      { ...env, CC_SWITCH_TEST_MODE: "hang" },
      { claudeBin, timeoutMs: 200 }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "spawn-error");
    assert.match(result.error, /timed out/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("refreshStale only refreshes accounts that are logged in and past the threshold", async () => {
  const staleHome = tempHome();
  const freshHome = tempHome();
  const loggedOutHome = tempHome();
  const now = Date.now();

  try {
    for (const [home, fetchedAtMs] of [
      [staleHome, now - 600000],
      [freshHome, now - 30000],
      [loggedOutHome, now - 600000],
    ]) {
      writeFileSync(
        path.join(home, ".claude.json"),
        JSON.stringify({
          cachedUsageUtilization: {
            fetchedAtMs,
            utilization: { five_hour: { utilization: 10, resets_at: new Date(now + 3600000).toISOString() } },
          },
        })
      );
    }

    const accounts = [
      { name: "stale", home: staleHome, login: { state: "logged-in" }, profile: await readProfile(staleHome, now) },
      { name: "fresh", home: freshHome, login: { state: "logged-in" }, profile: await readProfile(freshHome, now) },
      {
        name: "loggedout",
        home: loggedOutHome,
        login: { state: "logged-out" },
        profile: await readProfile(loggedOutHome, now),
      },
    ];

    const results = await refreshStale(accounts, { ...env, CC_SWITCH_TEST_MODE: "update" }, { claudeBin, now, staleMinutes: 5 });
    assert.deepEqual(results.map((r) => r.name), ["stale"]);
    assert.equal(results[0].ok, true);
  } finally {
    for (const dir of [staleHome, freshHome, loggedOutHome]) rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshStale does nothing when claude cannot be resolved", async () => {
  const home = tempHome();
  try {
    const accounts = [{ name: "work", home, login: { state: "logged-in" }, profile: await readProfile(home) }];
    const results = await refreshStale(accounts, { PATH: "", Path: "" });
    assert.deepEqual(results, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A hard failure (a bad claude install, an environment problem) has nothing
// to do with this account's login, so it must not be folded into the same
// "no-update" bucket that the expired-login warning reads from.
test("refreshQuota reports exit-nonzero separately from no-update", async () => {
  const home = tempHome();
  try {
    const result = await refreshQuota(
      { name: "work", home },
      { ...env, CC_SWITCH_TEST_MODE: "noop", CC_SWITCH_TEST_EXIT: "7" },
      { claudeBin }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "exit-nonzero");
    assert.match(result.error, /code 7/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Two overlapping callers for the same account -- two dashboard tabs polling,
// a manual Refresh click landing mid-poll -- must join one attempt instead of
// each spawning their own `claude -p /usage` against the same .claude.json.
test("refreshQuota joins an in-flight refresh for the same account instead of spawning twice", async () => {
  const home = tempHome();
  const logFile = tempLog();
  try {
    const opts = { ...env, CC_SWITCH_TEST_MODE: "update", CC_SWITCH_TEST_LOG: logFile, CC_SWITCH_TEST_DELAY_MS: "150" };
    const account = { name: "work", home };
    const [a, b] = await Promise.all([refreshQuota(account, opts, { claudeBin }), refreshQuota(account, opts, { claudeBin })]);

    assert.deepEqual(a, b);
    assert.equal(a.ok, true);
    assert.equal(readLog(logFile).filter((e) => e.event === "start").length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A completed refresh must not stay "in flight" forever -- a later, separate
// refresh for the same account has to spawn its own attempt.
test("refreshQuota spawns again for the same account once the previous refresh finished", async () => {
  const home = tempHome();
  const logFile = tempLog();
  try {
    const opts = { ...env, CC_SWITCH_TEST_MODE: "update", CC_SWITCH_TEST_LOG: logFile };
    const account = { name: "work", home };
    await refreshQuota(account, opts, { claudeBin });
    await refreshQuota(account, opts, { claudeBin });
    assert.equal(readLog(logFile).filter((e) => e.event === "start").length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// --stale-after/--interval must not be able to push the threshold below
// Claude Code's own refresh cooldown: refreshStale clamps up to
// REFRESH_DEFAULTS.minStaleMinutes regardless of what is asked for.
test("refreshStale clamps staleMinutes to at least minStaleMinutes", async () => {
  const home = tempHome();
  try {
    const now = Date.now();
    const twoMinutesAgo = now - 2 * 60000;
    writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        cachedUsageUtilization: {
          fetchedAtMs: twoMinutesAgo,
          utilization: { five_hour: { utilization: 10, resets_at: new Date(now + 3600000).toISOString() } },
        },
      })
    );
    const accounts = [{ name: "work", home, login: { state: "logged-in" }, profile: await readProfile(home, now) }];

    // 2 minutes old is stale under a 1-minute ask but not under the 3-minute
    // floor, so this must refresh nothing.
    assert.equal(REFRESH_DEFAULTS.minStaleMinutes, 3);
    const results = await refreshStale(accounts, env, { claudeBin, now, staleMinutes: 1 });
    assert.deepEqual(results, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The case isStale() cannot rate-limit by itself: with no cachedUsageUtilization
// there is no fetchedAtMs to compare against, so staleness is unconditionally
// true. Without a cooldown keyed on the attempt, an account whose cache never
// materialises (expired login, or any setup whose "/usage" writes nothing) would
// spawn a fresh Claude Code process on every status call and every dashboard
// poll, forever.
test("refreshStale does not re-attempt a never-cached account within the staleness window", async () => {
  const home = tempHome();
  const logFile = tempLog();
  try {
    const now = Date.now();
    // "noop" leaves the cache absent, so nothing about the account changes
    // between the two passes -- only the cooldown can tell them apart.
    const opts = { ...env, CC_SWITCH_TEST_MODE: "noop", CC_SWITCH_TEST_LOG: logFile };
    const account = { name: "work", home, login: { state: "logged-in" }, profile: await readProfile(home, now) };

    const first = await refreshStale([account], opts, { claudeBin, now });
    assert.deepEqual(first.map((r) => r.reason), ["no-update"]);

    // A second pass one minute later, still inside the 3-minute window.
    const second = await refreshStale([account], opts, { claudeBin, now: now + 60000 });
    assert.deepEqual(second, []);
    assert.equal(readLog(logFile).filter((e) => e.event === "start").length, 1);

    // Past the window it is allowed to try again, so a transient failure is
    // not sticky either.
    const third = await refreshStale([account], opts, {
      claudeBin,
      now: now + effectiveStaleMinutes() * 60000 + 1000,
    });
    assert.deepEqual(third.map((r) => r.reason), ["no-update"]);
    assert.equal(readLog(logFile).filter((e) => e.event === "start").length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("refreshStale stops starting batches once the overall budget is spent", async () => {
  const homes = Array.from({ length: 6 }, () => tempHome());
  const logFile = tempLog();
  try {
    const now = Date.now();
    const accounts = await Promise.all(
      homes.map(async (home, i) => ({
        name: `acct${i}`,
        home,
        login: { state: "logged-in" },
        profile: await readProfile(home, now),
      }))
    );

    // One account per batch, each taking ~120ms, against a budget that only
    // affords the first couple: the rest must be left for a later call rather
    // than holding the caller for the full six.
    const results = await refreshStale(
      accounts,
      { ...env, CC_SWITCH_TEST_MODE: "update", CC_SWITCH_TEST_LOG: logFile, CC_SWITCH_TEST_DELAY_MS: "120" },
      { claudeBin, now, maxConcurrent: 1, budgetMs: 150 }
    );

    assert.ok(results.length >= 1, "the first batch always runs");
    assert.ok(results.length < 6, `expected the budget to cut the pass short, got ${results.length}`);
    assert.equal(readLog(logFile).filter((e) => e.event === "start").length, results.length);
  } finally {
    for (const dir of homes) rmSync(dir, { recursive: true, force: true });
  }
});

// macOS reports "keychain" for every account regardless of whether it has
// ever completed a login, so configFound is what actually distinguishes a
// real account from one that has never been launched.
test("refreshStale only attempts a keychain account once it has a cache on disk", async () => {
  const neverLaunchedHome = tempHome();
  const usedHome = tempHome();
  const now = Date.now();
  try {
    writeFileSync(
      path.join(usedHome, ".claude.json"),
      JSON.stringify({
        cachedUsageUtilization: {
          fetchedAtMs: now - 600000,
          utilization: { five_hour: { utilization: 10, resets_at: new Date(now + 3600000).toISOString() } },
        },
      })
    );

    const accounts = [
      { name: "never", home: neverLaunchedHome, login: { state: "keychain" }, profile: await readProfile(neverLaunchedHome, now) },
      { name: "used", home: usedHome, login: { state: "keychain" }, profile: await readProfile(usedHome, now) },
    ];

    const results = await refreshStale(accounts, { ...env, CC_SWITCH_TEST_MODE: "update" }, { claudeBin, now });
    assert.deepEqual(results.map((r) => r.name), ["used"]);
  } finally {
    for (const dir of [neverLaunchedHome, usedHome]) rmSync(dir, { recursive: true, force: true });
  }
});

// Fanning out one Claude Code process per stale account without a cap would
// launch all of them at once when there are many; maxConcurrent bounds how
// many run at the same time.
test("refreshStale never runs more than maxConcurrent refreshes at once", async () => {
  const homes = Array.from({ length: 6 }, () => tempHome());
  const logFile = tempLog();
  try {
    const now = Date.now();
    const accounts = await Promise.all(
      homes.map(async (home, i) => ({
        name: `acct${i}`,
        home,
        login: { state: "logged-in" },
        profile: await readProfile(home, now),
      }))
    );

    await refreshStale(
      accounts,
      { ...env, CC_SWITCH_TEST_MODE: "update", CC_SWITCH_TEST_LOG: logFile, CC_SWITCH_TEST_DELAY_MS: "120" },
      { claudeBin, now, maxConcurrent: 2 }
    );

    // Tie-break on the event kind, not just the timestamp: one batch's "end"
    // and the next batch's "start" can land in the same millisecond, and
    // ordering the start first there would count a third concurrent refresh
    // that never existed.
    const rank = (e) => (e.event === "end" ? 0 : 1);
    const events = readLog(logFile).sort((a, b) => a.t - b.t || rank(a) - rank(b));
    let concurrent = 0;
    let peak = 0;
    for (const e of events) {
      concurrent += e.event === "start" ? 1 : -1;
      peak = Math.max(peak, concurrent);
    }
    assert.equal(events.filter((e) => e.event === "start").length, 6);
    assert.ok(peak <= 2, `expected at most 2 concurrent refreshes, saw ${peak}`);
  } finally {
    for (const dir of homes) rmSync(dir, { recursive: true, force: true });
  }
});
