# OpenCode Kit

Version-controlled global OpenCode extensions deployed under `~/.config/opencode/` with GNU Stow.

## Preconditions

- [GNU Stow](https://www.gnu.org/software/stow/) is required to deploy the global resources.
- Configure [`nickclyde/duckduckgo-mcp-server`](https://github.com/nickclyde/duckduckgo-mcp-server) globally as `duckduckgo`; project agents depend on it. This repository only enables the server and does not configure its installation or launch.
- The scoped Superpowers integration supports OpenCode/plugin `>=1.18.30 <1.19.0` and exactly Superpowers `6.3.0`; the tested OpenCode version is `1.18.31`.

## Scoped Superpowers

`plugins/superpowers-agent.ts` is the only Superpowers plugin OpenCode should load. It is auto-discovered after Stow deploys it to `~/.config/opencode/plugins/`; do not add it to `plugin`, load the upstream `superpowers` plugin separately, or combine auto-discovery with a tuple entry. Duplicate registration can discard options or inject the upstream bootstrap globally.

Superpowers is a runtime dependency, not a deployed resource. It must resolve from the deployed plugin's OpenCode configuration environment, normally `~/.config/opencode/node_modules`. The repository `node_modules` is excluded from Stow and is for development and tests only. Install the pinned release in the configuration environment before starting OpenCode:

```sh
npm install --prefix "$HOME/.config/opencode" --save-exact \
  "superpowers@github:obra/superpowers#v6.3.0"
```

A missing dependency or version other than `6.3.0` fails plugin initialization visibly.

The generated `superpowers` primary agent is enabled by default. To additionally enable existing agents, set a JSON array in the environment before starting OpenCode:

```sh
OPENCODE_SUPERPOWERS_AGENTS='["build","reviewer"]'
export OPENCODE_SUPERPOWERS_AGENTS
```

Whitespace is trimmed, duplicate names are removed, and `superpowers` is implicit. The value must be valid JSON containing only non-empty strings. Unknown or disabled names fail the config hook with a sorted diagnostic such as:

```text
[superpowers-agent] invalid configured agents:
  "buidl" does not exist
  "reviewer" is disabled
```

Malformed JSON reports `invalid OPENCODE_SUPERPOWERS_AGENTS`; a non-array, non-string item, or blank item reports `"agents" must be an array of non-empty strings`.

### Agents And Permissions

The wrapper discovers the bundled Superpowers `SKILL.md` files and owns the exact `permission.skill` rules for their names. It appends those exact rules after existing rules because OpenCode uses the last matching permission: all agents receive global denies, while allowlisted agents and the generated agent receive allows for capability skills. `using-superpowers` always remains denied through the native `skill` tool because the upstream transform injects that policy itself. Existing wildcard and unrelated rules retain their order and behavior; conflicting exact bundled-name rules are replaced by the wrapper.

Built-in and configured custom agents may be allowlisted. Unknown and explicitly disabled agents are rejected. An existing `agent.superpowers` is augmented rather than replaced: its model, prompt, mode, description, permissions, and other settings are retained, missing `mode` and `description` default to `primary` and `OpenCode with the full Superpowers workflow`, and its skill rules are generated as above. With no explicit model it inherits normal OpenCode model configuration. Set `agent.superpowers.disable: true` to keep that entry untouched and suppress its bootstrap.

OpenCode permissions identify a skill by frontmatter `name`, not source path. A project or personal skill with the same name as a bundled Superpowers skill therefore shares the generated rule, and OpenCode only reports an ambiguous duplicate. Rename the external skill's frontmatter name (and directory), or remove its discovery path; discovery order is not a safe remediation. Duplicate names inside the bundled package, missing/malformed skills, or a missing `using-superpowers` policy fail initialization.

Bootstrap injection applies to a directly selected enabled primary agent or directly selected enabled subagent. It does not apply to sessions created through `task`, even when the dispatched agent is allowlisted, and never applies to OpenCode's internal `compaction`, `title`, or `summary` agents. Skill permissions and bootstrap routing are separate here: an allowlisted task-dispatched agent retains its capability permissions but receives the upstream subagent semantics instead of the direct-session bootstrap.

Routing fails closed when session identity, parentage, assistant metadata, or session lookup is missing or inconsistent. It also skips compaction transforms, prevents repeated injection for reused histories, and isolates session/agent switches. The config hook stages upstream and wrapper changes and commits them atomically; invalid configuration or an upstream failure exposes none of the staged config mutations. OpenCode may continue after reporting a plugin failure, so treat any `[superpowers-agent]` startup error as a disabled integration and fix it before use.

After setup or changes, quit and restart OpenCode; plugins, configuration, and environment options are loaded only at startup. Validate registration and representative agents with:

```sh
opencode debug config
opencode debug agent superpowers
opencode debug agent build
opencode debug skill --print-logs --log-level WARN
```

`debug config` should list one plugin ending in `/plugins/superpowers-agent.ts`. `debug agent` validates built-in or custom agent registration; `debug skill` surfaces duplicate skill names.

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
