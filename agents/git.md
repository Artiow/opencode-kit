---
description: >-
  Creates Git commits and performs synchronized squash merges.

mode: subagent
temperature: 0.1
permission:
  "*": deny

  skill:
    "*": deny
    "git-commit": allow
    "git-merge-squash": allow

  bash:
    "*": deny
    "git branch --show-current": allow
    "git check-ref-format --branch *": allow
    "git diff": allow
    "git diff *": allow
    "git for-each-ref": allow
    "git for-each-ref *": allow
    "git merge-base *": allow
    "git rev-parse *": allow
    "git rev-list *": allow
    "git status": allow
    "git status *": allow
    "git switch -- *": allow
    "git update-ref --stdin *": allow
    "git worktree list": allow
    "git worktree list *": allow

    "git add -- *": allow
    "git commit *": allow
    "git merge --no-ff --no-edit *": allow
    "git merge --squash *": allow

    "date -u +%Y%m%dT%H%M%SZ": allow

    "git add -- .": deny
    "git add -- ./": deny
    "git add -- :/*": deny
    "git add -A*": deny
    "git add --all*": deny
    "git add -u*": deny
    "git add --update*": deny
    "git commit -a*": deny
    "git commit --all*": deny
    "git commit * -a*": deny
    "git commit * --all*": deny
    "git commit *--allow-empty*": deny
    "git commit *--amend*": deny
    "git commit *--no-verify*": deny
    "git commit * -- .": deny
    "git commit * -- ./": deny
    "git commit * -- :/*": deny
    "git commit *--only .": deny
    "git commit *--only ./": deny
    "git commit *--only :/*": deny
    "git diff *--ext-diff*": deny
    "git diff *--output*": deny
    "git diff *--textconv*": deny
    "git merge *--abort*": deny
    "git merge *--allow-unrelated-histories*": deny
    "git merge *--autostash*": deny
    "git merge *--continue*": deny
    "git merge *--edit*": deny
    "git merge *--file*": deny
    "git merge *--message*": deny
    "git merge *--no-commit*": deny
    "git merge *--no-verify*": deny
    "git merge *--quit*": deny
    "git merge *--strategy*": deny
    "git merge * -e*": deny
    "git merge * -F*": deny
    "git merge * -m*": deny
    "git merge * -s*": deny
    "git merge * -X*": deny
    "git merge --no-ff --no-edit *--squash*": deny
    "git merge --squash *--no-squash*": deny
---

Execute the requested Git workflow without editing files or running project validation.
