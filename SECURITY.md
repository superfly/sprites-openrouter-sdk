# Security policy

## Supported versions

Before `1.0.0`, security fixes are made on the default branch and released in
the newest `0.x` version. Older `0.x` lines are not supported unless a release
notice explicitly says otherwise.

After `1.0.0`, the latest major release receives security fixes. Additional
supported release lines, if any, will be identified in their release notes.

## Reporting a vulnerability

Do not report suspected vulnerabilities in a public GitHub issue or
discussion. Email [security@fly.io](mailto:security@fly.io) with:

- a description of the issue and its impact;
- affected versions or commit IDs;
- reproduction steps or a proof of concept; and
- any known mitigations.

Do not include customer data or active credentials. Fly.io can provide a
Signal contact when a more sensitive channel is appropriate. See
[Fly.io security practices](https://fly.io/docs/security/security-at-fly-io/)
for the company-wide reporting and remediation policy.

For vulnerabilities in `@fly/sprites` or `@openrouter/agent`, report the issue
privately to the affected upstream project as well. We will coordinate when a
fix spans this adapter and an upstream dependency.
