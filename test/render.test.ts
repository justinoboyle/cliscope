import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import * as fc from 'fast-check';
import stringWidth from 'string-width';
import {
  activityLines,
  fitText,
  renderReport,
  safeText,
  type RenderOptions,
} from '../src/render.js';
import type { Report } from '../src/types.js';

const report: Report = {
  totalEntries: 10,
  totalInvocations: 12,
  uniqueTools: 2,
  timestampedEntries: 10,
  tools: [
    { name: 'git', count: 9, share: 0.75 },
    { name: 'npm', count: 3, share: 0.25 },
  ],
  days: [
    { date: '2026-09-24', count: 2 },
    { date: '2026-09-26', count: 8 },
  ],
};
const options: RenderOptions = {
  width: 80,
  color: false,
  ascii: false,
  limit: 10,
  source: 'zsh history',
};

await test('reports invocation counts, global shares, coverage, and history entries distinctly', () => {
  const output = renderReport(report, { ...options, limit: 1 });
  assert.match(output, /12 invocations.*2 tools.*10 history entries/u);
  assert.match(output, /git.*9.*75\.0%/u);
  assert.match(output, /Shown: 75\.0%/u);
  assert.doesNotMatch(output, /npm/u);
});

await test('activity uses UTC calendar days and fills missing dates with zero', () => {
  assert.deepEqual(activityLines(report, 80, false), [
    'DAILY ACTIVITY / UTC / 3 days',
    '▂·█',
    '2026-09-24 - 2026-09-26  |  peak 8 invocations/day',
  ]);
  assert.deepEqual(activityLines(report, 2, true), [
    'DAILY ACTIVITY / UTC / 2 days',
    '.8',
    '2026-09-25 - 2026-09-26  |  peak 8 invocations/day',
  ]);
});

await test('empty history gives an actionable empty state without invalid numbers', () => {
  const output = renderReport(
    { ...report, totalEntries: 0, totalInvocations: 0, uniqueTools: 0, tools: [], days: [] },
    options,
  );
  assert.match(output, /No CLI tools found/u);
  assert.match(output, /--history PATH/u);
  assert.match(output, /no timestamps/u);
  assert.doesNotMatch(output, /NaN|Infinity/u);
});

await test('untrusted labels cannot inject terminal controls or line breaks', () => {
  assert.equal(safeText('\u001b]0;hijacked\u0007git\u001b[31m\r\n\t\u202e'), 'git');
  const output = renderReport(
    { ...report, tools: [{ name: '\u001b[2Jgit\nINJECTED', count: 12, share: 1 }] },
    {
      ...options,
      source: 'history\nINJECTED\u001b]52;c;payload\u0007',
    },
  );
  assert.ok(!output.includes('\u001b'));
  assert.doesNotMatch(output, /^INJECTED/gmu);
});

await test('Unicode and control-filled names stay within every supported terminal width', () => {
  const names = fc
    .array(fc.constantFrom('a', '界', 'é', 'e\u0301', '🦊', '\u001b[2J', '\n', '\u202e', ' '), {
      maxLength: 80,
    })
    .map((parts) => parts.join(''));
  fc.assert(
    fc.property(
      names,
      fc.integer({ min: 1, max: 300 }),
      fc.boolean(),
      fc.boolean(),
      (name, width, color, ascii) => {
        const output = renderReport(
          { ...report, tools: [{ name, count: 12, share: 1 }] },
          { ...options, width, color, ascii, source: name },
        );
        const plain = stripVTControlCharacters(output);
        for (const line of plain.split('\n')) {
          assert.ok(
            stringWidth(line) <= Math.min(width, 240),
            `line exceeded ${width} cells: ${JSON.stringify(line)}`,
          );
          assert.doesNotMatch(line, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
        }
      },
    ),
    { numRuns: 300 },
  );
});

await test('truncation preserves graphemes and never leaves half of a wide character', () => {
  assert.equal(fitText('界界', 3), '界…');
  assert.equal(fitText('e\u0301abcd', 3), 'e\u0301a…');
  assert.equal(fitText('🦊🦊', 1), '…');
  assert.equal(fitText('hello', 0), '');
  assert.equal(fitText('hello', 3, true), 'he~');
});
