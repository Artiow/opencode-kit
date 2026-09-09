# OpenCode Kit

This repository is the source of truth for version-controlled global OpenCode extensions deployed under `~/.config/opencode/` using GNU Stow.

## Rules

- Edit managed resources here, never through their symlinks under `~/.config/opencode/`.
- Do not modify, move, delete, or import unmanaged files from `~/.config/opencode/` unless explicitly asked.
- Never copy the global `~/.config/opencode/opencode.jsonc` (or `opencode.json`) into this repository or replace `.opencode/opencode.jsonc` with it.
- Never commit credentials, tokens, API keys, or other secrets.
- Do not commit or push unless explicitly asked.

## OpenCode resources

Top-level resource directories such as `agents/`, `skills/`, `tools/`, `commands/`, and `plugins/` provide global OpenCode capabilities.

Before creating or modifying an OpenCode resource, load the built-in `customize-opencode` skill and use it as the primary reference for current formats and capabilities. Prefer the simplest suitable resource type, and keep reusable procedures in skills rather than duplicating them across agents.

## Configuration layers

`~/.config/opencode/opencode.jsonc` is a machine-specific unmanaged file for `server`, `mcp`, and other local settings. Do not import or modify it as part of repository maintenance.

The repository-root `models.jsonc` is managed by Stow as `~/.config/opencode/models.jsonc` and loaded through `OPENCODE_CONFIG=${HOME}/.config/opencode/models.jsonc`. OpenCode merges the effective configuration in this order:

```text
~/.config/opencode/opencode.jsonc
        +
$OPENCODE_CONFIG -> ~/.config/opencode/models.jsonc
        +
project-level opencode.json(c), if present
```

Model roles in `models.jsonc` must use `{env:...}` interpolation. The local environment must provide:

- `OPENCODE_CONFIG` - path to the Stow-managed model profile.
- `OPENCODE_MODEL_FLAGSHIP` - primary, most capable model.
- `OPENCODE_MODEL_UTILITY` - cheaper or faster model for auxiliary tasks and agents.
- `OPENCODE_MODEL_LIGHT` - lightweight model for lightweight tasks.

Concrete model IDs and files containing environment values are intentionally local configuration. Never add them to Git or Stow.

`.opencode/` is repository-local configuration used only while working on this project. It is not a global resource, must never be deployed through Stow, and must remain excluded by `.stow-local-ignore`.

`.opencode/plans/` and `tmp/` are Git-ignored working directories intentionally made visible to OpenCode through `.ignore`.

## TypeScript

Use npm and keep `package.json` and `package-lock.json` consistent when dependencies change.

After changing TypeScript resources, run:

```sh
npm run typecheck
```

Check the current dependency-loading guidance in `customize-opencode` before adding runtime dependencies to global resources.

## Stow

Use `--no-folding` so managed symlinks can coexist with unmanaged local files.

Run a dry-run whenever a change affects deployed paths or exclusions, including adding, deleting, renaming, or moving a managed resource or top-level path, or changing `.stow-local-ignore`:

```sh
stow -n -v -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

The dry-run must complete without conflicts or unexpected link operations. Stop and investigate otherwise. Do not use `stow --adopt` automatically or overwrite an unmanaged file to resolve a conflict.

Repository-only top-level paths must be excluded in `.stow-local-ignore` in the same change. Content-only changes to an existing managed file, and changes wholly inside an already excluded path, do not require a dry-run unless they affect deployment topology or exclusions.

Deploy only when explicitly required:

```sh
stow -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

## Validation

Before considering a change complete:

1. Inspect related resources and conventions and make the smallest coherent change.
2. Run `npm run typecheck` when TypeScript is affected.
3. Run the Stow dry-run when deployment topology or exclusions are affected.
4. Run `git diff --check` and review `git diff`.
5. Do not commit a known-invalid or conflicting state unless explicitly asked to bypass validation.
6. Mention when a new OpenCode session or restart is required.
