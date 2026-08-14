#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import {
  listAccounts,
  saveAccount,
  accountExists,
  getAccount,
  removeAccount,
  getCurrent,
  setCurrent,
} from "./accounts.js";
import { ensureClaudeHome } from "./workspace.js";
import { buildEnv, runClaude } from "./run.js";
import { collectStatus, renderStatus } from "./status.js";
import { DASHBOARD_DEFAULTS, openInBrowser, startDashboard } from "./dashboard.js";
import { RECOMMEND_DEFAULTS } from "./quota.js";
import { REFRESH_DEFAULTS } from "./refresh.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const program = new Command();
program
  .name("cc-switch")
  .description(
    "Switch between multiple Claude Code accounts without re-authenticating"
  )
  .version(pkg.version)
  .enablePositionalOptions(true);

// The shared links point at ~/.claude, which may not exist yet the first time
// someone runs `cc-switch add` on a fresh machine. Re-applying them whenever
// an account is selected or launched picks those directories up later instead
// of leaving the account permanently unshared.
async function syncClaudeHome(account) {
  return ensureClaudeHome(account.name, {
    shareHistory: account.shareHistory !== false,
  });
}

program
  .command("add <name>")
  .description("Add a new Claude Code account")
  .option("--share-history", "share conversation history across accounts", true)
  .option("--no-share-history", "keep this account's conversation history isolated")
  .action(async (name, opts) => {
    if (await accountExists(name)) {
      console.error(`Account "${name}" already exists. Remove it first or pick another name.`);
      process.exitCode = 1;
      return;
    }

    const shareHistory = opts.shareHistory;
    // Build the workspace first: if linking fails we leave no account.json
    // behind, so the user can fix the cause and re-run `add` as-is.
    await ensureClaudeHome(name, { shareHistory });
    await saveAccount(name, { shareHistory });

    console.log(
      `Added account "${name}" (history ${shareHistory ? "shared" : "isolated"}).`
    );
    const current = await getCurrent();
    if (!current) {
      await setCurrent(name);
      console.log(`Set "${name}" as the active account.`);
    }
  });

program
  .command("list")
  .description("List all accounts")
  .action(async () => {
    const accounts = await listAccounts();
    if (accounts.length === 0) {
      console.log('No accounts yet. Run "cc-switch add <name>" to create one.');
      return;
    }
    const current = await getCurrent();
    for (const acc of accounts) {
      const marker = acc.name === current ? "*" : " ";
      const historyNote = acc.shareHistory === false ? "isolated history" : "shared history";
      console.log(`${marker} ${acc.name}  [${historyNote}]`);
    }
  });

program
  .command("use <name>")
  .description("Set the active account")
  .action(async (name) => {
    await setCurrent(name);
    await syncClaudeHome(await getAccount(name));
    console.log(`Active account: ${name}`);
  });

function positiveInt(label) {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive whole number, got "${value}".`);
    }
    return parsed;
  };
}

program
  .command("status")
  .description(
    `Show every account with its login, history, shared-link state, and quota (auto-refreshed via "claude -p /usage" when a cache is older than ${REFRESH_DEFAULTS.staleMinutes} minutes)`
  )
  .option("--json", "print the same data as JSON")
  .option("--no-refresh", "skip the automatic quota refresh and only read what's already cached on disk")
  .option(
    "--stale-after <minutes>",
    "treat cached quota older than this as due for a refresh",
    positiveInt("--stale-after"),
    REFRESH_DEFAULTS.staleMinutes
  )
  .action(async (opts) => {
    const refresh = opts.refresh === false ? false : { staleMinutes: opts.staleAfter };
    const status = await collectStatus(process.env, { refresh });
    console.log(opts.json ? JSON.stringify(status, null, 2) : renderStatus(status));
  });

program
  .command("dashboard")
  .description("Serve a local web dashboard with per-account quota and reset countdowns")
  .option("-p, --port <number>", "port to listen on", positiveInt("--port"), DASHBOARD_DEFAULTS.port)
  .option("--host <address>", "loopback address to bind (127.0.0.1, localhost, ::1)", DASHBOARD_DEFAULTS.host)
  .option("--open", "open the dashboard in your browser")
  .option(
    "--interval <minutes>",
    'how often the page polls, and how old a cache may get before that poll actively refreshes it via "claude -p /usage"',
    positiveInt("--interval"),
    DASHBOARD_DEFAULTS.pollMinutes
  )
  .option("--no-refresh", "never actively refresh quota; only read what's already cached on disk")
  .option(
    "--reset-within <minutes>",
    "suggest an account whose 5-hour window resets within this many minutes",
    positiveInt("--reset-within"),
    RECOMMEND_DEFAULTS.resetWithinMinutes
  )
  .option(
    "--headroom-below <percent>",
    "only suggest an account that has used at most this much of the window",
    positiveInt("--headroom-below"),
    RECOMMEND_DEFAULTS.headroomBelowPercent
  )
  .action(async (opts) => {
    const { server, url } = await startDashboard({
      port: opts.port,
      host: opts.host,
      pollMinutes: opts.interval,
      refresh: opts.refresh === false ? false : undefined,
      recommend: {
        resetWithinMinutes: opts.resetWithin,
        headroomBelowPercent: opts.headroomBelow,
      },
    });

    console.log(`cc-switch dashboard on ${url}`);
    console.log("Press Ctrl+C to stop.");
    if (opts.open) openInBrowser(url);

    // Ctrl+C during a plain `listen` already exits, but closing the server
    // first lets an in-flight response finish instead of being cut off. That
    // wait used to be a file read; a response can now be blocked on a quota
    // refresh's child processes for tens of seconds, which would read as a
    // hang, so the graceful close gets a deadline rather than the whole
    // budget.
    process.on("SIGINT", () => {
      const forced = setTimeout(() => process.exit(0), 2000);
      forced.unref();
      server.close(() => process.exit(0));
    });
  });

program
  .command("current")
  .description("Show the active account")
  .action(async () => {
    const current = await getCurrent();
    console.log(current || "(none)");
  });

program
  .command("remove <name>")
  .description("Remove an account")
  .action(async (name) => {
    await removeAccount(name);
    console.log(`Removed account "${name}".`);
  });

program
  .command("run")
  .alias("code")
  .description("Launch `claude` using the active account's credentials")
  .allowUnknownOption(true)
  .passThroughOptions(true)
  .argument("[args...]", "arguments forwarded to the claude CLI")
  .action(async (args) => {
    const name = await getCurrent();
    if (!name) {
      console.error('No active account. Run "cc-switch use <name>" first.');
      process.exitCode = 1;
      return;
    }
    const account = await getAccount(name);
    await syncClaudeHome(account);
    const env = buildEnv(account);
    const code = await runClaude(args, env);
    process.exitCode = code;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
