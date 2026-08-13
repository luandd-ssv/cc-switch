import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { claudeHomeDir } from "./accounts.js";

export function buildEnv(account) {
  return {
    ...process.env,
    CLAUDE_CONFIG_DIR: claudeHomeDir(account.name),
  };
}

// spawn's ENOENT/"error" event isn't reliable here: on Windows we run with
// shell:true (needed to resolve claude's .cmd shim), and a missing command
// under a shell just prints "not recognized" + a non-zero exit instead of
// emitting 'error'. Checking PATH ourselves gives one consistent, friendly
// failure on every platform instead of two different silent-ish ones.
export function isOnPath(bin, env = process.env) {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  return dirs.some((dir) =>
    exts.some((ext) => existsSync(path.join(dir, bin + ext)))
  );
}

export function runClaude(args, env, bin = "claude") {
  if (!isOnPath(bin, env)) {
    return Promise.reject(
      new Error(
        `Could not find "${bin}" on your PATH. Install it first: npm install -g @anthropic-ai/claude-code`
      )
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: "inherit",
      env,
      // Windows installs `claude` as an npm shim (.cmd); shell:true lets
      // the OS resolve it via PATH the same way a typed command would.
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}
