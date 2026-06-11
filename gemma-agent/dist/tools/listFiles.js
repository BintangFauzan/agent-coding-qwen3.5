import { ListFilesArgsSchema } from "../types";
import { readdirSync, statSync, lstatSync } from "fs";
import { join } from "path";
import { resolvePath, validatePath } from "../workspace";
const EXCLUDED = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
]);
function isDir(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
function isSymlinkDir(path) {
    try {
        return lstatSync(path).isSymbolicLink();
    }
    catch {
        return false;
    }
}
function buildTree(dir, baseName, depth) {
    if (depth === 0) {
        return [];
    }
    const lines = [];
    const entries = readdirSync(dir, { withFileTypes: true });
    const dirs = [];
    const files = [];
    for (const entry of entries) {
        if (EXCLUDED.has(entry.name))
            continue;
        if (entry.name.startsWith(".") && entry.name !== ".env")
            continue;
        if (entry.isDirectory()) {
            dirs.push(entry);
        }
        else {
            files.push(entry);
        }
    }
    const sorted = [...dirs, ...files];
    for (const entry of sorted) {
        const isDirectory = entry.isDirectory() || isSymlinkDir(join(dir, entry.name));
        if (isDirectory) {
            lines.push(`  ├── ${entry.name}/`);
            const childLines = buildTree(join(dir, entry.name), `${baseName}/${entry.name}`, depth - 1);
            if (childLines.length > 0) {
                for (const childLine of childLines) {
                    lines.push("  │   " + childLine);
                }
            }
        }
        else {
            lines.push(`  ├── ${entry.name}`);
        }
    }
    return lines;
}
export async function listFilesTool(args) {
    const parsed = ListFilesArgsSchema.safeParse(args);
    if (!parsed.success) {
        return {
            toolName: "listFiles",
            success: false,
            output: "Invalid arguments: " +
                parsed.error.errors.map((e) => e.message).join(", "),
        };
    }
    const relDir = parsed.data.directory === "." ? "." : parsed.data.directory;
    const dir = resolvePath(relDir);
    try {
        validatePath(dir);
    }
    catch {
        return {
            toolName: "listFiles",
            success: false,
            output: `Invalid directory: ${relDir}`,
        };
    }
    if (!isDir(dir) && !isSymlinkDir(dir)) {
        return {
            toolName: "listFiles",
            success: false,
            output: `Not a directory: ${parsed.data.directory}`,
        };
    }
    try {
        const maxDepth = parsed.data.maxDepth ?? 4;
        const lines = [relDir ? `${relDir}/` : "."];
        const treeLines = buildTree(dir, "", maxDepth);
        lines.push(...treeLines);
        return {
            toolName: "listFiles",
            success: true,
            output: lines.join("\n"),
        };
    }
    catch (e) {
        return {
            toolName: "listFiles",
            success: false,
            output: `Error listing directory '${parsed.data.directory}': ${e}`,
        };
    }
}
