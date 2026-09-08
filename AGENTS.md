# OpenCode Kit

This repository is the source of truth for version-controlled global OpenCode extensions.

Managed resources are exposed under `~/.config/opencode/` using GNU Stow.

## Rules

* Edit managed resources in this repository, never their symlinked copies under `~/.config/opencode/`.
* `~/.config/opencode/` also contains unmanaged local files. Do not modify, move, delete, or import them unless explicitly asked.
* Never copy the global `opencode.json` into this repository.
* Never commit credentials, tokens, API keys, or other secrets.
* Do not commit or push unless explicitly asked.

## OpenCode resources

Global resources provided by this repository may include:

* `agents/`
* `skills/`
* `tools/`
* `commands/`
* `plugins/`

Before creating or modifying an OpenCode resource, load the built-in `customize-opencode` skill and use it as the primary reference for current OpenCode formats and capabilities. Do not guess configuration syntax.

Prefer the simplest appropriate mechanism:

* **skill** — reusable knowledge or workflow
* **agent** — specialized role, context, model, or permissions
* **tool** — deterministic executable capability
* **command** — explicitly invoked reusable workflow
* **plugin** — runtime hooks or deeper OpenCode integration

Keep reusable procedures in skills instead of duplicating them across agents.

## Repository-local OpenCode configuration

`.opencode/` is configuration for working on `opencode-kit` itself.

Do not confuse:

* `agents/`, `skills/`, `tools/`, etc. — global resources provided by this repository
* `.opencode/agents/`, `.opencode/skills/`, `.opencode/tools/`, etc. — resources used only while working on this repository

Nothing under `.opencode/` may be deployed globally through Stow.

`.opencode/plans/` and `tmp/` are working directories ignored by Git but intentionally visible to OpenCode through `.ignore`.

## TypeScript workspace

This repository is a single TypeScript workspace for developing TypeScript-based OpenCode resources.

`package.json`, `package-lock.json`, `tsconfig.json`, and `node_modules/` are repository development infrastructure and are not part of the global OpenCode configuration.

Use npm as the package manager. Keep `package.json` and `package-lock.json` consistent when dependencies change.

After modifying TypeScript resources, run:

```sh
npm run typecheck
```

Do not add runtime dependencies to global OpenCode resources without first checking the current dependency-loading guidance in `customize-opencode`.

## Stow

Repository-only infrastructure is excluded through `.stow-local-ignore`.

Use `--no-folding` so managed symlinks can coexist with unmanaged local files.

After adding, deleting, renaming, or moving managed paths, first simulate:

```sh
stow -n -v -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

Then apply:

```sh
stow -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit
```

Editing an existing managed file does not require rerunning Stow.

Do not use `stow --adopt` automatically. If Stow reports a conflict with an unmanaged file, stop and report it instead of overwriting or moving the file.

When adding a repository-only top-level path, also exclude it from Stow.

## Workflow

When changing this repository:

1. Inspect existing related resources and conventions.
2. Load `customize-opencode`.
3. Make the smallest coherent change.
4. Run `npm run typecheck` when TypeScript is affected.
5. Re-run Stow only when managed paths changed.
6. Review `git diff`.
7. Mention if a new OpenCode session or restart is required.

When improving OpenCode's global capabilities, create or modify them here rather than directly under `~/.config/opencode/`.
