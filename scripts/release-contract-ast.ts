import { createHash } from 'node:crypto';
import ts from 'typescript';

export interface Source {
  readonly file: ts.SourceFile;
  readonly text: string;
  readonly masked: ts.Node[];
}

export function parseSource(name: string, text: string): Source {
  const result = ts.transpileModule(text, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  });
  const errors =
    result.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ?? [];
  if (errors.length)
    throw new Error(
      `Unsupported source syntax in ${name}: ${ts.flattenDiagnosticMessageText(errors[0]?.messageText ?? '', '\n')}`,
    );
  return {
    file: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    text,
    masked: [],
  };
}

export function nodes(root: ts.Node, predicate: (node: ts.Node) => boolean): readonly ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

export function one(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean,
  description: string,
): ts.Node {
  const matches = nodes(root, predicate);
  const node = matches[0];
  if (matches.length !== 1 || !node)
    throw new Error(`Unsupported contract: expected exactly one ${description}`);
  return node;
}

export function variable(source: Source, name: string): ts.Expression {
  const node = one(
    source.file,
    (value) =>
      ts.isVariableDeclaration(value) && ts.isIdentifier(value.name) && value.name.text === name,
    `variable ${name}`,
  );
  if (!ts.isVariableDeclaration(node) || !node.initializer)
    throw new Error(`Unsupported contract initializer: ${name}`);
  return node.initializer;
}

export function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  throw new Error('Unsupported computed contract property');
}

export function properties(expression: ts.Node): ReadonlyMap<string, ts.Expression> {
  if (!ts.isObjectLiteralExpression(expression))
    throw new Error('Unsupported contract: expected an object literal');
  const result = new Map<string, ts.Expression>();
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property))
      throw new Error('Unsupported spread or method in contract object');
    const name = propertyName(property.name);
    if (result.has(name)) throw new Error(`Duplicate contract property: ${name}`);
    result.set(name, property.initializer);
  }
  return result;
}

export function requiredProperty(expression: ts.Node, name: string): ts.Expression {
  const value = properties(expression).get(name);
  if (!value) throw new Error(`Missing contract property: ${name}`);
  return value;
}

export function stringValue(expression: ts.Node): string {
  if (!ts.isStringLiteral(expression))
    throw new Error('Unsupported contract: expected a string literal');
  return expression.text;
}

type SyntaxTree = readonly [number, string | readonly SyntaxTree[]];

function leafText(node: ts.Node, source: ts.SourceFile): string {
  return ts.isStringLiteral(node) ? JSON.stringify(node.text) : node.getText(source);
}

function syntaxTree(node: ts.Node, source: ts.SourceFile): SyntaxTree {
  const children = node.getChildren(source);
  return [
    node.kind,
    children.length ? children.map((child) => syntaxTree(child, source)) : leafText(node, source),
  ];
}

export function expressionText(node: ts.Node, source: Source): string {
  const children = node.getChildren(source.file);
  return children.length
    ? children.map((child) => expressionText(child, source)).join(' ')
    : leafText(node, source.file);
}

/** Erase types/comments and normalize literals/formatting; never execute source trees. */
export function behaviorHash(source: Source): string {
  let text = source.text;
  for (const node of source.masked.toSorted(
    (a, b) => b.getStart(source.file) - a.getStart(source.file),
  )) {
    text = `${text.slice(0, node.getStart(source.file))}null${text.slice(node.getEnd())}`;
  }
  const javascript = ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  }).outputText;
  const file = ts.createSourceFile(
    'behavior.js',
    javascript,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const canonical = JSON.stringify(syntaxTree(file, file));
  return createHash('sha256').update(canonical).digest('hex');
}

/** Resolve only explicit source module references; dynamic expressions are unsupported. */
export function moduleSpecifier(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
    if (typeOnly || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier))
      return undefined;
    return node.moduleSpecifier.text;
  }
  if (!ts.isCallExpression(node)) return undefined;
  const loadsModule =
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'require');
  if (!loadsModule) return undefined;
  const specifier = node.arguments[0];
  if (!specifier || !ts.isStringLiteral(specifier))
    throw new Error('Unsupported nonliteral runtime module import');
  return specifier.text;
}
