import { z } from "zod";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  output: string;
}

export const ReadFileArgsSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

export const EditFileArgsSchema = z.object({
  path: z.string().min(1),
  oldString: z.string().min(1),
  newString: z.string(),
});

export const WriteFileArgsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const RunCommandArgsSchema = z.object({
  command: z.string().min(1),
});

export const ListFilesArgsSchema = z.object({
  directory: z.string().default("."),
  maxDepth: z.number().int().min(1).max(10).optional().default(4),
});

export const ReadMultipleFilesArgsSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(4),
});
