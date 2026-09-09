# OpenCode Kit

Version-controlled global OpenCode extensions deployed under `~/.config/opencode/` with GNU Stow.

## Configuration layers

Machine-specific configuration remains in the unmanaged local file `~/.config/opencode/opencode.jsonc`. It contains settings such as `server`, `mcp`, and other local environment details and must not be added to this repository.

Model routing is stored in the repository-root `models.jsonc`. Stow installs it as `~/.config/opencode/models.jsonc`, and OpenCode loads it through `OPENCODE_CONFIG`:

```text
~/.config/opencode/opencode.jsonc
        +
$OPENCODE_CONFIG -> ~/.config/opencode/models.jsonc
        +
project-level opencode.json(c), if present
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

## Stow

Preview deployment from the repository root:

```sh
stow -n -v -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

Deploy only after confirming that the preview contains no conflicts or unexpected operations:

```sh
stow -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```
