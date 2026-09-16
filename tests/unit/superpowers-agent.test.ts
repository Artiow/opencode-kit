import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import type { Hooks, Plugin } from "@opencode-ai/plugin"
import SuperpowersAgentPlugin from "../../plugins/superpowers-agent"

const createSuperpowersAgentPlugin = SuperpowersAgentPlugin.createForTesting

type Upstream = Awaited<ReturnType<Plugin>>

function skillsFixture(skills: Array<[string, string]> = [
  ["using-superpowers", "using-superpowers"],
  ["brainstorming", "brainstorming"],
]): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "superpowers-agent-"))
  for (const [folder, name] of skills) {
    mkdirSync(join(dir, folder))
    writeFileSync(join(dir, folder, "SKILL.md"), `---\nname: ${name}\n---\n`)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true }) }
}

async function load(
  overrides: {
    opencodeVersion?: string
    superpowersVersion?: string
    dir?: string
    upstream?: Upstream | unknown
    agents?: string[]
  } = {},
): Promise<Hooks> {
  const fixture = overrides.dir ? undefined : skillsFixture()
  const plugin = createSuperpowersAgentPlugin({
    opencodeVersion: () => overrides.opencodeVersion ?? "1.18.30",
    superpowersVersion: () => overrides.superpowersVersion ?? "6.3.0",
    skillsDir: () => overrides.dir ?? fixture!.dir,
    upstreamPlugin: (async () => overrides.upstream ?? {
      config: async () => {},
      "experimental.chat.messages.transform": async () => {},
    }) as never,
  })

  try {
    return await plugin({} as never, { agents: overrides.agents ?? [] })
  } finally {
    fixture?.cleanup()
  }
}

function userMessage(
  sessionID: string,
  agent: string,
  id = "user",
  created = 1,
) {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created },
      agent,
      model: { providerID: "test", modelID: "test" },
    },
    parts: [],
  }
}

function messages(sessionID: string, agent: string, userID = "user", assistantID = "assistant") {
  return [
    userMessage(sessionID, agent, userID),
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        parentID: userID,
        agent,
      },
      parts: [],
    },
  ] as never
}

async function transform(hooks: Hooks, sessionID: string, agent: string) {
  await hooks["experimental.chat.messages.transform"]!(
    {},
    { messages: messages(sessionID, agent) },
  )
}

for (const version of ["1.18.30", "1.18.999"]) {
  test(`accepts supported OpenCode boundary ${version}`, async () => {
    assert.equal(typeof (await load({ opencodeVersion: version })).config, "function")
  })
}

for (const version of ["1.18.29", "1.19.0", "2.0.0", "1.18", "v1.18.30", "1.18.30-beta.1"]) {
  test(`rejects unsupported or malformed OpenCode version ${version}`, async () => {
    await assert.rejects(load({ opencodeVersion: version }), {
      message: `[superpowers-agent] expected @opencode-ai/plugin >=1.18.30 <1.19.0, actual ${version}`,
    })
  })
}

for (const version of ["6.3.1", "6.3", "v6.3.0"]) {
  test(`rejects unsupported or malformed Superpowers version ${version}`, async () => {
    await assert.rejects(load({ superpowersVersion: version }), {
      message: `[superpowers-agent] expected superpowers 6.3.0, actual ${version}`,
    })
  })
}

test("rejects missing or unreadable skill assets", async () => {
  await assert.rejects(load({ dir: join(tmpdir(), "missing-superpowers-skills") }),
    /\[superpowers-agent] cannot read Superpowers skills directory/)
})

test("rejects an empty skills directory", async () => {
  const fixture = skillsFixture([])
  try {
    await assert.rejects(load({ dir: fixture.dir }), /no Superpowers skills found/)
  } finally {
    fixture.cleanup()
  }
})

test("reports all bundled duplicate names and sorted SKILL.md paths", async () => {
  const fixture = skillsFixture([
    ["z-policy", "using-superpowers"],
    ["a-brain", "brainstorming"],
    ["y-policy", "using-superpowers"],
    ["z-brain", "brainstorming"],
  ])
  try {
    await assert.rejects(load({ dir: fixture.dir }), (error: Error) => {
      const brainPaths = ["a-brain", "z-brain"]
        .map((folder) => join(fixture.dir, folder, "SKILL.md"))
      const policyPaths = ["y-policy", "z-policy"]
        .map((folder) => join(fixture.dir, folder, "SKILL.md"))
      assert.match(error.message, new RegExp([
        'duplicate bundled skill name "brainstorming":',
        ...brainPaths,
        'duplicate bundled skill name "using-superpowers":',
        ...policyPaths,
      ].map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*")))
      return true
    })
  } finally {
    fixture.cleanup()
  }
})

test("rejects malformed and missing policy skills", async (t) => {
  const cases: Array<[string, Array<[string, string]>, RegExp]> = [
    ["malformed", [["bad", ""]], /skill has no valid name/],
    ["missing policy", [["brainstorming", "brainstorming"]], /required skill "using-superpowers" not found/],
  ]

  for (const [name, skills, expected] of cases) {
    await t.test(name, async () => {
      const fixture = skillsFixture(skills)
      try {
        await assert.rejects(load({ dir: fixture.dir }), expected)
      } finally {
        fixture.cleanup()
      }
    })
  }
})

test("rejects missing required upstream hooks", async () => {
  await assert.rejects(load({ upstream: {} }), /required upstream config hook is not callable/)
  await assert.rejects(load({ upstream: { config: async () => {} } }),
    /required upstream experimental\.chat\.messages\.transform hook is not callable/)
})

test("delegates both required upstream hooks", async () => {
  let configCalls = 0
  let transformCalls = 0
  type HookConfig = Parameters<NonNullable<Hooks["config"]>>[0]
  let upstreamConfig: HookConfig | undefined
  const hooks = await load({
    upstream: {
      config: async (config: HookConfig) => {
        configCalls++
        upstreamConfig = config
      },
      "experimental.chat.messages.transform": async () => { transformCalls++ },
    },
  })
  const config = { agent: {} }

  await hooks.config!(config)
  const transform = hooks["experimental.chat.messages.transform"]!
  await transform({}, {
    messages: messages("direct", "superpowers"),
  } as never)

  assert.equal(configCalls, 1)
  assert.notStrictEqual(upstreamConfig, config)
  assert.equal(transformCalls, 1)
})

test("discards upstream mutations when upstream throws", async () => {
  let transformCalls = 0
  const hooks = await load({
    agents: ["build"],
    upstream: {
      config: async (config: Record<string, any>) => {
        config.skills = { paths: ["staged"] }
        config.agent.build.changed = true
        throw new Error("upstream failed")
      },
      "experimental.chat.messages.transform": async () => { transformCalls++ },
    },
  })
  const nested = { retained: true }
  const build = { nested }
  const config: Record<string, any> = { agent: { build }, untouched: nested }
  const snapshot = structuredClone(config)

  await assert.rejects(hooks.config!(config as never), /upstream failed/)
  await transform(hooks, "direct", "build")

  assert.deepEqual(config, snapshot)
  assert.strictEqual(config.agent.build, build)
  assert.strictEqual(config.untouched, nested)
  assert.equal(transformCalls, 0)
})

test("discards upstream mutations on a downstream wrapper failure", async () => {
  const hooks = await load({
    upstream: {
      config: async (config: Record<string, any>) => {
        config.addedByUpstream = { staged: true }
        delete config.removedByUpstream
      },
      "experimental.chat.messages.transform": async () => {},
    },
  })
  const permission = { skill: true }
  const config: Record<string, any> = {
    permission,
    removedByUpstream: { retained: true },
  }
  const snapshot = structuredClone(config)

  await assert.rejects(hooks.config!(config as never), /permission\.skill must/)

  assert.deepEqual(config, snapshot)
  assert.strictEqual(config.permission, permission)
})

test("atomically reconciles complete upstream and wrapper changes", async () => {
  let receivedDraft: unknown
  const hooks = await load({
    agents: ["build"],
    upstream: {
      config: async (config: Record<string, any>) => {
        receivedDraft = config
        config.added = { values: [1, { stable: true }] }
        config.array = [{ stable: true }, { changed: true }]
        delete config.removed
      },
      "experimental.chat.messages.transform": async () => {},
    },
  })
  const stable = { stable: true }
  const changed = { changed: false }
  const unchangedTop = { retained: true }
  const config: Record<string, any> = {
    agent: { build: {} },
    array: [stable, changed],
    removed: true,
    unchangedTop,
  }
  const root = config
  const originalArray = config.array

  await hooks.config!(config as never)

  assert.strictEqual(config, root)
  assert.notStrictEqual(receivedDraft, root)
  assert.equal("removed" in config, false)
  assert.deepEqual(config.added, { values: [1, { stable: true }] })
  assert.strictEqual(config.unchangedTop, unchangedTop)
  assert.notStrictEqual(config.array, originalArray)
  assert.strictEqual(config.array[0], stable)
  assert.notStrictEqual(config.array[1], changed)
  assert.equal(config.agent.build.permission.skill.brainstorming, "allow")
  assert.equal(config.agent.superpowers.mode, "primary")
})

test("detects an uncommittable root before applying staged changes", async () => {
  const hooks = await load()
  const agent = {}
  const config: Record<string, any> = {}
  Object.defineProperty(config, "agent", {
    configurable: true,
    enumerable: true,
    value: agent,
    writable: false,
  })

  await assert.rejects(hooks.config!(config as never), /cannot replace config\.agent/)

  assert.deepEqual(config, { agent: {} })
  assert.strictEqual(config.agent, agent)
  assert.equal("permission" in config, false)
})

test("creates the default superpowers agent when absent", async () => {
  const hooks = await load()
  const config: Record<string, any> = {}

  await hooks.config!(config as never)

  assert.deepEqual(config.agent.superpowers, {
    mode: "primary",
    description: "OpenCode with the full Superpowers workflow",
    permission: {
      skill: {
        brainstorming: "allow",
        "using-superpowers": "deny",
      },
    },
  })
  assert.equal("model" in config.agent.superpowers, false)
})

test("augments a customized superpowers agent without a collision", async () => {
  const hooks = await load()
  const superpowers: Record<string, any> = {
    model: "provider/custom",
    description: "Custom description",
    prompt: "Custom prompt",
    temperature: 0.2,
    customAgentField: { retained: true },
    permission: {
      bash: { "git status": "allow" },
      skill: {
        "private-*": "ask",
        brainstorming: "deny",
      },
    },
  }
  const config: Record<string, any> = { agent: { superpowers } }

  await hooks.config!(config as never)

  const configured = config.agent.superpowers
  assert.notStrictEqual(configured, superpowers)
  assert.equal(configured.mode, "primary")
  assert.equal(configured.model, "provider/custom")
  assert.equal(configured.description, "Custom description")
  assert.equal(configured.prompt, "Custom prompt")
  assert.equal(configured.temperature, 0.2)
  assert.strictEqual(configured.customAgentField, superpowers.customAgentField)
  assert.strictEqual(configured.permission.bash, superpowers.permission.bash)
  assert.deepEqual(Object.entries(configured.permission.skill), [
    ["private-*", "ask"],
    ["brainstorming", "allow"],
    ["using-superpowers", "deny"],
  ])
})

test("retains an explicit superpowers mode", async () => {
  const hooks = await load()
  const config: Record<string, any> = {
    agent: { superpowers: { mode: "subagent" } },
  }

  await hooks.config!(config as never)

  assert.equal(config.agent.superpowers.mode, "subagent")
})

test("leaves a disabled superpowers agent untouched and suppresses bootstrap", async () => {
  let transformCalls = 0
  const hooks = await load({
    upstream: {
      config: async () => {},
      "experimental.chat.messages.transform": async () => { transformCalls++ },
    },
  })
  const superpowers = {
    disable: true,
    description: "Disabled by user",
    permission: { bash: "ask" },
  }
  const config: Record<string, any> = { agent: { superpowers } }

  await hooks.config!(config as never)
  await transform(hooks, "root", "superpowers")
  await transform(hooks, "task-child", "superpowers")

  assert.strictEqual(config.agent.superpowers, superpowers)
  assert.deepEqual(superpowers, {
    disable: true,
    description: "Disabled by user",
    permission: { bash: "ask" },
  })
  assert.equal(transformCalls, 0)
})

test("enables every absent OpenCode 1.18.31 built-in agent", async () => {
  const agents = [
    "build", "plan", "general", "explore", "compaction", "title", "summary",
  ]
  const hooks = await load({ agents })
  const config: Record<string, any> = {}

  await hooks.config!(config as never)

  for (const agent of agents) {
    assert.deepEqual(config.agent[agent], {
      permission: {
        skill: {
          brainstorming: "allow",
          "using-superpowers": "deny",
        },
      },
    })
  }
})

test("enables a configured custom agent regardless of mode or visibility", async () => {
  const hooks = await load({ agents: ["internal-reviewer"] })
  const custom = { mode: "primary", hidden: true }
  const config: Record<string, any> = { agent: { "internal-reviewer": custom } }

  await hooks.config!(config as never)

  assert.notStrictEqual(config.agent["internal-reviewer"], custom)
  assert.equal(config.agent["internal-reviewer"].permission.skill.brainstorming, "allow")
})

for (const [name, config] of [
  ["built-in", { agent: { build: { disable: true } } }],
  ["custom", { agent: { reviewer: { disable: true } } }],
] as const) {
  test(`rejects a disabled ${name} agent`, async () => {
    const agent = name === "built-in" ? "build" : "reviewer"
    const hooks = await load({ agents: [agent] })
    await assert.rejects(hooks.config!(config as never), {
      message: `[superpowers-agent] invalid configured agents:\n  "${agent}" is disabled`,
    })
  })
}

test("rejects an unknown agent", async () => {
  const hooks = await load({ agents: ["buidl"] })
  await assert.rejects(hooks.config!({} as never), {
    message: '[superpowers-agent] invalid configured agents:\n  "buidl" does not exist',
  })
})

for (const [name, mode] of [["primary", "primary"], ["subagent", "subagent"]] as const) {
  test(`bootstraps a directly selected ${name} agent`, async () => {
    let calls = 0
    const hooks = await load({
      agents: ["reviewer"],
      upstream: {
        config: async () => {},
        "experimental.chat.messages.transform": async () => { calls++ },
      },
    })
    await hooks.config!({ agent: { reviewer: { mode } } } as never)
    await transform(hooks, "direct", "reviewer")
    assert.equal(calls, 1)
  })
}

test("routes enabled root and task-child-shaped histories identically", async () => {
  let calls = 0
  const hooks = await load({
    agents: ["build"],
    upstream: {
      config: async () => {},
      "experimental.chat.messages.transform": async () => { calls++ },
    },
  })
  const config: Record<string, any> = { agent: { build: {} } }
  await hooks.config!(config as never)
  await transform(hooks, "root", "build")
  await transform(hooks, "child", "build")
  assert.equal(config.agent.build.permission.skill.brainstorming, "allow")
  assert.equal(calls, 2)
})

for (const name of ["root", "task-child"] as const) {
  test(`generated superpowers agent bootstraps a ${name}-shaped history`, async () => {
    let calls = 0
    const hooks = await load({
      upstream: {
        config: async () => {},
        "experimental.chat.messages.transform": async () => { calls++ },
      },
    })
    await hooks.config!({} as never)
    await transform(hooks, name, "superpowers")
    assert.equal(calls, 1)
  })
}

test("routes explicitly enabled internal agent names without special cases", async () => {
  let calls = 0
  const hooks = await load({
    agents: ["compaction", "title", "summary"],
    upstream: {
      config: async () => {},
      "experimental.chat.messages.transform": async () => { calls++ },
    },
  })
  await hooks.config!({} as never)
  for (const agent of ["compaction", "title", "summary"]) {
    await transform(hooks, "direct", agent)
  }
  assert.equal(calls, 3)
})

test("does not route non-enabled or missing-user histories", async () => {
  let calls = 0
  const hooks = await load({
    agents: ["build"],
    upstream: {
      config: async () => {},
      "experimental.chat.messages.transform": async () => { calls++ },
    },
  })
  await hooks.config!({ agent: { build: {} } } as never)
  const transformHook = hooks["experimental.chat.messages.transform"]!

  await transformHook({}, { messages: messages("session", "plan") })
  await transformHook({}, { messages: [] })
  await transformHook({}, { messages: [messages("session", "build")[1]] } as never)

  assert.equal(calls, 0)
})

test("agent switching follows the chronologically latest user message", async () => {
  const routed: string[] = []
  const hooks = await load({
    agents: ["build"],
    upstream: {
      config: async () => {},
      "experimental.chat.messages.transform": async (_input: unknown, output: any) => {
        routed.push(output.messages.map((message: any) => message.info.id).join(","))
      },
    },
  })
  await hooks.config!({ agent: { build: {} } } as never)
  const transformHook = hooks["experimental.chat.messages.transform"]!

  await transformHook({}, { messages: [
    userMessage("session", "build", "first", 1),
    userMessage("session", "plan", "second", 2),
  ] } as never)
  await transformHook({}, { messages: [
    userMessage("session", "plan", "first", 1),
    userMessage("session", "build", "second", 2),
  ] } as never)

  assert.deepEqual(routed, ["first,second"])
})

test("orders user messages by timestamp and ID regardless of array order", async () => {
  let calls = 0
  const hooks = await load({
    agents: ["build"],
    upstream: {
      config: async () => {},
      "experimental.chat.messages.transform": async () => { calls++ },
    },
  })
  await hooks.config!({ agent: { build: {} } } as never)
  const transformHook = hooks["experimental.chat.messages.transform"]!

  await transformHook({}, { messages: [
    userMessage("session", "build", "older", 10),
    userMessage("session", "plan", "newer", 20),
  ].reverse() } as never)
  await transformHook({}, { messages: [
    userMessage("session", "build", "z", 30),
    userMessage("session", "plan", "a", 30),
  ] } as never)
  await transformHook({}, { messages: [
    userMessage("session", "plan", "z", 40),
    userMessage("session", "build", "a", 40),
  ].reverse() } as never)

  assert.equal(calls, 1)
})

test("delegates every repeated eligible transform", async () => {
  let calls = 0
  const hooks = await load({
    agents: ["build"],
    upstream: {
      config: async () => {},
      "experimental.chat.messages.transform": async () => { calls++ },
    },
  })
  await hooks.config!({ agent: { build: {} } } as never)
  const transformHook = hooks["experimental.chat.messages.transform"]!
  const output = { messages: messages("session", "build") }

  await transformHook({}, output)
  await transformHook({}, output)
  await transformHook({}, structuredClone(output))

  assert.equal(calls, 3)
})

test("forwards the exact input and output references upstream", async () => {
  let receivedInput: unknown
  let receivedOutput: unknown
  const hooks = await load({
    agents: ["build"],
    upstream: {
      config: async () => {},
      "experimental.chat.messages.transform": async (input: unknown, output: unknown) => {
        receivedInput = input
        receivedOutput = output
      },
    },
  })
  await hooks.config!({ agent: { build: {} } } as never)
  const input = {}
  const output = { messages: messages("session", "build") }

  await hooks["experimental.chat.messages.transform"]!(input, output)

  assert.strictEqual(receivedInput, input)
  assert.strictEqual(receivedOutput, output)
})

test("reports every invalid agent in deterministic order", async () => {
  const hooks = await load({
    agents: ["z-unknown", "reviewer", "a-unknown", "build"],
  })
  const config = {
    agent: {
      build: { disable: true },
      reviewer: { disable: true },
    },
  }

  await assert.rejects(hooks.config!(config as never), {
    message: [
      "[superpowers-agent] invalid configured agents:",
      '  "a-unknown" does not exist',
      '  "build" is disabled',
      '  "reviewer" is disabled',
      '  "z-unknown" does not exist',
    ].join("\n"),
  })
})

type PermissionShape = "missing" | "scalar" | "object"
type Action = "allow" | "ask" | "deny"

const permissionShapes: PermissionShape[] = ["missing", "scalar", "object"]
const skillShapes: PermissionShape[] = ["missing", "scalar", "object"]

function permissionFixture(
  permissionShape: PermissionShape,
  skillShape: PermissionShape,
): unknown {
  if (permissionShape === "missing") return undefined
  if (permissionShape === "scalar") return "ask"

  const permission: Record<string, unknown> = {
    bash: { "git status": "allow" },
    edit: "ask",
    custom: { retained: true },
  }
  if (skillShape === "scalar") permission.skill = "ask"
  if (skillShape === "object") {
    permission.skill = {
      "*": "ask",
      "private-*": "deny",
      brainstorming: "ask",
    }
  }
  return permission
}

function resolveSkillPermission(
  rules: Record<string, Action>,
  skill: string,
): Action | undefined {
  let result: Action | undefined
  for (const [pattern, action] of Object.entries(rules)) {
    const expression = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
    )
    if (expression.test(skill)) result = action
  }
  return result
}

const ownershipCases: Array<{
  name: string
  rules: Record<string, Action>
  retained: Array<[string, Action]>
}> = [
  ...(["allow", "ask", "deny"] as const).map((action) => ({
    name: `exact ${action}`,
    rules: Object.fromEntries([
      ["alpha", "ask"],
      ["brainstorming", action],
      ["using-superpowers", action],
      ["omega", "allow"],
    ]) as Record<string, Action>,
    retained: [["alpha", "ask"], ["omega", "allow"]] as Array<[string, Action]>,
  })),
  ...(["allow", "ask", "deny"] as const).map((action) => ({
    name: `wildcard ${action}`,
    rules: Object.fromEntries([
      ["alpha", "deny"],
      ["brain*", action],
      ["omega", "ask"],
    ]) as Record<string, Action>,
    retained: [
      ["alpha", "deny"],
      ["brain*", action],
      ["omega", "ask"],
    ] as Array<[string, Action]>,
  })),
  {
    name: "mixed *, brain*, exact ordering",
    rules: Object.fromEntries([
      ["*", "allow"],
      ["alpha", "deny"],
      ["brain*", "deny"],
      ["brainstorming", "ask"],
      ["omega", "allow"],
    ]),
    retained: [
      ["*", "allow"],
      ["alpha", "deny"],
      ["brain*", "deny"],
      ["omega", "allow"],
    ],
  },
]

for (const scope of ["global", "enabled-agent"] as const) {
  for (const testCase of ownershipCases) {
    test(`${scope} owns bundled names over ${testCase.name} rules`, async () => {
      const hooks = await load({
        agents: scope === "enabled-agent" ? ["build"] : [],
      })
      const config: Record<string, any> = {
        permission: { skill: { ...testCase.rules } },
        agent: scope === "enabled-agent"
          ? { build: { permission: { skill: { ...testCase.rules } } } }
          : {},
      }

      await hooks.config!(config as never)

      const rules = scope === "global"
        ? config.permission.skill
        : config.agent.build.permission.skill
      const expectedBrainstorming = scope === "global" ? "deny" : "allow"

      assert.deepEqual(Object.entries(rules), [
        ...testCase.retained,
        ["brainstorming", expectedBrainstorming],
        ["using-superpowers", "deny"],
      ])
      assert.equal(resolveSkillPermission(rules, "brainstorming"), expectedBrainstorming)
      assert.equal(resolveSkillPermission(rules, "using-superpowers"), "deny")

      for (const name of ["alpha", "omega", "brainwave"]) {
        assert.equal(
          resolveSkillPermission(rules, name),
          resolveSkillPermission(testCase.rules, name),
        )
      }
    })
  }
}

const nonEnabledAgentCases: Array<{
  name: string
  permission: unknown
  expectedPrefix: Array<[string, unknown]>
  permissionWildcard?: Action
}> = [
  {
    name: "scalar permission allow",
    permission: "allow",
    expectedPrefix: [],
    permissionWildcard: "allow",
  },
  {
    name: "scalar skill ask",
    permission: { bash: "ask", skill: "ask" },
    expectedPrefix: [["*", "ask"]],
  },
  ...(["allow", "ask", "deny"] as const).flatMap((action) => [
    {
      name: `wildcard ${action}`,
      permission: {
        custom: { retained: true },
        skill: { "brain*": action, unrelated: "ask" },
      },
      expectedPrefix: [["brain*", action], ["unrelated", "ask"]] as Array<[string, unknown]>,
    },
    {
      name: `exact ${action}`,
      permission: {
        custom: { retained: true },
        skill: { brainstorming: action, "using-superpowers": action, unrelated: "allow" },
      },
      expectedPrefix: [["unrelated", "allow"]] as Array<[string, unknown]>,
    },
  ]),
]

for (const testCase of nonEnabledAgentCases) {
  test(`configured non-enabled agent denies bundled skills over ${testCase.name}`, async () => {
    const hooks = await load()
    const reviewer: Record<string, any> = {
      model: "provider/model",
      customAgentField: { retained: true },
      permission: structuredClone(testCase.permission),
    }
    const config: Record<string, any> = { agent: { reviewer } }

    await hooks.config!(config as never)

    const configured = config.agent.reviewer
    assert.deepEqual(Object.entries(configured.permission.skill), [
      ...testCase.expectedPrefix,
      ["brainstorming", "deny"],
      ["using-superpowers", "deny"],
    ])
    assert.equal(resolveSkillPermission(configured.permission.skill, "brainstorming"), "deny")
    assert.equal(resolveSkillPermission(configured.permission.skill, "using-superpowers"), "deny")
    assert.equal(configured.model, "provider/model")
    assert.strictEqual(configured.customAgentField, reviewer.customAgentField)
    if (testCase.permissionWildcard) {
      assert.equal(configured.permission["*"], testCase.permissionWildcard)
    }
    if (typeof testCase.permission === "object" && testCase.permission !== null) {
      const original = testCase.permission as Record<string, unknown>
      if ("bash" in original) assert.equal(configured.permission.bash, "ask")
      if ("custom" in original) assert.deepEqual(configured.permission.custom, { retained: true })
    }
  })
}

test("leaves a configured disabled non-enabled agent untouched", async () => {
  const hooks = await load()
  const reviewer = {
    disable: true,
    permission: { skill: { brainstorming: "allow" }, bash: "ask" },
    customAgentField: { retained: true },
  }
  const config: Record<string, any> = { agent: { reviewer } }

  await hooks.config!(config as never)

  assert.strictEqual(config.agent.reviewer, reviewer)
  assert.deepEqual(config.agent.reviewer, reviewer)
})

test("appends owned skill decisions after conflicting global and agent rules", async () => {
  const hooks = await load({ agents: ["build"] })
  const config: Record<string, any> = {
    permission: {
      skill: {
        brainstorming: "allow",
        "*": "allow",
        "brain*": "ask",
        "using-superpowers": "allow",
      },
    },
    agent: {
      build: {
        permission: {
          skill: {
            brainstorming: "deny",
            "*": "deny",
            "brain*": "ask",
            "using-superpowers": "allow",
          },
        },
      },
    },
  }

  await hooks.config!(config as never)

  assert.deepEqual(Object.entries(config.permission.skill), [
    ["*", "allow"],
    ["brain*", "ask"],
    ["brainstorming", "deny"],
    ["using-superpowers", "deny"],
  ])
  assert.deepEqual(Object.entries(config.agent.build.permission.skill), [
    ["*", "deny"],
    ["brain*", "ask"],
    ["brainstorming", "allow"],
    ["using-superpowers", "deny"],
  ])
  assert.equal(resolveSkillPermission(config.permission.skill, "brainstorming"), "deny")
  assert.equal(resolveSkillPermission(config.agent.build.permission.skill, "brainstorming"), "allow")
  assert.equal(resolveSkillPermission(config.agent.build.permission.skill, "using-superpowers"), "deny")
})

for (const permissionShape of permissionShapes) {
  for (const skillShape of skillShapes) {
    test(`normalizes global ${permissionShape} permission with ${skillShape} skill`, async () => {
      const hooks = await load()
      const original = permissionFixture(permissionShape, skillShape)
      const config: Record<string, any> = { agent: {} }
      if (original !== undefined) config.permission = original

      await assert.doesNotReject(hooks.config!(config as never))

      assert.equal(config.permission.skill.brainstorming, "deny")
      assert.equal(config.permission.skill["using-superpowers"], "deny")
      if (permissionShape === "scalar") {
        assert.equal(config.permission["*"], "ask")
      } else if (permissionShape === "object") {
        assert.deepEqual(config.permission.bash, { "git status": "allow" })
        assert.equal(config.permission.edit, "ask")
        assert.deepEqual(config.permission.custom, { retained: true })
        if (skillShape === "scalar") assert.equal(config.permission.skill["*"], "ask")
        if (skillShape === "object") {
          assert.equal(config.permission.skill["*"], "ask")
          assert.equal(config.permission.skill["private-*"], "deny")
          assert.deepEqual(Object.keys(config.permission.skill), [
            "*", "private-*", "brainstorming", "using-superpowers",
          ])
        }
      }
    })

    test(`normalizes enabled-agent ${permissionShape} permission with ${skillShape} skill`, async () => {
      const hooks = await load({ agents: ["build"] })
      const original = permissionFixture(permissionShape, skillShape)
      const build: Record<string, any> = {
        model: "provider/model",
        temperature: 0.25,
        customAgentField: { retained: true },
      }
      if (original !== undefined) build.permission = original
      const config: Record<string, any> = { agent: { build } }

      await assert.doesNotReject(hooks.config!(config as never))

      const configured = config.agent.build
      assert.equal(configured.permission.skill.brainstorming, "allow")
      assert.equal(configured.permission.skill["using-superpowers"], "deny")
      assert.equal(configured.model, "provider/model")
      assert.equal(configured.temperature, 0.25)
      assert.strictEqual(configured.customAgentField, build.customAgentField)
      if (permissionShape === "scalar") {
        assert.equal(configured.permission["*"], "ask")
      } else if (permissionShape === "object") {
        assert.deepEqual(configured.permission.bash, { "git status": "allow" })
        assert.equal(configured.permission.edit, "ask")
        assert.deepEqual(configured.permission.custom, { retained: true })
        if (skillShape === "scalar") assert.equal(configured.permission.skill["*"], "ask")
        if (skillShape === "object") {
          assert.equal(configured.permission.skill["*"], "ask")
          assert.equal(configured.permission.skill["private-*"], "deny")
          assert.deepEqual(Object.keys(configured.permission.skill), [
            "*", "private-*", "brainstorming", "using-superpowers",
          ])
        }
      }
    })
  }
}

for (const [name, config, agents, expected] of [
  ["global permission", { permission: true, agent: {} }, [], /permission must/],
  ["global skill", { permission: { skill: true }, agent: {} }, [], /permission\.skill must/],
  ["agent permission", { agent: { build: { permission: true } } }, ["build"], /agent\.build\.permission must/],
  ["agent skill", { agent: { build: { permission: { skill: true } } } }, ["build"], /permission\.skill must/],
] as const) {
  test(`rejects invalid ${name} form`, async () => {
    const hooks = await load({ agents: [...agents] })
    await assert.rejects(hooks.config!(config as never), expected)
  })
}
