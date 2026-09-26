# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-09-26

- Run the npm package on Node.js 20.13.1 and later through a bundled application and pinned Bun runtime.
- Add calendar and weekday views, CSV export, and output files that refuse to overwrite existing files.
- Test packed npm installs across Node 20, 22, 24, and 26 on Linux, macOS, and Windows.
- Test interactive input, view switching, resizing, and terminal restoration in a pseudoterminal on Linux and macOS.
- Measure parser, aggregation, rendering, and startup performance during tests and builds.
- Publish npm packages from validated Git release tags using OIDC trusted publishing.
- Document version bumps, merges, tags, npm dist-tags, and failed-release recovery.

## 0.1.0 — 2026-09-26

- Local Bash, Zsh, and Fish history analytics with ranked CLI graphs and JSON export.
- OpenTUI dashboard with filtering, keyboard navigation, and terminal cleanup.
- UTC activity graphs, date filtering, ASCII output, and synthetic demo mode.
- Strict TypeScript, runtime input validation, type-aware Oxlint, formatting, and property tests.
- Standalone native builds and tagged, checksummed releases for five platform targets.
