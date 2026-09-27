---
name: cliscope-maintenance
description: Maintain this cliscope repository's history reports, terminal interface, packaging, and tests. Preserve its consumer-runtime regression checks and project documentation conventions.
---

# Maintain cliscope

Read [engineering requirements](../../../docs/engineering.md) before code changes
and [writing rules](../../../docs/style.md) before changing help, diagnostics,
reports, or documentation. Consult [the audit](../../../docs/audit.md) for the
reviewed module boundaries and limits of automated checks.

Keep executable decisions in the existing configuration and package scripts.
Use the smallest change that preserves the relevant invariants. Run `npm run check` and the behavior tests appropriate to the change. Tests and builds include
performance measurements; retain their assertions and budgets. Use `npm run verify` for the complete local gate.

## Consumer-runtime regression

The original npm distribution failed when the user ran `npx cliscope -i` under
Node 20.13.1: the application restarted Node with `--experimental-ffi`, a flag that
runtime did not support. Testing the source or a standalone Bun binary had not
tested the installed npm entry point.

The npm entry point now runs the packaged application with its pinned Bun
dependency. OpenTUI JavaScript is bundled; its platform-native packages remain
optional dependencies. Do not reintroduce OpenTUI's Node FFI engine requirement
into consumer dependencies. A disabled npm lifecycle script leaves
`bun/bin/bun.exe` as a placeholder, so the launcher resolves the native `@oven`
package directly, including nested dependency layouts.

For packaging, launcher, or runtime-dependency changes, build and pack the actual
distribution. Install its tarball outside the checkout with `--engine-strict --ignore-scripts`. Run `scripts/smoke-package.mjs` under the consumer Node runtime
and `scripts/test-terminal.py` against that installed launcher on POSIX. Verify
rendered content, interaction, exit status, and terminal restoration. Source tests
and non-TTY rejection tests do not replace this check. The CI workflow contains
the current runtime/platform matrix and commands.

## Automatic releases

Read [the release procedure](../../../docs/releases.md) before changing release
code or merging. Merging to `main` starts publication. Do not edit version numbers,
maintain a changelog, or prepare a version-editing PR. Tags supply release versions;
source manifests keep the development placeholder. The generated lock contains
the actual contract, not a release number.

Changes to contract extraction must test the preceding released source as well
as the candidate. Keep classification deterministic and conservative; do not
claim a source fingerprint proves semantic compatibility. Cover packaging fields
and artifact-producing helper changes, and preserve semantically ordered maps
such as conditional exports. A retry must recover
the reserved archives and verify their hashes. Never rebuild different bytes
under an existing tag or bypass a failed contract check.

For performance changes, file the measured issue first, retain a reproducible
before/after comparison, and add a result-checking time or memory regression.
Use [the performance audit](../../../docs/performance.md) for fixtures and limits.
Keep changes to this skill limited to demonstrated project requirements.
