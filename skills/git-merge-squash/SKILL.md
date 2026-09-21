---
name: git-merge-squash
description: Use when one Git branch's full history must land as a single squash commit on another branch while both branch histories remain synchronized.
---

# Git Squash Merge

Squash `source` into one `target` commit, then merge back while preserving tips and trees.

## Preflight

Set distinct full refs `source_ref=refs/heads/<source>` and `target_ref=refs/heads/<target>`. Use this preflight only:

1. `git status` must report a clean worktree, clean index, and no active operation.
2. Record both tips with `git rev-parse`.
3. Require `git merge-base --is-ancestor "$target_tip" "$source_tip"`.
4. Use one `git worktree list --porcelain` to ensure neither branch is checked out in another worktree.

Stop without changing refs when a check fails.

## Backup Pair

Inspect each canonical ref `refs/heads/bak/<source>` and `refs/heads/bak/<target>` once. Use the canonical pair when each ref is missing, equals its recorded tip, or passes `git merge-base --is-ancestor <backup> <recorded-tip>`. Create missing refs and fast-forward older refs.

If either canonical ref is ahead or divergent, preserve both canonicals and use a matching timestamp pair instead:

```text
refs/heads/bak/<YYYYMMDDTHHMMSSZ>/<source>
refs/heads/bak/<YYYYMMDDTHHMMSSZ>/<target>
```

Reject a selected backup ref that equals `source_ref` or `target_ref`. Create or update both selected refs atomically with one checked `git update-ref --stdin` transaction using `start`, `create` or `update`, `prepare`, and `commit`; Git must reject any other name collision. Read both refs once to confirm the recorded tips.

## Workflow

1. Switch to `target`, confirm `HEAD` is `target_tip`, and run `git merge --squash "$source_ref"`.
2. Review `git diff --cached`, create one Conventional Commit describing the net change, and record `squash_tip`. Use `<type>[optional scope][optional !]: <description>` with a lowercase type and concise imperative description; use a `BREAKING CHANGE:` footer when needed.
3. Switch to `source`, confirm `HEAD` is `source_tip`, and run `git merge --no-ff --no-edit "$target_ref"`.

On either conflict, stop without resolving, aborting, or repairing the repository.

## Verification

Read the selected backups, `target`, `target^`, `source^1`, and `source^2` together and compare them with the recorded tips. Then require `git diff --quiet "$target_ref" "$source_ref"` and a clean `git status --short`.

Inspect command output directly. Do not add shell scripts, project validation, duplicate diffs, graph inspection, or other checks.
