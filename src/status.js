import { promises as fs } from "node:fs";
import path from "node:path";
import { accountsDir, claudeHomeDir, getCurrent, listAccounts, rootDir } from "./accounts.js";
import { globalClaudeDir, sharedDirsFor } from "./workspace.js";
import { resolveOnPath } from "./run.js";
import { formatDuration, readProfile, recommendAccounts, windowFor } from "./quota.js";

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

// Newest write among the files Claude Code touches per session, which is the
// closest thing to "last used" that cc-switch can see without tracking usage.
async function lastActiveAt(accountHome) {
  const candidates = [
    path.join(accountHome, CREDENTIALS_FILE),
    path.join(accountHome, ".claude.json"),
    path.join(accountHome, "history.jsonl"),
  ];
  let newest = null;
  for (const candidate of candidates) {
    const stat = await statOrNull(candidate);
    if (stat && (!newest || stat.mtime > newest)) newest = stat.mtime;
  }
  return newest ? newest.toISOString() : null;
}

export async function collectStatus(env = process.env, { now = Date.now(), recommend } = {}) {
  const current = await getCurrent();
  const globalDir = globalClaudeDir();
  const accounts = [];

  for (const account of await listAccounts()) {
    const shareHistory = account.shareHistory !== false;
    const home = claudeHomeDir(account.name);
    const links = [];
    for (const dirName of sharedDirsFor(shareHistory)) {
      links.push(await describeLink(home, globalDir, dirName));
    }
    accounts.push({
      name: account.name,
      active: account.name === current,
      shareHistory,
      home,
      login: await describeLogin(home),
      links,
      lastActive: await lastActiveAt(home),
      profile: await readProfile(home, now),
    });
  }

  const claudeBin = resolveOnPath("claude", env);
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
    out.push("QUOTA  (read from each account's cache, no API calls)");
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
