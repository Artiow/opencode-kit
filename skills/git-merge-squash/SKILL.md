---
name: git-merge-squash
description: Use when one Git branch's full history must land as a single squash commit on another branch while both branch histories remain synchronized.
---

# Git Squash Merge

Squash `source` into one `target` commit, then merge back. The model chooses branches, backups and the commit message; `git-backup-pair` only executes the selected backup writes.

## Resolve and check

1. Interpret whitespace-separated local branch names: 0 arguments means current source and automatic target; 1 means current source and explicit target; 2 means explicit source and target. More than 2: stop before Git operations.
2. In one turn, request `git branch --show-current`, `git status`, `git worktree list --porcelain`, and:

   ```sh
   git for-each-ref --format='%(refname) %(objectname) %(upstream:remotename) %(symref)' refs/heads/
   ```

   Stop for detached HEAD, dirty index/worktree, or an active operation. Validate supplied names with `git check-ref-format --branch <name>` and locate source in the snapshot.
3. **Automatic target only:** if the source has an upstream remote other than `.`, read its default with `git for-each-ref --format='%(symref)' refs/remotes/<remote>/HEAD`. Empty upstream/default is an ordinary absence. Consider the corresponding local branch plus existing `master`, `main`, `release`; deduplicate and exclude source. Keep candidates passing `git merge-base --is-ancestor <candidate-tip> <source-tip>`. Prefer a qualifying remote default; otherwise choose the unique smallest `git rev-list --count <candidate-tip>..<source-tip>`. Stop on none or a tie. These choices belong to the model, not a planner tool.
4. Require distinct existing nonsymbolic source/target branches; record their full refs and OIDs from the snapshot. Neither may be checked out in another worktree. Require `git merge-base --is-ancestor <target-tip> <source-tip>`; reuse a successful check of these same OIDs from selection. Stop if both tips are equal. For ancestry checks, exit 1 is false; other errors stop. Failed required checks stop before writes.

## Select backups, then execute

Inspect both canonical backups together with `git for-each-ref --format='%(refname) %(objectname) %(symref)' refs/heads/bak/<source> refs/heads/bak/<target>`; use exact matching refs, not prefix matches. Stop for symbolic backups.

For each canonical, accept missing, equal, or an ancestor of its working tip (`git merge-base --is-ancestor <backup-tip> <working-tip>`). If either is ahead/divergent, preserve both canonicals: get one `date -u +%Y%m%dT%H%M%SZ` and select `refs/heads/bak/<timestamp>/<source>` and `refs/heads/bak/<timestamp>/<target>` for creation. Otherwise select both canonicals. All four selected working/backup names must be distinct.

Call `git-backup-pair` once with recorded working refs/tips and exactly two entries, **source first, target second**. `old_tip: null` requests creation; an observed full OID requests a checked update, including an equal tip:

```json
{
  "source_ref": "<source_ref>", "source_tip": "<source_tip>",
  "target_ref": "<target_ref>", "target_tip": "<target_tip>",
  "backups": [
    { "ref": "<selected_source_backup>", "old_tip": null },
    { "ref": "<selected_target_backup>", "old_tip": null }
  ]
}
```

The example creates two backups; replace null with the observed OID for an update. The tool validates, executes one checked atomic transaction and confirms both refs. Continue only on `status: ok`. On error stop and report `phase` and `write_state`; `committed` or `unknown` must not be reported as unchanged. No retry, new name selection or raw Bash transaction fallback.

## Mutate with model boundaries

1. Run `git switch -- <target> && git rev-parse HEAD`. **Read and confirm** `HEAD == target_tip` before proceeding.
2. Run `git merge --squash <source_ref> && git diff --cached`. Use `git-commit` to create one commit, reusing the prepared index and patch output already in this context. Record its SHA as `squash_tip`.
3. Run `git switch -- <source> && git rev-parse HEAD`. **Read and confirm** `HEAD == source_tip`. Then run `git merge --no-ff --no-edit <target_ref>` and perform the final inspections in the same turn/group when no new decision intervenes.

On conflict or hook/command failure, stop with the actual phase/state; do not resolve, abort, bypass hooks or repair.

## Verify and report

Read both selected backups, `target`, `target^`, `source^1`, `source^2` and `source` together with `git rev-parse`. Require backups equal the original source/target tips, `target == squash_tip`, `target^ == target_tip`, `source^1 == source_tip`, and `source^2 == squash_tip`. Also require `git diff --quiet <target_ref> <source_ref>` and clean `git status --short`. Report source/target, squash and merge commits, backup refs and final status.

Use the canonical calls above: `branch --show-current` and `for-each-ref` replace unavailable `symbolic-ref`/`branch --list`. Backup writes are tool-only, so raw `update-ref`, `printf` and shell transaction scripts are unavailable. Do not add graph/history dumps, duplicate patch reads or project validation. A denied required call ends the workflow.
