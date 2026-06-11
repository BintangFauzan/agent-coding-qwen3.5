import { Ollama } from "ollama";
import { dispatchTool } from "./tools";
import { readFileSync } from "fs";
import { resolvePath } from "./workspace.js";
import { OLLAMA_CONFIG } from "./config.js";
const MAX_ITERATIONS = 50;
const C = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    gray: "\x1b[90m",
};
const TOOL_DEFINITIONS = [
    {
        type: "function",
        function: {
            name: "readFile",
            description: "Baca isi file dari workspace. Gunakan startLine dan endLine untuk membaca range baris tertentu — ini lebih efisien untuk file besar. Output selalu menyertakan nomor baris.",
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
            name: "readMultipleFiles",
            description: "Baca 2–4 file sekaligus dalam satu call. Gunakan saat perlu membaca beberapa " +
                "file sebelum mengerjakan sesuatu — lebih efisien dari readFile berulang. " +
                "Maksimal 4 file, 100 baris pertama per file. Untuk file panjang gunakan " +
                "readFile dengan startLine/endLine.",
            parameters: {
                type: "object",
                properties: {
                    paths: {
                        type: "array",
                        items: { type: "string" },
                        description: "Array path file yang akan dibaca, maksimal 4. " +
                            'Contoh: ["src/App.tsx", "src/config.ts"]',
                    },
                },
                required: ["paths"],
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
            description: "Jalankan shell command di workspace. Gunakan untuk npm, git, atau command lain.",
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
            description: "Tampilkan struktur folder dalam workspace dalam bentuk tree lengkap " +
                "dengan seluruh subfolder. Gunakan ini PERTAMA KALI sebelum membaca file " +
                "jika tidak tahu struktur proyek.",
            parameters: {
                type: "object",
                properties: {
                    directory: {
                        type: "string",
                        description: "Direktori yang ingin di-list, relatif ke workspace root. Default: root workspace.",
                    },
                    maxDepth: {
                        type: "number",
                        description: "Kedalaman maksimal tree. Default: 4. Naikkan jika perlu melihat folder yang lebih dalam.",
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
let currentTodos = [];
let sessionAutoConfirm = false;
let lastErrorMessage = "";
let consecutiveErrorCount = 0;
const ERROR_THRESHOLD = 3;
function buildPreview(toolName, args) {
    if (toolName === "editFile") {
        return "  " + C.magenta + "✎" + C.reset + " editFile " + (args.path ?? "");
    }
    if (toolName === "writeFile") {
        const bytes = Buffer.byteLength((args.content ?? "").toString(), "utf-8");
        const isNew = true;
        return ("  " +
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
            " bytes)");
    }
    if (toolName === "runCommand") {
        return ("  " +
            C.magenta +
            "✎" +
            C.reset +
            " runCommand\n" +
            "    $ " +
            (args.command ?? ""));
    }
    return "  " + C.magenta + "✎" + C.reset + " " + toolName;
}
function formatToolSuccess(result) {
    const firstLine = result.output.split("\n")[0];
    const isEdit = result.toolName === "editFile";
    const isRun = result.toolName === "runCommand";
    if (isEdit) {
        const match = firstLine.match(/Edited .*? \(\+(\d+), -(\d+)\)/);
        if (match) {
            return ("  " +
                C.green +
                "✓" +
                C.reset +
                " " +
                result.toolName +
                " — Edited (+" +
                match[1] +
                ", -" +
                match[2] +
                ")");
        }
    }
    if (isRun) {
        return ("  " +
            C.green +
            "✓" +
            C.reset +
            " " +
            result.toolName +
            " — " +
            firstLine.replace(/^.*?\-\s*/, ""));
    }
    if (result.toolName === "searchWeb") {
        const queryMatch = result.output.match(/Search results for "(.+?)"/s) ||
            result.output.match(/No results found for: "(.+?)"/);
        const query = queryMatch ? queryMatch[1] : "unknown query";
        const displayQuery = query.length > 50 ? query.slice(0, 47) + "..." : query;
        return "  " + C.green + "✓" + C.reset + " searchWeb — " + displayQuery;
    }
    if (result.toolName === "listFiles") {
        return ("\n  " +
            C.gray +
            result.output +
            C.reset);
    }
    return ("  " + C.green + "✓" + C.reset + " " + result.toolName + " — " + firstLine);
}
function formatToolError(result) {
    return ("  " +
        C.red +
        "✗" +
        C.reset +
        " " +
        result.toolName +
        " — " +
        result.output.split("\n")[0]);
}
/**
 * STRICT parsing: Only parse explicit <todo>...</todo> blocks.
 * Do NOT parse from thinking blocks or numbered lists.
 * This prevents snowball effect from iterating on model-generated lists.
 */
function parseTodo(content, thinking) {
    const combined = thinking ? content + "\n" + thinking : content;
    const match = combined.match(/<todo>([\s\S]*?)<\/todo>/i);
    if (!match) {
        return null;
    }
    const lines = match[1].split("\n");
    const items = [];
    for (const line of lines) {
        if (!line.trim())
            continue;
        const indentMatch = line.match(/^(\s*)/);
        const spaces = indentMatch ? indentMatch[1].length : 0;
        const indent = Math.floor(spaces / 4);
        // Match [ ], [x], [•], [✓] patterns
        const todoMatch = line.trim().match(/^\[([ x•✓])\]\s+(.+)/i);
        if (todoMatch) {
            const marker = todoMatch[1].toLowerCase();
            items.push({
                text: todoMatch[2],
                done: marker === "x" || marker === "✓",
                active: marker === "•",
                indent,
            });
        }
    }
    return items.length > 0 ? items : null;
}
function displayTodos(todos) {
    if (todos.length === 0)
        return;
    console.log("\n  " + C.bold + C.blue + "Todo" + C.reset);
    for (const item of todos) {
        const pad = "  " + "    ".repeat(item.indent);
        if (item.done) {
            console.log(pad + C.green + "[✓]" + C.reset + " " + C.dim + item.text + C.reset);
        }
        else if (item.active) {
            console.log(pad + C.yellow + "[•]" + C.reset + " " + C.bold + item.text + C.reset);
        }
        else {
            console.log(pad + C.gray + "[ ]" + C.reset + " " + item.text);
        }
    }
    console.log();
}
let searchWebCallCount = 0;
const MAX_SEARCH_WEB_CALLS = 3;
function detectIntent(userMessage) {
    const lower = userMessage.toLowerCase();
    // ANALYZE ONLY patterns
    const analyzeKeywords = [
        "review", "analisa", "analyze", "how does", "explain", "check",
        "what's wrong", "gimana cara", "bagaimana", "apakah ada issue",
        "ada masalah", "issue", "problem", "vulnerability",
    ];
    // IMPLEMENT patterns
    const implementKeywords = [
        "fix", "buat", "create", "implement", "refactor", "debug",
        "setup", "tulis", "write", "improve", "optimize", "solve",
        "perbaiki", "buat fitur", "tambah",
    ];
    // Check for explicit "jangan diedit" override
    const hasNoEditKeyword = lower.includes("jangan diedit") ||
        lower.includes("analyze aja") ||
        lower.includes("analyze only");
    // Check for analyze-only (higher priority)
    const hasAnalyzeKeyword = analyzeKeywords.some((k) => lower.includes(k));
    if (hasAnalyzeKeyword || hasNoEditKeyword) {
        return { type: "analyze-only", keywords: analyzeKeywords };
    }
    // Check for implement
    const hasImplementKeyword = implementKeywords.some((k) => lower.includes(k));
    if (hasImplementKeyword) {
        return { type: "implement", keywords: implementKeywords };
    }
    return { type: "unknown", keywords: [] };
}
function trimHistory(history, keepLast = 12) {
    if (history.length <= keepLast + 2) {
        return history;
    }
    const systemMessage = history[0];
    const firstUserMessage = history[1];
    const recentMessages = history.slice(-keepLast);
    const merged = [systemMessage, firstUserMessage];
    for (const msg of recentMessages) {
        if (msg !== firstUserMessage && msg !== systemMessage) {
            merged.push(msg);
        }
    }
    return merged;
}
export async function reactLoop(history, onConfirm) {
    const ollama = new Ollama();
    searchWebCallCount = 0;
    lastErrorMessage = "";
    consecutiveErrorCount = 0;
    // Detect user intent from first user message
    let isAnalyzeOnly = false;
    const firstUserMsg = history.find((m) => m.role === "user");
    if (firstUserMsg && typeof firstUserMsg.content === "string") {
        const intent = detectIntent(firstUserMsg.content);
        isAnalyzeOnly = intent.type === "analyze-only";
        if (isAnalyzeOnly) {
            // Add system reminder for analyze-only mode
            history.push({
                role: "system",
                content: "User requested ANALYZE ONLY. After analyzing and showing findings, STOP — do not edit files or run commands. Wait for user's explicit 'implement', 'fix', or 'execute plan' to proceed.",
            });
        }
    }
    let lastInjectedTodoStatus = "";
    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        if (iteration > 1 && currentTodos.length > 0) {
            const todoStatus = currentTodos
                .map((t) => `${t.done ? "[x]" : t.active ? "[•]" : "[ ]"} ${t.text}`)
                .join("\n");
            if (todoStatus !== lastInjectedTodoStatus) {
                lastInjectedTodoStatus = todoStatus;
                history.push({
                    role: "user",
                    content: `[Progress update]\n<todo>\n${todoStatus}\n</todo>\nContinue to the next unfinished step.`,
                });
            }
        }
        let thinkingBuffer = "";
        let fullThinking = "";
        let contentBuffer = "";
        let toolCallsBuffer = [];
        let thinkingStarted = false;
        let thinkingClosed = false;
        let promptEvalCount = null;
        let evalCount = null;
        const trimmedHistory = trimHistory(history, 6);
        const requestStart = performance.now();
        const stream = await ollama.chat({
            model: OLLAMA_CONFIG.model,
            messages: trimmedHistory,
            tools: TOOL_DEFINITIONS,
            options: OLLAMA_CONFIG.options,
            stream: true,
        });
        for await (const chunk of stream) {
            if ("prompt_eval_count" in chunk) {
                promptEvalCount = chunk.prompt_eval_count;
            }
            if ("eval_count" in chunk) {
                evalCount = chunk.eval_count;
            }
            if (chunk.message.thinking) {
                thinkingBuffer += chunk.message.thinking;
                fullThinking += chunk.message.thinking;
                const thinkingLines = thinkingBuffer.split("\n");
                for (let i = 0; i < thinkingLines.length - 1; i++) {
                    if (!thinkingStarted) {
                        process.stdout.write("\n  " + C.gray + "Thinking:" + C.reset + "\n");
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
        const requestEnd = performance.now();
        const requestMs = Math.round(requestEnd - requestStart);
        console.log(`  ${C.gray}Request: ${requestMs}ms` +
            (promptEvalCount !== null ? ` | prompt tokens: ${promptEvalCount}` : "") +
            (evalCount !== null ? ` | completion tokens: ${evalCount}` : "") +
            C.reset);
        if (thinkingStarted && !thinkingClosed) {
            process.stdout.write("\n");
        }
        if (thinkingBuffer.trim()) {
            if (!thinkingStarted) {
                process.stdout.write("\n  " + C.gray + "Thinking:" + C.reset + "\n");
            }
            console.log("  " + C.gray + C.dim + "  " + thinkingBuffer + C.reset);
        }
        const finalThinking = thinkingBuffer;
        if ((contentBuffer.trim().length > 0 || fullThinking.trim().length > 0) &&
            currentTodos.length === 0) {
            const todos = parseTodo(contentBuffer, fullThinking);
            if (todos && todos.length > 0) {
                currentTodos = todos;
                displayTodos(currentTodos);
            }
        }
        // ✅ EARLY EXIT for analyze-only mode
        if (isAnalyzeOnly && !toolCallsBuffer?.length) {
            // No more tool calls = analysis complete
            // Return findings and STOP
            return contentBuffer.trim();
        }
        if (!toolCallsBuffer || toolCallsBuffer.length === 0) {
            const hasUnfinishedTodos = currentTodos.some((item) => !item.done);
            if (hasUnfinishedTodos) {
                const todoStatus = currentTodos
                    .map((t) => `${t.done ? "[x]" : t.active ? "[•]" : "[ ]"} ${t.text}`)
                    .join("\n");
                history.push({
                    role: "user",
                    content: `[SYSTEM] You haven't started any work. The following todos are still incomplete:\n` +
                        `<todo>\n${todoStatus}\n</todo>\n\n` +
                        `REQUIRED: Start by calling listFiles, then work on the first step immediately.`,
                });
                continue;
            }
            if (!isAnalyzeOnly &&
                iteration <= 3 &&
                contentBuffer.trim().length > 100) {
                history.push({
                    role: "user",
                    content: `[SYSTEM] You described a plan but haven't started working. ` +
                        `REQUIRED now:\n` +
                        `1. Write a <todo> with concrete steps\n` +
                        `2. Call listFiles immediately to begin\n` +
                        `Stop explaining — execute now.`,
                });
                continue;
            }
            if (currentTodos.length > 0) {
                const allDone = currentTodos.every((item) => item.done);
                if (allDone) {
                    displayTodos(currentTodos);
                    currentTodos = [];
                }
            }
            return contentBuffer.trim();
        }
        if (contentBuffer.trim().length > 0) {
            console.log("\n  " +
                C.yellow +
                "⚠" +
                C.reset +
                " Model menjawab sebelum tool selesai — melanjutkan eksekusi");
        }
        console.log("  " +
            C.blue +
            "↻" +
            C.reset +
            " iterasi " +
            iteration +
            "/" +
            MAX_ITERATIONS);
        history.push({
            role: "assistant",
            content: contentBuffer.replace(/<todo>[\s\S]*?<\/todo>/gi, "").trim(),
            tool_calls: toolCallsBuffer,
        });
        for (const tc of toolCallsBuffer) {
            const toolName = tc.function.name;
            const toolArgs = tc.function.arguments;
            if (toolName === "searchWeb" &&
                searchWebCallCount >= MAX_SEARCH_WEB_CALLS) {
                history.push({
                    role: "tool",
                    content: `You already called searchWeb ${MAX_SEARCH_WEB_CALLS} times in this task. Stop searching and try to fix the issue based on what you have learned.`,
                });
                continue;
            }
            if (toolName === "searchWeb") {
                searchWebCallCount++;
            }
            if (REQUIRES_CONFIRMATION.includes(toolName) &&
                onConfirm &&
                !sessionAutoConfirm) {
                const preview = buildPreview(toolName, toolArgs);
                const result = await onConfirm(preview);
                if (result === "all") {
                    sessionAutoConfirm = true;
                }
                else if (!result) {
                    currentTodos = [];
                    return "Perintah dibatalkan oleh user.";
                }
            }
            const result = await dispatchTool({
                name: toolName,
                arguments: toolArgs,
            });
            if (result.success) {
                console.log(formatToolSuccess(result));
                if (result.toolName === "searchWeb") {
                    console.log("\n" + result.output + "\n");
                }
            }
            else {
                console.error(formatToolError(result));
                if (result.toolName === "searchWeb") {
                    console.log("\n" + result.output + "\n");
                }
            }
            const MAX_TOOL_OUTPUT = 80;
            const outputLines = result.output.split("\n");
            const truncatedOutput = outputLines.length > MAX_TOOL_OUTPUT
                ? outputLines.slice(0, MAX_TOOL_OUTPUT).join("\n") +
                    `\n... (truncated: ${outputLines.length - MAX_TOOL_OUTPUT} more lines)`
                : result.output;
            history.push({
                role: "tool",
                content: truncatedOutput,
            });
            if (toolName === "runCommand" && !result.success) {
                const errorLines = result.output
                    .split("\n")
                    .filter((l) => l.trim().length > 0)
                    .slice(0, 10)
                    .join("\n");
                history.push({
                    role: "user",
                    content: `[SYSTEM] Command failed with non-zero exit code. Error output:\n` +
                        `\`\`\`\n${errorLines}\n\`\`\`\n\n` +
                        `REQUIRED:\n` +
                        `1. Carefully read the error above\n` +
                        `2. Identify the problematic file and line\n` +
                        `3. Use readFile to inspect that file\n` +
                        `4. Fix it with editFile\n` +
                        `5. Re-run the same command to verify\n` +
                        `Do NOT declare completion until the command succeeds.`,
                });
            }
            if (toolName === "runCommand" &&
                result.success &&
                searchWebCallCount < MAX_SEARCH_WEB_CALLS) {
                const outputHasError = result.output.toLowerCase().includes("error") ||
                    result.output.toLowerCase().includes("syntaxerror") ||
                    result.output.toLowerCase().includes("typeerror") ||
                    result.output.toLowerCase().includes("referenceerror");
                if (outputHasError) {
                    const errorFirstLine = result.output.split("\n").find((l) => l.trim().length > 0) ?? "";
                    if (errorFirstLine === lastErrorMessage) {
                        consecutiveErrorCount++;
                    }
                    else {
                        lastErrorMessage = errorFirstLine;
                        consecutiveErrorCount = 1;
                    }
                    if (consecutiveErrorCount >= ERROR_THRESHOLD) {
                        consecutiveErrorCount = 0;
                        lastErrorMessage = "";
                        const command = toolArgs.command ?? "";
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
                        console.log("\n  " +
                            C.cyan +
                            "⟳ Auto-search triggered after " +
                            ERROR_THRESHOLD +
                            " consecutive errors" +
                            C.reset);
                        console.log("  " + C.gray + "  Query: " + autoQuery + C.reset + "\n");
                        history.push({
                            role: "user",
                            content: `You have failed to fix this error ${ERROR_THRESHOLD} times in a row. ` +
                                `Stop trying the same approach. ` +
                                `Use searchWeb tool with this query: "${autoQuery}" ` +
                                `to find the solution from documentation or community answers. ` +
                                `Then apply the fix based on what you find.`,
                        });
                    }
                }
                else {
                    consecutiveErrorCount = 0;
                    lastErrorMessage = "";
                }
            }
            if (toolName === "editFile" && result.success) {
                try {
                    const filePath = resolvePath(toolArgs.path);
                    const updatedContent = readFileSync(filePath, "utf-8");
                    const lines = updatedContent.split("\n");
                    history.push({
                        role: "tool",
                        content: "[Auto-refresh after edit] " +
                            toolArgs.path +
                            " now contains (" +
                            lines.length +
                            " lines):\n" +
                            updatedContent,
                    });
                    console.log("  " +
                        C.gray +
                        "↺ auto-refresh " +
                        toolArgs.path +
                        " (" +
                        lines.length +
                        " lines)" +
                        C.reset);
                }
                catch {
                    // auto-refresh gagal, lanjutkan
                }
            }
            if (currentTodos.length > 0) {
                for (const item of currentTodos) {
                    if (item.active) {
                        item.done = true;
                        item.active = false;
                    }
                }
                const nextItem = currentTodos.find((item) => !item.done && !item.active);
                if (nextItem) {
                    nextItem.active = true;
                }
                displayTodos(currentTodos);
            }
        }
    }
    return "[Agent] Maximum iterations reached.";
}
