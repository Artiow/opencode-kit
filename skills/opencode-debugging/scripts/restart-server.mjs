/**
 * @file Worker that restarts a standalone local OpenCode server and notifies its session.
 * Started by launch-restart-server.mjs with an IPC channel for the "armed" handshake.
 */
import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, readFileSync, readlinkSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const POLL_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 180_000;
const IDLE_GRACE_MS = 1_000;
const STOP_TIMEOUT_MS = 20_000;
const START_TIMEOUT_MS = 30_000;
const STARTUP_CONNECTION_ERRORS = ["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET"];

/** Poll a condition until it succeeds or times out; propagate check errors. */
async function waitFor(check, milliseconds, description) {
    const deadline = performance.now() + milliseconds;
    while (!await check()) {
        if (performance.now() >= deadline) {
            throw new Error(`Timed out waiting for ${description}`);
        }
        await sleep(POLL_INTERVAL_MS);
    }
}

/** Find the listener's PID; reject ambiguous ownership rather than guessing. */
function listenerPID(port) {
    const output = execFileSync("ss", ["-ltnp"], {
        encoding: "utf8", timeout: COMMAND_TIMEOUT_MS,
    });
    const portPattern = new RegExp(`:${port}\\s`);
    const listeners = output.split("\n").filter(line => portPattern.test(line));
    const pids = new Set(listeners.flatMap(line =>
        [...line.matchAll(/pid=(\d+)/g)].map(match => Number(match[1]))));
    if (listeners.length && pids.size !== 1) {
        throw new Error("Expected exactly one identifiable server listener");
    }
    return [...pids][0];
}

/** Read Linux process state and start-time ticks, or return undefined after exit. */
function processState(pid) {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        // The suffix begins at field 3 (state); field 22 is the process start time.
        return { state: fields[0], startTime: fields[19] };
    } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
    }
}

/** Capture the standalone server's launch settings without exposing its environment. */
function readServerProcess(baseURL) {
    const port = baseURL.port || "80";
    const pid = listenerPID(port);
    if (!pid) throw new Error("No identifiable server listener");
    const executable = readlinkSync(`/proc/${pid}/exe`);
    // Remove only the final NUL terminator, preserving empty arguments.
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").slice(0, -1);
    if (!basename(executable).startsWith("opencode") || !args.includes("serve")) {
        throw new Error("Listener is not an opencode serve process");
    }
    const startTime = processState(pid)?.startTime;
    const cwd = readlinkSync(`/proc/${pid}/cwd`);
    const env = Object.fromEntries(
        readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean).map(entry => {
            const separator = entry.indexOf("=");
            return [entry.slice(0, separator), entry.slice(separator + 1)];
        }),
    );
    return { port, pid, executable, args, startTime, cwd, env };
}

/** Reject a replaced process, reused PID, or launch settings that no longer work. */
function verifyServer(server) {
    const { port, pid, startTime, executable, cwd } = server;
    if (!startTime || listenerPID(port) !== pid || processState(pid)?.startTime !== startTime) {
        throw new Error("Server process changed while waiting");
    }
    accessSync(executable, constants.X_OK);
    accessSync(cwd, constants.X_OK);
}

/** Create authenticated JSON requests with an explicit, optional project directory. */
function createRequester(baseURL, env) {
    const headers = {};
    if (env.OPENCODE_SERVER_PASSWORD) {
        const credentials = `${env.OPENCODE_SERVER_USERNAME || "opencode"}:${env.OPENCODE_SERVER_PASSWORD}`;
        headers.authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
    }
    return async function request(path, { directory, body } = {}) {
        const url = new URL(path, baseURL);
        if (directory) url.searchParams.set("directory", directory);
        const response = await fetch(url, {
            headers: { ...headers, "content-type": "application/json" },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
        return response.status === 204 ? undefined : response.json();
    };
}

/** Resolve the session's project and retain the last message's agent and model. */
async function readSessionContext(request, sessionID) {
    const session = await request(`/session/${sessionID}`);
    if (session.id !== sessionID || typeof session.directory !== "string" || !session.directory) {
        throw new Error("Session has no valid project directory");
    }
    const directory = session.directory;
    const [last] = await request(`/session/${sessionID}/message?limit=1`, { directory });
    if (!last) throw new Error("Session has no messages");
    const agent = last.info.agent;
    const model = last.info.model || { providerID: last.info.providerID, modelID: last.info.modelID };
    if (!agent || !model.providerID || !model.modelID) throw new Error("Message has no agent or model");
    return { id: sessionID, directory, agent, model };
}

/** Check idle status, rejecting malformed responses rather than assuming idle. */
async function isSessionIdle(request, session) {
    const statuses = await request("/session/status", { directory: session.directory });
    if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) {
        throw new Error("Invalid session status response");
    }
    const status = statuses[session.id];
    // OpenCode removes idle sessions from this map.
    if (status === undefined) return true;
    if (!["idle", "busy", "retry"].includes(status?.type)) {
        throw new Error("Unknown session status");
    }
    return status.type === "idle";
}

/** Stop and replace the server once, then verify its health and listener ownership. */
async function replaceServer(server, request, session) {
    verifyServer(server);
    process.kill(server.pid, "SIGTERM");
    await waitFor(() => {
        const state = processState(server.pid);
        return !state || state.state === "Z";
    }, STOP_TIMEOUT_MS, "server exit");

    // Do not inspect the disappearing listener here: ss may still show it without a PID.
    const { executable, args, cwd, env } = server;
    const child = spawn(executable, args.slice(1), { cwd, env, detached: true, stdio: "ignore" });
    await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
    });
    child.unref();

    let health;
    await waitFor(async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error("Replacement server exited");
        }
        try {
            health = await request("/global/health", { directory: session.directory });
        } catch (error) {
            // Old HTTP connections can reset while the replacement is starting.
            if (STARTUP_CONNECTION_ERRORS.includes(error.cause?.code) || error.name === "TimeoutError") {
                return false;
            }
            throw error;
        }
        return health?.healthy === true;
    }, START_TIMEOUT_MS, "server health");
    if (listenerPID(server.port) !== child.pid) throw new Error("Unexpected replacement listener");
    return { pid: child.pid, version: health.version };
}

/** Submit one ordinary prompt so the originating agent can report the result. */
async function notifySession(request, session, result) {
    await request(`/session/${session.id}/prompt_async`, {
        directory: session.directory,
        body: {
            agent: session.agent,
            model: session.model,
            parts: [{ type: "text", text: `${result}\nReport this result briefly to the user. Do not restart the server again.` }],
        },
    });
}

/** Prepare the worker, wait for the caller to finish, restart, and notify once. */
async function restart(baseURL, sessionID) {
    const server = readServerProcess(baseURL);
    const request = createRequester(baseURL, server.env);
    const session = await readSessionContext(request, sessionID);
    verifyServer(server);
    await isSessionIdle(request, session);
    process.send({ status: "armed" });

    let replacement;
    try {
        await waitFor(() => {
            verifyServer(server);
            return isSessionIdle(request, session);
        }, IDLE_TIMEOUT_MS, "session idle");
        await sleep(IDLE_GRACE_MS);
        if (!await isSessionIdle(request, session)) {
            throw new Error("Session became busy again; restart cancelled");
        }
        replacement = await replaceServer(server, request, session);
    } catch (error) {
        // Preserve the restart error if the unavailable server also prevents notification.
        await notifySession(request, session, `OpenCode server restart failed: ${error.message}`).catch(() => {});
        throw error;
    }

    // Delivery failure must not trigger a second notification attempt.
    const result = `OpenCode server restart succeeded. PID ${server.pid} -> ${replacement.pid}; healthy=true; version=${replacement.version}.`;
    await notifySession(request, session, result);
}

try {
    if (!process.connected) {
        throw new Error("Start this worker through launch-restart-server.mjs");
    }
    const args = process.argv.slice(2);
    if (args.length !== 2 || !/^ses_[a-zA-Z0-9]+$/.test(args[1])) {
        throw new Error("Expected a server URL and valid session ID from launcher");
    }
    const baseURL = new URL(args[0]);
    if (baseURL.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(baseURL.hostname) || baseURL.pathname !== "/" || baseURL.search || baseURL.hash || baseURL.username || baseURL.password) {
        throw new Error("Expected a local HTTP server URL without credentials, path, or query");
    }
    await restart(baseURL, args[1]);
} catch (error) {
    if (process.connected) process.send({ error: error.message });
    console.error(error.message);
    process.exitCode = 1;
}
