# cliscope reference

## Synopsis

```sh
npx cliscope [options]
```

With a global installation or a standalone executable, use `cliscope [options]`.

## Description

Read one shell history file and print command counts and activity graphs to
standard output. The default view shows the ten most frequent tools. Use `-i`
for an interactive report; interactive mode requires a terminal.

History is read as text. Stored commands are not executed, and the history file
is not changed. Reports contain command names and aggregate counts. Names and
filenames may contain private information.

## Options

| Option                      | Operation                                                                        |
| --------------------------- | -------------------------------------------------------------------------------- |
| `-i`, `--interactive`       | Display an interactive report.                                                   |
| `-f PATH`, `--history PATH` | Read the specified history file.                                                 |
| `-s SHELL`, `--shell SHELL` | Select `auto`, `bash`, `zsh`, or `fish`. Default: `auto`.                        |
| `-n NUMBER`, `--top NUMBER` | Print 1–100 tools in the text report. Default: 10.                               |
| `--since DATE`              | Include dated entries on or after `YYYY-MM-DD`, in UTC. Exclude undated entries. |
| `--view VIEW`               | Select `tools`, `calendar`, or `weekdays`. Default: `tools`.                     |
| `--json`                    | Print the complete report as JSON, including weekday statistics.                 |
| `--csv`                     | Print every row of the selected view as CSV.                                     |
| `-o PATH`, `--output PATH`  | Create an output file. Fail if it exists. Use `-` for standard output.           |
| `--ascii`                   | Draw graphs with ASCII characters.                                               |
| `--no-color`                | Disable ANSI colors. Also set by `NO_COLOR`.                                     |
| `--demo`                    | Read synthetic sample history. Do not read a history file.                       |
| `-h`, `--help`              | Print help.                                                                      |
| `-v`, `--version`           | Print the version.                                                               |

`--json` and `--csv` are mutually exclusive. Neither can be combined with `-i`.
`--output` cannot be combined with `-i`, including `--output -`.
`--demo` cannot be combined with `--history`.

## Files

Supported formats are plain or timestamped Bash history, plain or extended Zsh
history, and Fish history. Select a format with `--shell` when automatic detection
cannot identify it.

File discovery checks `--history`, then `HISTFILE`, then the active shell's
standard history path, with fallback to other standard files. An explicit
`--shell` selects that shell's standard file when no path is supplied. Fish
respects `XDG_DATA_HOME`.

Only one file is read per invocation. Unsaved history from the current shell
session is unavailable. Input must be a regular file no larger than 64 MiB.
Plain Bash history is read one line at a time because it has no multiline record
delimiter.

## Counts

A history entry is a stored command record. An invocation is a recognizable
command in a chain or pipeline. For example, `git status && npm test` contributes
two invocations, regardless of whether the second command ran.

Common wrappers, including `sudo`, `env`, `command`, `nice`, `timeout`, `nohup`,
`exec`, `time`, and `builtin`, are removed when their arguments can be recognized.
Executable paths are reduced to names. Builtins and aliases appear as written.
Aliases are not expanded, dynamic command names are omitted, and substitutions
are treated as opaque text. Records containing heredocs, function definitions,
or unsupported case/switch syntax are skipped.

Share is a tool's count divided by all invocations, including tools outside
`--top`. Bars scale against the largest tool count. Equal counts sort by tool
name deterministically.

Daily activity counts invocations by UTC date. Missing days show zero. The daily
chart displays at most the final 56 days. Undated entries contribute to tool
counts unless `--since` is supplied.

The calendar displays at most twelve weeks. Each column is a week, with Monday
at the top. Shading scales against the largest visible daily count.

A weekday's mean is its count divided by the number of occurrences of that
weekday between the first and last dated entries, including quiet days. Its
score is `100 × mean / highest weekday mean`. These values describe recorded
history, not confirmed executions or productivity.

## Output

JSON includes the full report and weekday statistics. CSV includes every row of
the selected view. `--top` limits text rows only. Calendar CSV contains the dated
rows present in the report; the drawn calendar fills gaps with zero.

CSV quotes text fields and prefixes values that could be interpreted as
spreadsheet formulas. JSON escapes control characters. Printed labels and paths
have terminal control sequences removed.

`--output PATH` creates a new file with mode `0600` on systems with POSIX
permissions. Existing files are not replaced. File output disables color.

```sh
npx cliscope --since 2026-09-01 --json --output report.json
npx cliscope --view weekdays --csv --output weekdays.csv
```

## Keys

| Key              | Operation                                     |
| ---------------- | --------------------------------------------- |
| **Tab**          | Switch between tools, calendar, and weekdays. |
| **j/k**, **↓/↑** | Move through tools.                           |
| **Home/End**     | Select the first or last matching tool.       |
| **/**            | Start filtering tool names.                   |
| **Enter**        | Finish editing the filter.                    |
| **Esc**          | Clear the filter and reset the selection.     |
| **q**            | Exit when not editing a filter.               |
| **Ctrl+C**       | Exit.                                         |

## Installation

The npm package requires Node.js 20.13.1 or later. It installs its own Bun
runtime; a separate Bun installation is not required.

Use `npx cliscope` without a global installation. To install globally:

```sh
npm install --global cliscope
cliscope
```

For standalone executables, see [binary installation](releases.md#install-a-binary).

## Exit status

Exit status is 0 on success and 1 on error. Diagnostics are written to standard
error.

## See also

[Contributing](../CONTRIBUTING.md), [engineering checks](engineering.md),
[releases](releases.md), [license](../LICENSE).
