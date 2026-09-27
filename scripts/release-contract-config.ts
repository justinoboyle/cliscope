import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { canonicalJson } from './release-contract-schema.js';

/** Bun consumes this configuration when resolving and transforming source modules. */
export async function buildConfiguration(root: string): Promise<Readonly<Record<string, string>>> {
  const path = join(root, 'tsconfig.json');
  if (!(await lstat(path)).isFile()) throw new Error('Unsupported tsconfig.json: expected a file');
  const parsed = ts.parseConfigFileTextToJson(path, await readFile(path, 'utf8'));
  if (parsed.error) throw new Error('Unsupported tsconfig.json: invalid JSONC');
  const value: unknown = parsed.config;
  const config = z.record(z.string(), z.json()).parse(value);
  if (Object.hasOwn(config, 'extends'))
    throw new Error('Unsupported tsconfig.json extends: inherited configuration is not captured');
  return { 'configuration:tsconfig.json': canonicalJson(config).trim() };
}
