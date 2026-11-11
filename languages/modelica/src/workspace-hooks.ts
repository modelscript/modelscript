// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntheticSymbolSpec, WorkspaceIndexingHooks } from "@modelscript/dsl";

const WITHIN_NODE_TYPES = new Set(["within_clause", "WithinDirective"]);
const WITHIN_NAME_TYPES = new Set(["name", "name_list", "identifier", "IDENT"]);
const WITHIN_TEXT_RE = /^\s*within(?:\s+([a-zA-Z0-9_.]+))?\s*;/m;

/** Reads the first ~1000 UTF-16 units of the source without materializing the whole file. */
function sourceHead(node: any): string {
  const src = node?.tree?.sourceCode;
  if (typeof src === "string") return src.slice(0, 1000);
  return typeof node?.text === "string" ? node.text.slice(0, 1000) : "";
}

function withinFromClause(clause: any): string {
  const nameChild = clause.children?.find((c: any) => WITHIN_NAME_TYPES.has(c.type));
  if (nameChild && nameChild.text) return nameChild.text.trim();
  const m = (clause.text || "").match(WITHIN_TEXT_RE);
  return m ? m[1]?.trim() || "" : "";
}

/**
 * Extracts the enclosing package FQN declared by a top-level `within <package>;` clause,
 * returning `""` for a root `within;` and `null` when no `within` clause is present.
 */
function extractWithin(rootNode: any): string | null {
  if (!rootNode) return null;
  if (WITHIN_NODE_TYPES.has(rootNode.type)) return withinFromClause(rootNode);
  for (const child of rootNode.children || []) {
    if (WITHIN_NODE_TYPES.has(child.type)) return withinFromClause(child);
    if (child.type === "stored_definition" || child.type === "program") {
      const res = extractWithin(child);
      if (res !== null) return res;
    }
  }
  const m = sourceHead(rootNode).match(/^\s*within\s*([a-zA-Z0-9_.]*)\s*;/m);
  return m ? m[1]?.trim() || "" : null;
}

/** Implicit `Extends` symbol for the `class extends <Name>` form of a long class specifier. */
function synthesizeClassExtends(node: any, hasEnclosingSymbol: boolean): SyntheticSymbolSpec[] | undefined {
  if (!hasEnclosingSymbol) return undefined;
  if (node.type !== "long_class_specifier" && node.type !== "LongClassSpecifier") return undefined;
  const children = node.children || [];
  const firstChild = children[0];
  const isExtends =
    firstChild && (firstChild.text === "extends" || firstChild.type === '"extends"' || firstChild.type === "extends");
  if (!isExtends) return undefined;

  const identChild = children.find((c: any) => c.type === "identifier" || c.type === "IDENT");
  const extName = identChild?.text ? identChild.text.trim() : "";
  if (!extName) return undefined;

  const modChild = children.find((c: any) => c.type === "class_modification" || c.type === "ClassModification");
  const endOf = (n: any): number => n.endOffset ?? n.endIndex ?? 0;
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
