// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Diagram-to-code edit computation.
// Ported from morsel's morsel.tsx (getPlacementEdit, getConnectEdits,
// handleEdgeDelete, handleComponentsDelete) to produce LSP TextEdit arrays.

import type { ModelicaClassInstance } from "@modelscript/core";
import { Range, TextEdit } from "vscode-languageserver";

// ── Interfaces ──

export interface PlacementItem {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  edges?: EdgeItem[];
}

export interface EdgeItem {
  source: string;
  target: string;
  points: { x: number; y: number }[];
}

// ── Placement edits (move / resize / rotate) ──

export function computePlacementEdits(
  docText: string,
  classInstance: ModelicaClassInstance,
  items: PlacementItem[],
): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];
  const allEdges: EdgeItem[] = [];

  for (const item of items) {
    const edit = getPlacementEdit(lines, classInstance, item);
    if (edit) edits.push(edit);
    if (item.edges) allEdges.push(...item.edges);
  }

  if (allEdges.length > 0) {
    const edgeEdits = computeEdgePointEdits(lines, classInstance, allEdges);
    edits.push(...edgeEdits);
  }

  return deduplicateAndSort(edits);
}

function getPlacementEdit(lines: string[], classInstance: ModelicaClassInstance, item: PlacementItem): TextEdit | null {
  const component = Array.from(classInstance.components).find((c) => c.name === item.name);
  if (!component) return null;

  const originX = Math.round(item.x + item.width / 2);
  const originY = Math.round(-(item.y + item.height / 2));
  const w = Math.round(item.width);
  const h = Math.round(item.height);
  const r = Math.round(-(item.rotation ?? 0));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const abstractNode = (component as any).abstractSyntaxNode;
  if (!abstractNode?.sourceRange) return null;

  const startLine = abstractNode.startPosition.row;
  const startCol = abstractNode.startPosition.column;
  const endLine = abstractNode.endPosition.row;
  const endCol = abstractNode.endPosition.column;

  const range = Range.create(startLine, startCol, endLine, endCol);
  const text = getTextInRange(lines, startLine, startCol, endLine, endCol);

  // Validate extracted text contains the component name (guards against stale AST)
  if (!text.includes(item.name)) return null;

  const rotationPart = r !== 0 ? `, rotation=${r}` : "";

  // Detect flip from the original extent in the source text
  let flipX = false;
  let flipY = false;
  const extentMatch = text.match(/extent\s*=\s*\{\{\s*([^,]+)\s*,\s*([^}]+)\}\s*,\s*\{\s*([^,]+)\s*,\s*([^}]+)\}\}/);
  if (extentMatch) {
    const [, x1s, y1s, x2s, y2s] = extentMatch;
    const ox1 = parseFloat(x1s);
    const oy1 = parseFloat(y1s);
    const ox2 = parseFloat(x2s);
    const oy2 = parseFloat(y2s);
    if (!isNaN(ox1) && !isNaN(ox2)) flipX = ox1 > ox2;
    if (!isNaN(oy1) && !isNaN(oy2)) flipY = oy1 > oy2;
  }

  const ex1 = flipX ? w / 2 : -(w / 2);
  const ex2 = flipX ? -(w / 2) : w / 2;
  const ey1 = flipY ? h / 2 : -(h / 2);
  const ey2 = flipY ? -(h / 2) : h / 2;
  const newTransformationCore = `origin={${originX},${originY}}, extent={{${ex1},${ey1}},{${ex2},${ey2}}}${rotationPart}`;
  const newPlacement = `Placement(transformation(${newTransformationCore}))`;

  const annotationMatch = text.match(/annotation\s*\(/);
  if (annotationMatch) {
    const annStart = annotationMatch.index ?? 0;
    const annContentStart = annStart + annotationMatch[0].length;
    const annEndIndex = findMatchingParen(text, annContentStart);

    if (annEndIndex !== -1) {
      let annotationContent = text.substring(annContentStart, annEndIndex);

      // Remove any existing Placement(...) from annotation content
      const placementMatch = annotationContent.match(/Placement\s*\(/);
      if (placementMatch) {
        const pStart = placementMatch.index ?? 0;
        const pInner = pStart + placementMatch[0].length;
        const pEnd = findMatchingParen(annotationContent, pInner);
        if (pEnd !== -1) {
          const before = annotationContent.substring(0, pStart);
          const after = annotationContent.substring(pEnd + 1);
          if (before.trimEnd().endsWith(",")) {
            annotationContent = before.trimEnd().slice(0, -1).trimEnd() + after;
          } else if (after.trimStart().startsWith(",")) {
            annotationContent = before + after.trimStart().slice(1).trimStart();
          } else {
            annotationContent = before + after;
          }
        }
      }

      // Re-insert Placement with new data
      const trimmed = annotationContent.trim();
      const separator = trimmed.length > 0 ? ", " : "";
      const newText =
        text.substring(0, annContentStart) + newPlacement + separator + trimmed + text.substring(annEndIndex);
      if (newText !== text) {
        return TextEdit.replace(range, newText);
      }
    }
  } else {
    const semiIndex = text.lastIndexOf(";");
    if (semiIndex !== -1) {
      const insert = ` annotation(${newPlacement})`;
      const newText = text.slice(0, semiIndex) + insert + text.slice(semiIndex);
      return TextEdit.replace(range, newText);
    } else {
      const insert = ` annotation(${newPlacement})`;
      const newText = text + insert;
      return TextEdit.replace(range, newText);
    }
  }
  return null;
}

// ── Add connect equation ──

export function computeConnectInsert(
  docText: string,
  classInstance: ModelicaClassInstance,
  source: string,
  target: string,
  points?: { x: number; y: number }[],
): TextEdit[] {
  const lines = docText.split("\n");

  const annotation = points
    ? ` annotation(Line(points={${points.map((p) => `{${p.x},${p.y}}`).join(", ")}}, color={0, 0, 255}))`
    : " annotation(Line(color={0, 0, 255}))";
  const connectEq = `  connect(${source}, ${target})${annotation};\n`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const astNode = (classInstance as any).abstractSyntaxNode;
  const modelStartLine = astNode?.sourceRange ? astNode.startPosition.row : 0;
  const modelEndLine = astNode?.sourceRange ? astNode.endPosition.row : lines.length - 1;

  // Look for "equation" keyword within the model range
  let equationLine = -1;
  for (let i = modelStartLine; i <= modelEndLine; i++) {
    if (lines[i].trim() === "equation" || lines[i].trim().startsWith("equation ")) {
      equationLine = i;
      break;
    }
  }

  if (equationLine !== -1) {
    // Find the right insertion point: before end/protected/initial/algorithm/annotation
    const keywords = ["public", "protected", "initial equation", "algorithm", "annotation", "end"];
    let insertLine = -1;
    for (let i = equationLine + 1; i <= modelEndLine; i++) {
      const line = lines[i].trim();
      if (keywords.some((kw) => line.startsWith(kw))) {
        insertLine = i;
        break;
      }
    }
    if (insertLine !== -1) {
      return [TextEdit.insert({ line: insertLine, character: 0 }, connectEq)];
    }
  }

  // Fallback: insert before "end" keyword
  for (let i = modelEndLine; i >= modelStartLine; i--) {
    if (lines[i].trim().startsWith("end")) {
      // Look backwards for annotation before end
      let insertLine = i;
      for (let j = i - 1; j >= modelStartLine; j--) {
        const line = lines[j].trim();
        if (line.startsWith("annotation")) {
          insertLine = j;
        } else if (line !== "") {
          break;
        }
      }
      const insertText = equationLine === -1 ? `equation\n${connectEq}` : connectEq;
      return [TextEdit.insert({ line: insertLine, character: 0 }, insertText)];
    }
  }

  return [];
}

// ── Remove connect equation ──

export function computeConnectRemove(
  docText: string,
  classInstance: ModelicaClassInstance,
  source: string,
  target: string,
): TextEdit[] {
  const lines = docText.split("\n");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectEq = Array.from(classInstance.connectEquations).find((ce: any) => {
    const c1 = ce.componentReference1?.parts
      .map((c: { identifier?: { text: string } }) => c.identifier?.text ?? "")
      .join(".");
    const c2 = ce.componentReference2?.parts
      .map((c: { identifier?: { text: string } }) => c.identifier?.text ?? "")
      .join(".");
    return (c1 === source && c2 === target) || (c1 === target && c2 === source);
  });

  if (!connectEq || !connectEq.sourceRange) return [];

  const startLine = connectEq.startPosition.row;
  const startCol = connectEq.startPosition.column;
  const endLine = connectEq.endPosition.row;
  const endCol = connectEq.endPosition.column;

  return [makeDeleteRange(lines, startLine, startCol, endLine, endCol)];
}

// ── Remove component(s) and their connect equations ──

export function computeComponentsDelete(
  docText: string,
  classInstance: ModelicaClassInstance,
  names: string[],
): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];
  const nameSet = new Set(names);

  // Remove connect equations involving these components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Array.from(classInstance.connectEquations).forEach((ce: any) => {
    const c1 = ce.componentReference1?.parts
      .map((c: { identifier?: { text: string } }) => c.identifier?.text ?? "")
      .join(".");
    const c2 = ce.componentReference2?.parts
      .map((c: { identifier?: { text: string } }) => c.identifier?.text ?? "")
      .join(".");
    const involvesComponent = [...nameSet].some(
      (name) => c1 === name || c1.startsWith(`${name}.`) || c2 === name || c2.startsWith(`${name}.`),
    );
    if (involvesComponent && ce.sourceRange) {
      edits.push(
        makeDeleteRange(
          lines,
          ce.startPosition.row,
          ce.startPosition.column,
          ce.endPosition.row,
          ce.endPosition.column,
        ),
      );
    }
  });

  // Remove component declarations
  for (const name of names) {
    const component = Array.from(classInstance.components).find((c) => c.name === name);
    if (!component) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = (component as any).abstractSyntaxNode?.parent;
    if (node?.sourceRange) {
      edits.push(
        makeDeleteRange(
          lines,
          node.startPosition.row,
          node.startPosition.column,
          node.endPosition.row,
          node.endPosition.column,
        ),
      );
    }
  }

  return deduplicateAndSort(edits);
}

// ── Update edge points (Line annotation on connect equations) ──

export function computeEdgePointEdits(
  lines: string[],
  classInstance: ModelicaClassInstance,
  edges: EdgeItem[],
): TextEdit[] {
  const edits: TextEdit[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectEq = Array.from(classInstance.connectEquations).find((ce: any) => {
      const c1 = ce.componentReference1?.parts
        .map((c: { identifier?: { text: string } }) => c.identifier?.text ?? "")
        .join(".");
      const c2 = ce.componentReference2?.parts
        .map((c: { identifier?: { text: string } }) => c.identifier?.text ?? "")
        .join(".");
      return (c1 === edge.source && c2 === edge.target) || (c1 === edge.target && c2 === edge.source);
    });

    if (!connectEq?.sourceRange) continue;

    const key = `${connectEq.startPosition.row}:${connectEq.startPosition.column}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const startLine = connectEq.startPosition.row;
    const startCol = connectEq.startPosition.column;
    const endLine = connectEq.endPosition.row;
    const endCol = connectEq.endPosition.column;

    const range = Range.create(startLine, startCol, endLine, endCol);
    const text = getTextInRange(lines, startLine, startCol, endLine, endCol);

    // Validate it's actually a connect equation
    if (!text.match(/^\s*connect\s*\(/)) continue;

    const pointsStr = `{${edge.points.map((p) => `{${p.x},${p.y}}`).join(", ")}}`;
    const newPointsCore = `points=${pointsStr}`;
    const colorCore = "color={0, 0, 255}";
    const newLineAnnotation = `Line(${newPointsCore}, ${colorCore})`;

    let newText = text;
    const annotationMatch = text.match(/annotation\s*\(/);
    if (annotationMatch) {
      const annStartIndex = annotationMatch.index ?? 0;
      const annContentStart = annStartIndex + annotationMatch[0].length;
      const annEndIndex = findMatchingParen(text, annContentStart);
      if (annEndIndex !== -1) {
        let annotationContent = text.substring(annContentStart, annEndIndex);

        // Remove any existing Line(...)
        const lineMatch = annotationContent.match(/Line\s*\(/);
        if (lineMatch) {
          const lineStart = lineMatch.index ?? 0;
          const lineInner = lineStart + lineMatch[0].length;
          const lineEnd = findMatchingParen(annotationContent, lineInner);
          if (lineEnd !== -1) {
            const before = annotationContent.substring(0, lineStart);
            const after = annotationContent.substring(lineEnd + 1);
            if (before.trimEnd().endsWith(",")) {
              annotationContent = before.trimEnd().slice(0, -1).trimEnd() + after;
            } else if (after.trimStart().startsWith(",")) {
              annotationContent = before + after.trimStart().slice(1).trimStart();
            } else {
              annotationContent = before + after;
            }
          }
        }

        // Re-insert Line with new data
        const trimmed = annotationContent.trim();
        const separator = trimmed.length > 0 ? ", " : "";
        newText =
          text.substring(0, annContentStart) + trimmed + separator + newLineAnnotation + text.substring(annEndIndex);
      }
    } else {
      // No annotation: insert before semicolon
      const semiIndex = text.lastIndexOf(";");
      const insert = ` annotation(${newLineAnnotation})`;
      if (semiIndex !== -1) {
        newText = text.slice(0, semiIndex) + insert + text.slice(semiIndex);
      }
    }

    if (newText !== text) {
      edits.push(TextEdit.replace(range, newText));
    }
  }

  return edits;
}

// ── Helpers ──

function findMatchingParen(text: string, openPos: number): number {
  let nesting = 0;
  for (let i = openPos; i < text.length; i++) {
    if (text[i] === "(") nesting++;
    else if (text[i] === ")") {
      if (nesting === 0) return i;
      nesting--;
    }
  }
  return -1;
}

function getTextInRange(lines: string[], startLine: number, startCol: number, endLine: number, endCol: number): string {
  if (startLine === endLine) {
    return lines[startLine]?.substring(startCol, endCol) ?? "";
  }
  const result: string[] = [];
  result.push(lines[startLine]?.substring(startCol) ?? "");
  for (let i = startLine + 1; i < endLine; i++) {
    result.push(lines[i] ?? "");
  }
  result.push(lines[endLine]?.substring(0, endCol) ?? "");
  return result.join("\n");
}

function makeDeleteRange(
  lines: string[],
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): TextEdit {
  // If the node is the only content on its line(s), delete the entire line(s)
  const prefix = (lines[startLine]?.substring(0, startCol) ?? "").trim();
  const suffix = (lines[endLine]?.substring(endCol) ?? "").trim();

  if (prefix === "" && suffix === "") {
    if (endLine + 1 < lines.length) {
      return TextEdit.del(Range.create(startLine, 0, endLine + 1, 0));
    } else {
      return TextEdit.del(Range.create(startLine, 0, endLine, lines[endLine]?.length ?? 0));
    }
  }

  return TextEdit.del(Range.create(startLine, startCol, endLine, endCol));
}

function deduplicateAndSort(edits: TextEdit[]): TextEdit[] {
  // Sort by position (ascending)
  edits.sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    return a.range.start.character - b.range.start.character;
  });

  // Remove overlapping edits
  return edits.filter((edit, i) => {
    if (i === 0) return true;
    const prev = edits[i - 1];
    if (
      edit.range.start.line < prev.range.end.line ||
      (edit.range.start.line === prev.range.end.line && edit.range.start.character < prev.range.end.character)
    ) {
      return false;
    }
    return true;
  });
}

// ── Component Property edits (Name, Description, Parameters) ──

export function computeNameEdit(classInstance: ModelicaClassInstance, oldName: string, newName: string): TextEdit[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component = Array.from(classInstance.components).find((c: any) => c.name === oldName);
  if (!component) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const abstractNode = (component as any).abstractSyntaxNode;
  const identNode = abstractNode?.declaration?.identifier;
  if (identNode?.sourceRange) {
    return [
      TextEdit.replace(
        Range.create(
          identNode.startPosition.row,
          identNode.startPosition.column,
          identNode.endPosition.row,
          identNode.endPosition.column,
        ),
        newName,
      ),
    ];
  }
  return [];
}

export function computeDescriptionEdit(
  docText: string,
  classInstance: ModelicaClassInstance,
  componentName: string,
  newDescription: string,
): TextEdit[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component = Array.from(classInstance.components).find((c: any) => c.name === componentName);
  if (!component) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const abstractNode = (component as any).abstractSyntaxNode;
  const descriptionNode = abstractNode?.description;
  const escapedDescription = newDescription.replace(/"/g, '""');

  if (descriptionNode?.sourceRange) {
    if (newDescription === "") {
      const lines = docText.split("\n");
      const descStartLine = descriptionNode.startPosition.row;
      const descStartCol = descriptionNode.startPosition.column;
      const descEndLine = descriptionNode.endPosition.row;
      const descEndCol = descriptionNode.endPosition.column;
      let removeStartCol = descStartCol;
      const lineContent = lines[descStartLine];
      let col = descStartCol - 1;
      while (col >= 0 && (lineContent[col] === " " || lineContent[col] === "\t")) {
        col--;
      }
      removeStartCol = col + 1;
      return [TextEdit.replace(Range.create(descStartLine, removeStartCol, descEndLine, descEndCol), "")];
    }
    return [
      TextEdit.replace(
        Range.create(
          descriptionNode.startPosition.row,
          descriptionNode.startPosition.column,
          descriptionNode.endPosition.row,
          descriptionNode.endPosition.column,
        ),
        `"${escapedDescription}"`, // no leading space when replacing
      ),
    ];
  } else {
    if (newDescription === "") return [];
    const identNode = abstractNode?.declaration?.identifier;
    const modificationNode = abstractNode?.declaration?.modification;
    const subscriptsNode = abstractNode?.declaration?.arraySubscripts;

    let pos = null;
    if (modificationNode?.sourceRange) {
      pos = modificationNode.endPosition;
    } else if (subscriptsNode?.sourceRange) {
      pos = subscriptsNode.endPosition;
    } else if (identNode?.sourceRange) {
      pos = identNode.endPosition;
    }

    if (pos) {
      return [TextEdit.insert({ line: pos.row, character: pos.column }, ` "${escapedDescription}"`)];
    }
  }
  return [];
}

export function computeParameterEdit(
  classInstance: ModelicaClassInstance,
  componentName: string,
  parameterName: string,
  newValue: string,
): TextEdit[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component = Array.from(classInstance.components).find((c: any) => c.name === componentName);
  if (!component) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const abstractNode = (component as any).abstractSyntaxNode;
  if (!abstractNode) return [];

  const declNode = abstractNode.declaration;
  const modification = declNode?.modification;

  const shouldRemove = newValue === "";

  if (modification?.classModification) {
    const classMod = modification.classModification;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const argIndex = classMod.modificationArguments.findIndex((arg: any) => {
      if (!arg.name) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nameText = arg.name.parts.map((p: any) => p.text).join(".");
      return nameText === parameterName;
    });

    if (argIndex !== -1) {
      const existingArg = classMod.modificationArguments[argIndex];
      if (shouldRemove) {
        let startLine = existingArg.startPosition.row;
        let startCol = existingArg.startPosition.column;
        let endLine = existingArg.endPosition.row;
        let endCol = existingArg.endPosition.column;

        const nextArg = classMod.modificationArguments[argIndex + 1];
        if (nextArg) {
          endLine = nextArg.startPosition.row;
          endCol = nextArg.startPosition.column;
        } else if (argIndex > 0) {
          const prevArg = classMod.modificationArguments[argIndex - 1];
          startLine = prevArg.endPosition.row;
          startCol = prevArg.endPosition.column;
        } else {
          // Only argument — remove the entire class modification
          return [
            TextEdit.replace(
              Range.create(
                classMod.startPosition.row,
                classMod.startPosition.column,
                classMod.endPosition.row,
                classMod.endPosition.column,
              ),
              "",
            ),
          ];
        }

        return [TextEdit.replace(Range.create(startLine, startCol, endLine, endCol), "")];
      }

      // Update existing argument value
      const existingMod = existingArg.modification;
      if (existingMod) {
        return [
          TextEdit.replace(
            Range.create(
              existingMod.startPosition.row,
              existingMod.startPosition.column,
              existingMod.endPosition.row,
              existingMod.endPosition.column,
            ),
            `=${newValue}`,
          ),
        ];
      } else {
        return [
          TextEdit.replace(
            Range.create(
              existingArg.startPosition.row,
              existingArg.startPosition.column,
              existingArg.endPosition.row,
              existingArg.endPosition.column,
            ),
            `${parameterName}=${newValue}`,
          ),
        ];
      }
    } else {
      // Add new argument to existing modification
      if (shouldRemove) return [];
      const hasArgs = classMod.modificationArguments.length > 0;
      const endPos = classMod.endPosition;
      return [
        TextEdit.insert(
          { line: endPos.row, character: endPos.column - 1 },
          `${hasArgs ? ", " : ""}${parameterName}=${newValue}`,
        ),
      ];
    }
  } else {
    // No existing modification — insert after identifier
    if (shouldRemove) return [];
    const identNode = declNode?.identifier;
    const subscriptsNode = declNode?.arraySubscripts;
    let pos = null;
    if (subscriptsNode?.sourceRange) {
      pos = subscriptsNode.endPosition;
    } else if (identNode?.sourceRange) {
      pos = identNode.endPosition;
    }

    if (pos) {
      return [TextEdit.insert({ line: pos.row, character: pos.column }, `(${parameterName}=${newValue})`)];
    }
  }
  return [];
}
