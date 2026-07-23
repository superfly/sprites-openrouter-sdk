# RFC 0001: Sprite workspaces for the OpenRouter Agent SDK

- Status: Experimental implementation
- Repository: `superfly/sprites-openrouter-sdk`
- npm package: `@fly/sprites-openrouter`
- Foundation: `superfly/sprites-js` (published to npm as `@fly/sprites`)
- Authors: Fly.io Sprites
- Last updated: 2026-07-22

## Summary

`@fly/sprites-openrouter` gives an OpenRouter agent a persistent, isolated
computer backed by a Fly.io Sprite. Its source lives in
`superfly/sprites-openrouter-sdk`. It adapts the existing Sprites JavaScript SDK
from [`superfly/sprites-js`](https://github.com/superfly/sprites-js), published
to npm as `@fly/sprites`, into OpenRouter `tool()` definitions and optionally
manages the lifecycle of a named Sprite workspace.

## Repository and package map

| Role | GitHub repository | npm package |
|---|---|---|
| Foundational JavaScript SDK | [`superfly/sprites-js`](https://github.com/superfly/sprites-js) | `@fly/sprites` |
| OpenRouter integration described here | `superfly/sprites-openrouter-sdk` | `@fly/sprites-openrouter` (proposed) |

Repository names use the `superfly` GitHub organization. Package names use the
existing `@fly` npm scope. References to `@fly/sprites` in import examples
therefore mean the package built and published from `superfly/sprites-js`.

The package does not own the model loop, create an OpenRouter client, or store
conversation state. OpenRouter owns model orchestration and conversation state;
Sprites owns compute, files, processes, policies, and checkpoints.

## Product promise

A TypeScript developer who already has OpenRouter and Sprites credentials can
give an agent a reusable computer in a few lines, without implementing tool
schemas, output bounding, command/session translation, mutation ordering,
checkpoint handling, or Sprite reuse.

The first supported experience is a coding agent that can inspect and edit a
repository, install dependencies, run tests, and resume work in the same
filesystem during a later application request.

## Goals

1. Adapt a caller-supplied `Sprite` into type-safe OpenRouter tools.
2. Offer an optional create-or-reuse workspace experience.
3. Return structured, bounded, model-readable results.
4. Preserve the Sprite across application requests by default.
5. Serialize operations that may mutate one Sprite.
6. Keep host credentials and environment variables out of the Sprite unless
   explicitly configured.
7. Make destructive lifecycle operations explicit and host-controlled.
8. Support checkpoints as a recovery mechanism without exposing restore or
   destroy to the model by default.

## Non-goals

- Wrapping `OpenRouter` or `callModel()`.
- Choosing a model or implementing an agent loop.
- Persisting OpenRouter `ConversationState`.
- Providing a terminal UI, chat UI, or HTTP application framework.
- Acting as a generic sandbox interface for providers other than Sprites.
- Automatically managing application secrets.
- Treating a working directory as a security boundary when command execution is
  enabled.
- Exposing Sprite restore or destruction as agent tools in the first release.
- Providing distributed locking in the first release.

## Terminology

- **Sprites JS SDK**: The SDK developed in `superfly/sprites-js` and published
  to npm as `@fly/sprites`. This is the foundational SDK this package builds on.
- **Sprite**: The compute environment represented by `Sprite` from the Sprites
  JS SDK.
- **Workspace**: A package-owned handle that combines a Sprite with tool,
  lifecycle, limit, and concurrency configuration.
- **Run**: One application-level invocation of the OpenRouter agent loop.
- **Tool output**: Text and structured metadata returned to the model after a
  tool executes.
- **Mutation**: An operation that can change files, processes, installed
  software, or other Sprite state.

## User experience

### Managed workspace

```ts
import { OpenRouter, stepCountIs } from '@openrouter/agent';
import { SpritesClient } from '@fly/sprites';
import { createSpriteWorkspace } from '@fly/sprites-openrouter';

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const sprites = new SpritesClient(process.env.SPRITES_TOKEN!);

const workspace = await createSpriteWorkspace({
  target: {
    client: sprites,
    name: `agent-${conversationId}`,
    create: 'if-missing',
  },
  cwd: '/workspace',
  checkpoint: 'on-open',
  limits: {
    commandTimeoutMs: 120_000,
    maxOutputBytes: 64_000,
  },
});

try {
  const result = openrouter.callModel({
    model: 'anthropic/claude-sonnet-4',
    input: 'Clone the project, run its tests, and fix the failure.',
    tools: workspace.tools({ preset: 'coding' }),
    stopWhen: stepCountIs(20),
  });

  console.log(await result.getText());
} finally {
  await workspace.close();
}
```

`close()` releases adapter-owned resources but preserves the Sprite and its
filesystem. A later request can open the same name and continue working.

### Existing Sprite

```ts
import { createSpriteTools } from '@fly/sprites-openrouter';

const sprite = sprites.sprite('existing-workspace');

const tools = createSpriteTools({
  sprite,
  cwd: '/workspace',
  preset: 'minimal',
});

const result = openrouter.callModel({
  model: 'openai/gpt-5.2',
  input: 'Inspect the files in this workspace.',
  tools,
});
```

This form never creates, deletes, checkpoints, or changes the policies of the
Sprite.

## Proposed public API

The signatures below define the intended source-level contract. Imports use
`@fly/sprites` because that is the npm package published from
`superfly/sprites-js`; they do not refer to a separate SDK or repository. Exact
generic parameters may be refined during implementation without changing the
runtime behavior described by this RFC.

```ts
import type {
  CreateSpriteOptions,
  NetworkPolicy,
  Sprite,
  SpritesClient,
} from '@fly/sprites';
import type { Tool } from '@openrouter/agent';

export type SpriteToolName =
  | 'exec'
  | 'readFile'
  | 'writeFile'
  | 'applyPatch'
  | 'listDirectory'
  | 'searchFiles'
  | 'startProcess'
  | 'processStatus'
  | 'stopProcess';

export type SpriteToolPreset = 'minimal' | 'coding';

export interface SpriteLimits {
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
  maxReadBytes?: number;
  maxSearchResults?: number;
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
  create?: 'never' | 'if-missing';
  createOptions?: CreateSpriteOptions;
}

export interface CreateSpriteWorkspaceOptions {
  target: ExistingSpriteTarget | NamedSpriteTarget;
  cwd?: string;
  environment?: Readonly<Record<string, string>>;
  checkpoint?: false | 'on-open';
  networkPolicy?: 'preserve' | NetworkPolicy;
  limits?: SpriteLimits;
  concurrency?: 'serialize-mutations' | 'parallel';
  onEvent?: (event: SpriteWorkspaceEvent) => void | Promise<void>;
}

export interface CreateSpriteToolsOptions extends SpriteToolSelection {
  sprite: Sprite;
  cwd?: string;
  environment?: Readonly<Record<string, string>>;
  limits?: SpriteLimits;
  concurrency?: 'serialize-mutations' | 'parallel';
  onEvent?: (event: SpriteWorkspaceEvent) => void | Promise<void>;
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

export interface SpriteCheckpoint {
  id: string;
  comment?: string;
  createdAt?: Date;
}

export function createSpriteWorkspace(
  options: CreateSpriteWorkspaceOptions,
): Promise<SpriteWorkspace>;

export function createSpriteTools(
  options: CreateSpriteToolsOptions,
): readonly Tool[];
```

### Defaults

| Option | Default | Meaning |
|---|---|---|
| `cwd` | `/workspace` | Default path supplied to tools |
| named target `create` | `never` | Do not create infrastructure implicitly |
| `checkpoint` | `false` | Do not create checkpoints implicitly |
| `networkPolicy` | `preserve` | Do not change an existing policy |
| `concurrency` | `serialize-mutations` | Queue operations that may mutate the Sprite |
| `commandTimeoutMs` | `120000` | Stop a foreground command after two minutes |
| `maxOutputBytes` | `65536` | Bound combined model-facing stdout and stderr |
| `maxReadBytes` | `262144` | Bound one file-read result |
| `maxSearchResults` | `200` | Bound one search result set |
| tool preset | `minimal` | Provide the smallest generally useful tool set |

Defaults are part of the compatibility contract. Changing them requires a
major release unless the change only tightens a documented hard safety cap.

## Tool selection

`minimal` contains:

- `exec`
- `readFile`
- `writeFile`
- `listDirectory`

`coding` contains:

- Every `minimal` tool
- `applyPatch`
- `searchFiles`
- `startProcess`
- `processStatus`
- `stopProcess`

`include` adds tools after the preset is expanded. `exclude` is applied last.
A tool named in both is excluded. Duplicate names are removed while preserving
the preset's stable order.

The OpenRouter-visible names are:

| API name | Model-visible name | Mutation? |
|---|---|---|
| `exec` | `sprite_exec` | Yes |
| `readFile` | `sprite_read_file` | No |
| `writeFile` | `sprite_write_file` | Yes |
| `applyPatch` | `sprite_apply_patch` | Yes |
| `listDirectory` | `sprite_list_directory` | No |
| `searchFiles` | `sprite_search_files` | No |
| `startProcess` | `sprite_start_process` | Yes |
| `processStatus` | `sprite_process_status` | No |
| `stopProcess` | `sprite_stop_process` | Yes |

Tool order is stable so callers can snapshot and reason about the tool list.

## Tool contracts

### Common result envelope

Every tool returns a JSON-serializable envelope instead of returning raw SDK
objects.

```ts
export interface SpriteToolResult<T> {
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
  | 'command_failed'
  | 'timed_out'
  | 'cancelled'
  | 'not_found'
  | 'invalid_path'
  | 'output_limit'
  | 'session_not_found'
  | 'transport_error'
  | 'permission_denied'
  | 'unknown_error';
```

A normal program exit with a non-zero code is returned as
`ok: false`, `error.code: 'command_failed'`, and includes the captured stdout,
stderr, and exit code in `data`. It is not thrown as a JavaScript exception.

Configuration and programmer errors may reject before a tool is passed to
OpenRouter. Failures encountered while executing a valid model tool call should
be returned in the envelope whenever possible so the model can recover.

### `sprite_exec`

Executes one shell command. The model input does not accept a host environment
map.

```ts
interface ExecInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

interface ExecData {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
```

The requested timeout is clamped to the configured workspace maximum. The
configured `environment` is the only host-provided environment merged into the
command environment.

Foreground execution uses
`sprite.spawn('sh', ['-lc', command], { cwd, env, maxRunAfterDisconnect })`.
The adapter consumes stdout and stderr incrementally, bounds model-facing
output, sets `maxRunAfterDisconnect` from the effective timeout, sends TERM and
then KILL when the timeout expires, and releases listeners and timers on every
settlement path. Shell syntax is therefore intentionally supported, and `cwd`
is not a security boundary.

### Filesystem tools

Filesystem tools resolve relative paths against `cwd`, normalize `.` and `..`,
and reject resolved paths outside `cwd`. This restriction is an API guardrail,
not a VM security boundary because `sprite_exec` can access other Sprite paths.

`sprite_read_file` supports a byte offset and byte limit. It reports whether
more content remains. Binary content is returned as base64 with an explicit
encoding field.

`sprite_write_file` writes complete content and can create parent directories.
It does not append by default.

`sprite_apply_patch` accepts a unified patch and applies it relative to `cwd`.
Paths that escape `cwd` are rejected before mutation.

`sprite_list_directory` returns structured entries with name, path, type, and
size when available.

`sprite_search_files` returns bounded structured matches with file, line,
column, and preview. Search limit truncation is explicit in `meta.truncated`.

### Process tools

`sprite_start_process` starts a detachable Sprite exec session and returns its
Sprite session ID. `sprite_process_status` reports the metadata exposed by
`Sprite.listSessions()`, including whether the session is active.
`sprite_stop_process` consumes the kill stream to completion and reports the
final known state and exit code when the stream supplies one.

The released `@fly/sprites@0.1.0` session-list API does not expose historical
session output, so this adapter does not claim to recover it. Applications that
need durable background-process logs should direct the process output to a
workspace file and read that file with `sprite_read_file`.

Session IDs, rather than adapter-process-local IDs, are exposed so another
application request can reconnect to the same process.

## Output bounding

`maxOutputBytes` applies to the combined UTF-8 byte length of model-facing
stdout and stderr for command and process tools.

When output exceeds the limit:

1. Preserve useful content from both the beginning and end.
2. Insert a visible omission marker.
3. Set `meta.truncated` to `true`.
4. Persist the complete output beneath
   `<cwd>/.sprite-agent/results/<tool-call-id>.log` when persistence succeeds.
5. Return that path in `meta.fullOutputPath`.

Failure to persist overflow must not replace an otherwise valid command result.
The result remains truncated and omits `fullOutputPath`.

## Concurrency

OpenRouter may request multiple tools in one turn. With the default
`serialize-mutations` policy:

- Mutations run one at a time in request-arrival order.
- A read waits for earlier queued mutations to finish.
- New mutations wait for active reads to finish.
- Reads with no earlier queued mutation may run concurrently.
- A timed-out or failed mutation releases the queue.

The queue is scoped to one workspace instance and is not a distributed lock.
Applications must route one Sprite workspace to one application worker at a
time until a pluggable lock provider is added.

`parallel` is an explicit escape hatch and permits all tool implementations to
start immediately.

## Workspace lifecycle

### Existing target

An `ExistingSpriteTarget` is never created, destroyed, checkpointed, or modified
outside explicit workspace method calls. `close()` only releases adapter-owned
resources.

### Named target

With `create: 'never'`, opening a missing Sprite rejects with a typed not-found
error.

With `create: 'if-missing'`, the package:

1. Looks up the Sprite by name.
2. Creates it with `createOptions` if it does not exist.
3. Handles a concurrent-create conflict by looking it up once more.
4. Returns an error if the Sprite still cannot be obtained.

The package does not invent workspace ownership. The application chooses the
name and therefore whether a Sprite corresponds to a conversation, user,
project, or job.

### Closing and destruction

`close()` is idempotent. It prevents new tool calls, waits for in-flight
foreground operations to settle or cancel, releases local queues/listeners, and
preserves the Sprite. Detachable Sprite sessions remain running.

`destroy()` is explicit, idempotent, closes the workspace, and deletes the
Sprite. It is never called by `close()`, garbage collection, process shutdown,
or a failed OpenRouter run.

## Checkpoints

With `checkpoint: 'on-open'`, a checkpoint is created after the Sprite is
resolved and configured but before the workspace factory resolves. Failure to
create it rejects the factory; callers never receive a workspace that was
promised a recovery point but lacks one.

`workspace.checkpoint(comment)` consumes the Sprite checkpoint stream through
EOF, then resolves the new ID from `listCheckpoints()`. `workspace.restore(id)`
consumes the restore stream through EOF. The released SDK's `StreamMessage`
union has `info`, `stdout`, `stderr`, and `error` events; stream completion is
represented by EOF rather than a typed `complete` event.

Restore is host-controlled and is not included in any tool preset.

## Environment, policies, and secrets

The adapter does not copy `process.env`. Only values in the `environment`
option are provided to Sprite commands. In particular, `SPRITES_TOKEN` and
`OPENROUTER_API_KEY` are not inherited implicitly.

`networkPolicy: 'preserve'` performs no policy update. Supplying an explicit
policy applies that policy when the workspace opens and before an on-open
checkpoint is created.

The package should support additional resource and privilege policy options
once the corresponding stable Sprites JS SDK TypeScript types are confirmed.
They are intentionally omitted from this first contract rather than represented
with untyped objects.

## Approvals

`requireApproval` maps directly onto OpenRouter's tool-level approval behavior.
The package defaults all first-release agent tools to no approval because their
effects occur inside an isolated Sprite. Applications can require approval for
any selected tool.

Restore and destroy are host methods, not agent tools, and therefore cannot be
requested by the model through this package.

## Events and observability

The optional `onEvent` hook receives metadata events without command output or
file contents by default.

```ts
export type SpriteWorkspaceEvent =
  | { type: 'workspace.opened'; sprite: string; created: boolean }
  | { type: 'workspace.closed'; sprite: string }
  | { type: 'workspace.destroyed'; sprite: string }
  | { type: 'checkpoint.created'; sprite: string; id: string }
  | { type: 'checkpoint.restored'; sprite: string; id: string }
  | { type: 'tool.started'; sprite: string; tool: string; callId: string }
  | {
      type: 'tool.finished';
      sprite: string;
      tool: string;
      callId: string;
      ok: boolean;
      durationMs: number;
      truncated: boolean;
    };
```

An event callback failure does not fail the associated tool or lifecycle
operation. It may be reported through a diagnostic logger added in a later RFC.

## Packaging and compatibility

- Package format: ESM with TypeScript declarations.
- Runtime: Node.js 24 or later, aligned with the Sprites JS SDK.
- `@fly/sprites` (published from `superfly/sprites-js`) and
  `@openrouter/agent` are peer dependencies.
- Zod compatibility must match the supported `@openrouter/agent` release.
- The package imports public SDK entry points only.
- Supported peer-version ranges are verified in CI with type and integration
  tests.

## Release boundary

### Included in `0.1.0`

- `createSpriteTools()` for an existing Sprite.
- Minimal tool preset.
- Structured results and output bounds.
- Mutation serialization.
- Fake-Sprite contract tests.
- One live Sprite integration profile.
- `createSpriteWorkspace()`.
- Named create-or-reuse lifecycle.
- Explicit close and destroy.
- Checkpoint-on-open and restore methods.
- Network policy application.
- Coding preset, including detachable process tools.
- Multi-request persistence example.
- Cancellation and failure recovery coverage.

### Required before `1.0.0`

- Compatibility matrix for supported peer versions.
- Every applicable `@mvp @live` acceptance scenario passing in credentialed
  release CI.

## Alternatives considered

### Documentation example only

A short `tool({ execute: () => sprite.exec(...) })` example is useful but does
not standardize output limits, mutation ordering, process sessions, lifecycle,
or rollback. Those cross-cutting behaviors justify a package.

### Add OpenRouter directly to the Sprites JS SDK

This would add framework-specific dependencies and release coupling to the core
SDK in `superfly/sprites-js`. A separate adapter keeps that SDK focused and
independently usable while consuming its published `@fly/sprites` package.

### Wrap the OpenRouter client

Owning `callModel()` would couple compute to model orchestration, make existing
harnesses harder to adopt, and duplicate OpenRouter behavior. Returning ordinary
tools composes with the SDK's intended extension point.

### Use only a remote MCP server

MCP is valuable for clients that already speak MCP, but an OpenRouter-native
adapter provides direct TypeScript types, approval integration, predictable
tool selection, and no additional remote authentication hop.

## Open questions

Decisions for the initial implementation:

1. Overflow is persisted as one combined log; stdout is followed by stderr.
2. Process status exposes session metadata only because the released SDK does
   not expose historical session output.
3. `destroy()` remains explicit and is available for both named and supplied
   Sprite handles.
4. `@fly/sprites` owns the stable resource and privilege policy types; adapter
   options for them remain future work.
5. The adapter exposes approval booleans initially. OpenRouter approval
   predicates can be added in a compatible future API revision.

## Acceptance

This RFC is accepted when package maintainers agree on:

- The package boundary and non-goals.
- The two-level API (`createSpriteTools` and `createSpriteWorkspace`).
- Tool names, presets, and result envelope.
- Lifecycle, output, concurrency, and secret-handling defaults.
- The staged release boundary.

Behavioral acceptance scenarios live in
[`tests/acceptance`](../../tests/acceptance/README.md).

## References

- [OpenRouter Agent SDK overview](https://openrouter.ai/docs/agent-sdk/overview)
- [OpenRouter tool definitions and execution](https://openrouter.ai/docs/agent-sdk/call-model/tools)
- [OpenRouter tool approval and state persistence](https://openrouter.ai/docs/agent-sdk/call-model/tool-approval-state)
- [Sprites JavaScript SDK source: `superfly/sprites-js`](https://github.com/superfly/sprites-js)
- [Sprites filesystem API](https://docs.sprites.dev/api/dev-latest/filesystem/)
- [Sprites checkpoints API](https://docs.sprites.dev/api/dev-latest/checkpoints/)
- [Sprites policy API](https://docs.sprites.dev/api/dev-latest/policy/)
