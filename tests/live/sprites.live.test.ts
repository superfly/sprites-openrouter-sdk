import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { SpritesClient } from "@fly/sprites";
import { OpenRouter, stepCountIs } from "@openrouter/agent";
import {
  createSpriteWorkspace,
  type SpriteToolResult,
} from "../../src/index.js";
import { executableTool } from "../helpers/fake-sprites.js";

const spritesToken = process.env.SPRITES_TOKEN;
const openrouterApiKey = process.env.OPENROUTER_API_KEY;

function liveName(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase();
}

test(
  "live Sprite executes and persists through the public adapter",
  { skip: !spritesToken, timeout: 180_000 },
  async () => {
    const client = new SpritesClient(spritesToken!);
    const workspace = await createSpriteWorkspace({
      target: {
        client,
        name: liveName("openrouter-adapter"),
        create: "if-missing",
        createOptions: { runtime: "dev" },
      },
      cwd: "/workspace",
      limits: { commandTimeoutMs: 60_000, maxOutputBytes: 16_384 },
    });

    try {
      const tools = workspace.tools();
      const write = (await executableTool(tools, "sprite_write_file").function.execute({
        path: "live.txt",
        content: "persistent-live-value",
      } as never)) as SpriteToolResult<Record<string, any>>;
      assert.equal(write.ok, true);

      const exec = (await executableTool(tools, "sprite_exec").function.execute({
        command: "wc -c < live.txt",
      } as never)) as SpriteToolResult<Record<string, any>>;
      assert.equal(exec.ok, true);
      assert.equal(exec.data?.stdout.trim(), "21");

      await workspace.close();
      const reopened = await createSpriteWorkspace({
        target: { client, name: workspace.name, create: "never" },
        cwd: "/workspace",
      });
      try {
        const read = (await executableTool(
          reopened.tools(),
          "sprite_read_file",
        ).function.execute({ path: "live.txt" } as never)) as SpriteToolResult<
          Record<string, any>
        >;
        assert.equal(read.data?.content, "persistent-live-value");
      } finally {
        await reopened.destroy();
      }
    } catch (error) {
      await workspace.destroy();
      throw error;
    }
  },
);
test(
  "live OpenRouter model can call a Sprite tool",
  {
    skip:
      !spritesToken ||
      !openrouterApiKey ||
      process.env.RUN_OPENROUTER_LIVE !== "1",
    timeout: 180_000,
  },
  async () => {
    const client = new SpritesClient(spritesToken!);
    const workspace = await createSpriteWorkspace({
      target: {
        client,
        name: liveName("openrouter-agent"),
        create: "if-missing",
        createOptions: { runtime: "dev" },
      },
      cwd: "/workspace",
    });
    try {
      const openrouter = new OpenRouter({ apiKey: openrouterApiKey! });
      const result = openrouter.callModel({
        model: process.env.OPENROUTER_TEST_MODEL ?? "openai/gpt-5-mini",
        input:
          "Use sprite_write_file to write exactly 'agent-live-value' to agent.txt, then answer done.",
        tools: workspace.tools(),
        stopWhen: stepCountIs(4),
      });
      await result.getText();
      const read = (await executableTool(
        workspace.tools(),
        "sprite_read_file",
      ).function.execute({ path: "agent.txt" } as never)) as SpriteToolResult<
        Record<string, any>
      >;
      assert.equal(read.data?.content, "agent-live-value");
    } finally {
      await workspace.destroy();
    }
  },
);
