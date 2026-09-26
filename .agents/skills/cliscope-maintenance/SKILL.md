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

Use [the release procedure](../../../docs/releases.md) for release work. Keep
changes to this skill limited to demonstrated project requirements or failures.
