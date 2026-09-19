import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

import { runIsolatedPlugin, runOpenCode } from "./opencode"

function diagnosticLevels(stderr: string): string[] {
  return stderr.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/\blevel=(DEBUG|INFO|WARN|ERROR)\b/)
    return match ? [match[1]] : []
  })
}

test("auto-discovers only the wrapper", async () => {
  const { stdout } = await runOpenCode(["debug", "config"], {
    installSuperpowersAgent: true,
    provisionDependencies: true,
  })
  const config = JSON.parse(stdout)

  assert.equal(config.plugin.length, 1)
  assert.match(config.plugin[0], /\/plugins\/superpowers-agent\.ts$/)
})

test("accepts options from explicit plugin registration", async () => {
  const plugin = `file://${join(process.cwd(), "plugins", "superpowers-agent.ts")}`
  const { stdout } = await runOpenCode(["debug", "config"], {
    config: {
      $schema: "https://opencode.ai/config.json",
      plugin: [[plugin, { agents: ["build"] }]],
      agent: { build: {} },
    },
  })
  const config = JSON.parse(stdout)

  assert.equal(config.agent.build.permission.skill.brainstorming, "allow")
})

test("disables the plugin and logs an error for an invalid policy asset", async () => {
  const { stdout } = await runIsolatedPlugin(`
    const logs = []
    const client = { app: { log: async ({ body }) => logs.push(body) } }
    const plugin = (await import(PLUGIN_URL)).default
    const hooks = await plugin({ directory: process.cwd(), client })
    const config = {}
    await hooks.config?.(config)
    console.log(JSON.stringify({ config, levels: logs.map(({ level }) => level) }))
  `, {
    provisionDependencies: true,
    setup: async ({ configRoot }) => {
      await writeFile(
        join(configRoot, "node_modules", "superpowers", "skills", "using-superpowers", "SKILL.md"),
        "---\ndescription: invalid fixture\n---\nfixture\n",
      )
    },
  })
  const { config, levels } = JSON.parse(stdout)

  assert.equal(config.agent?.superpowers, undefined)
  assert.ok(levels.includes("error"))
})

test("runs the installed wrapper transform for enabled user metadata", async () => {
  const { stdout } = await runIsolatedPlugin(`
    const plugin = (await import(PLUGIN_URL)).default
    const hooks = await plugin({ directory: process.cwd() })
    await hooks.config({ agent: { build: {}, reviewer: {} } })
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

    const enabled = [message("enabled", "build")]
    const enabledBefore = structuredClone(enabled)
    await hooks["experimental.chat.messages.transform"]({}, { messages: enabled })

    const disabled = [message("disabled", "reviewer")]
    const disabledBefore = structuredClone(disabled)
    await hooks["experimental.chat.messages.transform"]({}, { messages: disabled })

    console.log(JSON.stringify({
      enabledPartDelta: enabled[0].parts.length - enabledBefore[0].parts.length,
      enabledOriginalPreserved: JSON.stringify(enabled[0].parts.slice(1)) === JSON.stringify(enabledBefore[0].parts),
      injectedText: enabled[0].parts[0]?.type === "text" && Boolean(enabled[0].parts[0].text.trim()),
      disabledUnchanged: JSON.stringify(disabled) === JSON.stringify(disabledBefore),
    }))
  `, {
    env: { OPENCODE_SUPERPOWERS_AGENTS: " build,build " },
    provisionDependencies: true,
  })

  assert.deepEqual(JSON.parse(stdout), {
    enabledPartDelta: 1,
    enabledOriginalPreserved: true,
    injectedText: true,
    disabledUnchanged: true,
  })
})

test("reports an external bundled-skill collision without failing", async () => {
  const skill = "---\nname: brainstorming\ndescription: collision fixture\n---\nfixture\n"
  const plugin = `file://${join(process.cwd(), "plugins", "superpowers-agent.ts")}`
  const config: { $schema: string; plugin: string[]; skills?: { paths: string[] } } = {
    $schema: "https://opencode.ai/config.json",
    plugin: [plugin],
  }
  const { stderr } = await runOpenCode(
    ["debug", "skill", "--print-logs", "--log-level", "WARN"],
    {
      config,
      setup: async ({ root }) => {
        const external = join(root, "external-skills", "project-brainstorming")
        await mkdir(external, { recursive: true })
        await writeFile(join(external, "SKILL.md"), skill)
        config.skills = { paths: [join(root, "external-skills")] }
      },
    },
  )
  const levels = diagnosticLevels(stderr)

  assert.ok(levels.includes("WARN"))
  assert.equal(levels.includes("ERROR"), false)
})

test("fails visibly when the runtime dependency is missing", async () => {
  await assert.rejects(
    runIsolatedPlugin("await import(PLUGIN_URL)"),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.ok((error.stderr ?? error.message).trim())
      return true
    },
  )
})
