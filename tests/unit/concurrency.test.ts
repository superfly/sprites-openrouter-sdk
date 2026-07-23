import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpriteTools } from "../../src/index.js";
import { executableTool, FakeSprite } from "../helpers/fake-sprites.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("reads wait behind mutations while independent reads overlap", async () => {
  const sprite = new FakeSprite();
  await sprite.filesystemState.writeFile("/workspace/read.txt", "ready");
  const mutationGate = deferred();
  const mutationStarted = deferred();
  let readStarted = false;
  sprite.filesystemState.beforeWrite = async (file) => {
    if (file.endsWith("write.txt")) {
      mutationStarted.resolve();
      await mutationGate.promise;
    }
  };
  sprite.filesystemState.beforeRead = () => {
    readStarted = true;
  };

  const tools = createSpriteTools({ sprite: sprite.asSdk() });
  const writePromise = executableTool(tools, "sprite_write_file").function.execute({
    path: "write.txt",
    content: "value",
  } as never);
  await mutationStarted.promise;
  const readPromise = executableTool(tools, "sprite_read_file").function.execute({
    path: "read.txt",
  } as never);
  await tick();
  assert.equal(readStarted, false);
  mutationGate.resolve();
  await Promise.all([writePromise, readPromise]);
  assert.equal(readStarted, true);

  const readGate = deferred();
  const firstReadStarted = deferred();
  let secondReadStarted = false;
  sprite.filesystemState.beforeRead = async (file) => {
    if (file.endsWith("first.txt")) {
      firstReadStarted.resolve();
      await readGate.promise;
    } else if (file.endsWith("second.txt")) {
      secondReadStarted = true;
    }
  };
  await sprite.filesystemState.writeFile("/workspace/first.txt", "1");
  await sprite.filesystemState.writeFile("/workspace/second.txt", "2");
  const first = executableTool(tools, "sprite_read_file").function.execute({
    path: "first.txt",
  } as never);
  await firstReadStarted.promise;
  const second = executableTool(tools, "sprite_read_file").function.execute({
    path: "second.txt",
  } as never);
  await tick();
  assert.equal(secondReadStarted, true);
  readGate.resolve();
  await Promise.all([first, second]);
});
test("parallel mode permits overlapping mutations", async () => {
  const sprite = new FakeSprite();
  const gate = deferred();
  const firstStarted = deferred();
  let secondStarted = false;
  sprite.filesystemState.beforeWrite = async (file) => {
    if (file.endsWith("a.txt")) {
      firstStarted.resolve();
      await gate.promise;
    } else if (file.endsWith("b.txt")) {
      secondStarted = true;
    }
  };
  const tools = createSpriteTools({
    sprite: sprite.asSdk(),
    concurrency: "parallel",
  });
  const write = executableTool(tools, "sprite_write_file");
  const first = write.function.execute({ path: "a.txt", content: "a" } as never);
  await firstStarted.promise;
  const second = write.function.execute({ path: "b.txt", content: "b" } as never);
  await tick();
  assert.equal(secondStarted, true);
  gate.resolve();
  await Promise.all([first, second]);
});
