import { WriteFileArgsSchema } from "../types";
import type { ToolResult } from "../types";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { resolvePath, validatePath } from "../workspace";

export async function writeFileTool(args: unknown): Promise<ToolResult> {
  const parsed = WriteFileArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      toolName: "writeFile",
      success: false,
      output:
        "Invalid arguments: " +
        parsed.error.errors.map((e) => e.message).join(", "),
    };
  }

  const filePath = resolvePath(parsed.data.path);
  try {
    validatePath(filePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, parsed.data.content, "utf-8");
    return {
      toolName: "writeFile",
      success: true,
      output: `File written: ${parsed.data.path} (${Buffer.byteLength(parsed.data.content, "utf-8")} bytes)`,
    };
  } catch (e) {
    return {
      toolName: "writeFile",
      success: false,
      output: `Failed to write file: ${e.message}`,
    };
  }
}
