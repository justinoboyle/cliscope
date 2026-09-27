# Performance audit

Measured on 2026-09-26 on macOS ARM64 using synthetic histories. This audit covers
history parsing, command extraction, aggregation, rendering, interactive updates,
exports, file reads, startup, and builds. Findings were filed before implementation.
The linked issues identify each defect; the tables record observed results.

## Method

Source measurements use Node 26.9.0 or Bun 1.4.2 as labeled. Installed-launcher
measurements use Node 20.13.1 and Node 26.9.0 with the package's pinned Bun 1.4.2.
Bun's Node compatibility version is not the Node runtime version. Unless stated
otherwise, times are medians of five samples after one warmup on the same host.
Result checks accompany the measurements; helper timings include their
assertions. Timings from helper calls,
complete CLI processes, and builds are reported separately.

Before measurements use the preceding implementation saved before the relevant
edit. Published-binary comparisons use the checksum-verified 0.2.1 macOS ARM64
release. These are local comparisons, not claims about every supported machine.
Concurrent load and runtime allocation policy can affect results. The
[selected raw samples](performance-data.json) retain presentation and installed
startup measurements without local filesystem paths.

Memory probes are individual isolated subprocess observations unless a sample
count is specified. Dense adversarial fixtures stop at 4 MiB plus a command
prefix; they do not attempt to exhaust the host. MiB means 1,048,576 bytes. MB in
the tables means 1,000,000 bytes. A JavaScript heap limit is not a resident-memory
limit: RSS includes the runtime, native allocations, code, and other memory.

The initial cache refactor measured about 170 → 5.5–6.4 ms for 100,000 repeated
commands, with a separate distinct-command run at 166 ms. Before the later dense
lexer fixes, a seven-sample ordinary-word scanning comparison measured 100,000
chains at 294 → 218 ms and distinct extraction at 135 → 71 ms; 40,000 generated
commands matched the preceding implementation. These historical checks used
local development runs with varying concurrent load; they are separate from the
controlled comparisons below.

## Parsing and allocation

| Issue and fixture                                                                                   | Before                                                                                | After                                                                                             | Change and regression evidence                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#5](https://github.com/justinoboyle/cliscope/issues/5), 20k / 40k / 80k / 160k continued Zsh lines | 157.76 / 591.80 / 2,481.28 / 12,002.27 ms                                             | 1.79 / 3.43 / 6.62 / 15.14 ms                                                                     | Accumulate chunks and join once. Preserve timestamps, embedded newlines, trailing backslashes, and EOF. Three-sample source medians, Node 26.9.0.                                               |
| [#6](https://github.com/justinoboyle/cliscope/issues/6), one 4 MiB semicolon record                 | Published binary: 715 MiB peak RSS; ordinary history of equal size: 109 MiB           | Source Node with 128 MiB heap: old lexer aborts; new lexer passes, 82,304 KiB peak RSS, 742.27 ms | Consume lexer tokens incrementally. The source comparison holds the runtime and heap limit constant; the published Bun RSS is separate evidence.                                                |
| [#8](https://github.com/justinoboyle/cliscope/issues/8), 1 / 2 / 4 MiB newline-only history         | 145 / 180 / 248 MB peak RSS                                                           | 93 / 94 / 97 MB peak RSS                                                                          | Iterate physical lines instead of allocating a split array. All cases return zero entries. The 4 MiB parser call changed from 468 to 396 ms. Isolated Node 26.9.0 workers.                      |
| [#14](https://github.com/justinoboyle/cliscope/issues/14), one 4 MiB `a;` record                    | 241,991,680 bytes peak RSS, 781.11 ms; 2,097,152 names retained                       | 168,722,432 bytes peak RSS, 786.04 ms; exact same invocation count                                | Count repeated invocations directly. Complete CLI, Node 26.9.0, 128 MiB heap. About 30% lower peak RSS; no CPU improvement claimed.                                                             |
| [#15](https://github.com/justinoboyle/cliscope/issues/15), 4 MiB `a\n` history                      | 128 MiB heap: 577 ms, 298 MB peak RSS. With a 64 MiB heap: out-of-memory termination. | 64 MiB heap: 489 ms, 143.7 MB peak RSS; successful exit                                           | Stream history entries into aggregation. Exact result: 2,097,152 invocations of one tool. The array-returning parser remains available to callers. Complete source CLI subprocess measurements. |

The continuation fixture is `': 0:0;' + 'x\\\n'.repeat(N) + 'done'`. Its expected
command is `'x\n'.repeat(N) + 'done'`, timestamp zero. Published-binary versus
fixed-source Bun CLI runs, including startup, measured 230.86 → 65.19 ms at 40k
lines, 693.28 → 74.93 ms at 80k, and 2,373.32 → 102.40 ms at 160k. Those process
measurements must not be substituted for the source-only table above.

Compatibility checks compare 40,000 generated inputs across Bash, Zsh, and Fish
against the preceding parser through both the array and streaming interfaces.
Lexer differential checks cover 70,000 seeded commands. A dense argument fixture,
`'git ' + 'x '.repeat(2 * 1024 * 1024)`, is 4 MiB plus four bytes. Under Node's
128 MiB heap limit, the preceding lexer aborted; the incremental lexer returned
the single tool `git` in 293.11 ms with 82,272 KiB peak RSS. These lexer resource
figures are single isolated runs, not five-sample medians.
Count conservation and late-invalid-syntax tests protect the aggregation change.
The dense-record benchmark has seven independent cases: empty operators, a long
argument list, plain blank lines, timestamped Bash blank lines, continued Zsh
blank lines, repeated commands within one record, and repeated history entries.
Each uses a 4 MiB body plus any command or timestamp prefix, asserts exact output
under a 64 MiB heap, has its own time budget, and records peak RSS separately.

[#17](https://github.com/justinoboyle/cliscope/issues/17) addresses the remaining
fragment metadata within a single multiline record. Bash timestamp records and
Zsh continuations now share a buffer that joins each batch of 1,024 fragments,
then joins the completed chunks once. It never repeatedly copies the accumulated
record. Payload storage still grows with record size; at most 1,024 unjoined
fragments are retained alongside the completed chunks.

The following are medians of three isolated Node 26.9.0 processes with a 64 MiB
heap, holding the runtime and fixture constant. Every case returns zero entries.
Parser times exclude process startup; peak RSS is reported in KiB.

| Fixture body                     | Peak RSS before → after | Parser time before → after |
| -------------------------------- | ----------------------- | -------------------------- |
| Bash, 1 MiB blank lines          | 123,632 → 81,056 KiB    | 58.547 → 58.165 ms         |
| Bash, 4 MiB blank lines          | 198,544 → 98,832 KiB    | 259.112 → 246.416 ms       |
| Zsh, 1 MiB continued blank lines | 112,496 → 80,400 KiB    | 36.029 → 26.344 ms         |
| Zsh, 4 MiB continued blank lines | 189,168 → 95,728 KiB    | 161.275 → 89.695 ms        |

The Bash fixture is `'#0\n' + '\n'.repeat(BYTES)`, adding three header bytes.
The Zsh fixture is `': 0:0;' + '\\\n'.repeat(BYTES / 2)`, adding six header bytes.
Batch-boundary tests preserve blank lines, timestamps, EOF handling, and iterator
resumption. A seeded comparison checked 2,000 histories with 1,000–3,000 physical
lines against the preceding implementation through both APIs. An ordinary
100,000-record Zsh probe measured 33.079 ms before and 30.783 ms after; the short
record path avoids a second join. Raw samples are included in the evidence file.

## Rendering and interaction

| Issue and operation                                                                                               | Node 26.9.0 before → after | Bun 1.4.2 before → after |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------ |
| [#9](https://github.com/justinoboyle/cliscope/issues/9), truncate a 500,000 UTF-16-unit Unicode label to 22 cells | 55.827 → 1.523 ms          | 52.898 → 1.713 ms        |
| [#10](https://github.com/justinoboyle/cliscope/issues/10), 20 activity calls over 50,000 dated rows               | 51.091 → 0.771 ms          | 41.063 → 0.298 ms        |
| #10, one calendar over 50,000 dated rows                                                                          | 18.513 → 0.077 ms          | 13.620 → 0.067 ms        |
| [#11](https://github.com/justinoboyle/cliscope/issues/11), 20 unchanged nonempty filter calls over 50,000 tools   | 69.329 → 0.001 ms          | 263.863 → 0.005 ms       |

The long-label fixture is `'界🦊e\u0301'.repeat(100_000)`. Sanitization still reads
the complete input; width measurement stops after the visible graphemes and the
truncation decision. A bounded short-string fast path preserves ordinary report
speed: a ten-row report from 50,000 tools remained 0.026 ms on Node and 0.030 ms
on Bun. Property tests compare truncation with an independent complete-width
reference and check exact fits, combining characters, wide characters, emoji,
zero width, control removal, and ASCII ellipses.

[#19](https://github.com/justinoboyle/cliscope/issues/19) adds a separate
output-size bound. A zero-width combining sequence can fit in one terminal cell
while retaining hundreds of thousands of characters. `fitText` now emits at most
16 UTF-16 units per requested cell, including the ellipsis, and emits nothing at
zero width. It segments only that budget plus one lookahead unit. If the final
sampled grapheme might continue, it omits that whole grapheme. Ordinary accented
text, flags, skin-tone emoji, and keycaps retain their existing behavior.
Sanitization still reads the full input before sampling.

On Node 26.9.0, `e` followed by 100,000 U+0301 marks at width 22 changed from
200,001 output bytes and 8.124 ms to 3 bytes and 0.206 ms. At 500,000 marks it
changed from 1,000,001 bytes and 40.322 ms to 3 bytes and 1.013 ms. These are
same-host medians of five helper calls after one warmup against the saved
pre-fix implementation; they exclude terminal rendering. The benchmark now
checks the exact ellipsis result for the 500,000-mark case against its configured budget.
The evidence file retains all samples. This intentionally truncates unusually
large graphemes; it does not change exported JSON or CSV values.

Charts use sorted, unique UTC dates. At most 56 rows can intersect the activity
window, and at most 84 can intersect the calendar window. Sparse gaps remain
zero-filled and old peaks cannot affect the current scale. A separate Node
calendar scaling probe measured 500 / 5,000 / 50,000 days at
0.220 / 2.141 / 20.543 ms before and 0.075 / 0.072 / 0.092 ms after. Generated
comparisons checked 5,000 calendars against the previous implementation.

The filter fixture contains `tool-00000` through `tool-49999`, with count one
and share 1/50,000. The unchanged-query numbers measure helper calls, not full
terminal frames. The old UI called the helper twice per key. The new UI prepares
safe lowercase names on the first search, retains the most recent query result,
and returns the original array immediately for an empty query.

Caching does not remove first-use work. A first search over 50,000 tools measured
4.287 ms on Node and 12.459 ms on Bun. Twenty alternating queries measured
21.298 and 12.289 ms respectively. A first weekday view over 50,000 days measured
10.696 and 8.179 ms; twenty cached accesses took at most 0.001 ms. Three derived
views are retained at the current width, discarded on resize, and released with
the interactive session. Hidden detail panels do not compute their content.

The shared benchmark gates initial preparation separately from reuse. Each
`prepare and search 50k tools` sample creates a fresh filter; each
`prepare an interactive weekday view from 50k dated days` sample creates a fresh
view cache. Warmup therefore cannot hide name normalization or initial weekday
aggregation. Changed-query and cached-query cases, plus cached-view identity
checks, retain separate budgets.

Tests check cache identity, query changes, lazy preparation, resize invalidation,
and report isolation. See the [terminal regression](audit.md#consumer-and-terminal-regressions)
for interaction evidence and the maintained installed-package test procedure.

## Startup and unchanged paths

[#12](https://github.com/justinoboyle/cliscope/issues/12) splits the interactive
JavaScript out of the default npm entry. The entry shrank from 1,865,926 to
215,633 bytes. Dynamic chunks still ship in the archive; the application has not
discarded interactive functionality. Standalone compilation keeps its existing
layout. Installed-launcher medians include both Node startup and the Bun child:

| Runtime      | Command         | Published 0.2.1 | Split package |
| ------------ | --------------- | --------------- | ------------- |
| Node 20.13.1 | `--help`        | 82.76 ms        | 66.05 ms      |
| Node 20.13.1 | `--version`     | 82.75 ms        | 64.83 ms      |
| Node 20.13.1 | `--demo --json` | 86.83 ms        | 67.89 ms      |
| Node 26.9.0  | `--help`        | 77.67 ms        | 64.74 ms      |
| Node 26.9.0  | `--version`     | 78.99 ms        | 62.59 ms      |
| Node 26.9.0  | `--demo --json` | 82.76 ms        | 67.86 ms      |

The broader audit also measured paths without a demonstrated algorithmic defect:

- Warm reads of synthetic 1 / 4 / 16 MiB files measured
  1.27 / 2.83 / 10.48 ms before and 1.10 / 3.11 / 9.63 ms afterward. These are
  cached filesystem reads, not cold-storage throughput claims.
- Direct package build, native build, and `npm pack --ignore-scripts` medians
  were 65.27 / 221.19 / 773.42 ms before and 63.63 / 196.37 / 771.91 ms afterward.
  These isolate build commands; they exclude the verification suite run by the
  normal package scripts. No build-speed fix is claimed from these variations.
- CSV output remains proportional to the rows exported. For 50,000 tools,
  Node measured 13.866 → 15.609 ms and Bun 11.931 → 12.400 ms in the presentation
  probe. The CSV boundary removes terminal controls and guards formula prefixes;
  the audit did not justify limiting exported rows for speed.
- Ordinary Bash/Fish histories, distinct tools, and dated rows showed roughly
  linear growth from 25k to 100k records. The bounded 1,024-command cache has a
  working-set discontinuity: one 100k-record probe measured 5.29 ms at 1,024
  repeating commands and 62.45 ms at 1,025. Cache misses remain bounded linear
  work; expanding the cache without a memory bound would exchange one cost for
  another.

## Dense separator overhead

[#23](https://github.com/justinoboyle/cliscope/issues/23) followed a
[macOS Intel CI failure](https://github.com/justinoboyle/cliscope/actions/runs/36281888580/job/108515178346):
the 4 MiB semicolon fixture took 3,090.9 ms against its unchanged 3,000 ms budget;
command chains took 2,791.9 ms. Per-token arrays, delegated array iterators, and
per-separator invocation objects added avoidable work despite bounded memory.

The lexer now holds at most one pending word and one pending operator. The parser
resets one invocation object instead of constructing an object and `Set` at each
separator. Input containing only unquoted whitespace and operators returns empty
counts without tokenization. Quotes, escapes, substitutions, and words still use
the lexer. No operator tokens are coalesced or discarded from its public stream.

Five isolated subprocesses per fixture compared commit
`5a1c0b29242cf51eadcc165b42a1ec9d4bfb8da3` with the candidate on macOS arm64,
Node 26.9.0, with a 64 MiB V8 heap limit. Times include Node/tsx startup and
assertions; there was no warmup. RSS is the median process peak, not heap usage.

| 4 MiB fixture                  | Before    | After     | Peak RSS before / after |
| ------------------------------ | --------- | --------- | ----------------------- |
| `';'.repeat(4 * 1024 * 1024)`  | 704.99 ms | 71.67 ms  | 86,400 / 71,360 KiB     |
| `'a;'.repeat(2 * 1024 * 1024)` | 689.38 ms | 566.59 ms | 89,648 / 82,624 KiB     |

Run the same result-checking fixtures in each checkout:

```sh
node --max-old-space-size=64 --import tsx scripts/benchmark-memory.ts operators
node --max-old-space-size=64 --import tsx scripts/benchmark-memory.ts 'command chains'
```

The operator fixture asserts no tools; the chain fixture asserts 2,097,152
invocations of exactly one tool. A separate seeded differential probe compared
100,000 inputs against the committed lexer and parser, checking every token,
completion status, ordered extraction, and counted extraction. Inputs included
shell syntax fragments, arbitrary strings, and operator/whitespace-only strings.
The seeds, sample groups, and raw timing/RSS samples are retained in
[performance-data.json](performance-data.json). Tests also cover quoted and
escaped operator names, wrapper state reset, redirections, comments, token order,
and EOF. All 34 relevant source tests, type/lint/format checks, and the full local
benchmark suite passed. Local arm64 measurements do not establish that the Intel
CI job has passed; that requires the subsequent CI run. No budget was increased.

## Reproduce the current checks

From a dependency-installed checkout, run:

```sh
npm run bench
```

The benchmark implementation and fixed budgets live in
[scripts/benchmark.ts](../scripts/benchmark.ts); dense-memory assertions live in
[scripts/benchmark-memory.ts](../scripts/benchmark-memory.ts). The [contributor gate](../CONTRIBUTING.md#development) runs it during tests and
builds. Package and binary phases additionally time executable startup. Use the [consumer regression procedure](../.agents/skills/cliscope-maintenance/SKILL.md#consumer-runtime-regression)
to test an installed archive; a source-only pass does not verify packaging.

Each run records runtime, platform, architecture, samples, medians, and budgets
in `artifacts/performance-test.json`, `artifacts/performance-package.json`, or
`artifacts/performance-binary.json`. `artifacts/performance.json` is the latest
phase. The recorded local Node 26.9.0 run passed all budgets. Its five initial dense cases
measured 728.5 ms for operators, 362.1 ms for arguments, 564.1 ms for blank lines,
690.2 ms for command chains, and 386.6 ms for history entries, each under the
64 MiB heap limit. These values include subprocess startup. The [CI workflow](../.github/workflows/ci.yml) uploads these files in
`performance-TARGET` artifacts. Download results from an actual run, substituting
its ID:

```sh
gh run download RUN_ID --pattern 'performance-*' --dir performance-results
```

The audit does not claim a CI run that has not completed. For historical
comparisons, use separate checkouts and the same runtime, fixture, invocation,
warmup, and sample count. Do not compare a source function's time with process
startup or compare RSS across different runtimes as though only the algorithm
changed.

## Limits

The [input limit](manual.md#files) bounds bytes, not runtime memory. A history with many
distinct tools or dates requires corresponding output state. The public
array-returning parser and ordered extraction APIs intentionally retain their
results; the CLI aggregation path avoids these intermediate arrays. CSV and JSON
exports include all rows and therefore retain output-proportional work.

Sanitization must examine the complete label, and changed filters must inspect
the normalized search index. Weekday statistics must include all dated rows.
Caches are tied to an immutable report; changing a report requires a new session.
See [verification limits](engineering.md#verification-limits) and the
[manual](manual.md#counts) for interpretation boundaries. Cold-disk behavior,
maximum-size hostile workloads, and Windows terminal interaction remain outside
these measurements.
