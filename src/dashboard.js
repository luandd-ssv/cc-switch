import { promises as fs } from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { collectStatus } from "./status.js";

const PAGE = new URL("./dashboard/page.html", import.meta.url);

export const DASHBOARD_DEFAULTS = {
  port: 6769,
  host: "127.0.0.1",
  // How often the page re-reads quota, and also the staleness threshold that
  // makes /api/status actively run "claude -p /usage" for a cache older than
  // this -- one knob controls both, so a poll never lands on data the
  // dashboard was too stingy to have refreshed by then. Whether to notify is
  // decided against the wall clock on a much shorter tick regardless, since a
  // window crosses into "about to roll over" on the clock, not on a re-read.
  pollMinutes: 3,
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

// Splitting host from port cannot be a plain /:\d+$/ strip: that turns the bare
// IPv6 loopback "::1" into ":". Brackets, when present, are what delimit the
// address, and a bare IPv6 literal has several colons that are not ports.
function hostnameOf(hostHeader) {
  const value = String(hostHeader).trim();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  if (value.indexOf(":") !== value.lastIndexOf(":")) return value;
  return value.replace(/:\d+$/, "");
}

// The page reports the account holder's email, organisation and plan, so it is
// bound to loopback. A browser on this machine can still be pointed at an
// attacker-controlled name that resolves to 127.0.0.1 (DNS rebinding), and the
// Host header is what distinguishes that request from a genuine one.
export function isLocalRequest(hostHeader) {
  if (!hostHeader) return false;
  return LOCAL_HOSTNAMES.has(hostnameOf(hostHeader).toLowerCase());
}

// /api/status is no longer a pure read: it can spawn `claude -p /usage` per
// stale account. That makes it a side effect reachable by a plain cross-origin
// GET, which needs no preflight and carries "Host: 127.0.0.1:<port>" like any
// genuine request, so the Host check above cannot see the difference. Any page
// the user happens to visit could therefore make their machine launch Claude
// Code processes (it still cannot read the reply -- no CORS headers are sent).
//
// Sec-Fetch-Site is what distinguishes them: browsers set it on every request
// and it cannot be spoofed from script. "none" is a typed URL or a bookmark,
// "same-origin" is this page's own fetch. Anything else is another site
// driving the request. A missing header means a non-browser client (curl, a
// script) that no web page can direct, so it is allowed.
export function isSameOriginRequest(req) {
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  // Belt and braces for anything that sends Origin without Sec-Fetch-Site.
  const origin = req.headers.origin;
  if (origin && origin !== "null") {
    try {
      if (!LOCAL_HOSTNAMES.has(new URL(origin).hostname.toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// Binding past loopback cannot work the way it looks like it would. The Host
// check above is the only thing standing between this port and the account
// holder's email, organisation, project paths and spend, and a Host header is
// trivially forged by anything that is not a browser -- while a real browser on
// another device sends "Host: 192.168.x.y" and gets a 403. So a wider bind would
// expose the data without making the page reachable, and the address is
// restricted rather than merely documented.
export function resolveBindHost(host) {
  const name = hostnameOf(host ?? "");
  if (!LOCAL_HOSTNAMES.has(name.toLowerCase())) {
    throw new Error(
      `--host only accepts a loopback address (127.0.0.1, localhost, ::1), got "${host}". ` +
        "The dashboard reports your account email, organisation and project paths, and it refuses " +
        "any request that does not arrive as localhost, so binding wider would open the port " +
        "without making the page reachable from another device."
    );
  }
  return name;
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, code, data) {
  send(res, code, JSON.stringify(data), { "content-type": "application/json; charset=utf-8" });
}

export function createDashboardServer(options = {}) {
  const { env = process.env, pollMinutes = DASHBOARD_DEFAULTS.pollMinutes, recommend, refresh } = options;

  return http.createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, "Method not allowed", { "content-type": "text/plain; charset=utf-8", allow: "GET" });
      }
      if (!isLocalRequest(req.headers.host)) {
        return send(res, 403, "cc-switch dashboard only serves localhost requests.", {
          "content-type": "text/plain; charset=utf-8",
        });
      }

      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/") {
        const page = await fs.readFile(PAGE);
        return send(res, 200, page, {
          "content-type": "text/html; charset=utf-8",
          // The page ships its own CSS and script inline and talks to nothing
          // but this server, so everything else can be denied outright.
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:",
        });
      }
      if (url.pathname === "/api/status") {
        // The client polls every pollMinutes, so that is also the natural
        // staleness threshold: by the time the next poll lands, the previous
        // one has already made sure the cache isn't older than this. A
        // cross-site caller gets the cached read only -- never the spawn.
        const allowRefresh = refresh !== false && isSameOriginRequest(req);
        const refreshOpt = allowRefresh ? { staleMinutes: pollMinutes, ...refresh } : false;
        const status = await collectStatus(env, { recommend, refresh: refreshOpt });
        return sendJson(res, 200, { ...status, dashboard: { pollMinutes } });
      }
      return send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

// 0.0.0.0 or :: is not something a browser can navigate to, so the printed and
// opened URL falls back to loopback.
function browsableHost(host) {
  if (!host || host === "0.0.0.0" || host === "::" || host === "*") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

export function dashboardUrl({ host, port }) {
  return `http://${browsableHost(host)}:${port}/`;
}

// An unhandled ChildProcess "error" event is a fatal exception, and .unref()
// does not change that. A headless or minimal Linux box has no xdg-open, so
// without this handler `dashboard --open` would kill the server it had just
// announced. Failing to open a browser is not a reason to stop serving.
function openWith(command, args, options) {
  const child = spawn(command, args, { stdio: "ignore", detached: true, ...options });
  child.on("error", () => {
    console.error(`Could not launch a browser (${command} is unavailable). Open the URL above yourself.`);
  });
  child.unref();
}

export function openInBrowser(url) {
  // spawn without a shell: the URL is never handed to a command interpreter.
  if (process.platform === "win32") {
    // "start" is a cmd builtin; the empty string is the window title that
    // start would otherwise consume from the URL argument.
    openWith(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "start", "", url], {
      windowsVerbatimArguments: false,
    });
    return;
  }
  openWith(process.platform === "darwin" ? "open" : "xdg-open", [url]);
}

export function startDashboard(options = {}) {
  const port = options.port ?? DASHBOARD_DEFAULTS.port;
  const host = resolveBindHost(options.host ?? DASHBOARD_DEFAULTS.host);
  const server = createDashboardServer(options);

  return new Promise((resolve, reject) => {
    const onStartupError = (err) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Pick another one with "cc-switch dashboard --port <n>".`
          )
        );
        return;
      }
      reject(err);
    };
    server.once("error", onStartupError);

    server.listen(port, host, () => {
      // The startup guard is a "once" that never fired, so it has to give way to
      // a lasting listener: an "error" event with nothing listening (a failed
      // accept, EMFILE under fd pressure) would otherwise take the whole
      // dashboard down long after it started serving.
      server.removeListener("error", onStartupError);
      server.on("error", (err) => console.error(`cc-switch dashboard: ${err.message}`));
      resolve({ server, url: dashboardUrl({ host, port }) });
    });
  });
}
