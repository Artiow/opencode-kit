# OpenCode Kit

Version-controlled global OpenCode extensions deployed under `~/.config/opencode/` with GNU Stow.

## Preconditions

- [GNU Stow](https://www.gnu.org/software/stow/) is required to deploy the global resources.
- Configure [`nickclyde/duckduckgo-mcp-server`](https://github.com/nickclyde/duckduckgo-mcp-server) globally as `duckduckgo`; project agents depend on it. This repository only enables the server and does not configure its installation or launch.

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
