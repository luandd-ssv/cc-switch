import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatDuration,
  readProfile,
  recommendAccounts,
  summarizeQuota,
  windowFor,
} from "../src/quota.js";

const NOW = Date.parse("2026-08-13T08:00:00.000Z");
const minutes = (n) => n * 60000;

function cache({ fiveHour = 40, fiveHourResetsIn = 90, sevenDay = 8 } = {}) {
  return {
    fetchedAtMs: NOW - minutes(5),
    utilization: {
      five_hour: {
        utilization: fiveHour,
        resets_at: new Date(NOW + minutes(fiveHourResetsIn)).toISOString(),
      },
      seven_day: {
        utilization: sevenDay,
        resets_at: new Date(NOW + minutes(60 * 24 * 3)).toISOString(),
      },
      limits: [{ kind: "session", percent: fiveHour, severity: "normal", resets_at: null }],
      extra_usage: { is_enabled: true, used_credits: 0, monthly_limit: 0, currency: "USD" },
    },
  };
}

function accountWith(name, window) {
  return { name, profile: { quota: { available: true, windows: [window] } } };
}

test("summarizeQuota reports nothing when the cache is absent", () => {
  const quota = summarizeQuota(null, NOW);
  assert.equal(quota.available, false);
  assert.deepEqual(quota.windows, []);
});

test("summarizeQuota keeps a percentage while its window is still open", () => {
  const quota = summarizeQuota(cache({ fiveHour: 59, fiveHourResetsIn: 42 }), NOW);
  const window = windowFor(quota, "five_hour");

  assert.equal(quota.available, true);
  assert.equal(window.state, "fresh");
  assert.equal(window.percent, 59);
  assert.equal(window.msToReset, minutes(42));
  assert.equal(window.severity, "normal");
  assert.equal(quota.extraUsage.enabled, true);
});

// The cached number describes an allowance the server has already replaced, so
// reporting it after the rollover would overstate how much has been used.
test("summarizeQuota withholds a percentage once the window has reset", () => {
  const quota = summarizeQuota(cache({ fiveHour: 76, fiveHourResetsIn: -1 }), NOW);
  const window = windowFor(quota, "five_hour");

  assert.equal(window.state, "expired");
  assert.equal(window.percent, null);
  assert.ok(window.resetsAt < NOW);
});

test("summarizeQuota marks a window with no usable reset time as unknown", () => {
  const broken = { fetchedAtMs: NOW, utilization: { five_hour: { utilization: 12, resets_at: "not a date" } } };
  assert.equal(windowFor(summarizeQuota(broken, NOW), "five_hour").state, "unknown");
});

test("recommendAccounts suggests a window that closes soon with headroom left", () => {
  const accounts = [
    accountWith("work", {
      key: "five_hour",
      state: "fresh",
      percent: 59,
      resetsAt: NOW + minutes(42),
      msToReset: minutes(42),
    }),
  ];

  const { candidates } = recommendAccounts(accounts, {}, NOW);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].account, "work");
  assert.match(candidates[0].title, /Use work now/);
  assert.match(candidates[0].body, /resets in 42m/);
  assert.match(candidates[0].body, /59% used/);
});

test("recommendAccounts ignores an account that is nearly spent", () => {
  const accounts = [
    accountWith("work", {
      key: "five_hour",
      state: "fresh",
      percent: 95,
      resetsAt: NOW + minutes(10),
      msToReset: minutes(10),
    }),
  ];
  assert.deepEqual(recommendAccounts(accounts, {}, NOW).candidates, []);
});

test("recommendAccounts ignores a window that is not closing yet", () => {
  const accounts = [
    accountWith("work", {
      key: "five_hour",
      state: "fresh",
      percent: 5,
      resetsAt: NOW + minutes(200),
      msToReset: minutes(200),
    }),
  ];
  assert.deepEqual(recommendAccounts(accounts, {}, NOW).candidates, []);
});

test("recommendAccounts ignores a stale window rather than guessing", () => {
  const accounts = [
    accountWith("work", { key: "five_hour", state: "expired", percent: null, resetsAt: NOW - 1, msToReset: 0 }),
  ];
  assert.deepEqual(recommendAccounts(accounts, {}, NOW).candidates, []);
});

test("recommendAccounts puts the account with the most headroom first", () => {
  const accounts = [
    accountWith("busy", {
      key: "five_hour",
      state: "fresh",
      percent: 65,
      resetsAt: NOW + minutes(30),
      msToReset: minutes(30),
    }),
    accountWith("idle", {
      key: "five_hour",
      state: "fresh",
      percent: 8,
      resetsAt: NOW + minutes(50),
      msToReset: minutes(50),
    }),
  ];

  const { candidates } = recommendAccounts(accounts, {}, NOW);
  assert.deepEqual(
    candidates.map((c) => c.account),
    ["idle", "busy"]
  );
});

// Quota left in a window the account cannot open is not worth acting on: the
// suggestion would send the reader to an OAuth prompt instead of a session.
test("recommendAccounts skips an account that is logged out", () => {
  const window = {
    key: "five_hour",
    state: "fresh",
    percent: 12,
    resetsAt: NOW + minutes(20),
    msToReset: minutes(20),
  };
  const loggedOut = { ...accountWith("work", window), login: { state: "logged-out" } };
  const loggedIn = { ...accountWith("work", window), login: { state: "logged-in" } };

  assert.deepEqual(recommendAccounts([loggedOut], {}, NOW).candidates, []);
  assert.equal(recommendAccounts([loggedIn], {}, NOW).candidates.length, 1);
  // macOS has no per-account credentials file to inspect, so "keychain" must not
  // be read as logged out.
  const keychain = { ...accountWith("work", window), login: { state: "keychain" } };
  assert.equal(recommendAccounts([keychain], {}, NOW).candidates.length, 1);
});

// The page re-renders the countdown between polls, so it needs the sentence with
// a hole in it -- a frozen copy would still read "resets in 20m" an hour later.
test("recommendAccounts ships a re-renderable body alongside the rendered one", () => {
  const accounts = [
    accountWith("work", {
      key: "five_hour",
      state: "fresh",
      percent: 12,
      resetsAt: NOW + minutes(20),
      msToReset: minutes(20),
    }),
  ];

  const [candidate] = recommendAccounts(accounts, {}, NOW).candidates;
  assert.equal(candidate.body, candidate.bodyTemplate.replace("{resetIn}", "20m"));
  assert.match(candidate.bodyTemplate, /\{resetIn\}/);
});

test("recommendAccounts honours custom thresholds", () => {
  const accounts = [
    accountWith("work", {
      key: "five_hour",
      state: "fresh",
      percent: 80,
      resetsAt: NOW + minutes(120),
      msToReset: minutes(120),
    }),
  ];

  const { candidates, thresholds } = recommendAccounts(
    accounts,
    { resetWithinMinutes: 180, headroomBelowPercent: 90 },
    NOW
  );
  assert.equal(candidates.length, 1);
  assert.equal(thresholds.resetWithinMinutes, 180);
});

test("formatDuration reads as a countdown", () => {
  assert.equal(formatDuration(minutes(42)), "42m");
  assert.equal(formatDuration(minutes(158)), "2h38m");
  assert.equal(formatDuration(minutes(120)), "2h");
  // The weekly window lives out here, where "165h32m" would be unreadable.
  assert.equal(formatDuration(minutes(60 * 165 + 32)), "6d21h");
  assert.equal(formatDuration(minutes(60 * 48)), "2d");
  assert.equal(formatDuration(-1), "now");
  assert.equal(formatDuration(null), "now");
});

test("readProfile survives a missing or malformed config", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-quota-"));
  try {
    let profile = await readProfile(dir, NOW);
    assert.equal(profile.configFound, false);
    assert.equal(profile.quota.available, false);

    writeFileSync(path.join(dir, ".claude.json"), "{ not json");
    profile = await readProfile(dir, NOW);
    assert.equal(profile.configFound, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readProfile pulls identity, quota and the newest session snapshot", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-quota-"));
  try {
    writeFileSync(
      path.join(dir, ".claude.json"),
      JSON.stringify({
        numStartups: 4,
        oauthAccount: {
          emailAddress: "dev@example.com",
          organizationName: "Example",
          userRateLimitTier: "default_claude_max_5x",
          seatTier: "team_tier_1",
          hasExtraUsageEnabled: true,
        },
        cachedUsageUtilization: cache({ fiveHour: 59, fiveHourResetsIn: 42 }),
        projects: {
          "/old": { lastStartTime: NOW - minutes(600), lastCost: 1 },
          // Epoch milliseconds is what Claude Code actually writes here.
          "/new": {
            lastStartTime: NOW - minutes(5),
            lastCost: 0.21,
            lastSessionId: "abc",
            lastTotalInputTokens: 2674,
            lastTotalOutputTokens: 1014,
            lastTotalCacheReadInputTokens: 135559,
            lastModelUsage: {
              "claude-opus-5": { costUSD: 0.2, inputTokens: 2127, outputTokens: 986 },
              "claude-haiku-4-5": { costUSD: 0.0007, inputTokens: 547, outputTokens: 28 },
            },
          },
        },
      })
    );

    const profile = await readProfile(dir, NOW);
    assert.equal(profile.configFound, true);
    assert.equal(profile.identity.email, "dev@example.com");
    assert.equal(profile.identity.rateLimitTier, "default_claude_max_5x");
    assert.equal(profile.startups, 4);
    assert.equal(windowFor(profile.quota, "five_hour").percent, 59);
    assert.equal(profile.lastSession.project, "/new");
    assert.equal(profile.lastSession.cost, 0.21);
    assert.equal(profile.lastSession.cacheRead, 135559);
    // Most expensive model first, so the row reads as "what did this cost".
    assert.deepEqual(
      profile.lastSession.models.map((m) => m.model),
      ["claude-opus-5", "claude-haiku-4-5"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A number past the Date range would otherwise reach new Date(x).toISOString()
// in every consumer and throw there instead of being rejected here.
test("readProfile rejects a lastStartTime outside the Date range", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-quota-"));
  try {
    writeFileSync(
      path.join(dir, ".claude.json"),
      JSON.stringify({ projects: { "/p": { lastStartTime: 1e16, lastCost: 2 } } })
    );
    assert.equal((await readProfile(dir, NOW)).lastSession, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readProfile also accepts an ISO lastStartTime", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-quota-"));
  try {
    writeFileSync(
      path.join(dir, ".claude.json"),
      JSON.stringify({ projects: { "/p": { lastStartTime: "2026-08-13T07:00:00.000Z", lastCost: 2 } } })
    );
    const profile = await readProfile(dir, NOW);
    assert.equal(profile.lastSession.startedAt, Date.parse("2026-08-13T07:00:00.000Z"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
