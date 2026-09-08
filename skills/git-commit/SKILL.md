---
name: git-commit
description: Rules for splitting changes into focused Git commits and writing Conventional Commit messages.
---

# Git Commit Rules

Use Conventional Commits for every commit.

## Required format

```text
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

Valid shorter form when there is no scope:

```text
<type>: <short description>
```

Breaking change form:

```text
<type>(<scope>)!: <short description>
```

or:

```text
<type>(<scope>): <short description>

BREAKING CHANGE: <what changed and what must be updated>
```

## Hard rules

* Always use a Conventional Commits prefix.
* Always write the `type` in lowercase.
* Use a scope when the affected area is clear and specific.
* Keep the short description concise and factual.
* Do not end the short description with a period.
* Use imperative style in the short description.
* Describe what the commit does, not what was done during development.
* Mark every breaking change explicitly with `!` and/or a `BREAKING CHANGE:` footer.
* Add a body only when extra context is actually useful.
* Add footers only for structured metadata or breaking-change notes.

## Preferred types

Use these types unless project-specific rules define more:

* `feat`: new user-visible behavior or capability
* `fix`: bug fix
* `refactor`: internal code change without behavior change
* `perf`: performance improvement
* `docs`: documentation only
* `test`: tests only
* `build`: build system, dependencies, packaging
* `ci`: CI/CD pipeline or automation
* `chore`: repository maintenance or minor housekeeping
* `revert`: revert a previous change

## Scope rules

Use a short noun naming the changed area, for example:

* `api`
* `auth`
* `ui`
* `db`
* `config`
* `deps`
* `build`
* `player`
* `inventory`

Do not use broad or meaningless scopes like:

* `stuff`
* `misc`
* `update`
* `changes`

Omit the scope if the change is cross-cutting or no single area is dominant.

## Description rules

The first line must be easy to scan in `git log`.

Good:

```text
fix(auth): reject expired refresh tokens
feat(api): add pagination to invoice list endpoint
refactor(player): extract jump buffering into separate component
```

Bad:

```text
fix: fixed bug
feat(ui): some improvements.
chore: work in progress
refactor: changes
```

## Body rules

Use the body for details that matter later:

* why the change exists
* important implementation notes
* migration notes
* constraints, caveats, side effects

Keep it compact. Do not dump PR commentary, temporary thoughts, or implementation diary text.

## Footer rules

Use standard trailer-like footers when needed, for example:

```text
Refs: #123
Reviewed-by: Name
Co-authored-by: Name <email@example.com>
```

Use breaking-change footer like this:

```text
BREAKING CHANGE: config key `foo` was removed; use `bar` instead
```

`BREAKING CHANGE` must be uppercase.

## Commit splitting rules

Prefer multiple focused commits over one mixed commit.

Split commits when one change includes different intents, for example:

* bug fix + refactor
* feature + formatting cleanup
* dependency bump + unrelated code edits
* production code + unrelated test cleanup

One commit should represent one main reason to exist.

## What not to do

* Do not create vague commit messages.
* Do not mix unrelated changes into one commit when avoidable.
* Do not use `feat` for refactors.
* Do not use `fix` for new behavior.
* Do not hide breaking changes.
* Do not write commit titles like `update`, `misc fixes`, `wip`, `temp`, `final`, `small changes`.

## Commit decision rules

When determining how changes should be committed:

1. Determine the single primary intent of each commit.
2. Choose the matching type.
3. Add a scope only if it improves clarity.
4. Write a short imperative description.
5. Detect breaking changes explicitly.
6. Add a body only if future readers need context.
7. Add structured footers only when they carry real metadata.

If the changes contain multiple primary intents, split them into separate focused commits when practical.

## Templates

Minimal:

```text
fix(scope): short description
```

With body:

```text
refactor(scope): short description

Explain the reason for the change and any important implementation detail.
```

With breaking change:

```text
feat(api)!: rename invoice status field

BREAKING CHANGE: `state` was renamed to `status` in the public API
```

With footer:

```text
fix(parser): handle empty array values

Refs: #123
```
