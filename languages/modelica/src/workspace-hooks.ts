// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntheticSymbolSpec, WorkspaceIndexingHooks } from "@modelscript/dsl";
import { UnifiedWorkspace } from "@modelscript/runtime";

const WITHIN_NODE_TYPES = new Set(["within_clause", "WithinDirective"]);
const WITHIN_NAME_TYPES = new Set(["name", "name_list", "identifier", "IDENT"]);
const CLASS_KIND_KEYWORDS = new Set([
  "class",
  "model",
  "record",
  "block",
  "connector",
  "type",
  "package",
  "function",
  "operator",
]);

function isWsCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
}

function isIdentContinueCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
}

/** Skips ASCII whitespace and Modelica `//` / `/* *\/` comments starting at `startIndex`. */
function skipLeadingWsAndComments(source: string, startIndex = 0): number {
  let i = startIndex;
  const n = source.length;
  while (i < n) {
    if (isWsCode(source.charCodeAt(i))) {
      i++;
      continue;
    }
    if (source.charCodeAt(i) === 47 /* '/' */ && i + 1 < n) {
      const next = source.charCodeAt(i + 1);
      if (next === 47 /* '//' */) {
        i += 2;
        while (i < n && source.charCodeAt(i) !== 10 && source.charCodeAt(i) !== 13) i++;
        continue;
      }
      if (next === 42 /* '/*' */) {
        i += 2;
        while (i + 1 < n && !(source.charCodeAt(i) === 42 && source.charCodeAt(i + 1) === 47)) i++;
        i = Math.min(n, i + 2);
        continue;
      }
    }
    break;
  }
  return i;
}

/**
 * Normalizes whitespace Runs into single ASCII spaces without regexes.
 */
export function collapseSpaceTokens(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
    const start = i;
    while (i < text.length && !isWsCode(text.charCodeAt(i))) i++;
    if (i > start) tokens.push(text.slice(start, i));
  }
  return tokens;
}

interface WorkspaceCstNode {
  type?: string;
  text?: string;
  startOffset?: number;
  endOffset?: number;
  startIndex?: number;
  endIndex?: number;
  children?: WorkspaceCstNode[];
  tree?: { sourceCode?: string };
  childForFieldName?: (name: string) => WorkspaceCstNode | null;
}

/** Reads the first ~1000 UTF-16 units of the source without materializing the whole file. */
function sourceHead(node: WorkspaceCstNode | null | undefined): string {
  const src = node?.tree?.sourceCode;
  if (typeof src === "string") return src.slice(0, 1000);
  return typeof node?.text === "string" ? node.text.slice(0, 1000) : "";
}

function findWithinNameDescendant(node: WorkspaceCstNode | null | undefined, depth = 0): WorkspaceCstNode | null {
  if (!node || depth > 3) return null;
  for (const c of node.children || []) {
    if (c.type && WITHIN_NAME_TYPES.has(c.type) && c.text) return c;
    const nested = findWithinNameDescendant(c, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function withinFromClause(clause: WorkspaceCstNode): string {
  const nameChild =
    clause.children?.find((c) => Boolean(c.type && WITHIN_NAME_TYPES.has(c.type))) ?? findWithinNameDescendant(clause);
  if (nameChild && nameChild.text) return nameChild.text.trim();
  return "";
}

export function extractWithinFromCstNode(rootNode: WorkspaceCstNode | null | undefined): string | null {
  if (!rootNode) return null;
  if (rootNode.type && WITHIN_NODE_TYPES.has(rootNode.type)) return withinFromClause(rootNode);
  for (const child of rootNode.children || []) {
    if (child.type && WITHIN_NODE_TYPES.has(child.type)) return withinFromClause(child);
    if (child.type === "stored_definition" || child.type === "program" || child.type === "ERROR") {
      const res = extractWithinFromCstNode(child);
      if (res !== null) return res;
    }
  }
  return null;
}

/**
 * Extracts a leading `within <package>;` clause from Modelica source text using the WASM GLR parser
 * on only the leading `within ...;` header snippet.
 */
export function extractWithinFromSource(
  source: string,
  parser?: { parse: (src: string) => { rootNode?: WorkspaceCstNode | null } | null } | null,
): string | null {
  if (!source) return null;
  const start = skipLeadingWsAndComments(source, 0);
  if (!source.startsWith("within", start)) return null;
  const afterKw = start + 6;
  if (afterKw < source.length && isIdentContinueCode(source.charCodeAt(afterKw))) return null;

  let i = afterKw;
  const limit = Math.min(source.length, start + 1000);
  let inQuotedIdent = false;
  while (i < limit) {
    const ch = source.charCodeAt(i);
    if (inQuotedIdent) {
      if (ch === 92 /* '\\' */) {
        i += 2;
        continue;
      }
      if (ch === 39 /* '\'' */) inQuotedIdent = false;
      i++;
      continue;
    }
    if (ch === 39 /* '\'' */) {
      inQuotedIdent = true;
      i++;
      continue;
    }
    if (ch === 47 /* '/' */ && i + 1 < limit) {
      const next = source.charCodeAt(i + 1);
      if (next === 47) {
        i += 2;
        while (i < limit && source.charCodeAt(i) !== 10 && source.charCodeAt(i) !== 13) i++;
        continue;
      }
      if (next === 42) {
        i += 2;
        while (i + 1 < limit && !(source.charCodeAt(i) === 42 && source.charCodeAt(i + 1) === 47)) i++;
        i = Math.min(limit, i + 2);
        continue;
      }
    }
    if (ch === 59 /* ';' */) {
      const activeParser =
        parser ??
        (UnifiedWorkspace.getGlobalParser(".mo") as
          { parse: (src: string) => { rootNode?: WorkspaceCstNode | null } | null } | undefined);
      if (activeParser && typeof activeParser.parse === "function") {
        const tree = activeParser.parse(source.slice(start, i + 1));
        if (tree?.rootNode) {
          return extractWithinFromCstNode(tree.rootNode);
        }
      }
      return null;
    }
    i++;
  }
  return null;
}

/**
 * Extracts the first matching Modelica class definition `{ kind, name }` from a parsed CST node.
 */
export function extractFirstClassFromCstNode(
  rootNode: WorkspaceCstNode | null | undefined,
  allowedKinds?: Set<string>,
): { kind: string; name: string } | null {
  if (!rootNode) return null;
  const stack: WorkspaceCstNode[] = [rootNode];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "class_definition" || cur.type === "ClassDefinition") {
      let kind = "class";
      const prefixesNode = (cur.children || []).find((c) => c.type === "class_prefixes" || c.type === "ClassPrefixes");
      if (prefixesNode?.text) {
        const words = collapseSpaceTokens(prefixesNode.text);
        for (let idx = words.length - 1; idx >= 0; idx--) {
          if (CLASS_KIND_KEYWORDS.has(words[idx]!)) {
            kind = words[idx]!;
            break;
          }
        }
      }
      if (!allowedKinds || allowedKinds.has(kind)) {
        const specContainer = (cur.children || []).find(
          (c) => c.type === "class_specifier" || c.type === "ClassSpecifier",
        );
        const specNode =
          (specContainer?.children || []).find(
            (c) =>
              c.type === "long_class_specifier" ||
              c.type === "short_class_specifier" ||
              c.type === "der_class_specifier" ||
              c.type === "LongClassSpecifier" ||
              c.type === "ShortClassSpecifier",
          ) ??
          specContainer ??
          cur;
        const nameNode =
          specNode?.childForFieldName?.("name") ??
          (specNode?.children || []).find((c) => c.type === "identifier" || c.type === "IDENT");
        const name = nameNode?.text?.trim() ?? "";
        if (name) return { kind, name };
      }
    }
    const children = cur.children || [];
    for (let idx = children.length - 1; idx >= 0; idx--) {
      if (children[idx]) stack.push(children[idx]!);
    }
  }
  return null;
}

/**
 * Extracts the enclosing package FQN declared by a top-level `within <package>;` clause,
 * returning `""` for a root `within;` and `null` when no `within` clause is present.
 */
function extractWithin(rootNode: WorkspaceCstNode | null | undefined): string | null {
  const fromCst = extractWithinFromCstNode(rootNode);
  if (fromCst !== null) return fromCst;
  const head = sourceHead(rootNode);
  return head ? extractWithinFromSource(head) : null;
}

/** Implicit `Extends` symbol for the `class extends <Name>` form of a long class specifier. */
function synthesizeClassExtends(
  node: WorkspaceCstNode,
  hasEnclosingSymbol: boolean,
): SyntheticSymbolSpec[] | undefined {
  if (!hasEnclosingSymbol) return undefined;
  if (node.type !== "long_class_specifier" && node.type !== "LongClassSpecifier") return undefined;
  const children = node.children || [];
  const firstChild = children[0];
  const isExtends =
    firstChild && (firstChild.text === "extends" || firstChild.type === '"extends"' || firstChild.type === "extends");
  if (!isExtends) return undefined;

  const identChild = children.find((c: WorkspaceCstNode) => c.type === "identifier" || c.type === "IDENT");
  const extName = identChild?.text ? identChild.text.trim() : "";
  if (!extName) return undefined;

  const modChild = children.find(
    (c: WorkspaceCstNode) => c.type === "class_modification" || c.type === "ClassModification",
  );
  const endOf = (n: WorkspaceCstNode | undefined): number => n?.endOffset ?? n?.endIndex ?? 0;
  return [
    {
      kind: "Extends",
      name: extName,
      ruleName: "extends_clause",
      namePath: "name",
      startOffset: firstChild.startOffset ?? firstChild.startIndex ?? node.startOffset ?? node.startIndex ?? 0,
      endOffset: modChild ? endOf(modChild) : endOf(identChild),
      metadata: { typeSpecifier: extName },
    },
  ];
}

/**
 * Workspace indexing conventions for Modelica: `package.mo` directory packages, `within` scopes,
 * the `Icons.mo` library layout, `class extends`, and the CST rules that never hold declarations.
 */
export const modelicaWorkspaceHooks: WorkspaceIndexingHooks = {
  isPackageEntryFile: (basename) => basename === "package",
  extractDeclaredScope: extractWithin,
  keepsDirectoryScopeAtRoot: (uri) => uri.endsWith("package.mo"),
  fallbackUriForFQN: (fqn, pendingUris) => {
    if (fqn !== "Modelica.Icons" && !fqn.endsWith(".Icons") && fqn !== "Icons") return undefined;
    for (const uri of pendingUris) {
      if (uri.endsWith("Icons.mo")) return uri;
    }
    return undefined;
  },
  adoptsPendingChild: (parentFQN, entryParentFQN, uri) =>
    parentFQN === "Modelica" && !entryParentFQN && uri.endsWith("Icons.mo"),
  skipNodeTypes: new Set([
    "expression",
    "array_arguments",
    "expression_list",
    "algorithm_section",
    "comment",
    "annotation",
  ]),
  synthesizeSymbols: synthesizeClassExtends,
  isCorruptedStub: (entry) =>
    (entry.kind === "Component" && entry.name === "component_declaration") ||
    (entry.kind === "Class" && entry.name === "class_definition"),
};
