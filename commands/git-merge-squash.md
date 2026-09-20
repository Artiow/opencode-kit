---
description: Squash one Git branch into another and synchronize their histories
agent: git
subtask: true
---

Interpret the whitespace-separated arguments strictly:

- No arguments: use the current branch as `source` and determine `target` automatically.
- One argument: use the current branch as `source` and the argument as `target`.
- Two arguments: use the first as `source` and the second as `target`.
- More than two arguments: stop and report the accepted forms without changing repository state.

Validate argument count before loading skills or running Git commands. For an accepted form, load and follow the `git-merge-squash` skill and every sub-skill it requires.

Reject detached HEAD, invalid branch names, missing local branches, or identical source and target branches.

For automatic target selection:

1. Read the source branch's upstream remote. Use `git for-each-ref --format='%(symref)' refs/remotes/<remote>/HEAD` to read its locally advertised default ref, remove the `refs/remotes/<remote>/` prefix, and map the remainder to the same local branch name. Use it only when that local branch exists.
2. Consider that branch and local branches named `master`, `main`, or `release`; deduplicate their full local refs.
3. Keep only distinct candidates for which `git merge-base --is-ancestor <candidate> <source>` succeeds.
4. Prefer the upstream remote's default branch when it is valid.
5. Otherwise calculate each distance with `git rev-list --count <candidate>..<source>` and choose the unique minimum.
6. If no candidate qualifies or the shortest distance is tied, stop and report the candidates without changing repository state.

Arguments:

$ARGUMENTS
