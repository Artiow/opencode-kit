import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { createSuperpowersAgentPlugin } from "../../plugins/superpowers-agent"

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
    return await plugin({} as never)
  } finally {
    fixture?.cleanup()
  }
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

test("rejects malformed, duplicate, and missing policy skills", async (t) => {
  const cases: Array<[string, Array<[string, string]>, RegExp]> = [
    ["malformed", [["bad", ""]], /skill has no valid name/],
    ["duplicate", [["one", "using-superpowers"], ["two", "using-superpowers"]], /duplicate Superpowers skill names/],
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
  const hooks = await load({
    upstream: {
      config: async () => { configCalls++ },
      "experimental.chat.messages.transform": async () => { transformCalls++ },
    },
  })
  const config = { agent: {} }

  await hooks.config!(config)
  const transform = hooks["experimental.chat.messages.transform"]!
  await transform({} as never, {
    messages: [{ info: { role: "user", agent: "superpowers" }, parts: [] }],
  } as never)

  assert.equal(configCalls, 1)
  assert.equal(transformCalls, 1)
})
