import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeBundleLicenses } from './bundle-licenses.js';

const started = performance.now();
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outdir = `${projectRoot}dist`;

async function build(config: Bun.BuildConfig): Promise<Bun.BuildOutput> {
  const result = await Bun.build(config);
  if (!result.success) throw new AggregateError(result.logs, 'Package bundling failed');
  return result;
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await writeFile(`${outdir}/bunfig.toml`, '# No project-local runtime configuration.\n');

// Bundle all JavaScript so npm consumers do not inherit OpenTUI's Node FFI
// engine requirement. Only its existing per-platform native packages remain
// external; the launcher runs this application using the pinned Bun dependency.
// Keep runtime platform/libc checks intact: this one package serves every host.
const application = await build({
  entrypoints: [`${projectRoot}src/cli.ts`],
  outdir,
  naming: { entry: 'app.[ext]', asset: '[name]-[hash].[ext]' },
  target: 'bun',
  format: 'esm',
  // Keep the interactive module out of the default command's parse path.
  splitting: true,
  external: ['@opentui/core-*'],
  sourcemap: 'external',
  metafile: true,
});
if (application.metafile === undefined)
  throw new Error('Package build is missing its dependency manifest');
await writeBundleLicenses(application.metafile, projectRoot, `${outdir}/app.js`);

// The small launcher uses only Node 20-compatible APIs and syntax.
await build({
  entrypoints: [`${projectRoot}src/launcher.ts`],
  outdir,
  naming: 'launcher.[ext]',
  target: 'node',
  format: 'esm',
});

console.log(`Built npm package in dist/ (${Math.round(performance.now() - started)} ms)`);
