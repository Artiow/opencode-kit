---
description: Validate and deploy this repository with GNU Stow
agent: general
subtask: true
---

Deploy this repository's managed OpenCode resources with GNU Stow. Follow the procedure exactly and stop immediately when any check or command fails.

This command accepts no arguments. If the text below contains anything other than whitespace, stop before running shell commands and report that `/stow-deploy` takes no arguments.

Arguments:

$ARGUMENTS

Do not edit files, stage changes, create commits, or attempt to fix failures. Run every command from the Git worktree root without using `cd`.

1. Resolve the worktree root with `git rev-parse --show-toplevel`. Require it to be the current OpenCode project and require its directory name to be `opencode-kit`; otherwise stop.
2. Run `git status --porcelain=v1 --untracked-files=all`. If it produces any output, stop and report that deployment requires a clean working tree.
3. Run `npm test`.
4. Run `git diff --check`.
5. Run `git status --porcelain=v1 --untracked-files=all` again. If the tests changed the working tree, stop before running Stow.
6. Verify that `stow` and `opencode` are available and that `$HOME/.config/opencode` is an existing directory.
7. Run this exact dry-run command:

   `stow -n -v -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit`

   Inspect its complete output. Normal restow `UNLINK`/`LINK` pairs marked `(reverts previous action)` are expected. If the command fails, reports a conflict, or proposes an operation outside the managed paths under `$HOME/.config/opencode`, stop without deploying.
8. Only after every preceding step succeeds, run this exact deployment command:

   `stow -R --no-folding -d .. -t "$HOME/.config/opencode" opencode-kit`

9. Validate the deployed configuration with `opencode debug config >/dev/null` and `opencode debug skill >/dev/null`.
10. Run `git status --porcelain=v1 --untracked-files=all` again and require no output.

Return a concise report listing the checks performed and whether deployment completed. On success, remind the user to quit and restart OpenCode so config-time resources are reloaded.
