import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Dirent, Session, Sprite, SpriteCommand } from "@fly/sprites";
import { FilesystemError } from "@fly/sprites";
import { tool, type Tool } from "@openrouter/agent";
import { z } from "zod";
import { resolveLimits } from "./limits.js";
import {
  InvalidSpritePathError,
  normalizeCwd,
  resolveWorkspacePath,
  shellQuote,
} from "./path.js";
import { MutationScheduler } from "./scheduler.js";
import type {
  CreateSpriteToolsOptions,
  ResolvedSpriteLimits,
  SpriteToolErrorCode,
  SpriteToolName,
  SpriteToolResult,
  SpriteToolSelection,
  SpriteWorkspaceEvent,
} from "./types.js";

const MINIMAL_TOOLS: readonly SpriteToolName[] = [
  "exec",
  "readFile",
  "writeFile",
  "listDirectory",
];

const CODING_TOOLS: readonly SpriteToolName[] = [
  ...MINIMAL_TOOLS,
  "applyPatch",
  "searchFiles",
  "startProcess",
  "processStatus",
  "stopProcess",
];

const MUTATIONS = new Set<SpriteToolName>([
  "exec",
  "writeFile",
  "applyPatch",
  "startProcess",
  "stopProcess",
]);

const ExecInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const ReadFileInputSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

const WriteFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).optional(),
  createParents: z.boolean().optional(),
});

const ListDirectoryInputSchema = z.object({
  path: z.string().optional(),
});

const ApplyPatchInputSchema = z.object({
  patch: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
});

const SearchFilesInputSchema = z.object({
  query: z.string().min(1),
  path: z.string().optional(),
  regex: z.boolean().optional(),
});

const StartProcessInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
});

const ProcessStatusInputSchema = z.object({
  sessionId: z.string().min(1),
});

const StopProcessInputSchema = z.object({
  sessionId: z.string().min(1),
  signal: z.string().optional(),
  timeout: z.string().optional(),
});

interface RuntimeOptions {
  sprite: Sprite;
  cwd: string;
  environment: Readonly<Record<string, string>>;
  limits: ResolvedSpriteLimits;
  concurrency: "serialize-mutations" | "parallel";
  onEvent?: (event: SpriteWorkspaceEvent) => void | Promise<void>;
}

interface ExecData {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyError(error: unknown): {
  code: SpriteToolErrorCode;
  retryable: boolean;
} {
  if (error instanceof InvalidSpritePathError) {
    return { code: "invalid_path", retryable: false };
  }
  if (error instanceof FilesystemError) {
    if (error.code === "ENOENT") return { code: "not_found", retryable: false };
    if (error.code === "EACCES" || error.code === "EPERM") {
      return { code: "permission_denied", retryable: false };
    }
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOENT") return { code: "not_found", retryable: false };
  if (code === "EACCES" || code === "EPERM") {
    return { code: "permission_denied", retryable: false };
  }
  return { code: "transport_error", retryable: true };
}

function failure<T = unknown>(
  code: SpriteToolErrorCode,
  message: string,
  retryable: boolean,
  data?: T,
): SpriteToolResult<T> {
  return {
    ok: false,
    ...(data === undefined ? {} : { data }),
    error: { code, message, retryable },
    meta: { durationMs: 0, truncated: false },
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function takePrefix(value: string, budget: number): string {
  let result = "";
  let used = 0;
  for (const character of value) {
    const size = byteLength(character);
    if (used + size > budget) break;
    result += character;
    used += size;
  }
  return result;
}

function takeSuffix(value: string, budget: number): string {
  let result = "";
  let used = 0;
  const characters = Array.from(value);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    if (character === undefined) continue;
    const size = byteLength(character);
    if (used + size > budget) break;
    result = character + result;
    used += size;
  }
  return result;
}

function truncateText(value: string, budget: number): string {
  if (budget <= 0) return "";
  if (byteLength(value) <= budget) return value;
  const marker = "\n...[truncated]...\n";
  if (budget <= byteLength(marker)) return marker.slice(0, budget);
  const contentBudget = budget - byteLength(marker);
  const headBudget = Math.ceil(contentBudget / 2);
  const tailBudget = Math.floor(contentBudget / 2);
  return `${takePrefix(value, headBudget)}${marker}${takeSuffix(value, tailBudget)}`;
}

function boundOutput(
  stdout: string,
  stderr: string,
  maximum: number,
): { stdout: string; stderr: string; truncated: boolean } {
  const stdoutBytes = byteLength(stdout);
  const stderrBytes = byteLength(stderr);
  const total = stdoutBytes + stderrBytes;
  if (total <= maximum) return { stdout, stderr, truncated: false };

  let stdoutBudget = Math.floor((maximum * stdoutBytes) / total);
  let stderrBudget = maximum - stdoutBudget;
  if (stdoutBytes > 0 && stdoutBudget === 0) {
    stdoutBudget = 1;
    stderrBudget = Math.max(0, maximum - 1);
  }
  if (stderrBytes > 0 && stderrBudget === 0) {
    stderrBudget = 1;
    stdoutBudget = Math.max(0, maximum - 1);
  }
  return {
    stdout: truncateText(stdout, stdoutBudget),
    stderr: truncateText(stderr, stderrBudget),
    truncated: true,
  };
}

async function emitSafely(
  callback: RuntimeOptions["onEvent"],
  event: SpriteWorkspaceEvent,
): Promise<void> {
  try {
    await callback?.(event);
  } catch {
    // Observability must never change tool or lifecycle behavior.
  }
}

function selectedToolNames(selection: SpriteToolSelection): SpriteToolName[] {
  const preset = selection.preset ?? "minimal";
  const selected = new Set<SpriteToolName>(
    preset === "coding" ? CODING_TOOLS : MINIMAL_TOOLS,
  );
  for (const name of selection.include ?? []) selected.add(name);
  for (const name of selection.exclude ?? []) selected.delete(name);
  return CODING_TOOLS.filter((name) => selected.has(name));
}

function approvalOption(
  selection: SpriteToolSelection,
  name: SpriteToolName,
): { requireApproval: boolean } | Record<string, never> {
  const value = selection.requireApproval?.[name];
  return value === undefined ? {} : { requireApproval: value };
}

export class ToolRuntime {
  readonly sprite: Sprite;
  readonly cwd: string;
  readonly #environment: Readonly<Record<string, string>>;
  readonly #limits: ResolvedSpriteLimits;
  readonly #scheduler: MutationScheduler;
  readonly #onEvent: RuntimeOptions["onEvent"];
  readonly #cancellations = new Set<() => void>();
  #closed = false;

  constructor(options: RuntimeOptions) {
    this.sprite = options.sprite;
    this.cwd = normalizeCwd(options.cwd);
    this.#environment = { ...options.environment };
    this.#limits = options.limits;
    this.#scheduler = new MutationScheduler(options.concurrency);
    this.#onEvent = options.onEvent;
  }

  createTools(selection: SpriteToolSelection = {}): readonly Tool[] {
    return selectedToolNames(selection).map((name) => this.#createTool(name, selection));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const cancel of [...this.#cancellations]) cancel();
    await this.#scheduler.idle();
  }

  runHostMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new Error("The Sprite workspace is closed"));
    }
    return this.#scheduler.run("mutation", operation);
  }

  #createTool(name: SpriteToolName, selection: SpriteToolSelection): Tool {
    const approval = approvalOption(selection, name);
    switch (name) {
      case "exec":
        return tool({
          name: "sprite_exec",
          description: "Run a shell command in the Sprite workspace.",
          inputSchema: ExecInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#exec(input)),
        });
      case "readFile":
        return tool({
          name: "sprite_read_file",
          description: "Read a bounded range of a file beneath the workspace cwd.",
          inputSchema: ReadFileInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#readFile(input)),
        });
      case "writeFile":
        return tool({
          name: "sprite_write_file",
          description: "Write a complete file beneath the workspace cwd.",
          inputSchema: WriteFileInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#writeFile(input)),
        });
      case "listDirectory":
        return tool({
          name: "sprite_list_directory",
          description: "List structured directory entries beneath the workspace cwd.",
          inputSchema: ListDirectoryInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#listDirectory(input)),
        });
      case "applyPatch":
        return tool({
          name: "sprite_apply_patch",
          description: "Apply a unified patch relative to the workspace cwd.",
          inputSchema: ApplyPatchInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#applyPatch(input)),
        });
      case "searchFiles":
        return tool({
          name: "sprite_search_files",
          description: "Search text files beneath the workspace cwd.",
          inputSchema: SearchFilesInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#searchFiles(input)),
        });
      case "startProcess":
        return tool({
          name: "sprite_start_process",
          description: "Start a detachable shell process and return its Sprite session ID.",
          inputSchema: StartProcessInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#startProcess(input)),
        });
      case "processStatus":
        return tool({
          name: "sprite_process_status",
          description: "Read the current state of a detachable Sprite session.",
          inputSchema: ProcessStatusInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#processStatus(input)),
        });
      case "stopProcess":
        return tool({
          name: "sprite_stop_process",
          description: "Stop a detachable Sprite session.",
          inputSchema: StopProcessInputSchema,
          ...approval,
          execute: (input) => this.#invoke(name, () => this.#stopProcess(input)),
        });
    }
  }

  async #invoke(
    toolName: SpriteToolName,
    operation: () => Promise<SpriteToolResult>,
  ): Promise<SpriteToolResult> {
    const startedAt = performance.now();
    const callId = randomUUID();
    if (this.#closed) {
      return failure("cancelled", "The Sprite workspace is closed", false);
    }

    await emitSafely(this.#onEvent, {
      type: "tool.started",
      sprite: this.sprite.name,
      tool: toolName,
      callId,
    });

    let result: SpriteToolResult;
    try {
      result = await this.#scheduler.run(
        MUTATIONS.has(toolName) ? "mutation" : "read",
        operation,
      );
    } catch (error) {
      const classified = classifyError(error);
      result = failure(
        classified.code,
        messageOf(error),
        classified.retryable,
      );
    }

    result.meta.durationMs = Math.max(0, performance.now() - startedAt);
    await emitSafely(this.#onEvent, {
      type: "tool.finished",
      sprite: this.sprite.name,
      tool: toolName,
      callId,
      ok: result.ok,
      durationMs: result.meta.durationMs,
      truncated: result.meta.truncated,
    });
    return result;
  }

  async #exec(input: z.infer<typeof ExecInputSchema>): Promise<SpriteToolResult<ExecData>> {
    const cwd = resolveWorkspacePath(this.cwd, input.cwd ?? ".");
    const timeoutMs = Math.min(
      input.timeoutMs ?? this.#limits.commandTimeoutMs,
      this.#limits.commandTimeoutMs,
    );
    return this.#runForeground(input.command, cwd, timeoutMs, randomUUID());
  }

  async #runForeground(
    command: string,
    cwd: string,
    timeoutMs: number,
    callId: string,
  ): Promise<SpriteToolResult<ExecData>> {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let cancelled = false;
    let commandHandle: SpriteCommand;

    try {
      commandHandle = this.sprite.spawn("sh", ["-lc", command], {
        cwd,
        env: { ...this.#environment },
        maxRunAfterDisconnect: `${Math.max(1, Math.ceil(timeoutMs / 1_000))}s`,
      });
    } catch (error) {
      const classified = classifyError(error);
      return failure<ExecData>(classified.code, messageOf(error), classified.retryable);
    }

    const onStdout = (chunk: Buffer | string): void => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    const onStderr = (chunk: Buffer | string): void => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    commandHandle.stdout.on("data", onStdout);
    commandHandle.stderr.on("data", onStderr);

    let terminationTimer: NodeJS.Timeout | undefined;
    let settleTimer: NodeJS.Timeout | undefined;
    let forceSettle: () => void = () => {};
    const terminate = (): void => {
      try {
        commandHandle.kill("SIGTERM");
      } catch {
        // The command may already have disconnected.
      }
      terminationTimer = setTimeout(() => {
        try {
          commandHandle.kill("SIGKILL");
        } catch {
          // The command may already have exited.
        }
      }, 250);
      terminationTimer.unref();
    };
    const cancel = (): void => {
      cancelled = true;
      terminate();
      settleTimer = setTimeout(forceSettle, 2_000);
      settleTimer.unref();
    };
    this.#cancellations.add(cancel);

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      let settled = false;
      const settle = (code: number | null, error?: unknown): void => {
        if (settled) return;
        settled = true;
        if (error !== undefined) reject(error);
        else resolve(code);
      };
      forceSettle = () => settle(null);
      commandHandle.once("exit", (code: number) => settle(code));
      commandHandle.once("error", (error: unknown) => settle(null, error));
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
        settleTimer = setTimeout(() => settle(null), 2_000);
        settleTimer.unref();
      }, timeoutMs);
      timeout.unref();
      commandHandle.once("exit", () => clearTimeout(timeout));
      commandHandle.once("error", () => clearTimeout(timeout));
    }).catch((error: unknown) => error);

    this.#cancellations.delete(cancel);
    commandHandle.stdout.off("data", onStdout);
    commandHandle.stderr.off("data", onStderr);
    if (terminationTimer) clearTimeout(terminationTimer);
    if (settleTimer) clearTimeout(settleTimer);

    const stdout = Buffer.concat(stdoutChunks).toString("utf8");
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    const bounded = boundOutput(stdout, stderr, this.#limits.maxOutputBytes);
    const data: ExecData = {
      exitCode: typeof exitCode === "number" ? exitCode : null,
      stdout: bounded.stdout,
      stderr: bounded.stderr,
    };
    const meta: SpriteToolResult["meta"] = {
      durationMs: 0,
      truncated: bounded.truncated,
    };

    if (bounded.truncated) {
      try {
        const resultDirectory = resolveWorkspacePath(
          this.cwd,
          ".sprite-agent/results",
        );
        const outputPath = path.posix.join(resultDirectory, `${callId}.log`);
        const fullOutput = stderr.length === 0 ? stdout : `${stdout}${stderr}`;
        const filesystem = this.sprite.filesystem("/");
        await filesystem.mkdir(resultDirectory, { recursive: true });
        await filesystem.writeFile(outputPath, fullOutput);
        meta.fullOutputPath = outputPath;
      } catch {
        // Truncation remains useful even when overflow persistence fails.
      }
    }

    if (timedOut) {
      return {
        ok: false,
        data,
        error: {
          code: "timed_out",
          message: `Command exceeded ${timeoutMs}ms and was terminated`,
          retryable: true,
        },
        meta,
      };
    }
    if (cancelled) {
      return {
        ok: false,
        data,
        error: {
          code: "cancelled",
          message: "Command was cancelled because the workspace closed",
          retryable: true,
        },
        meta,
      };
    }
    if (exitCode instanceof Error || typeof exitCode !== "number") {
      return {
        ...failure("transport_error", messageOf(exitCode), true, data),
        meta,
      };
    }
    if (exitCode !== 0) {
      return {
        ok: false,
        data,
        error: {
          code: "command_failed",
          message: `Command exited with code ${exitCode}`,
          retryable: false,
        },
        meta,
      };
    }
    return { ok: true, data, meta };
  }

  async #readFile(
    input: z.infer<typeof ReadFileInputSchema>,
  ): Promise<SpriteToolResult> {
    const filePath = resolveWorkspacePath(this.cwd, input.path);
    const offset = input.offset ?? 0;
    const limit = Math.min(input.limit ?? this.#limits.maxReadBytes, this.#limits.maxReadBytes);
    const content = await this.sprite.filesystem("/").readFile(filePath);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const selected = bytes.subarray(offset, offset + limit);
    const binary = selected.includes(0);
    return {
      ok: true,
      data: {
        content: binary ? selected.toString("base64") : selected.toString("utf8"),
        encoding: binary ? "base64" : "utf8",
        size: bytes.length,
        offset,
        bytesRead: selected.length,
        more: offset + selected.length < bytes.length,
      },
      meta: {
        durationMs: 0,
        truncated: offset + selected.length < bytes.length,
      },
    };
  }

  async #writeFile(
    input: z.infer<typeof WriteFileInputSchema>,
  ): Promise<SpriteToolResult> {
    const filePath = resolveWorkspacePath(this.cwd, input.path);
    const filesystem = this.sprite.filesystem("/");
    if (input.createParents ?? true) {
      await filesystem.mkdir(path.posix.dirname(filePath), { recursive: true });
    }
    const data =
      input.encoding === "base64"
        ? Buffer.from(input.content, "base64")
        : input.content;
    await filesystem.writeFile(filePath, data);
    return {
      ok: true,
      data: { path: filePath, bytesWritten: Buffer.byteLength(data) },
      meta: { durationMs: 0, truncated: false },
    };
  }

  async #listDirectory(
    input: z.infer<typeof ListDirectoryInputSchema>,
  ): Promise<SpriteToolResult> {
    const directory = resolveWorkspacePath(this.cwd, input.path ?? ".");
    const filesystem = this.sprite.filesystem("/");
    const dirents = await filesystem.readdir(directory, { withFileTypes: true });
    const entries = await Promise.all(
      dirents.map(async (entry) => {
        const entryPath = path.posix.join(directory, entry.name);
        let size: number | undefined;
        try {
          size = (await filesystem.stat(entryPath)).size;
        } catch {
          // An entry can disappear between readdir and stat.
        }
        return {
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory()
            ? "directory"
            : entry.isSymbolicLink()
              ? "symlink"
              : "file",
          ...(size === undefined ? {} : { size }),
        };
      }),
    );
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return {
      ok: true,
      data: { path: directory, entries },
      meta: { durationMs: 0, truncated: false },
    };
  }

  async #applyPatch(
    input: z.infer<typeof ApplyPatchInputSchema>,
  ): Promise<SpriteToolResult> {
    for (const line of input.patch.split("\n")) {
      const match = /^(?:---|\+\+\+)\s+([^\t\s]+)/.exec(line);
      const patchPath = match?.[1];
      if (!patchPath || patchPath === "/dev/null") continue;
      resolveWorkspacePath(this.cwd, patchPath.replace(/^[ab]\//, ""));
    }
    const patchDirectory = resolveWorkspacePath(this.cwd, ".sprite-agent/patches");
    const patchPath = path.posix.join(patchDirectory, `${randomUUID()}.patch`);
    const filesystem = this.sprite.filesystem("/");
    await filesystem.mkdir(patchDirectory, { recursive: true });
    await filesystem.writeFile(patchPath, input.patch);
    try {
      const timeout = Math.min(
        input.timeoutMs ?? this.#limits.commandTimeoutMs,
        this.#limits.commandTimeoutMs,
      );
      return await this.#runForeground(
        `patch --batch -p1 -i ${shellQuote(patchPath)}`,
        this.cwd,
        timeout,
        randomUUID(),
      );
    } finally {
      try {
        await filesystem.rm(patchPath, { force: true });
      } catch {
        // Patch cleanup is best effort.
      }
    }
  }

  async #searchFiles(
    input: z.infer<typeof SearchFilesInputSchema>,
  ): Promise<SpriteToolResult> {
    const root = resolveWorkspacePath(this.cwd, input.path ?? ".");
    const filesystem = this.sprite.filesystem("/");
    const matcher = input.regex ? new RegExp(input.query, "g") : undefined;
    const matches: Array<{
      file: string;
      line: number;
      column: number;
      preview: string;
    }> = [];
    let truncated = false;

    const visit = async (directory: string): Promise<void> => {
      if (truncated) return;
      const entries = await filesystem.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (truncated) break;
        const entryPath = path.posix.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        let raw: Buffer;
        try {
          const content = await filesystem.readFile(entryPath);
          raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
        } catch {
          continue;
        }
        if (raw.length > 1_048_576 || raw.includes(0)) continue;
        const lines = raw.toString("utf8").split("\n");
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex] ?? "";
          if (matcher) matcher.lastIndex = 0;
          const column = matcher
            ? (matcher.exec(line)?.index ?? -1)
            : line.indexOf(input.query);
          if (column < 0) continue;
          if (matches.length >= this.#limits.maxSearchResults) {
            truncated = true;
            break;
          }
          matches.push({
            file: entryPath,
            line: lineIndex + 1,
            column: column + 1,
            preview: line,
          });
        }
      }
    };

    const rootStat = await filesystem.stat(root);
    if (rootStat.isDirectory()) await visit(root);
    else {
      const parent = path.posix.dirname(root);
      const name = path.posix.basename(root);
      const entry: Dirent = {
        name,
        parentPath: parent,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
      void entry;
      const content = await filesystem.readFile(root);
      const lines = (Buffer.isBuffer(content) ? content : Buffer.from(content))
        .toString("utf8")
        .split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? "";
        if (matcher) matcher.lastIndex = 0;
        const column = matcher ? (matcher.exec(line)?.index ?? -1) : line.indexOf(input.query);
        if (column >= 0) {
          if (matches.length >= this.#limits.maxSearchResults) {
            truncated = true;
            break;
          }
          matches.push({ file: root, line: lineIndex + 1, column: column + 1, preview: line });
        }
      }
    }
    return {
      ok: true,
      data: { matches },
      meta: { durationMs: 0, truncated },
    };
  }

  async #startProcess(
    input: z.infer<typeof StartProcessInputSchema>,
  ): Promise<SpriteToolResult> {
    const cwd = resolveWorkspacePath(this.cwd, input.cwd ?? ".");
    const before = new Set((await this.sprite.listSessions()).map((session) => session.id));
    const command = this.sprite.createSession("sh", ["-lc", input.command], {
      cwd,
      env: { ...this.#environment },
    });
    await new Promise<void>((resolve, reject) => {
      command.once("spawn", resolve);
      command.once("error", reject);
    });

    let session: Session | undefined;
    for (let attempt = 0; attempt < 20 && !session; attempt += 1) {
      const sessions = await this.sprite.listSessions();
      session = sessions.find((candidate) => !before.has(candidate.id));
      if (!session) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!session) {
      return failure(
        "transport_error",
        "The detachable process started but its session ID was not discoverable",
        true,
      );
    }
    return {
      ok: true,
      data: { sessionId: session.id, running: session.isActive },
      meta: { durationMs: 0, truncated: false },
    };
  }

  async #processStatus(
    input: z.infer<typeof ProcessStatusInputSchema>,
  ): Promise<SpriteToolResult> {
    const session = (await this.sprite.listSessions()).find(
      (candidate) => candidate.id === input.sessionId,
    );
    if (!session) {
      return failure("session_not_found", `Session "${input.sessionId}" was not found`, false);
    }
    return {
      ok: true,
      data: {
        sessionId: session.id,
        running: session.isActive,
        command: session.command,
        cwd: session.workdir,
        createdAt: session.created.toISOString(),
        lastActivity: session.lastActivity?.toISOString(),
      },
      meta: { durationMs: 0, truncated: false },
    };
  }

  async #stopProcess(
    input: z.infer<typeof StopProcessInputSchema>,
  ): Promise<SpriteToolResult> {
    const session = (await this.sprite.listSessions()).find(
      (candidate) => candidate.id === input.sessionId,
    );
    if (!session) {
      return failure("session_not_found", `Session "${input.sessionId}" was not found`, false);
    }
    const stream = await this.sprite.killSession(
      input.sessionId,
      input.signal,
      input.timeout,
    );
    let exitCode: number | undefined;
    await stream.processAll((event) => {
      if (event.type === "error") throw new Error(event.message ?? "Session stop failed");
      if (event.exitCode !== undefined) exitCode = event.exitCode;
    });
    return {
      ok: true,
      data: {
        sessionId: input.sessionId,
        running: false,
        ...(exitCode === undefined ? {} : { exitCode }),
      },
      meta: { durationMs: 0, truncated: false },
    };
  }
}

export function createToolRuntime(options: CreateSpriteToolsOptions): ToolRuntime {
  return new ToolRuntime({
    sprite: options.sprite,
    cwd: options.cwd ?? "/workspace",
    environment: options.environment ?? {},
    limits: resolveLimits(options.limits),
    concurrency: options.concurrency ?? "serialize-mutations",
    onEvent: options.onEvent,
  });
}

export function createSpriteTools(
  options: CreateSpriteToolsOptions,
): readonly Tool[] {
  const runtime = createToolRuntime(options);
  return runtime.createTools(options);
}
