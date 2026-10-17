---
name: opencode-debugging
description: Use when OpenCode itself behaves unexpectedly, a previous fix failed, or a session needs investigation, including configuration, agents, subagents, skills, commands, tools, permissions, plugins, MCP, errors, hangs, or missing results.
---

# OpenCode Debugging

Trace observed behavior through runtime and session evidence. **A declared setting is not proof of an effective decision or a successful operation.**

## Companion Skill

**REQUIRED:** Load `customize-opencode` when interpreting configuration/resource definitions or before proposing or applying resource changes. It owns schema, supported fields, placement, and configuration guidance; this skill owns diagnosis and verification.

Load `customize-opencode` as a skill; read the bundled references below as files. Log inspection is part of this skill, not a separate skill dependency.

Ordinary application bugs and planned configuration changes without a diagnostic question do not trigger this skill.

## Workflow

1. **Scope.** State expected versus observed behavior. Identify the project, agent, affected session/tool/resource, and relevant time range. Use supplied facts; ask only for missing facts blocking the next check.
2. **Choose evidence.** Start with the nearest source below. Discover installed commands with `--help`. Display relevant fields, excluding credentials and unrelated session content. Prefer filtered diagnostics over avoiding them entirely.
3. **Trace.** Follow necessary boundaries: source definitions, resolved configuration, effective agent/session state, actual invocation, result. Distinguish a new diagnostic process from the running session, and present state from historical evidence.
4. **Test a hypothesis.** State the suspected cause, evidence, and confirming/rejecting observation. Before changes, define success at the failing layer; capture the failing observation when possible. Turn conditions and caveats from subagent reports into checks.
5. **Verify.** For an authorized fix, change one cause and repeat the decisive check. Config acceptance, effective state, and successful invocation are distinct milestones. Follow `customize-opencode` for reload/restart requirements; verify the reloaded process before claiming success.
6. **Report and stop.** Give the symptom, findings citing commands/fields or record IDs/file lines, remaining hypotheses, and next action or verified result. State verification level, truncation, and missing evidence. Stop when the scoped question is answered.

## Choose the Source

| Question | Read and use |
|---|---|
| Config, agent, skill, command, plugin, tool, or MCP mismatch | [Runtime diagnostics](references/runtime.md) |
| What a session or subagent received, did, or returned | [Session investigation](references/sessions.md) |
| A specific runtime event requires log evidence | [Bounded log inspection](references/log-inspection.md), **before reading logs** |

Use known paths and IDs. Delegate only concrete independent questions, pass exact identifiers, and avoid recursive rediscovery. Logs and full session exports are not mandatory first steps.

## Common Mistakes

| Shortcut | Required evidence |
|---|---|
| “The field is present, so it works.” | Effective state and the actual decision/result. |
| “Moving the setting preserves behavior.” | Resolved merge result, including order where meaningful. |
| “The worker confirmed it.” | Evidence supporting the worker's claim and its conditions. |
| “No matches means no event.” | Verified source, scope, completeness, and time coverage. |
