# Contributing to OpenCode Kit

Rules for maintainers and AI coding agents.

## Code style

**One semantic element should form one visual unit.** Choose layout by role and structure, not minimum line count. Line length alone is not a reason to wrap.

- Prefer four-space indentation for new JavaScript/TypeScript. Preserve surrounding quotes, semicolons, and trailing commas when editing.
- Keep style-only changes focused; preserve consumer-relevant behavior and compatibility.

### Simple objects and transformations

Keep simple options, tuples, short arrays, transformations, callbacks, and method chains compact.

Preferred:

```js
const options = { limit: 10, cache: true };
const names = items.filter(item => item.active).map(item => item.name);
```

Avoid:

```js
const options = {
    limit: 10,
    cache: true,
};
const names = items
    .filter(item => item.active)
    .map(item => item.name);
```

### Names in context

Name values by their meaning in context; avoid vague placeholders. Keep names as short as clarity allows.

```js
// Preferred
const activeItems = items.filter(item => item.active);

// Avoid
const data = items.filter(x => x.active);
```

### Schemas and result contracts

Give independently reviewable schema/result fields separate lines. Small options and metadata may stay inline.

Preferred:

```js
const result = {
    ok: true,
    count: items.length,
    names: items.map(item => item.name),
};
```

Avoid:

```js
const result = {
    ok: true, count: items.length,
    names: items.map(item => item.name),
};
```

Prefer clear expressions at their point of use. Extract variables to avoid repetition, awkward nesting, or cumbersome expressions, not merely to name a field value. Use language idioms such as Kotlin's `let` when clearer.

```js
const name = input.trim();
const label = name.length > 8 ? `${name.slice(0, 7)}…` : name;
```

### Control flow and callbacks

Use blocks for ordinary branches and loops, even with one statement. Prefer the normal path first when practical: `!error` means success in an error-first callback. Immediate-exit guards (e.g. `if (!ready) throw new Error("Not ready");`) and trivial handlers may stay inline.

Preferred:

```js
check(item, error => {
    if (!error) {
        accept(item);
    } else {
        reject(item);
    }
});

for (const item of items) {
    save(item);
}
```

Avoid:

```js
check(item, error => {
    if (error) reject(item);
    else accept(item);
});

for (const item of items) save(item);
```

### Substantial arguments

Break substantial calls at argument boundaries, keeping each argument coherent. Simple options may stay inline; a complex callback or conditional may occupy a multiline argument. Keep a condition separate from its diagnostic:

Preferred:

```js
assert(
    items.filter(item => item.active).every(item => item.ready),
    "Items not ready"
);
```

Avoid:

```js
assert(items.filter(item => item.active)
    .every(item => item.ready), "Items not ready");
```

### Compound chains

Expand compound chains with multiline callbacks inside larger expressions, exposing the enclosing call and processing stages.

Preferred:

```js
const scores = new Map(
    items
        .filter(item => item.active)
        .map(item => {
            const score = rate(item);
            return [item.id, { score, passed: score > 0 }];
        })
);
```

Avoid:

```js
const scores = new Map(items.filter(item => item.active).map(item => {
    const score = rate(item);
    return [item.id, { score, passed: score > 0 }];
}));
```

### Algorithmic phases

Separate phases with blank lines; keep related statements together.

Preferred:

```js
const items = readItems();
validate(items);

const result = transform(items);
write(result);
```

Avoid:

```js
const items = readItems();

validate(items);

const result = transform(items);

write(result);
```

### Structured data and serialization

Assemble data in its natural structured form; serialize at the output boundary. For line-oriented output, keep one record per entry and add separators/terminators when writing.

```js
// Preferred
const lines = ["alpha", "beta"];
write(lines.join("\n") + "\n");

// Avoid
const text = ["alpha", "beta", ""].join("\n");
write(text);
```

## Validation and dependencies

- Use npm and update `package.json` and `package-lock.json` together.
- Run `npm run typecheck` after changing TypeScript included by `tsconfig.json`, including tests.
- Run `npm test` after changing plugins or their tests.
- Before adding runtime dependencies to global resources, check the dependency-loading guidance in the `customize-opencode` skill.
