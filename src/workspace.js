import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeHomeDir } from "./accounts.js";

const ALWAYS_SHARED_DIRS = ["agents", "skills"];
// "projects" holds Claude Code's session transcripts (~/.claude/projects/<path>/<session-id>.jsonl).
// Sharing it means every account sees the same conversation history for a given project.
const HISTORY_DIR = "projects";

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Link ~/.claude/<dirName> into the account's claude-home so agents/skills
// stay shared across accounts, while credentials/identity stay isolated.
async function linkShared(sharedSrc, dest) {
  if (!(await exists(sharedSrc))) return;
  if (await exists(dest)) return; // already linked (or a real dir) — leave as-is
  const type = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(sharedSrc, dest, type);
}

export async function ensureClaudeHome(name, { shareHistory = true } = {}) {
  const home = claudeHomeDir(name);
  await fs.mkdir(home, { recursive: true });

  const globalClaudeDir = path.join(os.homedir(), ".claude");
  const dirsToShare = shareHistory
    ? [...ALWAYS_SHARED_DIRS, HISTORY_DIR]
    : ALWAYS_SHARED_DIRS;
  for (const dirName of dirsToShare) {
    await linkShared(path.join(globalClaudeDir, dirName), path.join(home, dirName));
  }

  return home;
}
