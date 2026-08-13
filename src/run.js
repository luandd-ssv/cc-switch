import { accessSync, constants, statSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { claudeHomeDir } from "./accounts.js";

export function buildEnv(account) {
  return {
    ...process.env,
    CLAUDE_CONFIG_DIR: claudeHomeDir(account.name),
  };
}

// We walk PATH ourselves for two reasons. spawn's ENOENT/"error" event is
// unreliable for the Windows .cmd shim, and runClaude needs the resolved
// path anyway so it can spawn the target directly instead of through a shell.
// A PATH entry only counts if it is a runnable file. Windows decides that by
// extension (PATHEXT), POSIX by the execute bit; without this check a
// directory named "claude", or a non-executable file, would look like a hit.
function isExecutableFile(p) {
  try {
    if (!statSync(p).isFile()) return false;
    if (process.platform !== "win32") accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveOnPath(bin, env = process.env) {
  const exts =
    process.platform === "win32"
      ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];

  // An explicit path (./claude, /usr/local/bin/claude) is used as given.
  if (bin.includes("/") || bin.includes("\\")) {
    for (const ext of ["", ...exts]) {
      if (isExecutableFile(bin + ext)) return bin + ext;
    }
    return null;
  }

  // Windows reads PATH case-insensitively; a plain object spread of
  // process.env does not, so check the spellings we might have been handed.
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    // Quoted PATH entries are legal on Windows: "C:\Program Files\x".
    const clean = dir.replace(/^"(.*)"$/, "$1");
    for (const ext of exts) {
      const candidate = path.join(clean, bin + ext);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

export function isOnPath(bin, env = process.env) {
  return resolveOnPath(bin, env) !== null;
}

// cmd.exe receives the command line verbatim, so each argument has to be
// quoted by hand. The surrounding quotes neutralise cmd's metacharacters
// (& | < > ^ parentheses); doubling the backslashes that precede a quote or
// the end of the argument is what the Windows CRT expects when it splits the
// line back into argv.
export function quoteForCmd(arg) {
  const escaped = String(arg)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, "$1$1");
  return `"${escaped}"`;
}

function isBatchShim(file) {
  return /\.(cmd|bat)$/i.test(file);
}

function exitCodeFor(code, signal) {
  if (signal) return 128 + (os.constants.signals[signal] ?? 0);
  return code ?? 0;
}

export function runClaude(args, env, bin = "claude") {
  const resolved = resolveOnPath(bin, env);
  if (!resolved) {
    return Promise.reject(
      new Error(
        `Could not find "${bin}" on your PATH. Install it first: npm install -g @anthropic-ai/claude-code`
      )
    );
  }

  // Node refuses to spawn a .cmd/.bat without a shell (CVE-2024-27980), and
  // spawn's own shell:true concatenates argv without escaping, which splits
  // arguments on spaces and lets & or | run arbitrary commands. So we build
  // the cmd.exe line ourselves and pass it verbatim.
  let file = resolved;
  let spawnArgs = args;
  let options = { stdio: "inherit", env };

  // Known residue: cmd.exe expands %VAR% in the line before the shim sees it,
  // and a raw command line offers no way to escape a percent sign. An argument
  // containing %SOMETHING% therefore arrives expanded on Windows when claude
  // is an npm .cmd shim. Native installs resolve to claude.exe and skip this.
  if (process.platform === "win32" && isBatchShim(resolved)) {
    const line = [resolved, ...args].map(quoteForCmd).join(" ");
    file = env.ComSpec || env.COMSPEC || "cmd.exe";
    spawnArgs = ["/d", "/s", "/c", `"${line}"`];
    options = { ...options, windowsVerbatimArguments: true };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(file, spawnArgs, options);
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(exitCodeFor(code, signal)));
  });
}
