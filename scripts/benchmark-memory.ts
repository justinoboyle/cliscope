import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.js';
import { extractTools, iterateHistory, parseHistory } from '../src/history.js';

const bytes = 4 * 1024 * 1024;
function checkAggregate(source: string): void {
  const report = analyze(iterateHistory(source, 'bash'));
  assert.equal(report.totalInvocations, bytes / 2);
  assert.deepEqual(report.tools, [{ name: 'a', count: bytes / 2, share: 1 }]);
}
switch (process.argv[2] ?? '') {
  case 'operators':
    assert.deepEqual(extractTools(';'.repeat(bytes)), []);
    break;
  case 'arguments':
    assert.deepEqual(extractTools(`git ${'x '.repeat(bytes / 2)}`), ['git']);
    break;
  case 'blank lines':
    assert.deepEqual(parseHistory('\n'.repeat(bytes), 'zsh'), []);
    break;
  case 'multiline blank lines':
    assert.deepEqual(parseHistory(`#0\n${'\n'.repeat(bytes)}`, 'bash'), []);
    break;
  case 'continued blank lines':
    assert.deepEqual(parseHistory(`: 0:0;${'\\\n'.repeat(bytes / 2)}`, 'zsh'), []);
    break;
  case 'command chains':
    checkAggregate('a;'.repeat(bytes / 2));
    break;
  case 'history entries':
    checkAggregate('a\n'.repeat(bytes / 2));
    break;
  default:
    throw new Error(`unknown memory benchmark: ${process.argv[2]}`);
}
console.log(process.resourceUsage().maxRSS);
