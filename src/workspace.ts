import type { Checkpoint, Sprite } from "@fly/sprites";
import type { Tool } from "@openrouter/agent";
import { normalizeCwd } from "./path.js";
import { createToolRuntime, ToolRuntime } from "./tools.js";
import type {
  CreateSpriteWorkspaceOptions,
  NamedSpriteTarget,
  SpriteCheckpoint,
  SpriteToolSelection,
  SpriteWorkspace,
  SpriteWorkspaceEvent,
} from "./types.js";
import { SpriteWorkspaceNotFoundError } from "./types.js";

async function emitSafely(
  callback: CreateSpriteWorkspaceOptions["onEvent"],
  event: SpriteWorkspaceEvent,
): Promise<void> {
  try {
    await callback?.(event);
  } catch {
    // Observability must never alter lifecycle behavior.
  }
}
function statusCode(error: unknown): number | undefined {
  return (error as { statusCode?: number } | null)?.statusCode;
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    statusCode(error) === 404 ||
    (error as { code?: unknown } | null)?.code === "ENOENT" ||
    /not[ -]?found/i.test(message)
  );
}

function isConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return statusCode(error) === 409 || /already exists|conflict/i.test(message);
}

async function resolveNamedTarget(
  target: NamedSpriteTarget,
): Promise<{ sprite: Sprite; created: boolean }> {
  try {
    return { sprite: await target.client.getSprite(target.name), created: false };
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  if ((target.create ?? "never") === "never") {
    throw new SpriteWorkspaceNotFoundError(target.name);
  }

  try {
    return {
      sprite: await target.client.createSprite(target.name, target.createOptions),
      created: true,
    };
  } catch (error) {
    if (!isConflict(error)) throw error;
    try {
      return { sprite: await target.client.getSprite(target.name), created: false };
    } catch (lookupError) {
      throw new Error(
        `Sprite "${target.name}" was created concurrently but could not be retrieved`,
        { cause: lookupError },
      );
    }
  }
}

function checkpointFromSdk(checkpoint: Checkpoint): SpriteCheckpoint {
  return {
    id: checkpoint.id,
    ...(checkpoint.comment === undefined ? {} : { comment: checkpoint.comment }),
    createdAt: checkpoint.createTime,
  };
}

class SpriteWorkspaceImpl implements SpriteWorkspace {
  readonly sprite: Sprite;
  readonly name: string;
  readonly cwd: string;
  readonly #runtime: ToolRuntime;
  readonly #onEvent: CreateSpriteWorkspaceOptions["onEvent"];
  readonly #hadControlConnection: boolean;
  #closed = false;
  #destroyed = false;

  constructor(
    sprite: Sprite,
    cwd: string,
    runtime: ToolRuntime,
    onEvent: CreateSpriteWorkspaceOptions["onEvent"],
  ) {
    this.sprite = sprite;
    this.name = sprite.name;
    this.cwd = cwd;
    this.#runtime = runtime;
    this.#onEvent = onEvent;
    this.#hadControlConnection = sprite.hasControlConnection();
  }

  tools(selection: SpriteToolSelection = {}): readonly Tool[] {
    if (this.#closed) throw new Error("The Sprite workspace is closed");
    return this.#runtime.createTools(selection);
  }

  checkpoint(comment?: string): Promise<SpriteCheckpoint> {
    return this.#runtime.runHostMutation(async () => {
      const before = new Set(
        (await this.sprite.listCheckpoints()).map((checkpoint) => checkpoint.id),
      );
      const stream = await this.sprite.createCheckpoint(comment);
      let streamedId: string | undefined;
      await stream.processAll((message) => {
        if (message.type === "error") {
          throw new Error(message.error ?? message.data ?? "Checkpoint creation failed");
        }
        const match = /\b(v\d+)\b/i.exec(message.data ?? "");
        if (match?.[1]) streamedId = match[1];
      });

      const checkpoints = await this.sprite.listCheckpoints();
      const created =
        checkpoints.find((candidate) => candidate.id === streamedId) ??
        checkpoints.find((candidate) => !before.has(candidate.id));
      if (!created) {
        throw new Error("Checkpoint completed without exposing a checkpoint ID");
      }
      const result = checkpointFromSdk(created);
      await emitSafely(this.#onEvent, {
        type: "checkpoint.created",
        sprite: this.name,
        id: result.id,
      });
      return result;
    });
  }

  restore(checkpointId: string): Promise<void> {
    return this.#runtime.runHostMutation(async () => {
      const stream = await this.sprite.restoreCheckpoint(checkpointId);
      await stream.processAll((message) => {
        if (message.type === "error") {
          throw new Error(message.error ?? message.data ?? "Checkpoint restore failed");
        }
      });
      await emitSafely(this.#onEvent, {
        type: "checkpoint.restored",
        sprite: this.name,
        id: checkpointId,
      });
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#runtime.close();
    if (!this.#hadControlConnection && this.sprite.hasControlConnection()) {
      this.sprite.closeControlConnection();
    }
    await emitSafely(this.#onEvent, {
      type: "workspace.closed",
      sprite: this.name,
    });
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    await this.close();
    await this.sprite.destroy();
    this.#destroyed = true;
    await emitSafely(this.#onEvent, {
      type: "workspace.destroyed",
      sprite: this.name,
    });
  }
}

export async function createSpriteWorkspace(
  options: CreateSpriteWorkspaceOptions,
): Promise<SpriteWorkspace> {
  const resolved =
    "sprite" in options.target
      ? { sprite: options.target.sprite, created: false }
      : await resolveNamedTarget(options.target);
  const cwd = normalizeCwd(options.cwd ?? "/workspace");

  if (options.networkPolicy && options.networkPolicy !== "preserve") {
    await resolved.sprite.updateNetworkPolicy(options.networkPolicy);
  }

  const runtime = createToolRuntime({
    sprite: resolved.sprite,
    cwd,
    environment: options.environment,
    limits: options.limits,
    concurrency: options.concurrency,
    onEvent: options.onEvent,
  });
  const workspace = new SpriteWorkspaceImpl(
    resolved.sprite,
    cwd,
    runtime,
    options.onEvent,
  );

  try {
    if (options.checkpoint === "on-open") await workspace.checkpoint();
  } catch (error) {
    await workspace.close();
    throw error;
  }

  await emitSafely(options.onEvent, {
    type: "workspace.opened",
    sprite: resolved.sprite.name,
    created: resolved.created,
  });
  return workspace;
}
