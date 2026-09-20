# OpenCode Kit

Version-controlled global OpenCode extensions deployed under `~/.config/opencode/` with GNU Stow.

## Preconditions

- [GNU Stow](https://www.gnu.org/software/stow/) is required to deploy the global resources.
- Configure [`nickclyde/duckduckgo-mcp-server`](https://github.com/nickclyde/duckduckgo-mcp-server) globally as `duckduckgo`; project agents depend on it. This repository only enables the server and does not configure its installation or launch.
- Declare [`obra/superpowers`](https://github.com/obra/superpowers) as a dependency in the global `~/.config/opencode/package.json`, as described below.

## Superpowers Agent

[`plugins/superpowers-agent.ts`](plugins/superpowers-agent.ts) is a scoped wrapper around the upstream [Superpowers](https://github.com/obra/superpowers) plugin. It reuses the bundled skills and original bootstrap, but exposes them only to the generated `superpowers` agent, selected primary built-ins, and selected configured custom agents. This keeps the Superpowers workflow opt-in instead of changing the behavior of every OpenCode agent. Do not register the upstream plugin separately, because its unscoped bootstrap would bypass the wrapper.

Bootstrap routing is evaluated for every model request rather than fixed for the lifetime of a session. The wrapper reads the active agent from the latest user message and delegates to the upstream transform only when that agent is enabled; otherwise, it leaves the messages unchanged. Switching agents within the same session therefore takes effect on the next request: an agent receives the Superpowers bootstrap and skill access only when enabled.

The upstream transform itself is agent-agnostic for top-level sessions: it prepends the cached `using-superpowers` bootstrap and OpenCode tool mappings to the first user message, while a marker prevents duplicate injection. It detects delegated child sessions by their `parentID` and skips bootstrap injection for them. This wrapper additionally scopes both the transform and skill permissions, so standard `general` and `explore` subagents receive neither by default; explicitly configured and enabled subagents can access the skills, but their child sessions still do not receive the bootstrap.

This injection does not replace an agent's configured prompt. OpenCode retains that prompt in the system instructions, while the transform adds the bootstrap as user-message content; the original prompt therefore remains intact and keeps system-level precedence if the instructions conflict.

Stow deploys the wrapper to `~/.config/opencode/plugins/`, where OpenCode discovers it automatically. The upstream package is a runtime dependency. Add the pinned dependency to the existing machine-local `~/.config/opencode/package.json`, or create the file if it does not exist:

```json
{
  "dependencies": {
    "superpowers": "github:obra/superpowers#v6.4.1"
  }
}
```

OpenCode installs dependencies from this file at startup. The global `package.json` and its `node_modules` remain unmanaged and must not be added to this repository.

The generated `superpowers` primary agent is enabled by default. To enable the same workflow for additional agents, set `OPENCODE_SUPERPOWERS_AGENTS` to their comma-separated names before starting OpenCode:

```sh
export OPENCODE_SUPERPOWERS_AGENTS="build,reviewer"
```

Names are trimmed and deduplicated. The primary built-ins `build` and `plan` are enabled without requiring entries in the merged OpenCode configuration. Custom agents must already be configured, and explicitly disabled agents are ignored. An unset or empty value enables no additional agents. Restart OpenCode after changing the plugin, dependency, or environment variable because all three are loaded only at startup.

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

Always use `--no-folding`, investigate every conflict, and never use `stow --adopt` to overwrite unmanaged configuration. This repository excludes `node_modules`, package files, project config, `.opencode/`, tests, and `tmp/` from deployment (see [.stow-local-ignore](.stow-local-ignore)).
