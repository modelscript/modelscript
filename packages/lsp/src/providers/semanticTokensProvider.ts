/* eslint-disable no-useless-assignment, @typescript-eslint/no-explicit-any */
import {
  Connection,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  TextDocuments,
} from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";

import { keywords, typeKeywords } from "../utils/keywords";

const tokenTypes = [
  "keyword",
  "type",
  "class",
  "variable",
  "parameter",
  "function",
  "string",
  "number",
  "operator",
  "comment",
];

const tokenModifiers = ["declaration", "readonly"];

const legend: SemanticTokensLegend = { tokenTypes, tokenModifiers };

export { legend };

function computeStepSemanticTokens(builder: SemanticTokensBuilder, text: string): SemanticTokens {
  const rawTokens: {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }[] = [];

  // Section/sentinel keywords
  const sectionKeywords = new Set(["ISO-10303-21", "HEADER", "DATA", "ENDSEC", "END-ISO-10303-21"]);

  const lines = text.split("\n");
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Match tokens on this line with a multi-pattern regex.
    // Order matters: longer patterns first to avoid partial matches.
    const pattern =
      /(?:\/\*[\s\S]*?\*\/)|(?:'(?:[^']|'')*')|(?:#[0-9]+)|(?:\.[A-Z][A-Z0-9_]*\.)|(?:[A-Z][A-Z0-9_]{2,})|(?:[+-]?[0-9]+\.[0-9]*(?:[eE][+-]?[0-9]+)?)|(?:[+-]?[0-9]+)/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const tokenText = match[0];
      const col = match.index;
      let typeIndex = -1;

      if (tokenText.startsWith("/*")) {
        // Block comment
        typeIndex = tokenTypes.indexOf("comment");
      } else if (tokenText.startsWith("'")) {
        // String literal
        typeIndex = tokenTypes.indexOf("string");
      } else if (tokenText.startsWith("#")) {
        // Entity instance reference
        typeIndex = tokenTypes.indexOf("variable");
      } else if (tokenText.startsWith(".") && tokenText.endsWith(".")) {
        // Enumeration value (.T., .F., .MILLI., etc.)
        typeIndex = tokenTypes.indexOf("enumMember");
      } else if (/^[A-Z][A-Z0-9_]{2,}$/.test(tokenText)) {
        if (sectionKeywords.has(tokenText)) {
          typeIndex = tokenTypes.indexOf("keyword");
        } else {
          // Entity type keyword (PRODUCT, CARTESIAN_POINT, etc.)
          typeIndex = tokenTypes.indexOf("type");
        }
      } else {
        // Number
        typeIndex = tokenTypes.indexOf("number");
      }

      if (typeIndex >= 0) {
        rawTokens.push({
          line: lineIdx,
          char: col,
          length: tokenText.length,
          typeIndex,
          modifier: 0,
        });
      }
    }
  }

  rawTokens.sort((a, b) => (a.line === b.line ? a.char - b.char : a.line - b.line));
  for (const token of rawTokens) {
    builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
  }

  return builder.build();
}

const sysml2StructuralKeywords = new Set([
  "package",
  "library",
  "standard",
  "part",
  "actor",
  "stakeholder",
  "attribute",
  "port",
  "connection",
  "interface",
  "allocation",
  "action",
  "state",
  "constraint",
  "requirement",
  "concern",
  "case",
  "analysis",
  "verification",
  "use",
  "view",
  "viewpoint",
  "rendering",
  "enumeration",
  "occurrence",
  "item",
  "calculation",
  "metadata",
  "flow",
  "connect",
  "def",
]);

const sysml2ControlKeywords = new Set([
  "if",
  "else",
  "then",
  "while",
  "for",
  "loop",
  "return",
  "import",
  "alias",
  "about",
  "accept",
  "after",
  "all",
  "as",
  "assign",
  "assert",
  "assume",
  "at",
  "bind",
  "by",
  "chains",
  "collect",
  "decide",
  "default",
  "defined",
  "dependency",
  "do",
  "doc",
  "done",
  "emit",
  "entry",
  "exhibit",
  "expose",
  "filter",
  "first",
  "fork",
  "frame",
  "from",
  "hastype",
  "intersect",
  "include",
  "istype",
  "join",
  "merge",
  "message",
  "multiplicity",
  "namespace",
  "nonunique",
  "objective",
  "of",
  "on",
  "ordered",
  "perform",
  "private",
  "protected",
  "public",
  "readonly",
  "redefines",
  "ref",
  "render",
  "rep",
  "require",
  "satisfy",
  "send",
  "snapshot",
  "specializes",
  "stakeholder",
  "subject",
  "subsets",
  "succession",
  "timeslice",
  "to",
  "transition",
  "union",
  "until",
  "variant",
  "variation",
  "verify",
  "via",
  "when",
  "in",
  "out",
  "inout",
  "abstract",
  "derived",
  "end",
  "individual",
  "parallel",
]);

const sysml2BuiltinTypes = new Set([
  "Boolean",
  "Integer",
  "Real",
  "String",
  "Natural",
  "Positive",
  "NaturalNumber",
  "Number",
  "ScalarValues",
  "Any",
  "Anything",
  "DataValue",
]);

function computeSysML2SemanticTokens(
  builder: SemanticTokensBuilder,
  text: string,
  getSysml2Parser: () => any,
  isSysml2ParserReady: () => boolean,
): SemanticTokens {
  if (!isSysml2ParserReady() || !getSysml2Parser()) {
    return builder.build();
  }

  let tree;
  try {
    tree = getSysml2Parser().parse(text);
  } catch {
    return builder.build();
  }
  if (!tree) {
    return builder.build();
  }

  const rawTokens: {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }[] = [];

  // SysML2 node types for definition names (after 'def Something')
  const definitionTypes = new Set([
    "PartDefinition",
    "AttributeDefinition",
    "PortDefinition",
    "ConnectionDefinition",
    "InterfaceDefinition",
    "AllocationDefinition",
    "ActionDefinition",
    "StateDefinition",
    "ConstraintDefinition",
    "RequirementDefinition",
    "ConcernDefinition",
    "CaseDefinition",
    "AnalysisCaseDefinition",
    "VerificationCaseDefinition",
    "ViewDefinition",
    "ViewpointDefinition",
    "RenderingDefinition",
    "CalculationDefinition",
    "EnumerationDefinition",
    "OccurrenceDefinition",
    "ItemDefinition",
    "FlowDefinition",
    "MetadataDefinition",
  ]);

  const usageTypes = new Set([
    "PartUsage",
    "AttributeUsage",
    "PortUsage",
    "ConnectionUsage",
    "InterfaceUsage",
    "AllocationUsage",
    "ActionUsage",
    "StateUsage",
    "ConstraintUsage",
    "RequirementUsage",
    "ConcernUsage",
    "CaseUsage",
    "AnalysisCaseUsage",
    "VerificationCaseUsage",
    "ViewUsage",
    "ViewpointUsage",
    "RenderingUsage",
    "CalculationUsage",
    "EnumerationUsage",
    "OccurrenceUsage",
    "ItemUsage",
    "FlowUsage",
    "MetadataUsage",
    "ReferenceUsage",
    "DefaultReferenceUsage",
  ]);

  const traverse = (node: any) => {
    let tokenType: string | null = null;
    const modifier = 0;

    const nodeType = node.type;
    const nodeText = node.text;

    // Named fields from the grammar — declaredName is usually an identifier
    if (nodeType === "declaredName" || nodeType === "name") {
      // Determine if this is a definition name (type) or usage name (variable)
      const parent = node.parent;
      if (parent && definitionTypes.has(parent.type)) {
        tokenType = "type";
      } else if (parent && usageTypes.has(parent.type)) {
        tokenType = "variable";
      } else if (parent?.type === "Package" || parent?.type === "LibraryPackage") {
        tokenType = "namespace";
      } else {
        tokenType = "variable";
      }
    } else if (nodeType === "qualifiedName" || nodeType === "identification") {
      // Skip — traverse children
    } else if (sysml2StructuralKeywords.has(nodeText) && node.childCount === 0) {
      tokenType = "keyword";
    } else if (sysml2ControlKeywords.has(nodeText) && node.childCount === 0) {
      tokenType = "keyword";
    } else if (sysml2BuiltinTypes.has(nodeText) && node.childCount === 0) {
      tokenType = "type";
    } else if (nodeType === "comment" || nodeType === "line_comment" || nodeType === "block_comment") {
      tokenType = "comment";
    } else if (nodeType === "string_literal" || nodeType === "regular_expression") {
      tokenType = "string";
    } else if (nodeType === "integer_literal" || nodeType === "real_literal") {
      tokenType = "number";
    } else if (["+", "-", "*", "/", "=", "<", ">", "<=", ">=", "==", "!="].includes(nodeType)) {
      tokenType = "operator";
    }

    if (tokenType !== null) {
      const typeIndex = tokenTypes.indexOf(tokenType);
      if (typeIndex >= 0 && node.startPosition.row === node.endPosition.row) {
        const length = node.endPosition.column - node.startPosition.column;
        if (
          length > 0 &&
          !rawTokens.some((t) => t.line === node.startPosition.row && t.char === node.startPosition.column)
        ) {
          rawTokens.push({
            line: node.startPosition.row,
            char: node.startPosition.column,
            length,
            typeIndex,
            modifier,
          });
        }
      }
    }

    for (const child of node.children) {
      traverse(child);
    }
  };

  traverse(tree.rootNode);

  rawTokens.sort((a, b) => (a.line === b.line ? a.char - b.char : a.line - b.line));
  for (const token of rawTokens) {
    builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
  }

  return builder.build();
}

export function registerSemanticTokensProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  getDocumentTree: (uri: string) => any,
  getSysml2Parser: () => any,
  isSysml2ParserReady: () => boolean,
  parseFallback?: (ext: string, text: string) => any,
) {
  function computeSemanticTokens(textDocument: TextDocument): SemanticTokens {
    const builder = new SemanticTokensBuilder();
    const text = textDocument.getText();

    // STEP files use regex-based semantic tokens
    if (textDocument.uri.match(/\.(step|stp|p21)$/i)) {
      return computeStepSemanticTokens(builder, text);
    }

    // SysML2 files use a separate parser and node-type classification
    if (textDocument.uri.endsWith(".sysml")) {
      return computeSysML2SemanticTokens(builder, text, getSysml2Parser, isSysml2ParserReady);
    }

    const docTree = getDocumentTree(textDocument.uri);
    if (!docTree || !docTree.tree) {
      return builder.build();
    }

    let tree = docTree.tree;
    if (docTree.text !== text && parseFallback) {
      try {
        tree = parseFallback(textDocument.uri.endsWith(".sysml") ? ".sysml" : ".mo", text) as any;
      } catch {
        // fallback to old tree, but it will cause invalid tokens
      }
    }

    const rawTokens: {
      line: number;
      char: number;
      length: number;
      typeIndex: number;
      modifier: number;
    }[] = [];

    const traverseTree = (node: any) => {
      let tokenType: string | null = null;
      const modifier = 0;

      const isKeyword = keywords.includes(node.type) || typeKeywords.includes(node.type);

      if (isKeyword) {
        tokenType = "keyword";
      } else if (node.type === "IDENT") {
        const parent = node.parent;
        let p = parent;
        while (p && p.type === "Name") {
          p = p.parent;
        }

        if (
          parent?.type === "LongClassSpecifier" ||
          parent?.type === "ShortClassSpecifier" ||
          parent?.type === "DerClassSpecifier" ||
          p?.type === "WithinDirective" ||
          p?.type === "ExtendsClause" ||
          p?.type === "TypeSpecifier"
        ) {
          tokenType = "type";
        } else if (parent?.type === "Declaration") {
          tokenType = "variable";
        } else if (typeKeywords.includes(node.text)) {
          tokenType = "type";
        } else {
          tokenType = "variable";
        }
      } else if (node.type === "STRING") {
        tokenType = "string";
      } else if (node.type === "UNSIGNED_INTEGER" || node.type === "UNSIGNED_REAL") {
        tokenType = "number";
      } else if (node.type === "comment") {
        tokenType = "comment";
      } else if (["+", "-", "*", "/", "=", "<", ">", "<=", ">=", "==", "<>"].includes(node.type)) {
        tokenType = "operator";
      }

      if (tokenType !== null) {
        const typeIndex = tokenTypes.indexOf(tokenType);
        if (typeIndex >= 0) {
          if (!rawTokens.some((t) => t.line === node.startPosition.row && t.char === node.startPosition.column)) {
            rawTokens.push({
              line: node.startPosition.row,
              char: node.startPosition.column,
              length: node.endPosition.column - node.startPosition.column,
              typeIndex,
              modifier,
            });
          }
        }
      }

      for (const child of node.children) {
        traverseTree(child);
      }
    };

    traverseTree(tree.rootNode);

    rawTokens.sort((a, b) => {
      if (a.line === b.line) {
        return a.char - b.char;
      }
      return a.line - b.line;
    });

    for (const token of rawTokens) {
      builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
    }

    return builder.build();
  }

  connection.onRequest("textDocument/semanticTokens/full", (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return { data: [] };
    }
    return computeSemanticTokens(document);
  });
}
