import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpriteTools } from "../../src/index.js";
import {
  executableTool,
  FakeSprite,
} from "../helpers/fake-sprites.js";

function names(tools: ReturnType<typeof createSpriteTools>): string[] {
  return tools.map((candidate) =>
    "function" in candidate ? candidate.function.name : "server",
  );
}

test("minimal and coding presets have stable native OpenRouter tools", () => {
  const sprite = new FakeSprite();
  const minimal = createSpriteTools({ sprite: sprite.asSdk() });
  assert.deepEqual(names(minimal), [
    "sprite_exec",
    "sprite_read_file",
    "sprite_write_file",
    "sprite_list_directory",
  ]);

  const coding = createSpriteTools({ sprite: sprite.asSdk(), preset: "coding" });
  assert.deepEqual(names(coding), [
    "sprite_exec",
    "sprite_read_file",
    "sprite_write_file",
    "sprite_list_directory",
    "sprite_apply_patch",
    "sprite_search_files",
    "sprite_start_process",
    "sprite_process_status",
    "sprite_stop_process",
  ]);
});

test("include, exclude, and native requireApproval are mapped per tool", () => {
  const sprite = new FakeSprite();
  const tools = createSpriteTools({
    sprite: sprite.asSdk(),
    include: ["applyPatch", "searchFiles"],
    exclude: ["writeFile", "searchFiles"],
    requireApproval: { exec: true },
  });
  assert.deepEqual(names(tools), [
    "sprite_exec",
    "sprite_read_file",
    "sprite_list_directory",
    "sprite_apply_patch",
  ]);
  assert.equal(executableTool(tools, "sprite_exec").function.requireApproval, true);
  assert.equal(
    executableTool(tools, "sprite_read_file").function.requireApproval,
    undefined,
  );
});

test("exec uses a bounded sh -lc spawn and returns non-zero exits as data", async () => {
  const sprite = new FakeSprite();
  sprite.queueCommand({ stderr: "bad input", exitCode: 7 });
  const tools = createSpriteTools({
    sprite: sprite.asSdk(),
    cwd: "/workspace",
    environment: { PUBLIC_BUILD_MODE: "test" },
    limits: { commandTimeoutMs: 500 },
  });
  const result = (await executableTool(tools, "sprite_exec").function.execute({
    command: "echo bad >&2; exit 7",
    timeoutMs: 10_000,
  } as never)) as Record<string, any>;

  assert.equal(sprite.commands[0]?.command, "sh");
  assert.deepEqual(sprite.commands[0]?.args, ["-lc", "echo bad >&2; exit 7"]);
  assert.equal(sprite.commands[0]?.options.cwd, "/workspace");
  assert.deepEqual(sprite.commands[0]?.options.env, { PUBLIC_BUILD_MODE: "test" });
  assert.equal(sprite.commands[0]?.options.maxRunAfterDisconnect, "1s");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "command_failed");
  assert.equal(result.data.exitCode, 7);
  assert.equal(result.data.stderr, "bad input");
});

test("exec bounds output, preserves head and tail, and persists the full result", async () => {
  const sprite = new FakeSprite();
  const output = `${"HEAD".repeat(200)}${"TAIL".repeat(200)}`;
  sprite.queueCommand({ stdout: output });
  const tools = createSpriteTools({
    sprite: sprite.asSdk(),
    limits: { maxOutputBytes: 256 },
  });
  const result = (await executableTool(tools, "sprite_exec").function.execute({
    command: "large-output",
  } as never)) as Record<string, any>;

  assert.equal(result.ok, true);
  assert.equal(result.meta.truncated, true);
  assert.ok(Buffer.byteLength(result.data.stdout) <= 256);
  assert.match(result.data.stdout, /HEAD/);
  assert.match(result.data.stdout, /TAIL/);
  assert.match(result.data.stdout, /truncated/);
  const saved = sprite.filesystemState.files.get(result.meta.fullOutputPath);
  assert.equal(saved?.toString(), output);
});

test("exec timeout terminates the command and returns a retryable timeout", async () => {
  const sprite = new FakeSprite();
  sprite.queueCommand({ hang: true });
  const tools = createSpriteTools({
    sprite: sprite.asSdk(),
    limits: { commandTimeoutMs: 20 },
  });
  const result = (await executableTool(tools, "sprite_exec").function.execute({
    command: "sleep 10",
    timeoutMs: 5_000,
  } as never)) as Record<string, any>;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "timed_out");
  assert.equal(result.error.retryable, true);
  assert.deepEqual(sprite.commands[0]?.handle.signals, ["SIGTERM"]);
});

test("filesystem tools persist data and reject traversal", async () => {
  const sprite = new FakeSprite();
  const tools = createSpriteTools({ sprite: sprite.asSdk(), cwd: "/workspace" });
  const write = executableTool(tools, "sprite_write_file");
  const read = executableTool(tools, "sprite_read_file");
  const list = executableTool(tools, "sprite_list_directory");

  const written = (await write.function.execute({
    path: "notes/result.txt",
    content: "persistent",
  } as never)) as Record<string, any>;
  assert.equal(written.ok, true);

  const readResult = (await read.function.execute({
    path: "notes/result.txt",
  } as never)) as Record<string, any>;
  assert.equal(readResult.data.content, "persistent");

  const listed = (await list.function.execute({ path: "notes" } as never)) as Record<
    string,
    any
  >;
  assert.deepEqual(listed.data.entries.map((entry: any) => entry.name), ["result.txt"]);

  const traversal = (await write.function.execute({
    path: "../outside.txt",
    content: "no",
  } as never)) as Record<string, any>;
  assert.equal(traversal.ok, false);
  assert.equal(traversal.error.code, "invalid_path");
  assert.equal(sprite.filesystemState.files.has("/outside.txt"), false);
});

test("searchFiles in the coding preset returns structured bounded matches", async () => {
  const sprite = new FakeSprite();
  await sprite.filesystemState.writeFile(
    "/workspace/src/example.ts",
    "const needle = 1;\n// needle again\n",
  );
  const tools = createSpriteTools({
    sprite: sprite.asSdk(),
    preset: "coding",
    limits: { maxSearchResults: 1 },
  });
  const result = (await executableTool(tools, "sprite_search_files").function.execute({
    query: "needle",
  } as never)) as Record<string, any>;
  assert.equal(result.ok, true);
  assert.equal(result.data.matches.length, 1);
  assert.equal(result.meta.truncated, true);
  assert.equal(result.data.matches[0].line, 1);
});

test("coding process tools expose persistent Sprite session IDs", async () => {
  const sprite = new FakeSprite();
  const tools = createSpriteTools({ sprite: sprite.asSdk(), preset: "coding" });

  const started = (await executableTool(
    tools,
    "sprite_start_process",
  ).function.execute({ command: "sleep 100" } as never)) as Record<string, any>;
  assert.equal(started.ok, true);
  assert.equal(started.data.sessionId, "session-1");

  const status = (await executableTool(
    tools,
    "sprite_process_status",
  ).function.execute({ sessionId: "session-1" } as never)) as Record<string, any>;
  assert.equal(status.ok, true);
  assert.equal(status.data.running, true);

  const stopped = (await executableTool(
    tools,
    "sprite_stop_process",
  ).function.execute({ sessionId: "session-1" } as never)) as Record<string, any>;
  assert.equal(stopped.ok, true);
  assert.equal(stopped.data.running, false);
});

test("applyPatch validates paths, invokes patch, and cleans its temporary file", async () => {
  const sprite = new FakeSprite();
  const tools = createSpriteTools({ sprite: sprite.asSdk(), preset: "coding" });
  const result = (await executableTool(tools, "sprite_apply_patch").function.execute({
    patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n",
  } as never)) as Record<string, any>;
  assert.equal(result.ok, true);
  assert.match(sprite.commands[0]?.args[1] ?? "", /^patch --batch -p1 -i /);
  assert.equal(
    [...sprite.filesystemState.files.keys()].some((file) => file.endsWith(".patch")),
    false,
  );
});
