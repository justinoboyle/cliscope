# Repository instructions

This repository contains `cliscope`, a local shell-history reporting command.
Apply these instructions only to work in this repository.

- Use the [maintenance skill](.agents/skills/cliscope-maintenance/SKILL.md) for
  changes to the application, packaging, tests, or documentation.
- Follow [engineering requirements](docs/engineering.md) and
  [writing rules](docs/style.md). The compiler, lint configuration, and package
  scripts define the executable checks; do not duplicate their settings here.
- Keep history parsing and aggregation pure. Validate CLI and filesystem input
  before it enters the domain model. Use synthetic histories in tests and reports.
- Prefer one implementation of each behavior. Share formatting and derived
  statistics between printable, interactive, and exported reports. Keep helpers
  named for the operation they perform; avoid abstractions used only to conceal
  branches from complexity checks.
- Run the checks relevant to a change, including the performance measurements
  attached to tests and builds. A successful source run does not establish that
  the published package works. Follow the installed-package regression procedure
  in the maintenance skill for launcher, dependency, and build changes.
- Update [the audit](docs/audit.md) when changing a reviewed boundary or discovering
  a regression. Record observed behavior, evidence, and remaining limits.

Use [the release procedure](docs/releases.md) for version, merge, and tag work.
Do not move a published tag or reuse a published npm version.
