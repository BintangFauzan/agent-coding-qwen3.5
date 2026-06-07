import { resolve, isAbsolute, normalize, sep } from "path";

let workspaceRoot: string | null = null;

export function initWorkspace(argv: string[] = process.argv): string {
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--workspace" || argv[i] === "-w") && argv[i + 1]) {
      workspaceRoot = normalize(resolve(argv[i + 1]));
      break;
    }
  }
  if (!workspaceRoot) {
    workspaceRoot = normalize(resolve(process.cwd()));
  }
  return workspaceRoot;
}

export function getWorkspaceRoot(): string {
  if (!workspaceRoot) {
    return initWorkspace();
  }
  return workspaceRoot;
}

export function resolvePath(userPath: string): string {
  const normalized = normalize(userPath);
  const abs = isAbsolute(normalized)
    ? resolve(normalized)
    : resolve(getWorkspaceRoot(), normalized);
  return normalize(abs);
}

export function validatePath(resolvedPath: string): void {
  const root = getWorkspaceRoot();
  const normalizedResolved = normalize(resolvedPath);
  const normalizedRoot = normalize(root);
  if (
    normalizedResolved !== normalizedRoot &&
    !normalizedResolved.startsWith(normalizedRoot + sep)
  ) {
    throw new Error(
      `Path '${resolvedPath}' is outside workspace '${root}'. Access denied.`
    );
  }
}
