# OpenCode Kit

This repository is the source of truth for global OpenCode extensions deployed to `~/.config/opencode/` with GNU Stow.

## Safety

- Edit managed resources here, never through their symlinks under `~/.config/opencode/`.
- Do not modify, move, delete, or import unmanaged files from `~/.config/opencode/` unless explicitly asked.
- Never copy the global `~/.config/opencode/opencode.json(c)` into this repository or use it to replace a project config.
- Never commit secrets. Commit or push only when explicitly asked.

## Resource Scopes

Top-level resource directories such as `agents/`, `skills/`, `tools/`, `commands/`, and `plugins/` are deployed globally through Stow. Resources under `.opencode/` apply only to this repository and remain tracked unless explicitly designated as local state.

- Before changing OpenCode config, agents, skills, commands, plugins, tools, or permissions, load the built-in `customize-opencode` skill and follow its current schema guidance.
- Prefer the simplest suitable resource type; put reusable procedures in skills instead of duplicating them across agents.
- Keep `plugins/` flat: every file in this directory represents one and only one standalone plugin. Do not create subdirectories or place shared/helper modules there.
- `.opencode/plans/` and `tmp/` are Git-ignored but deliberately exposed to OpenCode through `.ignore`.
- OpenCode loads config-time resources only at startup. Tell the user to restart after changing them.

## Configuration

Configuration precedence is low to high:

```text
~/.config/opencode/opencode.jsonc
-> $OPENCODE_CONFIG (~/.config/opencode/models.jsonc)
-> opencode.jsonc
-> .opencode/opencode.json(c)
```

- `models.jsonc` is deployed as `~/.config/opencode/models.jsonc`. Keep model IDs out of Git and reference `OPENCODE_MODEL_FLAGSHIP`, `OPENCODE_MODEL_UTILITY`, and `OPENCODE_MODEL_LIGHT` through `{env:...}`.
- When renaming or removing an OpenCode resource, search all managed resources and config layers for the old name. Verify the result with `opencode debug config` and, for skills, `opencode debug skill`; filter config output because it may expose secrets.
- Concrete model IDs and files containing environment values are local; never add them to Git or Stow.
- Root `opencode.jsonc` contains portable shared settings. `.opencode/opencode.json(c)` is a Git-ignored local override and must not duplicate shared settings.
- Neither project config is deployed globally: `.stow-local-ignore` must exclude root `opencode.jsonc` and all of `.opencode/`.

## JavaScript and TypeScript

Before writing or reviewing JavaScript or TypeScript, read and follow [CONTRIBUTING.md](CONTRIBUTING.md) for code style, examples, dependency handling, and required checks.

## Stow

- Always use `--no-folding`; managed links must coexist with unmanaged files.
- Add repository-only top-level paths to `.stow-local-ignore`.
- After changing deployed paths, deployment topology, or `.stow-local-ignore`, run:

```sh
stow -n -v -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

- Content-only changes do not require a standalone topology dry-run, but every deployment must still be preceded by the preview above.
- Investigate every conflict or unexpected link operation; never use `stow --adopt` automatically or overwrite unmanaged files.
- Deploy only when explicitly asked. Prefer the complete clean-worktree workflow in `.opencode/commands/stow-deploy.md`; its deployment step is:

```sh
stow -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

## Validation

- Run `git diff --check` and review `git diff` before finishing.
- The restricted `git` subagent runs only its selected Git workflow; its caller owns project validation before delegation.
- Do not commit a known-invalid or conflicting state unless explicitly asked to bypass validation.
