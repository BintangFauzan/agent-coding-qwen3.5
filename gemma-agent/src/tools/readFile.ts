import { ReadFileArgsSchema } from "../types";
import type { ToolResult } from "../types";
import { readFileSync, accessSync } from "fs";
import { resolvePath, validatePath } from "../workspace";

export async function readFileTool(args: unknown): Promise<ToolResult> {
  const parsed = ReadFileArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      toolName: "readFile",
      success: false,
      output:
        "Invalid arguments: " +
        parsed.error.errors.map((e) => e.message).join(", "),
    };
  }

  const filePath = resolvePath(parsed.data.path);
  try {
    validatePath(filePath);
    accessSync(filePath);
    const allLines = readFileSync(filePath, "utf-8").split("\n");
    const totalLines = allLines.length;

    const startLine = parsed.data.startLine;
    const endLine = parsed.data.endLine;

    let sliceStart = 0;
    let sliceEnd = totalLines;
    let header = "";

    if (startLine !== undefined && startLine > totalLines) {
      return {
        toolName: "readFile",
        success: false,
        output: `startLine ${startLine} exceeds file length ${totalLines}`,
      };
    }

    if (startLine !== undefined && endLine !== undefined) {
      if (startLine > endLine) {
        return {
          toolName: "readFile",
          success: false,
          output: "startLine cannot be greater than endLine",
        };
      }
      sliceStart = startLine - 1;
      sliceEnd = endLine;
      header = `Read lines ${startLine}-${Math.min(endLine, totalLines)} of ${totalLines} from ${parsed.data.path}`;
    } else if (startLine !== undefined) {
      sliceStart = startLine - 1;
      sliceEnd = totalLines;
      header = `Read lines ${startLine}-${totalLines} of ${totalLines} from ${parsed.data.path}`;
    } else {
      header = `Read ${totalLines} lines from ${parsed.data.path}`;
    }

    let lines = allLines.slice(sliceStart, sliceEnd);
    const MAX_LINES = 500;
    const truncated = lines.length > MAX_LINES;
    if (truncated) {
      lines = lines.slice(0, MAX_LINES);
    }

    const width = String(totalLines).length;
    const numbered = lines
      .map((line, i) => `${String(sliceStart + i + 1).padStart(width, " ")} | ${line}`)
      .join("\n");

    const truncationNote = truncated
      ? `\n... (truncated to ${MAX_LINES} lines)`
      : "";

    return {
      toolName: "readFile",
      success: true,
      output: `${header}\n\n${numbered}${truncationNote}`,
    };
  } catch (e) {
    return {
      toolName: "readFile",
      success: false,
      output: `File not found or inaccessible: ${parsed.data.path}`,
    };
  }
}
