// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SysML2 diagram-to-code edit computation.
// Produces LSP TextEdit arrays for inserting, modifying, and deleting
// SysML2 elements and connections in `.sysml` source text.

import { Range, TextEdit } from "vscode-languageserver";

// ── SysML2 Code Generation Templates ──

const INDENT = "  ";

/**
 * Maps SysML2 element type keys to source code snippet generators.
 */
const ELEMENT_TEMPLATES: Record<string, (name: string, indent: string) => string> = {
  // Structural
  PartDefinition: (name, ind) => `${ind}part def ${name} {\n${ind}}\n`,
  PartUsage: (name, ind) => `${ind}part ${name};\n`,
  AttributeDefinition: (name, ind) => `${ind}attribute def ${name} {\n${ind}}\n`,
  AttributeUsage: (name, ind) => `${ind}attribute ${name};\n`,
  PortDefinition: (name, ind) => `${ind}port def ${name} {\n${ind}}\n`,
  PortUsage: (name, ind) => `${ind}port ${name};\n`,
  ItemDefinition: (name, ind) => `${ind}item def ${name} {\n${ind}}\n`,
  ItemUsage: (name, ind) => `${ind}item ${name};\n`,
  EnumerationDefinition: (name, ind) => `${ind}enum def ${name} {\n${ind}}\n`,

  // Behavioral
  ActionDefinition: (name, ind) => `${ind}action def ${name} {\n${ind}}\n`,
  ActionUsage: (name, ind) => `${ind}action ${name};\n`,
  StateDefinition: (name, ind) => `${ind}state def ${name} {\n${ind}}\n`,
  StateUsage: (name, ind) => `${ind}state ${name};\n`,
  CalculationDefinition: (name, ind) => `${ind}calc def ${name} {\n${ind}}\n`,
  CalculationUsage: (name, ind) => `${ind}calc ${name};\n`,

  // Requirements
  RequirementDefinition: (name, ind) => `${ind}requirement def ${name} {\n${ind}}\n`,
  RequirementUsage: (name, ind) => `${ind}requirement ${name};\n`,
  ConcernDefinition: (name, ind) => `${ind}concern def ${name} {\n${ind}}\n`,
  ConcernUsage: (name, ind) => `${ind}concern ${name};\n`,
  ConstraintDefinition: (name, ind) => `${ind}constraint def ${name} {\n${ind}}\n`,
  ConstraintUsage: (name, ind) => `${ind}constraint ${name};\n`,

  // Analysis
  UseCaseDefinition: (name, ind) => `${ind}use case def ${name} {\n${ind}}\n`,
  UseCaseUsage: (name, ind) => `${ind}use case ${name};\n`,
  AnalysisCaseDefinition: (name, ind) => `${ind}analysis case def ${name} {\n${ind}}\n`,
  AnalysisCaseUsage: (name, ind) => `${ind}analysis case ${name};\n`,
  VerificationCaseDefinition: (name, ind) => `${ind}verification def ${name} {\n${ind}}\n`,
  VerificationCaseUsage: (name, ind) => `${ind}verification ${name};\n`,
  CaseDefinition: (name, ind) => `${ind}case def ${name} {\n${ind}}\n`,
  CaseUsage: (name, ind) => `${ind}case ${name};\n`,

  // Interconnection
  ConnectionDefinition: (name, ind) => `${ind}connection def ${name} {\n${ind}}\n`,
  InterfaceDefinition: (name, ind) => `${ind}interface def ${name} {\n${ind}}\n`,
  AllocationDefinition: (name, ind) => `${ind}allocation def ${name} {\n${ind}}\n`,
  FlowDefinition: (name, ind) => `${ind}flow def ${name} {\n${ind}}\n`,

  // Views
  ViewDefinition: (name, ind) => `${ind}view def ${name} {\n${ind}}\n`,
  ViewUsage: (name, ind) => `${ind}view ${name};\n`,
  ViewpointDefinition: (name, ind) => `${ind}viewpoint def ${name} {\n${ind}}\n`,
  ViewpointUsage: (name, ind) => `${ind}viewpoint ${name};\n`,
  RenderingDefinition: (name, ind) => `${ind}rendering def ${name} {\n${ind}}\n`,
  RenderingUsage: (name, ind) => `${ind}rendering ${name};\n`,

  // Meta
  OccurrenceDefinition: (name, ind) => `${ind}occurrence def ${name} {\n${ind}}\n`,
};

// ── Insert new element ──

/**
 * Insert a new SysML2 element declaration at the appropriate position.
 * Finds the nearest enclosing body `{ ... }` and inserts before the closing `}`.
 */
export function computeSysML2ElementInsert(
  docText: string,
  elementType: string,
  elementName: string,
  insertionLine?: number,
): TextEdit[] {
  const lines = docText.split("\n");
  const template = ELEMENT_TEMPLATES[elementType];
  if (!template) {
    // Fallback: generic part usage
    return computeSysML2ElementInsert(docText, "PartUsage", elementName, insertionLine);
  }

  // Find the best insertion point
  let targetLine: number;
  let indent: string;

  if (insertionLine !== undefined && insertionLine >= 0 && insertionLine < lines.length) {
    targetLine = insertionLine;
    indent = getIndentAt(lines, targetLine);
  } else {
    // Find the last closing `}` in the document (end of the outermost package body)
    targetLine = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === "}") {
        targetLine = i;
        break;
      }
    }
    if (targetLine === -1) {
      // No closing brace found — append at end
      targetLine = lines.length;
      indent = INDENT;
    } else {
      // Indent one level deeper than the closing brace
      const braceIndent = lines[targetLine].match(/^(\s*)/)?.[1] ?? "";
      indent = braceIndent + INDENT;
    }
  }

  const snippet = template(elementName, indent);
  return [TextEdit.insert({ line: targetLine, character: 0 }, snippet + "\n")];
}

// ── Delete element ──

/**
 * Delete a SysML2 element by finding its declaration in the source text.
 * Scans for lines matching `keyword name` patterns.
 */
export function computeSysML2ElementDelete(docText: string, elementNames: string[]): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];
  const nameSet = new Set(elementNames);

  for (const name of nameSet) {
    // Find lines declaring this element
    const { startLine, endLine } = findElementRange(lines, name);
    if (startLine === -1) continue;

    // Delete the range (including trailing newline)
    if (endLine + 1 < lines.length) {
      edits.push(TextEdit.del(Range.create(startLine, 0, endLine + 1, 0)));
    } else {
      edits.push(TextEdit.del(Range.create(startLine, 0, endLine, lines[endLine]?.length ?? 0)));
    }
  }

  // Also delete connection usages that reference deleted elements
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("connection") && line.includes("connect")) {
      // Check if any deleted element is referenced
      for (const name of nameSet) {
        if (line.includes(name)) {
          // Find the full extent of this connection usage
          const { startLine: cs, endLine: ce } = findStatementRange(lines, i);
          if (ce + 1 < lines.length) {
            edits.push(TextEdit.del(Range.create(cs, 0, ce + 1, 0)));
          } else {
            edits.push(TextEdit.del(Range.create(cs, 0, ce, lines[ce]?.length ?? 0)));
          }
          break;
        }
      }
    }
  }

  return deduplicateAndSort(edits);
}

// ── Insert connection ──

/**
 * Insert a `connection` usage connecting two elements.
 */
export function computeSysML2ConnectionInsert(docText: string, source: string, target: string): TextEdit[] {
  const lines = docText.split("\n");

  // Find insertion point — before the last `}` of the enclosing body
  let targetLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "}") {
      targetLine = i;
      break;
    }
  }
  if (targetLine === -1) targetLine = lines.length;

  const braceIndent = lines[targetLine]?.match(/^(\s*)/)?.[1] ?? "";
  const indent = braceIndent + INDENT;

  // Generate a connection name from source and target
  const connName = `${source}_to_${target}`;
  const snippet = `${indent}connection ${connName} : Connect\n${indent}${INDENT}connect ${source} to ${target};\n\n`;

  return [TextEdit.insert({ line: targetLine, character: 0 }, snippet)];
}

// ── Delete connection ──

/**
 * Delete a connection usage by finding matching `connect source to target` text.
 */
export function computeSysML2ConnectionDelete(docText: string, source: string, target: string): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match both `connect source to target` and `connect target to source`
    if (
      line.includes("connect") &&
      ((line.includes(source) && line.includes(target)) || (line.includes(target) && line.includes(source)))
    ) {
      const { startLine, endLine } = findStatementRange(lines, i);
      if (endLine + 1 < lines.length) {
        edits.push(TextEdit.del(Range.create(startLine, 0, endLine + 1, 0)));
      } else {
        edits.push(TextEdit.del(Range.create(startLine, 0, endLine, lines[endLine]?.length ?? 0)));
      }
    }
  }

  return deduplicateAndSort(edits);
}

// ── Update Component Name ──

export function computeSysML2NameEdit(tree: unknown, docText: string, oldName: string, newName: string): TextEdit[] {
  const edits: TextEdit[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findName(node: any) {
    if (
      (node.type === "Name" || node.type === "Identifier" || node.type.includes("Identification")) &&
      node.text === oldName
    ) {
      if (
        node.parent?.type.includes("Usage") ||
        node.parent?.type.includes("Def") ||
        node.parent?.type.includes("Declaration")
      ) {
        edits.push(
          TextEdit.replace(
            Range.create(
              node.startPosition.row,
              node.startPosition.column,
              node.endPosition.row,
              node.endPosition.column,
            ),
            newName,
          ),
        );
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      findName(node.namedChild(i));
    }
  }

  if (tree && (tree as Record<string, unknown>).rootNode) {
    findName((tree as Record<string, unknown>).rootNode);
  }

  if (edits.length === 0) {
    // Fallback regex replacement
    const lines = docText.split("\n");
    const pattern = new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g");
    lines.forEach((line, i) => {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        edits.push(TextEdit.replace(Range.create(i, match.index, i, match.index + oldName.length), newName));
      }
    });
  }

  return deduplicateAndSort(edits);
}

// ── Update Component Description ──

export function computeSysML2DescriptionEdit(
  tree: unknown,
  docText: string,
  elementName: string,
  newDescription: string,
): TextEdit[] {
  const edits: TextEdit[] = [];
  const lines = docText.split("\n");
  const { startLine, endLine } = findElementRange(lines, elementName);
  if (startLine === -1) return [];

  const escapedDesc = newDescription.replace(/\*\//g, "* /");
  const docString = `doc /* ${escapedDesc} */`;

  // Check if there is an existing doc inside the element body
  for (let i = startLine; i <= endLine; i++) {
    if (lines[i].includes("doc /*") || lines[i].match(/^\s*doc\s+/)) {
      const docStart = lines[i].indexOf("doc");
      const docEndIdx = lines[i].indexOf("*/");
      if (docEndIdx !== -1) {
        edits.push(TextEdit.replace(Range.create(i, docStart, i, docEndIdx + 2), docString));
        return edits;
      }
    }
  }

  // If no existing doc, if it's a block with `{`, insert after `{`
  const declLine = lines[startLine];
  if (declLine.includes("{")) {
    const braceCol = declLine.indexOf("{");
    edits.push(
      TextEdit.insert(
        { line: startLine, character: braceCol + 1 },
        `\n${getIndentAt(lines, startLine)}${INDENT}${docString}`,
      ),
    );
  } else {
    const semiCol = declLine.indexOf(";");
    if (semiCol !== -1) {
      edits.push(TextEdit.replace(Range.create(startLine, semiCol, startLine, semiCol + 1), ` { ${docString} }`));
    }
  }

  return edits;
}

// ── Update Component Parameter ──

export function computeSysML2ParameterEdit(
  tree: unknown,
  docText: string,
  elementName: string,
  parameterName: string,
  newValue: string,
): TextEdit[] {
  const edits: TextEdit[] = [];
  const lines = docText.split("\n");
  const { startLine, endLine } = findElementRange(lines, elementName);
  if (startLine === -1) return [];

  let paramLineIdx = -1;
  // A common syntax for redefinition in usages is `:>> param = value;`
  for (let i = startLine; i <= endLine; i++) {
    if (lines[i].includes(`:>> ${parameterName}`) || lines[i].includes(` ${parameterName} =`)) {
      paramLineIdx = i;
      // E.g. `:>> p = 6;`
      const match = lines[i].match(new RegExp(`(:>>\\s*${escapeRegex(parameterName)}\\s*=\\s*)[^;]+(;)`));
      if (match) {
        const repStart = lines[i].indexOf(match[0]);
        edits.push(
          TextEdit.replace(
            Range.create(i, repStart, i, repStart + match[0].length),
            `${match[1]}${newValue}${match[2]}`,
          ),
        );
        return edits;
      }
    }
  }

  // Insert if missing
  if (paramLineIdx === -1) {
    const declLine = lines[startLine];
    const paramStr = `:>> ${parameterName} = ${newValue};`;
    if (declLine.includes("{")) {
      const braceCol = declLine.indexOf("{");
      edits.push(
        TextEdit.insert(
          { line: startLine, character: braceCol + 1 },
          `\n${getIndentAt(lines, startLine)}${INDENT}${paramStr}`,
        ),
      );
    } else {
      const semiCol = declLine.indexOf(";");
      if (semiCol !== -1) {
        edits.push(TextEdit.replace(Range.create(startLine, semiCol, startLine, semiCol + 1), ` { ${paramStr} }`));
      }
    }
  }

  return edits;
}

// ── Unique name generation ──

/**
 * Generate a unique name for a new element by appending an incrementing suffix.
 */
export function generateUniqueName(docText: string, baseName: string): string {
  let suffix = 1;
  let candidate = baseName;
  while (docText.includes(candidate)) {
    candidate = `${baseName}${suffix}`;
    suffix++;
  }
  return candidate;
}

// ── Helpers ──

/**
 * Find the line range of an element declaration by searching for its name.
 */
function findElementRange(lines: string[], name: string): { startLine: number; endLine: number } {
  // SysML2 keywords that precede element names
  const keywords = [
    "part def",
    "part",
    "attribute def",
    "attribute",
    "port def",
    "port",
    "action def",
    "action",
    "state def",
    "state",
    "calc def",
    "calc",
    "requirement def",
    "requirement",
    "constraint def",
    "constraint",
    "use case def",
    "use case",
    "verification def",
    "verification",
    "analysis case def",
    "analysis case",
    "case def",
    "case",
    "connection def",
    "connection",
    "interface def",
    "interface",
    "allocation def",
    "allocation",
    "flow def",
    "flow",
    "item def",
    "item",
    "enum def",
    "concern def",
    "concern",
    "view def",
    "view",
    "viewpoint def",
    "viewpoint",
    "rendering def",
    "rendering",
    "occurrence def",
    "package",
  ];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    for (const kw of keywords) {
      // Match: keyword name { or keyword name ;
      const pattern = new RegExp(`^${kw.replace(/ /g, "\\s+")}\\s+${escapeRegex(name)}\\s*[{;]`);
      if (pattern.test(trimmed)) {
        // Found the declaration start
        if (trimmed.endsWith(";")) {
          return { startLine: i, endLine: i };
        }
        // Find matching closing brace
        const endLine = findMatchingBrace(lines, i);
        return { startLine: i, endLine };
      }
    }
  }

  return { startLine: -1, endLine: -1 };
}

/**
 * Find the statement range starting at a given line (handles multi-line statements).
 */
function findStatementRange(lines: string[], startLine: number): { startLine: number; endLine: number } {
  let endLine = startLine;
  // Walk backwards to find statement start (if the current line is a continuation)
  let line = lines[startLine].trim();
  while (
    startLine > 0 &&
    !line.match(
      /^(part|attribute|port|action|state|calc|requirement|constraint|use case|verification|analysis case|case|connection|interface|allocation|flow|item|enum|concern|view|viewpoint|rendering|occurrence|package|import)\b/,
    )
  ) {
    startLine--;
    line = lines[startLine].trim();
  }

  // Walk forward to find the statement end (`;` or matching `}`)
  if (lines[endLine]?.trim().includes("{")) {
    endLine = findMatchingBrace(lines, endLine);
  } else {
    while (endLine < lines.length - 1 && !lines[endLine].trim().endsWith(";")) {
      endLine++;
    }
  }

  return { startLine, endLine };
}

/**
 * Find the line with the matching closing brace for an opening brace on the given line.
 */
function findMatchingBrace(lines: string[], startLine: number): number {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return startLine; // fallback
}

/**
 * Get the indentation string at a given line.
 */
function getIndentAt(lines: string[], line: number): string {
  if (line < 0 || line >= lines.length) return INDENT;
  return lines[line].match(/^(\s*)/)?.[1] ?? "";
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sort edits by position and remove overlapping edits.
 */
function deduplicateAndSort(edits: TextEdit[]): TextEdit[] {
  edits.sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    return a.range.start.character - b.range.start.character;
  });

  return edits.filter((edit, i) => {
    if (i === 0) return true;
    const prev = edits[i - 1];
    return !(
      edit.range.start.line < prev.range.end.line ||
      (edit.range.start.line === prev.range.end.line && edit.range.start.character < prev.range.end.character)
    );
  });
}
