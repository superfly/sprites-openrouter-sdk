# Contributing

Thanks for helping improve Sprites for the OpenRouter Agent SDK.

Use GitHub issues for bug reports and feature discussions. For a security
issue, follow [the security policy](SECURITY.md) instead of opening a public
issue.

## Development setup

The package requires Node.js 24 or later and npm.

```sh
git clone https://github.com/superfly/sprites-openrouter-sdk.git
cd sprites-openrouter-sdk
npm ci
```

Run the deterministic checks before opening a pull request:

```sh
npm test
npm run test:acceptance
npm run typecheck
npm run build
npm run package:check
npm run package:smoke
```

The acceptance features describe the public product contract. Changes to that
contract should update both the affected feature and the API RFC.

## Live tests

`npm run test:live` creates and deletes real Sprites and can make paid
OpenRouter model calls. It skips unless the required credentials are present.
See the README for the required environment variables.

Never commit credentials, put them in test fixtures, or include them in issue
or pull request output. The project runs credentialed live tests separately
from untrusted pull request code.

## Pull requests

- Keep changes focused and explain their user impact.
- Add regression coverage for fixes and tests for new behavior.
- Update public documentation when behavior or exported types change.
- Preserve backward compatibility within the guarantees described in
  [the release and versioning policy](RELEASING.md).
- Use a descriptive pull request title; maintainers generally squash changes
  when merging.

Unless stated otherwise, contributions are licensed under the repository's
MIT License.
