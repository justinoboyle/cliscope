---
name: cliscope-maintenance
description: Maintain cliscope source and distributions using the repository checks and installed-package regressions.
---

# Maintain cliscope

Apply [engineering requirements](../../../docs/engineering.md) and
[writing rules](../../../docs/style.md). Use the
[contributor commands](../../../CONTRIBUTING.md#development) for validation and
[releases](../../../docs/releases.md) before changing release code or merging.
Consult the [audit](../../../docs/audit.md) for prior regressions. Keep additions
to this skill limited to demonstrated maintenance needs.

## Consumer-runtime regression

The original `npx cliscope -i` failed on Node 20.13.1 because it restarted Node
with unsupported `--experimental-ffi`. The launcher now uses its pinned Bun
dependency. With lifecycle scripts disabled, Bun's placeholder is not executable;
resolve the native `@oven` package, including nested dependency layouts.

For packaging, launcher, or runtime-dependency changes:

1. Build and pack the actual distribution.
2. Install the tarball outside the checkout with
   `--engine-strict --ignore-scripts`.
3. Run [smoke-package.mjs](../../../scripts/smoke-package.mjs) with the consumer
   Node runtime, then [test-terminal.py](../../../scripts/test-terminal.py) against
   that installed launcher on POSIX. Check content, controls, exit, and restoration.

Use [CI](../../../.github/workflows/ci.yml) for current commands and the runtime /
platform matrix. Source execution, native-binary checks, and non-TTY rejection do
not replace an installed interactive run. Windows console interaction is outside
the POSIX harness's coverage.
