import { RunCommandArgsSchema } from "../types";
import { execSync } from "child_process";
import { getWorkspaceRoot } from "../workspace";
export async function runCommandTool(args) {
    const parsed = RunCommandArgsSchema.safeParse(args);
    if (!parsed.success) {
        return {
            toolName: "runCommand",
            success: false,
            output: "Invalid arguments: " +
                parsed.error.errors.map((e) => e.message).join(", "),
        };
    }
    const command = parsed.data.command;
    const TIMEOUT_MS = 30_000;
    const MAX_LINES = 200;
    try {
        const raw = execSync(command, {
            encoding: "utf-8",
            timeout: TIMEOUT_MS,
            killSignal: "SIGKILL",
            cwd: getWorkspaceRoot(),
            maxBuffer: 10 ** 7,
        });
        const lines = raw.split("\n").slice(0, 200);
        return {
            toolName: "runCommand",
            success: true,
            output: `Exit 0\n${lines.join("\n")}`,
        };
    }
    catch (e) {
        const raw = e.stdout ?? e.stderr ?? String(e);
        const lines = raw.split("\n").slice(0, 200);
        const statusCode = e.status ?? 1;
        return {
            toolName: "runCommand",
            success: false,
            output: `Exit ${statusCode}\n${lines.join("\n")}`,
        };
    }
}
