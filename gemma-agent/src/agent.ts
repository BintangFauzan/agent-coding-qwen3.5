import { Ollama } from "ollama";
import { Message } from "./types";
import type { ToolResult } from "./types";
import { dispatchTool } from "./tools";
import { readFileSync } from "fs";
import { resolvePath } from "./workspace.js";

const MAX_ITERATIONS = 50;

const OLLAMA_CONFIG = {
  model: "qwen_3.5:latest",
  options: {
    temperature: 0.2,
    num_ctx: 32768,
  },
};

const C = {
  reset:   "\x1b[0m",
  dim:     "\x1b[2m",
  bold:    "\x1b[1m",
  green:   "\x1b[32m",
  red:     "\x1b[31m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  gray:    "\x1b[90m",
};

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "readFile",
      description:
        "Baca isi file dari workspace. Gunakan startLine dan endLine untuk membaca range baris tertentu — ini lebih efisien untuk file besar. Output selalu menyertakan nomor baris.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path file relatif ke workspace root",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "writeFile",
      description: "Tulis atau overwrite isi file di workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path file relatif ke workspace root",
          },
          content: {
            type: "string",
            description: "Konten yang akan ditulis ke file",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "editFile",
      description: "Edit bagian spesifik dari file dengan mencari string lama dan menggantinya dengan string baru. Lebih aman dari writeFile karena tidak menimpa seluruh file. WAJIB sertakan path, oldString, dan newString. SELALU gunakan readFile terlebih dahulu untuk mendapatkan string yang tepat sebelum mengedit.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "WAJIB. Path file yang akan diedit, relatif ke workspace root. Contoh: src/server.ts",
          },
          oldString: {
            type: "string",
            description: "String yang akan dicari dan diganti. Harus unik di dalam file — tambahkan baris konteks sekitar jika perlu. HARUS diambil dari hasil readFile, jangan mengarang.",
          },
          newString: {
            type: "string",
            description: "String pengganti. Boleh kosong string untuk menghapus oldString.",
          },
        },
        required: ["path", "oldString", "newString"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "runCommand",
      description:
        "Jalankan shell command di workspace. Gunakan untuk npm, git, atau command lain.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command yang akan dijalankan",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listFiles",
      description:
        "Tampilkan struktur folder dalam workspace. Gunakan ini PERTAMA KALI sebelum membaca file jika tidak tahu struktur proyek.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              "Direktori yang ingin di-list, relatif ke workspace root. Default: root workspace.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchWeb",
      description: "Search the web for documentation, solutions, or information. Use this when you cannot solve an error from code analysis alone — search for the error message or relevant technology documentation.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query. Be specific — include library name, error message, and version if known. Example: 'playwright launchPersistentContext SyntaxError non-null assertion JavaScript'",
          },
        },
        required: ["query"],
      },
    },
  },
];

const REQUIRES_CONFIRMATION = ["editFile", "writeFile", "runCommand"];

interface TodoItem {
  text: string;
  done: boolean;
  active: boolean;
  indent: number;
}

let currentTodos: TodoItem[] = [];
let sessionAutoConfirm = false;

let lastErrorMessage = "";
let consecutiveErrorCount = 0;
const ERROR_THRESHOLD = 3;

function buildPreview(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "editFile") {
    return (
      "  " +
      C.magenta +
      "✎" +
      C.reset +
      " editFile " +
      (args.path ?? "")
    );
  }
  if (toolName === "writeFile") {
    const bytes = Buffer.byteLength((args.content ?? "").toString(), "utf-8");
    const isNew = true;
    return (
      "  " +
      C.magenta +
      "✎" +
      C.reset +
      " writeFile " +
      (args.path ?? "") +
      "\n" +
      "    " +
      (isNew ? "Membuat file baru" : "Menimpa file") +
      " (" +
      bytes +
      " bytes)"
    );
  }
  if (toolName === "runCommand") {
    return (
      "  " +
      C.magenta +
      "✎" +
      C.reset +
      " runCommand\n" +
      "    $ " +
      (args.command ?? "")
    );
  }
  return "  " + C.magenta + "✎" + C.reset + " " + toolName;
}

function formatToolSuccess(result: ToolResult): string {
  const firstLine = result.output.split("\n")[0];
  const isEdit = result.toolName === "editFile";
  const isRun = result.toolName === "runCommand";
  if (isEdit) {
    const match = firstLine.match(/Edited .*? \(\+(\d+), -(\d+)\)/);
    if (match) {
      return (
        "  " +
        C.green +
        "✓" +
        C.reset +
        " " +
        result.toolName +
        " — Edited (+" +
        match[1] +
        ", -" +
        match[2] +
        ")"
      );
    }
  }
  if (isRun) {
    return (
      "  " +
      C.green +
      "✓" +
      C.reset +
      " " +
      result.toolName +
      " — " +
      firstLine.replace(/^.*?\-\s*/, "")
    );
  }
  if (result.toolName === "searchWeb") {
    const queryMatch = result.output.match(/Search results for "(.+?)"/s)
      || result.output.match(/No results found for: "(.+?)"/);
    const query = queryMatch ? queryMatch[1] : "unknown query";
    const displayQuery = query.length > 50
      ? query.slice(0, 47) + "..."
      : query;
    return (
      "  " + C.green + "✓" + C.reset +
      " searchWeb — " + displayQuery
    );
  }
  return (
    "  " +
    C.green +
    "✓" +
    C.reset +
    " " +
    result.toolName +
    " — " +
    firstLine
  );
}

function formatToolError(result: ToolResult): string {
  return (
    "  " +
    C.red +
    "✗" +
    C.reset +
    " " +
    result.toolName +
    " — " +
    result.output.split("\n")[0]
  );
}

function parseTodo(content: string, thinking: string = ""): TodoItem[] | null {
  // 1. Try explicit <todo> tag first (anywhere in content or thinking)
  const combined = content + "\n" + thinking;
  const match = combined.match(/<todo>([\s\S]*?)<\/todo>/i);
  
  if (match) {
    const lines = match[1].split("\n");
    const items: TodoItem[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const indentMatch = line.match(/^(\s*)/);
      const spaces = indentMatch ? indentMatch[1].length : 0;
      const indent = Math.floor(spaces / 4);
      const todoMatch = line.trim().match(/^\[([x•\s])\]\s+(.+)/i);
      if (todoMatch) {
        items.push({
          text: todoMatch[2],
          done: todoMatch[1].toLowerCase() === "x",
          active: todoMatch[1] === "•",
          indent,
        });
      } else {
        items.push({ text: line.trim(), done: false, active: false, indent });
      }
    }
    return items.length > 0 ? items : null;
  }

  // 2. Fallback: Look for numerical lists or bullet points in thinking if it looks like a plan
  const planKeywords = ["i need to:", "plan:", "steps:", "todo:", "task:"];
  const lowerThinking = thinking.toLowerCase();
  
  if (planKeywords.some(k => lowerThinking.includes(k))) {
    const lines = thinking.split("\n");
    const items: TodoItem[] = [];
    let capturing = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (planKeywords.some(k => trimmed.toLowerCase().startsWith(k))) {
        capturing = true;
        continue;
      }
      if (capturing) {
        const listMatch = trimmed.match(/^(\d+[\.\)]|[-*•])\s+(.+)/);
        if (listMatch) {
          items.push({ text: listMatch[2], done: false, active: false, indent: 0 });
        } else if (trimmed.length > 5 && !trimmed.includes("http")) {
          // Continue capturing if it looks like a step but no bullet
          if (items.length > 0) items.push({ text: trimmed, done: false, active: false, indent: 0 });
        } else if (trimmed === "" && items.length > 0) {
          break; // End of list
        }
      }
    }
    return items.length > 0 ? items : null;
  }

  return null;
}

function displayTodos(todos: TodoItem[]): void {
  if (todos.length === 0) return;

  console.log("\n  " + C.bold + C.blue + "Todo" + C.reset);

  for (const item of todos) {
    const pad = "  " + "    ".repeat(item.indent);

    if (item.done) {
      console.log(
        pad + C.green + "[✓]" + C.reset + " " + C.dim + item.text + C.reset
      );
    } else if (item.active) {
      console.log(
        pad + C.yellow + "[•]" + C.reset + " " + C.bold + item.text + C.reset
      );
    } else {
      console.log(pad + C.gray + "[ ]" + C.reset + " " + item.text);
    }
  }
  console.log();
}

let searchWebCallCount = 0;
const MAX_SEARCH_WEB_CALLS = 3;

export async function reactLoop(
  history: Message[],
  onConfirm?: (preview: string) => Promise<boolean | "all">,
): Promise<string> {
  const ollama = new Ollama();
  searchWebCallCount = 0;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    lastErrorMessage = "";
    consecutiveErrorCount = 0;

    if (iteration > 1 && currentTodos.length > 0) {
      const todoStatus = currentTodos.map(t => 
        `${t.done ? '[x]' : (t.active ? '[•]' : '[ ]')} ${t.text}`
      ).join('\n');
      
      history.push({
        role: "system",
        content: `Current progress:\n<todo>\n${todoStatus}\n</todo>\nContinue with the next step according to the plan above.`
      });
    }

    let thinkingBuffer = "";
    let contentBuffer = "";
    let toolCallsBuffer: any[] = [];
    let thinkingStarted = false;
    let thinkingClosed = false;

    const stream = await ollama.chat({
      model: OLLAMA_CONFIG.model,
      messages: history,
      tools: TOOL_DEFINITIONS,
      options: OLLAMA_CONFIG.options,
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.message.thinking) {
        thinkingBuffer += chunk.message.thinking;
        const thinkingLines = thinkingBuffer.split("\n");
        for (let i = 0; i < thinkingLines.length - 1; i++) {
          if (!thinkingStarted) {
            process.stdout.write(
              "\n  " + C.gray + "Thinking:" + C.reset + "\n"
            );
            thinkingStarted = true;
          }
          console.log("  " + C.gray + C.dim + "  " + thinkingLines[i] + C.reset);
        }
        thinkingBuffer = thinkingLines[thinkingLines.length - 1];
      }

      if (chunk.message.content) {
        if (thinkingStarted && !thinkingClosed) {
          process.stdout.write("\n");
          thinkingClosed = true;
        }
        contentBuffer += chunk.message.content;
      }

      if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
        toolCallsBuffer = chunk.message.tool_calls;
      }
    }

    if (thinkingStarted && !thinkingClosed) {
      process.stdout.write("\n");
    }

    if (thinkingBuffer.trim()) {
      if (!thinkingStarted) {
        process.stdout.write("\n  " + C.gray + "Thinking:" + C.reset + "\n");
      }
      console.log("  " + C.gray + C.dim + "  " + thinkingBuffer + C.reset);
      thinkingBuffer = "";
    }

    if (contentBuffer.trim().length > 0 || thinkingBuffer.trim().length > 0) {
      const todos = parseTodo(contentBuffer, thinkingBuffer);
      if (todos) {
        currentTodos = todos;
        displayTodos(currentTodos);
      }
    }

    if (!toolCallsBuffer || toolCallsBuffer.length === 0) {
      if (currentTodos.length > 0) {
        currentTodos = currentTodos.map((item) => ({
          ...item, done: true, active: false,
        }));
        displayTodos(currentTodos);
        currentTodos = [];
      }
      return contentBuffer.trim();
    }

    if (contentBuffer.trim().length > 0) {
      console.log(
        "\n  " +
          C.yellow +
          "⚠" +
          C.reset +
          " Model menjawab sebelum tool selesai — melanjutkan eksekusi"
      );
    }

    console.log(
      "  " +
        C.blue +
        "↻" +
        C.reset +
        " iterasi " +
        iteration +
        "/" +
        MAX_ITERATIONS
    );

    history.push({
      role: "assistant",
      content: contentBuffer
        .replace(/<todo>[\s\S]*?<\/todo>/gi, "")
        .trim(),
      tool_calls: toolCallsBuffer,
    });

    for (const tc of toolCallsBuffer) {
      const toolName = tc.function.name;
      const toolArgs = tc.function.arguments as Record<string, unknown>;

      if (toolName === "searchWeb" && searchWebCallCount >= MAX_SEARCH_WEB_CALLS) {
        history.push({
          role: "tool",
          content: `You already called searchWeb ${MAX_SEARCH_WEB_CALLS} times in this task. Stop searching and try to fix the issue based on what you have learned.`,
        });
        continue;
      }

      if (toolName === "searchWeb") {
        searchWebCallCount++;
      }

      if (REQUIRES_CONFIRMATION.includes(toolName) && onConfirm && !sessionAutoConfirm) {
        const preview = buildPreview(toolName, toolArgs);
        const result = await onConfirm(preview);

        if (result === "all") {
          sessionAutoConfirm = true;
        } else if (!result) {
          currentTodos = [];
          return "Perintah dibatalkan oleh user.";
        }
      }

      const result: ToolResult = await dispatchTool({
        name: toolName,
        arguments: toolArgs,
      });

      if (result.success) {
        console.log(formatToolSuccess(result));
        if (result.toolName === "searchWeb") {
          console.log("\n" + result.output + "\n");
        }
      } else {
        console.error(formatToolError(result));
        if (result.toolName === "searchWeb") {
          console.log("\n" + result.output + "\n");
        }
      }

      history.push({
        role: "tool",
        content: result.output,
      });

      if (toolName === "readFile" && result.success) {
        history.push({
          role: "tool",
          content: "[File content for editing reference]\n" + result.output +
            "\nIMPORTANT: When calling editFile, use EXACT strings from above.",
        });
      }

      if (toolName === "runCommand" && searchWebCallCount < MAX_SEARCH_WEB_CALLS) {
        const outputHasError = result.output.toLowerCase().includes("error") ||
          result.output.toLowerCase().includes("syntaxerror") ||
          result.output.toLowerCase().includes("typeerror") ||
          result.output.toLowerCase().includes("referenceerror") ||
          !result.success;

        if (outputHasError) {
          const errorFirstLine = result.output.split("\n")
            .find((l) => l.trim().length > 0) ?? "";

          if (errorFirstLine === lastErrorMessage) {
            consecutiveErrorCount++;
          } else {
            lastErrorMessage = errorFirstLine;
            consecutiveErrorCount = 1;
          }

          if (consecutiveErrorCount >= ERROR_THRESHOLD) {
            consecutiveErrorCount = 0;
            lastErrorMessage = "";

            const command = (toolArgs.command as string ?? "");
            const techWords = command
              .replace(/[^a-zA-Z0-9\s]/g, " ")
              .trim()
              .split(/\s+/)
              .filter((w) => w.length > 2)
              .slice(0, 2)
              .join(" ");

            const errorWords = errorFirstLine
              .replace(/[^a-zA-Z0-9\s:]/g, " ")
              .trim()
              .split(/\s+/)
              .filter((w) => w.length > 2)
              .slice(0, 3)
              .join(" ");

            const autoQuery = errorWords;

            console.log(
              "\n  " + C.cyan + "⟳ Auto-search triggered after " +
              ERROR_THRESHOLD + " consecutive errors" + C.reset
            );
            console.log(
              "  " + C.gray + "  Query: " + autoQuery + C.reset + "\n"
            );

            history.push({
              role: "user",
              content:
                `You have failed to fix this error ${ERROR_THRESHOLD} times in a row. ` +
                `Stop trying the same approach. ` +
                `Use searchWeb tool with this query: "${autoQuery}" ` +
                `to find the solution from documentation or community answers. ` +
                `Then apply the fix based on what you find.`,
            });
          }
        } else {
          consecutiveErrorCount = 0;
          lastErrorMessage = "";
        }
      }

      if (toolName === "editFile" && result.success) {
        try {
          const filePath = resolvePath(toolArgs.path as string);
          const updatedContent = readFileSync(filePath, "utf-8");
          const lines = updatedContent.split("\n");
          history.push({
            role: "tool",
            content:
              "[Auto-refresh after edit] " +
              (toolArgs.path as string) +
              " now contains (" +
              lines.length +
              " lines):\n" +
              updatedContent,
          });
          console.log(
            "  " +
              C.gray +
              "↺ auto-refresh " +
              (toolArgs.path as string) +
              " (" +
              lines.length +
              " lines)" +
              C.reset
          );
        } catch {
          // auto-refresh gagal, lanjutkan
        }
      }

      if (currentTodos.length > 0) {
        const toolLabel =
          toolName === "readFile" || toolName === "editFile"
            ? (toolArgs.path as string ?? "")
            : toolName === "runCommand"
            ? (toolArgs.command as string ?? "")
            : toolName;

        let marked = false;
        for (const item of currentTodos) {
          if (!item.done && !item.active && !marked) {
            if (
              item.text.toLowerCase().includes(toolName.toLowerCase()) ||
              item.text
                .toLowerCase()
                .includes(
                  toolLabel.toLowerCase().split("/").pop() ?? ""
                )
            ) {
              item.active = true;
              marked = true;
            }
          }
        }

        if (marked) displayTodos(currentTodos);
      }
    }
  }

  return "[Agent] Maximum iterations reached.";
}
