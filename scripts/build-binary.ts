import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = `${projectRoot}artifacts`;
const executableName = process.platform === 'win32' ? 'cliscope.exe' : 'cliscope';

const started = performance.now();
await mkdir(outputDirectory, { recursive: true });

// Build on the target host so npm installs the matching OpenTUI native package.
// Defining libc removes the unused native-package branch from Linux binaries.
const result = await Bun.build({
  entrypoints: [`${projectRoot}src/cli.ts`],
  compile: {
    outfile: `${outputDirectory}/${executableName}`,
    autoloadDotenv: false,
    autoloadBunfig: false,
    autoloadTsconfig: false,
    autoloadPackageJson: false,
  },
  define: { 'process.env.OPENTUI_LIBC': JSON.stringify('glibc') },
  minify: true,
  sourcemap: 'inline',
});

if (!result.success) {
  for (const diagnostic of result.logs) {
    console.error(diagnostic);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Built ${outputDirectory}/${executableName} in ${Math.round(performance.now() - started)} ms`,
  );
}
