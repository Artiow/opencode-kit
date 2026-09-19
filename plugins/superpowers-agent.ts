/**
 * OpenCode plugin, который делает upstream Superpowers opt-in по агентам.
 *
 * Важная архитектурная идея:
 * - реализацию самого Superpowers workflow мы не копируем;
 * - upstream `superpowers` используется как библиотека;
 * - его `config` hook отвечает за регистрацию skills;
 * - его `experimental.chat.messages.transform` отвечает за сборку и injection
 *   оригинального Superpowers bootstrap;
 * - этот plugin добавляет только scope/access-control вокруг upstream hooks.
 *
 * Такое разделение не даёт wrapper-у разойтись с upstream workflow при
 * обновлениях Superpowers и оставляет здесь только политику, которой upstream
 * plugin не владеет: какие агенты получают skills и bootstrap.
 *
 * Upstream импортируется как factory, а не регистрируется в OpenCode отдельно:
 * wrapper должен контролировать вызов transform и не допускать глобальный
 * bootstrap для агентов вне opt-in scope.
 *
 * Upstream package поставляется как JavaScript без подходящих TypeScript
 * declarations для этого export-а. `@ts-ignore` подавляет ошибку TypeScript
 * только для следующей строки; runtime-поведение импорта он не меняет.
 */

// @ts-ignore
import { SuperpowersPlugin } from "superpowers"

import type { Config, Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import type { UserMessage } from "@opencode-ai/sdk"
import type { AgentConfig, PermissionActionConfig, PermissionConfig } from "@opencode-ai/sdk/v2"

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
 * Together, these aliases model an ordered OpenCode permission ruleset:
 * each entry associates a permission pattern with an SDK action and insertion
 * order determines precedence.
 */
type Action = PermissionActionConfig
type RuleMap = Record<string, Action>

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
 * @throws If initialization or discovery fails, or required hooks or skills are missing.
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
function createRuleMap(keys: string[], action: Action): RuleMap {
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
function mergeRuleMaps(base: RuleMap, override: RuleMap): RuleMap {
  return Object.fromEntries([...Object.entries(base).filter(([name]) => !(name in override)), ...Object.entries(override)])
}


function isAction(value: unknown): value is Action {
  return value === "allow" || value === "ask" || value === "deny"
}

/**
 * Приводит scalar shorthand к map, потому что wrapper должен добавить owned
 * skill rules, не потеряв действие пользователя для остальных permissions.
 */
function normalizePermission(current: unknown): Exclude<PermissionConfig, PermissionActionConfig> {
  if (current === undefined) return {}
  if (isAction(current)) return { "*": current }
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Exclude<PermissionConfig, PermissionActionConfig>
  }

  throw new Error("[superpowers-agent] permission must be a permission action or object")
}

/**
 * Приводит scalar shorthand `permission.skill` к единой map-форме.
 *
 * OpenCode допускает как `skill: "allow"`, так и granular map. Wrapper
 * работает только с map, чтобы безопасно добавлять owned exact rules.
 */
function normalizeRuleMap(current: unknown): RuleMap {
  if (current === undefined) return {}
  if (isAction(current)) return { "*": current }
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return { ...(current as RuleMap) }
  }

  throw new Error("[superpowers-agent] permission.skill must be a permission action or object")
}

/**
 * Applies skill permission rules to a global or agent config in place.
 * Preserves unrelated rules and gives supplied rules precedence over matching entries.
 *
 * @param target - Configuration object whose skill permissions are updated.
 * @param skillRuleMap - Ordered skill permission rules to apply.
 * @throws When the existing permission or skill rule has an unsupported shape.
 */
function applySkillRulesTo(target: { permission?: PermissionConfig }, skillRuleMap: RuleMap): void {
  target.permission = normalizePermission(target.permission)
  target.permission.skill = mergeRuleMaps(normalizeRuleMap(target.permission.skill), skillRuleMap)
}


/**
 * Config применяется транзакционно: upstream и wrapper сначала меняют clone,
 * чтобы exception не оставлял live config в частично обновлённом состоянии.
 * Перед первой mutation `commitConfig` проверяет все root descriptors, а
 * reconciliation сохраняет ссылки на неизменившиеся nested values. Это важно
 * для потребителей, уже удерживающих ссылки на части исходного config.
 */
function configEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
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
  if (configEqual(original, draft)) return original

  if (Array.isArray(draft)) {
    const source = Array.isArray(original) ? original : []
    return draft.map((value, index) => reconciledValue(source[index], value))
  }

  if (draft && typeof draft === "object") {
    const source = original && typeof original === "object" && !Array.isArray(original) ? original as Record<string, unknown> : {}
    return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, reconciledValue(source[key], value)]))
  }

  return draft
}

function commitConfig(original: RuntimeConfig, draft: RuntimeConfig): void {
  const current = original as Record<string, unknown>
  const staged = draft as Record<string, unknown>
  const removed = Object.keys(current).filter((key) => !(key in staged))
  const changed = Object.keys(staged).filter((key) => !configEqual(current[key], staged[key])).map((key) => [key, reconciledValue(current[key], staged[key])] as const)

  for (const key of removed) {
    if (Object.getOwnPropertyDescriptor(current, key)?.configurable === false) {
      throw new Error(`[superpowers-agent] cannot delete config.${key}`)
    }
  }
  for (const [key] of changed) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor && (!("value" in descriptor) || !descriptor.writable)) {
      throw new Error(`[superpowers-agent] cannot replace config.${key}`)
    }
    if (!descriptor && !Object.isExtensible(current)) {
      throw new Error(`[superpowers-agent] cannot add config.${key}`)
    }
  }

  for (const key of removed) delete current[key]
  for (const [key, value] of changed) current[key] = value
}


/**
 * Создаёт primary agent `superpowers` при отсутствии или дополняет существующую
 * non-disabled entry, сохраняя явно заданные mode и visibility.
 *
 * OpenCode API: `config.agent[name]`; `mode: "primary"` — default при создании.
 *
 * Мы сознательно НЕ задаём `prompt`: custom `agent.prompt` в OpenCode заменяет
 * обычный provider/base prompt, а нам нужен стандартный OpenCode prompt плюс
 * upstream Superpowers bootstrap. Bootstrap будет добавлен другим hook-ом.
 */
function configureSuperpowersAgent(config: RuntimeConfig, skillRuleMap: RuleMap): boolean {
  config.agent ??= {}

  const configured = config.agent[SUPERPOWERS_AGENT]
  if (configured?.disable === true) {
    return false
  }

  const agent = configured ?? (config.agent[SUPERPOWERS_AGENT] = {})
  agent.mode ??= "primary"
  agent.description ??= SUPERPOWERS_DESCRIPTION
  applySkillRulesTo(agent, skillRuleMap)
  return true
}


/**
 * Routing определяется последним user turn: именно его metadata фиксирует
 * выбранного агента. На порядок массива не полагаемся, потому что OpenCode
 * может передать переупорядоченную историю; ID служит только детерминированным
 * tie-breaker при одинаковом timestamp.
 */
function latestUser(messages: Parameters<TransformHook>[1]["messages"]): UserMessage | undefined {
  let latest: UserMessage | undefined

  for (const { info } of messages) {
    if (info.role !== "user") continue
    if (!latest || info.time.created > latest.time.created || (info.time.created === latest.time.created && info.id > latest.id)) {
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

    try {
      const draft = structuredClone(runtimeConfig)

      // let upstream register its bundled skills path on the draft
      await upstream.configHook(draft as Config)

      // apply the global baseline after upstream so the wrapper has final precedence
      applySkillRulesTo(draft, baselineRuleMap)

      const requestedAgentNames = new Set(options.agents)
      for (const [agentName, agent] of Object.entries(draft.agent ?? {})) {
        if (agentName === SUPERPOWERS_AGENT || requestedAgentNames.has(agentName) || agent.disable === true) continue
        applySkillRulesTo(agent, baselineRuleMap)
      }

      const nextEnabledAgents = new Set<string>()

      /**
       * Allow rules ставятся на agent level, чтобы они осознанно перекрывали
       * global deny только для существующего explicit opt-in. Отсутствующее имя
       * игнорируется и не создаёт новый agent из возможной опечатки.
       */
      for (const agentName of options.agents) {
        const agent = draft.agent?.[agentName]
        if (!agent || agent.disable === true) continue

        applySkillRulesTo(agent, overrideRuleMap)
        nextEnabledAgents.add(agentName)
      }
      if (configureSuperpowersAgent(draft, overrideRuleMap)) {
        nextEnabledAgents.add(SUPERPOWERS_AGENT)
      }

      /**
       * Не публикуем bootstrap scope до commit: transform не должен делегировать
       * upstream для конфигурации, которая не смогла установиться.
       */
      commitConfig(runtimeConfig, draft)
      enabledAgents.clear()
      for (const agent of nextEnabledAgents) enabledAgents.add(agent)
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
