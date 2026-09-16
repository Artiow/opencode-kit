import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import { access, constants as fsConstants } from "node:fs/promises"

type ErrorStatus =
  | "INVALID_REPOSITORY"
  | "INVALID_WORKTREE"
  | "INVALID_ARGUMENT"
  | "REMOTE_NOT_FOUND"
  | "BRANCH_NOT_FOUND"
  | "REBASE_CONFLICT"
  | "OPERATION_FAILED"

type CommandResult = {
  code: number
  stdout: string
  stderr: string
}

function gitOutput(result: CommandResult): string {
  const output = (result.stderr || result.stdout).replace(/\s+/g, " ").trim()
  return output || `git exited with code ${result.code}`
}

function successResult(baseBranch: string, featureBranch: string): string {
  return JSON.stringify({
    ok: true,
    status: "SUCCESS",
    baseBranch,
    featureBranch,
    message: `Successfully fetched origin, aligned local base branch '${baseBranch}' to origin/${baseBranch}, rebased '${featureBranch}' onto '${baseBranch}', and pushed '${featureBranch}' to origin with --force-with-lease. The tool intentionally remains on '${featureBranch}'.`,
  })
}

function errorResult(
  status: ErrorStatus,
  baseBranch: string,
  featureBranch: string,
  message: string
): string {
  return JSON.stringify({
    ok: false,
    status,
    baseBranch,
    featureBranch,
    message,
  })
}

function runGit(worktree: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve: (result: CommandResult) => void) => {
    const childProcess = spawn("git", args, { cwd: worktree, stdio: ["ignore", "pipe", "pipe"] })

    let stdout = ""
    let stderr = ""

    childProcess.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })

    childProcess.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })

    childProcess.on("error", (error) => {
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` })
    })

    childProcess.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

async function refExists(worktree: string, ref: string): Promise<boolean> {
  const result = await runGit(worktree, ["rev-parse", "--verify", "--quiet", ref])
  return result.code === 0
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function hasOngoingRebase(worktree: string): Promise<boolean> {
  if (await refExists(worktree, "REBASE_HEAD")) {
    return true
  }

  const rebaseMergePath = await runGit(worktree, ["rev-parse", "--git-path", "rebase-merge"])
  if (rebaseMergePath.code === 0 && rebaseMergePath.stdout.trim() && (await pathExists(rebaseMergePath.stdout.trim()))) {
    return true
  }

  const rebaseApplyPath = await runGit(worktree, ["rev-parse", "--git-path", "rebase-apply"])
  if (rebaseApplyPath.code === 0 && rebaseApplyPath.stdout.trim() && (await pathExists(rebaseApplyPath.stdout.trim()))) {
    return true
  }

  return false
}

async function hasUnmergedConflicts(worktree: string): Promise<boolean> {
  const result = await runGit(worktree, ["diff", "--name-only", "--diff-filter=U"])
  if (result.code !== 0) {
    return false
  }
  return result.stdout.trim().length > 0
}

export default tool({
  description:
    "Rebase a feature branch onto a base branch and update the remote feature branch. " +
    "Use this tool instead of manual git fetch/checkout/rebase/push commands when the user asks to update, sync, or rebase a feature branch onto a base branch, " +
    "including requests like 'update current branch', 'sync my branch with main', or 'rebase onto main'. " +
    "Prefer this over manual git fetch/checkout/rebase/push commands. " +
    "Pass explicit `baseBranch` and `featureBranch`; if the user refers to the current branch, resolve it first and pass it as `featureBranch`. " +
    "Requires a clean worktree. Does not infer branch names or resolve conflicts.",
  args: {
    baseBranch: tool.schema.string().describe("Base branch to rebase onto"),
    featureBranch: tool.schema.string().describe("Feature branch to rebase and push"),
  },
  async execute(args, context) {
    const baseBranch = args.baseBranch.trim()
    const featureBranch = args.featureBranch.trim()
    const worktree = context.worktree || context.directory

    if (!worktree || !baseBranch || !featureBranch) {
      return errorResult(
        "INVALID_ARGUMENT",
        baseBranch,
        featureBranch,
        "Invalid arguments: baseBranch and featureBranch must be non-empty strings."
      )
    }

    if (baseBranch === featureBranch) {
      return errorResult(
        "INVALID_ARGUMENT",
        baseBranch,
        featureBranch,
        "Invalid arguments: baseBranch and featureBranch must be different."
      )
    }

    const isGitRepo = await runGit(worktree, ["rev-parse", "--is-inside-work-tree"])
    if (isGitRepo.code !== 0 || isGitRepo.stdout.trim() !== "true") {
      return errorResult(
        "INVALID_REPOSITORY",
        baseBranch,
        featureBranch,
        "The provided worktree is not inside a git repository, so git-rebase cannot run."
      )
    }

    const unstagedDiff = await runGit(worktree, ["diff", "--quiet"])
    if (unstagedDiff.code === 1) {
      return errorResult(
        "INVALID_WORKTREE",
        baseBranch,
        featureBranch,
        "The worktree is not clean: unstaged changes are present. Commit or stash them before running git-rebase."
      )
    }

    const stagedDiff = await runGit(worktree, ["diff", "--cached", "--quiet"])
    if (stagedDiff.code === 1) {
      return errorResult(
        "INVALID_WORKTREE",
        baseBranch,
        featureBranch,
        "The worktree is not clean: staged but uncommitted changes are present. Commit or stash them before running git-rebase."
      )
    }

    if (
      (await refExists(worktree, "MERGE_HEAD")) ||
      (await refExists(worktree, "CHERRY_PICK_HEAD")) ||
      (await hasOngoingRebase(worktree))
    ) {
      return errorResult(
        "INVALID_WORKTREE",
        baseBranch,
        featureBranch,
        "The repository has an unfinished merge, rebase, or cherry-pick. Finish or abort that operation before running git-rebase."
      )
    }

    const hasOriginRemote = await runGit(worktree, ["remote", "get-url", "origin"])
    if (hasOriginRemote.code !== 0) {
      return errorResult(
        "REMOTE_NOT_FOUND",
        baseBranch,
        featureBranch,
        "Remote 'origin' is not configured in this repository, so the tool cannot fetch or push."
      )
    }

    const featureExists = await refExists(worktree, `refs/heads/${featureBranch}`)
    if (!featureExists) {
      return errorResult(
        "BRANCH_NOT_FOUND",
        baseBranch,
        featureBranch,
        `Feature branch '${featureBranch}' was not found locally. The tool only rebases an existing local feature branch.`
      )
    }

    const fetchResult = await runGit(worktree, ["fetch", "origin"])
    if (fetchResult.code !== 0) {
      return errorResult(
        "OPERATION_FAILED",
        baseBranch,
        featureBranch,
        `Failed to fetch from origin before rebasing '${featureBranch}' onto '${baseBranch}'. Git output: ${gitOutput(fetchResult)}`
      )
    }

    const baseExistsOnOrigin = await refExists(worktree, `refs/remotes/origin/${baseBranch}`)
    if (!baseExistsOnOrigin) {
      return errorResult(
        "BRANCH_NOT_FOUND",
        baseBranch,
        featureBranch,
        `Base branch '${baseBranch}' was not found on origin. The tool aligns the local base branch from origin/${baseBranch}, so that remote branch must exist.`
      )
    }

    // Git cannot force-update the currently checked-out branch. Detaching keeps
    // the worktree clean while allowing the local base ref to mirror origin.
    const currentBranch = await runGit(worktree, ["symbolic-ref", "--short", "-q", "HEAD"])
    if (currentBranch.code === 0 && currentBranch.stdout.trim() === baseBranch) {
      const detachResult = await runGit(worktree, ["checkout", "--detach"])
      if (detachResult.code !== 0) {
        return errorResult(
          "OPERATION_FAILED",
          baseBranch,
          featureBranch,
          `Failed to detach HEAD before updating local base branch '${baseBranch}'. Git output: ${gitOutput(detachResult)}`
        )
      }
    }

    // The local base is an input mirror, not user work to merge: rebasing onto
    // the fetched remote tip avoids incorporating stale local-only commits.
    const alignBase = await runGit(worktree, ["branch", "-f", baseBranch, `origin/${baseBranch}`])
    if (alignBase.code !== 0) {
      return errorResult(
        "OPERATION_FAILED",
        baseBranch,
        featureBranch,
        `Failed to align local base branch '${baseBranch}' to origin/${baseBranch}. Git output: ${gitOutput(alignBase)}`
      )
    }

    const checkoutFeature = await runGit(worktree, ["checkout", featureBranch])
    if (checkoutFeature.code !== 0) {
      return errorResult(
        "OPERATION_FAILED",
        baseBranch,
        featureBranch,
        `Failed to check out feature branch '${featureBranch}'. Git output: ${gitOutput(checkoutFeature)}`
      )
    }

    const rebaseResult = await runGit(worktree, ["rebase", baseBranch])
    if (rebaseResult.code !== 0) {
      const rebaseConflict = (await hasUnmergedConflicts(worktree)) || (await hasOngoingRebase(worktree))
      if (rebaseConflict) {
        // Preserve Git's conflict state for deliberate manual resolution; an
        // automatic abort or guessed resolution could discard user work.
        return errorResult(
          "REBASE_CONFLICT",
          baseBranch,
          featureBranch,
          `Rebase of '${featureBranch}' onto '${baseBranch}' stopped because git reported conflicts. Resolve conflicts manually; this tool does not continue, abort, or resolve rebases automatically.`
        )
      }

      return errorResult(
        "OPERATION_FAILED",
        baseBranch,
        featureBranch,
        `Rebase of '${featureBranch}' onto '${baseBranch}' failed without a detected conflict state. Git output: ${gitOutput(rebaseResult)}`
      )
    }

    // Rebase rewrites history. The lease permits that update but rejects the
    // push if origin changed since fetch, protecting concurrent remote work.
    const pushResult = await runGit(worktree, ["push", "--force-with-lease", "origin", featureBranch])
    if (pushResult.code !== 0) {
      return errorResult(
        "OPERATION_FAILED",
        baseBranch,
        featureBranch,
        `Failed to push '${featureBranch}' to origin with --force-with-lease after rebase. Git output: ${gitOutput(pushResult)}`
      )
    }

    return successResult(baseBranch, featureBranch)
  },
})
