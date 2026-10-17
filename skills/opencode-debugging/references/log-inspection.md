# Bounded OpenCode Log Inspection

Use only when a specific diagnostic question needs OpenCode's own event logs.
Logs are not the default starting point for every OpenCode problem.

**Core principle:** bound every content-producing operation at the source, then
stop as soon as the evidence answers the question.

## Workflow

1. Define an anchor: session ID, message ID, time range, agent, permission, tool
   call, or error text. Obtain a missing anchor before reading logs.
2. Locate the log directory using the installed runtime, such as `opencode debug
   paths`; the usual location is `~/.local/share/opencode/log/`. Inventory only
   filenames, sizes, and mtimes; select **one** file matching the time range.
3. Measure the candidate pattern before showing content:

   ```sh
   rg --count-matches -F 'ses_example_123' "$HOME/.local/share/opencode/log/selected.log"
   ```

4. Sample matches and capture line numbers:

   ```sh
   rg -n --max-count 20 --max-columns 500 --max-columns-preview -F 'ses_example_123' "$HOME/.local/share/opencode/log/selected.log"
   ```

5. Refine toward the event needed, such as `message=stream`, `agent=`,
   `permission=edit`, `action=allow`, or `action=deny`; count common patterns again.
6. Use `read` with explicit `offset` and `limit` around a relevant line. Start
   with **40**, never exceed **80** lines. For oversized lines, extract bounded
   fields or character windows instead; preview truncation is not complete evidence.
7. Stop when the evidence answers the question. Select another file sequentially
   only when a specific remaining gap or time boundary requires it.

Use the discovered directory in the examples if it differs from the usual path.
Keep unrelated prompts, credentials, and payloads out of displayed excerpts.

## Guardrails

- Bound every content search with a match limit and every `read` with
  `offset`/`limit`; count-only searches need no match limit.
- Locate relevant line numbers before adding context such as `-C`.
- Run log-content searches sequentially.
- Narrow the pattern rather than raising the 20-match or 80-line caps.

Exact identifiers, small files, urgency, and expected tool truncation do not
relax these guardrails. No match establishes only absence within the verified
search scope, not absence of the event everywhere.
