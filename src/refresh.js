import { resolveOnPath, runClaudeQuiet } from "./run.js";
import { readProfile } from "./quota.js";

export const REFRESH_DEFAULTS = {
  // How old the cache is allowed to get before cc-switch actively asks
  // Claude Code to refresh it, instead of only reading whatever is on disk.
  staleMinutes: 3,
  // No matter how low --stale-after/--interval is set, a refresh is never
  // attempted more often than this. Claude Code has its own internal
  // cooldown on actually re-fetching quota (measured: a repeat "/usage" call
  // inside roughly 90-150s exits cleanly but leaves the cache untouched), so
  // polling faster than this window only produces "no-update" results that
  // look exactly like an expired login.
  minStaleMinutes: 3,
  // `claude -p "/usage"` measures well under 5s in practice; this is a
  // backstop against a wedged child, not the expected duration.
  timeoutMs: 20000,
  // Each refresh is a real Claude Code process. Capping how many run at once
  // keeps a status/dashboard call from launching one per account
  // simultaneously when there are many accounts.
  maxConcurrent: 3,
  // Ceiling on the whole refresh pass, not on one child. timeoutMs alone
  // bounds a single spawn, so N stale accounts still cost
  // ceil(N / maxConcurrent) * timeoutMs -- a minute of a silent, apparently
  // hung `cc-switch status` (or of a held-open /api/status request) once a few
  // accounts are stale and claude is wedged or offline. Past this budget the
  // remaining accounts are simply left for the next call, which is the same
  // outcome they already get when they are not due yet.
  budgetMs: 25000,
};

// An account that cannot open a session gains nothing from a refresh: the
// spawn would just fail. "keychain" (macOS) is not the same as logged out --
// it means there is no per-account credentials file to inspect, not that the
// shared login is missing. But macOS reports "keychain" for every account
// including one that has never completed a first login, so configFound (a
// .claude.json exists at all) is the only local signal there that this
// account has actually been used before.
function canAttempt(account) {
  const state = account.login?.state;
  if (state === "logged-in") return true;
  if (state === "keychain") return account.profile?.configFound === true;
  return false;
}

// Single source of truth for the threshold that was actually applied, so the
// CLI header, the dashboard footer and refreshStale itself cannot disagree
// about it: asking for 1 minute and being told "older than 1 min" while the
// floor silently held it at 3 is worse than being told the floor.
export function effectiveStaleMinutes(requested) {
  return Math.max(requested ?? REFRESH_DEFAULTS.staleMinutes, REFRESH_DEFAULTS.minStaleMinutes);
}

export function isStale(quota, now, staleMs) {
  if (!quota?.available || quota.fetchedAt == null) return true;
  return now - quota.fetchedAt >= staleMs;
}

// When the last automatic attempt for an account was started, keyed by home.
//
// isStale() cannot rate-limit an account on its own, because with no
// fetchedAtMs to compare against it is unconditionally true. So an account
// whose cache never materialises -- an expired login, or any setup whose
// "/usage" writes no cachedUsageUtilization -- would be retried on every
// single `cc-switch status` and every dashboard poll for as long as the tab
// stays open, spawning a full Claude Code process each time and repeating the
// same misleading "your login may have expired" note. Remembering that the
// attempt happened is the only floor that survives the case where the
// timestamp we would otherwise measure does not exist.
//
// This lives on the scheduler, not on refreshQuota: an explicit, caller-driven
// refresh should always be allowed to run.
const lastAttemptAt = new Map();

// Exposed for tests, which need a clean slate per case rather than state that
// leaks between them.
export function clearRefreshBackoff() {
  lastAttemptAt.clear();
}

function offCooldown(home, now, staleMs) {
  const last = lastAttemptAt.get(home);
  return last == null || now - last >= staleMs;
}

// One in-flight refresh per account home at a time, for the life of this
// process: two overlapping callers -- two dashboard tabs polling, or a
// manual Refresh click landing while a scheduled poll is still running --
// join the same attempt instead of each spawning their own `claude -p
// /usage` against the same .claude.json. This only guards a single process;
// it does not stop a *separate* `cc-switch status`/`run` invocation from
// racing this one, which would need a cross-process lock file.
const inFlight = new Map();

// Refreshes one account's cached quota by asking Claude Code itself: running
// `/usage` is exactly what makes the CLI call the same endpoint it already
// polls in the background and write the answer into that account's
// .claude.json -- the only place cc-switch ever reads quota from. Comparing
// the cache's fetchedAtMs before and after is how a silent failure (a
// clean-looking exit that leaves the cache untouched, almost always an
// expired login) is told apart from a genuine refresh -- and a non-zero
// exit is kept as its own reason rather than folded into that, since a
// broken `claude` install has nothing to do with any account's login.
export function refreshQuota(account, env = process.env, opts = {}) {
  const existing = inFlight.get(account.home);
  if (existing) return existing;

  const promise = doRefreshQuota(account, env, opts).finally(() => {
    inFlight.delete(account.home);
  });
  inFlight.set(account.home, promise);
  return promise;
}

async function doRefreshQuota(account, env, opts) {
  const { claudeBin, timeoutMs = REFRESH_DEFAULTS.timeoutMs, now = Date.now() } = opts;
  const bin = claudeBin ?? resolveOnPath("claude", env);
  if (!bin) return { name: account.name, ok: false, attempted: false, reason: "claude-not-found" };

  const before = (await readProfile(account.home, now)).quota.fetchedAt;
  let exitCode;
  try {
    exitCode = await runClaudeQuiet(["-p", "/usage"], { ...env, CLAUDE_CONFIG_DIR: account.home }, bin, { timeoutMs });
  } catch (err) {
    return { name: account.name, ok: false, attempted: true, reason: "spawn-error", error: err.message };
  }

  const after = (await readProfile(account.home, now)).quota.fetchedAt;
  if (after != null && after !== before) {
    return { name: account.name, ok: true, attempted: true };
  }
  if (exitCode !== 0) {
    return {
      name: account.name,
      ok: false,
      attempted: true,
      reason: "exit-nonzero",
      error: `claude exited with code ${exitCode}`,
    };
  }
  return { name: account.name, ok: false, attempted: true, reason: "no-update" };
}

// Refreshes every account whose cache is missing or older than staleMinutes
// and that is not still inside its own post-attempt cooldown, a few at a time
// (maxConcurrent): each is an independent child process, so nothing is gained
// by running them one at a time, but running all of them at once does not
// scale to many accounts. The pass as a whole gives up after budgetMs so a
// wedged claude cannot stall the caller for one timeout per batch. Returns []
// without spawning anything if claude cannot be resolved at all.
export async function refreshStale(accounts, env = process.env, opts = {}) {
  const { now = Date.now() } = opts;
  const claudeBin = opts.claudeBin ?? resolveOnPath("claude", env);
  if (!claudeBin) return [];

  const staleMs = effectiveStaleMinutes(opts.staleMinutes) * 60000;
  const due = accounts.filter(
    (a) => canAttempt(a) && isStale(a.profile?.quota, now, staleMs) && offCooldown(a.home, now, staleMs)
  );
  if (due.length === 0) return [];

  const limit = Math.max(1, opts.maxConcurrent ?? REFRESH_DEFAULTS.maxConcurrent);
  const budgetMs = opts.budgetMs ?? REFRESH_DEFAULTS.budgetMs;
  // Measured against the real clock, not `now`: `now` is the caller's
  // as-of stamp for the whole report and may already be seconds old.
  const startedAt = Date.now();
  const results = [];
  for (let i = 0; i < due.length; i += limit) {
    // Checked between batches rather than mid-batch: a spawn already under way
    // is bounded by its own timeoutMs, and abandoning it would leave a child
    // writing to .claude.json with nobody watching. Accounts left unattempted
    // simply stay due for the next call.
    if (i > 0 && Date.now() - startedAt >= budgetMs) break;
    const batch = due.slice(i, i + limit);
    for (const account of batch) lastAttemptAt.set(account.home, Date.now());
    const settled = await Promise.allSettled(batch.map((a) => refreshQuota(a, env, { ...opts, claudeBin, now })));
    settled.forEach((result, j) => {
      results.push(
        result.status === "fulfilled"
          ? result.value
          : { name: batch[j].name, ok: false, attempted: true, reason: "error", error: result.reason?.message }
      );
    });
  }
  return results;
}
