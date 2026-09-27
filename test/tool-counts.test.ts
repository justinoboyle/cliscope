import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fc from 'fast-check';
import { analyze } from '../src/analyze.js';
import { countTools, extractTools } from '../src/shell-tools.js';

await test('counted extraction preserves ordered extraction totals for generated records', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 500 }), (command) => {
      const tools = extractTools(command);
      const expected = new Map<string, number>();
      for (const name of tools) expected.set(name, (expected.get(name) ?? 0) + 1);
      assert.deepEqual(countTools(command), { totalInvocations: tools.length, counts: expected });
    }),
    { numRuns: 2_000 },
  );
});

await test('late invalid syntax discards all tentative counts', () => {
  for (const suffix of ['cat <<EOF', 'echo "open', 'f() { echo bad; }']) {
    const command = `${'git;'.repeat(10_000)}${suffix}`;
    assert.deepEqual(countTools(command), { totalInvocations: 0, counts: new Map() });
    assert.equal(analyze([{ command, timestamp: 0 }]).totalInvocations, 0);
  }
});

await test('aggregation counts a dense record without retaining each invocation', () => {
  const report = analyze([{ command: 'git;'.repeat(100_000), timestamp: 0 }]);
  assert.equal(report.totalInvocations, 100_000);
  assert.deepEqual(report.tools, [{ name: 'git', count: 100_000, share: 1 }]);
  assert.deepEqual(report.days, [{ date: '1970-01-01', count: 100_000 }]);
});
