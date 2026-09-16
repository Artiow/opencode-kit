# OpenCode Kit

Version-controlled global OpenCode extensions deployed under `~/.config/opencode/` with GNU Stow.

## Preconditions

- [GNU Stow](https://www.gnu.org/software/stow/) is required to deploy the global resources.
- Configure [`nickclyde/duckduckgo-mcp-server`](https://github.com/nickclyde/duckduckgo-mcp-server) globally as `duckduckgo`; project agents depend on it. This repository only enables the server and does not configure its installation or launch.
- The scoped Superpowers integration is tested with OpenCode/plugin `1.18.31` and Superpowers `6.3.0`. Compatibility is validated from the required runtime hooks and skill assets rather than package version numbers.

## Scoped Superpowers

`plugins/superpowers-agent.ts` is the only Superpowers plugin OpenCode should load. It is auto-discovered after Stow deploys it to `~/.config/opencode/plugins/`; do not add it to `plugin`, load the upstream `superpowers` plugin separately, or combine auto-discovery with a tuple entry. Duplicate registration can discard options or inject the upstream bootstrap globally.

Superpowers is a runtime dependency, not a deployed resource. It must resolve from the deployed plugin's OpenCode configuration environment, normally `~/.config/opencode/node_modules`. The repository `node_modules` is excluded from Stow and is for development and tests only. Install the pinned release in the configuration environment before starting OpenCode:

```sh
npm install --prefix "$HOME/.config/opencode" --save-exact \
  "superpowers@github:obra/superpowers#v6.3.0"
```

The pinned release above matches this repository's tested environment. Other releases are accepted when they provide the required plugin hooks and valid skill assets. A missing or structurally incompatible dependency fails plugin initialization visibly.

The generated `superpowers` primary agent is enabled by default. To additionally enable existing agents, set a JSON array in the environment before starting OpenCode:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": { "build": {} }
}
```

```sh
OPENCODE_SUPERPOWERS_AGENTS='["build","reviewer"]'
export OPENCODE_SUPERPOWERS_AGENTS
```

Whitespace is trimmed, duplicate names are removed, and `superpowers` is implicit. The value must be valid JSON containing only non-empty strings. Only agents already present in the merged `agent` config are enabled; missing or explicitly disabled names are ignored. To enable a built-in, add an override for it to `agent` because OpenCode materializes built-ins after plugin config hooks.

Malformed JSON reports `invalid OPENCODE_SUPERPOWERS_AGENTS`; a non-array, non-string item, or blank item reports `"agents" must be an array of non-empty strings`.

### Agents And Permissions

The wrapper discovers the bundled Superpowers `SKILL.md` files and owns the exact `permission.skill` rules for their names. It appends those exact rules after existing rules because OpenCode uses the last matching permission: global rules deny the skills by default, every configured non-disabled agent outside the allowlist receives matching agent-level denies, and allowlisted agents plus the non-disabled `superpowers` agent receive allows for capability skills. `using-superpowers` remains denied through the native `skill` tool because the upstream transform supplies that policy when bootstrap delegation occurs. Existing wildcard and unrelated rules retain their order and behavior; conflicting exact bundled-name rules are replaced by the wrapper.

Configured built-in and custom agents may be allowlisted. Missing and explicitly disabled agents are ignored. An existing `agent.superpowers` is augmented rather than replaced: its model, prompt, mode, description, permissions, and other settings are retained, missing `mode` and `description` default to `primary` and `OpenCode with the full Superpowers workflow`, and its skill rules are generated as above. With no explicit model it inherits normal OpenCode model configuration. Set `agent.superpowers.disable: true` to keep that entry untouched and suppress its bootstrap.

OpenCode permissions identify a skill by frontmatter `name`, not source path. A project or personal skill with the same name as a bundled Superpowers skill therefore shares the generated rule, and OpenCode only reports an ambiguous duplicate. Rename the external skill's frontmatter name (and directory), or remove its discovery path; discovery order is not a safe remediation. Duplicate names inside the bundled package, missing/malformed skills, or a missing `using-superpowers` policy fail initialization.

Bootstrap routing follows the agent on the chronologically latest user message, using the message ID as a deterministic tie-breaker when timestamps match. Every transform invocation for an enabled agent delegates to the unchanged upstream bootstrap, whether the agent is primary, a directly selected subagent, task-dispatched, or an explicitly allowlisted internal agent name. The upstream `<SUBAGENT-STOP>` block remains present and controls any model-facing behavior for dispatched subagents.

Histories without a user message, or whose latest user-message agent is not enabled, do not delegate. Upstream retains ownership of bootstrap content, caching, and duplicate protection. The config hook stages upstream and wrapper changes and commits them atomically; invalid configuration or an upstream failure exposes none of the staged config mutations. OpenCode may continue after reporting a plugin failure, so treat any `[superpowers-agent]` startup error as a disabled integration and fix it before use.

After setup or changes, quit and restart OpenCode; plugins, configuration, and environment options are loaded only at startup. Validate registration and representative agents with:

```sh
opencode debug config
opencode debug agent superpowers
opencode debug agent build
opencode debug skill --print-logs --log-level WARN
```

`debug config` should list one plugin ending in `/plugins/superpowers-agent.ts`. `debug agent` validates built-in or custom agent registration; `debug skill` surfaces duplicate skill names. These commands are registration and diagnostic checks, not evidence that bootstrap hooks ran. Bootstrap routing is covered by hook-level unit and isolated integration tests, not provider-backed end-to-end tests.

## Configuration layers

Machine-specific settings such as `server` and `mcp` remain in the unmanaged `~/.config/opencode/opencode.jsonc` and must not be added to this repository.

This repository also has two project-only configuration layers:

- `opencode.jsonc` is the committed, portable shared config.
- `.opencode/opencode.jsonc` is the higher-priority local override. It and `.opencode/opencode.json` are Git-ignored and should not duplicate shared settings.

Model routing is stored in `models.jsonc`, deployed as `~/.config/opencode/models.jsonc`, and loaded through `OPENCODE_CONFIG`. OpenCode merges configuration in this order:

```text
~/.config/opencode/opencode.jsonc
        +
$OPENCODE_CONFIG -> ~/.config/opencode/models.jsonc
        +
opencode.jsonc (shared project config)
        +
.opencode/opencode.json(c) (local project override)
```

The environment must provide:

```sh
OPENCODE_CONFIG="${HOME}/.config/opencode/models.jsonc"
OPENCODE_MODEL_FLAGSHIP="<provider>/<model>"
OPENCODE_MODEL_UTILITY="<provider>/<model>"
OPENCODE_MODEL_LIGHT="<provider>/<model>"
```

`models.jsonc` maps agents and model settings to these capability tiers through `{env:...}` interpolation. Actual model IDs and environment values remain local.

Top-level resource directories such as `agents/`, `skills/`, `tools/`, `commands/`, and `plugins/` are deployed globally. Resources under `.opencode/` apply only to this repository, and the directory is excluded from Stow. The root `opencode.jsonc` is also excluded from Stow.

## Stow

Preview deployment from the repository root:

```sh
stow -n -v -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

Deploy only after confirming that the preview contains no conflicts or unexpected operations:

```sh
stow -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

Always use `--no-folding`, investigate every conflict, and never use `stow --adopt` to overwrite unmanaged configuration. This repository excludes `node_modules`, package files, project config, `.opencode/`, tests, and `tmp/` from deployment.

For repository verification, run:

```sh
npm test
npm run typecheck
git diff --check
stow -n -v -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

The Stow command is a preview only. Deployment is never performed by the verification commands.
