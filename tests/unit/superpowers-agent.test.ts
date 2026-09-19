import assert from "node:assert/strict"
import test from "node:test"

import type { Hooks, PluginOptions } from "@opencode-ai/plugin"
import SuperpowersAgentPlugin from "../../plugins/superpowers-agent"

const AGENTS_ENV = "OPENCODE_SUPERPOWERS_AGENTS"
const BRAINSTORMING = "brainstorming"
const POLICY = "using-superpowers"

type LogEntry = { service: string; level: string; message: string; extra?: Record<string, unknown> }

type LoadSettings = {
  environment?: string
  logs?: LogEntry[]
  options?: PluginOptions
}

async function load(settings: LoadSettings = {}): Promise<Hooks> {
  const { environment, logs = [], options } = settings
  const previous = process.env[AGENTS_ENV]

  if (environment === undefined) delete process.env[AGENTS_ENV]
  else process.env[AGENTS_ENV] = environment

  try {
    return await SuperpowersAgentPlugin({
      directory: process.cwd(),
      client: {
        app: {
          log: async ({ body }: { body: LogEntry }) => {
            logs.push(body)
            return { data: true }
          },
        },
      },
    } as never, options)
  } finally {
    if (previous === undefined) delete process.env[AGENTS_ENV]
    else process.env[AGENTS_ENV] = previous
  }
}

function userMessage(sessionID: string, agent: string, id = "user", created = 1) {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created },
      agent,
      model: { providerID: "test", modelID: "test" },
    },
    parts: [{ id: `part-${id}`, sessionID, messageID: id, type: "text", text: "hello" }],
  }
}

function assistantMessage(sessionID: string, agent: string, id = "assistant") {
  return {
    info: { id, sessionID, role: "assistant", parentID: "user", agent },
    parts: [],
  }
}

async function transform(hooks: Hooks, messages: any[]): Promise<any[]> {
  const output = { messages } as never
  await hooks["experimental.chat.messages.transform"]!({}, output)
  return messages
}

function assertBootstrapAdded(before: any[], after: any[]): void {
  const firstUser = after.findIndex((message) => message.info.role === "user")
  assert.notEqual(firstUser, -1)

  const injected = after[firstUser].parts[0]
  assert.equal(injected.type, "text")
  assert.ok(injected.text.trim())

  const withoutInjection = structuredClone(after)
  withoutInjection[firstUser].parts.shift()
  assert.deepEqual(withoutInjection, before)
}

function hasLevel(logs: LogEntry[], level: string): boolean {
  return logs.some((entry) => entry.level === level)
}

function relevantRules(rules: Record<string, unknown>): [string, unknown][] {
  return Object.entries(rules).filter(([name]) => ["*", "brain*", BRAINSTORMING, POLICY].includes(name))
}

test("creates the default superpowers agent and registers real upstream skills", async () => {
  const hooks = await load()
  const config: Record<string, any> = {}

  assert.equal(typeof hooks.config, "function")
  assert.equal(typeof hooks["experimental.chat.messages.transform"], "function")
  await hooks.config!(config as never)

  assert.equal(config.agent.superpowers.mode, "primary")
  assert.equal(config.agent.superpowers.description, "OpenCode with the full Superpowers workflow")
  assert.equal("model" in config.agent.superpowers, false)
  assert.equal("prompt" in config.agent.superpowers, false)
  assert.equal(config.permission.skill[BRAINSTORMING], "deny")
  assert.equal(config.permission.skill[POLICY], "deny")
  assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
  assert.equal(config.agent.superpowers.permission.skill[POLICY], "deny")
  assert.ok(Array.isArray(config.skills.paths))
  assert.ok(config.skills.paths.length > 0)
})

test("augments a customized superpowers agent without replacing user values", async () => {
  const hooks = await load()
  const config: Record<string, any> = {
    agent: {
      superpowers: {
        model: "provider/custom",
        mode: "subagent",
        description: "Custom description",
        prompt: "Custom prompt",
        temperature: 0.2,
        customAgentField: { value: true },
        permission: {
          bash: { "git status": "allow" },
          skill: { "private-*": "ask", [BRAINSTORMING]: "deny" },
        },
      },
    },
  }

  await hooks.config!(config as never)

  const configured = config.agent.superpowers
  assert.equal(configured.model, "provider/custom")
  assert.equal(configured.mode, "subagent")
  assert.equal(configured.description, "Custom description")
  assert.equal(configured.prompt, "Custom prompt")
  assert.equal(configured.temperature, 0.2)
  assert.deepEqual(configured.customAgentField, { value: true })
  assert.deepEqual(configured.permission.bash, { "git status": "allow" })
  assert.equal(configured.permission.skill["private-*"], "ask")
  assert.equal(configured.permission.skill[BRAINSTORMING], "allow")
  assert.equal(configured.permission.skill[POLICY], "deny")
})

test("leaves a disabled superpowers agent unchanged and suppresses bootstrap", async () => {
  const hooks = await load()
  const disabled = { disable: true, description: "Disabled by user", permission: { bash: "ask" } }
  const config: Record<string, any> = { agent: { superpowers: structuredClone(disabled) } }

  await hooks.config!(config as never)
  const messages = [userMessage("session", "superpowers")]
  const before = structuredClone(messages)
  await transform(hooks, messages)

  assert.deepEqual(config.agent.superpowers, disabled)
  assert.deepEqual(messages, before)
})

test("applies tuple and strict CSV agent options", async (t) => {
  await t.test("uses tuple options when the environment is absent", async () => {
    const hooks = await load({ options: { agents: ["build"] } })
    const config: Record<string, any> = { agent: { build: {}, reviewer: {} } }

    await hooks.config!(config as never)

    assert.equal(config.agent.build.permission.skill[BRAINSTORMING], "allow")
    assert.equal(config.agent.reviewer.permission.skill[BRAINSTORMING], "deny")
  })

  await t.test("accepts trimmed repeated names and replaces tuple options", async () => {
    const logs: LogEntry[] = []
    const hooks = await load({
      environment: " build,build ",
      logs,
      options: { agents: ["reviewer"] },
    })
    const config: Record<string, any> = { agent: { build: {}, reviewer: {} } }

    await hooks.config!(config as never)

    assert.equal(config.agent.build.permission.skill[BRAINSTORMING], "allow")
    assert.equal(config.agent.reviewer.permission.skill[BRAINSTORMING], "deny")
    assert.equal(hasLevel(logs, "warn"), false)
  })

  await t.test("treats an empty environment value as an empty list", async () => {
    const logs: LogEntry[] = []
    const hooks = await load({ environment: "", logs, options: { agents: ["build"] } })
    const config: Record<string, any> = { agent: { build: {} } }

    await hooks.config!(config as never)

    assert.equal(config.agent.build.permission.skill[BRAINSTORMING], "deny")
    assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
    assert.equal(hasLevel(logs, "warn"), false)
  })

  for (const value of ["build,,reviewer", "   "]) {
    await t.test(`fails closed for ${JSON.stringify(value)}`, async () => {
      const logs: LogEntry[] = []
      const hooks = await load({
        environment: value,
        logs,
        options: { agents: ["fallback"] },
      })
      const config: Record<string, any> = {
        agent: { build: {}, reviewer: {}, fallback: {} },
      }

      await hooks.config!(config as never)

      assert.equal(config.agent.build.permission.skill[BRAINSTORMING], "deny")
      assert.equal(config.agent.reviewer.permission.skill[BRAINSTORMING], "deny")
      assert.equal(config.agent.fallback.permission.skill[BRAINSTORMING], "deny")
      assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
      assert.equal(hasLevel(logs, "warn"), true)
    })
  }

  await t.test("fails closed for invalid tuple options", async () => {
    const logs: LogEntry[] = []
    const hooks = await load({ logs, options: { agents: "build" } as never })
    const config: Record<string, any> = { agent: { build: {} } }

    await hooks.config!(config as never)

    assert.equal(config.agent.build.permission.skill[BRAINSTORMING], "deny")
    assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
    assert.equal(hasLevel(logs, "warn"), true)
  })
})

test("applies owned permission policy after retained rules", async () => {
  const hooks = await load({ options: { agents: ["build", "missing"] } })
  const config: Record<string, any> = {
    permission: {
      skill: {
        [BRAINSTORMING]: "allow",
        "*": "allow",
        "brain*": "ask",
        [POLICY]: "allow",
        "private-*": "ask",
      },
    },
    agent: {
      build: {
        customAgentField: { value: true },
        permission: {
          bash: "ask",
          skill: {
            [BRAINSTORMING]: "deny",
            "*": "deny",
            "brain*": "ask",
            [POLICY]: "allow",
            custom: "ask",
          },
        },
      },
      reviewer: {
        permission: {
          skill: { "*": "allow", "private-*": "deny", [BRAINSTORMING]: "allow" },
        },
      },
    },
  }

  await hooks.config!(config as never)

  assert.deepEqual(relevantRules(config.permission.skill), [
    ["*", "allow"],
    ["brain*", "ask"],
    [BRAINSTORMING, "deny"],
    [POLICY, "deny"],
  ])
  assert.equal(config.permission.skill["private-*"], "ask")

  assert.deepEqual(relevantRules(config.agent.build.permission.skill), [
    ["*", "deny"],
    ["brain*", "ask"],
    [BRAINSTORMING, "allow"],
    [POLICY, "deny"],
  ])
  assert.equal(config.agent.build.permission.skill.custom, "ask")
  assert.equal(config.agent.build.permission.bash, "ask")
  assert.deepEqual(config.agent.build.customAgentField, { value: true })

  assert.equal(config.agent.reviewer.permission.skill["*"], "allow")
  assert.equal(config.agent.reviewer.permission.skill["private-*"], "deny")
  assert.equal(config.agent.reviewer.permission.skill[BRAINSTORMING], "deny")
  assert.equal(config.agent.reviewer.permission.skill[POLICY], "deny")
  assert.ok(Object.keys(config.agent.reviewer.permission.skill).indexOf(BRAINSTORMING) > Object.keys(config.agent.reviewer.permission.skill).indexOf("*"))
  assert.equal(config.agent.missing, undefined)
})

test("normalizes scalar root, agent, and skill permissions", async () => {
  const hooks = await load()
  const config: Record<string, any> = {
    permission: "allow",
    agent: {
      reviewer: { permission: { skill: "ask" } },
      superpowers: { permission: "ask" },
    },
  }

  await hooks.config!(config as never)

  assert.equal(config.permission["*"], "allow")
  assert.equal(config.permission.skill[BRAINSTORMING], "deny")
  assert.equal(config.agent.reviewer.permission.skill["*"], "ask")
  assert.equal(config.agent.reviewer.permission.skill[BRAINSTORMING], "deny")
  assert.equal(config.agent.superpowers.permission["*"], "ask")
  assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
  assert.equal(config.agent.superpowers.permission.skill[POLICY], "deny")
})

test("rolls back invalid permission forms and clears bootstrap routing", async (t) => {
  for (const [name, invalid] of [
    ["global permission", { permission: true, agent: {} }],
    ["global skill", { permission: { skill: true }, agent: {} }],
    ["agent permission", { agent: { superpowers: { permission: true } } }],
    ["agent skill", { agent: { superpowers: { permission: { skill: true } } } }],
  ] as const) {
    await t.test(name, async () => {
      const logs: LogEntry[] = []
      const hooks = await load({ logs })
      await hooks.config!({} as never)

      const config: Record<string, any> = structuredClone(invalid)
      const snapshot = structuredClone(config)
      await hooks.config!(config as never)

      const messages = [userMessage(`session-${name}`, "superpowers")]
      const before = structuredClone(messages)
      await transform(hooks, messages)

      assert.deepEqual(config, snapshot)
      assert.equal("skills" in config, false)
      assert.equal(hasLevel(logs, "error"), true)
      assert.deepEqual(messages, before)
    })
  }
})

test("routes bootstrap by the latest user timestamp instead of array order", async () => {
  const hooks = await load()
  await hooks.config!({ agent: { reviewer: {} } } as never)

  const disabledLatest = [
    userMessage("session-disabled", "reviewer", "newer", 2),
    userMessage("session-disabled", "superpowers", "older", 1),
  ]
  const disabledBefore = structuredClone(disabledLatest)
  await transform(hooks, disabledLatest)

  const enabledLatest = [
    userMessage("session-enabled", "superpowers", "newer", 2),
    userMessage("session-enabled", "reviewer", "older", 1),
  ]
  const enabledBefore = structuredClone(enabledLatest)
  await transform(hooks, enabledLatest)

  assert.deepEqual(disabledLatest, disabledBefore)
  assertBootstrapAdded(enabledBefore, enabledLatest)
})

test("uses message ID as the deterministic timestamp tie-breaker", async () => {
  const hooks = await load()
  await hooks.config!({ agent: { reviewer: {} } } as never)

  const disabledLatest = [
    userMessage("session-disabled", "reviewer", "z", 1),
    userMessage("session-disabled", "superpowers", "a", 1),
  ]
  const disabledBefore = structuredClone(disabledLatest)
  await transform(hooks, disabledLatest)

  const enabledLatest = [
    userMessage("session-enabled", "superpowers", "z", 1),
    userMessage("session-enabled", "reviewer", "a", 1),
  ]
  const enabledBefore = structuredClone(enabledLatest)
  await transform(hooks, enabledLatest)

  assert.deepEqual(disabledLatest, disabledBefore)
  assertBootstrapAdded(enabledBefore, enabledLatest)
})

test("leaves histories without a user message unchanged", async () => {
  const hooks = await load()
  await hooks.config!({} as never)

  for (const messages of [[], [assistantMessage("session", "superpowers")]]) {
    const before = structuredClone(messages)
    await transform(hooks, messages)
    assert.deepEqual(messages, before)
  }
})
