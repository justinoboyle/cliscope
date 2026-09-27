import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artifactWorkflow } from '../scripts/release-contract-workflow.js';

const workflow = `name: Presentation
defaults: { run: { shell: bash } }
env: { KEEP: yes }
jobs:
  verify:
    name: Presentation
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        include:
          - target: linux-x64
            executable: cliscope
    steps:
      - name: Presentation
        if: success()
        run: |
          cp LICENSE artifacts/
          tar -czf native.tar.gz cliscope LICENSE
  package:
    name: Presentation
    steps:
      - run: npm pack
`;

await test('artifact configuration includes commands, matrix values, inherited settings and conditions', () => {
  const original = artifactWorkflow(workflow);
  assert.deepEqual(original.platforms, ['linux-x64']);
  for (const [before, after] of [
    ['tar -czf', 'tar -cJf'],
    ['executable: cliscope', 'executable: other'],
    ['runs-on: ubuntu-24.04', 'runs-on: windows-2025'],
    ['shell: bash', 'shell: pwsh'],
    ['KEEP: yes', 'KEEP: no'],
    ['if: success()', 'if: false'],
    ['npm pack', 'npm pack --ignore-scripts'],
    ['cp LICENSE artifacts/', 'cp README.md artifacts/'],
  ] as const)
    assert.notEqual(
      artifactWorkflow(workflow.replace(before, after)).configuration,
      original.configuration,
    );
});

await test('artifact configuration ignores YAML comments and presentation names only', () => {
  const original = artifactWorkflow(workflow);
  assert.deepEqual(artifactWorkflow(`# explanatory comment\n${workflow}`), original);
  assert.deepEqual(artifactWorkflow(workflow.replaceAll('Presentation', 'New title')), original);
  assert.deepEqual(artifactWorkflow(workflow.replace('shell: bash', 'shell: "bash"')), original);
  assert.notEqual(
    artifactWorkflow(workflow.replace('KEEP: yes', 'name: yes')).configuration,
    original.configuration,
  );
});

await test('unsupported artifact workflow structure fails closed', () => {
  for (const input of [
    'jobs: [',
    'jobs: {}\njobs: {}',
    workflow.replace('  package:', '  other:'),
    workflow.replace('target: linux-x64', 'target: "$DYNAMIC"'),
    workflow.replace('target: linux-x64', 'target: linux--x64'),
    workflow.replace('executable: cliscope', 'executable: cliscope\n          - target: linux-x64'),
    workflow.replace(/include:\n[^]*?    steps:/, 'include: []\n    steps:'),
    workflow.replace('    steps:', '    skipped:'),
    'jobs: &cycle { verify: *cycle }',
  ])
    assert.throws(() => artifactWorkflow(input));
});
