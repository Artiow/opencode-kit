---
name: git-commit
description: Use when staging, splitting, or creating Git commits, or when writing Conventional Commit messages.
---

# Creating Git Commits

Create focused commits from the current Git state and the caller's instructions. Use these phases; return to the model for patch review before each commit.

## Workflow

1. **Inspect.** In one turn, request `git status --untracked-files=all`, `git diff`, `git diff --cached`, and `git log --oneline -10` as independent calls. Status must show no conflict or active operation. Stop if there is nothing to commit. For untracked content needed to choose groups, use `git diff --no-index -- /dev/null <path>`; exit 1 means differences, not an execution failure.
2. **Choose.** Group changes by intent and name exact paths. Preserve unrelated staged entries. If safe isolation requires partial paths, stop.
3. **Stage and expose the patch.** With no unrelated staged work, run one group:

   ```sh
   git add -- <exact-paths> && git diff --cached
   ```

   With unrelated staged work, use the whole-path route: stage only selected untracked paths so Git knows them, then review `git diff HEAD -- <exact-paths>`. This is the patch that `commit --only` will take from the working tree; unrelated staged entries stay intact.
4. **Review.** Inspect the complete commit patch, including credentials, private keys, or tokens. Choose the message from that patch, repository style, and caller instructions. This model decision separates staging from committing.
5. **Commit and inspect the result.** Run one group with hooks enabled:

   ```sh
   git commit -m "<message>" && git status --short
   ```

   For the whole-path route, use `git commit --only -m "<message>" -- <exact-paths> && git status --short` instead. A hook/command failure stops the group; do not bypass it.
6. **Continue or report.** For another group, return to path selection using the observed status; re-inspect changed data as needed. Report each commit printed by `git commit` and final status, including remaining work.

## Supported calls and boundaries

- History is limited to `git log --oneline -10`; other log forms are unavailable. Use `git branch --show-current` for the current branch and `git for-each-ref` for refs, not `git symbolic-ref` or `git branch --list`.
- Exact paths preserve commit scope and other staged work: no `.`, wildcard pathspecs, `add -A/-u`, or `commit -a`.
- No `--amend` (existing history), `--allow-empty` (no reviewed change), or `--no-verify` (required hooks). Do not use shell utilities or run project tests/builds/linters; project validation belongs to the caller.
- A denied required call ends this workflow with the limitation and actual state; do not probe alternative spellings.

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
