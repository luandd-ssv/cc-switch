import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isOnPath, runClaude, buildEnv } from "../src/run.js";

test("buildEnv sets CLAUDE_CONFIG_DIR and keeps inheriting process.env", () => {
  const env = buildEnv({ name: "work" });
  assert.ok(env.CLAUDE_CONFIG_DIR.includes("work"));
  assert.equal(env.PATH ?? env.Path, process.env.PATH ?? process.env.Path);
});

test("isOnPath finds a binary placed on a scratch PATH", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-switch-path-"));
  const isWin = process.platform === "win32";
  const binName = isWin ? "fakebin.CMD" : "fakebin";
  try {
    writeFileSync(path.join(dir, binName), "");
    if (!isWin) chmodSync(path.join(dir, binName), 0o755);
    const env = { PATH: dir, PATHEXT: ".CMD" };
    assert.equal(isOnPath("fakebin", env), true);
    assert.equal(isOnPath("does-not-exist-xyz", env), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runClaude rejects with a friendly error when the binary is missing", async () => {
  await assert.rejects(
    () => runClaude([], { PATH: "", Path: "" }, "cc-switch-definitely-missing-bin"),
    /Could not find "cc-switch-definitely-missing-bin"/
  );
});
