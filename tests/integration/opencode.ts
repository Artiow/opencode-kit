import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const opencodeBin = join(process.cwd(), "node_modules", ".bin", "opencode")

export async function runOpenCode(args: string[]) {
  const root = await mkdtemp(join(tmpdir(), "opencode-kit-test-"))
  const home = join(root, "home")

  try {
    return await execFileAsync(opencodeBin, args, {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_DATA_HOME: join(root, "data"),
        XDG_STATE_HOME: join(root, "state"),
        OPENCODE_CONFIG_CONTENT: '{"$schema":"https://opencode.ai/config.json"}',
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
        OPENCODE_PURE: "1",
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
