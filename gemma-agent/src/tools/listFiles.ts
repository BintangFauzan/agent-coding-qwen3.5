import { ListFilesArgsSchema } from "../types";
import type { ToolResult } from "../types";
import { readdirSync, statSync, lstatSync } from "fs";
import { join } from "path";
import { resolvePath, validatePath } from "../workspace";

const EXCLUDED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
]);

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSymlinkDir(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export async function listFilesTool(args: unknown): Promise<ToolResult> {
  const parsed = ListFilesArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      toolName: "listFiles",
      success: false,
      output:
        "Invalid arguments: " +
        parsed.error.errors.map((e) => e.message).join(", "),
    };
  }

  const relDir = parsed.data.directory === "." ? "." : parsed.data.directory;
  const dir = resolvePath(relDir);
  if (!isDir(dir) && !isSymlinkDir(dir)) {
    return {
      toolName: "listFiles",
      success: false,
      output: `Not a directory: ${parsed.data.directory}`,
    };
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const depth = 2;
    const lines: string[] = [];

    function renderTree(name: string, d: number) {
      if (d > depth) return;
      const bracket = d === depth ? "" : d === 0 && !EXCLUDED.has(name) ? "├── " : `├── `;
      lines.push(`${" ".repeat(d * 4)}${name}${d < depth && isDir(join(dir, name)) ? "/" : ""}`);
    }

    if (depth >= 1) {
      lines.push(parsed.data.directory === "." ? "." : parsed.data.directory);
      for (const entry of entries) {
        if (EXCLUDED.has(entry.name)) continue;
        renderTree(entry.name, 1);
        if (entry.isDirectory() && depth >= 2) {
          try {
            for (const sub of readdirSync(join(dir, entry.name), {
              withFileTypes: true,
            })) {
              if (EXCLUDED.has(sub.name)) continue;
              renderTree(sub.name, 2);
            }
          } catch {
            lines.push(`". ${entry.name}/ (permission denied)`);
          }
        }
      }
    }

    return {
      toolName: "listFiles",
      success: true,
      output: lines.join("\n"),
    };
  } catch (e) {
    return {
      toolName: "listFiles",
      success: false,
      output: `Error listing directory '${parsed.data.directory}': ${e}`,
    };
  }
}
