import { execFile } from "node:child_process"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const opencodeBin = join(process.cwd(), "node_modules", ".bin", "opencode")

async function installPlugin(root: string, provisionDependencies: boolean) {
  const configRoot = join(root, "config", "opencode")
  await mkdir(join(configRoot, "plugins"), { recursive: true })
  await cp(
    join(process.cwd(), "plugins", "superpowers-agent.ts"),
    join(configRoot, "plugins", "superpowers-agent.ts"),
  )

  if (!provisionDependencies) return configRoot

  for (const specifier of ["superpowers", "@opencode-ai/plugin"] as const) {
    const resolved = fileURLToPath(import.meta.resolve(specifier))
    const source = specifier === "superpowers"
      ? dirname(fileURLToPath(import.meta.resolve("superpowers/package.json")))
      : join(dirname(resolved), "..")
    const target = join(configRoot, "node_modules", specifier)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true })
  }

  return configRoot
}

type RunOptions = {
  config?: object
  env?: Record<string, string>
  installSuperpowersAgent?: boolean
  provisionDependencies?: boolean
  setup?: (fixture: { root: string; home: string }) => Promise<void>
}

export async function runOpenCode(args: string[], options: RunOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "opencode-kit-test-"))
  const home = join(root, "home")

  if (options.installSuperpowersAgent) {
    await installPlugin(root, options.provisionDependencies ?? false)
  }

  try {
    await options.setup?.({ root, home })
    return await execFileAsync(opencodeBin, args, {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_DATA_HOME: join(root, "data"),
        XDG_STATE_HOME: join(root, "state"),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {
          $schema: "https://opencode.ai/config.json",
        }),
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
        ...options.env,
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export async function runIsolatedPlugin(
  script: string,
  options: { env?: Record<string, string>; provisionDependencies?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "opencode-kit-plugin-test-"))
  const configRoot = await installPlugin(root, options.provisionDependencies ?? false)
  const runner = join(root, "runner.mjs")
  await writeFile(runner, script.replace("PLUGIN_URL", JSON.stringify(
    `file://${join(configRoot, "plugins", "superpowers-agent.ts")}`,
  )))

  try {
    return await execFileAsync(process.execPath, ["--experimental-strip-types", runner], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: join(root, "home"), ...options.env },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
