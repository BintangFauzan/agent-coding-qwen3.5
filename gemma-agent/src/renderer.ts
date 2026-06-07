const C = {
  reset:    "\x1b[0m",
  bold:     "\x1b[1m",
  dim:      "\x1b[2m",
  italic:   "\x1b[3m",
  green:    "\x1b[32m",
  red:      "\x1b[31m",
  yellow:   "\x1b[33m",
  blue:     "\x1b[34m",
  cyan:     "\x1b[36m",
  magenta:  "\x1b[35m",
  gray:     "\x1b[90m",
  white:    "\x1b[97m",
  bgGray:   "\x1b[100m",
};

const WIDTH = 60;

function repeat(char: string, n: number): string {
  return char.repeat(Math.max(0, n));
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function pad(str: string, width: number): string {
  const visible = stripAnsi(str).length;
  return str + repeat(" ", width - visible);
}

function renderHeading(line: string): string {
  const match = line.match(/^(#{1,3})\s+(.+)/);
  if (!match) return line;
  const level = match[1].length;
  const text = match[2];

  if (level === 1) {
    const bar = repeat("━", WIDTH);
    return (
      `\n${C.cyan}${C.bold}${bar}${C.reset}\n` +
      `${C.cyan}${C.bold}  ${text.toUpperCase()}${C.reset}\n` +
      `${C.cyan}${C.bold}${bar}${C.reset}`
    );
  }
  if (level === 2) {
    return `\n${C.blue}${C.bold}  ▸ ${text}${C.reset}`;
  }
  return `\n${C.gray}    › ${text}${C.reset}`;
}

function renderTable(lines: string[]): string {
  const rows = lines
    .filter((l) => !l.match(/^\s*\|[-:| ]+\|\s*$/))
    .map((l) =>
      l
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => cell.trim())
    );

  if (rows.length === 0) return "";

  const cols = rows[0].length;
  const widths: number[] = Array(cols).fill(0);
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      widths[i] = Math.max(widths[i], (row[i] ?? "").length);
    }
  }

  const totalWidth = widths.reduce((a, b) => a + b + 3, 1);
  const divider = `  ${C.gray}${"─".repeat(totalWidth - 2)}${C.reset}`;

  const result: string[] = ["\n", divider];

  rows.forEach((row, rowIdx) => {
    const cells = row
      .map((cell, i) => {
        const padded = pad(cell, widths[i]);
        if (rowIdx === 0) {
          return `${C.bold}${C.white} ${padded} ${C.reset}`;
        }
        const isKey = i === 0;
        return isKey
          ? `${C.cyan} ${padded} ${C.reset}`
          : `${C.gray} ${padded} ${C.reset}`;
      })
      .join(`${C.gray}│${C.reset}`);

    result.push(`  ${C.gray}│${C.reset}${cells}${C.gray}│${C.reset}`);

    if (rowIdx === 0) {
      result.push(divider);
    }
  });

  result.push(divider);
  return result.join("\n");
}

function renderCodeBlock(lang: string, code: string): string {
  const label = lang
    ? `${C.gray}  ╭─ ${C.cyan}${lang}${C.reset}`
    : `${C.gray}  ╭─ code${C.reset}`;

  const lines = code.trimEnd().split("\n");
  const numbered = lines.map((line, i) => {
    const num = String(i + 1).padStart(3, " ");
    return `${C.gray}  │${C.reset} ${C.gray}${num}${C.reset}  ${line}`;
  });

  return (
    `\n${label}\n` +
    `${C.gray}  │${C.reset}\n` +
    numbered.join("\n") +
    `\n${C.gray}  ╰${"─".repeat(40)}${C.reset}\n`
  );
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, `${C.bold}$1${C.reset}`)
    .replace(/\*(.+?)\*/g, `${C.italic}$1${C.reset}`)
    .replace(/`([^`]+)`/g, `${C.bgGray}${C.white} $1 ${C.reset}`);
}

function renderListItem(line: string, indent: number): string {
  const text = line.replace(/^[\s]*[-*+]\s+/, "");
  const spaces = repeat(" ", indent * 2 + 2);
  const bullet = indent === 0
    ? `${C.cyan}•${C.reset}`
    : `${C.gray}◦${C.reset}`;
  return `${spaces}${bullet} ${renderInline(text)}`;
}

function renderStatusLine(line: string): string {
  return line
    .replace(/✅/g, `${C.green}✓${C.reset}`)
    .replace(/❌/g, `${C.red}✗${C.reset}`)
    .replace(/⚠️?/g, `${C.yellow}⚠${C.reset}`)
    .replace(/✓/g, `${C.green}✓${C.reset}`)
    .replace(/✗/g, `${C.red}✗${C.reset}`);
}

function renderSeparator(): string {
  return `\n${C.gray}  ${"─".repeat(WIDTH - 2)}${C.reset}\n`;
}

export function renderResponse(text: string): string {
  text = text.replace(/<todo>[\s\S]*?<\/todo>/gi, "").trim();
  const lines = text.split("\n");
  const output: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.match(/^```(\w*)/)) {
      const lang = line.replace(/^```/, "").trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      output.push(renderCodeBlock(lang, codeLines.join("\n")));
      i++;
      continue;
    }

    if (line.match(/^\s*▸\s+\w+/)) {
      const lang = line.replace(/^\s*▸\s+/, "").trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^\s*▸\s+end/)) {
        codeLines.push(lines[i]);
        i++;
      }
      output.push(renderCodeBlock(lang, codeLines.join("\n")));
      i++;
      continue;
    }

    if (line.match(/^\s*\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*\|/)) {
        tableLines.push(lines[i]);
        i++;
      }
      output.push(renderTable(tableLines));
      continue;
    }

    if (line.match(/^#{1,3}\s/)) {
      output.push(renderHeading(line));
      i++;
      continue;
    }

    if (line.match(/^[-─]{3,}$/)) {
      output.push(renderSeparator());
      i++;
      continue;
    }

    if (line.match(/^[\s]*[-*+]\s+/)) {
      const indent = Math.floor(
        (line.match(/^(\s*)/)?.[1].length ?? 0) / 2
      );
      output.push(renderListItem(line, indent));
      i++;
      continue;
    }

    if (line.trim() === "") {
      output.push("");
      i++;
      continue;
    }

    output.push(renderStatusLine(renderInline("  " + line)));
    i++;
  }

  return output.join("\n");
}
