import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { withTempHome } from "./helpers.js";
import {
  listAccounts,
  saveAccount,
  accountExists,
  getAccount,
  removeAccount,
  getCurrent,
  setCurrent,
} from "../src/accounts.js";

let home;
beforeEach(() => {
  home = withTempHome();
});
afterEach(() => {
  home.restore();
});

test("listAccounts returns an empty array when none exist", async () => {
  assert.deepEqual(await listAccounts(), []);
});

test("saveAccount + getAccount round-trip", async () => {
  await saveAccount("work", { shareHistory: true });
  const account = await getAccount("work");
  assert.equal(account.name, "work");
  assert.equal(account.shareHistory, true);
  assert.equal(await accountExists("work"), true);
  assert.equal(await accountExists("nope"), false);
});

test("listAccounts finds every saved account", async () => {
  await saveAccount("a", { shareHistory: true });
  await saveAccount("b", { shareHistory: false });
  const names = (await listAccounts()).map((a) => a.name).sort();
  assert.deepEqual(names, ["a", "b"]);
});

test("setCurrent rejects an account that doesn't exist", async () => {
  await assert.rejects(() => setCurrent("ghost"), /does not exist/);
});

test("use/current round-trip", async () => {
  await saveAccount("a", { shareHistory: true });
  await setCurrent("a");
  assert.equal(await getCurrent(), "a");
});

test("getCurrent returns null before any account is active", async () => {
  assert.equal(await getCurrent(), null);
});

test("removeAccount refuses to remove the active account", async () => {
  await saveAccount("a", { shareHistory: true });
  await setCurrent("a");
  await assert.rejects(() => removeAccount("a"), /active account/);
  assert.equal(await accountExists("a"), true);
});

test("removeAccount succeeds once the account is no longer active", async () => {
  await saveAccount("a", { shareHistory: true });
  await saveAccount("b", { shareHistory: true });
  await setCurrent("a");
  await setCurrent("b");
  await removeAccount("a");
  assert.equal(await accountExists("a"), false);
});

test("rejects path-unsafe or malformed account names", async () => {
  await assert.rejects(
    () => saveAccount("../evil", { shareHistory: true }),
    /Invalid account name/
  );
  await assert.rejects(
    () => saveAccount("has space", { shareHistory: true }),
    /Invalid account name/
  );
});
