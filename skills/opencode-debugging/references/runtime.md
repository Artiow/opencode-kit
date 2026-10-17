# Runtime Diagnostics

Load `customize-opencode` for configuration semantics, schema, resource discovery
rules, and changes. Use its schema guidance instead of inventing fields or
copying a version-specific config reference into this skill.

## Establish the Runtime

Record the installed version, project directory, affected agent/session, and
whether the observation came from the existing process or a new CLI invocation.
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
prompts. A field selector is useful for inspection, but is not automatically a
test of effective behavior. Large diagnostic outputs may be incomplete: detect
parse failures/truncation and use a narrower supported source rather than
treating missing output as absence or repeatedly dumping the same data.

## Follow the Failing Boundary

Start from the observed operation and work backward only as far as needed:

1. Actual invocation: selected agent/model, tool name, arguments, result/error.
2. Effective state: agent rules, session restrictions or approvals, connection
   state, and hooks involved in the operation.
3. Resolved configuration: only relevant definitions and overrides.
4. Sources: resource/config files and environment-provided config layers governing
   the value. Follow discovery/precedence guidance from `customize-opencode`.

A new CLI process sees newly loaded resources; it cannot prove that an older
process reloaded them. Identify which process produced each observation. For a
historical failure, use session/event evidence; today's config is not a snapshot
of yesterday's state. Do not add duplicate settings or disable plugins merely
because a component is a plausible suspect.

## Worked Example: A Permission Exists but Still Asks

First inspect the actual agent's normalized rules, not just an `allow` field in
`debug config`. For an installation where `debug agent` emits an ordered
`permission` array with `permission`, `pattern`, and `action` fields, this is a
bounded inspection of the rules relevant to `customize-opencode`:

```sh
set -o pipefail
opencode debug agent insight | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  let agent;
  try { agent = JSON.parse(input); }
  catch { throw new Error("Incomplete agent JSON; use a narrower supported source"); }
  if (!Array.isArray(agent.permission)) throw new Error("Inspect the installed rule schema");
  const rules = agent.permission.map((rule, index) => ({ index, ...rule }));
  console.log(JSON.stringify(rules.filter(rule =>
    rule.permission === "*" || rule.permission === "skill"), null, 2));
});'
```

Select **all matching rules**, including wildcard patterns, and determine the
winner using the installed evaluator's semantics. The check succeeds only if
the resulting decision is `allow`, not merely if an `allow` appears somewhere.
When a setting moves between files/scopes, verify the final ordering again.
Also identify which permission was actually requested: `skill`, `read`, and
`external_directory` are separate checks. Session-level rules can affect the
decision beyond the agent definition.

Finally reproduce the intended skill/tool invocation in the reloaded process.
If only the normalized rules were checked, report that level rather than
claiming the user-visible symptom is fixed. Use the same distinction for routing,
MCP connectivity, plugin activation, and other configuration-driven behavior.
