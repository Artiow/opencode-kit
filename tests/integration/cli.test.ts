import assert from "node:assert/strict"
import test from "node:test"

import { runOpenCode } from "./opencode"

test("runs the repository CLI in an isolated environment", async () => {
  const { stderr, stdout } = await runOpenCode(["--version"])

  assert.equal(stderr, "")
  assert.match(stdout, /^1\.18\.31\s*$/)
})
