# Release and versioning policy

This package follows [Semantic Versioning](https://semver.org/).

## Compatibility guarantees

- `0.x` releases are experimental. A minor release may contain a breaking API
  change when the release notes describe the change and migration path.
- Patch releases must remain backward compatible within their minor line.
- Beginning with `1.0.0`, breaking public API changes require a new major
  version. Compatible features use a minor version and fixes use a patch
  version.
- Exported JavaScript APIs, TypeScript declarations, model-visible tool names,
  schemas, and documented lifecycle behavior are part of the public contract.
- Supported peer-dependency ranges are compatibility claims and must be
  covered by CI or live release validation.

Deprecations should remain available for at least one minor release when
practical. Security fixes may require an accelerated removal.

## Prereleases and npm tags

Prerelease versions use SemVer suffixes such as `-rc.1` or `-beta.1`. They are
published under the matching npm distribution tag. Other prereleases use the
`next` tag. Stable releases use `latest`.

Every npm release must correspond to an immutable `vX.Y.Z` Git tag and a
GitHub release. The version in `package.json`, the Git tag, and the npm package
must agree.

## Release checklist

Before creating a release, a maintainer must:

1. Confirm the release commit is on `main` and all required GitHub checks pass.
2. Review user-facing changes and record migrations or compatibility changes
   in the GitHub release notes.
3. Run the credentialed Sprite and OpenRouter live suite against the package
   tarball and the supported peer-dependency versions.
4. Inspect the package with `npm run package:check` and verify a clean consumer
   install with `npm run package:smoke`.
5. Confirm `npm audit --omit=dev` reports no unresolved high or critical
   production vulnerabilities.
6. Publish through the protected GitHub Actions release workflow with npm OIDC
   trusted publishing and provenance. Do not publish a stable release from a
   maintainer workstation.
7. Verify the npm version, distribution tag, provenance, GitHub tag, and
   release notes after publishing.

If npm requires the package to exist before its trusted-publisher relationship
can be configured, a maintainer may bootstrap one prerelease from protected CI
with a short-lived granular token. Configure trusted publishing and revoke that
token immediately afterward. Do not publish a stable release until the
protected workflow and trusted-publisher relationship are active.
