import { parseDocument } from 'yaml';
import { z } from 'zod';
import { canonicalJson, contractSchema } from './release-contract-schema.js';

const mapping = z.record(z.string(), z.json());
const jobSchema = z.looseObject({ steps: z.array(mapping).min(1) });
const nativeMatrix = z.object({
  strategy: z.object({
    matrix: z.object({
      include: z.array(z.object({ target: z.string() })),
    }),
  }),
});

function withoutName(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'name'));
}

function executableJob(value: unknown): Record<string, unknown> {
  const job = jobSchema.parse(value);
  return { ...withoutName(job), steps: job.steps.map(withoutName) };
}

/** Preserve artifact-producing job semantics, including inherited workflow settings. */
export function artifactWorkflow(text: string): {
  readonly platforms: readonly string[];
  readonly configuration: string;
} {
  const document = parseDocument(text, { stringKeys: true, uniqueKeys: true });
  if (document.errors.length || document.warnings.length)
    throw new Error('Unsupported artifact workflow YAML');
  // Reject aliases instead of allowing recursive or expanding configuration graphs.
  const raw: unknown = document.toJS({ maxAliasCount: 0 });
  const workflow = mapping.parse(raw);
  const jobs = mapping.parse(workflow['jobs']);
  const verify = executableJob(jobs['verify']);
  const packageJob = executableJob(jobs['package']);
  return {
    platforms: contractSchema.shape.platforms
      .parse(nativeMatrix.parse(verify).strategy.matrix.include.map((row) => row.target))
      .toSorted(),
    configuration: canonicalJson({
      ...withoutName(workflow),
      jobs: { verify, package: packageJob },
    }).trim(),
  };
}
