# Sprites for OpenRouter Agent SDK

> **Experimental:** This package is under active development in an internal
> repository. Its API and behavior may change before the first public release.

This repository, `superfly/sprites-openrouter-sdk`, contains the OpenRouter
Agent SDK integration built on the
[`superfly/sprites-js`](https://github.com/superfly/sprites-js) JavaScript SDK.
That SDK is published to npm as `@fly/sprites`; this package is
`@fly/sprites-openrouter`.

| Role | GitHub repository | npm package |
|---|---|---|
| Foundational JavaScript SDK | [`superfly/sprites-js`](https://github.com/superfly/sprites-js) | `@fly/sprites` |
| OpenRouter integration | `superfly/sprites-openrouter-sdk` | `@fly/sprites-openrouter` |

## Install

```sh
npm install @fly/sprites-openrouter @fly/sprites @openrouter/agent
```

The package targets Node.js 24 or later and uses ESM.

## Usage attribution

When imported, this adapter declares `FLY_INVOKED_BY=openrouter` if the
variable is not already set. Client-signals-aware versions of the foundational
Sprites SDK then attach the coarse, privacy-safe
[`client-signals`](https://github.com/superfly/client-signals) marker to
Sprites API requests. An explicit declaration from your application or an
outer agent harness is never overwritten. The marker is advisory analytics
only and is never used for access control, gating, or rate-limiting.

## Usage

```ts
import { SpritesClient } from '@fly/sprites';
import { OpenRouter, stepCountIs } from '@openrouter/agent';
import { createSpriteWorkspace } from '@fly/sprites-openrouter';

const sprites = new SpritesClient(process.env.SPRITES_TOKEN!);
const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });

const workspace = await createSpriteWorkspace({
  target: {
    client: sprites,
    name: 'coding-project-123',
    create: 'if-missing',
    createOptions: { runtime: 'dev' },
  },
  cwd: '/workspace',
});

try {
  const result = openrouter.callModel({
    model: 'openai/gpt-5-mini',
    input: 'Inspect the repository and fix the failing test.',
    tools: workspace.tools({ preset: 'coding' }),
    stopWhen: stepCountIs(20),
  });
  console.log(await result.getText());
} finally {
  // Releases adapter-local resources. The Sprite and its files remain.
  await workspace.close();
}
```

`destroy()` is the explicit infrastructure deletion operation. `close()` is
idempotent and preserves the Sprite so a later request can reopen the same name.

The `minimal` preset exposes `exec`, `readFile`, `writeFile`, and
`listDirectory`. The `coding` preset adds patch, search, and detachable-process
tools. Per-tool approvals map directly to OpenRouter's `requireApproval`:

```ts
const tools = workspace.tools({
  preset: 'coding',
  requireApproval: { exec: true, applyPatch: true },
});
```

- [API RFC](docs/rfcs/0001-sprite-workspaces-for-openrouter.md)
- [Acceptance test specification](tests/acceptance/README.md)

The RFC defines the public contract. The Cucumber acceptance suite runs against
a deterministic fake Sprite, with separate credential-gated live tests for the
released SDKs.

## Development

```sh
npm test
npm run test:acceptance
npm run typecheck
npm run build
npm run package:check
npm run test:live
```

`npm run test:live` skips unless `SPRITES_TOKEN` is present. The OpenRouter
model-driven live case additionally requires `OPENROUTER_API_KEY` and
`RUN_OPENROUTER_LIVE=1`.
