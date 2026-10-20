# Contributing to OpenCode Kit

This guide describes the coding conventions and validation requirements for changes to OpenCode Kit. It applies to both maintainers and AI coding agents.

## Code style

**One semantic element should form one visual unit.** Prefer meaningful compactness: formatting should reveal structure and relationships, not merely minimize line count.

Choose layout by the construct's role and structure. The principles apply across programming languages; the examples below use JavaScript.

- Keep simple call-site options, tuples, short arrays, straightforward transformations, and short callbacks compact. Line length alone is not a reason to wrap.
- Lay out schemas and explicit result contracts field by field when their members need to be reviewed independently. Small inline options and metadata can stay compact inside a larger structure.
- Break substantial calls at argument boundaries so each argument remains a coherent unit. Simple options objects can stay inline within a complex call; a multiline callback or conditional expression can occupy its own argument block.
- Keep simple method chains together. Expand a compound chain when an enclosing call, several processing stages, and a multiline callback would otherwise compete for attention.
- Use explicit blocks for loops and ordinary conditional branches, even with a single statement. In paired success/failure handling, prefer the normal path first when practical. Immediate-exit guards and trivial handlers may stay inline.
- Separate algorithmic phases with blank lines; keep related statements together within each phase.
- Choose names that describe what a value represents in its context. Avoid vague placeholders that obscure meaningful distinctions; keep names as short as clarity allows.
- Choose between an inline expression and an intermediate variable according to readability and the language's idioms. A temporary can simplify an awkward expression; an idiomatic construct such as Kotlin's `let` can keep a transformation clear at the point of use.
- Keep structured data in its natural representation while assembling it. For line-oriented output, prefer one meaningful record per entry and add separators and terminators at the output boundary.
- Prefer four-space indentation for new JavaScript and TypeScript code. Preserve surrounding conventions for quotes, semicolons, and trailing commas when editing existing code.
- Keep formatting changes focused, and preserve behavior and error reporting in style-only refactors.

### Simple objects and transformations

Keep small call-site options and simple transformations together so their contents and relationships are visible at a glance.

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

### Names in context

Make the selected subset and the callback's element clear from their names.

Preferred:

```js
const pendingTasks = tasks.filter(task => task.status === "pending");
```

Avoid names that hide those distinctions:

```js
const data = tasks.filter(x => x.status === "pending");
```

### Schemas and result contracts

Give independently meaningful fields their own lines. Keep each field's value readable using the expression forms available in the language: either an inline transformation or an intermediate variable can be appropriate. A compact projection inside a field does not need the same expansion.

Preferred field layout (the JavaScript temporary is a readability choice, not a requirement to prepare fields separately):

```js
const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
const result = {
    status: "error",
    phase,
    write_state: writeState,
    error: errorMessage,
    backups: backups.map(({ ref }) => ref),
};
```

Avoid packing independent fields together:

```js
const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
const result = {
    status: "error", phase, write_state: writeState,
    error: errorMessage,
    backups: backups.map(({ ref }) => ref),
};
```

### Control flow and callbacks

Keep simple call arguments compact, but make paired outcomes explicit with blocks. Loops also get explicit blocks, even when their body is one awaited operation. A guard that immediately exits, such as `if (!valid) throw new Error("Invalid refs");`, may stay inline.

Preferred:

```js
execFile("git", args, { cwd: directory, signal }, (error, stdout, stderr) => {
    steps.push({ command: args[0], ok: !error });
    if (!error) {
        resolve(stdout.trim());
    } else {
        reject(new Error(stderr.trim() || error.message));
    }
});

for (const ref of refs) {
    await validateRef(ref);
}
```

Avoid treating ordinary branches and loop bodies as inline guards:

```js
execFile("git", args, { cwd: directory, signal }, (error, stdout, stderr) => {
    steps.push({ command: args[0], ok: !error });
    if (error) reject(new Error(stderr.trim() || error.message));
    else resolve(stdout.trim());
});

for (const ref of refs) await validateRef(ref);
```

### Substantial arguments

Separate a substantial condition from its diagnostic at the outer call's argument boundary. The condition can stay on one line: wrapping should expose the relationship between arguments.

Preferred:

```js
require(
    [...tips, ...backups.flatMap(({ old_tip }) => old_tip === null ? [] : [old_tip])].every(tip => /^[0-9a-f]{40}$/.test(tip)),
    "Use full object IDs"
);
```

Avoid a break inside the condition that leaves the diagnostic attached to its tail:

```js
require([...tips, ...backups.flatMap(({ old_tip }) => old_tip === null ? [] : [old_tip])]
    .every(tip => /^[0-9a-f]{40}$/.test(tip)), "Use full object IDs");
```

### Compound chains

When a chain includes a multiline callback and belongs to a larger expression, show the enclosing call and processing stages explicitly. The compact-chain example above still applies to simple projections.

Preferred:

```js
const observed = new Map(
    output
        .split("\n")
        .filter(Boolean)
        .map(line => {
            const [ref, tip] = line.split(" ");
            return [ref, { tip }];
        })
);
```

Avoid squeezing the outer call around the callback's body:

```js
const observed = new Map(output.split("\n").filter(Boolean).map(line => {
    const [ref, tip] = line.split(" ");
    return [ref, { tip }];
}));
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

### Structured data and serialization

Keep protocol commands as a list of meaningful records, then serialize them when writing. Each command is a separate step; the final newline is output formatting, not another command.

Preferred:

```js
const commands = [
    "start",
    `verify ${ref} ${tip}`,
    "prepare",
    "commit",
];
await writeCommands(commands.join("\n") + "\n");
```

Avoid hiding formatting in an empty list entry and immediately turning the list into a string:

```js
const commands = ["start", `verify ${ref} ${tip}`, "prepare", "commit", ""].join("\n");
await writeCommands(commands);
```

## Validation and dependencies

- Use npm and update `package.json` and `package-lock.json` together.
- Run `npm run typecheck` after changing TypeScript included by `tsconfig.json`, including tests.
- Run `npm test` after changing plugins or their tests.
- Before adding runtime dependencies to global resources, check the dependency-loading guidance in the `customize-opencode` skill.
