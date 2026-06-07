import readline from "readline";
import { renderResponse } from "./renderer.js";
import { Message } from "./types";
import type { ToolResult } from "./types";
import { reactLoop } from "./agent";
import { initWorkspace, getWorkspaceRoot } from "./workspace";

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

const OLLAMA_CONFIG = {
  model: "qwen_3.5:latest",
  options: {
    temperature: 0.2,
    num_ctx: 32768,
  },
};

const SYSTEM_PROMPT = `You are an expert coding assistant.
Current workspace: ${getWorkspaceRoot()}

## CRITICAL RULES

### Rule 1: Mandatory Planning
For any multi-step task, you MUST start your VERY FIRST response with a <todo> tag.
Format:
<todo>
[ ] Task 1
[ ] Task 2
</todo>
Update markers ([ ], [•], [x]) in subsequent responses.

### Rule 2: Always explore before answering
1. Call listFiles to understand the project structure.
2. Call readFile on relevant files before analyzing or editing.
Never guess file contents.

### Rule 3: Run first, diagnose second
When fixing errors:
1. Run the failing command (runCommand) to see the actual error output.
2. If the error is unclear, use searchWeb with the error message.
3. Only then apply the fix.

## AVAILABLE TOOLS
- readFile(path, startLine?, endLine?)
- writeFile(path, content)
- editFile(path, oldString, newString)
- runCommand(command)
- listFiles(directory?)
- searchWeb(query)

## WHEN YOU ARE DONE
Respond with a plain summary of what you did.`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

rl.on("SIGINT", () => {
  console.log("\n" + C.gray + "[Agent] Interrupted. Goodbye!" + C.reset);
  rl.close();
  process.exit(0);
});

async function askConfirmation(preview: string): Promise<boolean | "all"> {
  return new Promise((resolve) => {
    console.log(preview);
    process.stdout.write("\n  " + C.magenta + "Jalankan? (y/n/a): " + C.reset);
    const handler = (line: string) => {
      rl.removeListener("line", handler);
      const answer = line.trim().toLowerCase();
      if (answer === "y" || answer === "yes") {
        resolve(true);
      } else if (answer === "a" || answer === "all") {
        console.log("  " + C.yellow + "⚠ Auto-confirm diaktifkan untuk sesi ini" + C.reset);
        resolve("all");
      } else {
        console.log("  " + C.red + "✗ Dibatalkan" + C.reset);
        resolve(false);
      }
    };
    rl.once("line", handler);
  });
}

async function readMultilineInput(): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let lastLineEmpty = false;

    process.stdout.write(C.cyan + "You\n" + C.reset + C.bold + "❯ " + C.reset);

    const handler = (line: string) => {
      if (line === "") {
        if (lastLineEmpty || lines.length === 0) {
          if (lines[lines.length - 1] === "") {
            lines.pop();
          }
          rl.removeListener("line", handler);
          resolve(lines.join("\n").trim());
        } else {
          lines.push("");
          lastLineEmpty = true;
          process.stdout.write("... ");
        }
      } else {
        lastLineEmpty = false;
        lines.push(line);
        process.stdout.write("... ");
      }
    };

    rl.on("line", handler);
  });
}

async function main(): Promise<void> {
  initWorkspace(process.argv.slice(2));

  console.log(C.blue + "◆ Qwen Agent" + C.reset);
  console.log("  Workspace : " + getWorkspaceRoot());
  console.log("  Model     : " + OLLAMA_CONFIG.model);
  console.log(
    "  Input     : Enter sekali = baris baru, Enter dua kali = kirim",
  );
  console.log("  Keluar    : ketik exit\n");

  const history: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];

  while (true) {
    const userInput = await readMultilineInput();

    if (!userInput) continue;

    if (
      userInput.toLowerCase() === "exit" ||
      userInput.toLowerCase() === "quit"
    ) {
      console.log("\n" + C.gray + "[Agent] Goodbye!" + C.reset);
      rl.close();
      break;
    }

    history.push({ role: "user", content: userInput });

    try {
      const response = await reactLoop(history, askConfirmation);
      history.push({ role: "assistant", content: response });

      const bar = "─".repeat(60);
      console.log(`\n\x1b[90m  ${bar}\x1b[0m`);
      console.log(`\x1b[36m\x1b[1m  Agent\x1b[0m`);
      console.log(`\x1b[90m  ${bar}\x1b[0m\n`);
      console.log(renderResponse(response));
      console.log(`\n\x1b[90m  ${bar}\x1b[0m\n`);
    } catch (err) {
      console.error(
        C.red +
          "[Agent] Error: " +
          (err instanceof Error ? err.message : String(err)) +
          C.reset,
      );
      history.push({ role: "user", content: userInput });
      history.push({
        role: "assistant",
        content:
          "I encountered an error: " +
          (err instanceof Error ? err.message : String(err)) +
          ". Please try again or check your Ollama connection.",
      });
    }
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  rl.close();
  process.exit(1);
});
