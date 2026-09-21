---
description: Squash one Git branch into another and synchronize their histories
agent: git
subtask: true
---

Interpret whitespace-separated arguments as follows:

- No arguments: use the current branch as `source` and determine `target` automatically.
- One argument: use the current branch as `source` and the argument as `target`.
- Two arguments: use the first as `source` and the second as `target`.
- More than two arguments: stop without changing the repository.

Reject detached HEAD, invalid or missing local branches, and identical branches.

For automatic target selection:

Read the source's upstream remote and its locally advertised default with `git for-each-ref --format='%(symref)' refs/remotes/<remote>/HEAD`. Consider the corresponding local branch plus `master`, `main`, and `release`. Keep ancestor candidates, prefer the remote default, otherwise choose the unique shortest `git rev-list --count <candidate>..<source>` distance. Stop on no candidate or a tie.

After resolving `source` and `target`, load `git-merge-squash`.

Arguments:

$ARGUMENTS
