#!/usr/bin/env node
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

const program = new Command();
program
  .name("cc-switch")
  .description(
    "Switch between multiple Claude Code accounts without re-authenticating"
  )
  .enablePositionalOptions(true);

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
    await saveAccount(name, { shareHistory });
    await ensureClaudeHome(name, { shareHistory });

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
    console.log(`Active account: ${name}`);
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
    const env = buildEnv(account);
    const code = await runClaude(args, env);
    process.exitCode = code;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
