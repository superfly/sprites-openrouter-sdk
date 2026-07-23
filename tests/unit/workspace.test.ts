import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSpriteWorkspace,
  SpriteWorkspaceNotFoundError,
} from "../../src/index.js";
import { FakeSprite, FakeSpritesClient } from "../helpers/fake-sprites.js";

test("named workspaces reuse, create, and recover a create conflict", async () => {
  const client = new FakeSpritesClient();
  const existing = new FakeSprite("existing");
  client.sprites.set("existing", existing);
  const events: string[] = [];
  const reused = await createSpriteWorkspace({
    target: { client: client.asSdk(), name: "existing", create: "if-missing" },
    onEvent: (event) => {
      events.push(`${event.type}:${"created" in event ? event.created : ""}`);
    },
  });
  assert.equal(reused.sprite, existing.asSdk());
  assert.equal(client.createCalls, 0);
  assert.deepEqual(events, ["workspace.opened:false"]);

  const created = await createSpriteWorkspace({
    target: { client: client.asSdk(), name: "new", create: "if-missing" },
  });
  assert.equal(created.name, "new");
  assert.equal(client.createCalls, 1);

  client.createConflict = true;
  const raced = await createSpriteWorkspace({
    target: { client: client.asSdk(), name: "raced", create: "if-missing" },
  });
  assert.equal(raced.name, "raced");
  assert.ok(client.getCalls >= 2);
});

test("missing named infrastructure is not created by default", async () => {
  const client = new FakeSpritesClient();
  await assert.rejects(
    createSpriteWorkspace({ target: { client: client.asSdk(), name: "missing" } }),
    SpriteWorkspaceNotFoundError,
  );
  assert.equal(client.createCalls, 0);
});

test("close preserves the Sprite and destroy is explicit and idempotent", async () => {
  const sprite = new FakeSprite("lifecycle");
  const events: string[] = [];
  const workspace = await createSpriteWorkspace({
    target: { sprite: sprite.asSdk() },
    onEvent: (event) => {
      events.push(event.type);
    },
  });
  await workspace.close();
  await workspace.close();
  assert.equal(sprite.destroyed, false);
  assert.throws(() => workspace.tools());

  await workspace.destroy();
  await workspace.destroy();
  assert.equal(sprite.destroyed, true);
  assert.equal(events.filter((event) => event === "workspace.destroyed").length, 1);
});

test("policy is applied before on-open checkpoint and checkpoint events include IDs", async () => {
  const sprite = new FakeSprite("checkpoint");
  const order: string[] = [];
  const originalPolicy = sprite.updateNetworkPolicy.bind(sprite);
  sprite.updateNetworkPolicy = async (policy) => {
    order.push("policy");
    await originalPolicy(policy);
  };
  const originalCheckpoint = sprite.createCheckpoint.bind(sprite);
  sprite.createCheckpoint = async (comment) => {
    order.push("checkpoint");
    return originalCheckpoint(comment);
  };
  const events: string[] = [];
  const workspace = await createSpriteWorkspace({
    target: { sprite: sprite.asSdk() },
    networkPolicy: { rules: [{ domain: "example.com", action: "allow" }] },
    checkpoint: "on-open",
    onEvent: (event) => {
      events.push("id" in event ? `${event.type}:${event.id}` : event.type);
    },
  });
  assert.deepEqual(order, ["policy", "checkpoint"]);
  assert.ok(events.includes("checkpoint.created:v1"));
  assert.equal((await workspace.checkpoint("manual")).id, "v2");
  await workspace.restore("v1");
  assert.ok(events.includes("checkpoint.restored:v1"));
});

test("on-open checkpoint failure rejects without destroying the Sprite", async () => {
  const sprite = new FakeSprite("checkpoint-failure");
  sprite.checkpointFailure = new Error("checkpoint unavailable");
  await assert.rejects(
    createSpriteWorkspace({
      target: { sprite: sprite.asSdk() },
      checkpoint: "on-open",
    }),
    /checkpoint unavailable/,
  );
  assert.equal(sprite.destroyed, false);
});
