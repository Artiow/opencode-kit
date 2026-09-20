---
name: git-commit
description: Use when staging, splitting, or creating Git commits, or when writing Conventional Commit messages.
---

# Creating Git Commits

## Overview

Create one-intent commits. Preserve state, follow instructions, and verify Git's result.

## Safety Contract

1. Inspect status (`--untracked-files=all`), staged/unstaged diffs, and history. Inspect an untracked candidate with `git diff --no-index -- /dev/null "$path"`; exit 1 is expected; >1 means stop.
2. Stop for conflicts or an active merge, rebase, cherry-pick, or revert unless explicitly asked to complete that operation.
3. Plan atomic commits; separate unrelated intents and keep tests with verified behavior.
4. Preserve staged work. If the index was clean, stage exact paths and inspect `git diff --cached`. If unrelated paths were staged, do not stage first: inspect `git diff HEAD -- <whole-paths>`, then use `git commit --only -- <same-paths>`. Stop if a candidate path was staged or isolation requires mixed hunks or a temporary patch.
5. Inspect exact patch/stat. Run `git diff --cached --check` in index mode or `git diff --check HEAD -- <paths>` with `--only`; run available validation and secret/generated/binary checks. Never claim unavailable checks passed.
6. Let hooks run. Never use broad staging, `commit -a`, `--no-verify`, `--allow-empty`, amend, stash, reset, or push unless explicitly requested.
7. Inspect the subject, parents, stat, patch, and remaining state.

## Conventional Commits Contract

```text
<type>[optional scope][optional !]: <description>

[optional body]

[optional footer(s)]
```

- Type is a noun: use `feat` for features and `fix` for bug fixes; other types are allowed.
- An optional scope is a noun in parentheses naming the affected area.
- Description follows `: `.
- Repository style: lowercase type; concise imperative description without period; otherwise prefer `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, or `revert`.
- Body starts after one blank line and records durable context.
- Footer block starts one blank line after body or description. Use `Token: value` or `Token #value`; replace token spaces with `-`.
- Mark breaks with `!` before `:` and/or uppercase `BREAKING CHANGE: description`; `BREAKING-CHANGE` is synonymous. Without that footer, describe the break after `!`.

Example:

```text
feat(api)!: rename invoice state field

BREAKING CHANGE: clients must read `status` instead of `state`
```

## Quick Reference

| Situation | Action |
|---|---|
| One intent, owned index | Stage exact paths; verify cached patch |
| Unrelated staged work | Preserve it; use reviewed whole-path `--only` or stop |
| Multiple intents | Create ordered focused commits |
| Active Git operation | Stop unless explicitly asked to complete it |

## Common Mistakes

| Thought | Correction |
|---|---|
| “The deadline justifies one mixed commit” | Pressure does not change commit boundaries. |
| “It was already staged” | Staging is not authorization to include it. |
| “Hooks are trusted” | Trust hooks, then verify their output. |

## Red Flags

Unexpected staged content, unread candidate changes, secrets, conflicts, active operations, empty patches, failed validation, or inability to isolate one intent mean stop and report; do not repair user state speculatively.
