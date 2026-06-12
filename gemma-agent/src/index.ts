import readline from "readline";
import { renderResponse } from "./renderer.js";
import { Message } from "./types";
import type { ToolResult } from "./types";
import { reactLoop } from "./agent";
import type { Provider } from "./agent";
import { initWorkspace, getWorkspaceRoot } from "./workspace";
import { OLLAMA_CONFIG, OPENROUTER_CONFIG } from "./config.js";
import { readdirSync, statSync } from "fs";
import { join } from "path";

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

const SYSTEM_PROMPT = `You are a decisive coding assistant. Think briefly, act immediately.
Workspace: ${getWorkspaceRoot()}

## BEHAVIOR
- ANALYZE ONLY (no edits): when user says review/analisa/explain/check/what's wrong
- IMPLEMENT (edit & test): when user says fix/buat/create/tambah/implement/setup/tulis
- Default to implement if unclear

## WORKFLOW
1. listFiles → understand structure
2. readFile/readMultipleFiles → read before editing
3. Write <todo> for multi-step tasks (3+ steps)
4. Execute changes
5. runCommand to verify — fix errors until clean
6. Report briefly

## TODO FORMAT
<todo>
[ ] step one
[ ] step two
[x] step done
</todo>

## RULES
- Never guess file paths — use exact paths from listFiles
- Need to read 1 file? use readFile. Need 2+ files? ALWAYS use readMultipleFiles — never call readFile multiple times in a row
- Always read before editing
- Files >150 lines: split into multiple writeFile/editFile calls
- runCommand fails: read error, fix file, run again — do not stop
- Framework setup: use official scaffolds (vite, create-next-app, etc)

## TOOLS
readFile, readMultipleFiles (max 4 files), writeFile, editFile, runCommand, listFiles, searchWeb

## DONE WHEN
All todo items complete AND runCommand shows no errors.`;

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
        console.log(
          "  " +
            C.yellow +
            "⚠ Auto-confirm diaktifkan untuk sesi ini" +
            C.reset,
        );
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

function listWorkspaceFiles(
  dir: string = getWorkspaceRoot(),
  base: string = "",
): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const fullPath = join(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      if (statSync(fullPath).isDirectory()) {
        results.push(...listWorkspaceFiles(fullPath, rel));
      } else {
        results.push(rel);
      }
    }
  } catch {
    // workspace tidak bisa dibaca, abaikan
  }
  return results;
}

async function main(): Promise<void> {
  initWorkspace(process.argv.slice(2));

  const providerArg = process.argv.find((a) => a.startsWith("--provider="));
  let provider: Provider = "ollama";
  if (providerArg) {
    const value = (providerArg.split("=")[1] ?? "").trim().toLowerCase();
    if (value === "openrouter") {
      provider = "openrouter";
    }
  }

  const activeConfig =
    provider === "openrouter" ? OPENROUTER_CONFIG : OLLAMA_CONFIG;

  console.log(C.blue + "◆ Agent" + C.reset);
  console.log("  Workspace : " + getWorkspaceRoot());
  console.log("  Provider  : " + provider);
  console.log("  Model     : " + activeConfig.model);
  console.log(
    "  Input     : Enter sekali = baris baru, Enter dua kali = kirim",
  );
  console.log("  Exit     : type exit\n");

  const history: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

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

    const workspaceFiles = listWorkspaceFiles();
    if (workspaceFiles.length > 0) {
      history.push({
        role: "user",
        content:
          "[SYSTEM] Before starting, the workspace already contains these files:\n" +
          workspaceFiles.map((f) => "  - " + f).join("\n") +
          "\n\nREQUIRED:\n" +
          "1. Call listFiles to see the full structure\n" +
          "2. Continue with steps that are NOT yet done; do not overwrite existing files\n" +
          "3. Create todo only for steps that remain unfinished",
      });
    }

    try {
      const response = await reactLoop(history, askConfirmation, provider);
      history.push({ role: "assistant", content: response });

      const bar = "─".repeat(60);
      console.log("\n\x1b[90m  " + bar + "\x1b[0m");
      console.log("\x1b[36m\x1b[1m  Agent\x1b[0m");
      console.log("\x1b[90m  " + bar + "\x1b[0m\n");
      console.log(renderResponse(response));
      console.log("\n\x1b[90m  " + bar + "\x1b[0m\n");
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
