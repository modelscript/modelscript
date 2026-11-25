// SPDX-License-Identifier: AGPL-3.0-or-later

const TOKEN_TYPE_INDEX = new Map<string, number>([
  ["keyword", 0],
  ["type", 1],
  ["class", 2],
  ["variable", 3],
  ["parameter", 4],
  ["function", 5],
  ["string", 6],
  ["number", 7],
  ["operator", 8],
  ["comment", 9],
  ["namespace", 10],
  ["enumMember", 11],
]);

interface CstNodeLike {
  type: string;
  text?: string;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  parent?: CstNodeLike | null;
  children?: readonly CstNodeLike[];
  childCount?: number;
}

class TokenCollector {
  private readonly rawTokens: Array<{
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }> = [];
  private readonly seenPositions = new Set<string>();

  public push(line: number, char: number, length: number, typeName: string, modifier = 0): void {
    if (length <= 0 || line < 0 || char < 0) return;
    const typeIndex = TOKEN_TYPE_INDEX.get(typeName);
    if (typeIndex === undefined) return;
    const key = `${line}:${char}`;
    if (this.seenPositions.has(key)) return;
    this.seenPositions.add(key);
    this.rawTokens.push({ line, char, length, typeIndex, modifier });
  }

  public pushNode(node: CstNodeLike | null | undefined, typeName: string, modifier = 0): void {
    const start = node?.startPosition;
    const end = node?.endPosition;
    if (!start || !end) return;
    if (start.row === end.row) {
      this.push(start.row, start.column, end.column - start.column, typeName, modifier);
      return;
    }
    const text = String(node.text ?? "");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]!;
      const len = rawLine.endsWith("\r") ? rawLine.length - 1 : rawLine.length;
      if (len > 0) this.push(start.row + i, i === 0 ? start.column : 0, len, typeName, modifier);
    }
  }

  public buildData(): number[] {
    this.rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
    const data: number[] = [];
    let lastLine = -1;
    let lastEndChar = -1;
    let prevLine = 0;
    let prevChar = 0;
    for (const token of this.rawTokens) {
      if (token.line > lastLine || token.char >= lastEndChar) {
        lastLine = token.line;
        lastEndChar = token.char + token.length;
        const deltaLine = token.line - prevLine;
        const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;
        data.push(deltaLine, deltaChar, token.length, token.typeIndex, token.modifier);
        prevLine = token.line;
        prevChar = token.char;
      }
    }
    return data;
  }
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

interface Sysml2SemanticNode {
  type: string;
  text: string;
  childCount: number;
  parent?: Sysml2SemanticNode | null;
  children?: Sysml2SemanticNode[];
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

interface Sysml2SemanticTree {
  rootNode?: Sysml2SemanticNode | null;
  delete?(): void;
}

/**
 * Computes LSP delta-encoded semantic token data for SysML v2 documents.
 */
export function computeSysML2SemanticTokensData(
  text: string,
  tree?: Sysml2SemanticTree | null,
  parser?: { parse(input: string): Sysml2SemanticTree } | null,
): number[] {
  let ownedTree = false;
  let activeTree = tree;
  if (!activeTree?.rootNode && parser) {
    try {
      activeTree = parser.parse(text);
      ownedTree = true;
    } catch {
      return [];
    }
  }
  if (!activeTree?.rootNode) return [];

  const collector = new TokenCollector();

  const traverse = (node: Sysml2SemanticNode) => {
    let tokenType: string | null = null;
    let modifier = 0;

    const nodeType = node.type;
    const nodeText = node.text;

    if (nodeType === "declaredName" || nodeType === "name") {
      const parent = node.parent;
      if (parent && definitionTypes.has(parent.type)) {
        tokenType = "type";
        modifier = 1;
      } else if (parent && usageTypes.has(parent.type)) {
        tokenType = "variable";
        modifier = 1;
      } else if (parent?.type === "Package" || parent?.type === "LibraryPackage") {
        tokenType = "namespace";
        modifier = 1;
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
      collector.pushNode(node, tokenType, modifier);
    }

    for (const child of node.children || []) {
      traverse(child);
    }
  };

  try {
    traverse(activeTree.rootNode);
  } finally {
    if (ownedTree) {
      (activeTree as { delete?(): void }).delete?.();
    }
  }

  return collector.buildData();
}
