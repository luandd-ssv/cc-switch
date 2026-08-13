import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function rootDir() {
  return path.join(os.homedir(), ".cc-switch");
}

export function accountsDir() {
  return path.join(rootDir(), "accounts");
}

export function accountDir(name) {
  return path.join(accountsDir(), name);
}

export function claudeHomeDir(name) {
  return path.join(accountDir(name), "claude-home");
}

function currentFile() {
  return path.join(rootDir(), "current");
}

function assertValidName(name) {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid account name "${name}". Use only letters, numbers, "-" and "_".`
    );
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function listAccounts() {
  const dir = accountsDir();
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const accounts = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const account = await getAccount(entry.name);
      accounts.push(account);
    } catch {
      // skip malformed account dirs
    }
  }
  return accounts;
}

export async function getAccount(name) {
  assertValidName(name);
  const file = path.join(accountDir(name), "account.json");
  const raw = await fs.readFile(file, "utf8");
  const data = JSON.parse(raw);
  // The directory name is the one we validated, so it wins over any "name"
  // left in the JSON: that value feeds claudeHomeDir() and a stale copy
  // would silently point the account at another account's credentials.
  return { ...data, name };
}

export async function accountExists(name) {
  assertValidName(name);
  return exists(path.join(accountDir(name), "account.json"));
}

export async function saveAccount(name, data) {
  assertValidName(name);
  const dir = accountDir(name);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "account.json");
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
}

export async function removeAccount(name) {
  assertValidName(name);
  if (!(await accountExists(name))) {
    throw new Error(`Account "${name}" does not exist. Run "cc-switch list" to see them.`);
  }
  const current = await getCurrent();
  if (current === name) {
    throw new Error(
      `Cannot remove "${name}" while it is the active account. Run "cc-switch use <other>" first.`
    );
  }
  await fs.rm(accountDir(name), { recursive: true, force: true });
}

export async function getCurrent() {
  try {
    const raw = await fs.readFile(currentFile(), "utf8");
    const name = raw.trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function setCurrent(name) {
  assertValidName(name);
  if (!(await accountExists(name))) {
    throw new Error(`Account "${name}" does not exist. Run "cc-switch add ${name}" first.`);
  }
  await fs.mkdir(rootDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(currentFile(), name + "\n", "utf8");
}
