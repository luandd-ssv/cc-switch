import { promises as fs } from "node:fs";
import path from "node:path";

const CONFIG_FILE = ".claude.json";

// Claude Code caches the rate-limit response it gets from the server into
// .claude.json, and cc-switch gives every account its own copy of that file.
// Reading it is therefore the only way to show per-account quota without
// talking to any API or spending quota to find out how much is left.
const WINDOWS = [
  { key: "five_hour", label: "5h", limitKind: "session" },
  { key: "seven_day", label: "7d", limitKind: "weekly_all" },
];

// The window cc-switch plans around: the one that decides "can I keep working
// on this account right now".
export const PRIMARY_WINDOW = "five_hour";

export const RECOMMEND_DEFAULTS = {
  // "About to reset": the window closes within this many minutes.
  resetWithinMinutes: 60,
  // "Still has headroom": at most this much of the window has been consumed.
  headroomBelowPercent: 70,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(file) {
  // A missing file means the account has never been launched, which is final.
  // A malformed one almost always means Claude Code is mid-write, and giving up
  // on that read would report a live account as never launched -- for a whole
  // poll interval, since the page only re-checks hourly. One retry tells the two
  // apart without failing the dashboard either way.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      if (attempt === 0) await sleep(40);
    }
  }
  return null;
}

function pickIdentity(config) {
  const account = config?.oauthAccount;
  if (!account) return null;
  return {
    email: account.emailAddress ?? null,
    displayName: account.displayName ?? null,
    organization: account.organizationName ?? null,
    organizationRole: account.organizationRole ?? null,
    seatTier: account.seatTier ?? null,
    // "default_claude_max_5x" and friends: the plan tier the limits come from.
    rateLimitTier: account.userRateLimitTier ?? null,
    billingType: account.billingType ?? null,
    extraUsageEnabled: account.hasExtraUsageEnabled === true,
    profileFetchedAt: account.profileFetchedAt ?? null,
  };
}

function severityFor(utilization, limitKind) {
  const limits = Array.isArray(utilization?.limits) ? utilization.limits : [];
  const match = limits.find((l) => l.kind === limitKind && !l.scope);
  return match?.severity ?? null;
}

// A percentage is only meaningful until its window rolls over: past resets_at
// the server has already granted a fresh allowance that this cache never saw,
// so reporting the old number would overstate usage. "expired" says exactly
// that, instead of quietly showing a stale figure.
function summarizeWindow({ key, label, limitKind }, utilization, now) {
  const raw = utilization?.[key];
  if (!raw || typeof raw.utilization !== "number") {
    return { key, label, state: "unknown", percent: null, resetsAt: null, msToReset: null };
  }

  const resetsAt = raw.resets_at ? Date.parse(raw.resets_at) : NaN;
  const severity = severityFor(utilization, limitKind);
  if (!Number.isFinite(resetsAt)) {
    return { key, label, state: "unknown", percent: raw.utilization, resetsAt: null, msToReset: null, severity };
  }
  if (resetsAt <= now) {
    return { key, label, state: "expired", percent: null, resetsAt, msToReset: 0, severity };
  }
  return {
    key,
    label,
    state: "fresh",
    percent: raw.utilization,
    resetsAt,
    msToReset: resetsAt - now,
    severity,
  };
}

function pickExtraUsage(utilization) {
  const extra = utilization?.extra_usage;
  if (!extra) return null;
  return {
    enabled: extra.is_enabled === true,
    usedCredits: extra.used_credits ?? null,
    monthlyLimit: extra.monthly_limit ?? null,
    currency: extra.currency ?? "USD",
    disabledReason: extra.disabled_reason ?? null,
    spendLimitReached: extra.spend_limit_reached === true,
  };
}

export function summarizeQuota(cache, now = Date.now()) {
  const utilization = cache?.utilization;
  if (!utilization) {
    return { available: false, fetchedAt: null, windows: [], extraUsage: null };
  }
  return {
    available: true,
    fetchedAt: typeof cache.fetchedAtMs === "number" ? cache.fetchedAtMs : null,
    windows: WINDOWS.map((w) => summarizeWindow(w, utilization, now)),
    extraUsage: pickExtraUsage(utilization),
  };
}

function modelBreakdown(usage) {
  if (!usage || typeof usage !== "object") return [];
  return Object.entries(usage)
    .map(([model, m]) => ({
      model,
      cost: m?.costUSD ?? 0,
      input: m?.inputTokens ?? 0,
      output: m?.outputTokens ?? 0,
      cacheRead: m?.cacheReadInputTokens ?? 0,
      cacheCreation: m?.cacheCreationInputTokens ?? 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

// The largest value the Date type can hold. A number past it is not a date, and
// letting one through would make new Date(x).toISOString() throw in every
// consumer instead of here.
const MAX_EPOCH_MS = 8.64e15;

// Claude Code writes lastStartTime as epoch milliseconds, but stamps other
// timestamps as ISO strings, so this accepts either rather than betting on one.
function toEpoch(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) <= MAX_EPOCH_MS ? value : null;
  }
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

// Claude Code overwrites these last* fields per project on every session, so
// this is a snapshot of one session rather than a running total. It is free to
// read, which is the whole point: no transcript scan, no attribution hook.
function pickLastSession(config) {
  const projects = config?.projects;
  if (!projects || typeof projects !== "object") return null;

  let best = null;
  for (const [dir, project] of Object.entries(projects)) {
    const startedAt = toEpoch(project?.lastStartTime);
    if (startedAt === null) continue;
    if (!best || startedAt > best.startedAt) best = { dir, project, startedAt };
  }
  if (!best) return null;

  const { dir, project, startedAt } = best;
  return {
    project: dir,
    startedAt,
    sessionId: project.lastSessionId ?? null,
    cost: project.lastCost ?? null,
    durationMs: project.lastDuration ?? null,
    input: project.lastTotalInputTokens ?? 0,
    output: project.lastTotalOutputTokens ?? 0,
    cacheRead: project.lastTotalCacheReadInputTokens ?? 0,
    cacheCreation: project.lastTotalCacheCreationInputTokens ?? 0,
    linesAdded: project.lastLinesAdded ?? 0,
    linesRemoved: project.lastLinesRemoved ?? 0,
    models: modelBreakdown(project.lastModelUsage),
  };
}

export async function readProfile(accountHome, now = Date.now()) {
  const config = await readJson(path.join(accountHome, CONFIG_FILE));
  if (!config) {
    return { configFound: false, identity: null, quota: summarizeQuota(null, now), lastSession: null };
  }
  return {
    configFound: true,
    identity: pickIdentity(config),
    quota: summarizeQuota(config.cachedUsageUtilization, now),
    lastSession: pickLastSession(config),
    startups: config.numStartups ?? null,
  };
}

export function windowFor(quota, key = PRIMARY_WINDOW) {
  return quota?.windows?.find((w) => w.key === key) ?? null;
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "now";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  // Past a couple of days "165h32m" stops being readable, and the weekly
  // window is always in that range.
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? `${days}d${restHours}h` : `${days}d`;
  }
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}m` : `${hours}h`;
}

// An account is worth recommending when its 5-hour window is about to roll
// over while a good chunk of it is still unused: that allowance disappears at
// the reset, so spending it first wastes nothing.
export function recommendAccounts(accounts, options = {}, now = Date.now()) {
  const thresholds = { ...RECOMMEND_DEFAULTS, ...options };
  const withinMs = thresholds.resetWithinMinutes * 60000;

  const candidates = [];
  for (const account of accounts) {
    // Quota left in a window this account cannot open is not worth suggesting:
    // acting on it lands the reader at an OAuth prompt, not at a session.
    if (account.login?.state === "logged-out") continue;

    const window = windowFor(account.profile?.quota);
    if (!window || window.state !== "fresh") continue;
    if (window.msToReset > withinMs) continue;
    if (window.percent > thresholds.headroomBelowPercent) continue;

    // Wording lives here so the CLI, the page and the browser notification
    // cannot drift apart. The page re-renders the countdown against its own
    // clock between polls, so it gets the sentence with a hole in it too --
    // otherwise its banner would still read "resets in 42m" an hour later.
    const bodyFor = (resetIn) =>
      `5h window resets in ${resetIn} with only ${window.percent}% used. Spend it before it rolls over.`;

    candidates.push({
      account: account.name,
      percent: window.percent,
      msToReset: window.msToReset,
      resetsAt: new Date(window.resetsAt).toISOString(),
      title: `Use ${account.name} now`,
      body: bodyFor(formatDuration(window.msToReset)),
      bodyTemplate: bodyFor("{resetIn}"),
    });
  }

  // Most headroom first, then whichever window closes soonest.
  candidates.sort((a, b) => a.percent - b.percent || a.msToReset - b.msToReset);
  return { thresholds, candidates };
}
