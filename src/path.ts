import path from "node:path";

export class InvalidSpritePathError extends Error {
  readonly code = "invalid_path";

  constructor(readonly requestedPath: string, readonly cwd: string) {
    super(`Path "${requestedPath}" resolves outside workspace cwd "${cwd}"`);
    this.name = "InvalidSpritePathError";
  }
}
export function normalizeCwd(cwd: string): string {
  return path.posix.resolve("/", cwd);
}

export function resolveWorkspacePath(cwd: string, requestedPath: string): string {
  const root = normalizeCwd(cwd);
  const resolved = path.posix.resolve(root, requestedPath);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new InvalidSpritePathError(requestedPath, root);
  }
  return resolved;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
