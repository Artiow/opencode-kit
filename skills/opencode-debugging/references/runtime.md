# Runtime Diagnostics

Load `customize-opencode` for configuration schema, discovery, precedence, and changes.

## Establish the Runtime

Record the installed version, project directory, affected agent/session, and
process identity.
Use `opencode --version`, `opencode --help`, and `opencode debug --help` as needed.
Check individual subcommand help before assuming options or output schemas.
Consult matching installed code or version-appropriate documentation for semantic
gaps; upstream documentation alone does not establish this installation's state.

## Match the Probe to the Claim

| Claim to investigate | Starting probe | What it does not establish |
|---|---|---|
| Settings were discovered and merged | `opencode debug config` | Existing process reload or successful behavior |
| An agent has the expected effective settings | `opencode debug agent <name>` | Which agent/session executed a past operation |
| A skill was discovered | `opencode debug skill` | Permission to load it, actual loading, or following it |
| An MCP server is available | `opencode mcp list` after checking help | Success of a particular tool call |
| A command used the intended agent and tools | Invocation records in the affected session | Correctness inferred merely from its command definition |
| A plugin or hook changed behavior | Resolved state and evidence for that invocation | Activation inferred merely from its presence on disk |

Filter config/agent output to the needed fields before displaying it. Do not
print whole configs, provider credentials, environment values, or unrelated
prompts. Detect parse failures/truncation and use a narrower supported source
rather than treating missing output as absence or repeatedly dumping the same data.

## Follow the Failing Boundary

Start from the observed operation and work backward only as far as needed:

1. Actual invocation: selected agent/model, tool name, arguments, result/error.
2. Effective state: agent rules, session restrictions or approvals, connection
   state, and hooks involved in the operation.
3. Resolved configuration: only relevant definitions and overrides.
4. Sources: resource/config files and environment-provided config layers governing
   the value. Follow discovery/precedence guidance from `customize-opencode`.

Identify which process produced each observation: a new CLI probe does not prove
an existing process reloaded. Use session/event evidence for historical failures.
Do not add duplicate settings or disable plugins without evidence.

## Unexpected Permission Prompts

1. Inspect the actual agent's normalized rules with `opencode debug agent <name>`,
   selecting relevant fields according to the installed output schema.
2. Identify the requested permission: `skill`, `read`, and `external_directory`
   are separate checks. Include session-level rules.
3. Evaluate **all matching rules**, including wildcards, in their effective order
   using the installed evaluator's semantics. An `allow` entry alone does not
   establish an `allow` decision. Recheck ordering after moving settings between scopes.
4. Reproduce the original invocation in the reloaded process. Report whether only
   rules were inspected or the operation actually succeeded.

## Restart Helper

For an explicitly requested restart of a standalone local Linux `opencode serve`,
use the [helper](../scripts/restart-server.mjs) with Node.js 22+ and `ss`:

```sh
node "$HOME/.config/opencode/skills/opencode-debugging/scripts/restart-server.mjs" http://127.0.0.1:4096 SESSION_ID
```

Replace the URL and session ID. The helper derives the directory, agent, and model
from the session. On `{"status":"armed",...}`, **finish your response immediately**
so the session can become idle. It waits up to 180 seconds for idle, pauses one
second, rechecks, and restarts once with the original arguments, cwd, and environment.
Resumed activity cancels the restart. After health verification, it submits the
result as a new prompt in the same session using the saved agent/model.

CLI and bot processes are untouched. There is no status file or retry of the
restart or notification. Preflight failures return a nonzero exit code; failures
after arming are reported through the session if reachable. If the server remains
down, no session notification can be delivered.
