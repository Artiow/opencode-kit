import { execFile } from "node:child_process"

import { tool } from "@opencode-ai/plugin/tool"

const backupEntrySchema = tool.schema.object({
    ref: tool.schema.string().describe("Already selected full ref under refs/heads/bak/"),
    old_tip: tool.schema.string().nullable().describe("Observed old OID; null means create only if absent"),
})

export default tool({
    description: "Atomically write an already selected source/target backup pair and verify it. No name selection, fallback or retry.",
    args: {
        source_ref: tool.schema.string(),
        source_tip: tool.schema.string(),
        target_ref: tool.schema.string(),
        target_tip: tool.schema.string(),
        backups: tool.schema.array(backupEntrySchema).length(2).describe("Exactly two entries: source backup first, target backup second"),
    },
    async execute(args, context) {
        let phase = "validate"
        let writeState: "not_started" | "unknown" | "committed" = "not_started"
        const steps: { operation: string; duration_ms: number; ok: boolean }[] = []
        const refs = [args.source_ref, args.target_ref, ...args.backups.map(({ ref }) => ref)]
        const tips = [args.source_tip, args.target_tip]

        async function git(argv: string[], input?: string): Promise<string> {
            context.abort.throwIfAborted()
            require(args.backups.length === 2, "Exactly two backup entries are required")
            const start = Date.now()
            return new Promise((resolve, reject) => {
                const child = execFile("git", argv, { cwd: context.directory, signal: context.abort, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
                    steps.push({ operation: argv[0], duration_ms: Date.now() - start, ok: !error })
                    if (!error) {
                        resolve(stdout.trim())
                    } else {
                        reject(new Error(stderr.trim() || error.message))
                    }
                })
                // Git can reject the transaction before consuming all of stdin.
                child.stdin?.on("error", () => {})
                child.stdin?.end(input)
            })
        }

        function require(condition: boolean, reason: string): void {
            if (!condition) throw new Error(reason)
        }

        try {
            context.abort.throwIfAborted()
            require(refs.every((ref) => ref.startsWith("refs/heads/") && !/[\s\0]/.test(ref)), "Use full local branch refs without whitespace")
            require(new Set(refs).size === 4, "Working and backup refs must all be distinct")
            require(args.backups.every(({ ref }) => ref.startsWith("refs/heads/bak/")), "Backups must be under refs/heads/bak/")
            require(
                [...tips, ...args.backups.flatMap(({ old_tip }) => old_tip === null ? [] : [old_tip])].every((tip) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(tip) && !/^0+$/.test(tip)),
                "Use full nonzero object IDs"
            )

            phase = "authorize"
            await context.ask({
                permission: "git-backup-pair", patterns: args.backups.map(({ ref }) => ref),
                always: ["*"], metadata: { source_ref: args.source_ref, target_ref: args.target_ref },
            })

            phase = "inspect"
            for (const ref of refs) {
                await git(["check-ref-format", ref])
            }
            const observed = new Map(
                (await git(["for-each-ref", "--format=%(refname) %(objectname) %(symref)", ...refs]))
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => {
                        const [ref, tip, symbolic] = line.split(" ")
                        return [ref, { tip, symbolic }] as const
                    })
            )
            for (const ref of refs) {
                require(!observed.get(ref)?.symbolic, `Symbolic ref is not supported: ${ref}`)
            }
            require(observed.get(args.source_ref)?.tip === args.source_tip, "Source tip changed or is missing")
            require(observed.get(args.target_ref)?.tip === args.target_tip, "Target tip changed or is missing")
            for (const [index, backup] of args.backups.entries()) {
                require((observed.get(backup.ref)?.tip ?? null) === backup.old_tip, `Backup old value changed: ${backup.ref}`)
                if (backup.old_tip !== null) {
                    await git(["merge-base", "--is-ancestor", backup.old_tip, tips[index]])
                }
            }

            const transaction = [
                "start",
                `verify ${args.source_ref} ${args.source_tip}`,
                `verify ${args.target_ref} ${args.target_tip}`,
                ...args.backups.map(
                    ({ ref, old_tip }, index) => old_tip === null
                        ? `create ${ref} ${tips[index]}`
                        : `update ${ref} ${tips[index]} ${old_tip}`
                ),
                "prepare",
                "commit"
            ]

            phase = "transaction"
            context.abort.throwIfAborted()
            // Once started, cancellation/transport failure cannot prove no write occurred.
            writeState = "unknown"
            await git(["update-ref", "--no-deref", "--stdin"], transaction.join("\n") + "\n")
            writeState = "committed"

            phase = "verify"
            const actual = (await git(["rev-parse", ...args.backups.map(({ ref }) => ref)])).split("\n")
            require(actual.length === 2 && actual.every((tip, index) => tip === tips[index]), "Backup readback differs from recorded tips")
            return {
                output: JSON.stringify({
                    status: "ok",
                    phase,
                    write_state: writeState,
                    backups: args.backups.map(({ ref }, index) => ({ ref, tip: actual[index] })),
                }),
                metadata: { steps },
            }
        } catch (error) {
            const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
            return {
                output: JSON.stringify({
                    status: "error",
                    phase,
                    write_state: writeState,
                    error: errorMessage.length > 2000 ? `${errorMessage.slice(0, 1999)}…` : errorMessage,
                    backups: args.backups.map(({ ref }) => ref),
                }),
                metadata: { steps },
            }
        }
    },
})
