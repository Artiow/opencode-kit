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
 */

import type { Config, Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import type { AgentConfig, PermissionActionConfig, PermissionConfig } from "@opencode-ai/sdk/v2"

/**
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

/**
 * Синхронные операции здесь осознаны: они выполняются при инициализации
 * plugin до регистрации hooks. Каталог Superpowers мал, поэтому более сложная
 * async-координация не дала бы практической пользы на runtime request path.
 */
import { readFileSync, readdirSync } from "node:fs"

/**
 * Module resolver возвращает file: URL. Преобразуем его штатным API, а не
 * вручную, чтобы escaping и platform-specific paths не ломали discovery.
 */
import { fileURLToPath } from "node:url"

import { dirname, join } from "node:path"


const SUPERPOWERS_AGENT = "superpowers"
const SUPERPOWERS_DESCRIPTION = "OpenCode with the full Superpowers workflow"
/**
 * Единственное имя upstream skill, которое plugin знает специально.
 *
 * `using-superpowers` — не обычная capability: upstream plugin использует его
 * как источник bootstrap/policy и при подходящей истории подмешивает его текст
 * в model context, когда wrapper делегирует upstream transform.
 * Поэтому мы не разрешаем агентам загружать этот skill повторно через native
 * `skill` tool.
 */
const POLICY_SKILL = "using-superpowers"

/** Локальное имя следует официальному SDK-типу permission actions. */
type Action = PermissionActionConfig

type SkillPermissions = Record<string, Action>

type RuntimeAgentConfig = Omit<AgentConfig, "permission"> & { permission?: PermissionConfig }

type RuntimeConfig = Omit<Config, "permission" | "agent"> & { permission?: PermissionConfig; agent?: Record<string, RuntimeAgentConfig> }

/**
 * Выводим тип messages из официального hook-а, чтобы изменение OpenCode API
 * ломало typecheck, а не оставляло wrapper с незаметно устаревшей копией shape.
 */
type Messages = Parameters<NonNullable<Hooks["experimental.chat.messages.transform"]>>[1]["messages"]

type Options = { agents: string[] }
type LogExtra = Record<string, unknown>

const AGENTS_ENV = "OPENCODE_SUPERPOWERS_AGENTS"
const SERVICE = "superpowers-agent"


// noinspection JSUnusedGlobalSymbols
class Logger {
  private readonly client: PluginInput["client"]

  constructor(client: PluginInput["client"]) {
    this.client = client
  }

  debug(message: string, error?: unknown, extra?: LogExtra) {
    return this.log("debug", message, error, extra)
  }

  info(message: string, error?: unknown, extra?: LogExtra) {
    return this.log("info", message, error, extra)
  }

  warn(message: string, error?: unknown, extra?: LogExtra) {
    return this.log("warn", message, error, extra)
  }

  error(message: string, error?: unknown, extra?: LogExtra) {
    return this.log("error", message, error, extra)
  }

  private errorDetail(error: unknown): string {
    if (error instanceof Error) {
      return error.cause === undefined ? error.message : `${error.message}; caused by: ${this.errorDetail(error.cause)}`
    } else {
      return String(error)
    }
  }

  private log(level: "debug" | "info" | "error" | "warn", message: string, error?: unknown, extra?: LogExtra) {
    const details = error === undefined ? extra : { ...extra, error: this.errorDetail(error) }
    return this.client.app.log({ body: { service: SERVICE, level, message, ...(details ? { extra: details } : { }) } })
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
   * Discovers unique skill names recursively below the root directory.
   *
   * @returns The unique skill names in traversal insertion order.
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
          await this.logger.warn("Skipped a skill file without a valid name", { file: path })
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


// TODO: небольшой docstring
async function loadSuperpowers(input: PluginInput, logger: Logger): Promise<{
  configHook: NonNullable<Hooks["config"]>
  transformHook: NonNullable<Hooks["experimental.chat.messages.transform"]>
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


function permissions(skills: string[], action: Action): SkillPermissions {
  return Object.fromEntries(skills.map((name) => [name, action]))
}


function isAction(value: unknown): value is Action {
  return value === "allow" || value === "ask" || value === "deny"
}


/**
 * Приводит scalar shorthand к map, потому что wrapper должен добавить owned
 * skill rules, не потеряв действие пользователя для остальных permissions.
 */
function normalizePermission(current: unknown, location: string): Exclude<PermissionConfig, PermissionActionConfig> {
  if (current === undefined) return {}
  if (isAction(current)) return { "*": current }
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Exclude<PermissionConfig, PermissionActionConfig>
  }

  throw new Error(`[superpowers-agent] ${location} must be a permission action or object`)
}


/**
 * Нормализует и merge-ит существующий `permission.skill` с нашими правилами.
 *
 * OpenCode допускает две формы permission:
 *
 *   skill: "allow"
 *
 * и granular map:
 *
 *   skill: {
 *     "*": "allow",
 *     "private-*": "deny"
 *   }
 *
 * Поэтому `current` здесь intentionally `unknown`: сначала мы проверяем его
 * runtime shape, потом приводим к единой map-форме.
 *
 * Generated rules добавляются в конец. Для OpenCode порядок granular rules
 * значим: при нескольких matching rules более позднее правило должно иметь
 * возможность переопределить более общее пользовательское wildcard-правило.
 * Wrapper владеет exact rules для всех bundled Superpowers skill names:
 * пользовательские exact keys удаляются, а generated keys добавляются после
 * всех сохранённых правил. Wildcard и unrelated rules сохраняют исходный
 * relative order; их action не ранжируются, потому что OpenCode использует
 * последнее matching rule.
 */
function mergePermissions(current: unknown, added: SkillPermissions): SkillPermissions {
  let existing: SkillPermissions
  if (current === undefined) existing = {}
  else if (isAction(current)) existing = { "*": current }
  else if (current && typeof current === "object" && !Array.isArray(current)) existing = { ...(current as SkillPermissions) }
  else throw new Error("[superpowers-agent] permission.skill must be a permission action or object")

  /**
   * Повторно добавляем owned keys в конец: одного присваивания недостаточно,
   * потому что оно меняет value, но сохраняет прежнюю позицию ключа.
   */
  return Object.fromEntries([...Object.entries(existing).filter(([name]) => !(name in added)), ...Object.entries(added)])
}


/**
 * Добавляет global deny для всех Superpowers skills.
 *
 * OpenCode API: `config.permission.skill`.
 * Global deny задаёт baseline для всех агентов. Configured non-enabled agents
 * дополнительно получают exact agent-level deny, потому что их локальные rules
 * способны перекрыть этот baseline.
 */
function denyGlobally(config: RuntimeConfig, denied: SkillPermissions): void {
  config.permission = normalizePermission(config.permission, "permission")
  config.permission.skill = mergePermissions(config.permission.skill, denied)
}


/**
 * Делает уже существующий OpenCode agent Superpowers-enabled на уровне skills.
 *
 * OpenCode API: `config.agent[name].permission.skill`.
 * Остальные настройки agent — prompt, model, temperature, другие permissions —
 * не меняются.
 */
function enableAgent(
  config: RuntimeConfig,
  name: string,
  allowed: SkillPermissions,
): boolean {
  const agent = config.agent?.[name]
  if (!agent || agent.disable === true) return false

  agent.permission = normalizePermission(agent.permission, `agent.${name}.permission`)
  agent.permission.skill = mergePermissions(agent.permission.skill, allowed)
  return true
}


function denyConfiguredAgents(
  config: RuntimeConfig,
  enabledAgents: Set<string>,
  denied: SkillPermissions,
): void {
  /**
   * Локальный exact deny нужен даже при global baseline: agent-level wildcard
   * может иметь более высокий precedence. Disabled entries не меняем, чтобы
   * уважать явное отключение и не переписывать dormant configuration.
   */
  for (const [name, agent] of Object.entries(config.agent ?? {})) {
    if (name === SUPERPOWERS_AGENT || enabledAgents.has(name) || agent.disable === true) continue

    agent.permission = normalizePermission(agent.permission, `agent.${name}.permission`)
    agent.permission.skill = mergePermissions(agent.permission.skill, denied)
  }
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
function configureSuperpowersAgent(config: RuntimeConfig, allowed: SkillPermissions): boolean {
  config.agent ??= {}

  const configured = config.agent[SUPERPOWERS_AGENT]
  if (configured?.disable === true) {
    return false
  }

  const agent = configured ?? (config.agent[SUPERPOWERS_AGENT] = {})
  agent.mode ??= "primary"
  agent.description ??= SUPERPOWERS_DESCRIPTION
  enableAgent(config, SUPERPOWERS_AGENT, allowed)
  return true
}


type UserMessageInfo = Extract<Messages[number]["info"], { role: "user" }>

/**
 * Routing определяется последним user turn: именно его metadata фиксирует
 * выбранного агента. На порядок массива не полагаемся, потому что OpenCode
 * может передать переупорядоченную историю; ID служит только детерминированным
 * tie-breaker при одинаковом timestamp.
 */
function latestUser(messages: Messages): UserMessageInfo | undefined {
  let latest: UserMessageInfo | undefined

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

  let upstreamConfigHook: NonNullable<Hooks["config"]>
  let upstreamTransformHook: NonNullable<Hooks["experimental.chat.messages.transform"]>
  let upstreamSkills: string[]
  try {
    let upstream = await loadSuperpowers(input, logger)
    upstreamConfigHook = upstream.configHook
    upstreamTransformHook = upstream.transformHook
    upstreamSkills = upstream.skills
  } catch (error) {
    await logger.error("Failed to load Superpowers; plugin is disabled", error)
    return { } // do not register Superpowers plugin hooks on error
  }

  const capabilities = upstreamSkills.filter((name) => name !== POLICY_SKILL)

  /**
   * Baseline: exact deny наследуется всеми агентами. Для configured agents ниже
   * добавляются agent-level deny, чтобы их правила не перекрыли baseline.
   */
  const denied = permissions(upstreamSkills, "deny")

  /**
   * Для enabled agents разрешаем capabilities, но `using-superpowers` оставляем
   * deny: policy загружает upstream transform, когда история подходит для
   * injection; явная повторная загрузка через native `skill` tool не нужна.
   */
  const enabled: SkillPermissions = { ...permissions(capabilities, "allow"), [POLICY_SKILL]: "deny" }

  /**
   * Одно и то же множество используется для access-control и bootstrap scope.
   * Это исключает состояние "skills разрешены, но bootstrap не включён".
   */
  const enabledAgents = new Set<string>()

  // TODO: docstring о том, что это за функция и зачем
  const configHook: NonNullable<Hooks["config"]> = async (config) => {
    const runtimeConfig = config as RuntimeConfig

    try {
      const draft = structuredClone(runtimeConfig)

      /**
       * Делегируем upstream его собственную регистрацию skills path.
       *
       * Upstream знает собственный package layout и добавляет свой `skills/`
       * в `config.skills.paths`.
       */
      await upstreamConfigHook(draft as Config)

      /**
       * Накладываем access-control после upstream, чтобы wrapper имел последнее
       * слово по owned skill permissions независимо от добавленных upstream rules.
       */
      denyGlobally(draft, denied)

      const explicitlyEnabled = new Set(options.agents)
      denyConfiguredAgents(draft, explicitlyEnabled, denied)

      const nextEnabledAgents = new Set<string>()

      /**
       * Allow rules ставятся на agent level, чтобы они осознанно перекрывали
       * global deny только для существующего explicit opt-in. Отсутствующее имя
       * игнорируется и не создаёт новый agent из возможной опечатки.
       */
      for (const agent of options.agents) {
        if (enableAgent(draft, agent, enabled)) nextEnabledAgents.add(agent)
      }
      if (configureSuperpowersAgent(draft, enabled)) {
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
  const transformHook: NonNullable<Hooks["experimental.chat.messages.transform"]> = async (hookInput, output) => {
    const user = latestUser(output.messages)
    if (user && enabledAgents.has(user.agent)) {
      await upstreamTransformHook(hookInput, output)
    }
  }

  return { config: configHook, "experimental.chat.messages.transform": transformHook }
}

export default SuperpowersAgentPlugin
