---
name: git-merge-squash
description: Use when one Git branch's full history must land as a single squash commit on another branch while both branch histories remain synchronized.
---

# Git Squash Merge

## Overview

Squash `source` into one `target` commit, then merge back while preserving tips and trees.

**REQUIRED SUB-SKILL:** Use `git-commit` for the squash message.

## Preflight

Set distinct names and full `source_ref=refs/heads/<source>` and `target_ref=refs/heads/<target>`. Record tip OIDs; use only full refs or OIDs for revisions.

- Require a clean worktree and index; never auto-stash.
- Verify no active Git operation and ancestry:

  ```sh
  git merge-base --is-ancestor "$target_tip" "$source_tip"
  ```

- Ensure neither branch is checked out in another worktree.
- Reject any collision between `source` or `target` and a selected backup ref.

On failure, stop; never alter target-only commits.

## Backup Pair

Classify canonical refs `bak/<source>` and `bak/<target>` against recorded OIDs before updating either.

| Backup state | Pair action |
|---|---|
| Missing, equal, or ancestor | Create, keep, or fast-forward canonicals |
| Either ahead or divergent | Preserve canonicals; create timestamp pair |

```sh
git merge-base --is-ancestor "refs/heads/bak/$branch" "$recorded_tip"
```

Timestamp pair:

```text
bak/<YYYYMMDDTHHMMSSZ>/<source>
bak/<YYYYMMDDTHHMMSSZ>/<target>
```

Preflight names and old OIDs. Apply both refs in one `git update-ref --stdin` transaction: `start`, checked `create`/`update`, `prepare`, `commit`. Verify both original tips; never overwrite divergent backups or trust reflogs.

## Workflow

1. Switch to `target`; confirm `HEAD == target_tip`.
2. Run `git merge --squash "$source_ref"`. On conflict, stop without resolving or aborting.
3. Review status, staged diff/stat, and `git diff --cached --check`; stop on empty or unexpected output. Validate the repository.
4. Use `git-commit` to create one Conventional Commit describing the net change. Record `squash_tip`; verify its only parent is `target_tip`.
5. Switch to `source`; confirm `HEAD == source_tip`, then run:

   ```sh
   git merge --no-ff --no-edit "$target_ref"
   ```

   Keep Git's standard message; it is a Conventional Commits exception. On conflict, stop without resolving or aborting.

## Verification

Verify:

```sh
test "$(git rev-parse "$target_ref")" = "$squash_tip"
test "$(git rev-parse "$squash_tip^")" = "$target_tip"
test "$(git rev-list --parents -n1 "$squash_tip" | wc -w)" -eq 2
test "$(git rev-parse "$source_ref^1")" = "$source_tip"
test "$(git rev-parse "$source_ref^2")" = "$squash_tip"
test "$(git rev-list --parents -n1 "$source_ref" | wc -w)" -eq 3
test "$(git rev-parse "$source_backup")" = "$source_tip"
test "$(git rev-parse "$target_backup")" = "$target_tip"
git diff --exit-code "$target_ref" "$source_ref"
test -z "$(git status --porcelain=v1)"
```

Inspect the generated subject and graph; Git configuration may vary standard merge text.

## Example

For `dev` into `master`, use `bak/dev`, `bak/master`, then `git merge --no-ff --no-edit refs/heads/master` on `dev`.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Moving a divergent backup | Preserve canonicals; create a timestamp pair |
| Updating backups separately | Use one checked `update-ref` transaction |
| Customizing the reverse message | Use `--no-edit`, never `-m` |
| Auto-stashing, resolving, aborting, or pushing | Require explicit approval |

## Red Flags

Dirty state, name collisions, unavailable worktrees, ancestry failure, unverified backups, conflicts, unexpected ref movement, or failed validation all mean stop and report.
