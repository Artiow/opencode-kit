import assert from "node:assert/strict"
import { cp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

import { runIsolatedPlugin, runOpenCode } from "./opencode"

test("auto-discovers only the wrapper from the global plugins directory", async () => {
  const { stderr, stdout } = await runOpenCode(["debug", "config"], {
    installSuperpowersAgent: true,
    provisionDependencies: true,
  })
  const config = JSON.parse(stdout)

  assert.equal(stderr, "")
  assert.equal(config.plugin.length, 1)
  assert.match(config.plugin[0], /\/plugins\/superpowers-agent\.ts$/)
})

test("accepts options from explicit plugin registration", async () => {
  const plugin = `file://${join(process.cwd(), "plugins", "superpowers-agent.ts")}`
  const { stderr, stdout } = await runOpenCode(["debug", "config"], {
    config: {
      $schema: "https://opencode.ai/config.json",
      plugin: [[plugin, { agents: ["build"] }]],
      agent: { build: {} },
    },
  })
  const config = JSON.parse(stdout)

  assert.equal(stderr, "")
  assert.equal(config.agent.build.permission.skill.brainstorming, "allow")
  assert.equal(config.agent.superpowers.permission.skill.brainstorming, "allow")
})

test("writes invalid plugin options to the OpenCode log and continues", async () => {
  const plugin = `file://${join(process.cwd(), "plugins", "superpowers-agent.ts")}`
  const { stderr, stdout } = await runOpenCode(["debug", "config", "--print-logs", "--log-level", "WARN"], {
    config: {
      $schema: "https://opencode.ai/config.json",
      plugin: [[plugin, { agents: "build" }]],
      agent: { build: {} },
    },
  })
  const config = JSON.parse(stdout)

  assert.equal(config.agent.build.permission.skill.brainstorming, "deny")
  assert.equal(config.agent.superpowers.permission.skill.brainstorming, "allow")
  assert.match(stderr, /level=WARN.*message="Invalid agent configuration; additional agents are disabled".*source=plugin-options/)
})

test("disables the plugin for invalid Superpowers assets", async () => {
  const { stdout } = await runOpenCode(["debug", "config"], {
    installSuperpowersAgent: true,
    provisionDependencies: true,
    setup: async ({ root }) => {
      await writeFile(
        join(root, "config", "opencode", "node_modules", "superpowers", "skills", "using-superpowers", "SKILL.md"),
        "---\ndescription: invalid fixture\n---\nfixture\n",
      )
    },
  })
  const config = JSON.parse(stdout)

  assert.equal(config.agent?.superpowers, undefined)
})

test("debug config preserves superpowers agent customization", async () => {
  const { stderr, stdout } = await runOpenCode(["debug", "config"], {
    installSuperpowersAgent: true,
    provisionDependencies: true,
    config: {
      $schema: "https://opencode.ai/config.json",
      agent: {
        superpowers: {
          mode: "subagent",
          description: "Custom Superpowers",
          temperature: 0.2,
          permission: { bash: "ask" },
        },
      },
    },
  })
  const config = JSON.parse(stdout)
  const superpowers = config.agent.superpowers

  assert.equal(stderr, "")
  assert.equal(superpowers.mode, "subagent")
  assert.equal(superpowers.description, "Custom Superpowers")
  assert.equal(superpowers.temperature, 0.2)
  assert.equal(superpowers.permission.bash, "ask")
})

test("normalizes environment options for the auto-discovered plugin", async () => {
  const { stdout } = await runIsolatedPlugin(`
    const plugin = (await import(PLUGIN_URL)).default
    const hooks = await plugin({ directory: process.cwd() }, { agents: ["reviewer"] })
    const config = { agent: { build: {}, reviewer: {} } }
    await hooks.config(config)
    console.log(JSON.stringify(config))
  `, {
    env: { OPENCODE_SUPERPOWERS_AGENTS: '[" build ","build","superpowers"]' },
    provisionDependencies: true,
  })
  const config = JSON.parse(stdout)

  assert.equal(config.agent.superpowers.mode, "primary")
  assert.equal(config.agent.build.permission.skill.brainstorming, "allow")
  assert.equal(config.agent.reviewer.permission.skill.brainstorming, "deny")
  assert.equal(config.permission.skill.brainstorming, "deny")
  assert.equal(config.skills.paths.length, 1)
})

test("routes bootstrap from user metadata in an isolated plugin", async () => {
  const { stdout } = await runIsolatedPlugin(`
    const plugin = (await import(PLUGIN_URL)).default
    const hooks = await plugin({ directory: process.cwd() })
    await hooks.config({ agent: { build: {} } })
    const message = (sessionID, agent) => ({
      info: {
        id: "user-" + sessionID,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent,
        model: { providerID: "test", modelID: "test" },
      },
      parts: [{ id: "part-" + sessionID, sessionID, messageID: "user-" + sessionID, type: "text", text: "hello" }],
    })
    const transformed = {}
    for (const [label, sessionID, agent] of [
      ["root", "root", "build"],
      ["task-child", "child", "build"],
      ["disabled", "disabled", "plan"],
    ]) {
      const output = { messages: [message(sessionID, agent)] }
      await hooks["experimental.chat.messages.transform"]({}, output)
      transformed[label] = output.messages.some((item) => item.parts.some((part) => part.type === "text" && part.text.includes("EXTREMELY_IMPORTANT")))
    }
    console.log(JSON.stringify(transformed))
  `, {
    env: { OPENCODE_SUPERPOWERS_AGENTS: '["build"]' },
    provisionDependencies: true,
  })

  assert.deepEqual(JSON.parse(stdout), {
    root: true,
    "task-child": true,
    disabled: false,
  })
})

test("ignores absent agent names through the real CLI", async () => {
  const { stderr, stdout } = await runOpenCode(["debug", "config"], {
    installSuperpowersAgent: true,
    provisionDependencies: true,
    env: { OPENCODE_SUPERPOWERS_AGENTS: '["buidl"]' },
  })
  const config = JSON.parse(stdout)

  assert.equal(stderr, "")
  assert.equal(config.agent.buidl, undefined)
})

test("initializes the registry with external skill collisions", async () => {
  const skill = "---\nname: brainstorming\ndescription: collision fixture\n---\nfixture\n"
  const config: { skills?: { paths: string[] } } = {}
  const { stderr } = await runOpenCode(
    ["debug", "skill", "--print-logs", "--log-level", "WARN"],
    {
      installSuperpowersAgent: true,
      provisionDependencies: true,
      config,
      setup: async ({ root, home }) => {
        const bundled = join(root, "bundled-skills")
        const paths = [
          join(root, ".opencode", "skills", "project-brainstorming"),
          join(home, ".config", "opencode", "skills", "personal-brainstorming"),
        ]
        await cp(join(process.cwd(), "node_modules", "superpowers", "skills"), bundled, {
          recursive: true,
        })
        for (const path of paths) {
          await mkdir(path, { recursive: true })
          await writeFile(join(path, "SKILL.md"), skill)
        }
        config.skills = {
          paths: [bundled, ...paths],
        }
      },
    },
  )

  // OpenCode reports the collision, but its registry output does not define a winner.
  assert.match(stderr, /message="duplicate skill name".*name=brainstorming/)
})

test("fails visibly when the runtime dependency is missing", async () => {
  await assert.rejects(
    runIsolatedPlugin("await import(PLUGIN_URL)"),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.match(error.stderr ?? error.message, /superpowers|Cannot find package/)
      return true
    },
  )
})

for (const [name, value] of [
  ["invalid JSON", "not-json"],
  ["non-array", "{}"],
  ["non-string item", '["build", 1]'],
  ["blank item", '["build", " "]'],
]) {
  test(`logs ${name} environment options and continues safely`, async () => {
    const { stdout } = await runIsolatedPlugin(`
      const logs = []
      const client = { app: { log: async ({ body }) => logs.push(body) } }
      const plugin = (await import(PLUGIN_URL)).default
      const hooks = await plugin({ directory: process.cwd(), client })
      const config = { agent: { build: {} } }
      await hooks.config(config)
      console.log(JSON.stringify({ config, logs }))
    `, {
      env: { OPENCODE_SUPERPOWERS_AGENTS: value },
      provisionDependencies: true,
    })
    const { config, logs } = JSON.parse(stdout)

    assert.equal(config.agent.build.permission.skill.brainstorming, "deny")
    assert.equal(config.agent.superpowers.permission.skill.brainstorming, "allow")
    assert.equal(logs.length, 1)
    assert.equal(logs[0].service, "superpowers-agent")
    assert.equal(logs[0].level, "warn")
    assert.equal(logs[0].extra.source, "OPENCODE_SUPERPOWERS_AGENTS")
  })
}
