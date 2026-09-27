import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fc from 'fast-check';
import {
  createToolFilter,
  fitViewport,
  initialState,
  matchingTools,
  reduceKey,
  type InteractiveKey,
} from '../src/interactive-state.js';

function key(name: string, overrides: Partial<InteractiveKey> = {}): InteractiveKey {
  return { name, sequence: name, ctrl: false, meta: false, shift: false, ...overrides };
}

await test('search consumes q and navigation letters as text; Escape resets selection and filter', () => {
  let state = reduceKey(initialState, key('/'), 12);
  for (const character of 'jqk') state = reduceKey(state, key(character), 12);
  assert.equal(state.query, 'jqk');
  assert.equal(state.quitting, false);
  assert.equal(state.selected, 0);
  assert.equal(reduceKey(state, key('return'), 0).searching, false);
  assert.deepEqual(reduceKey(state, key('escape'), 0), initialState);
  assert.equal(reduceKey(initialState, key('q'), 12).quitting, true);
});

await test('filter cache reuses normalized queries and preserves original rows and order', () => {
  let nameReads = 0;
  const tools = [
    {
      get name(): string {
        nameReads += 1;
        return '\u001b[31mDocker';
      },
      count: 3,
      share: 0.75,
    },
    { name: 'git', count: 1, share: 0.25 },
  ];
  const filter = createToolFilter(tools);
  assert.equal(filter(''), tools);
  assert.equal(nameReads, 0);
  const docker = filter('dock');
  assert.deepEqual(docker, [tools[0]]);
  assert.equal(filter('DOCK'), docker);
  assert.equal(filter(''), tools);
  assert.equal(filter('dock'), docker);
  assert.deepEqual(filter('git'), [tools[1]]);
  assert.deepEqual(filter('missing'), []);
  assert.deepEqual(filter('dock'), docker);
  assert.equal(nameReads, 1);
});

await test('keyboard navigation supports arrows, vim keys, and both ends', () => {
  const down = reduceKey(initialState, key('j'), 12);
  assert.equal(down.selected, 1);
  assert.equal(reduceKey(down, key('down'), 12).selected, 2);
  assert.equal(reduceKey(down, key('k'), 12).selected, 0);
  assert.equal(reduceKey(down, key('up'), 12).selected, 0);
  assert.equal(reduceKey(down, key('g', { shift: true }), 12).selected, 11);
  assert.equal(reduceKey(down, key('end'), 12).selected, 11);
  assert.equal(reduceKey(down, key('home'), 12).selected, 0);
  assert.equal(reduceKey(down, key('g'), 12).selected, 0);
});

await test('Tab cycles all views and only the tools view accepts filters', () => {
  const calendar = reduceKey(initialState, key('tab'), 12);
  assert.equal(calendar.view, 'calendar');
  assert.deepEqual(reduceKey(calendar, key('/'), 12), calendar);
  assert.equal(reduceKey(calendar, key('escape'), 12).view, 'calendar');
  assert.equal(reduceKey(calendar, key('q'), 12).quitting, true);
  const weekdays = reduceKey(calendar, key('tab'), 12);
  assert.equal(weekdays.view, 'weekdays');
  assert.equal(reduceKey(weekdays, key('tab'), 12).view, 'tools');
  const searching = reduceKey(initialState, key('/'), 12);
  const switched = reduceKey(searching, key('tab'), 12);
  assert.equal(switched.view, 'calendar');
  assert.equal(switched.searching, false);
});

await test('search rejects terminal sequences and modifier keys; Unicode editing stays valid', () => {
  const searching = reduceKey(initialState, key('/'), 12);
  for (const input of [
    key('up', { sequence: '\u001b[A' }),
    key('a', { ctrl: true }),
    key('x', { meta: true }),
  ]) {
    assert.deepEqual(reduceKey(searching, input, 12), searching);
  }
  const emoji = reduceKey(searching, key('🦊'), 12);
  assert.equal(emoji.query, '🦊');
  assert.equal(reduceKey(emoji, key('backspace'), 0).query, '');
  const full = { ...searching, query: '🦊'.repeat(128) };
  assert.equal(reduceKey(full, key('x'), 12).query, full.query);
});

await test('viewport keeps selection bounded and visible through arbitrary movement and resizing', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -1000, max: 1000 }),
      fc.integer({ min: -1000, max: 1000 }),
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 1, max: 100 }),
      (selected, offset, count, rows) => {
        const state = fitViewport({ ...initialState, selected, offset }, count, rows);
        assert.ok(state.selected >= 0);
        assert.ok(state.selected <= Math.max(0, count - 1));
        assert.ok(state.offset >= 0);
        assert.ok(state.offset <= state.selected);
        assert.ok(state.selected < state.offset + rows);
      },
    ),
    { numRuns: 300 },
  );
});

await test('filter matches displayed safe names case-insensitively without changing global shares', () => {
  const tools = [
    { name: '\u001b[31mDocker', count: 61, share: 61 / 474 },
    { name: 'git', count: 142, share: 142 / 474 },
  ];
  const result = matchingTools(tools, 'DOCK');
  assert.equal(result.length, 1);
  assert.equal(result[0], tools[0]);
  assert.equal(matchingTools(tools, 'missing').length, 0);
});
