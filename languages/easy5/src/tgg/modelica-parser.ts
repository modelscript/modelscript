// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/easy5 — WASM GLR CST Modelica Block Diagram Parser.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/modelica/parser";
import { collectCstNodes, type CstNodeLike } from "@modelscript/runtime";

export interface ModelicaComponentDecl {
  name: string;
  typeSpecifier: string;
  modifications: Record<string, number | number[] | string>;
  variability?: string | undefined;
}

export interface ModelicaConnection {
  source: string;
  target: string;
}

export interface ParsedModelicaModel {
  name: string;
  components: Map<string, ModelicaComponentDecl>;
  connections: ModelicaConnection[];
}

function getModelicaWasmParser() {
  const modelicaMetaUrl = import.meta.url.replace(/\/(languages|@modelscript)\/easy5\//, "/$1/modelica/");
  return getOrLoadLanguageWasmParser("modelica", modelicaMetaUrl, createWasmParserSync);
}

function getChildren(node: CstNodeLike): readonly CstNodeLike[] {
  return node.namedChildren ?? node.children ?? [];
}

function findDirectChild(node: CstNodeLike, type: string): CstNodeLike | undefined {
  return getChildren(node).find((c) => c.type === type);
}

function collectInScope(root: CstNodeLike, targetType: string, stopAtNestedClass = true): CstNodeLike[] {
  const results: CstNodeLike[] = [];
  const visit = (node: CstNodeLike, isRoot: boolean) => {
    if (!isRoot && stopAtNestedClass && (node.type === "class_definition" || node.type === "ClassDefinition")) {
      return;
    }
    if (node.type === targetType) {
      results.push(node);
    }
    for (const child of getChildren(node)) {
      visit(child, false);
    }
  };
  visit(root, true);
  return results;
}

function splitTopLevelComma(inner: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inQuotes = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === '"' && (i === 0 || inner[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
    }
    if (!inQuotes) {
      if (ch === "{" || ch === "[" || ch === "(") depth++;
      else if (ch === "}" || ch === "]" || ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseScalarOrArrayValue(valRaw: string): number | number[] | string {
  const trimmed = valRaw.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevelComma(inner)
      .map((elem) => Number.parseFloat(elem))
      .filter((n) => !Number.isNaN(n));
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }

  if (trimmed !== "") {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }
  return trimmed;
}

function stripLeadingEquals(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith("=") ? trimmed.slice(1).trim() : trimmed;
}

function extractModificationsFromNode(modNode: CstNodeLike | undefined): Record<string, number | number[] | string> {
  const result: Record<string, number | number[] | string> = {};
  if (!modNode) return result;

  const elemMods = collectCstNodes(modNode, ["element_modification", "ElementModification"]);
  for (const elemMod of elemMods) {
    const keyNode =
      findDirectChild(elemMod, "name") ??
      findDirectChild(elemMod, "Name") ??
      findDirectChild(elemMod, "identifier") ??
      findDirectChild(elemMod, "Identifier");
    const key = keyNode?.text?.trim();
    if (!key) continue;

    const nestedMod = findDirectChild(elemMod, "modification") ?? findDirectChild(elemMod, "Modification");
    if (!nestedMod) continue;

    const modExpr =
      findDirectChild(nestedMod, "modification_expression") ?? findDirectChild(nestedMod, "ModificationExpression");
    const valRaw = modExpr ? stripLeadingEquals(modExpr.text) : stripLeadingEquals(nestedMod.text);
    if (!valRaw) continue;

    result[key] = parseScalarOrArrayValue(valRaw);
  }

  return result;
}

/**
 * Parses a Modelica block-diagram model using the native `@modelscript/modelica` WASM GLR CST.
 */
export function parseModelicaBlocks(sourceText: string): ParsedModelicaModel {
  const parser = getModelicaWasmParser();
  const tree = parser.parse(sourceText);
  if (!tree) {
    return { name: "Easy5Model", components: new Map(), connections: [] };
  }
  const rootNode = (tree.rootNode ?? tree) as unknown as CstNodeLike;

  const components = new Map<string, ModelicaComponentDecl>();
  const connections: ModelicaConnection[] = [];
  let modelName = "Easy5Model";

  const classDef = collectCstNodes(rootNode, ["class_definition", "ClassDefinition"])[0];
  if (classDef) {
    const spec =
      collectCstNodes(classDef, ["long_class_specifier", "LongClassSpecifier"])[0] ??
      collectCstNodes(classDef, ["short_class_specifier", "ShortClassSpecifier"])[0];
    if (spec) {
      const nameNode = findDirectChild(spec, "identifier") ?? findDirectChild(spec, "Identifier");
      if (nameNode?.text?.trim()) {
        modelName = nameNode.text.trim();
      }
    }
  }

  const scopeRoot = classDef ?? rootNode;
  const compClauses = collectInScope(scopeRoot, "component_clause").concat(
    collectInScope(scopeRoot, "ComponentClause"),
  );

  for (const clause of compClauses) {
    const prefixNode = findDirectChild(clause, "type_prefix") ?? findDirectChild(clause, "TypePrefix");
    const rawPrefix = prefixNode?.text?.trim();
    const variability =
      rawPrefix === "parameter" || rawPrefix === "constant" || rawPrefix === "discrete" ? rawPrefix : undefined;

    const typeSpecNode = findDirectChild(clause, "type_specifier") ?? findDirectChild(clause, "TypeSpecifier");
    const typeSpecifier = typeSpecNode?.text?.trim() ?? "";

    const compDecls = collectCstNodes(clause, ["component_declaration", "ComponentDeclaration"]);
    for (const compDecl of compDecls) {
      const declNode = findDirectChild(compDecl, "declaration") ?? findDirectChild(compDecl, "Declaration") ?? compDecl;
      const idNode = findDirectChild(declNode, "identifier") ?? findDirectChild(declNode, "Identifier");
      const compName = idNode?.text?.trim() ?? "";
      if (!compName) continue;

      const modNode =
        findDirectChild(declNode, "modification") ??
        findDirectChild(declNode, "Modification") ??
        findDirectChild(compDecl, "modification") ??
        findDirectChild(compDecl, "Modification");

      components.set(compName, {
        name: compName,
        typeSpecifier,
        modifications: extractModificationsFromNode(modNode),
        variability,
      });
    }
  }

  const connectEqs = collectInScope(scopeRoot, "connect_equation").concat(collectInScope(scopeRoot, "ConnectEquation"));
  for (const connEq of connectEqs) {
    const directRefs = getChildren(connEq).filter(
      (c) => c.type === "component_reference" || c.type === "ComponentReference",
    );
    const refs =
      directRefs.length >= 2 ? directRefs : collectCstNodes(connEq, ["component_reference", "ComponentReference"]);
    if (refs.length >= 2) {
      const source = refs[0]!.text.trim();
      const target = refs[1]!.text.trim();
      if (source && target) {
        connections.push({ source, target });
      }
    }
  }

  return {
    name: modelName,
    components,
    connections,
  };
}
