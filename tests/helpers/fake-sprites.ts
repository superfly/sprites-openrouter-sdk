import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import type {
  Checkpoint,
  CreateSpriteOptions,
  Dirent,
  NetworkPolicy,
  Session,
  SpawnOptions,
  Sprite,
  SpriteCommand,
  SpriteFilesystem,
  SpritesClient,
  Stats,
  StreamMessage,
} from "@fly/sprites";

export interface CommandBehavior {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  hang?: boolean;
  error?: Error;
}

export class FakeCommand extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly signals: string[] = [];
  #exited = false;

  constructor(readonly behavior: CommandBehavior) {
    super();
    queueMicrotask(() => {
      if (behavior.error) {
        this.emit("error", behavior.error);
        return;
      }
      this.emit("spawn");
      if (behavior.hang) return;
      this.finish(behavior.exitCode ?? 0);
    });
  }

  finish(code: number): void {
    if (this.#exited) return;
    this.#exited = true;
    if (this.behavior.stdout) this.stdout.write(this.behavior.stdout);
    if (this.behavior.stderr) this.stderr.write(this.behavior.stderr);
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code);
  }

  kill(signal = "SIGTERM"): void {
    this.signals.push(signal);
    this.finish(signal === "SIGKILL" ? 137 : 143);
  }

  wait(): Promise<number> {
    if (this.#exited) return Promise.resolve(this.behavior.exitCode ?? 0);
    return new Promise((resolve) => this.once("exit", resolve));
  }
}

function directoryStats(): Stats {
  const now = new Date();
  return {
    size: 0,
    mode: 0o755,
    mtime: now,
    atime: now,
    birthtime: now,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  };
}

function fileStats(size: number): Stats {
  const now = new Date();
  return {
    size,
    mode: 0o644,
    mtime: now,
    atime: now,
    birthtime: now,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

export class FakeFilesystem {
  readonly files = new Map<string, Buffer>();
  readonly directories = new Set<string>(["/"]);
  failWrites = false;
  beforeRead?: (path: string) => void | Promise<void>;
  beforeWrite?: (path: string) => void | Promise<void>;

  normalize(value: string): string {
    return path.posix.resolve("/", value);
  }

  async readFile(value: string, encoding?: "utf8" | null): Promise<string | Buffer> {
    const normalized = this.normalize(value);
    await this.beforeRead?.(normalized);
    const content = this.files.get(normalized);
    if (!content) throw Object.assign(new Error(`ENOENT: ${normalized}`), { code: "ENOENT" });
    return encoding === "utf8" ? content.toString("utf8") : Buffer.from(content);
  }

  async writeFile(value: string, data: string | Buffer): Promise<void> {
    const normalized = this.normalize(value);
    await this.beforeWrite?.(normalized);
    if (this.failWrites) throw new Error("write failed");
    this.files.set(normalized, Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data));
    this.addParents(normalized);
  }

  async mkdir(value: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = this.normalize(value);
    if (!options?.recursive && !this.directories.has(path.posix.dirname(normalized))) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    this.addParents(path.posix.join(normalized, "placeholder"));
    this.directories.add(normalized);
  }

  async readdir(
    value: string,
    options?: { withFileTypes?: boolean },
  ): Promise<string[] | Dirent[]> {
    const normalized = this.normalize(value);
    if (!this.directories.has(normalized)) {
      throw Object.assign(new Error(`ENOENT: ${normalized}`), { code: "ENOENT" });
    }
    const names = new Set<string>();
    for (const directory of this.directories) {
      if (directory !== normalized && path.posix.dirname(directory) === normalized) {
        names.add(path.posix.basename(directory));
      }
    }
    for (const file of this.files.keys()) {
      if (path.posix.dirname(file) === normalized) names.add(path.posix.basename(file));
    }
    const sorted = [...names].sort();
    if (!options?.withFileTypes) return sorted;
    return sorted.map((name): Dirent => {
      const child = path.posix.join(normalized, name);
      const directory = this.directories.has(child);
      return {
        name,
        parentPath: normalized,
        isDirectory: () => directory,
        isFile: () => !directory,
        isSymbolicLink: () => false,
      };
    });
  }

  async stat(value: string): Promise<Stats> {
    const normalized = this.normalize(value);
    if (this.directories.has(normalized)) return directoryStats();
    const file = this.files.get(normalized);
    if (file) return fileStats(file.length);
    throw Object.assign(new Error(`ENOENT: ${normalized}`), { code: "ENOENT" });
  }

  async rm(value: string): Promise<void> {
    const normalized = this.normalize(value);
    this.files.delete(normalized);
    this.directories.delete(normalized);
  }

  addParents(file: string): void {
    let current = path.posix.dirname(file);
    while (!this.directories.has(current)) {
      this.directories.add(current);
      if (current === "/") break;
      current = path.posix.dirname(current);
    }
  }

  asSdk(): SpriteFilesystem {
    return this as unknown as SpriteFilesystem;
  }
}

class FakeStream {
  constructor(readonly messages: StreamMessage[] = []) {}

  async processAll(handler: (message: StreamMessage) => void | Promise<void>): Promise<void> {
    for (const message of this.messages) await handler(message);
  }
}

export class FakeSprite {
  readonly filesystemState = new FakeFilesystem();
  readonly commands: Array<{
    command: string;
    args: string[];
    options: SpawnOptions;
    handle: FakeCommand;
  }> = [];
  readonly sessions: Session[] = [];
  readonly checkpoints: Checkpoint[] = [];
  readonly checkpointSnapshots = new Map<string, Map<string, Buffer>>();
  readonly policies: NetworkPolicy[] = [];
  readonly behaviorQueue: CommandBehavior[] = [];
  destroyed = false;
  controlConnectionOpen = false;
  checkpointFailure?: Error;
  restoreFailure?: Error;

  constructor(readonly name = "test-sprite") {}

  queueCommand(behavior: CommandBehavior): void {
    this.behaviorQueue.push(behavior);
  }

  spawn(command: string, args: string[] = [], options: SpawnOptions = {}): SpriteCommand {
    const handle = new FakeCommand(this.behaviorQueue.shift() ?? this.inferBehavior(args));
    this.commands.push({ command, args, options, handle });
    return handle as unknown as SpriteCommand;
  }

  createSession(command: string, args: string[] = [], options: SpawnOptions = {}): SpriteCommand {
    const id = `session-${this.sessions.length + 1}`;
    this.sessions.push({
      id,
      command: [command, ...args].join(" "),
      workdir: options.cwd ?? "/",
      created: new Date(),
      bytesPerSecond: 0,
      isActive: true,
      tty: true,
    });
    return this.spawn(command, args, { ...options, detachable: true, tty: true });
  }

  async listSessions(): Promise<Session[]> {
    return this.sessions.map((session) => ({ ...session }));
  }

  async killSession(sessionId: string): Promise<unknown> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (session) session.isActive = false;
    return new FakeStream([{ type: "info", data: "complete" }]);
  }

  filesystem(): SpriteFilesystem {
    return this.filesystemState.asSdk();
  }

  async createCheckpoint(comment?: string): Promise<unknown> {
    if (this.checkpointFailure) throw this.checkpointFailure;
    const checkpoint: Checkpoint = {
      id: `v${this.checkpoints.length + 1}`,
      createTime: new Date(),
      ...(comment === undefined ? {} : { comment }),
    };
    this.checkpoints.unshift(checkpoint);
    this.checkpointSnapshots.set(
      checkpoint.id,
      new Map(
        [...this.filesystemState.files].map(([file, content]) => [
          file,
          Buffer.from(content),
        ]),
      ),
    );
    return new FakeStream([{ type: "info", data: `created ${checkpoint.id}` }]);
  }

  async listCheckpoints(): Promise<Checkpoint[]> {
    return this.checkpoints.map((checkpoint) => ({ ...checkpoint }));
  }

  async restoreCheckpoint(id: string): Promise<unknown> {
    if (this.restoreFailure) throw this.restoreFailure;
    const snapshot = this.checkpointSnapshots.get(id);
    if (snapshot) {
      this.filesystemState.files.clear();
      for (const [file, content] of snapshot) {
        this.filesystemState.files.set(file, Buffer.from(content));
      }
    }
    return new FakeStream([{ type: "info", data: "restored" }]);
  }

  async updateNetworkPolicy(policy: NetworkPolicy): Promise<void> {
    this.policies.push(policy);
  }

  hasControlConnection(): boolean {
    return this.controlConnectionOpen;
  }

  closeControlConnection(): void {
    this.controlConnectionOpen = false;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }

  asSdk(): Sprite {
    return this as unknown as Sprite;
  }

  inferBehavior(args: string[]): CommandBehavior {
    const command = args[1] ?? "";
    const printf = /^printf(?: '%s')?\s+['"]?([^'"]*)['"]?$/.exec(command);
    if (printf) return { stdout: printf[1] ?? "" };
    if (/exit\s+\d+/.test(command)) {
      const exitCode = Number(/exit\s+(\d+)/.exec(command)?.[1] ?? 1);
      const stderr = />&2\s*;?/.test(command) ? "bad input" : "";
      return { exitCode, stderr };
    }
    return {};
  }
}

export class FakeSpritesClient {
  readonly sprites = new Map<string, FakeSprite>();
  createCalls = 0;
  getCalls = 0;
  createConflict = false;

  async getSprite(name: string): Promise<Sprite> {
    this.getCalls += 1;
    const sprite = this.sprites.get(name);
    if (!sprite) throw Object.assign(new Error("not found"), { statusCode: 404 });
    return sprite.asSdk();
  }

  async createSprite(name: string, _options?: CreateSpriteOptions): Promise<Sprite> {
    this.createCalls += 1;
    if (this.createConflict) {
      this.createConflict = false;
      if (!this.sprites.has(name)) this.sprites.set(name, new FakeSprite(name));
      throw Object.assign(new Error("conflict"), { statusCode: 409 });
    }
    const sprite = new FakeSprite(name);
    this.sprites.set(name, sprite);
    return sprite.asSdk();
  }

  asSdk(): SpritesClient {
    return this as unknown as SpritesClient;
  }
}

export function executableTool(
  tools: readonly import("@openrouter/agent").Tool[],
  name: string,
): { function: { execute: (input: never) => Promise<unknown>; requireApproval?: boolean } } {
  const found = tools.find(
    (candidate) => "function" in candidate && candidate.function.name === name,
  );
  if (!found || !("function" in found) || !("execute" in found.function)) {
    throw new Error(`Tool ${name} was not found or executable`);
  }
  return found as unknown as {
    function: { execute: (input: never) => Promise<unknown>; requireApproval?: boolean };
  };
}
