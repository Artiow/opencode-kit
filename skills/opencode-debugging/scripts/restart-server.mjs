import { execFileSync, fork, spawn } from "node:child_process";
import { accessSync, constants, readFileSync, readlinkSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function waitFor(check, milliseconds, description) {
  const deadline = performance.now() + milliseconds;
  while (!await check()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await sleep(250);
  }
}

function listenerPID(port) {
  const lines = execFileSync("ss", ["-ltnp"], { encoding: "utf8", timeout: 5_000 }).split("\n");
  const listeners = lines.filter(line => new RegExp(`:${port}\\s`).test(line));
  const pids = new Set(listeners.flatMap(line => [...line.matchAll(/pid=(\d+)/g)].map(match => Number(match[1]))));
  if (listeners.length && pids.size !== 1) throw new Error("Expected exactly one identifiable server listener");
  return [...pids][0];
}

function processState(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { state: fields[0], start: fields[19] };
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function restart(base, sessionID) {
  const port = base.port || "80";
  const oldPID = listenerPID(port);
  if (!oldPID) throw new Error("No identifiable server listener");
  const executable = readlinkSync(`/proc/${oldPID}/exe`);
  const args = readFileSync(`/proc/${oldPID}/cmdline`, "utf8").split("\0").slice(0, -1);
  if (!basename(executable).startsWith("opencode") || !args.includes("serve")) {
    throw new Error("Listener is not an opencode serve process");
  }
  const identity = processState(oldPID)?.start;
  const cwd = readlinkSync(`/proc/${oldPID}/cwd`);
  const env = Object.fromEntries(readFileSync(`/proc/${oldPID}/environ`, "utf8").split("\0")
    .filter(Boolean).map(entry => { const i = entry.indexOf("="); return [entry.slice(0, i), entry.slice(i + 1)]; }));
  const headers = {};
  if (env.OPENCODE_SERVER_PASSWORD) {
    headers.authorization = `Basic ${Buffer.from(`${env.OPENCODE_SERVER_USERNAME || "opencode"}:${env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
  }
  let directory;
  async function request(path, body) {
    const url = new URL(path, base);
    if (directory) url.searchParams.set("directory", directory);
    const response = await fetch(url, {
      headers: { ...headers, "content-type": "application/json" }, signal: AbortSignal.timeout(5_000),
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
    return response.status === 204 ? undefined : response.json();
  }
  const session = await request(`/session/${sessionID}`);
  if (session.id !== sessionID || typeof session.directory !== "string" || !session.directory) {
    throw new Error("Session has no valid project directory");
  }
  directory = session.directory;
  const [last] = await request(`/session/${sessionID}/message?limit=1`);
  if (!last) throw new Error("Session has no messages");
  const agent = last.info.agent;
  const model = last.info.model || { providerID: last.info.providerID, modelID: last.info.modelID };
  if (!agent || !model.providerID || !model.modelID) throw new Error("Message has no agent or model");
  function verifyServer() {
    if (!identity || listenerPID(port) !== oldPID || processState(oldPID)?.start !== identity) {
      throw new Error("Server process changed while waiting");
    }
    accessSync(executable, constants.X_OK);
    accessSync(cwd, constants.X_OK);
  }
  async function isIdle() {
    const statuses = await request("/session/status");
    if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) throw new Error("Invalid session status response");
    const status = statuses[sessionID];
    // OpenCode removes idle sessions from this map.
    if (status === undefined) return true;
    if (!["idle", "busy", "retry"].includes(status?.type)) throw new Error("Unknown session status");
    return status.type === "idle";
  }
  verifyServer();
  await isIdle();
  process.send?.({ status: "armed" });

  let result;
  let failure;
  try {
    await waitFor(() => { verifyServer(); return isIdle(); }, 180_000, "session idle");
    await sleep(1_000);
    if (!await isIdle()) throw new Error("Session became busy again; restart cancelled");
    verifyServer();
    process.kill(oldPID, "SIGTERM");
    await waitFor(() => { const state = processState(oldPID); return !state || state.state === "Z"; }, 20_000, "server exit");
    const child = spawn(executable, args.slice(1), { cwd, env, detached: true, stdio: "ignore" });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    let health;
    await waitFor(async () => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Replacement server exited");
      try { health = await request("/global/health"); }
      catch (error) {
        if (["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET"].includes(error.cause?.code)
          || error.name === "TimeoutError") return false;
        throw error;
      }
      return health?.healthy === true;
    }, 30_000, "server health");
    if (listenerPID(port) !== child.pid) throw new Error("Unexpected replacement listener");
    result = `OpenCode server restart succeeded. PID ${oldPID} -> ${child.pid}; healthy=true; version=${health.version}.`;
  } catch (error) {
    failure = error;
    result = `OpenCode server restart failed: ${error.message}`;
  }
  try {
    await request(`/session/${sessionID}/prompt_async`, {
      agent, model,
      parts: [{ type: "text", text: `${result}\nReport this result briefly to the user. Do not restart the server again.` }],
    });
  } catch (error) { throw failure || error; }
  if (failure) throw failure;
}

async function arm(address, sessionID) {
  // Ignore worker stdio so the initiating tool can finish and its session can become idle.
  const worker = fork(fileURLToPath(import.meta.url), ["--worker", address, sessionID], {
    detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Restart helper did not arm within 20 seconds")), 20_000);
      worker.once("error", reject);
      worker.once("exit", () => reject(new Error("Restart helper exited before arming")));
      worker.once("message", message => message.status === "armed" ? resolve() : reject(new Error(message.error)));
    });
    console.log(JSON.stringify({ status: "armed", workerPID: worker.pid, sessionID }));
  } catch (error) {
    worker.kill("SIGTERM");
    throw error;
  } finally {
    clearTimeout(timer);
    if (worker.connected) worker.disconnect();
    worker.unref();
  }
}

try {
  const worker = process.argv[2] === "--worker";
  const args = process.argv.slice(worker ? 3 : 2);
  if (args.length !== 2 || !/^ses_[a-zA-Z0-9]+$/.test(args[1])) {
    throw new Error("Usage: node restart-server.mjs <server-url> <session-id>");
  }
  const base = new URL(args[0]);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
    || base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
    throw new Error("Expected a local HTTP server URL without credentials, path, or query");
  }
  if (worker) await restart(base, args[1]);
  else await arm(base.href, args[1]);
} catch (error) {
  if (process.connected) process.send({ error: error.message });
  console.error(error.message);
  process.exitCode = 1;
}
