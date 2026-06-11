import { EditFileArgsSchema } from "../types";
import { readFileSync, writeFileSync } from "fs";
import { resolvePath, validatePath } from "../workspace";
export async function editFileTool(args) {
    const parsed = EditFileArgsSchema.safeParse(args);
    if (!parsed.success) {
        return {
            toolName: "editFile",
            success: false,
            output: "Invalid arguments: " +
                parsed.error.errors.map((e) => e.message).join(", "),
        };
    }
    const filePath = resolvePath(parsed.data.path);
    try {
        validatePath(filePath);
        const content = readFileSync(filePath, "utf-8");
        const oldStr = parsed.data.oldString;
        const newStr = parsed.data.newString ?? "";
        const normalizedContent = content.replace(/\r\n/g, "\n");
        const normalizedOld = oldStr.replace(/\r\n/g, "\n");
        const occurrences = countOccurrences(normalizedContent, normalizedOld);
        if (occurrences === 0) {
            return {
                toolName: "editFile",
                success: false,
                output: "String not found. Tip: Use readFile first.",
            };
        }
        if (occurrences > 1) {
            return {
                toolName: "editFile",
                success: false,
                output: `String found ${occurrences} times — must be unique.`,
            };
        }
        const oldLines = oldStr.split("\n").length;
        const newLines = newStr.split("\n").length;
        let updated = normalizedContent.replace(normalizedOld, newStr);
        if (content.includes("\r\n")) {
            updated = updated.replace(/\n/g, "\r\n");
        }
        writeFileSync(filePath, updated, "utf-8");
        return {
            toolName: "editFile",
            success: true,
            output: `Edited ${parsed.data.path} (+${newLines}, -${oldLines})`,
        };
    }
    catch (e) {
        return {
            toolName: "editFile",
            success: false,
            output: `Failed to edit file: ${e.message}`,
        };
    }
}
function countOccurrences(haystack, needle) {
    if (needle.length === 0)
        return 0;
    let count = 0;
    let pos = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
        count++;
        pos += needle.length;
    }
    return count;
}
