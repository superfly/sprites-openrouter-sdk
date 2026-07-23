# Acceptance tests

These Gherkin features are the black-box product contract for the proposed
`@fly/sprites-openrouter` package in `superfly/sprites-openrouter-sdk`. The
package builds on the JavaScript SDK in `superfly/sprites-js`, which is published
to npm as `@fly/sprites`. The scenarios are intentionally authored before
production code.

The scenarios use two release tags:

- `@mvp`: required before `1.0.0`.
- `@later`: valuable behavior explicitly outside the first stable release.

Additional execution-profile tags describe required infrastructure:

- `@fake`: must run using a deterministic fake of the public `Sprite` surface.
- `@live`: must also run against a real Sprite when credentials are available.

The features are bound to a Cucumber TypeScript runner. Step definitions share
a deterministic fake of the released public Sprite surface, while assertions
observe the public `@fly/sprites-openrouter` API and model-visible tool results.

## Features

- [`tools.feature`](tools.feature): presets, names, and structured results.
- [`output.feature`](output.feature): bounds, truncation, errors, and timeouts.
- [`concurrency.feature`](concurrency.feature): ordering and queue recovery.
- [`lifecycle.feature`](lifecycle.feature): existing and managed workspaces.
- [`checkpoints.feature`](checkpoints.feature): recovery point behavior.
- [`security.feature`](security.feature): environment, paths, and policies.
- [`multi_turn.feature`](multi_turn.feature): end-to-end product promise.
- [`distributed_locking.feature`](distributed_locking.feature): explicitly
  deferred multi-worker coordination.

## Automation strategy

1. Run all `@fake` scenarios on every pull request.
2. Run `@live` scenarios in a credentialed CI job and before releases.
3. Run the same feature steps against every supported peer-dependency matrix
   entry.
4. Treat scenario changes as public-contract changes requiring RFC review.

Run the fake contract with `npm run test:acceptance`. Credential-gated live
coverage is available through `npm run test:live`.
