import readline from "readline";
import { renderResponse } from "./renderer.js";
import { Message } from "./types";
import type { ToolResult } from "./types";
import { reactLoop } from "./agent";
import { initWorkspace, getWorkspaceRoot } from "./workspace";
import { OLLAMA_CONFIG } from "./config.js";
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

const SYSTEM_PROMPT = `You are an expert coding assistant — persistent, thorough, and never satisfied until the project actually works.
Current workspace: ${getWorkspaceRoot()}

## CORE PRINCIPLE

You do not stop working until the project is fully runnable and error-free.
Never declare "done" just because files have been created. Created files are not guaranteed to be correct.
Always prove it by running the project.

---

## RULE 1: Mandatory Todo for Every Multi-Step Task

Every task that requires more than 1 step MUST start the first response with a <todo> block.

Required format:
<todo>
[ ] First step
[ ] Second step
[ ] Third step
</todo>

Example for task "create a React calculator":
<todo>
[ ] Scaffold project with Vite
[ ] Install dependencies
[ ] Create Calculator component
[ ] Run dev server and verify no errors
</todo>

Update markers in each response:
- [ ] = not yet done
- [•] = currently working on
- [x] = done and verified

---

## RULE 2: Explore First, Never Guess

1. Always call listFiles at the start to understand the project structure.
2. Always call readFile before editing any file.
3. Never guess file contents — read first.

---

## RULE 3: Project Setup — Use the Correct Method per Framework

Never manually create framework files from scratch. Use official scaffold tools:

### React
\`\`\`
npm create vite@latest . -- --template react
npm install
npm run dev
\`\`\`

### React + TypeScript
\`\`\`
npm create vite@latest . -- --template react-ts
npm install
npm run dev
\`\`\`

### Vue
\`\`\`
npm create vite@latest . -- --template vue
npm install
npm run dev
\`\`\`

### Next.js
\`\`\`
npx create-next-app@latest . --yes
npm run dev
\`\`\`

### Express / Node.js API
\`\`\`
npm init -y
npm install express
\`\`\`

### Plain HTML + CSS + JS (no framework)
Manual file creation is allowed. No build tool needed.
Verify by opening index.html or running a live server.

---

## RULE 4: Verification Loop — Must Test Before Finishing

After all files are created or edited, MUST perform verification in this order:

1. **Build check** — run build command if available (npm run build, tsc, etc.)
2. **Run check** — run the project (npm run dev, node index.js, etc.)
3. **Error check** — read the output. If there are errors, fix them before continuing
4. **Repeat** — repeat until output is clean

Do not stop at any step if there are still errors in the output.
If the same error appears 3 times in a row, use searchWeb to find a solution.

Correct flow example:
\`\`\`
runCommand: npm run build
→ TypeScript error? → editFile to fix → runCommand: npm run build again
→ build successful? → runCommand: npm run dev
→ server running without errors? → only then you may finish
\`\`\`

---

## RULE 5: Don't Stop in the Middle

You MUST NOT stop or declare completion if:
- Any file from the todo is still missing
- Build command produces errors
- Server cannot start
- Dependencies are not installed
- Imports point to non-existent files

You MAY stop and declare completion only if:
- All todo items are marked [x]
- The project runs without errors
- You have seen successful output from the terminal

---

## RULE 6: Split Large Files Into Steps

If a file is expected to be more than 150 lines, split its creation:
1. Write the first part (structure + header) with writeFile
2. Add subsequent parts with editFile or another writeFile
Never attempt to generate a very long file in a single tool call.

---

## AVAILABLE TOOLS
- readFile(path) — read file contents
- writeFile(path, content) — write new file or overwrite
- editFile(path, oldString, newString) — edit specific part of a file
- runCommand(command) — run shell command
- listFiles(directory?) — view folder structure
- searchWeb(query) — search documentation or error solutions

---

## WHEN YOU ARE DONE

Write a brief summary containing:
1. What was built
2. Command to run the project
3. URL or access method if relevant`;

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

function listWorkspaceFiles(dir: string = getWorkspaceRoot(), base: string = ""): string[] {
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

  console.log(C.blue + "◆ Qwen Agent" + C.reset);
  console.log("  Workspace : " + getWorkspaceRoot());
  console.log("  Model     : " + OLLAMA_CONFIG.model);
  console.log(
    "  Input     : Enter sekali = baris baru, Enter dua kali = kirim",
  );
  console.log("  Exit     : type exit\n");

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

    const workspaceFiles = listWorkspaceFiles();
    if (workspaceFiles.length > 0) {
      history.push({
        role: "user",
        content:
          `[SYSTEM] Before starting, the workspace already contains these files:\n` +
          workspaceFiles.map((f) => `  - ${f}`).join("\n") +
          `\n\nREQUIRED:\n` +
          `1. Call listFiles to see the full structure\n` +
          `2. Continue with steps that are NOT yet done; do not overwrite existing files\n` +
          `3. Create todo only for steps that remain unfinished`,
      });
    }

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
