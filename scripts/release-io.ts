import { execFile } from 'node:child_process';
import { appendFile, readFile, realpath } from 'node:fs/promises';
import { delimiter, isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { parseReservation, validateReleaseTag, type Reservation } from './release-model.js';

const execute = promisify(execFile);

function inside(directory: string, root: string): boolean {
  const path = relative(root, directory);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function unsafeDirectory(directory: string, roots: readonly string[]): boolean {
  return (
    /(?:^|[\\/])node_modules(?:[\\/]|$)/iu.test(directory) ||
    roots.some((root) => inside(directory, root))
  );
}

async function existingDirectory(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return undefined;
    throw error;
  }
}

/** Never resolve privileged tools from npm-injected bins or checked-out source. */
export async function releasePath(
  path: string,
  workspace: string,
  cwd = workspace,
): Promise<string> {
  const roots = await Promise.all([realpath(workspace), realpath(cwd)]);
  const trusted = new Set<string>();
  for (const directory of path.split(delimiter)) {
    if (!isAbsolute(directory) || unsafeDirectory(directory, roots)) continue;
    const resolved = await existingDirectory(directory);
    if (resolved && !unsafeDirectory(resolved, roots)) trusted.add(resolved);
  }
  if (trusted.size === 0) throw new Error('Release PATH has no trusted external directories');
  return [...trusted].join(delimiter);
}

export async function run(file: string, args: readonly string[], cwd?: string): Promise<string> {
  const path = await releasePath(process.env['PATH'] ?? '', process.cwd(), cwd);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
  );
  const { stdout } = await execute(file, [...args], {
    cwd,
    env: { ...env, PATH: path },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function repository(): Promise<string> {
  const value =
    process.env['GH_REPO'] ??
    process.env['GITHUB_REPOSITORY'] ??
    (await run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']));
  return z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .parse(value);
}

export async function api(path: string, args: readonly string[] = []): Promise<unknown> {
  return JSON.parse(await run('gh', ['api', path, ...args]));
}

export function isNotFound(error: unknown): boolean {
  const parsed = z.object({ stderr: z.string() }).safeParse(error);
  return parsed.success && parsed.data.stderr.includes('(HTTP 404)');
}

export const releaseSchema = z.object({
  id: z.number().int().positive(),
  draft: z.boolean(),
  tag_name: z.string(),
  assets: z.array(z.object({ name: z.string(), digest: z.string().nullable().optional() })),
});
export type GitHubRelease = z.infer<typeof releaseSchema>;
export async function findRelease(repo: string, tag: string): Promise<GitHubRelease | undefined> {
  try {
    return releaseSchema.parse(await api(`repos/${repo}/releases/tags/${tag}`));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  // The tag endpoint documents published releases; drafts require the authenticated list.
  for (let page = 1; ; page++) {
    const releases = z
      .array(releaseSchema)
      .parse(await api(`repos/${repo}/releases?per_page=100&page=${page}`));
    const match = releases.find((release) => release.tag_name === tag);
    if (match) return match;
    if (releases.length < 100) return undefined;
  }
}

export async function remoteReservation(
  repo: string,
  tag: string,
): Promise<Reservation | undefined> {
  validateReleaseTag(tag);
  let ref: unknown;
  try {
    ref = await api(`repos/${repo}/git/ref/tags/${tag}`);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  const object = z
    .object({ object: z.object({ type: z.literal('tag'), sha: z.string() }) })
    .parse(ref).object;
  const annotated = z
    .object({
      message: z.string(),
      object: z.object({ type: z.literal('commit'), sha: z.string() }),
    })
    .parse(await api(`repos/${repo}/git/tags/${object.sha}`));
  const reservation = parseReservation(annotated.message);
  if (reservation.tag !== tag || reservation.sourceSha !== annotated.object.sha)
    throw new Error('Annotated tag does not identify its recorded release source');
  return reservation;
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function output(values: Readonly<Record<string, string>>): Promise<void> {
  const lines = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const destination = process.env['GITHUB_OUTPUT'];
  if (destination) await appendFile(destination, `${lines}\n`);
  else console.log(lines);
}
