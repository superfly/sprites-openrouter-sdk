# Sprites for OpenRouter Agent SDK

> **Experimental:** This integration is under active development and is not
> published to npm. Its API and behavior may change before the first stable
> release.

This repository, `superfly/sprites-openrouter-sdk`, contains the OpenRouter
Agent SDK integration built on the
[`superfly/sprites-js`](https://github.com/superfly/sprites-js) JavaScript SDK.
That SDK is published to npm as `@fly/sprites`. This integration is currently
available only from source; `@fly/sprites-openrouter` is the proposed name for
a future npm release. `npm install @fly/sprites-openrouter` will fail until that
release exists.

| Role | GitHub repository | Availability |
|---|---|---|
| Foundational JavaScript SDK | [`superfly/sprites-js`](https://github.com/superfly/sprites-js) | npm: `@fly/sprites` |
| OpenRouter integration | `superfly/sprites-openrouter-sdk` | Source only; not published to npm |

## Try from source

The repository requires Node.js 24 or later and uses ESM. Clone and build it
locally:

```sh
git clone https://github.com/superfly/sprites-openrouter-sdk.git
cd sprites-openrouter-sdk
npm ci
npm run build
```

## Usage attribution

When imported, this adapter declares `FLY_INVOKED_BY=openrouter` if the
variable is not already set. Client-signals-aware versions of the foundational
Sprites SDK then attach the coarse, privacy-safe
[`client-signals`](https://github.com/superfly/client-signals) marker to
Sprites API requests. An explicit declaration from your application or an
outer agent harness is never overwritten. The marker is advisory analytics
only and is never used for access control, gating, or rate-limiting.

## Usage

After building the repository, an example run from its root can import the
adapter from `dist`:

```ts
import { SpritesClient } from '@fly/sprites';
import { OpenRouter, stepCountIs } from '@openrouter/agent';
import { createSpriteWorkspace } from './dist/index.js';

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
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Release and versioning policy](RELEASING.md)

The RFC defines the public contract. The Cucumber acceptance suite runs against
a deterministic fake Sprite, with separate credential-gated tests against real
Sprites and OpenRouter services.

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
