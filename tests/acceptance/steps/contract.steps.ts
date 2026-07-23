import assert from "node:assert/strict";
import {
  Before,
  DataTable,
  Given,
  setWorldConstructor,
  Then,
  When,
  World,
} from "@cucumber/cucumber";
import type { Tool } from "@openrouter/agent";
import {
  createSpriteTools,
  createSpriteWorkspace,
  SpriteWorkspaceNotFoundError,
  type SpriteToolName,
  type SpriteToolResult,
  type SpriteWorkspace,
  type SpriteWorkspaceEvent,
} from "../../../src/index.js";
import {
  executableTool,
  FakeSprite,
  FakeSpritesClient,
} from "../../helpers/fake-sprites.js";

class ContractWorld extends World {
  sprite = new FakeSprite("acceptance-tools");
  client = new FakeSpritesClient();
  workspace?: SpriteWorkspace;
  tools: readonly Tool[] = [];
  firstTools?: readonly Tool[];
  result?: SpriteToolResult<Record<string, any>>;
  error?: unknown;
  events: SpriteWorkspaceEvent[] = [];
  selection: {
    preset?: "minimal" | "coding";
    include?: SpriteToolName[];
    exclude?: SpriteToolName[];
    requireApproval?: Partial<Record<SpriteToolName, boolean>>;
  } = {};
  cwd = "/workspace";
  environment: Record<string, string> = {};
  limits: { commandTimeoutMs?: number; maxOutputBytes?: number } = {};
  createCountBefore = 0;
  hostSecret?: string;
  checkpointsCompleted = false;
  restoresCompleted = false;
  policyBeforeCheckpoint = false;
  outsideMutated = false;
  closeSucceeded = false;
  destroySucceeded = false;
  detachableSessionId?: string;
  eventThrows = false;
  concurrency: "serialize-mutations" | "parallel" = "serialize-mutations";
  operationOrder: string[] = [];
  started = new Set<string>();
  finished = new Set<string>();
  releases = new Map<string, () => void>();
  operationPromises = new Map<string, Promise<unknown>>();

  resetSprite(name = "acceptance-tools"): void {
    this.sprite = new FakeSprite(name);
    this.client.sprites.set(name, this.sprite);
  }

  makeTools(overrides: Record<string, unknown> = {}): void {
    this.tools = createSpriteTools({
      sprite: this.sprite.asSdk(),
      cwd: this.cwd,
      environment: this.environment,
      limits: this.limits,
      ...this.selection,
      ...overrides,
    });
  }

  async execute(name: string, input: Record<string, unknown>): Promise<void> {
    this.result = (await executableTool(this.tools, name).function.execute(
      input as never,
    )) as SpriteToolResult<Record<string, any>>;
  }

  async openExisting(options: Record<string, unknown> = {}): Promise<void> {
    this.workspace = await createSpriteWorkspace({
      target: { sprite: this.sprite.asSdk() },
      cwd: this.cwd,
      environment: this.environment,
      limits: this.limits,
      onEvent: (event) => {
        this.events.push(event);
        if (this.eventThrows) throw new Error("event failure");
      },
      ...options,
    });
  }
}

setWorldConstructor(ContractWorld);

Before(function (this: ContractWorld) {
  this.client.sprites.set(this.sprite.name, this.sprite);
});

Given("an existing Sprite", function (this: ContractWorld) {});
Given("an existing Sprite named {string}", function (this: ContractWorld, name: string) {
  this.resetSprite(name);
});
Given("Sprite {string} already exists", function (this: ContractWorld, name: string) {
  this.resetSprite(name);
});
Given("Sprite {string} does not exist", function (this: ContractWorld, name: string) {
  this.client.sprites.delete(name);
});
Given(
  "Sprite {string} is missing during the first lookup",
  function (this: ContractWorld, name: string) {
    this.client.sprites.delete(name);
    this.client.createConflict = true;
  },
);
Given(
  "another process creates Sprite {string} before this process creates it",
  function (this: ContractWorld, _name: string) {},
);

When(
  "I create Sprite tools with the {string} preset",
  function (this: ContractWorld, preset: "minimal" | "coding") {
    this.selection.preset = preset;
    this.makeTools();
  },
);
When("I include {string} and {string}", function (this: ContractWorld, a: SpriteToolName, b: SpriteToolName) {
  this.selection.include = [a, b];
  this.makeTools();
});
When("I exclude {string} and {string}", function (this: ContractWorld, a: SpriteToolName, b: SpriteToolName) {
  this.selection.exclude = [a, b];
  this.makeTools();
});
Then("the model-visible tool names in order are:", function (this: ContractWorld, table: DataTable) {
  const actual = this.tools.map((candidate) =>
    "function" in candidate ? candidate.function.name : "server",
  );
  assert.deepEqual(actual, table.hashes().map((row) => row.name));
});

Given("Sprite tools configured with cwd {string}", function (this: ContractWorld, cwd: string) {
  this.cwd = cwd;
  this.makeTools();
});
When(
  "the model calls {string} with command {string}",
  async function (this: ContractWorld, name: string, command: string) {
    this.makeTools();
    await this.execute(name, { command });
  },
);
When(
  "the model executes a program that writes {string} to stderr and exits {int}",
  async function (this: ContractWorld, stderr: string, exitCode: number) {
    this.sprite.queueCommand({ stderr, exitCode });
    this.makeTools();
    await this.execute("sprite_exec", { command: `echo error >&2; exit ${exitCode}` });
  },
);
Then("the tool result has ok true", function (this: ContractWorld) {
  assert.equal(this.result?.ok, true);
});
Then("the tool result has ok false", function (this: ContractWorld) {
  assert.equal(this.result?.ok, false);
});
Then("the tool data has exit code {int}", function (this: ContractWorld, code: number) {
  assert.equal(this.result?.data?.exitCode, code);
});
Then("stdout is {string}", function (this: ContractWorld, value: string) {
  assert.equal(this.result?.data?.stdout, value);
});
Then("stderr is empty", function (this: ContractWorld) {
  assert.equal(this.result?.data?.stderr, "");
});
Then("stderr contains {string}", function (this: ContractWorld, value: string) {
  assert.match(this.result?.data?.stderr ?? "", new RegExp(value));
});
Then("result metadata includes a non-negative duration", function (this: ContractWorld) {
  assert.ok((this.result?.meta.durationMs ?? -1) >= 0);
});
Then("the error code is {string}", function (this: ContractWorld, code: string) {
  assert.equal(this.result?.error?.code, code);
});
Then("the error is not retryable", function (this: ContractWorld) {
  assert.equal(this.result?.error?.retryable, false);
});
Then("the error is retryable", function (this: ContractWorld) {
  assert.equal(this.result?.error?.retryable, true);
});
Then("the result is JSON serializable", function (this: ContractWorld) {
  assert.doesNotThrow(() => JSON.stringify(this.result));
});
Then("the tool call does not reject with a JavaScript exception", function (this: ContractWorld) {
  assert.equal(this.error, undefined);
});

Given("a first Sprite tool set for cwd {string}", function (this: ContractWorld, cwd: string) {
  this.cwd = cwd;
  this.makeTools();
  this.firstTools = this.tools;
});
When(
  "the first tool set writes {string} to {string}",
  async function (this: ContractWorld, content: string, file: string) {
    assert.ok(this.firstTools);
    this.result = (await executableTool(this.firstTools, "sprite_write_file").function.execute({
      path: file,
      content,
    } as never)) as SpriteToolResult<Record<string, any>>;
  },
);
When("I discard the first tool set", function (this: ContractWorld) {
  this.firstTools = undefined;
});
When("I create a second tool set for the same Sprite and cwd", function (this: ContractWorld) {
  this.makeTools();
});
Then(
  "reading {string} returns {string}",
  async function (this: ContractWorld, file: string, content: string) {
    await this.execute("sprite_read_file", { path: file });
    assert.equal(this.result?.data?.content, content);
  },
);

When("I require approval for {string}", function (this: ContractWorld, name: SpriteToolName) {
  this.selection.requireApproval = { [name]: true };
  this.makeTools();
});
Then("the {string} OpenRouter tool requires approval", function (this: ContractWorld, name: string) {
  assert.equal(executableTool(this.tools, name).function.requireApproval, true);
});
Then("tools without approval configuration do not require approval", function (this: ContractWorld) {
  for (const candidate of this.tools) {
    if (!("function" in candidate) || candidate.function.name === "sprite_exec") continue;
    assert.equal(candidate.function.requireApproval, undefined);
  }
});

Given("tools with max output bytes {int}", function (this: ContractWorld, maximum: number) {
  this.limits.maxOutputBytes = maximum;
  this.makeTools();
});
Given("tools with command timeout {int} milliseconds", function (this: ContractWorld, timeout: number) {
  this.limits.commandTimeoutMs = timeout;
  this.makeTools();
});
Given("overflow result persistence will fail", function (this: ContractWorld) {
  this.sprite.filesystemState.failWrites = true;
});
Given("Sprite command execution fails before the command starts", function (this: ContractWorld) {
  this.sprite.queueCommand({ error: new Error("transport unavailable") });
  this.makeTools();
});
When(
  "a command writes {int} UTF-8 bytes to stdout",
  async function (this: ContractWorld, bytes: number) {
    this.sprite.queueCommand({ stdout: "x".repeat(bytes) });
    await this.execute("sprite_exec", { command: "output" });
  },
);
When(
  "a successful command writes {int} UTF-8 bytes to stdout",
  async function (this: ContractWorld, bytes: number) {
    this.sprite.queueCommand({ stdout: "x".repeat(bytes) });
    await this.execute("sprite_exec", { command: "output" });
  },
);
When(
  "a command writes a unique {int}-byte prefix and a unique {int}-byte suffix",
  async function (this: ContractWorld, prefix: number, suffix: number) {
    this.sprite.queueCommand({
      stdout: `PREFIX${"p".repeat(prefix - 6)}${"s".repeat(suffix - 6)}SUFFIX`,
    });
    await this.execute("sprite_exec", { command: "output" });
  },
);
When(
  "the model requests a {int} millisecond timeout for a long-running command",
  async function (this: ContractWorld, requested: number) {
    this.sprite.queueCommand({ hang: true });
    await this.execute("sprite_exec", { command: "sleep forever", timeoutMs: requested });
  },
);
When("the model calls {string}", async function (this: ContractWorld, name: string) {
  await this.execute(name, { command: "true" });
});
Then("the complete stdout is returned", function (this: ContractWorld) {
  assert.equal(Buffer.byteLength(this.result?.data?.stdout ?? ""), 400);
});
Then("result metadata has truncated false", function (this: ContractWorld) {
  assert.equal(this.result?.meta.truncated, false);
});
Then("result metadata has truncated true", function (this: ContractWorld) {
  assert.equal(this.result?.meta.truncated, true);
});
Then("result metadata has no full output path", function (this: ContractWorld) {
  assert.equal(this.result?.meta.fullOutputPath, undefined);
});
Then("stdout contains content from the unique prefix", function (this: ContractWorld) {
  assert.match(this.result?.data?.stdout ?? "", /PREFIX/);
});
Then("stdout contains content from the unique suffix", function (this: ContractWorld) {
  assert.match(this.result?.data?.stdout ?? "", /SUFFIX/);
});
Then("stdout contains a visible omission marker", function (this: ContractWorld) {
  assert.match(this.result?.data?.stdout ?? "", /truncated/);
});
Then(
  "the combined model-facing stdout and stderr is at most {int} UTF-8 bytes",
  function (this: ContractWorld, maximum: number) {
    assert.ok(
      Buffer.byteLength(this.result?.data?.stdout ?? "") +
        Buffer.byteLength(this.result?.data?.stderr ?? "") <=
        maximum,
    );
  },
);
Then(
  "result metadata contains a full output path beneath {string}",
  function (this: ContractWorld, root: string) {
    assert.ok(this.result?.meta.fullOutputPath?.startsWith(root));
  },
);
Then("reading the full output path returns all {int} bytes", function (this: ContractWorld, bytes: number) {
  const saved = this.sprite.filesystemState.files.get(this.result?.meta.fullOutputPath ?? "");
  assert.equal(saved?.length, bytes);
});
Then("the command is stopped after the configured maximum", function (this: ContractWorld) {
  assert.ok((this.sprite.commands[0]?.handle.signals.length ?? 0) > 0);
});

When(
  "I open named workspace {string} with create {string}",
  async function (this: ContractWorld, name: string, create: "if-missing") {
    this.createCountBefore = this.client.createCalls;
    try {
      this.workspace = await createSpriteWorkspace({
        target: { client: this.client.asSdk(), name, create },
        onEvent: (event) => {
          this.events.push(event);
        },
      });
    } catch (error) {
      this.error = error;
    }
  },
);
When(
  "I open named workspace {string} without a create option",
  async function (this: ContractWorld, name: string) {
    try {
      this.workspace = await createSpriteWorkspace({
        target: { client: this.client.asSdk(), name },
      });
    } catch (error) {
      this.error = error;
    }
  },
);
Then("no Sprite is created", function (this: ContractWorld) {
  assert.equal(this.client.createCalls, this.createCountBefore);
});
Then("Sprite {string} is created exactly once", function (this: ContractWorld, _name: string) {
  assert.equal(this.client.createCalls - this.createCountBefore, 1);
});
Then("the workspace references Sprite {string}", function (this: ContractWorld, name: string) {
  assert.equal(this.workspace?.name, name);
});
Then(
  "a {string} event reports created false",
  function (this: ContractWorld, type: string) {
    assert.ok(this.events.some((event) => event.type === type && "created" in event && !event.created));
  },
);
Then(
  "a {string} event reports created true",
  function (this: ContractWorld, type: string) {
    assert.ok(this.events.some((event) => event.type === type && "created" in event && event.created));
  },
);
Then("the create conflict is followed by one lookup", function (this: ContractWorld) {
  assert.ok(this.client.getCalls >= 2);
});
Then("opening the workspace fails with a typed not-found error", function (this: ContractWorld) {
  assert.ok(this.error instanceof SpriteWorkspaceNotFoundError);
});

Given(
  "an open managed workspace for Sprite {string}",
  async function (this: ContractWorld, name: string) {
    this.resetSprite(name);
    await this.openExisting();
  },
);
Given("the workspace contains file {string}", async function (this: ContractWorld, file: string) {
  await this.sprite.filesystemState.writeFile(file, "content");
});
When("I close the workspace twice", async function (this: ContractWorld) {
  await this.workspace?.close();
  await this.workspace?.close();
  this.closeSucceeded = true;
});
When("I close the workspace", async function (this: ContractWorld) {
  await this.workspace?.close();
  this.closeSucceeded = true;
});
Then("both close operations succeed", function (this: ContractWorld) {
  assert.equal(this.closeSucceeded, true);
});
Then("Sprite {string} still exists", function (this: ContractWorld, name: string) {
  assert.equal(this.sprite.name, name);
  assert.equal(this.sprite.destroyed, false);
});
Then("file {string} still exists", function (this: ContractWorld, file: string) {
  assert.equal(this.sprite.filesystemState.files.has(file), true);
});
Then("new tool calls through the closed workspace are rejected", function (this: ContractWorld) {
  assert.throws(() => this.workspace?.tools());
});
Given(
  "an open managed workspace with a detachable process running",
  async function (this: ContractWorld) {
    await this.openExisting();
    const tools = this.workspace?.tools({ preset: "coding" }) ?? [];
    const result = (await executableTool(tools, "sprite_start_process").function.execute({
      command: "sleep 100",
    } as never)) as SpriteToolResult<Record<string, any>>;
    this.detachableSessionId = result.data?.sessionId;
  },
);
Then("the Sprite exec session remains running", function (this: ContractWorld) {
  assert.equal(
    this.sprite.sessions.find((session) => session.id === this.detachableSessionId)?.isActive,
    true,
  );
});
When("I destroy the workspace twice", async function (this: ContractWorld) {
  await this.workspace?.destroy();
  await this.workspace?.destroy();
  this.destroySucceeded = true;
});
Then("both destroy operations succeed", function (this: ContractWorld) {
  assert.equal(this.destroySucceeded, true);
});
Then("Sprite {string} no longer exists", function (this: ContractWorld, name: string) {
  assert.equal(this.sprite.name, name);
  assert.equal(this.sprite.destroyed, true);
});
Then("a {string} event is emitted once", function (this: ContractWorld, type: string) {
  assert.equal(this.events.filter((event) => event.type === type).length, 1);
});
Given("an event callback that throws an error", function (this: ContractWorld) {
  this.eventThrows = true;
});
When("I open and close a workspace", async function (this: ContractWorld) {
  try {
    await this.openExisting();
    await this.workspace?.close();
    this.closeSucceeded = true;
  } catch (error) {
    this.error = error;
  }
});
Then("opening and closing succeed", function (this: ContractWorld) {
  assert.equal(this.error, undefined);
  assert.equal(this.closeSucceeded, true);
});

When(
  "I open a workspace with checkpoint {string}",
  async function (this: ContractWorld, checkpoint: "on-open") {
    try {
      await this.openExisting({ checkpoint });
      this.checkpointsCompleted = true;
    } catch (error) {
      this.error = error;
    }
  },
);
Then("the checkpoint stream is consumed to completion", function (this: ContractWorld) {
  assert.equal(this.checkpointsCompleted, true);
});
Then("the workspace is returned only after checkpoint completion", function (this: ContractWorld) {
  assert.ok(this.workspace);
  assert.ok(this.sprite.checkpoints.length > 0);
});
Then("a {string} event contains the checkpoint ID", function (this: ContractWorld, type: string) {
  assert.ok(this.events.some((event) => event.type === type && "id" in event && !!event.id));
});
When(
  "I open a workspace with an explicit network policy and checkpoint {string}",
  async function (this: ContractWorld, checkpoint: "on-open") {
    const order: string[] = [];
    const policy = this.sprite.updateNetworkPolicy.bind(this.sprite);
    this.sprite.updateNetworkPolicy = async (value) => {
      order.push("policy");
      await policy(value);
    };
    const create = this.sprite.createCheckpoint.bind(this.sprite);
    this.sprite.createCheckpoint = async (comment) => {
      order.push("checkpoint");
      return create(comment);
    };
    await this.openExisting({
      checkpoint,
      networkPolicy: { rules: [{ domain: "example.com", action: "allow" }] },
    });
    this.policyBeforeCheckpoint = order.join(",") === "policy,checkpoint";
  },
);
Then(
  "the network policy update completes before checkpoint creation starts",
  function (this: ContractWorld) {
    assert.equal(this.policyBeforeCheckpoint, true);
  },
);
Given("checkpoint creation will fail", function (this: ContractWorld) {
  this.sprite.checkpointFailure = new Error("checkpoint failure");
});
Then("opening the workspace fails with the checkpoint error", function (this: ContractWorld) {
  assert.match(String(this.error), /checkpoint failure/);
});
Then("no usable workspace is returned", function (this: ContractWorld) {
  assert.equal(this.workspace, undefined);
});
Then("the Sprite is not destroyed", function (this: ContractWorld) {
  assert.equal(this.sprite.destroyed, false);
});
Given(
  "checkpoint {string} contains file {string} with content {string}",
  async function (this: ContractWorld, id: string, file: string, content: string) {
    await this.sprite.filesystemState.writeFile(file, content);
    await this.sprite.createCheckpoint();
    assert.equal(this.sprite.checkpoints[0]?.id, id);
    await this.openExisting();
  },
);
Given("the current file content is {string}", async function (this: ContractWorld, content: string) {
  await this.sprite.filesystemState.writeFile("/workspace/value.txt", content);
});
When("I restore checkpoint {string}", async function (this: ContractWorld, id: string) {
  await this.workspace?.restore(id);
  this.restoresCompleted = true;
});
Then("the restore stream is consumed to completion", function (this: ContractWorld) {
  assert.equal(this.restoresCompleted, true);
});
Then("file {string} contains {string}", function (this: ContractWorld, file: string, content: string) {
  assert.equal(this.sprite.filesystemState.files.get(file)?.toString(), content);
});
Then(
  "a {string} event contains checkpoint ID {string}",
  function (this: ContractWorld, type: string, id: string) {
    assert.ok(this.events.some((event) => event.type === type && "id" in event && event.id === id));
  },
);
Given("tools created with every available preset and include option", function (this: ContractWorld) {
  this.tools = createSpriteTools({
    sprite: this.sprite.asSdk(),
    preset: "coding",
    include: ["exec", "readFile", "writeFile", "applyPatch", "listDirectory", "searchFiles", "startProcess", "processStatus", "stopProcess"],
  });
});
Then("no model-visible tool can restore a checkpoint", function (this: ContractWorld) {
  assert.equal(this.tools.some((candidate) => "function" in candidate && /restore/.test(candidate.function.name)), false);
});
Then("no model-visible tool can destroy a Sprite", function (this: ContractWorld) {
  assert.equal(this.tools.some((candidate) => "function" in candidate && /destroy/.test(candidate.function.name)), false);
});

Given("the host environment contains {string}", function (this: ContractWorld, pair: string) {
  this.hostSecret = pair.split("=")[1];
});
Given("the workspace environment is not configured", function (this: ContractWorld) {
  this.environment = {};
});
Given("the workspace environment contains {string}", function (this: ContractWorld, pair: string) {
  const [key, value] = pair.split("=");
  if (key && value) this.environment[key] = value;
});
Given("the host has {string} and {string}", function (this: ContractWorld, _a: string, _b: string) {
  this.hostSecret = "host-credentials";
});
Given("neither variable is in the configured workspace environment", function (this: ContractWorld) {
  this.environment = {};
});
When(
  "the model executes a program that prints {string}",
  async function (this: ContractWorld, variable: string) {
    this.sprite.queueCommand({ stdout: this.environment[variable] ?? "" });
    this.makeTools();
    await this.execute("sprite_exec", { command: `printf %s \"$${variable}\"` });
  },
);
When("the model executes a program that lists its environment", async function (this: ContractWorld) {
  this.sprite.queueCommand({ stdout: Object.entries(this.environment).map(([key, value]) => `${key}=${value}`).join("\n") });
  this.makeTools();
  await this.execute("sprite_exec", { command: "env" });
});
Then("the command cannot read value {string}", function (this: ContractWorld, value: string) {
  assert.doesNotMatch(this.result?.data?.stdout ?? "", new RegExp(value));
});
Then("stdout contains {string}", function (this: ContractWorld, value: string) {
  assert.match(this.result?.data?.stdout ?? "", new RegExp(value));
});
Then("stdout does not contain either host credential value", function (this: ContractWorld) {
  assert.doesNotMatch(this.result?.data?.stdout ?? "", /SPRITES_TOKEN|OPENROUTER_API_KEY|host-credentials/);
});
Given("filesystem tools configured with cwd {string}", function (this: ContractWorld, cwd: string) {
  this.cwd = cwd;
  this.selection.preset = "coding";
  this.makeTools();
});
When(
  "the model calls {string} with path {string}",
  async function (this: ContractWorld, name: string, file: string) {
    const input = name === "sprite_write_file"
      ? { path: file, content: "bad" }
      : name === "sprite_apply_patch"
        ? { patch: `--- a/file.txt\n+++ b/${file}\n@@ -0,0 +1 @@\n+bad` }
        : name === "sprite_search_files"
          ? { path: file, query: "bad" }
          : { path: file };
    await this.execute(name, input);
  },
);
Then("no path outside {string} is mutated", function (this: ContractWorld, root: string) {
  assert.equal([...this.sprite.filesystemState.files.keys()].some((file) => !file.startsWith(root)), false);
});
Given("an existing Sprite with a network policy", function (this: ContractWorld) {});
When("I open a workspace without a network policy option", async function (this: ContractWorld) {
  await this.openExisting();
});
Then("no network policy update is requested", function (this: ContractWorld) {
  assert.equal(this.sprite.policies.length, 0);
});
When("I open a workspace with an explicit network policy", async function (this: ContractWorld) {
  await this.openExisting({ networkPolicy: { rules: [{ domain: "example.com", action: "allow" }] } });
});
Then("that exact network policy is applied before the workspace is returned", function (this: ContractWorld) {
  assert.deepEqual(this.sprite.policies, [{ rules: [{ domain: "example.com", action: "allow" }] }]);
  assert.ok(this.workspace);
});
Then(
  "the Sprite spawns {string} with arguments {string} and {string}",
  function (this: ContractWorld, command: string, first: string, second: string) {
    assert.equal(this.sprite.commands[0]?.command, command);
    assert.deepEqual(this.sprite.commands[0]?.args, [first, second]);
  },
);
Then("max run after disconnect is bounded by the command timeout", function (this: ContractWorld) {
  assert.match(this.sprite.commands[0]?.options.maxRunAfterDisconnect ?? "", /^\d+s$/);
});

Given(
  "a workspace using {string} concurrency",
  function (this: ContractWorld, mode: "serialize-mutations" | "parallel") {
    this.concurrency = mode;
    this.makeTools({ concurrency: mode });
  },
);
Given(
  "mutation {string} blocks until released",
  function (this: ContractWorld, operation: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.releases.set(operation, release);
    this.sprite.filesystemState.beforeWrite = async (file) => {
      const name = file.includes("A.txt") ? "A" : "B";
      this.started.add(name);
      this.operationOrder.push(`${name}:started`);
      if (name === operation) await gate;
      this.finished.add(name);
      this.operationOrder.push(`${name}:finished`);
    };
  },
);
Given(
  /^mutation "([^"]+)" will (fail|time out|cancel)$/,
  function (this: ContractWorld, operation: string, _outcome: string) {
    this.sprite.filesystemState.beforeWrite = async (file) => {
      const name = file.includes("A.txt") ? "A" : "B";
      this.started.add(name);
      this.operationOrder.push(`${name}:started`);
      if (name === operation) {
        this.finished.add(name);
        this.operationOrder.push(`${name}:finished`);
        throw new Error("planned mutation failure");
      }
      this.finished.add(name);
      this.operationOrder.push(`${name}:finished`);
    };
  },
);
When("mutation {string} is requested", function (this: ContractWorld, operation: string) {
  if (!this.sprite.filesystemState.beforeWrite) {
    this.sprite.filesystemState.beforeWrite = (file) => {
      const name = file.includes(`${operation}.txt`) ? operation : "unknown";
      this.started.add(name);
      this.operationOrder.push(`${name}:started`);
      this.finished.add(name);
      this.operationOrder.push(`${name}:finished`);
    };
  }
  const promise = executableTool(this.tools, "sprite_write_file").function.execute({
    path: `${operation}.txt`,
    content: operation,
  } as never);
  this.operationPromises.set(operation, promise);
});
When(
  "mutation {string} is requested before {string} finishes",
  function (this: ContractWorld, operation: string, _earlier: string) {
    const promise = executableTool(this.tools, "sprite_write_file").function.execute({
      path: `${operation}.txt`,
      content: operation,
    } as never);
    this.operationPromises.set(operation, promise);
  },
);
Then("mutation {string} has not started", function (this: ContractWorld, operation: string) {
  assert.equal(this.started.has(operation), false);
});
When("mutation {string} is released", async function (this: ContractWorld, operation: string) {
  this.releases.get(operation)?.();
  await this.operationPromises.get(operation);
  await new Promise((resolve) => setTimeout(resolve, 0));
});
Then(
  "mutation {string} finishes before mutation {string} starts",
  async function (this: ContractWorld, first: string, second: string) {
    await this.operationPromises.get(second);
    assert.ok(
      this.operationOrder.indexOf(`${first}:finished`) <
        this.operationOrder.indexOf(`${second}:started`),
    );
  },
);
Then(
  "mutation {string} starts after mutation {string} finishes",
  async function (this: ContractWorld, second: string, first: string) {
    await Promise.all([
      this.operationPromises.get(first),
      this.operationPromises.get(second),
    ]);
    assert.ok(
      this.operationOrder.indexOf(`${first}:finished`) <
        this.operationOrder.indexOf(`${second}:started`),
    );
  },
);
Then(
  "mutation {string} starts before mutation {string} is released",
  function (this: ContractWorld, first: string, _blocked: string) {
    assert.equal(this.started.has(first), true);
  },
);

Given(
  "read {string} blocks until released",
  async function (this: ContractWorld, operation: string) {
    await this.sprite.filesystemState.writeFile(`/workspace/${operation}.txt`, operation);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.releases.set(operation, release);
    this.sprite.filesystemState.beforeRead = async (file) => {
      const name = file.includes("R1.txt") ? "R1" : file.includes("R2.txt") ? "R2" : "R";
      this.started.add(name);
      this.operationOrder.push(`${name}:started`);
      if (name === operation) await gate;
      this.finished.add(name);
      this.operationOrder.push(`${name}:finished`);
    };
  },
);
When("read {string} is requested", function (this: ContractWorld, operation: string) {
  if (!this.sprite.filesystemState.files.has(`/workspace/${operation}.txt`)) {
    void this.sprite.filesystemState.writeFile(`/workspace/${operation}.txt`, operation);
  }
  if (!this.sprite.filesystemState.beforeRead) {
    this.sprite.filesystemState.beforeRead = () => {
      this.started.add(operation);
      this.operationOrder.push(`${operation}:started`);
      this.finished.add(operation);
      this.operationOrder.push(`${operation}:finished`);
    };
  }
  const promise = executableTool(this.tools, "sprite_read_file").function.execute({
    path: `${operation}.txt`,
  } as never);
  this.operationPromises.set(operation, promise);
});
When(
  "read {string} is requested before {string} finishes",
  function (this: ContractWorld, operation: string, _earlier: string) {
    void this.sprite.filesystemState.writeFile(`/workspace/${operation}.txt`, operation);
    if (!this.sprite.filesystemState.beforeRead) {
      this.sprite.filesystemState.beforeRead = () => {
        this.started.add(operation);
        this.operationOrder.push(`${operation}:started`);
        this.finished.add(operation);
        this.operationOrder.push(`${operation}:finished`);
      };
    }
    const promise = executableTool(this.tools, "sprite_read_file").function.execute({
      path: `${operation}.txt`,
    } as never);
    this.operationPromises.set(operation, promise);
  },
);
Then("read {string} has not started", function (this: ContractWorld, operation: string) {
  assert.equal(this.started.has(operation), false);
});
Then(
  "mutation {string} finishes before read {string} starts",
  async function (this: ContractWorld, mutation: string, read: string) {
    await this.operationPromises.get(read);
    assert.ok(
      this.operationOrder.indexOf(`${mutation}:finished`) <
        this.operationOrder.indexOf(`${read}:started`),
    );
  },
);
Then(
  "read {string} starts before read {string} is released",
  function (this: ContractWorld, first: string, _blocked: string) {
    assert.equal(this.started.has(first), true);
  },
);
Given(
  "reads {string} and {string} are active",
  async function (this: ContractWorld, first: string, second: string) {
    await this.sprite.filesystemState.writeFile(`/workspace/${first}.txt`, first);
    await this.sprite.filesystemState.writeFile(`/workspace/${second}.txt`, second);
    const gates = new Map<string, Promise<void>>();
    for (const operation of [first, second]) {
      let release!: () => void;
      gates.set(operation, new Promise<void>((resolve) => {
        release = resolve;
      }));
      this.releases.set(operation, release);
    }
    this.sprite.filesystemState.beforeRead = async (file) => {
      const name = file.includes(`${first}.txt`) ? first : second;
      this.started.add(name);
      this.operationOrder.push(`${name}:started`);
      await gates.get(name);
      this.finished.add(name);
      this.operationOrder.push(`${name}:finished`);
    };
    for (const operation of [first, second]) {
      const promise = executableTool(this.tools, "sprite_read_file").function.execute({
        path: `${operation}.txt`,
      } as never);
      this.operationPromises.set(operation, promise);
    }
    while (!this.started.has(first) || !this.started.has(second)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  },
);
When(
  "reads {string} and {string} finish",
  async function (this: ContractWorld, first: string, second: string) {
    this.releases.get(first)?.();
    this.releases.get(second)?.();
    await Promise.all([
      this.operationPromises.get(first),
      this.operationPromises.get(second),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  },
);
Then("mutation {string} starts", async function (this: ContractWorld, operation: string) {
  await this.operationPromises.get(operation);
  assert.equal(this.started.has(operation), true);
});
