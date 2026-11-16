// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/c/parser";
import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { collectCstNodes, extractCstLeafNodes, type CstNodeLike } from "@modelscript/runtime";

function getCWasmParser() {
  return getOrLoadLanguageWasmParser("c", import.meta.url, createWasmParserSync);
}

export interface CFunctionParam {
  name: string;
  type: string;
  isPointer: boolean;
  isConst: boolean;
}

export interface CFunctionPrototype {
  returnType: string;
  name: string;
  params: CFunctionParam[];
  rawSignature: string;
}

export interface CStructField {
  name: string;
  type: string;
  isPointer: boolean;
}

export interface CStructDefinition {
  name: string;
  fields: CStructField[];
}

export interface ScrapedCHeader {
  functions: CFunctionPrototype[];
  structs: CStructDefinition[];
  typedefs: Map<string, string>;
}

const C_CONTROL_NAMES = new Set(["if", "while", "for", "switch", "return", "typedef"]);
const C_QUALIFIERS = new Set(["const", "volatile", "restrict"]);

function getChildByType(node: CstNodeLike, type: string): CstNodeLike | undefined {
  const children = node.namedChildren ?? node.children ?? [];
  return children.find((c) => c.type === type);
}

function getAllChildren(node: CstNodeLike): readonly CstNodeLike[] {
  return node.children ?? node.namedChildren ?? [];
}

function findDirectIdentifier(node: CstNodeLike): string | undefined {
  const leaf = getAllChildren(node).find((c) => c.type === "IDENTIFIER");
  return leaf?.text?.trim() || undefined;
}

function stripPreprocessorDirectives(source: string): string {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trimStart().startsWith("#")) {
      lines[i] = "";
    }
  }
  return lines.join("\n");
}

function extractDeclaratorIdentifier(declarator: CstNodeLike): string | undefined {
  const target = collectCstNodes(declarator, ["VariableDeclarator", "ArrayDeclarator"])[0];
  if (target) {
    return extractCstLeafNodes(target)
      .find((t) => t.type === "IDENTIFIER")
      ?.text?.trim();
  }
  const leaves = extractCstLeafNodes(declarator);
  for (let i = leaves.length - 1; i >= 0; i--) {
    if (leaves[i]!.type === "IDENTIFIER") return leaves[i]!.text?.trim();
  }
  return undefined;
}

function parseParameterNode(paramNode: CstNodeLike, idx: number): CFunctionParam | null {
  const leaves = extractCstLeafNodes(paramNode)
    .map((l) => l.text?.trim() ?? "")
    .filter(Boolean);
  if (leaves.length === 0 || (leaves.length === 1 && leaves[0] === "void")) {
    return null;
  }

  let isConst = false;
  let isPointer = false;
  for (const tok of leaves) {
    if (tok === "const") isConst = true;
    if (tok === "*") isPointer = true;
  }

  const declaratorNode = getChildByType(paramNode, "Declarator");
  const declName = declaratorNode ? extractDeclaratorIdentifier(declaratorNode) : undefined;
  const paramName = declName || `u${idx + 1}`;

  const typeTokens: string[] = [];
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!;
    if (declName && i === leaves.length - 1 && tok === declName) continue;
    if (tok === "*" || C_QUALIFIERS.has(tok)) continue;
    typeTokens.push(tok);
  }

  return {
    name: paramName,
    type: typeTokens.length > 0 ? typeTokens.join(" ") : "double",
    isPointer,
    isConst,
  };
}

function extractStructFromSpecifier(specNode: CstNodeLike, fallbackName?: string): CStructDefinition | null {
  const bodyNode = getChildByType(specNode, "StructDeclarationList");
  if (!bodyNode) return null;

  const structName = findDirectIdentifier(specNode) ?? fallbackName ?? "";
  if (!structName) return null;

  const fields: CStructField[] = [];
  for (const fieldDecl of collectCstNodes(bodyNode, ["StructFieldDeclaration"])) {
    const typeSpecNode = getChildByType(fieldDecl, "TypeSpecifier");
    const typeTokens = typeSpecNode
      ? extractCstLeafNodes(typeSpecNode)
          .map((l) => l.text?.trim() ?? "")
          .filter((t) => Boolean(t) && t !== "*")
      : [];
    const baseType = typeTokens.join(" ");

    const declListNode = getChildByType(fieldDecl, "StructDeclaratorList");
    const declarators = declListNode ? collectCstNodes(declListNode, ["Declarator"]) : [];
    for (const decl of declarators) {
      const declLeaves = extractCstLeafNodes(decl);
      const isPointer = declLeaves.some((l) => l.text === "*");
      const fieldName = extractDeclaratorIdentifier(decl);
      if (fieldName && baseType) {
        fields.push({ name: fieldName, type: baseType, isPointer });
      }
    }
  }

  return { name: structName, fields };
}

export function scrapeCHeader(headerText: string): ScrapedCHeader {
  const functions: CFunctionPrototype[] = [];
  const structs: CStructDefinition[] = [];
  const typedefs = new Map<string, string>();
  const seenStructNames = new Set<string>();

  const preprocessed = stripPreprocessorDirectives(headerText);
  const tree = getCWasmParser().parse(preprocessed);
  const root = tree?.rootNode;
  if (!root) {
    return { functions, structs, typedefs };
  }

  for (const decl of collectCstNodes(root, ["Declaration"])) {
    const storageNode = getChildByType(decl, "StorageClassSpecifier");
    const storageKind = storageNode?.text?.trim() ?? "";
    const typeSpecNode = getChildByType(decl, "TypeSpecifier");
    const initListNode = getChildByType(decl, "InitDeclaratorList");

    const declarators = initListNode ? collectCstNodes(initListNode, ["InitDeclarator"]) : [];
    const firstDecl = declarators[0] ? getChildByType(declarators[0]!, "Declarator") : undefined;

    // 1. Struct definitions (standalone or inside typedef struct Foo { ... } Alias;)
    if (typeSpecNode) {
      const structSpec = collectCstNodes(typeSpecNode, ["StructSpecifier"])[0];
      if (structSpec) {
        const fallbackAlias =
          storageKind === "typedef" && firstDecl ? extractDeclaratorIdentifier(firstDecl) : undefined;
        const parsedStruct = extractStructFromSpecifier(structSpec, fallbackAlias);
        if (parsedStruct && !seenStructNames.has(parsedStruct.name)) {
          seenStructNames.add(parsedStruct.name);
          structs.push(parsedStruct);
        }
      }
    }

    // 2. Typedefs: typedef OldType NewType;
    if (storageKind === "typedef" && typeSpecNode) {
      const baseType = extractCstLeafNodes(typeSpecNode)
        .map((l) => l.text?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      for (const initDecl of declarators) {
        const innerDecl = getChildByType(initDecl, "Declarator");
        if (!innerDecl) continue;
        const starPrefix = extractCstLeafNodes(innerDecl)
          .filter((l) => l.text === "*")
          .map(() => "*")
          .join("");
        const aliasName = extractDeclaratorIdentifier(innerDecl);
        if (aliasName && baseType) {
          typedefs.set(aliasName, starPrefix ? `${baseType} ${starPrefix}` : baseType);
        }
      }
      continue;
    }

    // 3. Function prototypes: ReturnType FuncName(ParamType p1, ...);
    if (!typeSpecNode) continue;
    const baseReturnTokens = extractCstLeafNodes(typeSpecNode)
      .map((l) => l.text?.trim() ?? "")
      .filter(Boolean);

    for (const initDecl of declarators) {
      const innerDecl = getChildByType(initDecl, "Declarator");
      if (!innerDecl) continue;
      const fnDecl = getChildByType(innerDecl, "FunctionDeclarator");
      if (!fnDecl) continue;

      const fnName = findDirectIdentifier(fnDecl);
      if (!fnName || C_CONTROL_NAMES.has(fnName)) continue;

      let starCount = 0;
      for (const child of getAllChildren(innerDecl)) {
        if (child.text === "*") starCount++;
      }
      const returnType = baseReturnTokens.join(" ") + (starCount > 0 ? "*".repeat(starCount) : "");

      const paramListNode = getChildByType(fnDecl, "ParameterList");
      const params: CFunctionParam[] = [];
      if (paramListNode) {
        const paramNodes = collectCstNodes(paramListNode, ["ParameterDeclaration"]);
        for (let idx = 0; idx < paramNodes.length; idx++) {
          const parsedParam = parseParameterNode(paramNodes[idx]!, idx);
          if (parsedParam) params.push(parsedParam);
        }
      }

      functions.push({
        returnType,
        name: fnName,
        params,
        rawSignature: (decl.text ?? "").trim(),
      });
    }
  }

  return {
    functions,
    structs,
    typedefs,
  };
}
