/**
 * Provides per-agent access to the upstream Superpowers workflow through the
 * implicit `superpowers` agent and additional explicitly selected agents.
 *
 * Superpowers is loaded as a library: its config hook registers bundled skills,
 * and its message transform produces and injects the original bootstrap. This
 * wrapper owns only access policy, permission rules, and bootstrap routing.
 *
 * The upstream plugin is intentionally not registered separately, preventing
 * bootstrap injection outside the configured agent scope. Configuration fails
 * closed, so an unsuccessful setup exposes neither skill access nor bootstrap routing.
 *
 * @packageDocumentation
 */

// @ts-ignore -- The upstream package does not declare this JavaScript factory export.
import { SuperpowersPlugin } from "superpowers"

import type { Config, Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import type { UserMessage } from "@opencode-ai/sdk"
import type { AgentConfig, PermissionConfig, PermissionObjectConfig, PermissionActionConfig } from "@opencode-ai/sdk/v2"

import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const SUPERPOWERS_AGENT = "superpowers"
const SUPERPOWERS_DESCRIPTION = "OpenCode with the full Superpowers workflow"

/** Service identifier attached to plugin log records. */
const SUPERPOWERS_LOG_SERVICE = "superpowers-agent"

/** Upstream bootstrap policy skill denied through the native `skill` tool. */
const POLICY_SKILL = "using-superpowers"

/** Environment variable containing comma-separated opt-in agent names. */
const AGENTS_ENV = "OPENCODE_SUPERPOWERS_AGENTS"


/** Superpowers Agent plugin options. */
type Options = { agents: string[] }


/*
 * Hook types are derived from the official API declarations, so incompatible
 * OpenCode API changes are caught by typecheck.
 */
type ConfigHook = NonNullable<Hooks["config"]>
type TransformHook = NonNullable<Hooks["experimental.chat.messages.transform"]>

/*
 * The plugin package still derives `Config` from legacy SDK declarations,
 * whose global and agent permission shapes omit current forms such as scalar
 * actions and `skill` rules. These aliases replace only those stale fields
 * with their v2 runtime types and preserve the official type everywhere else.
 */
type RuntimeAgentConfig = Omit<AgentConfig, "permission"> & { permission?: PermissionConfig }
type RuntimeConfig = Omit<Config, "permission" | "agent"> & { permission?: PermissionConfig; agent?: Record<string, RuntimeAgentConfig> }


// noinspection JSUnusedGlobalSymbols
class Logger {
  private readonly client: PluginInput["client"]

  constructor(client: PluginInput["client"]) {
    this.client = client
  }

  debug(message: string, error?: unknown) {
    return this.log("debug", message, error)
  }

  info(message: string, error?: unknown) {
    return this.log("info", message, error)
  }

  warn(message: string, error?: unknown) {
    return this.log("warn", message, error)
  }

  error(message: string, error?: unknown) {
    return this.log("error", message, error)
  }

  private errorDetail(error: unknown): string {
    if (error instanceof Error) {
      return error.cause === undefined ? error.message : `${error.message}; caused by: ${this.errorDetail(error.cause)}`
    } else {
      return String(error)
    }
  }

  private log(level: "debug" | "info" | "error" | "warn", message: string, error?: unknown) {
    const extra = error === undefined ? undefined : { error: this.errorDetail(error) }
    return this.client.app.log({ body: { service: SUPERPOWERS_LOG_SERVICE, level, message, extra } })
  }
}


class SkillDiscovery {
  private readonly root: string
  private readonly logger: Logger

  constructor(root: string, logger: Logger) {
    this.root = root
    this.logger = logger
  }

  /**
   * Recursively discovers skill names from `SKILL.md` frontmatter under the root.
   * Invalid names are skipped with a warning, and duplicates are omitted.
   *
   * Synchronous I/O is acceptable because discovery scans a small bundled directory
   * once during plugin initialization.
   *
   * @returns Unique skill names in lexical traversal order.
   */
  async discover(): Promise<string[]> {
    const discoveredSkillNames = new Set<string>()
    await this.scanDirectory(this.root, discoveredSkillNames)
    return [...discoveredSkillNames]
  }

  private async scanDirectory(dir: string, discoveredSkillNames: Set<string>): Promise<void> {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)

      if (entry.isDirectory()) {
        await this.scanDirectory(path, discoveredSkillNames)
      } else if (entry.name === "SKILL.md") {
        const discoveredSkill = this.readSkillName(path)
        if (discoveredSkill) {
          discoveredSkillNames.add(discoveredSkill)
        } else {
          await this.logger.warn(`Skill file ${path} has no valid name and was skipped`)
        }
      }
    }
  }

  /**
   * Reads the skill name from a `SKILL.md` file's YAML frontmatter, supporting
   * only the single-line `name` values used by Superpowers instead of full YAML.
   *
   * Synchronous I/O is negligible because discovery runs once during plugin
   * initialization over the small set of bundled skills.
   *
   * @param file - The path to a `SKILL.md` file.
   * @returns The trimmed skill name, or `undefined` when no valid name is found.
   */
  private readSkillName(file: string): string | undefined {
    const source = readFileSync(file, "utf8")

    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
    return frontmatter?.match(/^name:[ \t]*["']?([^"'\r\n]*?)["']?[ \t]*$/m)?.[1]?.trim()
  }
}


function parsePluginOptions(raw?: PluginOptions): Options {
  const agents = raw?.agents ?? []
  if (!Array.isArray(agents) || agents.some((agent) => typeof agent !== "string" || !agent.trim())) {
    throw new Error('Field "agents" must be an array of non-empty strings')
  }
  return { agents: [...new Set(agents.map((agent) => agent.trim()))] }
}

function parseEnvironmentOptions(value: string): Options {
  try {
    return parsePluginOptions({ agents: value ? value.split(',') : [] })
  } catch (error) {
    throw new Error(`Invalid ${AGENTS_ENV}`, { cause: error })
  }
}


/**
 * Resolves the directory containing the skills bundled with Superpowers.
 *
 * @returns The absolute path to the installed Superpowers skills directory.
 */
function skillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.resolve("superpowers/package.json"))), "skills")
}

/**
 * Initializes the upstream Superpowers plugin and discovers its bundled skills.
 *
 * Validates the required hooks and policy skill before exposing the integration.
 *
 * @param input - OpenCode plugin context passed to the upstream plugin.
 * @param logger - Logger used during skill discovery.
 * @returns Validated upstream hooks and discovered skill names.
 * @throws {@link Error} if initialization or discovery fails, or required hooks or skills are missing.
 */
async function loadSuperpowers(input: PluginInput, logger: Logger): Promise<{
  configHook: ConfigHook
  transformHook: TransformHook
  skills: string[]
}> {
  if (typeof SuperpowersPlugin !== "function") {
    throw new Error("Upstream plugin is not callable")
  }

  const upstream: Hooks = await SuperpowersPlugin(input)
  if (typeof upstream["config"] !== "function") {
    throw new Error("Upstream config hook is not callable")
  }
  if (typeof upstream["experimental.chat.messages.transform"] !== "function") {
    throw new Error("Upstream experimental.chat.messages.transform hook is not callable")
  }

  const dir = skillsDir()
  const discoveredSkills = await new SkillDiscovery(dir, logger).discover()
  if (!discoveredSkills.length) {
    throw new Error(`No Superpowers skills found in ${dir}`)
  }
  if (!discoveredSkills.includes(POLICY_SKILL)) {
    throw new Error(`Superpowers policy skill "${POLICY_SKILL}" not found`)
  }

  return {
    configHook: upstream["config"],
    transformHook: upstream["experimental.chat.messages.transform"],
    skills: discoveredSkills
  }
}

/**
 * Creates an ordered rule map that assigns the same action to every key.
 *
 * @param keys - Rule keys in precedence order.
 * @param action - Permission action assigned to each key.
 * @returns A rule map preserving the order of `keys`.
 */
function createRuleMap(keys: string[], action: PermissionActionConfig): PermissionObjectConfig {
  return Object.fromEntries(keys.map((name) => [name, action]))
}

/**
 * Merges two normalized rule maps while preserving OpenCode's last-match-wins semantics.
 * Overridden keys are removed from the base and appended in override order, while unrelated
 * base rules retain their relative order.
 *
 * @param base - Existing rules whose unrelated entries are preserved.
 * @param override - Rules that replace matching base entries and take final precedence.
 * @returns A new merged rule map.
 */
function mergeRuleMaps(base: PermissionObjectConfig, override: PermissionObjectConfig): PermissionObjectConfig {
  return Object.fromEntries([...Object.entries(base).filter(([name]) => !(name in override)), ...Object.entries(override)])
}


/**
 * Converts global and skill permission shorthands to object forms while
 * preserving existing permission entries. A scalar global action becomes a
 * wildcard permission, and a scalar `skill` action becomes a wildcard rule map.
 *
 * @param current - Permission config to normalize.
 * @returns A permission object containing an object-form skill rule map.
 *
 * @example
 * ```ts
 * normalizePermissionConfig("allow")
 * // => { "*": "allow", skill: { } }
 * ```
 *
 * @example
 * ```ts
 * normalizePermissionConfig({ bash: "ask", skill: "deny" })
 * // => { bash: "ask", skill: { "*": "deny" } }
 * ```
 */
function normalizePermissionConfig(current: PermissionConfig | undefined) {
  const permission = typeof current === "string" ? { "*": current } : current ?? { }
  const skill = typeof permission.skill === "string" ? { "*": permission.skill } : permission.skill ?? { }
  return { ...permission, skill }
}

/**
 * Applies skill permission rules to a global or agent config in place.
 * Preserves unrelated rules and gives supplied rules precedence over matching entries.
 *
 * @param target - Configuration object whose skill permissions are updated.
 * @param skillRuleMap - Ordered skill permission rules to apply.
 */
function applySkillRulesTo(target: { permission?: PermissionConfig }, skillRuleMap: PermissionObjectConfig): void {
  const permission = normalizePermissionConfig(target.permission)
  target.permission = { ...permission, skill: mergeRuleMaps(permission.skill, skillRuleMap) }
}


/**
 * Creates the implicit Superpowers agent or fills its missing mode and description,
 * preserving existing values and leaving an explicitly disabled agent unchanged.
 * Permissions and bootstrap delivery are configured separately.
 *
 * @param config - Mutable runtime configuration containing the agent registry.
 */
function configureSuperpowersAgent(config: RuntimeConfig): void {
  config.agent ??= { }

  const configured = config.agent[SUPERPOWERS_AGENT]
  if (configured?.disable !== true) {
    const agent = configured ?? (config.agent[SUPERPOWERS_AGENT] = { })
    agent.mode ??= "primary"
    agent.description ??= SUPERPOWERS_DESCRIPTION
  }
}


function configEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => configEqual(value, right[index]))
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftEntries = Object.entries(left)
    const rightEntries = Object.entries(right)
    return leftEntries.length === rightEntries.length && leftEntries.every(([key, value], index) => key === rightEntries[index]?.[0] && configEqual(value, rightEntries[index]?.[1]))
  }
  return false
}

function reconciledValue(original: unknown, draft: unknown): unknown {
  if (configEqual(original, draft)) {
    return original
  }
  if (Array.isArray(draft)) {
    const source = Array.isArray(original) ? original : []
    return draft.map((value, index) => reconciledValue(source[index], value))
  }
  if (draft && typeof draft === "object") {
    const source = original && typeof original === "object" && !Array.isArray(original) ? original as Record<string, unknown> : { }
    return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, reconciledValue(source[key], value)]))
  }
  return draft
}

/**
 * Commits a fully staged configuration to the live target while retaining its
 * root identity. Before mutating the target, validates every required top-level
 * deletion, replacement, and addition, so a failed preflight leaves it unchanged.
 * Changed containers follow the draft order while structurally equal nested values
 * retain their original references.
 *
 * @example
 * ```text
 * target (same root)
 * |- agent (replaced)
 * |  |- build (original reference)
 * |  `- superpowers (new value)
 * `- provider (original reference)
 * ```
 *
 * @param target - Mutable live configuration to update.
 * @param draft - Fully staged configuration whose state should be committed.
 * @throws {@link Error} when a root property descriptor or target extensibility prevents a required mutation.
 */
function commitConfigTo(target: RuntimeConfig, draft: RuntimeConfig): void {
  const current = target as Record<string, unknown>
  const staged = draft as Record<string, unknown>
  const removed = Object.keys(current).filter((key) => !(key in staged))
  const changed = Object.keys(staged).filter((key) => !configEqual(current[key], staged[key])).map((key) => [key, reconciledValue(current[key], staged[key])] as const)

  for (const key of removed) {
    if (Object.getOwnPropertyDescriptor(current, key)?.configurable === false) {
      throw new Error(`Cannot delete config.${key}`)
    }
  }
  for (const [key] of changed) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor && (!("value" in descriptor) || !descriptor.writable)) {
      throw new Error(`Cannot replace config.${key}`)
    }
    if (!descriptor && !Object.isExtensible(current)) {
      throw new Error(`Cannot add config.${key}`)
    }
  }

  for (const key of removed) delete current[key]
  for (const [key, value] of changed) current[key] = value
}


function isLater(message: UserMessage, otherMessage: UserMessage): boolean {
  return message.time.created > otherMessage.time.created || (message.time.created === otherMessage.time.created && message.id > otherMessage.id)
}

/**
 * Finds the chronologically latest user message regardless of array order,
 * using the message ID as a deterministic tie-breaker for equal timestamps.
 *
 * @param messages - Message history supplied to the transform hook.
 * @returns The latest user message, or `undefined` when the history contains none.
 */
function latestUser(messages: Parameters<TransformHook>[1]["messages"]): UserMessage | undefined {
  let latest: UserMessage | undefined
  for (const { info } of messages) {
    if (info.role === "user" && (!latest || isLater(info, latest))) {
      latest = info
    }
  }
  return latest
}


const SuperpowersAgentPlugin: Plugin = async (input, rawOptions) => {
  const logger = new Logger(input.client)
  const environment = process.env[AGENTS_ENV]

  let options: Options
  try {
    options = environment === undefined ? parsePluginOptions(rawOptions) : parseEnvironmentOptions(environment)
  } catch (error) {
    await logger.warn("Invalid agent configuration; additional agents are disabled", error)
    options = { agents: [] }
  }

  let upstream: Awaited<ReturnType<typeof loadSuperpowers>>
  try {
    upstream = await loadSuperpowers(input, logger)
  } catch (error) {
    await logger.error("Failed to load Superpowers; plugin is disabled", error)
    return { } // do not register Superpowers plugin hooks on error
  }

  /** Includes the implicit Superpowers agent and additional agents requested through user options. */
  const superpowersAgentNames = new Set([SUPERPOWERS_AGENT, ...options.agents])

  /** Applied globally and at agent level to make access to Superpowers explicitly opt-in. */
  const baselineRuleMap = createRuleMap(upstream.skills, "deny")
  /** Applied to opted-in agents while leaving bootstrap delivery to the upstream transform. */
  const overrideRuleMap = mergeRuleMaps(createRuleMap(upstream.skills, "allow"), { [POLICY_SKILL]: "deny" })

  /**
   * Shares the successfully configured agent set with the transform hook,
   * ensuring bootstrap injection follows the committed permission state.
   */
  const enabledAgents = new Set<string>()

  /**
   * Applies the Superpowers integration when OpenCode initializes plugins for a directory instance.
   *
   * OpenCode invokes this hook after loading the mutable effective configuration
   * and before materializing built-in agents. It stages upstream skill-path
   * registration, permission rules, and the dedicated agent on a clone, then
   * commits the resulting configuration and publishes the corresponding bootstrap
   * scope. Setup failures discard staged changes and disable bootstrap routing.
   *
   * @param config - Mutable effective configuration for the current directory instance.
   */
  const configHook: ConfigHook = async (config) => {
    const runtimeConfig = config as RuntimeConfig
    enabledAgents.clear()

    try {
      const draft = structuredClone(runtimeConfig)

      // let upstream register its bundled skills path on the draft
      await upstream.configHook(draft as Config)

      // apply the global baseline after upstream so the wrapper has final precedence
      applySkillRulesTo(draft, baselineRuleMap)

      // prevent non-opted-in agents from overriding the global denying with agent-level permissions
      for (const [agentName, agent] of Object.entries(draft.agent ?? { })) {
        if (!superpowersAgentNames.has(agentName) && agent.disable !== true) {
          applySkillRulesTo(agent, baselineRuleMap)
        }
      }

      // create or augment the implicit Superpowers agent before processing all opt-ins
      configureSuperpowersAgent(draft)

      // grant Superpowers access only to existing, non-disabled opt-in agents
      for (const agentName of superpowersAgentNames) {
        const agent = draft.agent?.[agentName]
        if (agent && agent.disable !== true) {
          applySkillRulesTo(agent, overrideRuleMap)
          enabledAgents.add(agentName)
        }
      }

      commitConfigTo(runtimeConfig, draft)
    } catch (error) {
      enabledAgents.clear()
      await logger.error("Failed to configure Superpowers; plugin is disabled", error)
    }
  }

  /**
   * Enables the upstream Superpowers bootstrap only for configured agents.
   *
   * Because OpenCode may invoke this hook on every agent step, the active agent
   * is determined from the latest user message in the current history.
   *
   * If that agent is enabled, delegates to the upstream transform, which handles
   * bootstrap injection, tool mapping, and duplicate protection. Otherwise,
   * leaves the messages unchanged.
   *
   * @param hookInput - OpenCode transform context, passed through unchanged.
   * @param output - Mutable messages prepared for the next model request.
   */
  const transformHook: TransformHook = async (hookInput, output) => {
    const user = latestUser(output.messages)
    if (user && enabledAgents.has(user.agent)) {
      await upstream.transformHook(hookInput, output)
    }
  }

  return { "config": configHook, "experimental.chat.messages.transform": transformHook }
}

export default SuperpowersAgentPlugin
