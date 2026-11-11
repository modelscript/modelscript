// SPDX-License-Identifier: AGPL-3.0-or-later

import { Connection, TextDocuments, TextEdit } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

// Nodes that increase indentation for their children/content (supporting both PascalCase and snake_case AST nodes)
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

// Tokens that start a block but should be dedented to align with the container's start
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

export interface ModelicaFormatOptions {
  indentSize?: number;
  parser?: any;
  structural?: boolean;
  oneOfEachSection?: boolean;
  importsFirst?: boolean;
  extendsAtTop?: boolean;
  componentsBeforeClasses?: boolean;
  declarationOrder?: boolean;
  preserveFormatting?: boolean;
}

/**
 * Performs AST-driven structural reorganization of a Modelica class:
 * - Consolidates multiple public, protected, equation, or algorithm sections into one
 * - Enforces composition ordering: imports first, extends at top
 * - Enforces declaration ordering: inputs/outputs -> constants -> parameters -> variables -> components -> nested classes
 * - Preserves classes marked with __ModelScript(format=false) or __MLQT(format=false)
 */
interface FormatterAstNode {
  type: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(i: number): FormatterAstNode | null;
  parent: FormatterAstNode | null;
  text?: string;
}

export function restructureModelicaTree(tree: { rootNode?: unknown }, source: string): string {
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
        const isInitial = childText.startsWith("initial equation");
        const innerText = childText
          .replace(/^initial\s+equation\s*/i, "")
          .replace(/^equation\s*/i, "")
          .trim();
        if (innerText.length > 0) {
          if (isInitial) initialEquations.push(innerText);
          else equations.push(innerText);
        }
        continue;
      }

      if (childType === "algorithm_section") {
        const isInitial = childText.startsWith("initial algorithm");
        const innerText = childText
          .replace(/^initial\s+algorithm\s*/i, "")
          .replace(/^algorithm\s*/i, "")
          .trim();
        if (innerText.length > 0) {
          if (isInitial) initialAlgorithms.push(innerText);
          else algorithms.push(innerText);
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

    const prefix = result.slice(0, comp.startIndex).replace(/[ \t\r\n]+$/, "\n  ");
    const suffix = result.slice(comp.endIndex).replace(/^[ \t\r\n]+/, "\n");
    result = prefix + lines.join("\n  ") + suffix;
  }

  return result;
}

export function formatModelicaTree(
  tree: any,
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

    // Find the first non-whitespace character's column
    const firstCharColumn = line.search(/\S/);

    // Get the node at the start of the line
    const node = currentTree?.rootNode?.descendantForPosition({ row: i, column: firstCharColumn });
    if (!node) {
      formattedLines.push(line);
      continue;
    }

    // Check if node belongs to a class marked with format=false
    let isExcluded = false;
    let curr = node;
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

    // Calculate indentation level
    let indentLevel = 0;
    let current = node.parent;

    while (current) {
      if (INDENT_TRIGGER_NODES.has(current.type)) {
        indentLevel++;
      }
      current = current.parent;
    }

    // Adjust for dedent triggers (e.g., 'end', 'else', 'equation' keywords)
    const firstToken = trimmedLine.split(" ")[0];

    // Dedent start of blocks (model, class, etc)
    if (firstToken && DEDENT_START_TOKENS.has(firstToken)) {
      indentLevel--;
    }

    // Dedent end of blocks and control structures (else, end, etc)
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

export function formatStepDocument(document: {
  getText: () => string;
  lineCount: number;
  offsetAt: (pos: any) => number;
}): TextEdit[] {
  const text = document.getText();

  // Normalize line endings
  let normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split multiple entities on the same line onto separate lines.
  // Pattern: "; #" → ";\n#" (entity terminator followed by next entity)
  normalized = normalized.replace(/;\s*(?=#\d)/g, ";\n");

  // Section keywords onto their own lines
  normalized = normalized.replace(
    /(ISO-10303-21;|HEADER;|ENDSEC;|END-ISO-10303-21;|DATA(?:\s*\([^)]*\))?\s*;)/g,
    (match) => "\n" + match.trim() + "\n",
  );

  // Normalize whitespace inside entity records:
  //   #1=FOO( 'a' , 'b' ) → #1=FOO('a','b')
  const resultLines: string[] = [];
  for (const line of normalized.split("\n")) {
    let trimmed = line.trim();

    // Skip empty lines in sequence (keep at most one blank line)
    if (!trimmed) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] === "") {
        continue;
      }
      resultLines.push("");
      continue;
    }

    // For entity lines (#N=...), normalize internal spacing
    if (/^#\d+=/.test(trimmed)) {
      // Normalize spaces around commas: " , " → ","
      trimmed = trimmed.replace(/\s*,\s*/g, ",");
      // Normalize spaces after opening parens: "( " → "("
      trimmed = trimmed.replace(/\(\s+/g, "(");
      // Normalize spaces before closing parens: " )" → ")"
      trimmed = trimmed.replace(/\s+\)/g, ")");
      // Normalize space around "=": "# 1 = " → "#1="
      trimmed = trimmed.replace(/\s*=\s*/g, "=");
    }

    resultLines.push(trimmed);
  }

  // Trim leading/trailing blank lines
  while (resultLines.length > 0 && resultLines[0] === "") resultLines.shift();
  while (resultLines.length > 0 && resultLines[resultLines.length - 1] === "") resultLines.pop();

  const result = resultLines.join("\n") + "\n";

  const lastLine = document.lineCount - 1;
  const lastChar = document.getText().length - document.offsetAt({ line: lastLine, character: 0 });

  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: lastLine, character: lastChar },
      },
      newText: result,
    },
  ];
}

export function registerFormattingProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  getDocumentTree: (uri: string) => any,
  isParserReady: () => boolean,
) {
  connection.onDocumentFormatting(async (params): Promise<TextEdit[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    // PSS/E .raw and .dyr formatting
    if (/\.(raw|dyr)$/i.test(params.textDocument.uri) || document.languageId === "psse") {
      const { formatPsseDocument } = await import("@modelscript/psse");
      const formatted = formatPsseDocument(document.getText(), params.textDocument.uri);
      const lastLine = document.lineCount - 1;
      const lastChar = document.getText().length - document.offsetAt({ line: lastLine, character: 0 });
      return [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: lastLine, character: lastChar },
          },
          newText: formatted,
        },
      ];
    }

    // STEP formatting — one entity per line, consistent spacing
    if (params.textDocument.uri.match(/\.(step|stp|p21)$/i)) {
      return formatStepDocument(document);
    }

    // SysML2 / KerML formatting
    if (
      params.textDocument.uri.match(/\.(sysml|kerml)$/i) ||
      document.languageId === "sysml2" ||
      document.languageId === "kerml"
    ) {
      const { formatSysmlSource } = await import("@modelscript/sysml2");
      const formatted = formatSysmlSource(document.getText(), {
        tabSize: params.options.tabSize,
        insertSpaces: params.options.insertSpaces,
      });
      const lastLine = document.lineCount - 1;
      const lastChar = document.getText().length - document.offsetAt({ line: lastLine, character: 0 });
      return [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: lastLine, character: lastChar },
          },
          newText: formatted,
        },
      ];
    }

    // Modelica formatting
    if (!isParserReady()) {
      return [];
    }

    const text = document.getText();
    const tree = getDocumentTree(params.textDocument.uri);
    if (!tree) return [];
    const formatted = formatModelicaTree(tree, text);

    // Return a single edit replacing the entire document
    const lastLine = document.lineCount - 1;
    const lastChar = document.getText().length - document.offsetAt({ line: lastLine, character: 0 });

    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: lastLine, character: lastChar },
        },
        newText: formatted,
      },
    ];
  });

  connection.onDocumentRangeFormatting(async (params): Promise<TextEdit[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    if (
      params.textDocument.uri.match(/\.(sysml|kerml)$/i) ||
      document.languageId === "sysml2" ||
      document.languageId === "kerml"
    ) {
      const { formatSysmlSource } = await import("@modelscript/sysml2");
      const formatted = formatSysmlSource(document.getText(), {
        tabSize: params.options.tabSize,
        insertSpaces: params.options.insertSpaces,
        startLine: params.range.start.line,
        endLine: params.range.end.line,
      });
      const lastLine = document.lineCount - 1;
      const lastChar = document.getText().length - document.offsetAt({ line: lastLine, character: 0 });
      return [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: lastLine, character: lastChar },
          },
          newText: formatted,
        },
      ];
    }
    return [];
  });
}
