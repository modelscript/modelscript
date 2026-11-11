// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Diagram-to-code edit computation.
// Ported from morsel's morsel.tsx (getPlacementEdit, getConnectEdits,
// handleEdgeDelete, handleComponentsDelete) to produce LSP TextEdit arrays.

type ModelicaClassInstance = any;
import { CstUnparser } from "@modelscript/dsl";
import { Position, Range, TextEdit } from "vscode-languageserver";

import type { EdgeUpdate as EdgeItem, PlacementItem } from "@modelscript/diagram/protocol";
import { Cst } from "../../src-gen/bindings.js";
import { inferModelicaDomainColor } from "./data.js";
import {
  buildFallbackClassInstance,
  computeMinimalNonOverlappingEdits,
  findBalancedClose,
  healStrandedClassAnnotationsInText,
  maskModelicaCommentsAndStrings,
  offsetToPosition,
  scanModelicaClassLayout,
  type ScannedComponentDecl,
  type ScannedConnectStmt,
} from "./scanner.js";

export {
  buildFallbackClassInstance,
  computeMinimalNonOverlappingEdits,
  findBalancedClose,
  healStrandedClassAnnotationsInText,
  maskModelicaCommentsAndStrings,
  scanModelicaClassLayout,
};

function findDescendantModification(node: any, name: string): any {
  if (!node) return null;
  const isModificationNode =
    Cst.ElementModification.is(node) ||
    Cst.Argument.is(node) ||
    node.type === "element_modification" ||
    node.type === "argument" ||
    node.type === "named_argument" ||
    (typeof (Cst as any).kind === "function" &&
      ((Cst as any).kind(node) === "element_modification" || (Cst as any).kind(node) === "argument"));

  const nameRegex = new RegExp(`^${name}(?:[\\s(=]|$)`);
  const matchesName =
    nameRegex.test(node.text?.trimStart() ?? "") ||
    node.children?.some(
      (c: any) => (Cst.Identifier.is(c) || c.type === "identifier" || c.name === name) && c.text?.trim() === name,
    );

  if (isModificationNode && matchesName) {
    for (const ch of node.children || []) {
      const inner = findDescendantModification(ch, name);
      if (inner) return inner;
    }
    return node;
  }
  for (const ch of node.children || []) {
    const res = findDescendantModification(ch, name);
    if (res) return res;
  }
  return null;
}

function getNodeRange(node: any): { startLine: number; startCol: number; endLine: number; endCol: number } | null {
  if (!node) return null;
  if (node.startPosition && node.endPosition) {
    return {
      startLine: node.startPosition.row,
      startCol: node.startPosition.column,
      endLine: node.endPosition.row,
      endCol: node.endPosition.column,
    };
  }
  if (node.sourceRange) {
    const sr = node.sourceRange;
    return {
      startLine: sr.startPosition?.row ?? sr.startRow ?? 0,
      startCol: sr.startPosition?.column ?? sr.startCol ?? 0,
      endLine: sr.endPosition?.row ?? sr.endRow ?? 0,
      endCol: sr.endPosition?.column ?? sr.endCol ?? 0,
    };
  }
  return null;
}

function getConnectEquationStatementNode(connectEq: any): any {
  const rawNode = connectEq?.cstNode ?? connectEq?.ast;
  if (!rawNode) return null;
  const parent = rawNode.parent;
  if (parent && (Cst.SomeEquation.is(parent) || parent.type === "some_equation" || parent.type === "SomeEquation")) {
    return parent;
  }
  return rawNode;
}

/**
 * Expands a connect equation node range so that if the CST node only covers `connect(a, b)`
 * (for example when `.parent` is not populated on a `connect_equation` node), the range is
 * extended through any trailing description string and `annotation(...)` clause up to the
 * statement-terminating `;`.
 */
function expandConnectStatementRange(
  lines: string[],
  eqRange: { startLine: number; startCol: number; endLine: number; endCol: number },
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const rawText = getTextInRange(lines, eqRange.startLine, eqRange.startCol, eqRange.endLine, eqRange.endCol);
  if (rawText.trimEnd().endsWith(";")) {
    return eqRange;
  }

  let parenDepth = 0;
  let inString = false;
  let escaped = false;
  const maxLine = Math.min(lines.length - 1, eqRange.endLine + 30);

  for (let l = eqRange.endLine; l <= maxLine; l++) {
    const lineText = lines[l] ?? "";
    if (l > eqRange.endLine && parenDepth === 0 && !inString) {
      const trimmed = lineText.trim();
      if (
        trimmed.length > 0 &&
        !trimmed.startsWith("annotation") &&
        !trimmed.startsWith('"') &&
        !trimmed.startsWith(";") &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("/*")
      ) {
        return eqRange;
      }
    }

    const startC = l === eqRange.endLine ? eqRange.endCol : 0;
    for (let c = startC; c < lineText.length; c++) {
      const ch = lineText[c]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === "/" && lineText[c + 1] === "/") {
        break;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "(" || ch === "{" || ch === "[") {
        parenDepth++;
      } else if (ch === ")" || ch === "}" || ch === "]") {
        if (parenDepth > 0) parenDepth--;
      } else if (ch === ";" && parenDepth === 0) {
        return {
          startLine: eqRange.startLine,
          startCol: eqRange.startCol,
          endLine: l,
          endCol: c,
        };
      }
    }
  }

  return eqRange;
}

/**
 * Updates or inserts `points={...}` inside an existing `Line(...)` modification while preserving
 * all other existing `Line` attributes (such as `color`, `thickness`, `pattern`, `smooth`, `arrow`).
 */
function updateLineAnnotationText(
  existingLineText: string | null | undefined,
  newPointsCore: string,
  fallbackColorCore: string,
): string {
  if (!existingLineText) {
    return `Line(${newPointsCore}, ${fallbackColorCore})`;
  }
  const trimmed = existingLineText.trim();
  const lineMatch = trimmed.match(/^Line\s*\(/);
  if (!lineMatch || !trimmed.endsWith(")")) {
    return `Line(${newPointsCore}, ${fallbackColorCore})`;
  }

  const pointsMatch = trimmed.match(/\bpoints\s*=\s*\{/);
  if (pointsMatch && pointsMatch.index !== undefined) {
    const pStart = pointsMatch.index;
    const openBraceIdx = pStart + pointsMatch[0].length - 1;
    let depth = 0;
    let pEnd = -1;
    for (let i = openBraceIdx; i < trimmed.length; i++) {
      if (trimmed[i] === "{") depth++;
      else if (trimmed[i] === "}") {
        depth--;
        if (depth === 0) {
          pEnd = i;
          break;
        }
      }
    }
    if (pEnd !== -1) {
      return trimmed.slice(0, pStart) + newPointsCore + trimmed.slice(pEnd + 1);
    }
  }

  const innerStart = lineMatch[0].length;
  const innerContent = trimmed.slice(innerStart, -1).trim();
  if (innerContent.length === 0) {
    return `Line(${newPointsCore}, ${fallbackColorCore})`;
  }
  return `Line(${newPointsCore}, ${innerContent})`;
}

function getAnnotationClauseNode(node: any): any {
  if (!node) return null;
  if (node.annotationClause) return node.annotationClause;
  const findAnn = (n: any): any => {
    if (!n) return null;
    if (Cst.AnnotationClause.is(n)) return n;
    for (const ch of n.children || []) {
      const res = findAnn(ch);
      if (res) return res;
    }
    return null;
  };
  return findAnn(node);
}

function getDeclarationNode(node: any): any {
  if (!node) return null;
  if (node.declaration) return node.declaration;
  if (Cst.ComponentDeclaration.is(node)) {
    const cstDecl = Cst.ComponentDeclaration.declaration(node);
    if (cstDecl) return cstDecl;
  }
  const findDecl = (n: any): any => {
    if (!n) return null;
    if (Cst.Declaration.is(n)) return n;
    for (const ch of n.children || []) {
      const res = findDecl(ch);
      if (res) return res;
    }
    return null;
  };
  return findDecl(node);
}

function getDeclarationIdentNode(node: any): any {
  if (!node) return null;
  if (node.declaration?.identifier) return node.declaration.identifier;
  if (node.identifier) return node.identifier;
  const decl = getDeclarationNode(node) ?? node;
  if (Cst.Declaration.is(decl)) {
    const cstName = Cst.Declaration.name(decl);
    if (cstName) return cstName;
  }
  const findIdent = (n: any): any => {
    if (!n) return null;
    if (Cst.Identifier.is(n)) return n;
    for (const ch of n.children || []) {
      const res = findIdent(ch);
      if (res) return res;
    }
    return null;
  };
  return findIdent(decl);
}

function getModificationNode(node: any): any {
  if (!node) return null;
  const decl = getDeclarationNode(node) ?? node;
  if (decl.modification) return decl.modification;
  if (Cst.Declaration.is(decl)) {
    const cstMod = Cst.Declaration.modification(decl);
    if (cstMod) return cstMod;
  }
  const findMod = (n: any): any => {
    if (!n) return null;
    if (Cst.Modification.is(n)) return n;
    for (const ch of n.children || []) {
      const res = findMod(ch);
      if (res) return res;
    }
    return null;
  };
  return findMod(decl);
}

function getSubscriptsNode(node: any): any {
  if (!node) return null;
  const decl = getDeclarationNode(node) ?? node;
  if (decl.arraySubscripts) return decl.arraySubscripts;
  if (Cst.Declaration.is(decl)) {
    const cstSubs = Cst.Declaration.arraySubscripts(decl);
    if (cstSubs) return cstSubs;
  }
  const findSub = (n: any): any => {
    if (!n) return null;
    if (Cst.ArraySubscripts.is(n)) return n;
    for (const ch of n.children || []) {
      const res = findSub(ch);
      if (res) return res;
    }
    return null;
  };
  return findSub(decl);
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
    if (item.connectedOnly) {
      // Only add placement for connected components that don't already have one
      const edit = getPlacementEditIfMissing(lines, classInstance, item);
      if (edit) edits.push(edit);
    } else {
      const edit = getPlacementEdit(lines, classInstance, item);
      if (edit) edits.push(edit);
      if (item.edges) allEdges.push(...item.edges);
    }
  }

  if (allEdges.length > 0) {
    const edgeEdits = computeEdgePointEdits(lines, classInstance, allEdges);
    edits.push(...edgeEdits);
  }

  return deduplicateAndSort(edits);
}

function applyScannedPlacementEdit(
  docText: string,
  lineStarts: number[],
  maskedText: string,
  scannedComp: ScannedComponentDecl,
  newPlacement: string,
): TextEdit {
  if (scannedComp.annotationOpenParenOffset !== null && scannedComp.annotationCloseParenOffset !== null) {
    const annInnerStart = scannedComp.annotationOpenParenOffset + 1;
    const annClose = scannedComp.annotationCloseParenOffset;
    const maskedInner = maskedText.slice(annInnerStart, annClose);
    const plMatch = maskedInner.match(/\bPlacement\s*\(/);
    if (plMatch && plMatch.index !== undefined) {
      const plStartOff = annInnerStart + plMatch.index;
      const plOpenParen = plStartOff + plMatch[0].length - 1;
      const plCloseParen = findBalancedClose(maskedText, plOpenParen, annClose);
      if (plCloseParen !== -1) {
        return TextEdit.replace(
          Range.create(offsetToPosition(lineStarts, plStartOff), offsetToPosition(lineStarts, plCloseParen + 1)),
          newPlacement,
        );
      }
    }
    const rawInner = docText.slice(annInnerStart, annClose);
    const insertText = rawInner.trim().length > 0 ? `${newPlacement}, ` : newPlacement;
    return TextEdit.insert(offsetToPosition(lineStarts, annInnerStart), insertText);
  }

  return TextEdit.insert(offsetToPosition(lineStarts, scannedComp.declEndOffset), ` annotation(${newPlacement})`);
}

function getPlacementEdit(lines: string[], classInstance: ModelicaClassInstance, item: PlacementItem): TextEdit | null {
  const originX = Math.round(item.x + item.width / 2);
  const originY = Math.round(-(item.y + item.height / 2));
  const w = Math.round(item.width);
  const h = Math.round(item.height);
  const r = Math.round(-(item.rotation ?? 0));
  const rotationPart = r !== 0 ? `, rotation=${r}` : "";

  const component = Array.from(classInstance?.components ?? []).find((c: any) => c.name === item.name);

  // Detect flip from explicit item override or original extent in the source text
  let flipX = false;
  let flipY = false;

  const placement: any =
    typeof (component as any)?.annotation === "function" ? (component as any).annotation("Placement") : null;
  const extent = placement?.transformation?.extent;
  if (extent && extent.length >= 2) {
    const [[x1, y1], [x2, y2]] = extent;
    if (!isNaN(x1) && !isNaN(x2)) flipX = x1 > x2;
    if (!isNaN(y1) && !isNaN(y2)) flipY = y1 > y2;
  }
  if (item.flipX !== undefined) flipX = Boolean(item.flipX);
  if (item.flipY !== undefined) flipY = Boolean(item.flipY);

  const ex1 = flipX ? w / 2 : -(w / 2);
  const ex2 = flipX ? -(w / 2) : w / 2;
  const ey1 = flipY ? h / 2 : -(h / 2);
  const ey2 = flipY ? -(h / 2) : h / 2;
  const newTransformationCore = `origin={${originX},${originY}}, extent={{${ex1},${ey1}},{${ex2},${ey2}}}${rotationPart}`;
  const newPlacement = `Placement(transformation(${newTransformationCore}))`;

  const abstractNode = (component as any)?.cstNode ?? (component as any)?.abstractSyntaxNode;
  const compRange = getNodeRange(abstractNode);

  if (compRange) {
    const { startLine, startCol, endLine, endCol } = compRange;
    const text = getTextInRange(lines, startLine, startCol, endLine, endCol);
    const escName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasExactIdentifier = new RegExp(`\\b${escName}\\b`).test(maskModelicaCommentsAndStrings(text));

    if (hasExactIdentifier) {
      const annotationClause = getAnnotationClauseNode(abstractNode);
      const annRangeInfo = getNodeRange(annotationClause);

      if (annRangeInfo) {
        if (annotationClause) {
          const placementNode = findDescendantModification(annotationClause, "Placement");
          if (placementNode && placementNode.startPosition) {
            const patchRes = CstUnparser.patchAndUnparse({
              target: placementNode,
              replaceText: newPlacement,
            });
            const actualSlice = getTextInRange(
              lines,
              patchRes.edit.range.start.line,
              patchRes.edit.range.start.character,
              patchRes.edit.range.end.line,
              patchRes.edit.range.end.character,
            );
            if (
              actualSlice.trimStart().startsWith("Placement") ||
              (typeof placementNode.text === "string" &&
                placementNode.text.startsWith("Placement") &&
                actualSlice.includes("lacement("))
            ) {
              return TextEdit.replace(
                Range.create(
                  patchRes.edit.range.start.line,
                  patchRes.edit.range.start.character,
                  patchRes.edit.range.end.line,
                  patchRes.edit.range.end.character,
                ),
                patchRes.edit.newText,
              );
            }
          }

          const classModNode = annotationClause.children?.find((c: any) => Cst.ClassModification.is(c));
          if (classModNode && classModNode.children && classModNode.children.length > 0) {
            const cmRange = getNodeRange(classModNode);
            const cmSlice = cmRange
              ? getTextInRange(lines, cmRange.startLine, cmRange.startCol, cmRange.endLine, cmRange.endCol)
              : "";
            if (cmSlice.startsWith("(") && !/\bPlacement\s*\(/.test(maskModelicaCommentsAndStrings(cmSlice))) {
              const patchRes = CstUnparser.patchAndUnparse({
                target: classModNode,
                insertChildren: [
                  {
                    content: newPlacement,
                    position: "start",
                    separator: ", ",
                  },
                ],
              });
              return TextEdit.replace(
                Range.create(
                  patchRes.edit.range.start.line,
                  patchRes.edit.range.start.character,
                  patchRes.edit.range.end.line,
                  patchRes.edit.range.end.character,
                ),
                patchRes.edit.newText,
              );
            }
          }
        }
      }
    }
  }

  // Scanner-backed resolution: handles multi-line declarations, shifted lines, comments/strings, and syntax errors cleanly
  const docText = lines.join("\n");
  const layout = scanModelicaClassLayout(docText, classInstance?.name);
  const scannedComp = layout?.components.find((c) => c.name === item.name);
  if (layout && scannedComp) {
    return applyScannedPlacementEdit(docText, layout.lineStarts, layout.maskedText, scannedComp, newPlacement);
  }

  // Last-resort fallback for synthetic unit-test mock nodes without full Modelica class wrapper
  if (compRange) {
    const { startLine, startCol, endLine, endCol } = compRange;
    const text = getTextInRange(lines, startLine, startCol, endLine, endCol);
    if (!text.includes(item.name)) return null;
    const range = Range.create(startLine, startCol, endLine, endCol);
    const semiIndex = findStatementSemicolon(text);
    const insert = ` annotation(${newPlacement})`;
    if (semiIndex !== -1) {
      return TextEdit.replace(range, text.slice(0, semiIndex) + insert + text.slice(semiIndex));
    }
    return TextEdit.replace(range, text + insert);
  }

  return null;
}

/**
 * Only add a Placement annotation if the component doesn't already have one.
 * Used for connected components that weren't explicitly moved — we want to
 * "pin" their current position so autolayout doesn't shift them.
 */
function getPlacementEditIfMissing(
  lines: string[],
  classInstance: ModelicaClassInstance,
  item: PlacementItem,
): TextEdit | null {
  const component = Array.from(classInstance?.components ?? []).find((c: any) => c.name === item.name);
  if (component) {
    const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
    const annotationClause = getAnnotationClauseNode(abstractNode);
    if (annotationClause) {
      const placementNode = findDescendantModification(annotationClause, "Placement");
      if (placementNode) return null;
    }
    const compRange = getNodeRange(abstractNode);
    if (compRange) {
      const text = getTextInRange(lines, compRange.startLine, compRange.startCol, compRange.endLine, compRange.endCol);
      if (/\bPlacement\s*\(/.test(maskModelicaCommentsAndStrings(text))) return null;
    }
  }

  const docText = lines.join("\n");
  const layout = scanModelicaClassLayout(docText, classInstance?.name);
  const scannedComp = layout?.components.find((c) => c.name === item.name);
  if (
    layout &&
    scannedComp &&
    scannedComp.annotationOpenParenOffset !== null &&
    scannedComp.annotationCloseParenOffset !== null
  ) {
    const maskedInner = layout.maskedText.slice(
      scannedComp.annotationOpenParenOffset + 1,
      scannedComp.annotationCloseParenOffset,
    );
    if (/\bPlacement\s*\(/.test(maskedInner)) return null;
  }

  // Component lacks Placement — add one using the current diagram position
  return getPlacementEdit(lines, classInstance, item);
}

// ── Add connect equation ──

function findInsertLineBeforeClassAnnotation(lines: string[], endRow: number, modelStartLine: number): number {
  let insertLine = endRow;
  let parenBalance = 0;
  for (let j = endRow - 1; j >= modelStartLine; j--) {
    const trimmed = (lines[j] ?? "").trim();
    if (trimmed === "") continue;
    for (let k = trimmed.length - 1; k >= 0; k--) {
      if (trimmed[k] === ")") parenBalance++;
      else if (trimmed[k] === "(") parenBalance--;
    }
    if (trimmed.startsWith("annotation") && parenBalance <= 0) {
      insertLine = j;
      parenBalance = 0;
    } else if (parenBalance <= 0) {
      break;
    }
  }
  return insertLine;
}

export function computeConnectInsert(
  docText: string,
  classInstance: ModelicaClassInstance,
  source: string,
  target: string,
  points?: { x: number; y: number }[],
  color?: [number, number, number],
): TextEdit[] {
  const lines = docText.split("\n");

  const effectiveColor = color ?? inferModelicaDomainColor(source, target, classInstance);
  const colorStr = `{${effectiveColor[0]}, ${effectiveColor[1]}, ${effectiveColor[2]}}`;

  const annotation =
    points && points.length > 0
      ? ` annotation(Line(points={${points.map((p) => `{${p.x},${p.y}}`).join(", ")}}, color=${colorStr}))`
      : ` annotation(Line(color=${colorStr}))`;
  const connectEq = `  connect(${source}, ${target})${annotation};\n`;

  const astNode = (classInstance as any)?.cstNode ?? (classInstance as any)?.abstractSyntaxNode;
  const classRange = getNodeRange(astNode);
  const modelStartLine = classRange ? classRange.startLine : undefined;

  const layout = scanModelicaClassLayout(docText, classInstance?.name, modelStartLine);
  if (layout) {
    // 1. Check for an existing regular (non-initial) `equation` section
    const eqSections = layout.sections.filter((s) => s.kind === "equation");
    const targetEqSec = eqSections.length > 0 ? eqSections[eqSections.length - 1]! : null;

    if (targetEqSec) {
      const bodyMasked = layout.maskedText.slice(targetEqSec.headerEndOffset, targetEqSec.endOffset);
      let lastNonWsRel = bodyMasked.length - 1;
      while (lastNonWsRel >= 0 && bodyMasked[lastNonWsRel]! <= " ") {
        lastNonWsRel--;
      }

      if (lastNonWsRel < 0) {
        // Empty `equation` section
        const endBoundPos = offsetToPosition(layout.lineStarts, targetEqSec.endOffset);
        if (targetEqSec.startLine < endBoundPos.line) {
          return [TextEdit.insert({ line: targetEqSec.startLine + 1, character: 0 }, connectEq)];
        }
        return [TextEdit.insert(endBoundPos, `\n${connectEq}`)];
      }

      const lastCodeEndOffset = targetEqSec.headerEndOffset + lastNonWsRel + 1;
      const lastCodePos = offsetToPosition(layout.lineStarts, lastCodeEndOffset);
      const restOfLine = layout.maskedText.slice(lastCodeEndOffset).split("\n", 1)[0]!.trim();

      if (restOfLine === "") {
        return [TextEdit.insert({ line: lastCodePos.line + 1, character: 0 }, connectEq)];
      }
      return [TextEdit.insert(lastCodePos, `\n${connectEq.trimEnd()}`)];
    }

    // 2. No regular `equation` section exists: insert BEFORE `external`, non-stranded class `annotation(...)`, or `end <ClassName>;`
    let boundaryOffset = layout.endKeywordOffset;
    for (const sec of layout.sections) {
      if (sec.kind === "external" && sec.keywordOffset < boundaryOffset) {
        boundaryOffset = sec.keywordOffset;
      }
    }
    for (const ca of layout.classAnnotations) {
      if (!ca.isStrandedBeforeBodyElements && ca.keywordOffset < boundaryOffset) {
        boundaryOffset = ca.keywordOffset;
      }
    }

    const boundPos = offsetToPosition(layout.lineStarts, boundaryOffset);
    const beforeOnLine = (lines[boundPos.line] ?? "").slice(0, boundPos.character).trim();
    if (beforeOnLine === "" && boundPos.line > layout.startLine) {
      return [TextEdit.insert({ line: boundPos.line, character: 0 }, `equation\n${connectEq}`)];
    }
    return [TextEdit.insert(boundPos, `\nequation\n${connectEq}`)];
  }

  // Fallback when document has no parseable class header at all
  const fallbackStart = classRange ? classRange.startLine : 0;
  const fallbackEnd = classRange ? classRange.endLine : lines.length - 1;
  for (let i = fallbackEnd; i >= fallbackStart; i--) {
    if (lines[i]!.trim().startsWith("end")) {
      const insertLine = findInsertLineBeforeClassAnnotation(lines, i, fallbackStart);
      return [TextEdit.insert({ line: insertLine, character: 0 }, `equation\n${connectEq}`)];
    }
  }

  return [];
}

// ── Remove connect equation ──

function getConnectEndpoints(ce: any): { source: string; target: string } {
  const source =
    ce.lhs ??
    ce.componentReference1?.parts
      ?.map(
        (c: { identifier?: { text: string } | undefined; text?: string | undefined }) =>
          c.identifier?.text ?? c.text ?? "",
      )
      ?.join(".") ??
    "";
  const target =
    ce.rhs ??
    ce.componentReference2?.parts
      ?.map(
        (c: { identifier?: { text: string } | undefined; text?: string | undefined }) =>
          c.identifier?.text ?? c.text ?? "",
      )
      ?.join(".") ??
    "";
  return { source, target };
}

function findBestConnectMatch<T>(
  items: T[],
  getEndpointsFn: (item: T) => { source: string; target: string },
  source: string,
  target: string,
  used?: Set<T>,
): T | undefined {
  const exact = items.find((item) => {
    if (used?.has(item)) return false;
    const { source: c1, target: c2 } = getEndpointsFn(item);
    return c1 === source && c2 === target;
  });
  if (exact) return exact;
  return items.find((item) => {
    if (used?.has(item)) return false;
    const { source: c1, target: c2 } = getEndpointsFn(item);
    return c1 === target && c2 === source;
  });
}

function verifyConnectSliceMatches(slice: string, source: string, target: string): boolean {
  const masked = maskModelicaCommentsAndStrings(slice);
  if (!/\bconnect\s*\(/.test(masked)) return false;
  const norm = slice.replace(/\s*\.\s*/g, ".");
  return norm.includes(source) && norm.includes(target);
}

export function computeConnectRemove(
  docText: string,
  classInstance: ModelicaClassInstance,
  source: string,
  target: string,
): TextEdit[] {
  const lines = docText.split("\n");

  const connectEqs = Array.from(classInstance?.connectEquations ?? []);
  const connectEq: any = findBestConnectMatch(connectEqs, getConnectEndpoints, source, target);

  if (connectEq) {
    const eqNode = getConnectEquationStatementNode(connectEq);
    const rawRange = getNodeRange(eqNode);
    if (rawRange) {
      const eqRange = expandConnectStatementRange(lines, rawRange);
      const slice = getTextInRange(lines, eqRange.startLine, eqRange.startCol, eqRange.endLine, eqRange.endCol);
      if (verifyConnectSliceMatches(slice, source, target)) {
        return [makeDeleteRange(lines, eqRange.startLine, eqRange.startCol, eqRange.endLine, eqRange.endCol)];
      }
    }
  }

  // Scanner fallback (handles stale CST offsets or syntax errors)
  const layout = scanModelicaClassLayout(docText, classInstance?.name);
  if (layout) {
    const scannedConn = findBestConnectMatch(
      layout.connects,
      (c) => ({ source: c.source, target: c.target }),
      source,
      target,
    );
    if (scannedConn) {
      const sPos = offsetToPosition(layout.lineStarts, scannedConn.startOffset);
      const ePos = offsetToPosition(layout.lineStarts, scannedConn.statementEndOffset);
      return [makeDeleteRange(lines, sPos.line, sPos.character, ePos.line, ePos.character)];
    }
  }

  return [];
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

  const layout = scanModelicaClassLayout(docText, classInstance?.name);
  if (layout) {
    for (const conn of layout.connects) {
      const involvesComponent = [...nameSet].some(
        (name) =>
          conn.source === name ||
          conn.source.startsWith(`${name}.`) ||
          conn.target === name ||
          conn.target.startsWith(`${name}.`),
      );
      if (involvesComponent) {
        const sPos = offsetToPosition(layout.lineStarts, conn.startOffset);
        const ePos = offsetToPosition(layout.lineStarts, conn.statementEndOffset);
        edits.push(makeDeleteRange(lines, sPos.line, sPos.character, ePos.line, ePos.character));
      }
    }

    for (const name of names) {
      const comp = layout.components.find((c) => c.name === name);
      if (!comp) continue;
      if (comp.isSoleDeclarator) {
        const sPos = offsetToPosition(layout.lineStarts, comp.clauseStartOffset);
        const ePos = offsetToPosition(layout.lineStarts, comp.clauseEndOffset);
        edits.push(makeDeleteRange(lines, sPos.line, sPos.character, ePos.line, ePos.character));
      } else {
        // Multi-declarator clause (e.g. `Resistor R1, R2;`): remove only this declarator + adjacent comma!
        let delStart = comp.identStartOffset;
        let delEnd = comp.declEndOffset;
        const after = layout.maskedText.slice(delEnd, comp.clauseEndOffset);
        const trailingComma = after.match(/^\s*,\s*/);
        if (trailingComma) {
          delEnd += trailingComma[0].length;
        } else {
          const before = layout.maskedText.slice(comp.clauseStartOffset, delStart);
          const leadingComma = before.match(/\s*,\s*$/);
          if (leadingComma) {
            delStart -= leadingComma[0].length;
          }
        }
        const sPos = offsetToPosition(layout.lineStarts, delStart);
        const ePos = offsetToPosition(layout.lineStarts, delEnd);
        edits.push(TextEdit.del(Range.create(sPos, ePos)));
      }
    }

    if (edits.length > 0) {
      return deduplicateAndSort(edits);
    }
  }

  // Fallback for synthetic mock ASTs without full Modelica class wrapper
  Array.from(classInstance?.connectEquations ?? []).forEach((ce: any) => {
    const { source: c1, target: c2 } = getConnectEndpoints(ce);
    const involvesComponent = [...nameSet].some(
      (name) => c1 === name || c1.startsWith(`${name}.`) || c2 === name || c2.startsWith(`${name}.`),
    );
    const eqNode = getConnectEquationStatementNode(ce);
    const rawRange = getNodeRange(eqNode);
    if (involvesComponent && rawRange) {
      const eqRange = expandConnectStatementRange(lines, rawRange);
      edits.push(makeDeleteRange(lines, eqRange.startLine, eqRange.startCol, eqRange.endLine, eqRange.endCol));
    }
  });

  for (const name of names) {
    const component = Array.from(classInstance?.components ?? []).find((c: any) => c.name === name);
    if (!component) continue;

    const compNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
    const parentNode = compNode?.parent ?? compNode;
    const compRange = getNodeRange(parentNode);
    if (compRange) {
      edits.push(makeDeleteRange(lines, compRange.startLine, compRange.startCol, compRange.endLine, compRange.endCol));
    }
  }

  return deduplicateAndSort(edits);
}

// ── Update edge points (Line annotation on connect equations) ──

function applyScannedConnectPointEdit(
  docText: string,
  lineStarts: number[],
  maskedText: string,
  scannedConn: ScannedConnectStmt,
  newPointsCore: string,
  colorCore: string,
  defaultLineAnnotation: string,
): TextEdit {
  if (scannedConn.annotationOpenParenOffset !== null && scannedConn.annotationCloseParenOffset !== null) {
    const annInnerStart = scannedConn.annotationOpenParenOffset + 1;
    const annClose = scannedConn.annotationCloseParenOffset;
    const maskedInner = maskedText.slice(annInnerStart, annClose);
    const lnMatch = maskedInner.match(/\bLine\s*\(/);
    if (lnMatch && lnMatch.index !== undefined) {
      const lnStartOff = annInnerStart + lnMatch.index;
      const lnOpenParen = lnStartOff + lnMatch[0].length - 1;
      const lnCloseParen = findBalancedClose(maskedText, lnOpenParen, annClose);
      if (lnCloseParen !== -1) {
        const existingLine = docText.slice(lnStartOff, lnCloseParen + 1);
        const updatedLine = updateLineAnnotationText(existingLine, newPointsCore, colorCore);
        return TextEdit.replace(
          Range.create(offsetToPosition(lineStarts, lnStartOff), offsetToPosition(lineStarts, lnCloseParen + 1)),
          updatedLine,
        );
      }
    }
    const rawInner = docText.slice(annInnerStart, annClose);
    const insertText = rawInner.trim().length > 0 ? `, ${defaultLineAnnotation}` : defaultLineAnnotation;
    return TextEdit.insert(offsetToPosition(lineStarts, annClose), insertText);
  }

  const insertOffset = scannedConn.closeConnectParenOffset + 1;
  return TextEdit.insert(offsetToPosition(lineStarts, insertOffset), ` annotation(${defaultLineAnnotation})`);
}

export function computeEdgePointEdits(
  lines: string[],
  classInstance: ModelicaClassInstance,
  edges: EdgeItem[],
): TextEdit[] {
  const edits: TextEdit[] = [];
  const seen = new Set<string>();
  const usedCstConnects = new Set<any>();
  const usedScannedConnects = new Set<ScannedConnectStmt>();

  const docText = lines.join("\n");
  let cachedLayout: ReturnType<typeof scanModelicaClassLayout> | undefined;
  const getLayout = () => {
    if (cachedLayout === undefined) {
      cachedLayout = scanModelicaClassLayout(docText, classInstance?.name);
    }
    return cachedLayout;
  };

  const connectEqs = Array.from(classInstance?.connectEquations ?? []);

  for (const edge of edges) {
    const pointsStr = `{${edge.points.map((p) => `{${p.x},${p.y}}`).join(", ")}}`;
    const newPointsCore = `points=${pointsStr}`;
    const inferredColor = inferModelicaDomainColor(edge.source, edge.target, classInstance);
    const colorCore = `color={${inferredColor[0]}, ${inferredColor[1]}, ${inferredColor[2]}}`;
    const defaultLineAnnotation = `Line(${newPointsCore}, ${colorCore})`;

    const connectEq: any = findBestConnectMatch(
      connectEqs,
      getConnectEndpoints,
      edge.source,
      edge.target,
      usedCstConnects,
    );
    if (connectEq) {
      usedCstConnects.add(connectEq);
    }

    const eqNode = getConnectEquationStatementNode(connectEq);
    const rawRange = getNodeRange(eqNode);
    let handledViaCst = false;

    if (rawRange) {
      const eqRange = expandConnectStatementRange(lines, rawRange);
      const { startLine, startCol, endLine, endCol } = eqRange;
      const key = `${startLine}:${startCol}`;
      const text = getTextInRange(lines, startLine, startCol, endLine, endCol);

      if (!seen.has(key) && verifyConnectSliceMatches(text, edge.source, edge.target)) {
        seen.add(key);
        const range = Range.create(startLine, startCol, endLine, endCol);
        let newText = text;

        const annotationClause = getAnnotationClauseNode(eqNode);
        const annRangeInfo = getNodeRange(annotationClause);

        if (annRangeInfo) {
          if (annotationClause) {
            const lineNode = findDescendantModification(annotationClause, "Line");
            if (lineNode && lineNode.startPosition) {
              const lineNodeRange = getNodeRange(lineNode);
              const sliceInDoc = lineNodeRange
                ? getTextInRange(
                    lines,
                    lineNodeRange.startLine,
                    lineNodeRange.startCol,
                    lineNodeRange.endLine,
                    lineNodeRange.endCol,
                  )
                : "";
              if (sliceInDoc.trimStart().startsWith("Line")) {
                const existingLineText = sliceInDoc || lineNode.text || null;
                const updatedLineAnnotation = updateLineAnnotationText(existingLineText, newPointsCore, colorCore);
                const patchRes = CstUnparser.patchAndUnparse({
                  target: lineNode,
                  replaceText: updatedLineAnnotation,
                });
                edits.push(
                  TextEdit.replace(
                    Range.create(
                      patchRes.edit.range.start.line,
                      patchRes.edit.range.start.character,
                      patchRes.edit.range.end.line,
                      patchRes.edit.range.end.character,
                    ),
                    patchRes.edit.newText,
                  ),
                );
                handledViaCst = true;
              }
            }

            if (!handledViaCst) {
              const classModNode = annotationClause.children?.find((c: any) => Cst.ClassModification.is(c));
              if (classModNode && classModNode.children && classModNode.children.length > 0) {
                const cmRange = getNodeRange(classModNode);
                const cmSlice = cmRange
                  ? getTextInRange(lines, cmRange.startLine, cmRange.startCol, cmRange.endLine, cmRange.endCol)
                  : "";
                if (cmSlice.startsWith("(") && !/\bLine\s*\(/.test(maskModelicaCommentsAndStrings(cmSlice))) {
                  const patchRes = CstUnparser.patchAndUnparse({
                    target: classModNode,
                    insertChildren: [
                      {
                        content: defaultLineAnnotation,
                        position: "end",
                        separator: ", ",
                      },
                    ],
                  });
                  edits.push(
                    TextEdit.replace(
                      Range.create(
                        patchRes.edit.range.start.line,
                        patchRes.edit.range.start.character,
                        patchRes.edit.range.end.line,
                        patchRes.edit.range.end.character,
                      ),
                      patchRes.edit.newText,
                    ),
                  );
                  handledViaCst = true;
                }
              }
            }
          }

          if (!handledViaCst) {
            const annRange = Range.create(
              annRangeInfo.startLine,
              annRangeInfo.startCol,
              annRangeInfo.endLine,
              annRangeInfo.endCol,
            );
            const annText = getTextInRange(
              lines,
              annRangeInfo.startLine,
              annRangeInfo.startCol,
              annRangeInfo.endLine,
              annRangeInfo.endCol,
            );
            const annMasked = maskModelicaCommentsAndStrings(annText);
            const annotationMatch = annMasked.match(/\bannotation\s*\(/);
            if (annotationMatch && annotationMatch.index !== undefined) {
              const annStartIndex = annotationMatch.index;
              const annContentStart = annStartIndex + annotationMatch[0].length;
              const annEndIndex = findMatchingParen(annText, annContentStart);
              if (annEndIndex !== -1) {
                let annotationContent = annText.substring(annContentStart, annEndIndex);
                const contentMasked = maskModelicaCommentsAndStrings(annotationContent);
                let updatedLine = defaultLineAnnotation;

                const lineMatch = contentMasked.match(/\bLine\s*\(/);
                if (lineMatch && lineMatch.index !== undefined) {
                  const lineStart = lineMatch.index;
                  const lineInner = lineStart + lineMatch[0].length;
                  const lineEnd = findMatchingParen(annotationContent, lineInner);
                  if (lineEnd !== -1) {
                    const existingLine = annotationContent.substring(lineStart, lineEnd + 1);
                    updatedLine = updateLineAnnotationText(existingLine, newPointsCore, colorCore);
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

                const trimmed = annotationContent.trim();
                const separator = trimmed.length > 0 ? ", " : "";
                newText =
                  annText.substring(0, annContentStart) +
                  trimmed +
                  separator +
                  updatedLine +
                  annText.substring(annEndIndex);
                if (newText !== annText) {
                  edits.push(TextEdit.replace(annRange, newText));
                }
                handledViaCst = true;
              }
            }
          }
        } else if (/\bannotation\s*\(/.test(maskModelicaCommentsAndStrings(text))) {
          const textMasked = maskModelicaCommentsAndStrings(text);
          const annotationMatch = textMasked.match(/\bannotation\s*\(/);
          if (annotationMatch && annotationMatch.index !== undefined) {
            const annStartIndex = annotationMatch.index;
            const annContentStart = annStartIndex + annotationMatch[0].length;
            const annEndIndex = findMatchingParen(text, annContentStart);
            if (annEndIndex !== -1) {
              let annotationContent = text.substring(annContentStart, annEndIndex);
              const contentMasked = maskModelicaCommentsAndStrings(annotationContent);
              let updatedLine = defaultLineAnnotation;

              const lineMatch = contentMasked.match(/\bLine\s*\(/);
              if (lineMatch && lineMatch.index !== undefined) {
                const lineStart = lineMatch.index;
                const lineInner = lineStart + lineMatch[0].length;
                const lineEnd = findMatchingParen(annotationContent, lineInner);
                if (lineEnd !== -1) {
                  const existingLine = annotationContent.substring(lineStart, lineEnd + 1);
                  updatedLine = updateLineAnnotationText(existingLine, newPointsCore, colorCore);
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

              const trimmed = annotationContent.trim();
              const separator = trimmed.length > 0 ? ", " : "";
              newText =
                text.substring(0, annContentStart) + trimmed + separator + updatedLine + text.substring(annEndIndex);
              if (newText !== text) {
                edits.push(TextEdit.replace(range, newText));
              }
              handledViaCst = true;
            }
          }
        } else {
          const semiIndex = findStatementSemicolon(text);
          const insert = ` annotation(${defaultLineAnnotation})`;
          newText = semiIndex !== -1 ? text.slice(0, semiIndex) + insert + text.slice(semiIndex) : text + insert;
          if (newText !== text) {
            edits.push(TextEdit.replace(range, newText));
          }
          handledViaCst = true;
        }
      }
    }

    if (!handledViaCst) {
      const layout = getLayout();
      if (layout) {
        const scannedConn = findBestConnectMatch(
          layout.connects,
          (c) => ({ source: c.source, target: c.target }),
          edge.source,
          edge.target,
          usedScannedConnects,
        );
        if (scannedConn) {
          usedScannedConnects.add(scannedConn);
          const pos = offsetToPosition(layout.lineStarts, scannedConn.startOffset);
          const key = `${pos.line}:${pos.character}`;
          if (!seen.has(key)) {
            seen.add(key);
            edits.push(
              applyScannedConnectPointEdit(
                docText,
                layout.lineStarts,
                layout.maskedText,
                scannedConn,
                newPointsCore,
                colorCore,
                defaultLineAnnotation,
              ),
            );
          }
        }
      }
    }
  }

  return edits;
}

// ── Helpers ──

export function findMatchingParen(text: string, openPos: number): number {
  let nesting = 0;
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openPos; i < text.length; i++) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1]! : "";

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "(") nesting++;
    else if (ch === ")") {
      if (nesting === 0) return i;
      nesting--;
    }
  }
  return -1;
}

export function findStatementSemicolon(text: string): number {
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let lastSemi = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1]! : "";

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === ";") {
      lastSemi = i;
    }
  }
  return lastSemi;
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
  // If the node is the only content on its line(s) (optionally followed by a statement semicolon),
  // delete the entire line(s)
  const prefix = (lines[startLine]?.substring(0, startCol) ?? "").trim();
  const rawSuffix = lines[endLine]?.substring(endCol) ?? "";
  const suffix = rawSuffix.trim();

  if (prefix === "" && (suffix === "" || suffix === ";")) {
    if (endLine + 1 < lines.length) {
      return TextEdit.del(Range.create(startLine, 0, endLine + 1, 0));
    } else {
      return TextEdit.del(Range.create(startLine, 0, endLine, lines[endLine]?.length ?? 0));
    }
  }

  // If followed immediately by a statement semicolon on the same line, include the semicolon in the deletion
  const semiMatch = rawSuffix.match(/^\s*;/);
  const adjustedEndCol = semiMatch ? endCol + semiMatch[0].length : endCol;

  return TextEdit.del(Range.create(startLine, startCol, endLine, adjustedEndCol));
}

export function applyEditsToText(text: string, edits: TextEdit[]): string {
  if (edits.length === 0) return text;
  // Sort edits in descending order so that applying one doesn't affect offsets of earlier edits
  const sorted = deduplicateAndSort(edits).reverse();
  const lines = text.split("\n");
  for (const edit of sorted) {
    const sl = edit.range.start.line;
    const sc = edit.range.start.character;
    const el = edit.range.end.line;
    const ec = edit.range.end.character;

    const before = (lines[sl] ?? "").substring(0, sc);
    const after = (lines[el] ?? "").substring(ec);

    const newLines = edit.newText.split("\n");
    newLines[0] = before + newLines[0];
    newLines[newLines.length - 1] += after;

    lines.splice(sl, Math.max(0, el - sl + 1), ...newLines);
  }
  return lines.join("\n");
}

export function deduplicateAndSort(edits: TextEdit[]): TextEdit[] {
  const indexed = edits.map((edit, idx) => ({ edit, idx }));
  // Sort by position (ascending) with original-index tie-breaker for stability
  indexed.sort((aWrap, bWrap) => {
    const a = aWrap.edit;
    const b = bWrap.edit;
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    if (a.range.start.character !== b.range.start.character) return a.range.start.character - b.range.start.character;
    if (a.range.end.line !== b.range.end.line) return a.range.end.line - b.range.end.line;
    if (a.range.end.character !== b.range.end.character) return a.range.end.character - b.range.end.character;
    return aWrap.idx - bWrap.idx;
  });

  // Remove overlapping edits (comparing against last accepted edit)
  const accepted: TextEdit[] = [];
  for (const { edit } of indexed) {
    if (accepted.length === 0) {
      accepted.push(edit);
      continue;
    }
    const prev = accepted[accepted.length - 1]!;
    const isPrevInsert =
      prev.range.start.line === prev.range.end.line && prev.range.start.character === prev.range.end.character;
    const isCurrInsert =
      edit.range.start.line === edit.range.end.line && edit.range.start.character === edit.range.end.character;

    if (
      edit.range.start.line < prev.range.end.line ||
      (edit.range.start.line === prev.range.end.line && edit.range.start.character < prev.range.end.character)
    ) {
      continue;
    }
    if (
      !isPrevInsert &&
      !isCurrInsert &&
      edit.range.start.line === prev.range.start.line &&
      edit.range.start.character === prev.range.start.character
    ) {
      continue;
    }
    if (
      isPrevInsert &&
      isCurrInsert &&
      edit.range.start.line === prev.range.start.line &&
      edit.range.start.character === prev.range.start.character &&
      edit.newText === prev.newText
    ) {
      continue;
    }
    accepted.push(edit);
  }
  return accepted;
}

// ── Component Property edits (Name, Description, Parameters) ──

export function computeNameEdit(
  classInstance: ModelicaClassInstance,
  oldName: string,
  newName: string,
  docText?: string,
): TextEdit[] {
  if (!oldName || !newName || oldName === newName) return [];

  const effectiveDocText =
    docText ?? ((classInstance as any)?.cstNode?.tree as { sourceCode?: string } | undefined)?.sourceCode ?? undefined;

  if (effectiveDocText) {
    const layout = scanModelicaClassLayout(effectiveDocText, classInstance?.name);
    const scannedComp = layout?.components.find((c) => c.name === oldName);
    if (layout && scannedComp) {
      const edits: TextEdit[] = [
        TextEdit.replace(
          Range.create(
            offsetToPosition(layout.lineStarts, scannedComp.identStartOffset),
            offsetToPosition(layout.lineStarts, scannedComp.identEndOffset),
          ),
          newName,
        ),
      ];

      // Also update all connect(oldName.port, ...) / connect(oldName, ...) references in the class!
      const replaceEndpointPrefix = (refStart: number, refEnd: number) => {
        const rawRef = effectiveDocText.slice(refStart, refEnd);
        const escOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = rawRef.match(new RegExp(`^(${escOld})(?=\\s*(?:\\.|\\[|$))`));
        if (m) {
          edits.push(
            TextEdit.replace(
              Range.create(
                offsetToPosition(layout.lineStarts, refStart),
                offsetToPosition(layout.lineStarts, refStart + m[1]!.length),
              ),
              newName,
            ),
          );
        }
      };

      for (const conn of layout.connects) {
        replaceEndpointPrefix(conn.lhsStartOffset, conn.lhsEndOffset);
        replaceEndpointPrefix(conn.rhsStartOffset, conn.rhsEndOffset);
      }

      return deduplicateAndSort(edits);
    }
  }

  const component = Array.from(classInstance?.components ?? []).find((c: any) => c.name === oldName);
  if (!component) return [];

  const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
  const identNode = getDeclarationIdentNode(abstractNode);
  const identRange = getNodeRange(identNode);
  if (identRange) {
    return [
      TextEdit.replace(
        Range.create(identRange.startLine, identRange.startCol, identRange.endLine, identRange.endCol),
        newName,
      ),
    ];
  }
  return [];
}

function findDescriptionStringNode(node: any): any {
  if (!node) return null;
  const isString = (n: any) => Cst.DescriptionString.is(n) || Cst.StringLiteral.is(n);

  if (isString(node)) return node;

  // Search direct children first
  for (const child of node.children || []) {
    if (isString(child)) return child;
  }

  // If there is a description node, search within it (specifically avoiding annotation_clause)
  const descNode =
    node.description ??
    (Cst.ComponentDeclaration.is(node) ? Cst.ComponentDeclaration.description(node) : null) ??
    (node.children || []).find((c: any) => Cst.Description.is(c));
  if (descNode) {
    if (isString(descNode)) return descNode;
    for (const child of descNode.children || []) {
      if (isString(child)) return child;
    }
  }

  return null;
}

export function computeDescriptionEdit(
  docText: string,
  classInstance: ModelicaClassInstance,
  componentName: string,
  newDescription: string,
): TextEdit[] {
  const escapedDescription = newDescription.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const component = Array.from(classInstance?.components ?? []).find((c: any) => c.name === componentName);

  if (component) {
    const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
    const descriptionNode = findDescriptionStringNode(abstractNode);
    const descRange = getNodeRange(descriptionNode);

    if (descRange) {
      const lines = docText.split("\n");
      const curSlice = getTextInRange(
        lines,
        descRange.startLine,
        descRange.startCol,
        descRange.endLine,
        descRange.endCol,
      );
      if (curSlice.startsWith('"')) {
        if (newDescription === "") {
          const lineContent = lines[descRange.startLine]!;
          let col = descRange.startCol - 1;
          while (col >= 0 && (lineContent[col] === " " || lineContent[col] === "\t")) {
            col--;
          }
          const removeStartCol = col + 1;
          return [
            TextEdit.replace(
              Range.create(descRange.startLine, removeStartCol, descRange.endLine, descRange.endCol),
              "",
            ),
          ];
        }
        return [
          TextEdit.replace(
            Range.create(descRange.startLine, descRange.startCol, descRange.endLine, descRange.endCol),
            `"${escapedDescription}"`,
          ),
        ];
      }
    }
  }

  // Scanner-backed resolution (handles newly inserted description, multi-line modifiers, or syntax errors)
  const layout = scanModelicaClassLayout(docText, classInstance?.name);
  const scannedComp = layout?.components.find((c) => c.name === componentName);
  if (layout && scannedComp) {
    if (scannedComp.descriptionStartOffset !== null && scannedComp.descriptionEndOffset !== null) {
      if (newDescription === "") {
        let delStart = scannedComp.descriptionStartOffset;
        while (
          delStart > scannedComp.identEndOffset &&
          (docText[delStart - 1] === " " || docText[delStart - 1] === "\t")
        ) {
          delStart--;
        }
        return [
          TextEdit.del(
            Range.create(
              offsetToPosition(layout.lineStarts, delStart),
              offsetToPosition(layout.lineStarts, scannedComp.descriptionEndOffset),
            ),
          ),
        ];
      }
      return [
        TextEdit.replace(
          Range.create(
            offsetToPosition(layout.lineStarts, scannedComp.descriptionStartOffset),
            offsetToPosition(layout.lineStarts, scannedComp.descriptionEndOffset),
          ),
          `"${escapedDescription}"`,
        ),
      ];
    }
    if (newDescription === "") return [];
    const insertOff = scannedComp.modEndOffset ?? scannedComp.subscriptsEndOffset ?? scannedComp.identEndOffset;
    return [TextEdit.insert(offsetToPosition(layout.lineStarts, insertOff), ` "${escapedDescription}"`)];
  }

  // Fallback for synthetic mock AST nodes without class wrapper
  if (component && newDescription !== "") {
    const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
    const declNode = getDeclarationNode(abstractNode);
    const modificationNode = getModificationNode(declNode ?? abstractNode);
    const subscriptsNode = getSubscriptsNode(declNode ?? abstractNode);
    const identNode = getDeclarationIdentNode(declNode ?? abstractNode);
    const modRange = getNodeRange(modificationNode);
    const subRange = getNodeRange(subscriptsNode);
    const idRange = getNodeRange(identNode);
    const pos = modRange
      ? { row: modRange.endLine, column: modRange.endCol }
      : subRange
        ? { row: subRange.endLine, column: subRange.endCol }
        : idRange
          ? { row: idRange.endLine, column: idRange.endCol }
          : null;
    if (pos) {
      return [TextEdit.insert({ line: pos.row, character: pos.column }, ` "${escapedDescription}"`)];
    }
  }
  return [];
}

function findArgumentByName(
  classModOrArgList: any,
  name: string,
): { argumentNode: any; elementModNode: any; valueModNode: any } | null {
  if (!classModOrArgList) return null;
  const findArgs = (node: any): any[] => {
    const results: any[] = [];
    if (!node) return results;
    if (Cst.Argument.is(node)) {
      results.push(node);
      return results;
    }
    for (const ch of node.children || []) {
      results.push(...findArgs(ch));
    }
    return results;
  };

  const args = findArgs(classModOrArgList);
  for (const arg of args) {
    const findElemMod = (n: any): any => {
      if (!n) return null;
      if (Cst.ElementModification.is(n)) return n;
      for (const ch of n.children || []) {
        const found = findElemMod(ch);
        if (found) return found;
      }
      return null;
    };
    const elemMod = findElemMod(arg);
    if (!elemMod) continue;

    const findName = (n: any): any => {
      if (!n) return null;
      if (Cst.Identifier.is(n)) return n;
      for (const ch of n.children || []) {
        const found = findName(ch);
        if (found) return found;
      }
      return null;
    };
    const nameNode =
      (Cst.ElementModification.is(elemMod) ? Cst.ElementModification.name(elemMod) : null) ?? findName(elemMod);
    if (nameNode && nameNode.text?.trim() === name) {
      const valueModNode =
        (Cst.ElementModification.is(elemMod) ? Cst.ElementModification.modification(elemMod) : null) ??
        (elemMod.children || []).find((c: any) => Cst.Modification.is(c));
      return { argumentNode: arg, elementModNode: elemMod, valueModNode };
    }
  }

  return null;
}

function getAllArgumentNodes(classModOrArgList: any): any[] {
  if (!classModOrArgList) return [];
  const results: any[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (Cst.Argument.is(node)) {
      results.push(node);
      return;
    }
    for (const ch of node.children || []) {
      walk(ch);
    }
  };
  walk(classModOrArgList);
  return results;
}

function splitTopLevelModificationSegments(
  docText: string,
  maskedText: string,
  startOffset: number,
  endOffset: number,
): Array<{ rawStart: number; rawEnd: number; trimmedStart: number; trimmedEnd: number }> {
  const segments: Array<{ rawStart: number; rawEnd: number; trimmedStart: number; trimmedEnd: number }> = [];
  let segStart = startOffset;
  let depth = 0;

  const pushSeg = (s: number, e: number) => {
    let ts = s;
    let te = e;
    while (ts < te && docText[ts]! <= " ") ts++;
    while (te > ts && docText[te - 1]! <= " ") te--;
    if (ts < te) {
      segments.push({ rawStart: s, rawEnd: e, trimmedStart: ts, trimmedEnd: te });
    }
  };

  for (let i = startOffset; i < endOffset; i++) {
    const ch = maskedText[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth > 0) depth--;
    } else if (ch === "," && depth === 0) {
      pushSeg(segStart, i);
      segStart = i + 1;
    }
  }
  pushSeg(segStart, endOffset);
  return segments;
}

function computeScannedParameterEdit(
  docText: string,
  classInstance: ModelicaClassInstance,
  componentName: string,
  parameterName: string,
  newValue: string,
): TextEdit[] {
  const astNode = (classInstance as any)?.cstNode ?? (classInstance as any)?.abstractSyntaxNode;
  const classRange = getNodeRange(astNode);
  const layout = scanModelicaClassLayout(docText, classInstance?.name, classRange?.startLine);
  if (!layout) return [];

  const scannedComp = layout.components.find((c) => c.name === componentName);
  if (!scannedComp) return [];

  const shouldRemove = newValue === "";
  const { lineStarts, maskedText } = layout;

  if (scannedComp.modOpenParenOffset !== null && scannedComp.modCloseParenOffset !== null) {
    const innerStart = scannedComp.modOpenParenOffset + 1;
    const innerEnd = scannedComp.modCloseParenOffset;
    const segments = splitTopLevelModificationSegments(docText, maskedText, innerStart, innerEnd);
    const escParam = parameterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const argHeadRegex = new RegExp(`^(?:(?:each|final|redeclare|replaceable)\\s+)*${escParam}\\s*(?:=|\\(|$)`);

    const argIndex = segments.findIndex((seg) => argHeadRegex.test(maskedText.slice(seg.trimmedStart, seg.trimmedEnd)));

    if (argIndex !== -1) {
      const seg = segments[argIndex]!;
      if (shouldRemove) {
        if (segments.length <= 1) {
          const startPos = offsetToPosition(lineStarts, scannedComp.modOpenParenOffset);
          const endPos = offsetToPosition(lineStarts, scannedComp.modEndOffset ?? scannedComp.modCloseParenOffset + 1);
          return [TextEdit.replace(Range.create(startPos, endPos), "")];
        }
        if (argIndex < segments.length - 1) {
          const nextSeg = segments[argIndex + 1]!;
          const startPos = offsetToPosition(lineStarts, seg.trimmedStart);
          const endPos = offsetToPosition(lineStarts, nextSeg.trimmedStart);
          return [TextEdit.replace(Range.create(startPos, endPos), "")];
        }
        const prevSeg = segments[argIndex - 1]!;
        const startPos = offsetToPosition(lineStarts, prevSeg.trimmedEnd);
        const endPos = offsetToPosition(lineStarts, seg.trimmedEnd);
        return [TextEdit.replace(Range.create(startPos, endPos), "")];
      }

      // Find top-level `=` inside this argument segment
      let depth = 0;
      let eqOffset = -1;
      for (let i = seg.trimmedStart; i < seg.trimmedEnd; i++) {
        const ch = maskedText[i];
        if (ch === "(" || ch === "{" || ch === "[") depth++;
        else if (ch === ")" || ch === "}" || ch === "]") {
          if (depth > 0) depth--;
        } else if (ch === "=" && depth === 0 && maskedText[i + 1] !== "=" && maskedText[i - 1] !== ":") {
          eqOffset = i;
          break;
        }
      }

      if (eqOffset !== -1) {
        const afterEq = docText.slice(eqOffset + 1, seg.trimmedEnd);
        const hasSpace = /^\s+/.test(afterEq);
        const startPos = offsetToPosition(lineStarts, eqOffset);
        const endPos = offsetToPosition(lineStarts, seg.trimmedEnd);
        return [TextEdit.replace(Range.create(startPos, endPos), `${hasSpace ? "= " : "="}${newValue}`)];
      }

      const startPos = offsetToPosition(lineStarts, seg.trimmedStart);
      const endPos = offsetToPosition(lineStarts, seg.trimmedEnd);
      return [TextEdit.replace(Range.create(startPos, endPos), `${parameterName} = ${newValue}`)];
    }

    if (shouldRemove) return [];
    const closePos = offsetToPosition(lineStarts, innerEnd);
    const hasArgs = segments.length > 0;
    return [TextEdit.insert(closePos, `${hasArgs ? ", " : ""}${parameterName} = ${newValue}`)];
  }

  if (shouldRemove) return [];
  const insertOffset = scannedComp.subscriptsEndOffset ?? scannedComp.identEndOffset;
  const insertPos = offsetToPosition(lineStarts, insertOffset);
  return [TextEdit.insert(insertPos, `(${parameterName}=${newValue})`)];
}

export function computeParameterEdit(
  classInstance: ModelicaClassInstance,
  componentName: string,
  parameterName: string,
  newValue: string,
  docText?: string,
): TextEdit[] {
  const docLines = docText !== undefined ? docText.split("\n") : null;
  const component = Array.from(classInstance?.components ?? []).find((c: any) => c.name === componentName);
  if (!component) {
    return docText !== undefined
      ? computeScannedParameterEdit(docText, classInstance, componentName, parameterName, newValue)
      : [];
  }

  const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
  if (!abstractNode) {
    return docText !== undefined
      ? computeScannedParameterEdit(docText, classInstance, componentName, parameterName, newValue)
      : [];
  }

  const declNode = getDeclarationNode(abstractNode) ?? abstractNode;

  // When docText is provided, verify the component CST node still aligns with docText
  if (docLines) {
    const declRange = getNodeRange(declNode);
    if (declRange) {
      const actualSlice = getTextInRange(
        docLines,
        declRange.startLine,
        declRange.startCol,
        declRange.endLine,
        declRange.endCol,
      );
      const escComp = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\b${escComp}\\b`).test(actualSlice)) {
        return computeScannedParameterEdit(docText!, classInstance, componentName, parameterName, newValue);
      }
    }
  }

  const shouldRemove = newValue === "";

  // 1. Check for real CST structure (nodes with children / startPosition)
  const modNode = getModificationNode(declNode);
  const classModNode = modNode
    ? (modNode.children?.find((c: any) => Cst.ClassModification.is(c)) ??
      (Cst.ClassModification.is(modNode) ? modNode : null))
    : null;

  if (classModNode && classModNode.children && classModNode.children.length > 0) {
    const argListNode = classModNode.children?.find((c: any) => Cst.ArgumentList.is(c));
    const containerNode = argListNode ?? classModNode;
    const existingArg = findArgumentByName(containerNode, parameterName);

    if (existingArg) {
      if (shouldRemove) {
        const allArgs = getAllArgumentNodes(containerNode);
        if (allArgs.length <= 1) {
          // Sole argument: remove entire modification
          const target = modNode ?? classModNode;
          const patchRes = CstUnparser.patchAndUnparse({
            target,
            replaceText: "",
          });
          return [
            TextEdit.replace(
              Range.create(
                patchRes.edit.range.start.line,
                patchRes.edit.range.start.character,
                patchRes.edit.range.end.line,
                patchRes.edit.range.end.character,
              ),
              patchRes.edit.newText,
            ),
          ];
        }

        // Multiple arguments: delete this argument from argument_list
        const patchRes = CstUnparser.patchAndUnparse({
          target: containerNode,
          deleteChildren: [existingArg.argumentNode],
        });
        return [
          TextEdit.replace(
            Range.create(
              patchRes.edit.range.start.line,
              patchRes.edit.range.start.character,
              patchRes.edit.range.end.line,
              patchRes.edit.range.end.character,
            ),
            patchRes.edit.newText,
          ),
        ];
      }

      // Update existing argument value
      if (existingArg.valueModNode) {
        const hasSpaceAfterEq = /^=\s+/.test(existingArg.valueModNode.text || "");
        const newModText = hasSpaceAfterEq ? `= ${newValue}` : `=${newValue}`;
        const patchRes = CstUnparser.patchAndUnparse({
          target: existingArg.valueModNode,
          replaceText: newModText,
        });
        return [
          TextEdit.replace(
            Range.create(
              patchRes.edit.range.start.line,
              patchRes.edit.range.start.character,
              patchRes.edit.range.end.line,
              patchRes.edit.range.end.character,
            ),
            patchRes.edit.newText,
          ),
        ];
      } else {
        const patchRes = CstUnparser.patchAndUnparse({
          target: existingArg.elementModNode,
          replaceText: `${parameterName} = ${newValue}`,
        });
        return [
          TextEdit.replace(
            Range.create(
              patchRes.edit.range.start.line,
              patchRes.edit.range.start.character,
              patchRes.edit.range.end.line,
              patchRes.edit.range.end.character,
            ),
            patchRes.edit.newText,
          ),
        ];
      }
    } else {
      // Argument not found, append to existing class modification
      if (shouldRemove) return [];
      const patchRes = CstUnparser.patchAndUnparse({
        target: containerNode,
        insertChildren: [
          {
            content: `${parameterName} = ${newValue}`,
            position: "end",
            separator: ", ",
          },
        ],
      });
      return [
        TextEdit.replace(
          Range.create(
            patchRes.edit.range.start.line,
            patchRes.edit.range.start.character,
            patchRes.edit.range.end.line,
            patchRes.edit.range.end.character,
          ),
          patchRes.edit.newText,
        ),
      ];
    }
  }

  // 2. Legacy mock AST fallback (e.g. unit tests with modification.classModification.modificationArguments)
  if (declNode.modification?.classModification?.modificationArguments) {
    const classMod = declNode.modification.classModification;

    const argIndex = classMod.modificationArguments.findIndex((arg: any) => {
      if (!arg.name) return false;

      const nameText = arg.name.parts.map((p: any) => p.text).join(".");
      return nameText === parameterName;
    });

    if (argIndex !== -1) {
      const existingArg = classMod.modificationArguments[argIndex];
      const argRange = getNodeRange(existingArg);
      if (shouldRemove) {
        let startLine = argRange?.startLine ?? existingArg.startPosition.row;
        let startCol = argRange?.startCol ?? existingArg.startPosition.column;
        let endLine = argRange?.endLine ?? existingArg.endPosition.row;
        let endCol = argRange?.endCol ?? existingArg.endPosition.column;

        const nextArg = classMod.modificationArguments[argIndex + 1];
        const nextRange = getNodeRange(nextArg);
        if (nextRange) {
          endLine = nextRange.startLine;
          endCol = nextRange.startCol;
        } else if (argIndex > 0) {
          const prevArg = classMod.modificationArguments[argIndex - 1];
          const prevRange = getNodeRange(prevArg);
          if (prevRange) {
            startLine = prevRange.endLine;
            startCol = prevRange.endCol;
          }
        } else {
          // Only argument — remove the entire class modification
          const modRange = getNodeRange(classMod);
          if (modRange) {
            return [
              TextEdit.replace(
                Range.create(modRange.startLine, modRange.startCol, modRange.endLine, modRange.endCol),
                "",
              ),
            ];
          }
        }

        return [TextEdit.replace(Range.create(startLine, startCol, endLine, endCol), "")];
      }

      // Update existing argument value
      const existingMod = existingArg.modification;
      const modRange = getNodeRange(existingMod);
      if (modRange) {
        return [
          TextEdit.replace(
            Range.create(modRange.startLine, modRange.startCol, modRange.endLine, modRange.endCol),
            `=${newValue}`,
          ),
        ];
      } else if (argRange) {
        return [
          TextEdit.replace(
            Range.create(argRange.startLine, argRange.startCol, argRange.endLine, argRange.endCol),
            `${parameterName}=${newValue}`,
          ),
        ];
      }
    } else {
      // Add new argument to existing modification
      if (shouldRemove) return [];
      const hasArgs = classMod.modificationArguments.length > 0;
      const modRange = getNodeRange(classMod);
      const endLine = modRange?.endLine ?? classMod.endPosition.row;
      const endCol = modRange?.endCol ?? classMod.endPosition.column;
      return [
        TextEdit.insert({ line: endLine, character: endCol - 1 }, `${hasArgs ? ", " : ""}${parameterName}=${newValue}`),
      ];
    }
  }

  // 3. No existing modification — insert after identifier / subscripts
  if (shouldRemove) return [];
  const identNode = getDeclarationIdentNode(declNode);
  const subscriptsNode = getSubscriptsNode(declNode);
  let pos: { row: number; column: number } | null = null;
  const subRange = getNodeRange(subscriptsNode);
  const idRange = getNodeRange(identNode);
  if (subRange) {
    pos = { row: subRange.endLine, column: subRange.endCol };
  } else if (idRange) {
    pos = { row: idRange.endLine, column: idRange.endCol };
  }

  if (pos) {
    return [TextEdit.insert({ line: pos.row, character: pos.column }, `(${parameterName}=${newValue})`)];
  }

  if (docText !== undefined) {
    return computeScannedParameterEdit(docText, classInstance, componentName, parameterName, newValue);
  }

  return [];
}

// ── Component Insert ──

export function computeComponentInsert(
  classInstance: ModelicaClassInstance,
  className: string,
  componentName: string,
  x: number,
  y: number,
  docText: string,
): TextEdit[] {
  const diagram: any = typeof classInstance?.annotation === "function" ? classInstance.annotation("Diagram") : null;
  const initialScale = diagram?.coordinateSystem?.initialScale ?? 0.1;
  const extent = diagram?.coordinateSystem?.extent;

  let width = 200;
  let height = 200;
  if (extent && extent.length >= 2) {
    width = Math.abs(extent[1][0] - extent[0][0]);
    height = Math.abs(extent[1][1] - extent[0][1]);
  }
  const w = width * initialScale;
  const h = height * initialScale;

  const originX = Math.round(x);
  const originY = -Math.round(y);
  const annotation = `annotation(Placement(transformation(origin={${originX},${originY}}, extent={{-${w / 2},-${h / 2}},{${w / 2},${h / 2}}})))`;
  const componentDecl = `  ${className} ${componentName} ${annotation};\n`;

  const lines = docText.split("\n");
  const astNode = (classInstance as any)?.cstNode ?? (classInstance as any)?.abstractSyntaxNode;
  const classRange = getNodeRange(astNode);
  const modelStartLine = classRange ? classRange.startLine : 0;

  // Canonical Modelica composition section ordering via comment/string-masked balanced scanner:
  // Always insert public component declarations strictly BEFORE:
  //   protected / initial equation / equation / initial algorithm / algorithm / external /
  //   trailing class-level annotation(...) / end <ClassName>;
  const layout = scanModelicaClassLayout(docText, classInstance?.name, classRange?.startLine);
  if (layout) {
    let boundaryOffset = layout.endKeywordOffset;

    for (const sec of layout.sections) {
      if (sec.kind !== "public" && sec.keywordOffset < boundaryOffset) {
        boundaryOffset = sec.keywordOffset;
      }
    }

    for (const ca of layout.classAnnotations) {
      if (!ca.isStrandedBeforeBodyElements && ca.keywordOffset < boundaryOffset) {
        boundaryOffset = ca.keywordOffset;
      }
    }

    const boundPos = offsetToPosition(layout.lineStarts, boundaryOffset);
    const boundLineText = lines[boundPos.line] ?? "";
    const prefixBeforeBound = boundLineText.slice(0, boundPos.character).trim();

    if (prefixBeforeBound.length > 0) {
      // Single-line header+boundary (e.g. `model M end M;` or `model M annotation(...); end M;`)
      return [TextEdit.insert(boundPos, "\n" + componentDecl)];
    }

    // Pure zero-length insert at column 0 of the boundary line so multiple component inserts
    // in the same batch never overwrite or cancel each other out.
    return [TextEdit.insert(Position.create(boundPos.line, 0), componentDecl)];
  }

  // Fallback when source lacks a balanced `model ... end ...` wrapper
  const modelEndLine = classRange ? Math.min(lines.length - 1, classRange.endLine) : lines.length - 1;
  const boundaryKeywords = [
    "protected",
    "initial equation",
    "initial algorithm",
    "equation",
    "algorithm",
    "external",
    "end",
  ];
  for (let i = modelStartLine + 1; i <= modelEndLine; i++) {
    const trimmed = lines[i]!.trim();
    if (boundaryKeywords.some((kw) => trimmed === kw || trimmed.startsWith(`${kw} `) || trimmed.startsWith(`${kw};`))) {
      return [TextEdit.insert(Position.create(i, 0), componentDecl)];
    }
  }

  return [];
}

// ── Diagram Coordinate System Edits (Bounds & Grid) ──

export interface CoordinateSystemEditOptions {
  extent?: [[number, number], [number, number]];
  grid?: [number, number];
  preserveAspectRatio?: boolean;
  initialScale?: number;
}

/**
 * Computes TextEdits to update, insert, or resize the diagram coordinate system
 * (extent, grid, aspect ratio, initialScale) in the Modelica source text.
 */
export function computeCoordinateSystemEdits(
  docText: string,
  classInstance: ModelicaClassInstance,
  options: CoordinateSystemEditOptions,
): TextEdit[] {
  const lines = docText.split("\n");
  const astNode = (classInstance as any)?.cstNode ?? (classInstance as any)?.abstractSyntaxNode;
  const classRange = getNodeRange(astNode);

  // Build the new coordinateSystem(...) arguments string
  const formatCoordSys = (existing?: {
    extent?: [[number, number], [number, number]];
    grid?: [number, number];
    preserveAspectRatio?: boolean;
    initialScale?: number;
  }) => {
    const preserveAspectRatio =
      options.preserveAspectRatio !== undefined ? options.preserveAspectRatio : (existing?.preserveAspectRatio ?? true);
    const extent = options.extent ??
      existing?.extent ?? [
        [-100, -100],
        [100, 100],
      ];
    const grid = options.grid ?? existing?.grid;
    const initialScale = options.initialScale ?? existing?.initialScale;

    const parts: string[] = [];
    if (preserveAspectRatio !== undefined) {
      parts.push(`preserveAspectRatio = ${preserveAspectRatio}`);
    }
    if (extent) {
      parts.push(`extent = {{${extent[0][0]}, ${extent[0][1]}}, {${extent[1][0]}, ${extent[1][1]}}}`);
    }
    if (grid) {
      parts.push(`grid = {${grid[0]}, ${grid[1]}}`);
    }
    if (initialScale !== undefined) {
      parts.push(`initialScale = ${initialScale}`);
    }
    return `coordinateSystem(${parts.join(", ")})`;
  };

  const existingDiagram: any =
    typeof classInstance?.annotation === "function" ? classInstance.annotation("Diagram") : null;
  const existingCoordSys = existingDiagram?.coordinateSystem;
  const newCoordSysCall = formatCoordSys(existingCoordSys);

  const layout = scanModelicaClassLayout(docText, classInstance?.name, classRange?.startLine);
  if (layout) {
    const { lineStarts, maskedText, classAnnotations } = layout;

    // 1. Inspect ONLY standalone class-level annotation(...) clauses (never component or connect annotations,
    //    and never comments/strings) for an existing `Diagram(...)` modification.
    for (let idx = classAnnotations.length - 1; idx >= 0; idx--) {
      const ca = classAnnotations[idx]!;
      const annInnerStart = ca.openParenOffset + 1;
      const annClose = ca.closeParenOffset;
      const maskedAnnInner = maskedText.slice(annInnerStart, annClose);
      const diagramMatch = maskedAnnInner.match(/\bDiagram\s*\(/);
      if (!diagramMatch || diagramMatch.index === undefined) continue;

      const diagOpenOffset = annInnerStart + diagramMatch.index + diagramMatch[0].length - 1;
      const diagCloseOffset = findBalancedClose(maskedText, diagOpenOffset, annClose);
      if (diagCloseOffset === -1) continue;

      const diagInnerStart = diagOpenOffset + 1;
      const maskedDiagInner = maskedText.slice(diagInnerStart, diagCloseOffset);
      const csMatch = maskedDiagInner.match(/\bcoordinateSystem\s*\(/);
      if (csMatch && csMatch.index !== undefined) {
        const csStartOffset = diagInnerStart + csMatch.index;
        const csOpenOffset = csStartOffset + csMatch[0].length - 1;
        const csCloseOffset = findBalancedClose(maskedText, csOpenOffset, diagCloseOffset);
        if (csCloseOffset !== -1) {
          const startPos = offsetToPosition(lineStarts, csStartOffset);
          const endPos = offsetToPosition(lineStarts, csCloseOffset + 1);
          return [TextEdit.replace(Range.create(startPos, endPos), newCoordSysCall)];
        }
      }

      // Diagram(...) exists without coordinateSystem(...) — insert as first argument
      const insertPos = offsetToPosition(lineStarts, diagInnerStart);
      const hasDiagArgs = docText.slice(diagInnerStart, diagCloseOffset).trim().length > 0;
      const prefix = hasDiagArgs ? `${newCoordSysCall}, ` : newCoordSysCall;
      return [TextEdit.insert(insertPos, prefix)];
    }

    // 2. If a standalone class-level annotation(...) exists without Diagram(...), insert Diagram(...) into it
    if (classAnnotations.length > 0) {
      const targetAnn =
        [...classAnnotations].reverse().find((ca) => !ca.isStrandedBeforeBodyElements) ??
        classAnnotations[classAnnotations.length - 1]!;
      const annInnerStart = targetAnn.openParenOffset + 1;
      const hasAnnArgs = docText.slice(annInnerStart, targetAnn.closeParenOffset).trim().length > 0;
      const insertPos = offsetToPosition(lineStarts, annInnerStart);
      const toInsert = hasAnnArgs ? `Diagram(${newCoordSysCall}), ` : `Diagram(${newCoordSysCall})`;
      return [TextEdit.insert(insertPos, toInsert)];
    }

    // 3. No class-level annotation exists yet — insert right before `end <ClassName>;`
    const endPos = offsetToPosition(lineStarts, layout.endKeywordOffset);
    const endLineContent = lines[endPos.line] ?? "";
    const newClause = `  annotation(Diagram(${newCoordSysCall}));\n`;
    if (endLineContent.slice(0, endPos.character).trim() === "") {
      return [TextEdit.insert(Position.create(endPos.line, 0), newClause)];
    }
    return [TextEdit.insert(endPos, `\n${newClause}`)];
  }

  return [];
}
