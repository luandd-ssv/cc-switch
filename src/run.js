import { accessSync, constants, statSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
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

// Node refuses to spawn a .cmd/.bat without a shell (CVE-2024-27980), and
// spawn's own shell:true concatenates argv without escaping, which splits
// arguments on spaces and lets & or | run arbitrary commands. So we build
// the cmd.exe line ourselves and pass it verbatim. Shared by every spawn
// path (interactive launch and the quiet quota refresh alike) so the
// Windows shim handling cannot drift between them.
function planSpawn(bin, args, env) {
  const resolved = resolveOnPath(bin, env);
  if (!resolved) return null;

  let file = resolved;
  let spawnArgs = args;
  let extra = {};

  // Known residue: cmd.exe expands %VAR% in the line before the shim sees it,
  // and a raw command line offers no way to escape a percent sign. An argument
  // containing %SOMETHING% therefore arrives expanded on Windows when claude
  // is an npm .cmd shim. Native installs resolve to claude.exe and skip this.
  if (process.platform === "win32" && isBatchShim(resolved)) {
    const line = [resolved, ...args].map(quoteForCmd).join(" ");
    file = env.ComSpec || env.COMSPEC || "cmd.exe";
    spawnArgs = ["/d", "/s", "/c", `"${line}"`];
    extra = { windowsVerbatimArguments: true };
  }

  return { file, spawnArgs, extra };
}

function notFoundError(bin) {
  return new Error(
    `Could not find "${bin}" on your PATH. Install it first: npm install -g @anthropic-ai/claude-code`
  );
}

export function runClaude(args, env, bin = "claude") {
  const plan = planSpawn(bin, args, env);
  if (!plan) return Promise.reject(notFoundError(bin));

  const options = { stdio: "inherit", env, ...plan.extra };
  return new Promise((resolve, reject) => {
    const child = spawn(plan.file, plan.spawnArgs, options);
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(exitCodeFor(code, signal)));
  });
}

// Same launch, but headless and bounded: used for background quota refreshes
// (`claude -p "/usage"`) that must never print to this process's terminal and
// must never be able to hang cc-switch's own commands if the child wedges.
// run.js has no reason to import refresh.js's constants (refresh.js already
// imports this module), so the 20000 below is a generic fallback for any
// caller that omits timeoutMs -- refresh.js always passes its own
// REFRESH_DEFAULTS.timeoutMs explicitly and is the one to update if that
// number should change.
export function runClaudeQuiet(args, env, bin = "claude", { timeoutMs = 20000 } = {}) {
  const plan = planSpawn(bin, args, env);
  if (!plan) return Promise.reject(notFoundError(bin));

  const options = {
    stdio: "ignore",
    env,
    ...plan.extra,
    // On POSIX this makes the child the leader of its own process group,
    // which is what lets the timeout below signal the whole group instead
    // of just this one process. Windows has no equivalent spawn option;
    // taskkill /t covers that platform instead.
    ...(process.platform === "win32" ? {} : { detached: true }),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(plan.file, plan.spawnArgs, options);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // child.kill() only ever signals the one process handed back here. On
      // Windows, when claude resolved to a .cmd/.bat shim that process is
      // cmd.exe (see planSpawn above), and killing it leaves the real
      // claude/node process it launched underneath still running. On POSIX,
      // claude (or anything it forks -- an MCP server, a subagent) could
      // just as easily outlive its immediate wrapper. Either way, something
      // could keep writing to this account's .claude.json long after this
      // call has already reported a timeout and moved on, so the whole tree
      // has to come down, not just the one pid this promise was watching.
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => {});
      } else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill();
      }
      reject(new Error(`"${bin} ${args.join(" ")}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(exitCodeFor(code, signal));
    });
  });
}
