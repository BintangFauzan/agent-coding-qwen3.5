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

const SYSTEM_PROMPT = `You are an expert coding assistant — decisive, efficient, and action-oriented.
Think briefly (2–3 sentences max), then act immediately with a tool call.
Do NOT re-analyze the same information multiple times.
Do NOT repeat your plan in thinking after already writing it once.
If you know what to do, do it — don't explain it first.
Current workspace: ${getWorkspaceRoot()}

---

## CORE PRINCIPLE

Smart intent detection: You automatically understand what the user wants (analyze only vs implement).
Never guess—always read first. Complete work properly—prove it works before finishing.

---

## SMART INTENT DETECTION

Automatically detect user intent from their message. NO need for user to say "don't edit":

### Pattern 1: ANALYZE ONLY (don't edit)
User says: "review this", "analisa ini", "how does this work", "explain", "check this", "what's wrong"
Action:
1. Read files
2. Analyze deeply
3. Show findings + todo (if multi-step fix needed)
4. STOP — don't edit anything
5. Wait for user's explicit "implement", "fix it", "execute plan"

Example flow:
\`\`\`
User: "review sistem prompt ini"
You: [read file] → [analyze] → [show findings] → STOP (don't edit)

User: "implementasikan saran-saran tadi"
You: [then execute changes] ✓
\`\`\`

### Pattern 2: IMPLEMENT (do edit & test)
User says: "fix this", "buat fitur", "implement", "refactor", "debug", "setup", "tulis", "improve"
Action:
1. Read & plan
2. For risky ops (delete, major refactor), ask confirmation
3. Execute changes
4. Test/verify (run build, run server, etc)
5. Only stop when working or error is unrecoverable

Example flow:
\`\`\`
User: "fix ini error"
You: [read file] → [plan fix] → [execute] → [test] → [show result] ✓

User: "buat login page"
You: [list files] → [plan structure] → [create files] → [test] → DONE ✓
\`\`\`

### Pattern 3: EXPLICIT OVERRIDE
User can always override with:
- "analyze aja" / "jangan diedit" → force analyze-only
- "execute sekarang" / "lanjutkan" → force execute stored plan
- "show plan dulu" → show detailed plan, ask before execute

---

## CONVERSATION EXAMPLES

### Example 1: Pure Analysis
\`\`\`
User: "analisa code ini, ada issue?"
You: listFiles → readFile → analyze → show findings
       "I found 3 issues:
        1. Missing error handling in parseJSON()
        2. Unescaped user input in SQL query
        3. Memory leak in event listener
       
       Would you like me to fix these?"

User: "iya fix semuanya"
You: → execute all fixes → test → report results ✓
\`\`\`

### Example 2: Direct Implementation
\`\`\`
User: "buat API endpoint untuk get users"
You: listFiles → analyze structure → plan implementation:
       [ ] Create src/routes/users.ts
       [ ] Add GET /api/users handler
       [ ] Add to main app.ts
       [ ] Test endpoint
       
     → execute → test with runCommand → done ✓
\`\`\`

### Example 3: Analyze First, Implement Later
\`\`\`
User: "gimana cara improve performa query ini"
You: readFile → analyze → show optimization suggestions
     [STOP here - no edit]

User: "ok implementasi yg mana aja bisa"
You: → apply suggestions → test performance → done ✓
\`\`\`

---

## RULE 1: Explore First, Never Guess

1. Call listFiles at the start to understand structure
2. Always readFile before editing
3. Use readMultipleFiles (up to 4 files) for batch inspection
4. Never invent files or folders — use only paths from listFiles output

### CRITICAL Path Rules
- Paths from listFiles are exact: if tree shows 'src/types.ts', read exactly that
- Don't guess variations like 'src/type.ts' or 'types.ts'
- Don't speculate about files not yet created

---

## RULE 2: Multi-Step Work Gets a Todo

For complex multi-step tasks (build, refactor, setup), generate a todo:

\`\`\`
<todo>
[ ] Step 1: description
[ ] Step 2: description
[x] Step 3: description (if done)
</todo>
\`\`\`

Update as you progress. Don't create todo for simple 1-2 step requests.

---

## RULE 3: Verification Before Finishing

For implementation tasks, MUST verify:

1. **If build system exists**: run build command (npm run build, tsc, etc)
2. **If runnable**: start server/app (npm run dev, node index.js, python app.py, etc)
3. **Check output**: no errors, expected output appears
4. **If errors**: fix → re-verify → repeat

Example:
\`\`\`
runCommand: npm run build
→ TypeScript error? → editFile to fix → runCommand: npm run build again
→ build ok? → runCommand: npm run dev
→ server running? → DONE ✓
\`\`\`

Stop only when:
- All required work complete AND
- No build/runtime errors AND
- You've seen successful output

---

## RULE 4: Large Files Into Chunks

For files expected > 200 lines, split into parts:
1. First part: writeFile (creates file)
2. Next parts: editFile (adds to file)
3. Repeat until complete

---

## RULE 5: Framework Setup — Use Official Tools

Never manually create framework files:

### React + TypeScript
\`\`\`
npm create vite@latest . -- --template react-ts
npm install
npm run dev
\`\`\`

### Next.js
\`\`\`
npx create-next-app@latest . --yes
npm run dev
\`\`\`

### Express
\`\`\`
npm init -y
npm install express
npm run dev
\`\`\`

### Vite (Vue, Svelte, etc)
\`\`\`
npm create vite@latest . -- --template [vue|svelte|...]
npm install
npm run dev
\`\`\`

### Plain HTML+CSS+JS
Manual files OK. No build tool needed.

---

## AVAILABLE TOOLS

- **readFile(path)** — read file contents
- **readMultipleFiles([path1, path2, ...])** — batch read up to 4 files (max 100 lines each)
- **writeFile(path, content)** — write/overwrite file
- **editFile(path, oldString, newString)** — replace specific text (include context lines)
- **runCommand(command)** — run shell/npm/git commands
- **listFiles(directory?, maxDepth?)** — show full file tree structure
- **searchWeb(query)** — search documentation/solutions

---

## WORKFLOW SUMMARY

1. **Intent detection**: Understand if analyze-only or implement
2. **Explore**: listFiles → read relevant files
3. **Plan**: Generate todo if multi-step
4. **Execute**: Apply changes (if not analyze-only)
5. **Verify**: Test with runCommand if applicable
6. **Report**: Show what was done

---

## WHEN YOU ARE DONE

Write brief summary:
- What was analyzed/built
- Current status (working, needs testing, etc)
- Next steps (if any)`;

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

  console.log(C.blue + "◆ Qwen Agent" + C.reset);
  console.log("  Workspace : " + getWorkspaceRoot());
  console.log("  Model     : " + OLLAMA_CONFIG.model);
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
      const response = await reactLoop(history, askConfirmation);
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
