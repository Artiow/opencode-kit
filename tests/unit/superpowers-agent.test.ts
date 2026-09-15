import assert from "node:assert/strict"
import test from "node:test"

import { SuperpowersAgentPlugin } from "../../plugins/superpowers-agent"

test("exports an OpenCode plugin factory", () => {
  assert.equal(typeof SuperpowersAgentPlugin, "function")
})
