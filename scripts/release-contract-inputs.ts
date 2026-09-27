import ts from 'typescript';
import {
  expressionText,
  nodes,
  one,
  properties,
  requiredProperty,
  stringValue,
  variable,
} from './release-contract-ast.js';
import type { Source } from './release-contract-ast.js';
import type { Contract } from './release-contract-schema.js';

function defaultValue(expression: ts.Expression, source: Source): string | null {
  const defaults = nodes(
    expression,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['default', 'prefault'].includes(node.expression.name.text),
  );
  if (defaults.length > 1) throw new Error('Unsupported contract: multiple defaults on one option');
  const value = defaults[0];
  if (!value) return null;
  if (!ts.isCallExpression(value) || value.arguments.length !== 1 || !value.arguments[0])
    throw new Error('Unsupported option default');
  return expressionText(value.arguments[0], source);
}

function validators(source: Source): ReadonlyMap<string, ts.Expression> {
  const schema = variable(source, 'optionsSchema');
  const object = one(
    schema,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'z' &&
      node.expression.name.text === 'object',
    'Zod options object',
  );
  if (!ts.isCallExpression(object) || object.arguments.length !== 1 || !object.arguments[0])
    throw new Error('Unsupported Zod options object');
  source.masked.push(object.arguments[0]);
  return properties(object.arguments[0]);
}

export function extractFlags(source: Source): Contract['flags'] {
  const parse = one(
    source.file,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'parseArgs',
    'parseArgs call',
  );
  if (!ts.isCallExpression(parse) || parse.arguments.length !== 1 || !parse.arguments[0])
    throw new Error('Unsupported parseArgs invocation');
  const options = requiredProperty(parse.arguments[0], 'options');
  const help = variable(source, 'HELP');
  if (!ts.isStringLiteral(help) && !ts.isNoSubstitutionTemplateLiteral(help))
    throw new Error('Unsupported executable HELP initializer');
  source.masked.push(options, help);
  const schemas = validators(source);
  const flags = Object.fromEntries(
    [...properties(options)].map(([name, definition]) => [
      name,
      extractFlag(name, definition, schemas.get(name), source),
    ]),
  );
  for (const name of schemas.keys())
    if (!Object.hasOwn(flags, name)) throw new Error(`Validator has no CLI flag: ${name}`);
  return flags;
}

function extractFlag(
  name: string,
  definition: ts.Expression,
  validation: ts.Expression | undefined,
  source: Source,
): Contract['flags'][string] {
  const fields = properties(definition);
  if ([...fields.keys()].some((key) => !['type', 'short'].includes(key)))
    throw new Error(`Unsupported option definition: ${name}`);
  const type = stringValue(requiredProperty(definition, 'type'));
  if (type !== 'boolean' && type !== 'string') throw new Error(`Unsupported option type: ${name}`);
  const short = fields.get('short');
  if (!validation && name !== 'help' && name !== 'version')
    throw new Error(`Missing validator for option: ${name}`);
  return {
    type,
    short: short ? stringValue(short) : null,
    validation: validation ? expressionText(validation, source) : null,
    default: validation ? defaultValue(validation, source) : null,
  };
}
