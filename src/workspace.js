import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeHomeDir } from "./accounts.js";

const ALWAYS_SHARED_DIRS = ["agents", "skills"];
// "projects" holds Claude Code's session transcripts (~/.claude/projects/<path>/<session-id>.jsonl).
// Sharing it means every account sees the same conversation history for a given project.
const HISTORY_DIR = "projects";

export function globalClaudeDir() {
  return path.join(os.homedir(), ".claude");
}

// Single source of truth for which directories an account links, so `status`
// reports on exactly the set that ensureClaudeHome maintains.
export function sharedDirsFor(shareHistory = true) {
  return shareHistory ? [...ALWAYS_SHARED_DIRS, HISTORY_DIR] : [...ALWAYS_SHARED_DIRS];
}

// fs.stat, not fs.access: on Windows fs.access succeeds on a junction whose
// target is gone, which would make a broken link look healthy. stat follows
// the link and fails, which is the answer we actually want here.
async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function lstatOrNull(p) {
  try {
    return await fs.lstat(p);
  } catch {
    return null;
  }
}

// Link ~/.claude/<dirName> into the account's claude-home so agents/skills
// stay shared across accounts, while credentials/identity stay isolated.
// Safe to call repeatedly: an existing healthy link or a real directory is
// left alone, and a link whose target has gone away is rebuilt.
async function linkShared(sharedSrc, dest) {
  if (!(await exists(sharedSrc))) return;

  const existing = await lstatOrNull(dest);
  if (existing) {
    // A real directory means the user (or Claude Code) put something there,
    // so we keep it rather than replacing their data with a link.
    if (!existing.isSymbolicLink()) return;
    if (await exists(dest)) return; // healthy link, nothing to do
    await fs.unlink(dest); // dangling link: the shared dir was moved or deleted
  }

  const type = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(sharedSrc, dest, type);
}

export async function ensureClaudeHome(name, { shareHistory = true } = {}) {
  const home = claudeHomeDir(name);
  await fs.mkdir(home, { recursive: true, mode: 0o700 });

  const globalDir = globalClaudeDir();
  for (const dirName of sharedDirsFor(shareHistory)) {
    await linkShared(path.join(globalDir, dirName), path.join(home, dirName));
  }

  return home;
}
