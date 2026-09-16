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

  debug(message: string, extra?: LogExtra) {
    return this.log("debug", message, extra)
  }

  info(message: string, extra?: LogExtra) {
    return this.log("info", message, extra)
  }

  warn(message: string, extra?: LogExtra) {
    return this.log("warn", message, extra)
  }

  error(message: string, extra?: LogExtra) {
    return this.log("error", message, extra)
  }

  private log(level: "debug" | "info" | "error" | "warn", message: string, extra?: LogExtra) {
    return this.client.app.log({ body: { service: SERVICE, level, message, ...(extra ? { extra } : {}) } })
  }
}


function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}


function parseOptions(raw?: PluginOptions): Options {
  const agents = raw?.agents ?? []

  if (!Array.isArray(agents) || agents.some((agent) => typeof agent !== "string" || !agent.trim())) {
    throw new Error('[superpowers-agent] "agents" must be an array of non-empty strings')
  }

  /**
   * Дубликаты не должны повторно менять одну entry. `superpowers` исключается
   * из allowlist, поскольку его lifecycle должен уважать explicit disable:
   * entry дополняется (или создаётся), а disabled остаётся выключенной.
   */
  const uniqueAgents = [...new Set(agents.map((agent) => agent.trim()))].filter((agent) => agent !== SUPERPOWERS_AGENT)
  return { agents: uniqueAgents }
}

function environmentOptions(value: string): Options {
  let agents: unknown
  try {
    agents = JSON.parse(value)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`[superpowers-agent] invalid ${AGENTS_ENV}: ${detail}`)
  }

  return parseOptions({ agents })
}


/**
 * Находит физический каталог `superpowers/skills` через JavaScript module
 * resolver, а не через захардкоженный `~/.config/opencode/node_modules/...`.
 *
 * `import.meta.resolve("superpowers/package.json")` использует тот же module
 * resolution environment, в котором выполняется этот ES module, и возвращает
 * URL реально установленного package.json.
 *
 * Это важно, потому что dependency теоретически может находиться не по
 * захардкоженному пути (другая config directory, package layout и т.п.).
 */
function skillsDir(): string {
  const packageJson = fileURLToPath(import.meta.resolve("superpowers/package.json"))

  return join(dirname(packageJson), "skills")
}

/**
 * Читает `name` из YAML frontmatter файла SKILL.md.
 *
 * Мы намеренно не используем имя директории как skill ID: OpenCode использует
 * metadata `name` из самого SKILL.md, поэтому permissions должны строиться по
 * тому же значению.
 *
 * Полный YAML parser намеренно не добавляется: bundled skills ожидаются с
 * простым однострочным `name`. Если upstream перейдёт на multiline или escaped
 * YAML scalars, этот ограниченный parser потребуется заменить.
 */
function skillName(file: string): string {
  const source = readFileSync(file, "utf8")

  /** Не ищем `name` в body, чтобы содержимое skill не выдавало себя за metadata. */
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]

  const name = frontmatter?.match(/^name:[ \t]*["']?([^"'\r\n]*?)["']?[ \t]*$/m)?.[1]?.trim()

  if (!name) {
    throw new Error(`[superpowers-agent] skill has no valid name: ${file}`)
  }

  return name
}


/**
 * Рекурсивно находит все `SKILL.md` внутри upstream `skills/`.
 *
 * Это намеренно повторяет идею native OpenCode skill discovery: plugin не
 * содержит сопровождаемый вручную список имён. После обновления Superpowers
 * новый skill автоматически попадёт в generated permissions.
 */
type DiscoveredSkill = { name: string; path: string }

function discoverSkills(dir: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      skills.push(...discoverSkills(path))
    } else if (entry.name === "SKILL.md") {
      skills.push({ name: skillName(path), path })
    }
  }

  return skills
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
    options = environment === undefined ? parseOptions(rawOptions) : environmentOptions(environment)
  } catch (error) {
    await logger.warn("Invalid agent configuration; additional agents are disabled", { error: errorDetail(error) })
    options = { agents: [] }
  }

  /**
   * Инициализируем upstream plugin как библиотеку.
   *
   * Важно: мы НЕ возвращаем его hooks OpenCode напрямую. `upstream` — просто
   * обычный JS object с callbacks. Ни один upstream hook не выполнится, пока
   * этот wrapper явно его не вызовет.
   */
  let upstreamConfig: NonNullable<Hooks["config"]>
  let upstreamTransform: NonNullable<Hooks["experimental.chat.messages.transform"]>
  let uniqueSkills: string[]
  try {
    if (typeof SuperpowersPlugin !== "function") {
      throw new Error("[superpowers-agent] upstream plugin is not callable")
    }

    const upstream: Hooks = await SuperpowersPlugin(input)

    if (typeof upstream?.config !== "function") {
      throw new Error("[superpowers-agent] required upstream config hook is not callable")
    }

    if (typeof upstream["experimental.chat.messages.transform"] !== "function") {
      throw new Error("[superpowers-agent] required upstream experimental.chat.messages.transform hook is not callable")
    }

    upstreamConfig = upstream.config
    upstreamTransform = upstream["experimental.chat.messages.transform"]

    const dir = skillsDir()

    /**
     * Наш собственный discovery нужен только для permissions. Само содержимое
     * skills и bootstrap остаётся ответственностью upstream plugin/OpenCode.
     */
    const discoveredSkills = discoverSkills(dir)

    if (!discoveredSkills.length) {
      throw new Error(`[superpowers-agent] no Superpowers skills found in ${dir}`)
    }

    const skillsByName = new Map<string, DiscoveredSkill[]>()
    for (const skill of discoveredSkills) {
      const matches = skillsByName.get(skill.name) ?? []
      matches.push(skill)
      skillsByName.set(skill.name, matches)
    }
    const conflicts = [...skillsByName].filter(([, skills]) => skills.length > 1).sort(([left], [right]) => left.localeCompare(right))

    if (conflicts.length) {
      /** Permissions identify skills only by name, so bundled names must be unique. */
      const detail = conflicts.map(([name, skills]) => [`duplicate bundled skill name "${name}":`, ...skills.map((skill) => `  ${skill.path}`).sort()].join("\n")).join("\n")
      throw new Error(`[superpowers-agent] ${detail}`)
    }

    uniqueSkills = discoveredSkills.map((skill) => skill.name)

    if (!uniqueSkills.includes(POLICY_SKILL)) {
      /** Без upstream policy skill невозможно получить полный Superpowers mode. */
      throw new Error(`[superpowers-agent] required skill "${POLICY_SKILL}" not found`)
    }
  } catch (error) {
    await logger.error("Failed to initialize Superpowers; plugin is disabled", {
      error: errorDetail(error),
    })
    return {}
  }

  const capabilities = uniqueSkills.filter((name) => name !== POLICY_SKILL)

  /**
   * Baseline: exact deny наследуется всеми агентами. Для configured agents ниже
   * добавляются agent-level deny, чтобы их правила не перекрыли baseline.
   */
  const denied = permissions(uniqueSkills, "deny")

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
      await upstreamConfig(draft as Config)

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
      await logger.error("Failed to configure Superpowers; plugin is disabled", {
        error: errorDetail(error),
      })
    }
  }

  return {
    config: configHook,

    /**
     * Не копируем bootstrap: делегирование upstream сохраняет его policy,
     * tool mapping и duplicate protection. Wrapper отвечает только за gate по
     * агенту последнего user turn.
     */
    "experimental.chat.messages.transform": async (hookInput, output) => {
      const user = latestUser(output.messages)
      if (!user || !enabledAgents.has(user.agent)) return

      /**
       * Upstream полностью контролирует:
       * - чтение `using-superpowers`;
       * - оригинальный prompt/wrapper;
       * - OpenCode tool mapping;
       * - duplicate protection/caching;
       * - фактическую mutation messages.
       */
      await upstreamTransform(hookInput, output)
    },
  }
}

export default SuperpowersAgentPlugin
