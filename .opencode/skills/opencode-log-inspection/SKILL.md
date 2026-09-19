---
name: opencode-log-inspection
description: Use only when direct inspection of OpenCode's own log files has already been determined necessary for a concrete diagnostic question; do not use merely because OpenCode is being discussed or debugged.
---

# OpenCode Log Inspection

## Overview

This skill governs log inspection without making logs the default diagnostic approach.

**Core principle:** bound every content-producing operation at the source, then stop as soon as the evidence answers the question.

## Context Budget

Use one selected file, count before displaying, cap searches at 20 matches and reads at 80 lines, and run content searches sequentially. These caps are absolute.

## Workflow

1. Define an anchor: session ID, message ID, time range, agent, permission, tool call, or error text. Obtain a missing anchor before reading logs.
2. Inventory only filenames, sizes, and mtimes under `~/.local/share/opencode/log/`; select one file matching the time range.
3. Measure the candidate pattern before showing content:

   ```sh
   rg --count-matches -F 'ses_example_123' "$HOME/.local/share/opencode/log/selected.log"
   ```

4. Sample matches and capture line numbers:

   ```sh
   rg -n --max-count 20 -F 'ses_example_123' "$HOME/.local/share/opencode/log/selected.log"
   ```

5. Refine toward `message=stream`, `agent=`, `permission=edit`, `action=allow`, or `action=deny`; count common patterns again.
6. Use `read` with explicit `offset` and `limit` around a relevant line. Start with 40, never exceed 80.
7. Stop when the evidence answers the question.

`opencode debug skill` emits all skill bodies and truncates at 65,536 bytes, breaking JSON. Never run it raw or pipe it to `jq`; match only the anchored name line:

```sh
opencode debug skill | rg -n --max-count 1 '^\s*"name": "opencode-log-inspection",$'
```

## Quick Reference

| Need | Safe operation |
|---|---|
| Choose a file | Filename, size, and mtime metadata only |
| Estimate scope | `rg --count-matches` |
| Locate evidence | `rg -n --max-count 20` on one file |
| Inspect context | `read` with explicit offset and limit <= 80 |
| Refine | Narrow the anchor or pattern; never raise the caps |

## Common Mistakes

| Rationalization | Correction |
|---|---|
| "The session ID is exact, so output will be small." | A session ID may occur thousands of times. Count first. |
| "The tool will truncate excessive output." | Bound output at the command instead. |
| "One broad query is faster." | Large results cost time and context; narrow first. |
| "Parallel searches save time." | Their outputs accumulate together. Search sequentially. |
| "A large window avoids another call." | Small targeted windows are cheaper. |

## Red Flags

Stop before executing any of these:

- Reading a log with `cat` or an unbounded `read` call
- Running a content-producing `rg`, `grep`, or search without a match limit; count-only searches are exempt
- Searching every log's contents before using time and file metadata
- Adding broad context flags such as `-C` before locating relevant line numbers
- Launching multiple log-content searches in parallel
- Running `opencode debug skill` without an in-command filter
- Continuing after the diagnostic question has already been answered
