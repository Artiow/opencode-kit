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

test("initializes one scoped factory with environment options", async () => {
  const { stdout } = await runIsolatedPlugin(`
    const plugin = (await import(PLUGIN_URL)).default
    const hooks = await plugin({ directory: process.cwd() })
    const config = { agent: { build: {} } }
    await hooks.config(config)
    console.log(JSON.stringify(config))
  `, {
    env: { OPENCODE_SUPERPOWERS_AGENTS: '["build"]' },
    provisionDependencies: true,
  })
  const config = JSON.parse(stdout)

  assert.equal(config.agent.superpowers.mode, "primary")
  assert.equal(config.agent.build.permission.skill.brainstorming, "allow")
  assert.equal(config.permission.skill.brainstorming, "deny")
  assert.equal(config.skills.paths.length, 1)
})

test("reports a failing config hook without exposing staged mutations", async () => {
  await assert.rejects(runIsolatedPlugin(`
    const exported = (await import(PLUGIN_URL)).default
    const plugin = exported.createForTesting({
      opencodeVersion: () => "1.18.30",
      superpowersVersion: () => "6.3.0",
      skillsDir: () => new URL("./config/opencode/node_modules/superpowers/skills", import.meta.url).pathname,
      upstreamPlugin: async () => ({
        config: async (config) => {
          config.staged = { visible: true }
          throw new Error("fixture hook failure")
        },
        "experimental.chat.messages.transform": async () => {},
      }),
    })
    const hooks = await plugin({}, { agents: [] })
    const retained = { nested: true }
    const config = { retained }
    try {
      await hooks.config(config)
    } catch (error) {
      console.log(JSON.stringify({ config, sameReference: config.retained === retained }))
      console.error(error.message)
      process.exitCode = 1
    }
  `, { provisionDependencies: true }), (error: NodeJS.ErrnoException & {
    stdout?: string
    stderr?: string
  }) => {
    assert.match(error.stderr ?? "", /fixture hook failure/)
    assert.deepEqual(JSON.parse(error.stdout ?? ""), {
      config: { retained: { nested: true } },
      sameReference: true,
    })
    return true
  })
})

test("enables absent public and hidden built-ins through the real CLI", async () => {
  for (const agent of ["build", "general", "summary"]) {
    const { stderr, stdout } = await runOpenCode(["debug", "agent", agent], {
      installSuperpowersAgent: true,
      provisionDependencies: true,
      env: { OPENCODE_SUPERPOWERS_AGENTS: '["build","general","summary"]' },
    })
    const registered = JSON.parse(stdout)

    assert.equal(stderr, "")
    assert.equal(registered.name, agent)
    assert.equal(registered.native, true)
    if (agent === "summary") assert.equal(registered.hidden, true)
  }
})

test("initializes the registry with external skill collisions", async () => {
  const skill = "---\nname: brainstorming\ndescription: collision fixture\n---\nfixture\n"
  const config: { skills?: { paths: string[] } } = {}
  const { stderr, stdout } = await runOpenCode(
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
  assert.match(stdout, /"name":\s*"brainstorming"/)
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
  test(`rejects ${name} environment options visibly`, async () => {
    await assert.rejects(
      runIsolatedPlugin("await import(PLUGIN_URL)", {
        env: { OPENCODE_SUPERPOWERS_AGENTS: value },
        provisionDependencies: true,
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(error.stderr ?? error.message, /\[superpowers-agent]/)
        return true
      },
    )
  })
}
