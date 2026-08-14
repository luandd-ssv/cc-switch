import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { withTempHome } from "./helpers.js";
import {
  createDashboardServer,
  dashboardUrl,
  isLocalRequest,
  isSameOriginRequest,
  resolveBindHost,
} from "../src/dashboard.js";
import { saveAccount, setCurrent, claudeHomeDir } from "../src/accounts.js";
import { ensureClaudeHome } from "../src/workspace.js";

const NO_PATH = { PATH: "", Path: "" };

let home;
let server;
let base;

async function listen(options = {}) {
  server = createDashboardServer({ env: NO_PATH, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

// fetch() treats Host as a forbidden header and silently drops it, so the
// rebinding guard has to be exercised over a raw request.
function requestWithHost(host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: server.address().port, path: "/", headers: { host } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

beforeEach(() => {
  home = withTempHome();
  for (const dir of ["agents", "skills", "projects"]) {
    mkdirSync(path.join(home.dir, ".claude", dir), { recursive: true });
  }
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  home.restore();
});

test("isLocalRequest accepts loopback names and rejects anything else", () => {
  assert.equal(isLocalRequest("127.0.0.1:6769"), true);
  assert.equal(isLocalRequest("localhost:6769"), true);
  assert.equal(isLocalRequest("localhost"), true);
  assert.equal(isLocalRequest("[::1]:6769"), true);
  assert.equal(isLocalRequest("[::1]"), true);
  // A bare IPv6 literal: stripping a trailing ":<digits>" would leave ":" here.
  assert.equal(isLocalRequest("::1"), true);
  // A name an attacker controls can still resolve to 127.0.0.1, and the page
  // carries the account holder's email and organisation.
  assert.equal(isLocalRequest("evil.example.com"), false);
  assert.equal(isLocalRequest("192.168.1.20:6769"), false);
  assert.equal(isLocalRequest("127.0.0.1.evil.example.com"), false);
  assert.equal(isLocalRequest(undefined), false);
});

// The Host check is the only thing guarding the port, and anything that is not a
// browser can forge that header. Binding wider would publish email, organisation
// and project paths while still 403-ing the LAN browsers such a bind is for.
// /api/status can spawn `claude -p /usage`, and a cross-origin GET needs no
// preflight and carries a loopback Host like any genuine request -- so the Host
// check cannot tell the two apart. Sec-Fetch-Site can, and is what keeps a page
// the user merely visited from launching Claude Code processes on their machine.
test("isSameOriginRequest only trusts the page's own fetch, a typed URL, or a non-browser client", () => {
  const req = (headers) => ({ headers });

  assert.equal(isSameOriginRequest(req({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(isSameOriginRequest(req({ "sec-fetch-site": "none" })), true);
  // curl or a script: no web page can direct it, so it keeps working.
  assert.equal(isSameOriginRequest(req({})), true);

  assert.equal(isSameOriginRequest(req({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(isSameOriginRequest(req({ "sec-fetch-site": "same-site" })), false);
  // An Origin without Sec-Fetch-Site still has to be loopback.
  assert.equal(isSameOriginRequest(req({ origin: "http://evil.example.com" })), false);
  assert.equal(isSameOriginRequest(req({ origin: "not a url" })), false);
  assert.equal(isSameOriginRequest(req({ origin: "http://127.0.0.1:6769" })), true);
});

test("a cross-site GET to /api/status still answers, but never triggers a refresh", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });
  await listen();

  const res = await fetch(`${base}/api/status`, { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(res.status, 200);
  const body = await res.json();
  // NO_PATH already forces enabled:false, so the refresh flag alone would not
  // prove anything; what matters is that the request is treated as a plain
  // cached read rather than as a licence to spawn.
  assert.equal(body.quotaRefresh.enabled, false);
  assert.deepEqual(body.refreshed, []);
});

test("resolveBindHost refuses to bind past loopback", () => {
  assert.equal(resolveBindHost("127.0.0.1"), "127.0.0.1");
  assert.equal(resolveBindHost("localhost"), "localhost");
  assert.equal(resolveBindHost("[::1]"), "::1");
  assert.equal(resolveBindHost("::1"), "::1");

  for (const host of ["0.0.0.0", "::", "192.168.1.20", "example.com", ""]) {
    assert.throws(() => resolveBindHost(host), /only accepts a loopback address/);
  }
});

test("serves the page on / and refuses a foreign Host header", async () => {
  await listen();

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  const html = await page.text();
  assert.match(html, /cc-switch/);
  assert.match(html, /id="notify-toggle"/);

  assert.equal(await requestWithHost("evil.example.com"), 403);
  assert.equal(await requestWithHost("localhost"), 200);
});

test("only answers GET, and 404s an unknown path", async () => {
  await listen();
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
});

test("/api/status carries accounts, quota and the poll interval", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });
  await setCurrent("work");

  // A suggestion is only offered for an account that can actually open a
  // session, so the fixture has to be logged in.
  writeFileSync(path.join(claudeHomeDir("work"), ".credentials.json"), "{}");

  const resetsAt = new Date(Date.now() + 42 * 60000).toISOString();
  writeFileSync(
    path.join(claudeHomeDir("work"), ".claude.json"),
    JSON.stringify({
      oauthAccount: { emailAddress: "dev@example.com", userRateLimitTier: "default_claude_max_5x" },
      cachedUsageUtilization: {
        fetchedAtMs: Date.now(),
        utilization: {
          five_hour: { utilization: 59, resets_at: resetsAt },
          seven_day: { utilization: 8, resets_at: new Date(Date.now() + 86400000).toISOString() },
        },
      },
    })
  );

  await listen({ pollMinutes: 15 });
  const res = await fetch(`${base}/api/status`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.dashboard.pollMinutes, 15);
  assert.equal(data.current, "work");
  const account = data.accounts.find((a) => a.name === "work");
  assert.equal(account.profile.identity.email, "dev@example.com");
  const five = account.profile.quota.windows.find((w) => w.key === "five_hour");
  assert.equal(five.state, "fresh");
  assert.equal(five.percent, 59);

  // 59% used with 42 minutes left is exactly the case the notification exists
  // for: the rest of that window is about to disappear.
  assert.equal(data.recommendations.candidates.length, 1);
  assert.equal(data.recommendations.candidates[0].account, "work");
});

test("/api/status forwards custom thresholds", async () => {
  await ensureClaudeHome("work", { shareHistory: true });
  await saveAccount("work", { shareHistory: true });
  await listen({ recommend: { resetWithinMinutes: 5, headroomBelowPercent: 20 } });

  const data = await (await fetch(`${base}/api/status`)).json();
  assert.deepEqual(data.recommendations.thresholds, { resetWithinMinutes: 5, headroomBelowPercent: 20 });
});

test("dashboardUrl points at loopback even when bound to every interface", () => {
  assert.equal(dashboardUrl({ host: "0.0.0.0", port: 6769 }), "http://127.0.0.1:6769/");
  assert.equal(dashboardUrl({ host: "127.0.0.1", port: 6769 }), "http://127.0.0.1:6769/");
  assert.equal(dashboardUrl({ host: "::1", port: 8080 }), "http://[::1]:8080/");
});
