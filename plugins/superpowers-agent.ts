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
 */

/**
 * `import type` — TypeScript-only импорт.
 *
 * Эти символы нужны только компилятору/IDE для проверки типов. В итоговый
 * JavaScript такой import не попадает и никаких runtime-модулей сам по себе
 * не загружает.
 *
 * `Config`        — тип объединённой конфигурации OpenCode, которую plugin
 *                   может менять в `config` hook.
 * `Hooks`         — тип всех hook-ов, которые plugin может вернуть OpenCode.
 * `Plugin`        — сигнатура plugin factory-функции.
 * `PluginOptions` — тип произвольных options, переданных plugin из конфига.
 */
import type {
  Config,
  Hooks,
  Plugin,
  PluginOptions,
} from "@opencode-ai/plugin"

/**
 * Статически импортируем именно upstream OpenCode plugin из package
 * `superpowers` и используем его как обычную factory-функцию.
 *
 * Это НЕ означает, что upstream plugin автоматически зарегистрирован в
 * OpenCode. OpenCode запустил бы его глобально только если бы пользователь
 * отдельно указал `superpowers` в своём `plugin` config.
 *
 * Здесь же мы сами вызываем `UpstreamSuperpowersPlugin(input)`, получаем
 * объект hook-ов и затем сами решаем, какие из этих hook-ов и когда вызывать.
 * Благодаря этому оригинальный bootstrap можно применять только к выбранным
 * агентам.
 *
 * Upstream package поставляется как JavaScript без подходящих TypeScript
 * declarations для этого export-а. `@ts-ignore` подавляет ошибку TypeScript
 * только для следующей строки; runtime-поведение импорта он не меняет.
 */
// @ts-ignore
import { SuperpowersPlugin as UpstreamSuperpowersPlugin } from "superpowers"

/**
 * Встроенный Node.js filesystem API.
 *
 * `existsSync(path)`
 *   синхронно проверяет существование файла/директории.
 *
 * `readFileSync(path, "utf8")`
 *   синхронно читает текстовый файл и возвращает string.
 *
 * `readdirSync(path, { withFileTypes: true })`
 *   читает содержимое директории и возвращает Dirent-объекты. Dirent позволяет
 *   узнать `isDirectory()` без дополнительного stat-вызова для каждого файла.
 *
 * Синхронные операции здесь осознанны: они выполняются один раз при загрузке
 * plugin, объём каталога Superpowers мал, а код получается значительно проще.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs"

/**
 * `import.meta.resolve(specifier)` ниже возвращает URL модуля вида
 * `file:///.../package.json`, а filesystem API ждёт обычный путь
 * `/.../package.json`.
 *
 * `fileURLToPath` выполняет корректное преобразование file: URL -> path,
 * включая escaping и platform-specific особенности.
 */
import { fileURLToPath } from "node:url"

/**
 * Встроенные helpers для filesystem paths.
 *
 * `dirname(path)`      — parent directory.
 * `join(a, b, ...)`    — собирает путь с правильным separator для платформы.
 */
import {
  dirname,
  join,
} from "node:path"


/** Имя primary agent, автоматически создаваемого этим plugin. */
const SUPERPOWERS_AGENT = "superpowers"

/**
 * Единственное имя upstream skill, которое plugin знает специально.
 *
 * `using-superpowers` — не обычная capability: upstream plugin использует его
 * как источник bootstrap/policy и сам подмешивает его текст в model context.
 * Поэтому мы не разрешаем агентам загружать этот skill повторно через native
 * `skill` tool.
 */
const POLICY_SKILL = "using-superpowers"

/**
 * String literal union в TypeScript — ближайший аналог enum с ровно тремя
 * допустимыми строковыми значениями, но без отдельного runtime enum-объекта.
 */
type Action = "allow" | "ask" | "deny"

/**
 * `Record<K, V>` — стандартный TypeScript utility type.
 *
 * Здесь это map:
 *   skill name -> OpenCode permission action
 *
 * Например:
 *   {
 *     "brainstorming": "deny",
 *     "systematic-debugging": "allow"
 *   }
 */
type SkillPermissions = Record<string, Action>

/**
 * Получаем тип `messages` непосредственно из официального типа hook-а OpenCode,
 * чтобы не дублировать его структуру руками.
 *
 * Разбор выражения изнутри наружу:
 *
 * 1. `Hooks["experimental.chat.messages.transform"]`
 *    — тип конкретного hook-а. Он может быть optional, поэтому содержит
 *      `undefined`.
 *
 * 2. `NonNullable<...>`
 *    — TypeScript utility type, удаляет `null | undefined`.
 *
 * 3. `Parameters<FunctionType>`
 *    — превращает параметры функции в tuple type: `[arg0, arg1, ...]`.
 *
 * 4. `[1]`
 *    — берём второй аргумент transform hook (`output`).
 *
 * 5. `["messages"]`
 *    — тип его поля `messages`.
 *
 * Если OpenCode поменяет shape messages в своём API, TypeScript с большей
 * вероятностью покажет ошибку здесь, вместо того чтобы мы продолжили работать
 * с устаревшей собственной копией типа.
 */
type Messages =
  Parameters<
    NonNullable<Hooks["experimental.chat.messages.transform"]>
  >[1]["messages"]

/** Наш небольшой typed-view поверх произвольных PluginOptions OpenCode. */
type Options = {
  agents: string[]
}


/**
 * Проверяет пользовательские options plugin.
 *
 * OpenCode передаёт plugin options как достаточно свободную JSON-like
 * структуру (`PluginOptions`), поэтому runtime validation всё равно нужна —
 * одних TypeScript типов здесь недостаточно.
 */
function parseOptions(raw?: PluginOptions): Options {
  /**
   * `?.` — optional chaining: если `raw` равен null/undefined, выражение даёт
   * undefined вместо exception.
   *
   * `??` — nullish coalescing: подставляет `[]` только для null/undefined,
   * но не для других falsy-значений.
   */
  const agents = raw?.agents ?? []

  if (
    !Array.isArray(agents) ||
    agents.some((value) => typeof value !== "string" || !value.trim())
  ) {
    throw new Error(
      '[superpowers-agent] "agents" must be an array of non-empty strings',
    )
  }

  return {
    /**
     * `Set` автоматически убирает дубликаты; spread `...` снова превращает его
     * в Array. Сам `superpowers` удаляем из пользовательского списка, потому
     * что этот agent создаётся plugin-ом автоматически.
     */
    agents: [...new Set(agents.map((value) => value.trim()))]
      .filter((value) => value !== SUPERPOWERS_AGENT),
  }
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
  const packageJson =
    fileURLToPath(import.meta.resolve("superpowers/package.json"))

  return join(dirname(packageJson), "skills")
}


/**
 * Читает `name` из YAML frontmatter файла SKILL.md.
 *
 * Мы намеренно не используем имя директории как skill ID: OpenCode использует
 * metadata `name` из самого SKILL.md, поэтому permissions должны строиться по
 * тому же значению.
 *
 * Полный YAML parser здесь пока не нужен: нам требуется единственное простое
 * scalar-поле `name`, поэтому достаточно двух regex.
 */
function skillName(file: string): string {
  const source = readFileSync(file, "utf8")

  /**
   * Первый regex выделяет только начальный YAML frontmatter между `---`.
   * `\r?\n` поддерживает и Unix, и Windows line endings.
   * `[\s\S]*?` — распространённый JS regex-приём для non-greedy match любого
   * символа, включая newline.
   *
   * `?.[1]` — optional access к первой capture group; если match отсутствует,
   * получаем undefined.
   */
  const frontmatter = source.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
  )?.[1]

  const name = frontmatter
    ?.match(/^name:\s*(.+?)\s*$/m)?.[1]
    ?.replace(/^[\"']|[\"']$/g, "")

  if (!name) {
    throw new Error(
      `[superpowers-agent] skill has no valid name: ${file}`,
    )
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
function discoverSkills(dir: string): string[] {
  const skills: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      skills.push(...discoverSkills(path))
    } else if (entry.name === "SKILL.md") {
      skills.push(skillName(path))
    }
  }

  return skills
}


/**
 * Строит OpenCode granular permission map для набора skills.
 *
 * `Object.fromEntries()` — стандартный JS API, обратный к `Object.entries()`:
 * принимает последовательность `[key, value]` и создаёт обычный JS object.
 */
function permissions(
  skills: string[],
  action: Action,
): SkillPermissions {
  return Object.fromEntries(
    skills.map((name) => [name, action]),
  )
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
 */
function mergePermissions(
  current: unknown,
  added: SkillPermissions,
): SkillPermissions {
  const existing: SkillPermissions =
    typeof current === "string"
      ? { "*": current as Action }
      : current && typeof current === "object"
        ? { ...(current as SkillPermissions) }
        : {}

  /**
   * `Object.entries(existing)` превращает object в `[key, value][]`.
   * Сначала удаляем keys, которые собираемся добавить сами, затем append-им
   * generated entries. Это гарантирует не только новое значение, но и нужный
   * insertion order ключа в результирующем object.
   */
  return Object.fromEntries([
    ...Object.entries(existing)
      .filter(([name]) => !(name in added)),
    ...Object.entries(added),
  ])
}


/**
 * Добавляет global deny для всех Superpowers skills.
 *
 * OpenCode API: `config.permission.skill`.
 * Global permissions наследуются агентами, поэтому нам не нужно обходить
 * `build`, `plan`, `general`, `explore` и произвольных пользовательских agents.
 */
function denyGlobally(
  config: Config,
  denied: SkillPermissions,
): void {
  /**
   * `??=` — nullish assignment: присваивает `{}` только если слева
   * null/undefined. Уже существующий config не перезаписывается.
   */
  config.permission ??= {}
  config.permission.skill =
    mergePermissions(config.permission.skill, denied)
}


/**
 * Делает уже существующий OpenCode agent Superpowers-enabled на уровне skills.
 *
 * OpenCode API: `config.agent[name].permission.skill`.
 * Остальные настройки agent — prompt, model, temperature, другие permissions —
 * не меняются.
 */
function enableAgent(
  config: Config,
  name: string,
  allowed: SkillPermissions,
): void {
  /**
   * `config.agent?.[name]` — optional chaining + computed property access.
   * Эквивалентно безопасному lookup по динамическому ключу map/object.
   */
  const agent = config.agent?.[name]

  if (!agent) {
    /**
     * Fail-fast выбран специально: typo в `agents` не должен молча создавать
     * новый пустой agent или оставлять частично работающую конфигурацию.
     */
    throw new Error(
      `[superpowers-agent] configured agent "${name}" does not exist`,
    )
  }

  agent.permission ??= {}
  agent.permission.skill =
    mergePermissions(agent.permission.skill, allowed)
}


/**
 * Создаёт отдельный selectable primary agent `superpowers`.
 *
 * OpenCode API: `config.agent[name]` и `mode: "primary"`.
 *
 * Мы сознательно НЕ задаём `prompt`: custom `agent.prompt` в OpenCode заменяет
 * обычный provider/base prompt, а нам нужен стандартный OpenCode prompt плюс
 * upstream Superpowers bootstrap. Bootstrap будет добавлен другим hook-ом.
 */
function createSuperpowersAgent(
  config: Config,
  allowed: SkillPermissions,
): void {
  config.agent ??= {}

  if (config.agent[SUPERPOWERS_AGENT]) {
    /** Не перезаписываем пользовательского agent с конфликтующим именем. */
    throw new Error(
      `[superpowers-agent] agent "${SUPERPOWERS_AGENT}" already exists`,
    )
  }

  config.agent[SUPERPOWERS_AGENT] = {
    mode: "primary",
    description: "OpenCode with the full Superpowers workflow",
    permission: {
      skill: allowed,
    },
  }
}


/**
 * Определяет agent, выбранный для текущего model call.
 *
 * OpenCode hook `experimental.chat.messages.transform` сейчас не передаёт имя
 * agent отдельным аргументом. Зато user-message metadata содержит `agent`.
 * Последний user message соответствует текущему шагу, поэтому идём с конца.
 */
function currentAgent(messages: Messages): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const info = messages[index].info

    if (info.role === "user") {
      return info.agent
    }
  }

  return undefined
}


/**
 * Главная plugin factory-функция OpenCode.
 *
 * OpenCode вызывает её один раз при загрузке plugin и передаёт:
 *
 * `input`
 *   runtime context OpenCode plugin (client, directory и т.п.). Мы передаём
 *   тот же объект upstream Superpowers plugin, чтобы он инициализировался так,
 *   как если бы OpenCode загрузил его напрямую.
 *
 * `rawOptions`
 *   options из записи plugin в OpenCode config.
 *
 * Результат функции — object hook-ов, которые OpenCode затем вызывает на
 * соответствующих стадиях lifecycle.
 */
export const SuperpowersAgentPlugin: Plugin = async (
  input,
  rawOptions,
) => {
  const options = parseOptions(rawOptions)

  /**
   * Инициализируем upstream plugin как библиотеку.
   *
   * Важно: мы НЕ возвращаем его hooks OpenCode напрямую. `upstream` — просто
   * обычный JS object с callbacks. Ни один upstream hook не выполнится, пока
   * этот wrapper явно его не вызовет.
   */
  const upstream = await UpstreamSuperpowersPlugin(input)

  const dir = skillsDir()

  if (!existsSync(dir)) {
    throw new Error(
      `[superpowers-agent] Superpowers skills directory not found: ${dir}`,
    )
  }

  /**
   * Наш собственный discovery нужен только для permissions. Само содержимое
   * skills и bootstrap остаётся ответственностью upstream plugin/OpenCode.
   */
  const skills = discoverSkills(dir)
  const uniqueSkills = [...new Set(skills)]

  if (!uniqueSkills.length) {
    throw new Error(
      `[superpowers-agent] no Superpowers skills found in ${dir}`,
    )
  }

  if (uniqueSkills.length !== skills.length) {
    /** Два SKILL.md с одним `name` сделали бы permission mapping неоднозначным. */
    throw new Error(
      "[superpowers-agent] duplicate Superpowers skill names found",
    )
  }

  if (!uniqueSkills.includes(POLICY_SKILL)) {
    /** Без upstream policy skill невозможно получить полный Superpowers mode. */
    throw new Error(
      `[superpowers-agent] required skill "${POLICY_SKILL}" not found`,
    )
  }

  /** Все upstream skills кроме policy являются обычными capabilities. */
  const capabilities =
    uniqueSkills.filter((name) => name !== POLICY_SKILL)

  /**
   * Baseline: Superpowers skills запрещены всем агентам.
   * Это позволяет не знать полный registry OpenCode agents.
   */
  const denied =
    permissions(uniqueSkills, "deny")

  /**
   * Для enabled agents разрешаем capabilities, но `using-superpowers` оставляем
   * deny: upstream transform уже inject-ит этот policy в context, повторная
   * загрузка через native `skill` tool не нужна.
   */
  const enabled: SkillPermissions = {
    ...permissions(capabilities, "allow"),
    [POLICY_SKILL]: "deny",
  }

  /**
   * Одно и то же множество используется для access-control и bootstrap scope.
   * Это исключает состояние "skills разрешены, но bootstrap не включён".
   */
  const enabledAgents = new Set([
    ...options.agents,
    SUPERPOWERS_AGENT,
  ])

  return {
    /**
     * OpenCode `config` hook вызывается во время построения runtime config.
     * Callback мутирует переданный `config` object in-place.
     */
    config: async (config) => {
      /**
       * Делегируем upstream его собственную регистрацию skills path.
       *
       * Upstream знает собственный package layout и добавляет свой `skills/`
       * в `config.skills.paths`. Из-за известного OpenCode lifecycle bug этот
       * путь иногда приходится дополнительно прописывать статически; это
       * workaround из README, а не логика этого wrapper-а.
       */
      await upstream.config?.(config)

      /** После upstream config накладываем наш access-control. */
      denyGlobally(config, denied)

      /**
       * Перебираем только explicit allowlist пользователя. Все остальные agents
       * автоматически остаются под global deny.
       */
      for (const agent of options.agents) {
        enableAgent(config, agent, enabled)
      }

      /** Наш generated agent получает те же permissions, что custom enabled. */
      createSuperpowersAgent(config, enabled)
    },

    /**
     * Experimental OpenCode hook вызывается непосредственно перед model call и
     * позволяет изменить набор сообщений, отправляемых модели.
     *
     * Сам bootstrap мы не строим и не копируем: если текущий agent разрешён,
     * просто вызываем оригинальный upstream transform.
     */
    "experimental.chat.messages.transform":
      async (hookInput, output) => {
        const agent = currentAgent(output.messages)

        if (!agent || !enabledAgents.has(agent)) {
          return
        }

        /**
         * Optional chaining на method call (`?.(...)`) нужен потому, что hook в
         * типе plugin interface optional. Если будущая upstream версия его не
         * вернёт, выражение безопасно ничего не вызовет.
         *
         * Пока hook существует, upstream полностью контролирует:
         * - чтение `using-superpowers`;
         * - оригинальный prompt/wrapper;
         * - OpenCode tool mapping;
         * - duplicate protection/caching;
         * - фактическую mutation messages.
         */
        await upstream["experimental.chat.messages.transform"]?.(
          hookInput,
          output,
        )
      },
  }
}
