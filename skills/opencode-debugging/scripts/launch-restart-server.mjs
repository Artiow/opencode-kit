/**
 * @file Launch the detached OpenCode restart worker and wait for preflight readiness.
 * Usage: node launch-restart-server.mjs <session-id>
 * The worker inherits OPENCODE_API_URL from the caller's environment.
 * After "armed", the caller must finish its response so the session can become idle.
 */
import { fork } from "node:child_process";

const ARM_TIMEOUT_MS = 20_000;

/** Start the worker with IPC, then detach after its "armed" acknowledgement. */
async function launchWorker(sessionID) {
    // Ignore stdio so the initiating tool can finish while the worker keeps running.
    const worker = fork(
        new URL("./restart-server.mjs", import.meta.url),
        [sessionID],
        { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] }
    );

    let timer;
    try {
        await new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`Restart helper did not arm within ${ARM_TIMEOUT_MS / 1_000} seconds`)), ARM_TIMEOUT_MS);
            worker.once("error", reject);
            worker.once("exit", () => reject(new Error("Restart helper exited before arming")));
            worker.once("message", message => { if (message.status === "armed") resolve(); else reject(new Error(message.error)); });
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
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        throw new Error("Usage: node launch-restart-server.mjs <session-id>");
    }
    await launchWorker(args[0]);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
