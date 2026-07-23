import type {
  CreateSpriteOptions,
  NetworkPolicy,
  Sprite,
  SpritesClient,
} from "@fly/sprites";
import type { Tool } from "@openrouter/agent";

export type SpriteToolName =
  | "exec"
  | "readFile"
  | "writeFile"
  | "applyPatch"
  | "listDirectory"
  | "searchFiles"
  | "startProcess"
  | "processStatus"
  | "stopProcess";

export type SpriteToolPreset = "minimal" | "coding";

export interface SpriteLimits {
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
  maxReadBytes?: number;
  maxSearchResults?: number;
}
export interface ResolvedSpriteLimits {
  commandTimeoutMs: number;
  maxOutputBytes: number;
  maxReadBytes: number;
  maxSearchResults: number;
}

export interface SpriteToolSelection {
  preset?: SpriteToolPreset;
  include?: readonly SpriteToolName[];
  exclude?: readonly SpriteToolName[];
  requireApproval?: Partial<Record<SpriteToolName, boolean>>;
}

export interface ExistingSpriteTarget {
  sprite: Sprite;
}

export interface NamedSpriteTarget {
  client: SpritesClient;
  name: string;
  create?: "never" | "if-missing";
  createOptions?: CreateSpriteOptions;
}

export type SpriteWorkspaceEvent =
  | { type: "workspace.opened"; sprite: string; created: boolean }
  | { type: "workspace.closed"; sprite: string }
  | { type: "workspace.destroyed"; sprite: string }
  | { type: "checkpoint.created"; sprite: string; id: string }
  | { type: "checkpoint.restored"; sprite: string; id: string }
  | { type: "tool.started"; sprite: string; tool: string; callId: string }
  | {
      type: "tool.finished";
      sprite: string;
      tool: string;
      callId: string;
      ok: boolean;
      durationMs: number;
      truncated: boolean;
    };

export interface CreateSpriteWorkspaceOptions {
  target: ExistingSpriteTarget | NamedSpriteTarget;
  cwd?: string;
  environment?: Readonly<Record<string, string>>;
  checkpoint?: false | "on-open";
  networkPolicy?: "preserve" | NetworkPolicy;
  limits?: SpriteLimits;
  concurrency?: "serialize-mutations" | "parallel";
  onEvent?: (event: SpriteWorkspaceEvent) => void | Promise<void>;
}

export interface CreateSpriteToolsOptions extends SpriteToolSelection {
  sprite: Sprite;
  cwd?: string;
  environment?: Readonly<Record<string, string>>;
  limits?: SpriteLimits;
  concurrency?: "serialize-mutations" | "parallel";
  onEvent?: (event: SpriteWorkspaceEvent) => void | Promise<void>;
}

export interface SpriteCheckpoint {
  id: string;
  comment?: string;
  createdAt?: Date;
}

export interface SpriteWorkspace {
  readonly sprite: Sprite;
  readonly name: string;
  readonly cwd: string;

  tools(selection?: SpriteToolSelection): readonly Tool[];
  checkpoint(comment?: string): Promise<SpriteCheckpoint>;
  restore(checkpointId: string): Promise<void>;
  close(): Promise<void>;
  destroy(): Promise<void>;
}

export interface SpriteToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: SpriteToolErrorCode;
    message: string;
    retryable: boolean;
  };
  meta: {
    durationMs: number;
    truncated: boolean;
    fullOutputPath?: string;
  };
}

export type SpriteToolErrorCode =
  | "command_failed"
  | "timed_out"
  | "cancelled"
  | "not_found"
  | "invalid_path"
  | "output_limit"
  | "session_not_found"
  | "transport_error"
  | "permission_denied"
  | "unknown_error";

export class SpriteWorkspaceNotFoundError extends Error {
  readonly code = "sprite_not_found";

  constructor(readonly spriteName: string, options?: ErrorOptions) {
    super(`Sprite "${spriteName}" was not found`, options);
    this.name = "SpriteWorkspaceNotFoundError";
  }
}
