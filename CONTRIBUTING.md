# Contributing to OpenCode Kit

This guide describes the coding conventions and validation requirements for changes to OpenCode Kit. It applies to both maintainers and AI coding agents.

## Code style

**One semantic element should form one visual unit.** Prefer meaningful compactness: formatting should reveal structure and relationships, not merely minimize line count.

- Keep simple objects, short arrays, straightforward transformations, and short callbacks compact. Line length alone is not a reason to wrap.
- Use multiline layout when it exposes substantial arguments, algorithmic stages, or significant branches. Do not mechanically put every property, argument, or statement on its own line; simple options objects can stay inline within a complex call.
- Keep simple method chains together. Split a chain when its stages or callback bodies benefit from separate visual units, not automatically at every method call.
- Expand substantial branches and callback bodies; short guards and trivial handlers may stay inline. Keep conditions, actions, and diagnostics visually connected.
- Separate algorithmic phases with blank lines; keep related statements together within each phase.
- Introduce intermediate names when they convey domain meaning, are reused, or clarify a complex expression. Avoid variables and helper functions that only fragment a readable operation.
- Prefer four-space indentation for new JavaScript and TypeScript code. Preserve surrounding conventions for quotes, semicolons, and trailing commas when editing existing code.
- Keep formatting changes focused, and preserve behavior and error reporting in style-only refactors.

### Simple objects and transformations

Keep small units together so their contents and relationships are visible at a glance.

Preferred:

```js
const options = { cwd: directory, signal, maxBuffer: 64 * 1024 };
const names = entries.filter(entry => entry.enabled).map(entry => entry.name);
```

Avoid mechanical expansion of these simple expressions:

```js
const options = {
    cwd: directory,
    signal,
    maxBuffer: 64 * 1024,
};
const names = entries
    .filter(entry => entry.enabled)
    .map(entry => entry.name);
```

### Substantial callbacks

Keep simple call arguments compact, but expand a callback that records an outcome and handles success or failure.

Preferred:

```js
execFile("git", args, { cwd: directory, signal }, (error, stdout, stderr) => {
    steps.push({ command: args[0], ok: !error });
    if (error) reject(new Error(stderr.trim() || error.message));
    else resolve(stdout.trim());
});
```

Avoid compressing the callback's distinct actions into one line:

```js
execFile("git", args, { cwd: directory, signal }, (error, stdout, stderr) => { steps.push({ command: args[0], ok: !error }); if (error) reject(new Error(stderr.trim() || error.message)); else resolve(stdout.trim()); });
```

### Algorithmic phases

Use blank lines to separate inspection and validation from building and writing a transaction.

Preferred:

```js
const refs = await readRefs();
validateRefs(refs);

const transaction = buildTransaction(refs);
await writeTransaction(transaction);
```

Avoid separating every related statement:

```js
const refs = await readRefs();

validateRefs(refs);

const transaction = buildTransaction(refs);

await writeTransaction(transaction);
```

## Validation and dependencies

- Use npm and update `package.json` and `package-lock.json` together.
- Run `npm run typecheck` after changing TypeScript included by `tsconfig.json`, including tests.
- Run `npm test` after changing plugins or their tests.
- Before adding runtime dependencies to global resources, check the dependency-loading guidance in the `customize-opencode` skill.
