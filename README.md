# OpenCode Kit

Version-controlled global OpenCode extensions deployed under `~/.config/opencode/` with GNU Stow.

## Preconditions

- [GNU Stow](https://www.gnu.org/software/stow/) is required to deploy the global resources.
- The [`nickclyde/duckduckgo-mcp-server`](https://github.com/nickclyde/duckduckgo-mcp-server) MCP server must be configured globally in OpenCode under the name `duckduckgo`; project agents depend on its tools. The shared project config only sets `enabled: true` and does not define how the server is installed or launched.

## Configuration layers

Machine-specific configuration remains in the unmanaged local file `~/.config/opencode/opencode.jsonc`. It contains settings such as `server`, `mcp`, and other local environment details and must not be added to this repository.

This repository also has two project-only configuration layers:

- `opencode.jsonc` is the canonical shared project config. It is committed and must contain only portable settings that work for every clone.
- `.opencode/opencode.jsonc` is the higher-priority local project override for machine- or user-specific settings. Both `.opencode/opencode.jsonc` and its JSON equivalent `.opencode/opencode.json` are Git-ignored; the override should not duplicate shared settings.

OpenCode merges the shared project config first and the local override on top of it. Neither project config is deployed to `~/.config/opencode/`: `.stow-local-ignore` excludes the root `opencode.jsonc` explicitly and excludes `.opencode/` as a whole.

Model routing is stored in the repository-root `models.jsonc`. Stow installs it as `~/.config/opencode/models.jsonc`, and OpenCode loads it through `OPENCODE_CONFIG`:

```text
~/.config/opencode/opencode.jsonc
        +
$OPENCODE_CONFIG -> ~/.config/opencode/models.jsonc
        +
opencode.jsonc (shared project config)
        +
.opencode/opencode.json(c) (local project override)
```

The following variables must be present in the environment:

```sh
OPENCODE_CONFIG="${HOME}/.config/opencode/models.jsonc"
OPENCODE_MODEL_FLAGSHIP="<provider>/<model>"
OPENCODE_MODEL_UTILITY="<provider>/<model>"
OPENCODE_MODEL_LIGHT="<provider>/<model>"
```

* `OPENCODE_CONFIG` points OpenCode to the version-controlled `models.jsonc`.
* `OPENCODE_MODEL_FLAGSHIP` selects the primary, most capable model.
* `OPENCODE_MODEL_UTILITY` selects a cheaper or faster model for auxiliary tasks and agents.
* `OPENCODE_MODEL_LIGHT` selects the lightweight model used for `small_model` and other lightweight tasks.

`models.jsonc` maps agents and OpenCode model settings to these roles through `{env:...}` interpolation.

Actual model IDs and environment configuration are intentionally local and are not stored in `opencode-kit`.

Resources under `.opencode/` are repo-local and apply only while working in `opencode-kit`; tracked resources there remain in Git. Top-level resource directories such as `agents/`, `skills/`, `tools/`, `commands/`, and `plugins/` are global resources and continue to be deployed by Stow.

## Stow

Preview deployment from the repository root:

```sh
stow -n -v -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

Deploy only after confirming that the preview contains no conflicts or unexpected operations:

```sh
stow -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```
