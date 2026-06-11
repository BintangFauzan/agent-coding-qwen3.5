import { readFileSync, accessSync } from "fs";
import { resolvePath, validatePath } from "../workspace";
import { z } from "zod";
const ReadMultipleFilesArgsSchema = z.object({
    paths: z
        .array(z.string().min(1))
        .min(1)
        .max(4)
        .describe("Array of file paths to read, maximum 4 files"),
});
const MAX_LINES_PER_FILE = 100;
export async function readMultipleFilesTool(args) {
    const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
    if (!parsed.success) {
        return {
            toolName: "readMultipleFiles",
            success: false,
            output: "Invalid arguments: " +
                parsed.error.errors.map((e) => e.message).join(", "),
        };
    }
    const results = [];
    const errors = [];
    for (const filePath of parsed.data.paths) {
        const resolved = resolvePath(filePath);
        try {
            validatePath(resolved);
            accessSync(resolved);
            const allLines = readFileSync(resolved, "utf-8").split("\n");
            const totalLines = allLines.length;
            const truncated = totalLines > MAX_LINES_PER_FILE;
            const lines = truncated
                ? allLines.slice(0, MAX_LINES_PER_FILE)
                : allLines;
            const width = String(totalLines).length;
            const numbered = lines
                .map((line, i) => `${String(i + 1).padStart(width, " ")} | ${line}`)
                .join("\n");
            const note = truncated
                ? `\n... (truncated: showing ${MAX_LINES_PER_FILE}/${totalLines} lines — use readFile with startLine/endLine for more)`
                : "";
            results.push(`=== ${filePath} (${totalLines} lines) ===\n${numbered}${note}`);
        }
        catch {
            errors.push(`- ${filePath}: file not found or inaccessible`);
        }
    }
    const errorBlock = errors.length > 0 ? `\nFailed to read:\n${errors.join("\n")}` : "";
    return {
        toolName: "readMultipleFiles",
        success: results.length > 0,
        output: `Read ${results.length}/${parsed.data.paths.length} files:\n\n` +
            results.join("\n\n") +
            errorBlock,
    };
}
