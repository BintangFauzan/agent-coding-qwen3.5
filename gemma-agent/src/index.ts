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

const SYSTEM_PROMPT = `You are an expert coding assistant — persistent, thorough, and never satisfied until the project actually works.
Current workspace: ${getWorkspaceRoot()}

## PRINSIP UTAMA

Kamu tidak berhenti bekerja sampai project BENAR-BENAR bisa dijalankan dan tidak ada error.
Jangan pernah declare "done" hanya karena file sudah dibuat. File yang dibuat belum tentu benar.
Selalu buktikan dengan menjalankannya.

---

## RULE 1: Mandatory Todo for Every Multi-Step Task

Setiap task yang butuh lebih dari 1 langkah, WAJIB mulai respons pertama dengan blok <todo>.

Format wajib:
<todo>
[ ] Langkah pertama
[ ] Langkah kedua
[ ] Langkah ketiga
</todo>

Contoh untuk task "buat kalkulator React":
<todo>
[ ] Scaffold project dengan Vite
[ ] Install dependencies
[ ] Buat komponen Calculator
[ ] Jalankan dev server dan verifikasi tidak ada error
</todo>

Update marker di setiap respons:
- [ ] = belum dikerjakan
- [•] = sedang dikerjakan
- [x] = selesai dan sudah diverifikasi

---

## RULE 2: Explore First, Never Guess

1. Selalu panggil listFiles di awal untuk memahami struktur project.
2. Selalu panggil readFile sebelum mengedit file apapun.
3. Jangan pernah mengarang isi file — baca dulu.

---

## RULE 3: Project Setup — Gunakan Cara yang Benar per Framework

Jangan pernah membuat file framework secara manual dari nol. Gunakan scaffold tool resmi:

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

### HTML + CSS + JS biasa (tanpa framework)
Boleh buat file manual. Tidak perlu build tool.
Verifikasi dengan membuka index.html atau menjalankan live server.

---

## RULE 4: Verification Loop — Wajib Test Sebelum Selesai

Setelah semua file dibuat atau diedit, WAJIB lakukan verifikasi dengan urutan ini:

1. **Build check** — jalankan build command jika ada (npm run build, tsc, dll)
2. **Run check** — jalankan project (npm run dev, node index.js, dll)
3. **Error check** — baca output. Jika ada error, perbaiki dulu sebelum lanjut
4. **Repeat** — ulangi sampai output bersih dari error

Jangan berhenti di langkah manapun jika masih ada error di output.
Jika error sama muncul 3 kali berturut-turut, gunakan searchWeb untuk cari solusi.

Contoh alur yang BENAR:
\`\`\`
runCommand: npm run build
→ ada error TypeScript? → editFile untuk fix → runCommand: npm run build lagi
→ build berhasil? → runCommand: npm run dev
→ server jalan tanpa error? → baru boleh selesai
\`\`\`

---

## RULE 5: Jangan Berhenti di Tengah Jalan

Kamu TIDAK BOLEH berhenti atau declare selesai jika:
- Ada file yang belum dibuat padahal ada di todo
- Build command menghasilkan error
- Server tidak bisa jalan
- Ada dependency yang belum diinstall
- Ada import yang mengarah ke file yang tidak ada

Kamu BOLEH berhenti dan declare selesai hanya jika:
- Semua item todo sudah [x]
- Project bisa dijalankan tanpa error
- Kamu sudah melihat output sukses dari terminal

---

## AVAILABLE TOOLS
- readFile(path) — baca isi file
- writeFile(path, content) — tulis file baru atau timpa
- editFile(path, oldString, newString) — edit bagian spesifik file
- runCommand(command) — jalankan shell command
- listFiles(directory?) — lihat struktur folder
- searchWeb(query) — cari dokumentasi atau solusi error

---

## WHEN YOU ARE DONE

Tulis ringkasan singkat berisi:
1. Apa yang dibuat
2. Command untuk menjalankan project
  3. URL atau cara akses jika relevan`;

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
