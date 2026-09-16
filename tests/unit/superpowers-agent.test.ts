import assert from "node:assert/strict"
import test from "node:test"

import type { Hooks, PluginOptions } from "@opencode-ai/plugin"
import SuperpowersAgentPlugin from "../../plugins/superpowers-agent"

const BRAINSTORMING = "brainstorming"
const POLICY = "using-superpowers"

async function load(options?: PluginOptions): Promise<Hooks> {
  return SuperpowersAgentPlugin({ directory: process.cwd() } as never, options)
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

function hasBootstrap(messages: any[]): boolean {
  return messages.some((message) => message.parts.some((part: any) => part.type === "text" && part.text.includes("EXTREMELY_IMPORTANT")))
}

async function transform(hooks: Hooks, messages: any[]): Promise<any[]> {
  const output = { messages } as never
  await hooks["experimental.chat.messages.transform"]!({}, output)
  return messages
}

test("creates the default superpowers agent and registers real upstream skills", async () => {
  const hooks = await load()
  const config: Record<string, any> = {}

  await hooks.config!(config as never)

  assert.equal(config.agent.superpowers.mode, "primary")
  assert.equal(config.agent.superpowers.description, "OpenCode with the full Superpowers workflow")
  assert.equal(config.permission.skill[BRAINSTORMING], "deny")
  assert.equal(config.permission.skill[POLICY], "deny")
  assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
  assert.equal(config.agent.superpowers.permission.skill[POLICY], "deny")
  assert.equal(config.skills.paths.length, 1)
  assert.match(config.skills.paths[0], /superpowers\/skills$/)
  assert.equal("model" in config.agent.superpowers, false)
})

test("augments a customized superpowers agent without replacing user settings", async () => {
  const hooks = await load()
  const retained = { value: true }
  const superpowers: Record<string, any> = {
    model: "provider/custom",
    mode: "subagent",
    description: "Custom description",
    prompt: "Custom prompt",
    temperature: 0.2,
    customAgentField: retained,
    permission: {
      bash: { "git status": "allow" },
      skill: { "private-*": "ask", [BRAINSTORMING]: "deny" },
    },
  }
  const config: Record<string, any> = { agent: { superpowers } }

  await hooks.config!(config as never)

  const configured = config.agent.superpowers
  assert.equal(configured.model, "provider/custom")
  assert.equal(configured.mode, "subagent")
  assert.equal(configured.description, "Custom description")
  assert.equal(configured.prompt, "Custom prompt")
  assert.equal(configured.temperature, 0.2)
  assert.strictEqual(configured.customAgentField, retained)
  assert.strictEqual(configured.permission.bash, superpowers.permission.bash)
  assert.equal(configured.permission.skill["private-*"], "ask")
  assert.equal(configured.permission.skill[BRAINSTORMING], "allow")
  assert.equal(configured.permission.skill[POLICY], "deny")
})

test("leaves a disabled superpowers agent untouched and suppresses bootstrap", async () => {
  const hooks = await load()
  const superpowers = { disable: true, description: "Disabled by user", permission: { bash: "ask" } }
  const config: Record<string, any> = { agent: { superpowers } }

  await hooks.config!(config as never)
  const messages = await transform(hooks, [userMessage("session", "superpowers")])

  assert.strictEqual(config.agent.superpowers, superpowers)
  assert.deepEqual(superpowers, { disable: true, description: "Disabled by user", permission: { bash: "ask" } })
  assert.equal(hasBootstrap(messages), false)
})

test("ignores tuple options passed to the auto-discovered default export", async () => {
  const hooks = await load({ agents: ["build"] })
  const config: Record<string, any> = { agent: { build: {} } }

  await hooks.config!(config as never)

  assert.equal(config.agent.build.permission.skill[BRAINSTORMING], "deny")
  assert.equal(config.agent.build.permission.skill[POLICY], "deny")
  assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
})

test("preserves unrelated permissions while denying bundled skills to non-enabled agents", async () => {
  const hooks = await load()
  const retained = { value: true }
  const reviewer: Record<string, any> = {
    model: "provider/model",
    customAgentField: retained,
    permission: {
      bash: "ask",
      skill: { "*": "allow", "private-*": "deny", [BRAINSTORMING]: "allow" },
    },
  }
  const config: Record<string, any> = { agent: { reviewer } }

  await hooks.config!(config as never)

  const configured = config.agent.reviewer
  assert.equal(configured.model, "provider/model")
  assert.strictEqual(configured.customAgentField, retained)
  assert.equal(configured.permission.bash, "ask")
  assert.equal(configured.permission.skill["*"], "allow")
  assert.equal(configured.permission.skill["private-*"], "deny")
  assert.equal(configured.permission.skill[BRAINSTORMING], "deny")
  assert.equal(configured.permission.skill[POLICY], "deny")
  assert.ok(Object.keys(configured.permission.skill).indexOf(BRAINSTORMING) > Object.keys(configured.permission.skill).indexOf("*"))
})

test("appends owned decisions after conflicting global and enabled-agent rules", async () => {
  const hooks = await load()
  const config: Record<string, any> = {
    permission: { skill: { [BRAINSTORMING]: "allow", "*": "allow", "brain*": "ask", [POLICY]: "allow" } },
    agent: {
      superpowers: {
        permission: { skill: { [BRAINSTORMING]: "deny", "*": "deny", "brain*": "ask", [POLICY]: "allow" } },
      },
    },
  }

  await hooks.config!(config as never)

  const relevant = (rules: Record<string, unknown>) => Object.entries(rules).filter(([name]) => ["*", "brain*", BRAINSTORMING, POLICY].includes(name))
  assert.deepEqual(relevant(config.permission.skill), [
    ["*", "allow"],
    ["brain*", "ask"],
    [BRAINSTORMING, "deny"],
    [POLICY, "deny"],
  ])
  assert.deepEqual(relevant(config.agent.superpowers.permission.skill), [
    ["*", "deny"],
    ["brain*", "ask"],
    [BRAINSTORMING, "allow"],
    [POLICY, "deny"],
  ])
})

test("normalizes scalar global and agent permissions", async () => {
  const hooks = await load()
  const config: Record<string, any> = { permission: "allow", agent: { superpowers: { permission: "ask" } } }

  await hooks.config!(config as never)

  assert.equal(config.permission["*"], "allow")
  assert.equal(config.permission.skill[BRAINSTORMING], "deny")
  assert.equal(config.agent.superpowers.permission["*"], "ask")
  assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
  assert.equal(config.agent.superpowers.permission.skill[POLICY], "deny")
})

test("rejects invalid permission forms", async (t) => {
  for (const [name, config, expected] of [
    ["global permission", { permission: true, agent: {} }, /permission must/],
    ["global skill", { permission: { skill: true }, agent: {} }, /permission\.skill must/],
    ["agent permission", { agent: { superpowers: { permission: true } } }, /agent\.superpowers\.permission must/],
    ["agent skill", { agent: { superpowers: { permission: { skill: true } } } }, /permission\.skill must/],
  ] as const) {
    await t.test(name, async () => {
      const hooks = await load()
      await assert.rejects(hooks.config!(config as never), expected)
    })
  }
})

test("discards staged upstream changes when wrapper validation fails", async () => {
  const hooks = await load()
  const permission = { skill: true }
  const retained = { value: true }
  const config: Record<string, any> = { permission, retained }
  const snapshot = structuredClone(config)

  await assert.rejects(hooks.config!(config as never), /permission\.skill must/)

  assert.deepEqual(config, snapshot)
  assert.strictEqual(config.permission, permission)
  assert.strictEqual(config.retained, retained)
  assert.equal("skills" in config, false)
})

test("atomically commits real upstream and wrapper changes while preserving unchanged references", async () => {
  const hooks = await load()
  const retained = { value: true }
  const config: Record<string, any> = { retained, agent: {} }
  const root = config

  await hooks.config!(config as never)

  assert.strictEqual(config, root)
  assert.strictEqual(config.retained, retained)
  assert.equal(config.skills.paths.length, 1)
  assert.equal(config.permission.skill[BRAINSTORMING], "deny")
  assert.equal(config.agent.superpowers.permission.skill[BRAINSTORMING], "allow")
})

test("detects an uncommittable root before applying staged changes", async () => {
  const hooks = await load()
  const agent = {}
  const config: Record<string, any> = {}
  Object.defineProperty(config, "agent", { configurable: true, enumerable: true, value: agent, writable: false })

  await assert.rejects(hooks.config!(config as never), /cannot replace config\.agent/)

  assert.deepEqual(config, { agent: {} })
  assert.strictEqual(config.agent, agent)
  assert.equal("permission" in config, false)
  assert.equal("skills" in config, false)
})

test("routes real upstream bootstrap only for the latest enabled user", async () => {
  const hooks = await load()
  await hooks.config!({ agent: { reviewer: {} } } as never)

  const disabledLatest = await transform(hooks, [
    userMessage("session", "superpowers", "older", 1),
    userMessage("session", "reviewer", "newer", 2),
  ])
  const enabledLatest = await transform(hooks, [
    userMessage("session", "reviewer", "older", 1),
    userMessage("session", "superpowers", "newer", 2),
  ])

  assert.equal(hasBootstrap(disabledLatest), false)
  assert.equal(hasBootstrap(enabledLatest), true)
})

test("uses message ID as the deterministic timestamp tie-breaker", async () => {
  const hooks = await load()
  await hooks.config!({ agent: { reviewer: {} } } as never)

  const disabledLatest = await transform(hooks, [
    userMessage("session", "superpowers", "a", 1),
    userMessage("session", "reviewer", "z", 1),
  ].reverse())
  const enabledLatest = await transform(hooks, [
    userMessage("session", "reviewer", "a", 1),
    userMessage("session", "superpowers", "z", 1),
  ].reverse())

  assert.equal(hasBootstrap(disabledLatest), false)
  assert.equal(hasBootstrap(enabledLatest), true)
})

test("does not route histories without an enabled user", async () => {
  const hooks = await load()
  await hooks.config!({ agent: { reviewer: {} } } as never)

  const reviewer = await transform(hooks, [userMessage("session", "reviewer")])
  const assistantOnly = await transform(hooks, [assistantMessage("session", "superpowers")])

  assert.equal(hasBootstrap(reviewer), false)
  assert.equal(hasBootstrap(assistantOnly), false)
})

test("delegates fresh eligible histories and preserves upstream duplicate protection", async () => {
  const hooks = await load()
  await hooks.config!({} as never)
  const first = [userMessage("first", "superpowers")]
  const second = [userMessage("second", "superpowers")]

  await transform(hooks, first)
  await transform(hooks, first)
  await transform(hooks, second)

  const bootstrapCount = (messages: any[]) => messages.flatMap((message) => message.parts).filter((part) => part.type === "text" && part.text.includes("EXTREMELY_IMPORTANT")).length
  assert.equal(bootstrapCount(first), 1)
  assert.equal(bootstrapCount(second), 1)
})
