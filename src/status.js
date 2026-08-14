import { promises as fs } from "node:fs";
import path from "node:path";
import { accountsDir, claudeHomeDir, getCurrent, listAccounts, rootDir } from "./accounts.js";
import { globalClaudeDir, sharedDirsFor } from "./workspace.js";
import { resolveOnPath } from "./run.js";
import { formatDuration, readProfile, recommendAccounts, windowFor } from "./quota.js";
import { effectiveStaleMinutes, refreshStale } from "./refresh.js";

const CREDENTIALS_FILE = ".credentials.json";

// Claude Code keeps subscription credentials in the macOS Keychain, and
// CLAUDE_CONFIG_DIR does not move them there. On Linux and Windows it writes
// .credentials.json inside the config dir, so the file tells us whether this
// account has been logged in. On macOS there is nothing on disk to inspect.
const CREDENTIALS_ON_DISK = process.platform !== "darwin";

async function statOrNull(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function lstatOrNull(p) {
  try {
    return await fs.lstat(p);
  } catch {
    return null;
  }
}

async function describeLink(accountHome, globalDir, dirName) {
  const dest = path.join(accountHome, dirName);
  const link = await lstatOrNull(dest);

  if (!link) {
    // Nothing here. Either the global directory is missing too, or the link
    // has yet to be applied.
    const source = await statOrNull(path.join(globalDir, dirName));
    return { dir: dirName, state: source ? "unlinked" : "absent" };
  }
  if (!link.isSymbolicLink()) {
    return { dir: dirName, state: "local" };
  }
  const target = await statOrNull(dest);
  return { dir: dirName, state: target ? "shared" : "broken" };
}

async function describeLogin(accountHome) {
  if (!CREDENTIALS_ON_DISK) return { state: "keychain", detail: "macOS Keychain, not per-account" };
  const stat = await statOrNull(path.join(accountHome, CREDENTIALS_FILE));
  if (!stat) return { state: "logged-out", detail: null };
  return { state: "logged-in", detail: stat.mtime.toISOString() };
}

// The closest thing to "last used" that cc-switch can see without tracking
// usage. Only signals the quota auto-refresh (refresh.js) cannot forge count:
//
// - .claude.json's mtime is excluded outright, since a refresh rewrites that
//   file every time it runs. Once an account had been refreshed even once its
//   mtime would mean "last polled", not "last used".
// - .credentials.json's mtime is excluded for the same reason, less obviously:
//   Claude Code rewrites it whenever it rotates the OAuth access token, which
//   a refresh will do for us as soon as the token is near expiry. It survives
//   only as a last-resort fallback below, where there is no activity to report
//   and "logged in at" beats "never".
// - project.lastStartTime (surfaced through the profile's lastSession) and
//   history.jsonl both move only when a session really starts, so they are
//   what this prefers.
async function lastActiveAt(accountHome, profile) {
  let newest = null;
  const historyStat = await statOrNull(path.join(accountHome, "history.jsonl"));
  if (historyStat) newest = historyStat.mtime.getTime();

  const sessionStartedAt = profile?.lastSession?.startedAt;
  if (sessionStartedAt != null && (newest == null || sessionStartedAt > newest)) newest = sessionStartedAt;
  if (newest != null) return new Date(newest).toISOString();

  // Nothing but a login to go on: an account that has been authenticated but
  // never run still reads better as its login time than as "never".
  const credentialsStat = await statOrNull(path.join(accountHome, CREDENTIALS_FILE));
  return credentialsStat ? credentialsStat.mtime.toISOString() : null;
}

export async function collectStatus(env = process.env, options = {}) {
  const { recommend, refresh } = options;
  // A caller that pins `now` wants a reproducible report, so its clock is left
  // alone. Everyone else gets it re-stamped after a refresh below.
  const pinnedNow = options.now;
  let now = pinnedNow ?? Date.now();

  const current = await getCurrent();
  const globalDir = globalClaudeDir();
  const claudeBin = resolveOnPath("claude", env);
  const accounts = [];

  for (const account of await listAccounts()) {
    const shareHistory = account.shareHistory !== false;
    const home = claudeHomeDir(account.name);
    const links = [];
    for (const dirName of sharedDirsFor(shareHistory)) {
      links.push(await describeLink(home, globalDir, dirName));
    }
    const profile = await readProfile(home, now);
    accounts.push({
      name: account.name,
      active: account.name === current,
      shareHistory,
      home,
      login: await describeLogin(home),
      links,
      lastActive: await lastActiveAt(home, profile),
      profile,
    });
  }

  // Actively top up any cache older than the threshold before anything below
  // reads it, so `status`/the dashboard show quota that is at most a few
  // minutes stale instead of however long it has been since this account was
  // last launched. A missing claude binary or refresh:false both no-op here
  // rather than spawning anything.
  const refreshOn = refresh !== false && !!claudeBin;
  const refreshResults = refreshOn ? await refreshStale(accounts, env, { ...refresh, now, claudeBin }) : [];
  // Effective threshold, clamped the same way refreshStale clamps it -- this
  // is what actually happened, not just what was asked for, and it is what
  // the QUOTA header below and the JSON output report.
  const staleMinutes = refreshOn ? effectiveStaleMinutes(refresh?.staleMinutes) : null;

  // A refresh spawns real processes, so it can easily have taken tens of
  // seconds. Everything read before it is now that much out of date: the new
  // fetchedAtMs is *later* than the `now` this report was stamped with, which
  // would make "as of" ages come out negative, and a window that rolled over
  // during the refresh would still be summarised as fresh against the old
  // clock. Re-stamping and re-reading every account (not just the refreshed
  // ones) keeps the whole report on one clock.
  if (refreshResults.some((r) => r.attempted)) {
    if (pinnedNow == null) now = Date.now();
    for (const account of accounts) {
      account.profile = await readProfile(account.home, now);
      account.lastActive = await lastActiveAt(account.home, account.profile);
    }
  }

  const warnings = [];

  if (!claudeBin) {
    warnings.push('claude is not on your PATH. Install it with "npm install -g @anthropic-ai/claude-code".');
  }
  if (accounts.length === 0) {
    warnings.push('No accounts yet. Create one with "cc-switch add <name>".');
  } else if (!current) {
    warnings.push('No active account. Pick one with "cc-switch use <name>".');
  }
  if (current && !accounts.some((a) => a.name === current)) {
    warnings.push(`Active account "${current}" has no account.json. Re-add it or switch to another account.`);
  }
  for (const account of accounts) {
    for (const link of account.links) {
      if (link.state === "broken") {
        warnings.push(`${account.name}: the ${link.dir} link is broken. "cc-switch use ${account.name}" rebuilds it.`);
      }
      if (link.state === "absent") {
        warnings.push(`${account.name}: ~/.claude/${link.dir} does not exist yet, so nothing is shared for it.`);
      }
    }
  }
  if (!CREDENTIALS_ON_DISK) {
    warnings.push(
      "On macOS, Claude Code stores subscription credentials in the Keychain rather than under CLAUDE_CONFIG_DIR, so accounts share one login. Isolation covers settings and history only."
    );
  }
  for (const result of refreshResults) {
    if (result.ok) continue;
    if (result.reason === "no-update") {
      // A refresh that ran and left the cache byte-for-byte where it started
      // almost always means the saved login no longer works -- the quiet way
      // an expired or revoked token shows up, since the child still exits
      // cleanly.
      warnings.push(
        `${result.name}: a quota refresh ran but the cache did not change. Its saved login may have expired -- re-authenticate with "cc-switch run" for that account.`
      );
    } else if (result.reason === "exit-nonzero") {
      // Distinct from no-update on purpose: a non-zero exit points at claude
      // itself (a broken install, an environment problem) rather than at
      // this account's login, and blaming the login here would send the
      // reader to fix the wrong thing.
      warnings.push(`${result.name}: the quota refresh failed -- ${result.error}.`);
    } else {
      // Everything else (spawn-error, error, claude-not-found) says the same
      // thing to the reader -- the refresh could not run -- and catching it
      // with an else rather than a list means a reason added later cannot be
      // dropped on the floor here.
      warnings.push(`${result.name}: could not run a quota refresh (${result.error ?? result.reason}).`);
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    root: rootDir(),
    accountsDir: accountsDir(),
    globalClaudeDir: globalDir,
    claudeBin,
    platform: process.platform,
    current,
    accounts,
    warnings,
    recommendations: recommendAccounts(accounts, recommend, now),
    quotaRefresh: { enabled: refreshOn, staleMinutes },
    // error is carried through so `--json` consumers see the same detail the
    // rendered warnings do, instead of a bare reason they cannot act on.
    refreshed: refreshResults.map((r) => ({
      name: r.name,
      ok: r.ok,
      reason: r.reason ?? null,
      error: r.error ?? null,
    })),
  };
}

function formatLinks(links) {
  const marks = { shared: "shared", local: "local", unlinked: "unlinked", broken: "BROKEN", absent: "n/a" };
  return links.map((l) => `${l.dir}:${marks[l.state]}`).join(" ");
}

function formatLastActive(iso) {
  if (!iso) return "never";
  return iso.slice(0, 16).replace("T", " ");
}

// "default_claude_max_5x" is the tier the limits are derived from, but only the
// tail of it tells the reader anything.
function formatPlan(identity) {
  const tier = identity?.rateLimitTier ?? identity?.seatTier;
  if (!tier) return "-";
  return tier.replace(/^default_/, "").replace(/^claude_/, "");
}

function formatPercent(window) {
  if (!window) return "-";
  if (window.state === "fresh") return `${window.percent}%`;
  // Past its reset the cached number describes an allowance that no longer
  // exists, so it is withheld rather than shown as if it were current.
  if (window.state === "expired") return "-";
  return "?";
}

function formatResetIn(window) {
  if (!window || window.state !== "fresh") return "-";
  return formatDuration(window.msToReset);
}

function formatAsOf(quota, now) {
  if (!quota?.fetchedAt) return "never";
  const clock = new Date(quota.fetchedAt).toTimeString().slice(0, 5);
  const age = now - quota.fetchedAt;
  return age > 60000 ? `${clock} (${formatDuration(age)} ago)` : clock;
}

function renderTable(rows, columns) {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => String(col.value(row)).length))
  );
  const line = (cells) =>
    cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd();

  return [
    line(columns.map((c) => c.header)),
    ...rows.map((row) => line(columns.map((c) => c.value(row)))),
  ];
}

export function renderStatus(status) {
  const out = [];
  const loginLabels = { "logged-in": "yes", "logged-out": "no", keychain: "keychain" };

  out.push(`platform       ${status.platform}`);
  out.push(`config root    ${status.root}`);
  out.push(`shared from    ${status.globalClaudeDir}`);
  out.push(`claude binary  ${status.claudeBin ?? "not found on PATH"}`);
  out.push(`active account ${status.current ?? "(none)"}`);
  out.push("");

  if (status.accounts.length === 0) {
    out.push("No accounts.");
  } else {
    out.push(
      ...renderTable(status.accounts, [
        { header: "", value: (a) => (a.active ? "*" : " ") },
        { header: "ACCOUNT", value: (a) => a.name },
        { header: "HISTORY", value: (a) => (a.shareHistory ? "shared" : "isolated") },
        { header: "LOGIN", value: (a) => loginLabels[a.login.state] },
        { header: "LAST ACTIVE", value: (a) => formatLastActive(a.lastActive) },
        { header: "SHARED LINKS", value: (a) => formatLinks(a.links) },
      ])
    );
  }

  const now = Date.parse(status.generatedAt);
  const withQuota = status.accounts.filter((a) => a.profile?.quota?.available);
  if (withQuota.length > 0) {
    out.push("");
    out.push(
      status.quotaRefresh?.enabled
        ? `QUOTA  (auto-refreshed via "claude -p /usage" when a cache is older than ${status.quotaRefresh.staleMinutes} min)`
        : "QUOTA  (refresh disabled -- showing whatever is already cached on disk)"
    );
    out.push(
      ...renderTable(withQuota, [
        { header: "", value: (a) => (a.active ? "*" : " ") },
        { header: "ACCOUNT", value: (a) => a.name },
        { header: "PLAN", value: (a) => formatPlan(a.profile.identity) },
        { header: "5H", value: (a) => formatPercent(windowFor(a.profile.quota, "five_hour")) },
        { header: "7D", value: (a) => formatPercent(windowFor(a.profile.quota, "seven_day")) },
        { header: "RESET IN", value: (a) => formatResetIn(windowFor(a.profile.quota, "five_hour")) },
        { header: "AS OF", value: (a) => formatAsOf(a.profile.quota, now) },
      ])
    );
  }

  const candidates = status.recommendations?.candidates ?? [];
  if (candidates.length > 0) {
    out.push("");
    out.push(candidates.length === 1 ? "1 suggestion:" : `${candidates.length} suggestions:`);
    for (const c of candidates) out.push(`  - ${c.title}: ${c.body}`);
  }

  if (status.warnings.length > 0) {
    out.push("");
    out.push(status.warnings.length === 1 ? "1 note:" : `${status.warnings.length} notes:`);
    for (const warning of status.warnings) out.push(`  - ${warning}`);
  }

  return out.join("\n");
}
