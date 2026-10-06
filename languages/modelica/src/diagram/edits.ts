// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Diagram-to-code edit computation.
// Ported from morsel's morsel.tsx (getPlacementEdit, getConnectEdits,
// handleEdgeDelete, handleComponentsDelete) to produce LSP TextEdit arrays.
/* eslint-disable @typescript-eslint/no-explicit-any */

type ModelicaClassInstance = any;
import { CstUnparser } from "@modelscript/dsl";
import { Range, TextEdit } from "vscode-languageserver";

import type { EdgeUpdate as EdgeItem, PlacementItem } from "@modelscript/diagram/protocol";
import { Cst } from "../../src-gen/bindings.js";
import { inferModelicaDomainColor } from "./data.js";

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

function getPlacementEdit(lines: string[], classInstance: ModelicaClassInstance, item: PlacementItem): TextEdit | null {
  const component = Array.from(classInstance.components).find((c: any) => c.name === item.name);
  if (!component) return null;

  const originX = Math.round(item.x + item.width / 2);
  const originY = Math.round(-(item.y + item.height / 2));
  const w = Math.round(item.width);
  const h = Math.round(item.height);
  const r = Math.round(-(item.rotation ?? 0));

  const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
  const compRange = getNodeRange(abstractNode);
  if (!compRange) return null;

  let startLine = compRange.startLine;
  let startCol = compRange.startCol;
  let endLine = compRange.endLine;
  let endCol = compRange.endCol;

  let text = getTextInRange(lines, startLine, startCol, endLine, endCol);

  // Validate extracted text contains the component name (guards against stale AST / line shifts)
  let lineDelta = 0;
  if (!text.includes(item.name)) {
    const escName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRegex = new RegExp(`\\b${escName}\\b`);
    let foundLine = -1;
    const minLine = Math.max(0, startLine - 15);
    const maxLine = Math.min(lines.length - 1, startLine + 15);
    for (let l = minLine; l <= maxLine; l++) {
      if (nameRegex.test(lines[l])) {
        foundLine = l;
        break;
      }
    }
    if (foundLine === -1) {
      for (let l = 0; l < lines.length; l++) {
        if (nameRegex.test(lines[l])) {
          foundLine = l;
          break;
        }
      }
    }
    if (foundLine !== -1) {
      lineDelta = foundLine - startLine;
      startLine += lineDelta;
      endLine += lineDelta;
      text = getTextInRange(lines, startLine, startCol, endLine, endCol);
      if (!text.includes(item.name)) {
        startLine = foundLine;
        endLine = foundLine;
        startCol = 0;
        endCol = lines[foundLine].length;
        text = lines[foundLine];
      }
    }
  }

  if (!text.includes(item.name)) return null;

  const range = Range.create(startLine, startCol, endLine, endCol);

  const rotationPart = r !== 0 ? `, rotation=${r}` : "";

  // Detect flip from the original extent in the source text
  let flipX = false;
  let flipY = false;

  const placement: any = (component as any).annotation("Placement");
  const extent = placement?.transformation?.extent;
  if (extent && extent.length >= 2) {
    const [[x1, y1], [x2, y2]] = extent;
    if (!isNaN(x1) && !isNaN(x2)) flipX = x1 > x2;
    if (!isNaN(y1) && !isNaN(y2)) flipY = y1 > y2;
  }

  const ex1 = flipX ? w / 2 : -(w / 2);
  const ex2 = flipX ? -(w / 2) : w / 2;
  const ey1 = flipY ? h / 2 : -(h / 2);
  const ey2 = flipY ? -(h / 2) : h / 2;
  const newTransformationCore = `origin={${originX},${originY}}, extent={{${ex1},${ey1}},{${ex2},${ey2}}}${rotationPart}`;
  const newPlacement = `Placement(transformation(${newTransformationCore}))`;

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
        return TextEdit.replace(
          Range.create(
            patchRes.edit.range.start.line + lineDelta,
            patchRes.edit.range.start.character,
            patchRes.edit.range.end.line + lineDelta,
            patchRes.edit.range.end.character,
          ),
          patchRes.edit.newText,
        );
      }

      const classModNode = annotationClause.children?.find((c: any) => Cst.ClassModification.is(c));
      if (classModNode && classModNode.children && classModNode.children.length > 0) {
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
            patchRes.edit.range.start.line + lineDelta,
            patchRes.edit.range.start.character,
            patchRes.edit.range.end.line + lineDelta,
            patchRes.edit.range.end.character,
          ),
          patchRes.edit.newText,
        );
      }
    }

    const annStartLine = annRangeInfo.startLine + lineDelta;
    const annEndLine = annRangeInfo.endLine + lineDelta;
    const annRange = Range.create(annStartLine, annRangeInfo.startCol, annEndLine, annRangeInfo.endCol);
    const annText = getTextInRange(lines, annStartLine, annRangeInfo.startCol, annEndLine, annRangeInfo.endCol);

    const annotationMatch = annText.match(/annotation\s*\(/);
    if (annotationMatch) {
      const annStart = annotationMatch.index ?? 0;
      const annContentStart = annStart + annotationMatch[0].length;
      const annEndIndex = findMatchingParen(annText, annContentStart);

      if (annEndIndex !== -1) {
        let annotationContent = annText.substring(annContentStart, annEndIndex);

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

        const trimmed = annotationContent.trim();
        const separator = trimmed.length > 0 ? ", " : "";
        const newText =
          annText.substring(0, annContentStart) + newPlacement + separator + trimmed + annText.substring(annEndIndex);
        if (newText !== annText) {
          return TextEdit.replace(annRange, newText);
        }
      }
    }
  } else {
    // No annotation clause exists, insert a new one before the semi-colon
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
  const component = Array.from(classInstance.components).find((c: any) => c.name === item.name);
  if (!component) return null;

  const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
  const compRange = getNodeRange(abstractNode);
  if (!compRange) return null;

  const { startLine, startCol, endLine, endCol } = compRange;
  const text = getTextInRange(lines, startLine, startCol, endLine, endCol);

  // If the component already has a Placement annotation, skip — no edit needed
  if (/Placement\s*\(/.test(text)) return null;

  // Component lacks Placement — add one using the current diagram position
  return getPlacementEdit(lines, classInstance, item);
}

// ── Add connect equation ──

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

  const astNode = (classInstance as any).cstNode ?? (classInstance as any).abstractSyntaxNode;
  const classRange = getNodeRange(astNode);
  const modelStartLine = classRange ? classRange.startLine : 0;
  const modelEndLine = classRange ? classRange.endLine : lines.length - 1;

  if (astNode) {
    const findEquationSection = (node: any): any => {
      if (!node) return null;
      if (Cst.EquationSection.is(node)) {
        return node;
      }
      for (const child of node.children || []) {
        const found = findEquationSection(child);
        if (found) return found;
      }
      return null;
    };

    const eqSection = findEquationSection(astNode);
    if (eqSection) {
      const eqRange = getNodeRange(eqSection);
      if (eqRange) {
        return [TextEdit.insert({ line: eqRange.endLine, character: 0 }, connectEq)];
      }
    }

    const classSpecifier =
      astNode.classOrInheritanceModification?.classSpecifier ||
      astNode.classSpecifier ||
      (Cst.ClassDefinition.is(astNode) ? Cst.ClassDefinition.classSpecifier(astNode) : null) ||
      astNode.children?.find?.((c: any) => Cst.ClassSpecifier.is(c) || Cst.LongClassSpecifier.is(c));

    const sections: any[] = classSpecifier?.sections ?? [];

    let lastEquationSection: any = null;
    let baseEquationSection: any = null;

    for (const section of sections) {
      // Find the last equation section
      if (section.equations !== undefined && section.initial !== true) {
        lastEquationSection = section;
        // The first equation section without 'initial' is typically the base equation section
        if (!baseEquationSection) {
          baseEquationSection = section;
        }
      }
    }

    const targetSection = lastEquationSection || baseEquationSection;
    const targetRange = getNodeRange(targetSection);
    if (targetRange) {
      return [TextEdit.insert({ line: targetRange.endLine, character: 0 }, connectEq)];
    }

    // No equation section exists. Insert just before the class specifies 'end'.
    const classEndPos = classSpecifier?.endPosition ?? astNode.endPosition;
    if (classEndPos) {
      // Insert before 'end' line
      return [TextEdit.insert({ line: classEndPos.row, character: 0 }, `equation\n${connectEq}`)];
    }
  }

  // Fallback to basic keyword scan if CST is completely unavailable (e.g., highly malformed text)
  let equationLine = -1;
  for (let i = modelStartLine; i <= modelEndLine; i++) {
    if (lines[i].trim() === "equation" || lines[i].trim().startsWith("equation ")) {
      equationLine = i;
      break;
    }
  }

  if (equationLine !== -1) {
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

  for (let i = modelEndLine; i >= modelStartLine; i--) {
    if (lines[i].trim().startsWith("end")) {
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

function getConnectEndpoints(ce: any): { source: string; target: string } {
  const source =
    ce.lhs ??
    ce.componentReference1?.parts
      ?.map((c: { identifier?: { text: string }; text?: string }) => c.identifier?.text ?? c.text ?? "")
      ?.join(".") ??
    "";
  const target =
    ce.rhs ??
    ce.componentReference2?.parts
      ?.map((c: { identifier?: { text: string }; text?: string }) => c.identifier?.text ?? c.text ?? "")
      ?.join(".") ??
    "";
  return { source, target };
}

export function computeConnectRemove(
  docText: string,
  classInstance: ModelicaClassInstance,
  source: string,
  target: string,
): TextEdit[] {
  const lines = docText.split("\n");

  const connectEq: any = Array.from(classInstance.connectEquations).find((ce: any) => {
    const { source: c1, target: c2 } = getConnectEndpoints(ce);
    return (c1 === source && c2 === target) || (c1 === target && c2 === source);
  });

  const eqNode = connectEq?.cstNode ?? connectEq?.ast;
  const eqRange = getNodeRange(eqNode);
  if (!eqRange) return [];

  return [makeDeleteRange(lines, eqRange.startLine, eqRange.startCol, eqRange.endLine, eqRange.endCol)];
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

  Array.from(classInstance.connectEquations).forEach((ce: any) => {
    const { source: c1, target: c2 } = getConnectEndpoints(ce);
    const involvesComponent = [...nameSet].some(
      (name) => c1 === name || c1.startsWith(`${name}.`) || c2 === name || c2.startsWith(`${name}.`),
    );
    const eqNode = ce.cstNode ?? ce.ast;
    const eqRange = getNodeRange(eqNode);
    if (involvesComponent && eqRange) {
      edits.push(makeDeleteRange(lines, eqRange.startLine, eqRange.startCol, eqRange.endLine, eqRange.endCol));
    }
  });

  // Remove component declarations
  for (const name of names) {
    const component = Array.from(classInstance.components).find((c: any) => c.name === name);
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

export function computeEdgePointEdits(
  lines: string[],
  classInstance: ModelicaClassInstance,
  edges: EdgeItem[],
): TextEdit[] {
  const edits: TextEdit[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    const connectEq: any = Array.from(classInstance.connectEquations).find((ce: any) => {
      const { source: c1, target: c2 } = getConnectEndpoints(ce);
      return (c1 === edge.source && c2 === edge.target) || (c1 === edge.target && c2 === edge.source);
    });

    const eqNode = connectEq?.cstNode ?? connectEq?.ast;
    const eqRange = getNodeRange(eqNode);
    if (!eqRange) continue;

    const { startLine, startCol, endLine, endCol } = eqRange;

    const key = `${startLine}:${startCol}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const range = Range.create(startLine, startCol, endLine, endCol);
    const text = getTextInRange(lines, startLine, startCol, endLine, endCol);

    // Validate it's actually a connect equation
    if (!text.match(/^\s*connect\s*\(/)) continue;

    const pointsStr = `{${edge.points.map((p) => `{${p.x},${p.y}}`).join(", ")}}`;
    const newPointsCore = `points=${pointsStr}`;
    const colorCore = "color={0, 0, 255}";
    const newLineAnnotation = `Line(${newPointsCore}, ${colorCore})`;

    let newText = text;

    const annotationClause = getAnnotationClauseNode(eqNode);
    const annRangeInfo = getNodeRange(annotationClause);

    if (annRangeInfo) {
      if (annotationClause) {
        const lineNode = findDescendantModification(annotationClause, "Line");
        if (lineNode && lineNode.startPosition) {
          const patchRes = CstUnparser.patchAndUnparse({
            target: lineNode,
            replaceText: newLineAnnotation,
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
          continue;
        }

        const classModNode = annotationClause.children?.find((c: any) => Cst.ClassModification.is(c));
        if (classModNode && classModNode.children && classModNode.children.length > 0) {
          const patchRes = CstUnparser.patchAndUnparse({
            target: classModNode,
            insertChildren: [
              {
                content: newLineAnnotation,
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
          continue;
        }
      }

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

      const annotationMatch = annText.match(/annotation\s*\(/);
      if (annotationMatch) {
        const annStartIndex = annotationMatch.index ?? 0;
        const annContentStart = annStartIndex + annotationMatch[0].length;
        const annEndIndex = findMatchingParen(annText, annContentStart);
        if (annEndIndex !== -1) {
          let annotationContent = annText.substring(annContentStart, annEndIndex);

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

          const trimmed = annotationContent.trim();
          const separator = trimmed.length > 0 ? ", " : "";
          newText =
            annText.substring(0, annContentStart) +
            trimmed +
            separator +
            newLineAnnotation +
            annText.substring(annEndIndex);
          if (newText !== annText) {
            edits.push(TextEdit.replace(annRange, newText));
            continue;
          }
        }
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

    const before = lines[sl].substring(0, sc);
    const after = lines[el].substring(ec);

    const newLines = edit.newText.split("\n");
    newLines[0] = before + newLines[0];
    newLines[newLines.length - 1] += after;

    lines.splice(sl, el - sl + 1, ...newLines);
  }
  return lines.join("\n");
}

export function deduplicateAndSort(edits: TextEdit[]): TextEdit[] {
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
  const component = Array.from(classInstance.components).find((c: any) => c.name === oldName);
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
  const component = Array.from(classInstance.components).find((c: any) => c.name === componentName);
  if (!component) return [];

  const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
  const descriptionNode = findDescriptionStringNode(abstractNode);
  const escapedDescription = newDescription.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const descRange = getNodeRange(descriptionNode);
  if (descRange) {
    if (newDescription === "") {
      const lines = docText.split("\n");
      const descStartLine = descRange.startLine;
      const descStartCol = descRange.startCol;
      const descEndLine = descRange.endLine;
      const descEndCol = descRange.endCol;
      const lineContent = lines[descStartLine];
      let col = descStartCol - 1;
      while (col >= 0 && (lineContent[col] === " " || lineContent[col] === "\t")) {
        col--;
      }
      const removeStartCol = col + 1;
      return [TextEdit.replace(Range.create(descStartLine, removeStartCol, descEndLine, descEndCol), "")];
    }
    return [
      TextEdit.replace(
        Range.create(descRange.startLine, descRange.startCol, descRange.endLine, descRange.endCol),
        `"${escapedDescription}"`, // no leading space when replacing
      ),
    ];
  } else {
    if (newDescription === "") return [];
    const declNode = getDeclarationNode(abstractNode);
    const modificationNode = getModificationNode(declNode ?? abstractNode);
    const subscriptsNode = getSubscriptsNode(declNode ?? abstractNode);
    const identNode = getDeclarationIdentNode(declNode ?? abstractNode);

    let pos: { row: number; column: number } | null = null;
    const modRange = getNodeRange(modificationNode);
    const subRange = getNodeRange(subscriptsNode);
    const idRange = getNodeRange(identNode);

    if (modRange) {
      pos = { row: modRange.endLine, column: modRange.endCol };
    } else if (subRange) {
      pos = { row: subRange.endLine, column: subRange.endCol };
    } else if (idRange) {
      pos = { row: idRange.endLine, column: idRange.endCol };
    }

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

export function computeParameterEdit(
  classInstance: ModelicaClassInstance,
  componentName: string,
  parameterName: string,
  newValue: string,
): TextEdit[] {
  const component = Array.from(classInstance.components).find((c: any) => c.name === componentName);
  if (!component) return [];

  const abstractNode = (component as any).cstNode ?? (component as any).abstractSyntaxNode;
  if (!abstractNode) return [];

  const declNode = getDeclarationNode(abstractNode) ?? abstractNode;
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
  const diagram: any = classInstance.annotation("Diagram");
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

  const astNode = (classInstance as any).cstNode ?? (classInstance as any).abstractSyntaxNode;
  const classRange = getNodeRange(astNode);
  const modelStartLine = classRange ? classRange.startLine : 0;
  const modelEndLine = classRange ? classRange.endLine : lines.length - 1;

  const keywords = ["protected", "initial equation", "initial algorithm", "equation", "algorithm", "end"];
  let insertLine = -1;
  for (let i = modelStartLine; i <= modelEndLine; i++) {
    const line = lines[i].trim();
    if (keywords.some((kw) => line.startsWith(kw))) {
      insertLine = i;
      break;
    }
  }

  if (insertLine !== -1) {
    if (insertLine > modelStartLine && lines[insertLine - 1].trim() === "") {
      // Replace the empty line before the section
      return [TextEdit.replace(Range.create(insertLine - 1, 0, insertLine, 0), componentDecl)];
    } else {
      return [TextEdit.insert({ line: insertLine, character: 0 }, componentDecl)];
    }
  } else {
    // Fallback: find the last "end" within this model's range
    const modelLines = lines.slice(modelStartLine, modelEndLine + 1);
    const modelText = modelLines.join("\n");
    const lastEndIndex = modelText.lastIndexOf("end");
    if (lastEndIndex !== -1) {
      const linesBeforeEnd = modelText.substring(0, lastEndIndex).split("\n").length - 1;
      const endLineNumber = modelStartLine + linesBeforeEnd;
      const endLineContent = lines[endLineNumber];
      const endCol = endLineContent.lastIndexOf("end");
      const beforeEnd = endLineContent.substring(0, endCol).trimEnd();

      if (beforeEnd !== "") {
        // Single-line model: insert at the "end" keyword column with newlines
        return [TextEdit.insert({ line: endLineNumber, character: endCol }, "\n" + componentDecl)];
      } else {
        return [TextEdit.insert({ line: endLineNumber, character: 0 }, componentDecl)];
      }
    }
  }

  return [];
}
