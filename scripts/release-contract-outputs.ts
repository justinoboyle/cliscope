import ts from 'typescript';
import { expressionText, nodes, one, propertyName, stringValue } from './release-contract-ast.js';
import type { Source } from './release-contract-ast.js';
import type { Contract } from './release-contract-schema.js';

function declaration(source: Source, name: string): ts.FunctionDeclaration {
  const node = one(
    source.file,
    (value) => ts.isFunctionDeclaration(value) && value.name?.text === name,
    `function ${name}`,
  );
  if (!ts.isFunctionDeclaration(node)) throw new Error(`Missing function ${name}`);
  return node;
}

export function extractCsv(source: Source): Contract['csv'] {
  const output: Contract['csv'] = {};
  const csv = declaration(source, 'csvRows');
  const cases = nodes(csv, ts.isCaseClause);
  if (!cases.length) throw new Error('Unsupported CSV dispatch');
  for (const branch of cases) {
    if (!ts.isCaseClause(branch)) throw new Error('Unsupported CSV case');
    const view = stringValue(branch.expression);
    const returned = one(branch, ts.isReturnStatement, `CSV return for ${view}`);
    if (
      !ts.isReturnStatement(returned) ||
      !returned.expression ||
      !ts.isArrayLiteralExpression(returned.expression)
    )
      throw new Error('Unsupported CSV rows');
    const headers = returned.expression.elements[0];
    if (!headers || !ts.isArrayLiteralExpression(headers))
      throw new Error('Unsupported CSV header');
    output[view] = headers.elements.map(stringValue);
    source.masked.push(headers);
  }
  return output;
}

function addInterface(source: Source, name: string, fields: Contract['outputs']): void {
  const node = one(
    source.file,
    (value) => ts.isInterfaceDeclaration(value) && value.name.text === name,
    `interface ${name}`,
  );
  if (!ts.isInterfaceDeclaration(node) || node.heritageClauses?.length)
    throw new Error(`Unsupported interface: ${name}`);
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type)
      throw new Error(`Unsupported output member in ${name}`);
    validateOutputType(member.type);
    fields[`${name}.${propertyName(member.name)}`] =
      `${member.questionToken ? 'optional ' : ''}${expressionText(member.type, source)}`;
  }
}

export function extractOutputs(
  types: Source,
  calendar: Source,
  exports: Source,
): Contract['outputs'] {
  const fields: Contract['outputs'] = {};
  for (const name of ['Report', 'ToolStat', 'DayStat']) addInterface(types, name, fields);
  addInterface(calendar, 'WeekdayStat', fields);
  const format = declaration(exports, 'formatReport');
  const json = one(
    format,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'JSON' &&
      node.expression.name.text === 'stringify',
    'JSON report serialization',
  );
  if (
    !ts.isCallExpression(json) ||
    !json.arguments[0] ||
    !ts.isObjectLiteralExpression(json.arguments[0])
  )
    throw new Error('Unsupported JSON report expression');
  fields['JSON.expression'] = expressionText(json.arguments[0], exports);
  return fields;
}

function validateOutputType(type: ts.TypeNode): void {
  if (nodes(type, (node) => ts.isImportTypeNode(node) || ts.isTypeQueryNode(node)).length)
    throw new Error(
      'Unsupported public output type reference; imported/query types need an explicit contract',
    );
  const allowed = new Set([
    'Report',
    'ToolStat',
    'DayStat',
    'WeekdayStat',
    'Array',
    'ReadonlyArray',
  ]);
  for (const reference of nodes(type, ts.isTypeReferenceNode)) {
    if (
      !ts.isTypeReferenceNode(reference) ||
      !ts.isIdentifier(reference.typeName) ||
      !allowed.has(reference.typeName.text)
    )
      throw new Error(
        'Unsupported public output type reference; resolve its contract before release',
      );
    const arity = ['Array', 'ReadonlyArray'].includes(reference.typeName.text) ? 1 : 0;
    if ((reference.typeArguments?.length ?? 0) !== arity)
      throw new Error('Unsupported public output type arguments');
  }
}
