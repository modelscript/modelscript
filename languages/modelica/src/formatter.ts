// SPDX-License-Identifier: AGPL-3.0-or-later

function isWsCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12;
}

function skipWs(text: string, idx: number): number {
  let i = idx;
  while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
  return i;
}

function stripLeadingSectionWords(
  text: string,
  keyword: "equation" | "algorithm",
): { isInitial: boolean; body: string } {
  let pos = skipWs(text, 0);
  let isInitial = false;
  if (text.slice(pos, pos + 7).toLowerCase() === "initial" && isWsCode(text.charCodeAt(pos + 7))) {
    const afterInit = skipWs(text, pos + 7);
    if (text.slice(afterInit, afterInit + keyword.length).toLowerCase() === keyword) {
      isInitial = true;
      pos = afterInit + keyword.length;
      return { isInitial, body: text.slice(pos).trim() };
    }
  }
  if (text.slice(pos, pos + keyword.length).toLowerCase() === keyword) {
    pos += keyword.length;
  }
  return { isInitial, body: text.slice(pos).trim() };
}

const INDENT_TRIGGER_NODES = new Set([
  "ClassDefinition",
  "class_definition",
  "IfStatement",
  "if_statement",
  "ForStatement",
  "for_statement",
  "WhileStatement",
  "while_statement",
  "WhenStatement",
  "when_statement",
  "IfEquation",
  "if_equation",
  "ForEquation",
  "for_equation",
  "WhenEquation",
  "when_equation",
  "enumeration_literal",
]);

const DEDENT_START_TOKENS = new Set([
  "model",
  "class",
  "record",
  "block",
  "connector",
  "type",
  "package",
  "function",
  "encapsulated",
  "partial",
  "final",
  "pure",
  "impure",
  "operator",
  "expandable",
]);

export interface FormatterAstNode {
  type: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(i: number): FormatterAstNode | null;
  parent: FormatterAstNode | null;
  text?: string | undefined;
  descendantForPosition?(pos: { row: number; column: number }): FormatterAstNode | null;
}

export interface FormatterTree {
  rootNode?: FormatterAstNode | null | undefined;
}

export interface ModelicaFormatOptions {
  indentSize?: number | undefined;
  parser?: { parse: (source: string) => FormatterTree | null | undefined } | undefined;
  structural?: boolean | undefined;
  oneOfEachSection?: boolean | undefined;
  importsFirst?: boolean | undefined;
  extendsAtTop?: boolean | undefined;
  componentsBeforeClasses?: boolean | undefined;
  declarationOrder?: boolean | undefined;
  preserveFormatting?: boolean | undefined;
}

export function restructureModelicaTree(tree: FormatterTree | null | undefined, source: string): string {
  if (!tree || !tree.rootNode) return source;

  function findNodes(node: unknown, type: string, acc: FormatterAstNode[] = []): FormatterAstNode[] {
    const n = node as FormatterAstNode | null | undefined;
    if (n && n.type === type) acc.push(n);
    if (n && typeof n.childCount === "number" && typeof n.child === "function") {
      for (let i = 0; i < n.childCount; i++) {
        findNodes(n.child(i), type, acc);
      }
    }
    return acc;
  }

  const compositions = findNodes(tree.rootNode, "composition");
  if (compositions.length === 0) return source;

  let result = source;
  compositions.sort((a, b) => b.startIndex - a.startIndex);

  for (const comp of compositions) {
    const parentClass = comp.parent;
    const classText = parentClass && parentClass.text ? parentClass.text : "";
    if (classText.includes("__ModelScript(format=false)") || classText.includes("__MLQT(format=false)")) {
      continue;
    }

    const imports: string[] = [];
    const extendsClauses: string[] = [];
    const parameters: string[] = [];
    const constants: string[] = [];
    const inputsOutputs: string[] = [];
    const variables: string[] = [];
    const components: string[] = [];
    const nestedClasses: string[] = [];
    const protectedElements: string[] = [];
    const initialEquations: string[] = [];
    const equations: string[] = [];
    const initialAlgorithms: string[] = [];
    const algorithms: string[] = [];
    const annotations: string[] = [];

    let isProtected = false;

    for (let i = 0; i < comp.childCount; i++) {
      const child = comp.child(i);
      if (!child) continue;
      const childType = child.type;
      const childText = source.slice(child.startIndex, child.endIndex).trim();

      if (childType === "protected" || childText === "protected") {
        isProtected = true;
        continue;
      }
      if (childType === "public" || childText === "public") {
        isProtected = false;
        continue;
      }
      if (childType === ";") continue;

      if (childType === "equation_section") {
        const innerText = stripLeadingSectionWords(childText, "equation");
        if (innerText.body.length > 0) {
          if (innerText.isInitial) initialEquations.push(innerText.body);
          else equations.push(innerText.body);
        }
        continue;
      }

      if (childType === "algorithm_section") {
        const innerText = stripLeadingSectionWords(childText, "algorithm");
        if (innerText.body.length > 0) {
          if (innerText.isInitial) initialAlgorithms.push(innerText.body);
          else algorithms.push(innerText.body);
        }
        continue;
      }

      if (childType === "element") {
        const elemChild = child.child(0);
        const elemType = elemChild ? elemChild.type : "";

        if (elemType === "import_clause") {
          imports.push(childText);
          continue;
        }
        if (elemType === "extends_clause") {
          extendsClauses.push(childText);
          continue;
        }
        if (elemType === "class_definition") {
          if (isProtected) protectedElements.push(childText);
          else nestedClasses.push(childText);
          continue;
        }
        if (elemType === "component_clause") {
          const typePrefixNode = elemChild ? elemChild.child(0) : null;
          const pfxText = typePrefixNode && typePrefixNode.type === "type_prefix" ? (typePrefixNode.text ?? "") : "";
          const targetBin = isProtected
            ? protectedElements
            : pfxText.includes("input") || pfxText.includes("output")
              ? inputsOutputs
              : pfxText.includes("constant")
                ? constants
                : pfxText.includes("parameter")
                  ? parameters
                  : variables;

          targetBin.push(childText);
          continue;
        }
      }

      if (childType === "annotation") {
        annotations.push(childText);
        continue;
      }
    }

    const lines: string[] = [];
    if (imports.length > 0) lines.push(...imports.map((s) => (s.endsWith(";") ? s : s + ";")));
    if (extendsClauses.length > 0) lines.push(...extendsClauses.map((s) => (s.endsWith(";") ? s : s + ";")));
    if (inputsOutputs.length > 0) lines.push(...inputsOutputs.map((s) => (s.endsWith(";") ? s : s + ";")));
    if (constants.length > 0) lines.push(...constants.map((s) => (s.endsWith(";") ? s : s + ";")));
    if (parameters.length > 0) lines.push(...parameters.map((s) => (s.endsWith(";") ? s : s + ";")));
    if (variables.length > 0) lines.push(...variables.map((s) => (s.endsWith(";") ? s : s + ";")));
    if (components.length > 0) lines.push(...components.map((s) => (s.endsWith(";") ? s : s + ";")));
    if (nestedClasses.length > 0) lines.push(...nestedClasses);

    if (protectedElements.length > 0) {
      lines.push("protected");
      lines.push(...protectedElements.map((s) => (s.endsWith(";") ? s : s + ";")));
    }
    if (initialEquations.length > 0) {
      lines.push("initial equation");
      lines.push(...initialEquations);
    }
    if (equations.length > 0) {
      lines.push("equation");
      lines.push(...equations);
    }
    if (initialAlgorithms.length > 0) {
      lines.push("initial algorithm");
      lines.push(...initialAlgorithms);
    }
    if (algorithms.length > 0) {
      lines.push("algorithm");
      lines.push(...algorithms);
    }
    if (annotations.length > 0) {
      lines.push(...annotations);
    }

    const rawPrefix = result.slice(0, comp.startIndex);
    const prefix =
      rawPrefix.length > 0 && isWsCode(rawPrefix.charCodeAt(rawPrefix.length - 1))
        ? rawPrefix.trimEnd() + "\n  "
        : rawPrefix;
    const rawSuffix = result.slice(comp.endIndex);
    const suffix = rawSuffix.length > 0 && isWsCode(rawSuffix.charCodeAt(0)) ? "\n" + rawSuffix.trimStart() : rawSuffix;
    result = prefix + lines.join("\n  ") + suffix;
  }

  return result;
}

export function formatModelicaTree(
  tree: FormatterTree | null | undefined,
  content: string,
  optionsOrIndentSize: number | ModelicaFormatOptions = 2,
): string {
  const options: ModelicaFormatOptions =
    typeof optionsOrIndentSize === "number" ? { indentSize: optionsOrIndentSize } : optionsOrIndentSize;
  const indentSize = options.indentSize ?? 2;

  if (
    options.preserveFormatting ||
    content.includes("__ModelScript(format=false)") ||
    content.includes("__MLQT(format=false)")
  ) {
    return content;
  }

  let currentContent = content;
  let currentTree = tree;

  if (
    options.structural ||
    options.oneOfEachSection ||
    options.importsFirst ||
    options.extendsAtTop ||
    options.componentsBeforeClasses ||
    options.declarationOrder
  ) {
    currentContent = restructureModelicaTree(tree, content);
    if (options.parser && typeof options.parser.parse === "function") {
      try {
        currentTree = options.parser.parse(currentContent);
      } catch {
        // Fallback to original tree
      }
    }
  }

  const indentString = " ".repeat(Math.max(1, indentSize));
  const lines = currentContent.split("\n");
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0) {
      formattedLines.push("");
      continue;
    }

    let firstCharColumn = 0;
    while (firstCharColumn < line.length && isWsCode(line.charCodeAt(firstCharColumn))) {
      firstCharColumn++;
    }
    if (firstCharColumn >= line.length) firstCharColumn = -1;

    const node = currentTree?.rootNode?.descendantForPosition?.({ row: i, column: firstCharColumn });
    if (!node) {
      formattedLines.push(line);
      continue;
    }

    let isExcluded = false;
    let curr: FormatterAstNode | null = node;
    while (curr) {
      if (curr.type === "class_definition" || curr.type === "ClassDefinition") {
        const txt = curr.text ?? "";
        if (txt.includes("__ModelScript(format=false)") || txt.includes("__MLQT(format=false)")) {
          isExcluded = true;
          break;
        }
      }
      curr = curr.parent;
    }
    if (isExcluded) {
      formattedLines.push(line);
      continue;
    }

    let indentLevel = 0;
    let current = node.parent;
    while (current) {
      if (INDENT_TRIGGER_NODES.has(current.type)) {
        indentLevel++;
      }
      current = current.parent;
    }

    const firstToken = trimmedLine.split(" ")[0];
    if (firstToken && DEDENT_START_TOKENS.has(firstToken)) {
      indentLevel--;
    }
    if (trimmedLine.startsWith("end") || trimmedLine.startsWith("else") || trimmedLine.startsWith("elseif")) {
      indentLevel = Math.max(0, indentLevel - 1);
    }
    if (
      trimmedLine.startsWith("equation") ||
      trimmedLine.startsWith("algorithm") ||
      trimmedLine.startsWith("public") ||
      trimmedLine.startsWith("protected") ||
      trimmedLine.startsWith("initial equation") ||
      trimmedLine.startsWith("initial algorithm")
    ) {
      indentLevel--;
    }

    const indent = indentString.repeat(Math.max(0, indentLevel));
    formattedLines.push(indent + trimmedLine);
  }

  return formattedLines.join("\n");
}
