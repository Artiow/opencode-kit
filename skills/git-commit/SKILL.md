---
name: git-commit
description: Use when staging, splitting, or creating Git commits, or when writing Conventional Commit messages.
---

# Creating Git Commits

Create focused commits from the current Git state and the caller's instructions.

## Workflow

1. Run `git status --short --untracked-files=all` and read the relevant staged, unstaged, and untracked diffs. Stop for conflicts or an active Git operation.
2. Group the changes by intent. Preserve existing staged work. With an available index, stage exact paths using `git add -- <paths>` and review `git diff --cached`; with unrelated staged work, review and commit whole paths using `git commit --only`, or stop when safe isolation requires partial paths.
3. Check each reviewed commit patch for secrets such as credentials, private keys, or tokens. Choose a Conventional Commit message from the patch and any caller instructions, then run `git commit` with hooks enabled.
4. Run `git status --short` and report the commit printed by `git commit`.

For a normal clean index, the command sequence is `status`, relevant `diff`, `add -- <exact-paths>`, cached `diff`, `commit`, `status`. Name every path; do not use `.`, `-A`, `-u`, or wildcard pathspecs.

Use only Git inspection and commit operations. Project tests, builds, linters, and other project validation belong to the caller.

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
