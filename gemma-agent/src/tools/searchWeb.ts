import type { ToolResult } from "../types";
import { z } from "zod";

export const SearchWebArgsSchema = z.object({
  query: z.string().min(1),
});

const OLLAMA_API_KEY = "f63de65250744fa1b0257270747d0783.Zz7lnW-JsFs4hnfQFfB0RKTs";

const MAX_RESULTS = 5;
const MAX_CONTENT_LENGTH = 1500;

function cleanAndTruncate(text: string): string {
  if (!text) return "";

  let cleaned = text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\[.*?\]\(.*?\)/g, "")
    // .replace(/#{1,6}\s/g, "") // Keep headers for context
    // .replace(/\*{1,2}(.*?)\*{1,2}/g, "$1") // Keep emphasis
    // .replace(/`{1,3}.*?`{1,3}/g, "") // DO NOT remove code blocks
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length > MAX_CONTENT_LENGTH) {
    cleaned = cleaned.slice(0, MAX_CONTENT_LENGTH).trim();
    const lastSpace = cleaned.lastIndexOf(" ");
    if (lastSpace > MAX_CONTENT_LENGTH * 0.8) {
      cleaned = cleaned.slice(0, lastSpace);
    }
    cleaned += " (truncated...)";
  }

  return cleaned;
}

export async function searchWebTool(args: unknown): Promise<ToolResult> {
  const parsed = SearchWebArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      toolName: "searchWeb",
      success: false,
      output:
        "Invalid arguments: " +
        parsed.error.errors.map((e) => e.message).join(", "),
    };
  }

  const query = parsed.data.query;

  try {
    const response = await fetch("https://ollama.com/api/web_search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OLLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        max_results: MAX_RESULTS,
      }),
    });

    if (!response.ok) {
      return {
        toolName: "searchWeb",
        success: false,
        output: `Search request failed: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };

    if (!data.results || data.results.length === 0) {
      return {
        toolName: "searchWeb",
        success: true,
        output: `No results found for: "${query}"`,
      };
    }

    const topResults = data.results.slice(0, MAX_RESULTS);

    const formatted = topResults
      .map((r, i) => {
        const title = (r.title ?? "No title").replace(/<[^>]+>/g, "").trim();
        const content = cleanAndTruncate(r.content ?? "");

        const parts = [`[${i + 1}] ${title}`];
        if (content) parts.push(content);

        return parts.join("\n");
      })
      .join("\n\n");

    return {
      toolName: "searchWeb",
      success: true,
      output: `Search results for "${query}":\n\n${formatted}`,
    };
  } catch (err) {
    return {
      toolName: "searchWeb",
      success: false,
      output: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
