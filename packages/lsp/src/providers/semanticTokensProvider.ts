// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Connection,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  TextDocuments,
} from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

const DEFAULT_TYPE_KEYWORDS = ["Real", "Integer", "Boolean", "String", "Natural"];

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
  "namespace",
  "enumMember",
];

const tokenModifiers = ["declaration", "readonly"];

const legend: SemanticTokensLegend = { tokenTypes, tokenModifiers };

export { legend };

function computeCfdSemanticTokens(builder: SemanticTokensBuilder, text: string): SemanticTokens {
  const rawTokens: {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }[] = [];

  const lines = text.split(/\r?\n/);
  const keywordIdx = tokenTypes.indexOf("keyword");
  const typeIdx = tokenTypes.indexOf("type");
  const commentIdx = tokenTypes.indexOf("comment");
  const numberIdx = tokenTypes.indexOf("number");
  const stringIdx = tokenTypes.indexOf("string");
  const operatorIdx = tokenTypes.indexOf("operator");
  const variableIdx = tokenTypes.indexOf("variable");
  const parameterIdx = tokenTypes.indexOf("parameter");

  const knownConstants = new Set([
    "INC_RANS",
    "RANS",
    "EULER",
    "NAVIER_STOKES",
    "SST",
    "SPALART_ALLMARAS",
    "DIRECT",
    "ADJOINT",
    "CONSTANT",
    "CONSTANT_VISCOSITY",
    "SUTHERLAND",
    "RMS_PRESSURE",
    "RMS_DENSITY",
    "RMS_ENERGY",
    "DRAG",
    "LIFT",
    "YES",
    "NO",
    "TRUE",
    "FALSE",
  ]);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    if (!line.trim()) continue;

    // 1. Check for comment start
    const commentMatch = line.match(/(%|#|\/\/)/);
    let codePart = line;
    let commentStart = -1;

    if (commentMatch && commentMatch.index !== undefined) {
      commentStart = commentMatch.index;
      codePart = line.slice(0, commentStart);
      const commentPart = line.slice(commentStart);
      rawTokens.push({
        line: lineIdx,
        char: commentStart,
        length: commentPart.length,
        typeIndex: commentIdx,
        modifier: 0,
      });
    }

    if (!codePart.trim()) continue;

    // 2. Tokenize directive keyword before '=', then '=' operator, then value tokens
    const eqIdx = codePart.indexOf("=");
    if (eqIdx !== -1) {
      const keyPart = codePart.slice(0, eqIdx);
      const valPart = codePart.slice(eqIdx + 1);

      const keyMatch = keyPart.match(/([A-Za-z_][A-Za-z0-9_]*)/);
      if (keyMatch && keyMatch.index !== undefined) {
        rawTokens.push({
          line: lineIdx,
          char: keyMatch.index,
          length: keyMatch[0].length,
          typeIndex: keywordIdx,
          modifier: 0,
        });
      }

      rawTokens.push({
        line: lineIdx,
        char: eqIdx,
        length: 1,
        typeIndex: operatorIdx,
        modifier: 0,
      });

      const valOffset = eqIdx + 1;
      const valPattern =
        /(?:\{\{[\s\S]*?\}\})|(?:"[^"]*")|(?:'[^']*')|(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|(?:[A-Za-z_][A-Za-z0-9_]*)|(?:[=,()+\-*/^])/g;
      let m: RegExpExecArray | null;
      while ((m = valPattern.exec(valPart)) !== null) {
        const tok = m[0];
        const col = valOffset + m.index;
        let tIdx = -1;
        if (tok.startsWith("{{")) {
          tIdx = variableIdx;
        } else if (tok.startsWith('"') || tok.startsWith("'")) {
          tIdx = stringIdx;
        } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)/.test(tok)) {
          tIdx = numberIdx;
        } else if (knownConstants.has(tok.toUpperCase())) {
          tIdx = typeIdx;
        } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) {
          tIdx = parameterIdx;
        } else {
          tIdx = operatorIdx;
        }
        if (tIdx >= 0) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: tIdx, modifier: 0 });
        }
      }
    } else {
      const tokenPattern = /(?:[A-Za-z_][A-Za-z0-9_]*)|(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
      let m: RegExpExecArray | null;
      while ((m = tokenPattern.exec(codePart)) !== null) {
        const tok = m[0];
        const col = m.index;
        const tIdx = /^[0-9+-]/.test(tok) ? numberIdx : keywordIdx;
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: tIdx, modifier: 0 });
      }
    }
  }

  rawTokens.sort((a, b) => (a.line === b.line ? a.char - b.char : a.line - b.line));
  for (const token of rawTokens) {
    builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
  }
  return builder.build();
}

function computeFeaSemanticTokens(builder: SemanticTokensBuilder, text: string): SemanticTokens {
  const rawTokens: {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }[] = [];

  const lines = text.split(/\r?\n/);
  const keywordIdx = tokenTypes.indexOf("keyword");
  const typeIdx = tokenTypes.indexOf("type");
  const commentIdx = tokenTypes.indexOf("comment");
  const numberIdx = tokenTypes.indexOf("number");
  const stringIdx = tokenTypes.indexOf("string");
  const operatorIdx = tokenTypes.indexOf("operator");
  const variableIdx = tokenTypes.indexOf("variable");
  const parameterIdx = tokenTypes.indexOf("parameter");

  const knownConstants = new Set([
    "C3D8",
    "C3D8R",
    "C3D20",
    "C3D20R",
    "C3D4",
    "C3D10",
    "S4",
    "S4R",
    "S3",
    "B31",
    "B32",
    "T3D2",
    "STATIC",
    "DYNAMIC",
    "FREQUENCY",
    "BUCKLE",
    "MODAL",
  ]);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Comment line
    if (trimmed.startsWith("**") || trimmed.startsWith("$") || trimmed.startsWith("#")) {
      const col = line.indexOf(trimmed);
      rawTokens.push({
        line: lineIdx,
        char: col,
        length: line.length - col,
        typeIndex: commentIdx,
        modifier: 0,
      });
      continue;
    }

    // Keyword card line
    if (trimmed.startsWith("*")) {
      const cardPattern =
        /(?:\{\{[\s\S]*?\}\})|(?:"[^"]*")|(?:'[^']*')|(?:\*[A-Za-z_][A-Za-z0-9_ ]*)|(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|(?:[A-Za-z_][A-Za-z0-9_]*)|(?:[=,()+\-*/^])/g;
      let m: RegExpExecArray | null;
      let isFirst = true;
      while ((m = cardPattern.exec(line)) !== null) {
        const tok = m[0];
        const col = m.index;
        let tIdx = -1;
        if (isFirst && tok.startsWith("*")) {
          tIdx = keywordIdx;
          isFirst = false;
        } else if (tok.startsWith("{{")) {
          tIdx = variableIdx;
        } else if (tok.startsWith('"') || tok.startsWith("'")) {
          tIdx = stringIdx;
        } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)/.test(tok)) {
          tIdx = numberIdx;
        } else if (knownConstants.has(tok.toUpperCase())) {
          tIdx = typeIdx;
        } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) {
          tIdx = parameterIdx;
        } else {
          tIdx = operatorIdx;
        }
        if (tIdx >= 0) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: tIdx, modifier: 0 });
        }
      }
      continue;
    }

    // Data line
    const dataPattern =
      /(?:\{\{[\s\S]*?\}\})|(?:"[^"]*")|(?:'[^']*')|(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|(?:[A-Za-z_][A-Za-z0-9_]*)|(?:[=,()+\-*/^])/g;
    let m: RegExpExecArray | null;
    while ((m = dataPattern.exec(line)) !== null) {
      const tok = m[0];
      const col = m.index;
      let tIdx = -1;
      if (tok.startsWith("{{")) {
        tIdx = variableIdx;
      } else if (tok.startsWith('"') || tok.startsWith("'")) {
        tIdx = stringIdx;
      } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)/.test(tok)) {
        tIdx = numberIdx;
      } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) {
        tIdx = variableIdx;
      } else {
        tIdx = operatorIdx;
      }
      if (tIdx >= 0) {
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: tIdx, modifier: 0 });
      }
    }
  }

  rawTokens.sort((a, b) => (a.line === b.line ? a.char - b.char : a.line - b.line));
  for (const token of rawTokens) {
    builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
  }
  return builder.build();
}

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
    const line = lines[lineIdx]!;

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

  const seenTokens = new Set<string>();

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
        if (length > 0 && !seenTokens.has(`${node.startPosition.row}:${node.startPosition.column}`)) {
          seenTokens.add(`${node.startPosition.row}:${node.startPosition.column}`);
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

  try {
    traverse(tree.rootNode);
  } finally {
    tree.delete?.();
  }

  rawTokens.sort((a, b) => (a.line === b.line ? a.char - b.char : a.line - b.line));
  for (const token of rawTokens) {
    builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
  }

  return builder.build();
}

function computeFortranSemanticTokens(builder: SemanticTokensBuilder, text: string): SemanticTokens {
  const rawTokens: {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }[] = [];

  const keywordIdx = tokenTypes.indexOf("keyword");
  const typeIdx = tokenTypes.indexOf("type");
  const variableIdx = tokenTypes.indexOf("variable");
  const parameterIdx = tokenTypes.indexOf("parameter");
  const functionIdx = tokenTypes.indexOf("function");
  const stringIdx = tokenTypes.indexOf("string");
  const numberIdx = tokenTypes.indexOf("number");
  const operatorIdx = tokenTypes.indexOf("operator");
  const commentIdx = tokenTypes.indexOf("comment");

  const fortranKeywords = new Set([
    "program",
    "subroutine",
    "function",
    "module",
    "end",
    "endif",
    "enddo",
    "if",
    "then",
    "else",
    "elseif",
    "do",
    "call",
    "return",
    "continue",
    "common",
    "parameter",
    "dimension",
    "implicit",
    "none",
    "intent",
    "in",
    "out",
    "inout",
    "save",
    "allocatable",
    "optional",
    "value",
    "kind",
    "len",
  ]);

  const fortranTypes = new Set([
    "real",
    "integer",
    "double",
    "precision",
    "logical",
    "complex",
    "character",
    "storf",
    "stori",
  ]);

  const fortranFunctions = new Set([
    "sqrt",
    "abs",
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "atan2",
    "exp",
    "log",
    "log10",
    "min",
    "max",
    "mod",
    "sign",
    "realpole",
    "delay1",
    "intgrl",
    "leadlag",
    "diff",
    "limiter",
    "limit",
    "hardlimit",
    "cmplx_polar",
    "sin_cos",
    "current_source",
    "e_branch",
  ]);

  const fortranSpecialConstants = new Set(["time", "delt", "firststep", "nstorf", "nstori"]);

  // Pass 1: Discover dummy arguments and intent(in|out) parameters
  const paramNames = new Set<string>();
  const routineNames = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const clean = rawLine.replace(/!.*$/, "").trim();
    const subMatch = /^(?:subroutine|function|program|module)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/i.exec(
      clean,
    );
    if (subMatch) {
      routineNames.add(subMatch[1]!.toLowerCase());
      if (subMatch[2]) {
        for (const arg of subMatch[2].split(",")) {
          const a = arg.trim().toLowerCase();
          if (a) paramNames.add(a);
        }
      }
    }
    const intentMatch = /\bintent\s*\(\s*(?:in\s*out|inout|in|out)\s*\).*?(?:::)\s*(.+)$/i.exec(clean);
    if (intentMatch) {
      for (const item of intentMatch[1]!.split(",")) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(item.trim());
        if (m) paramNames.add(m[1]!.toLowerCase());
      }
    }
  }

  // Pass 2: Line-by-line lexical classification
  const tokenPattern =
    /(?:"[^"]*")|(?:'[^']*')|(?:\$#DIM\([A-Za-z_][A-Za-z0-9_]*\))|(?:\$[A-Za-z_][A-Za-z0-9_]*)|(?:\.(?:AND|OR|NOT|EQ|NE|LT|LE|GT|GE|TRUE|FALSE)\.)|(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?(?:_[A-Za-z0-9_]+)?)|(?:[A-Za-z_][A-Za-z0-9_]*)|(?:::|\*\*|==|\/=|!=|<=|>=|&&|\|\||[=+\-*/<>])/gi;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    if (!line.trim()) continue;

    // Fixed-form full-line comment (C or * in column 1)
    if (/^[Cc*]\s/.test(line) && !/^\s*call\b/i.test(line)) {
      rawTokens.push({
        line: lineIdx,
        char: 0,
        length: line.length,
        typeIndex: commentIdx,
        modifier: 0,
      });
      continue;
    }

    // Find inline '!' comment (ignoring '!=' and '!' inside strings)
    let commentStart = -1;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "!" && !inSingle && !inDouble && line[i + 1] !== "=") {
        commentStart = i;
        break;
      }
    }

    const codePart = commentStart >= 0 ? line.slice(0, commentStart) : line;
    if (commentStart >= 0) {
      rawTokens.push({
        line: lineIdx,
        char: commentStart,
        length: line.length - commentStart,
        typeIndex: commentIdx,
        modifier: 0,
      });
    }

    if (!codePart.trim()) continue;

    // Preprocessor directive line (#IF, #STORAGE, #LOCAL, etc.)
    const dirMatch = /^\s*(#[A-Za-z0-9_]+)/.exec(codePart);
    if (dirMatch) {
      const idx = codePart.indexOf(dirMatch[1]!);
      rawTokens.push({
        line: lineIdx,
        char: idx,
        length: dirMatch[1]!.length,
        typeIndex: keywordIdx,
        modifier: 0,
      });
    }

    let prevWordLower = "";
    tokenPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(codePart)) !== null) {
      const tok = match[0]!;
      const col = match.index;
      const lower = tok.toLowerCase();

      if (tok.startsWith("'") || tok.startsWith('"')) {
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: stringIdx, modifier: 0 });
      } else if (tok.startsWith("$")) {
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: parameterIdx, modifier: 0 });
      } else if (/^\.(?:true|false)\.$/i.test(tok)) {
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: keywordIdx, modifier: 0 });
      } else if (tok.startsWith(".")) {
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: operatorIdx, modifier: 0 });
      } else if (/^[+-]?(?:\d|\.\d)/.test(tok)) {
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: numberIdx, modifier: 0 });
      } else if (/^[A-Za-z_]/.test(tok)) {
        if (fortranKeywords.has(lower)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: keywordIdx, modifier: 0 });
        } else if (fortranTypes.has(lower)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: typeIdx, modifier: 0 });
        } else if (
          prevWordLower === "subroutine" ||
          prevWordLower === "function" ||
          prevWordLower === "program" ||
          prevWordLower === "module" ||
          prevWordLower === "call" ||
          routineNames.has(lower)
        ) {
          const isDecl =
            prevWordLower === "subroutine" ||
            prevWordLower === "function" ||
            prevWordLower === "program" ||
            prevWordLower === "module";
          rawTokens.push({
            line: lineIdx,
            char: col,
            length: tok.length,
            typeIndex: functionIdx,
            modifier: isDecl ? 1 : 0,
          });
        } else if (fortranFunctions.has(lower)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: functionIdx, modifier: 0 });
        } else if (fortranSpecialConstants.has(lower)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: variableIdx, modifier: 2 });
        } else if (paramNames.has(lower)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: parameterIdx, modifier: 0 });
        } else {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: variableIdx, modifier: 0 });
        }
        prevWordLower = lower;
      } else {
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: operatorIdx, modifier: 0 });
      }
    }
  }

  rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
  for (const t of rawTokens) {
    builder.push(t.line, t.char, t.length, t.typeIndex, t.modifier);
  }
  return builder.build();
}

function computeOwl2SemanticTokens(builder: SemanticTokensBuilder, text: string): SemanticTokens {
  const rawTokens: {
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }[] = [];

  const keywordIdx = tokenTypes.indexOf("keyword");
  const typeIdx = tokenTypes.indexOf("type");
  const classIdx = tokenTypes.indexOf("class");
  const functionIdx = tokenTypes.indexOf("function");
  const stringIdx = tokenTypes.indexOf("string");
  const numberIdx = tokenTypes.indexOf("number");
  const operatorIdx = tokenTypes.indexOf("operator");
  const commentIdx = tokenTypes.indexOf("comment");
  const namespaceIdx = tokenTypes.indexOf("namespace");
  const enumMemberIdx = tokenTypes.indexOf("enumMember");

  const owl2Keywords = new Set([
    "Prefix",
    "Ontology",
    "Import",
    "Declaration",
    "Class",
    "Datatype",
    "ObjectProperty",
    "DataProperty",
    "AnnotationProperty",
    "NamedIndividual",
    "Annotation",
    "SubClassOf",
    "EquivalentClasses",
    "DisjointClasses",
    "DisjointUnion",
    "SubObjectPropertyOf",
    "ObjectPropertyChain",
    "EquivalentObjectProperties",
    "DisjointObjectProperties",
    "InverseObjectProperties",
    "ObjectPropertyDomain",
    "ObjectPropertyRange",
    "FunctionalObjectProperty",
    "InverseFunctionalObjectProperty",
    "ReflexiveObjectProperty",
    "IrreflexiveObjectProperty",
    "SymmetricObjectProperty",
    "AsymmetricObjectProperty",
    "TransitiveObjectProperty",
    "SubDataPropertyOf",
    "EquivalentDataProperties",
    "DisjointDataProperties",
    "DataPropertyDomain",
    "DataPropertyRange",
    "FunctionalDataProperty",
    "DatatypeDefinition",
    "HasKey",
    "SameIndividual",
    "DifferentIndividuals",
    "ClassAssertion",
    "ObjectPropertyAssertion",
    "NegativeObjectPropertyAssertion",
    "DataPropertyAssertion",
    "NegativeDataPropertyAssertion",
    "AnnotationAssertion",
    "SubAnnotationPropertyOf",
    "AnnotationPropertyDomain",
    "AnnotationPropertyRange",
    "ObjectIntersectionOf",
    "ObjectUnionOf",
    "ObjectComplementOf",
    "ObjectOneOf",
    "ObjectSomeValuesFrom",
    "ObjectAllValuesFrom",
    "ObjectHasValue",
    "ObjectHasSelf",
    "ObjectMinCardinality",
    "ObjectMaxCardinality",
    "ObjectExactCardinality",
    "ObjectInverseOf",
    "DataIntersectionOf",
    "DataUnionOf",
    "DataComplementOf",
    "DataOneOf",
    "DataSomeValuesFrom",
    "DataAllValuesFrom",
    "DataHasValue",
    "DataMinCardinality",
    "DataMaxCardinality",
    "DataExactCardinality",
    "DatatypeRestriction",
  ]);

  // First pass: collect entity kinds from declarations and axioms
  const classIris = new Set<string>();
  const propertyIris = new Set<string>();
  const individualIris = new Set<string>();
  const datatypeIris = new Set<string>();

  for (const m of text.matchAll(/Declaration\s*\(\s*Class\s*\(\s*([^\s()]+)/g)) {
    if (m[1]) classIris.add(m[1]);
  }
  for (const m of text.matchAll(/Declaration\s*\(\s*Datatype\s*\(\s*([^\s()]+)/g)) {
    if (m[1]) datatypeIris.add(m[1]);
  }
  for (const m of text.matchAll(
    /Declaration\s*\(\s*(?:ObjectProperty|DataProperty|AnnotationProperty)\s*\(\s*([^\s()]+)/g,
  )) {
    if (m[1]) propertyIris.add(m[1]);
  }
  for (const m of text.matchAll(/Declaration\s*\(\s*NamedIndividual\s*\(\s*([^\s()]+)/g)) {
    if (m[1]) individualIris.add(m[1]);
  }
  for (const m of text.matchAll(/SubClassOf\s*\(\s*([^\s()]+)\s+([^\s()]+)/g)) {
    if (m[1] && !owl2Keywords.has(m[1])) classIris.add(m[1]);
    if (m[2] && !owl2Keywords.has(m[2])) classIris.add(m[2]);
  }
  for (const m of text.matchAll(/ClassAssertion\s*\(\s*([^\s()]+)\s+([^\s()]+)/g)) {
    if (m[1] && !owl2Keywords.has(m[1])) classIris.add(m[1]);
    if (m[2] && !owl2Keywords.has(m[2])) individualIris.add(m[2]);
  }
  for (const m of text.matchAll(
    /(?:ObjectPropertyDomain|ObjectPropertyRange|DataPropertyDomain)\s*\(\s*([^\s()]+)\s+([^\s()]+)/g,
  )) {
    if (m[1] && !owl2Keywords.has(m[1])) propertyIris.add(m[1]);
    if (m[2] && !owl2Keywords.has(m[2])) classIris.add(m[2]);
  }
  for (const m of text.matchAll(/DataPropertyRange\s*\(\s*([^\s()]+)\s+([^\s()]+)/g)) {
    if (m[1] && !owl2Keywords.has(m[1])) propertyIris.add(m[1]);
    if (m[2] && !owl2Keywords.has(m[2])) datatypeIris.add(m[2]);
  }
  for (const m of text.matchAll(/ObjectPropertyAssertion\s*\(\s*([^\s()]+)\s+([^\s()]+)\s+([^\s()]+)/g)) {
    if (m[1] && !owl2Keywords.has(m[1])) propertyIris.add(m[1]);
    if (m[2] && !owl2Keywords.has(m[2])) individualIris.add(m[2]);
    if (m[3] && !owl2Keywords.has(m[3])) individualIris.add(m[3]);
  }
  for (const m of text.matchAll(/DataPropertyAssertion\s*\(\s*([^\s()]+)\s+([^\s()]+)/g)) {
    if (m[1] && !owl2Keywords.has(m[1])) propertyIris.add(m[1]);
    if (m[2] && !owl2Keywords.has(m[2])) individualIris.add(m[2]);
  }

  // Second pass: tokenize line by line
  const lines = text.split(/\r?\n/);
  const tokenPattern =
    /(#.*$|\/\/.*$)|(<[^>]*>)|("([^"\\]|\\.)*")|(\^\^)|((?:[a-zA-Z_][\w.-]*)?:[a-zA-Z_][\w.-]*)|([a-zA-Z_][\w.-]*:)|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|([a-zA-Z_]\w*)/g;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const isDeclLine = /\bDeclaration\s*\(/.test(line);
    tokenPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(line)) !== null) {
      const tok = match[0];
      const col = match.index;
      if (match[1]) {
        // Comment
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: commentIdx, modifier: 0 });
      } else if (match[2] || match[3]) {
        // <IRI> or "string"
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: stringIdx, modifier: 0 });
      } else if (match[5]) {
        // ^^ datatype operator
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: operatorIdx, modifier: 0 });
      } else if (match[6]) {
        // Abbreviated IRI: e.g. :CyberPhysicalAsset, xsd:double, :hasComponent, :robot_arm_01
        const localIdx = tok.indexOf(":");
        const prefix = tok.slice(0, localIdx);
        const localName = tok.slice(localIdx + 1);
        const modifier = isDeclLine ? 1 : 0;
        if (
          datatypeIris.has(tok) ||
          prefix === "xsd" ||
          prefix === "rdfs" ||
          prefix === "rdf" ||
          tok === "owl:Thing" ||
          tok === "owl:Nothing"
        ) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: typeIdx, modifier: 0 });
        } else if (classIris.has(tok)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: classIdx, modifier });
        } else if (propertyIris.has(tok)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: functionIdx, modifier });
        } else if (individualIris.has(tok)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: enumMemberIdx, modifier });
        } else if (/^[A-Z]/.test(localName)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: classIdx, modifier });
        } else {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: functionIdx, modifier });
        }
      } else if (match[7]) {
        // Prefix declaration token e.g. xsd: in Prefix(xsd: = <...>)
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: namespaceIdx, modifier: 1 });
      } else if (match[8]) {
        // Number literal
        rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: numberIdx, modifier: 0 });
      } else if (match[9]) {
        // Bare identifier / keyword
        if (owl2Keywords.has(tok)) {
          rawTokens.push({ line: lineIdx, char: col, length: tok.length, typeIndex: keywordIdx, modifier: 0 });
        }
      }
    }
  }

  rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
  for (const t of rawTokens) {
    builder.push(t.line, t.char, t.length, t.typeIndex, t.modifier);
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
  const tokensCache = new Map<string, { version: number; tokens: SemanticTokens }>();

  documents.onDidClose((e) => {
    tokensCache.delete(e.document.uri);
  });

  function computeSemanticTokens(textDocument: TextDocument): SemanticTokens {
    const cached = tokensCache.get(textDocument.uri);
    if (cached && cached.version === textDocument.version) {
      return cached.tokens;
    }

    const builder = new SemanticTokensBuilder();
    const text = textDocument.getText();

    // STEP files use regex-based semantic tokens
    if (textDocument.uri.match(/\.(step|stp|p21)$/i)) {
      return computeStepSemanticTokens(builder, text);
    }

    // CFD configuration files use dedicated semantic tokens
    if (textDocument.uri.match(/\.(cfg|cfgt|su2|cfd)($|\?|#)/i) || textDocument.languageId === "cfd") {
      return computeCfdSemanticTokens(builder, text);
    }

    // FEA input deck files use dedicated semantic tokens
    if (textDocument.uri.match(/\.(inp|inpt|bdf|fea)($|\?|#)/i) || textDocument.languageId === "fea") {
      return computeFeaSemanticTokens(builder, text);
    }

    // Fortran files use dedicated semantic tokens
    if (textDocument.uri.match(/\.(f|for|f77|f90|f95|f03|f08)($|\?|#)/i) || textDocument.languageId === "fortran") {
      const tokens = computeFortranSemanticTokens(builder, text);
      tokensCache.set(textDocument.uri, { version: textDocument.version, tokens });
      return tokens;
    }

    // OWL 2 ontology files use dedicated semantic tokens
    if (textDocument.uri.match(/\.(owl|owl2|ofn|fss|owx|ttl)($|\?|#)/i) || textDocument.languageId === "owl2") {
      const tokens = computeOwl2SemanticTokens(builder, text);
      tokensCache.set(textDocument.uri, { version: textDocument.version, tokens });
      return tokens;
    }

    // SysML2 files use a separate parser and node-type classification
    if (
      textDocument.uri.endsWith(".sysml") ||
      textDocument.uri.endsWith(".sysml2") ||
      textDocument.languageId === "sysml" ||
      textDocument.languageId === "sysml2"
    ) {
      return computeSysML2SemanticTokens(builder, text, getSysml2Parser, isSysml2ParserReady);
    }

    const docTree = getDocumentTree(textDocument.uri);
    let tree: any = (docTree as any)?.tree ?? docTree;
    const treeText = (docTree as any)?.text ?? tree?.sourceCode;
    let ownsFallbackTree = false;

    if ((!tree || !tree.rootNode || (treeText && treeText !== text)) && parseFallback) {
      try {
        const fallbackTree = parseFallback(
          textDocument.uri.endsWith(".sysml") || textDocument.uri.endsWith(".sysml2") ? ".sysml" : ".mo",
          text,
        ) as any;
        if (fallbackTree) {
          tree = fallbackTree.tree ?? fallbackTree;
          ownsFallbackTree = true;
        }
      } catch {
        // fallback to old tree, but it will cause invalid tokens
      }
    }

    if (!tree || !tree.rootNode) {
      return builder.build();
    }

    const rawTokens: {
      line: number;
      char: number;
      length: number;
      typeIndex: number;
      modifier: number;
    }[] = [];

    const seenTokens = new Set<string>();
    const plugin = globalLanguageRegistry.getPluginForUri(textDocument.uri);
    const typeKws = (plugin?.monarch?.typeKeywords as string[]) ?? DEFAULT_TYPE_KEYWORDS;

    const traverseTree = (node: any) => {
      let tokenType: string | null = null;
      let modifier = 0;

      if (node.type === "IDENT" || node.type === "identifier") {
        const parent = node.parent;
        let p = parent;
        while (p && (p.type === "Name" || p.type === "name" || p.type === "component_reference")) {
          p = p.parent;
        }

        let inError = false;
        let curr = node.parent;
        while (curr) {
          if (curr.type === "ERROR" || curr.isError) {
            inError = true;
            break;
          }
          curr = curr.parent;
        }

        if (typeKws.includes(node.text)) {
          tokenType = "type";
        } else if (inError) {
          tokenType = "variable";
        } else if (
          p?.type === "LongClassSpecifier" ||
          p?.type === "long_class_specifier" ||
          p?.type === "ShortClassSpecifier" ||
          p?.type === "short_class_specifier" ||
          p?.type === "DerClassSpecifier" ||
          p?.type === "der_class_specifier"
        ) {
          tokenType = "class";
          modifier = 1; // declaration
        } else if (
          p?.type === "WithinDirective" ||
          p?.type === "within_clause" ||
          p?.type === "ExtendsClause" ||
          p?.type === "extends_clause" ||
          p?.type === "TypeSpecifier" ||
          p?.type === "type_specifier"
        ) {
          tokenType = "type";
        } else if (p?.type === "Declaration" || p?.type === "component_declaration" || p?.type === "declaration") {
          let clause = p;
          while (clause && clause.type !== "component_clause" && clause.type !== "element") {
            clause = clause.parent;
          }
          const clauseText = clause?.text || "";
          if (/\bparameter\b/.test(clauseText)) {
            tokenType = "parameter";
          } else {
            tokenType = "variable";
          }
          modifier = 1; // declaration
        } else if (
          parent?.type === "function_call" ||
          p?.type === "function_call" ||
          parent?.type === "function_call_args"
        ) {
          tokenType = "function";
        } else {
          tokenType = "variable";
        }
      } else if (node.type === "STRING" || node.type === "string_literal" || node.type === "description_string") {
        tokenType = "string";
      } else if (
        node.type === "UNSIGNED_INTEGER" ||
        node.type === "UNSIGNED_REAL" ||
        node.type === "unsigned_integer" ||
        node.type === "unsigned_real"
      ) {
        tokenType = "number";
      } else if (node.type === "comment" || node.type === "line_comment" || node.type === "block_comment") {
        tokenType = "comment";
      } else if (["+", "-", "*", "/", "=", "<", ">", "<=", ">=", "==", "<>", "!="].includes(node.type)) {
        tokenType = "operator";
      }

      if (tokenType !== null) {
        const typeIndex = tokenTypes.indexOf(tokenType);
        if (typeIndex >= 0) {
          if (node.startPosition.row === node.endPosition.row) {
            const length = node.endPosition.column - node.startPosition.column;
            if (length > 0 && !seenTokens.has(`${node.startPosition.row}:${node.startPosition.column}`)) {
              seenTokens.add(`${node.startPosition.row}:${node.startPosition.column}`);
              rawTokens.push({
                line: node.startPosition.row,
                char: node.startPosition.column,
                length,
                typeIndex,
                modifier,
              });
            }
          } else if (node.startPosition.row < node.endPosition.row) {
            const lines = (node.text || "").split("\n");
            for (let i = 0; i < lines.length; i++) {
              const lineNum = node.startPosition.row + i;
              const charStart = i === 0 ? node.startPosition.column : 0;
              const length = lines[i].length;
              if (length > 0 && !seenTokens.has(`${lineNum}:${charStart}`)) {
                seenTokens.add(`${lineNum}:${charStart}`);
                rawTokens.push({
                  line: lineNum,
                  char: charStart,
                  length,
                  typeIndex,
                  modifier,
                });
              }
            }
          }
        }
      }

      for (const child of node.children || []) {
        traverseTree(child);
      }
    };

    try {
      traverseTree(tree.rootNode);
    } finally {
      if (ownsFallbackTree) {
        tree.delete?.();
      }
    }

    rawTokens.sort((a, b) => {
      if (a.line === b.line) {
        return a.char - b.char;
      }
      return a.line - b.line;
    });

    let lastLine = -1;
    let lastEndChar = -1;
    for (const token of rawTokens) {
      if (token.line > lastLine) {
        lastLine = token.line;
        lastEndChar = token.char + token.length;
        builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
      } else if (token.char >= lastEndChar) {
        lastEndChar = token.char + token.length;
        builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
      }
    }

    const result = builder.build();
    tokensCache.set(textDocument.uri, { version: textDocument.version, tokens: result });
    return result;
  }

  connection.onRequest("textDocument/semanticTokens/full", (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return { data: [] };
    }
    return computeSemanticTokens(document);
  });
}
