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
