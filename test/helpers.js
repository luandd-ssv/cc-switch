import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// os.homedir() reads $HOME (POSIX) or %USERPROFILE% (Windows) at call time,
// so pointing both at a scratch dir redirects every accounts.js/workspace.js
// path lookup without touching the real ~/.cc-switch or ~/.claude.
const HOME_ENV_KEYS = ["HOME", "USERPROFILE"];

export function withTempHome() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-test-"));
  const previous = Object.fromEntries(HOME_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of HOME_ENV_KEYS) process.env[key] = dir;

  return {
    dir,
    restore() {
      for (const key of HOME_ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
