import type {
  AgentConfig,
  PermissionActionConfig,
  PermissionConfig,
} from "@opencode-ai/sdk/v2"

type RuntimePermissionConfig = Exclude<
  PermissionConfig,
  PermissionActionConfig
>

const validPermission = {
  skill: {
    brainstorming: "allow",
    "using-superpowers": "deny",
  },
} satisfies RuntimePermissionConfig

const validAgent = {
  mode: "primary",
  permission: validPermission,
} satisfies AgentConfig

void validAgent

const invalidPermissionAction = {
  // @ts-expect-error OpenCode permission actions are allow, ask, or deny.
  skill: { brainstorming: "permit" },
} satisfies RuntimePermissionConfig

const malformedSkillPermission = {
  // @ts-expect-error Skill permissions are an action or pattern/action map.
  skill: ["allow"],
} satisfies RuntimePermissionConfig

void invalidPermissionAction
void malformedSkillPermission
