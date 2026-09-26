# cliscope

Your terminal, in numbers. **cliscope** turns local shell history into a ranked usage graph, with an [OpenTUI](https://opentui.com/) dashboard one flag away.

```text
$ cliscope --demo

CLISCOPE  /  YOUR TERMINAL, IN NUMBERS
474 invocations  |  12 tools  |  474 history entries

TOP 5 TOOLS  /  COUNT + SHARE
 1  git       ████████████████████████████  142   30.0%
 2  npm       █████████████████              86   18.1%
 3  docker    ████████████                   61   12.9%
 4  rg        █████████                      48   10.1%
 5  codex     ███████                        35    7.4%
```

## Install

```sh
npm install --global cliscope
cliscope
cliscope -i
```

The npm package requires **Node.js 26.4+**. Interactive mode automatically enables Node's experimental FFI support for OpenTUI. Bun 1.4.2 also runs the source.

Standalone executables require **no Node.js, Bun, or npm**. Download a matching archive from [GitHub Releases](https://github.com/justinoboyle/cliscope/releases), verify its SHA-256 against `SHA256SUMS`, extract it, and put `cliscope` (or `cliscope.exe`) on your PATH. Builds cover macOS ARM64/x64, Linux ARM64/x64 (glibc), and Windows x64. This repository is private; release downloads require repository access. macOS binaries are unsigned and not notarized.

## Use

```sh
cliscope                        # Discover your active shell's history
cliscope -i                     # Interactive dashboard
cliscope --top 20                # Show more tools
cliscope --history ~/.zsh_history --shell zsh
cliscope --since 2026-09-01      # Inclusive UTC calendar date
cliscope --json                  # Full ranked report for scripts
cliscope --ascii --no-color      # Plain output; NO_COLOR is respected too
cliscope --demo -i               # Synthetic example without reading history
```

Inside the dashboard: **j/k** or **↑/↓** move, **/** starts filtering, **Enter** finishes typing, **Esc** resets, **Home/End** jump, and **q** or **Ctrl+C** exit. Interactive mode requires a terminal. The default graph works in pipes and CI.

Supported files: Bash plain/timestamped history, Zsh plain/extended history, and Fish history. Discovery uses `--history`, then `HISTFILE`, then the active shell's standard location, with fallback to other standard files. Fish respects `XDG_DATA_HOME`. An explicit `--shell` selects its standard file when no path is supplied. Only one history file is read per invocation; unsaved current-session history is unavailable. Files are capped at 64 MiB.

## What the numbers mean

- A **history entry** is a stored command record. A record such as `git status && npm test` contributes two lexical invocations, irrespective of whether the second command actually ran.
- An **invocation** is a recognizable command in a chain or pipeline. Common wrappers (`sudo`, `env`, `command`, `nice`, `timeout`, `nohup`, `exec`, `time`, `builtin`) are peeled when possible. Paths are reduced to executable names. Builtins and aliases appear as written.
- **Share** uses all invocations as its denominator, including tools outside `--top`. Bars scale against the most-used tool. Equal counts sort by tool name deterministically.
- **Daily activity** counts invocations using UTC dates. Missing days show zero; the chart shows the final 56 days at most. `--since` excludes entries without valid timestamps; undated entries otherwise count toward totals.

History is not an execution trace. This intentionally conservative lexical parser does not expand aliases, interpret functions, evaluate conditions, inspect scripts, or execute substitutions. Dynamic command names are omitted; substitutions are opaque; records with heredocs, function definitions, or unsupported case/switch syntax are skipped. Multiline plain Bash history lacks record delimiters, so it is interpreted one line at a time. Counts describe available stored history, not every command ever executed. There is no claim of a formal proof of shell semantics.

## Privacy

All analysis happens locally. No telemetry, network requests, shell execution, or history modification. Reports contain tool names and aggregate counts, never command arguments. Printed source paths and tool labels are sanitized for terminal control sequences. JSON preserves tool names as JSON-escaped data. A command name or history filename can itself be sensitive; review reports before sharing.

## Development and quality gates

```sh
npm ci
npm run dev -- --demo
npm run verify
./artifacts/cliscope --demo -i
```

`verify` runs strict TypeScript, type-aware Oxlint with zero warnings, Oxfmt, unit/integration/property tests, JavaScript compilation, and standalone binary compilation. See [the enforced engineering rules](docs/engineering.md), [contributing](CONTRIBUTING.md), and [release process](docs/releases.md). Dependencies and GitHub Actions are pinned. Git hooks run checks before commit and full verification before push; CI is the authoritative merge and release gate.

MIT licensed. See [LICENSE](LICENSE).
