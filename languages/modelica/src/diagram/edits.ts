// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Diagram-to-code edit computation.
// Ported from ansatz's ansatz.tsx (getPlacementEdit, getConnectEdits,
// handleEdgeDelete, handleComponentsDelete) to produce LSP TextEdit arrays.

import { CstUnparser } from "@modelscript/dsl";
import { CstDocumentSession, CstTransaction, type CstTextEdit } from "@modelscript/dsl/unparser";
import type { SyntaxNode as DslSyntaxNode } from "@modelscript/dsl/utils";
import { Position, Range, TextEdit } from "vscode-languageserver";

import type { EdgeUpdate as EdgeItem, PlacementItem } from "@modelscript/diagram/protocol";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import {
  containsWholeWordOutsideStrings,
  isAsciiIdentContinue,
  isAsciiWhitespaceCode,
} from "../flattener/expressions/index.js";
import { inferModelicaDomainColor } from "./data.js";
import {
  buildFallbackClassInstance,
  computeMinimalNonOverlappingEdits,
  findBalancedClose,
  findKeywordCallOpenParen,
  healStrandedClassAnnotationsInText,
  maskModelicaCommentsAndStrings,
  offsetToPosition,
  scanModelicaClassLayout,
  type ScannedComponentDecl,
  type ScannedConnectStmt,
} from "./scanner.js";
import type { IDiagram, IPlacement, ModelicaClassInstance, ModelicaComponentInstance } from "./types.js";

interface EditableSourceRange {
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  startRow?: number | undefined;
  startCol?: number | undefined;
  endRow?: number | undefined;
  endCol?: number | undefined;
}

interface EditableModArgument {
  name?: { parts?: Array<{ text?: string | undefined }> | undefined } | undefined;
  modification?: EditableSyntaxNode | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  sourceRange?: EditableSourceRange | undefined;
}

interface EditableClassModification extends EditableSyntaxNode {
  modificationArguments?: EditableModArgument[] | undefined;
}

interface EditableSyntaxNode {
  type?: string | undefined;
  text?: string | undefined;
  name?: string | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  sourceRange?: EditableSourceRange | undefined;
  parent?: EditableSyntaxNode | null | undefined;
  children?: EditableSyntaxNode[] | undefined;
  tree?: { sourceCode?: string | undefined } | undefined;
  annotationClause?: EditableSyntaxNode | undefined;
  declaration?: EditableSyntaxNode | undefined;
  identifier?: EditableSyntaxNode | undefined;
  modification?: (EditableSyntaxNode & { classModification?: EditableClassModification | undefined }) | undefined;
  arraySubscripts?: EditableSyntaxNode | undefined;
  description?: EditableSyntaxNode | undefined;
}

interface ConnectEquationLike {
  lhs?: string | undefined;
  rhs?: string | undefined;
  cstNode?: EditableSyntaxNode | undefined;
  ast?: EditableSyntaxNode | undefined;
  componentReference1?:
    { parts?: Array<{ identifier?: { text: string } | undefined; text?: string | undefined }> | undefined } | undefined;
  componentReference2?:
    { parts?: Array<{ identifier?: { text: string } | undefined; text?: string | undefined }> | undefined } | undefined;
}

function asSyntaxNode(node: EditableSyntaxNode | null | undefined): SyntaxNode | null | undefined {
  return node as SyntaxNode | null | undefined;
}

function asUnparserNode(node: EditableSyntaxNode): DslSyntaxNode {
  return node as unknown as DslSyntaxNode;
}

function getAstNodeFromInstance(
  inst: ModelicaClassInstance | ModelicaComponentInstance | null | undefined,
): EditableSyntaxNode | undefined {
  if (!inst) return undefined;
  return (inst["cstNode"] ?? inst["abstractSyntaxNode"]) as EditableSyntaxNode | undefined;
}

function getConnectEquationsList(classInstance: ModelicaClassInstance | null | undefined): ConnectEquationLike[] {
  const raw = classInstance?.["connectEquations"];
  return Array.isArray(raw) ? (raw as ConnectEquationLike[]) : [];
}

export {
  buildFallbackClassInstance,
  computeMinimalNonOverlappingEdits,
  findBalancedClose,
  healStrandedClassAnnotationsInText,
  maskModelicaCommentsAndStrings,
  scanModelicaClassLayout,
};

function findKeywordBraceAssignmentStart(
  text: string,
  keyword: string,
): { startIndex: number; openBraceIndex: number } | null {
  let pos = 0;
  while (pos <= text.length - keyword.length) {
    const idx = text.indexOf(keyword, pos);
    if (idx < 0) return null;
    const prevOk = idx === 0 || !isAsciiIdentContinue(text.charCodeAt(idx - 1));
    let j = idx + keyword.length;
    const afterWordOk = j < text.length && !isAsciiIdentContinue(text.charCodeAt(j));
    if (prevOk && afterWordOk) {
      while (j < text.length && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
      if (j < text.length && text[j] === "=") {
        j++;
        while (j < text.length && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
        if (j < text.length && text[j] === "{") {
          return { startIndex: idx, openBraceIndex: j };
        }
      }
    }
    pos = idx + keyword.length;
  }
  return null;
}

function stripWhitespaceAroundDots(s: string): string {
  if (!s.includes(".")) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === ".") {
      out += ".";
      i++;
      while (i < s.length && isAsciiWhitespaceCode(s.charCodeAt(i))) i++;
      continue;
    }
    if (isAsciiWhitespaceCode(s.charCodeAt(i))) {
      let j = i;
      while (j < s.length && isAsciiWhitespaceCode(s.charCodeAt(j))) j++;
      if (j < s.length && s[j] === ".") {
        i = j;
        continue;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function rewriteAnnotationLineInText(
  src: string,
  newPointsCore: string,
  colorCore: string,
  defaultLineAnnotation: string,
  annCall: { startIndex: number; openParenIndex: number },
): string | null {
  const annContentStart = annCall.openParenIndex + 1;
  const annEndIndex = findMatchingParen(src, annContentStart);
  if (annEndIndex === -1) return null;

  let annotationContent = src.substring(annContentStart, annEndIndex);
  const contentMasked = maskModelicaCommentsAndStrings(annotationContent);
  let updatedLine = defaultLineAnnotation;

  const lineCall = findKeywordCallOpenParen(contentMasked, "Line");
  if (lineCall) {
    const lineStart = lineCall.startIndex;
    const lineInner = lineCall.openParenIndex + 1;
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
  return src.substring(0, annContentStart) + trimmed + separator + updatedLine + src.substring(annEndIndex);
}

function matchesModificationArgHead(headSlice: string, paramName: string): boolean {
  let pos = 0;
  const len = headSlice.length;
  while (pos < len) {
    while (pos < len && isAsciiWhitespaceCode(headSlice.charCodeAt(pos))) pos++;
    if (
      headSlice.startsWith("each", pos) &&
      (pos + 4 === len || isAsciiWhitespaceCode(headSlice.charCodeAt(pos + 4)))
    ) {
      pos += 4;
      continue;
    }
    if (
      headSlice.startsWith("final", pos) &&
      (pos + 5 === len || isAsciiWhitespaceCode(headSlice.charCodeAt(pos + 5)))
    ) {
      pos += 5;
      continue;
    }
    break;
  }
  if (!headSlice.startsWith(paramName, pos)) return false;
  const end = pos + paramName.length;
  if (end === len) return true;
  const ch = headSlice[end]!;
  return isAsciiWhitespaceCode(headSlice.charCodeAt(end)) || ch === "=" || ch === "(" || ch === "[";
}

function findDescendantModification(
  node: EditableSyntaxNode | null | undefined,
  name: string,
): EditableSyntaxNode | null {
  if (!node) return null;
  const sn = asSyntaxNode(node);
  const cstWithKind = Cst as { kind?: (n: SyntaxNode | null | undefined) => string | undefined };
  const isModificationNode =
    Cst.ElementModification.is(sn) ||
    Cst.Argument.is(sn) ||
    node.type === "element_modification" ||
    node.type === "argument" ||
    node.type === "named_argument" ||
    (typeof cstWithKind.kind === "function" &&
      (cstWithKind.kind(sn) === "element_modification" || cstWithKind.kind(sn) === "argument"));

  const trimmedNodeText = node.text?.trimStart() ?? "";
  const boundaryChar = trimmedNodeText.charCodeAt(name.length);
  const matchesName =
    (trimmedNodeText.startsWith(name) &&
      (trimmedNodeText.length === name.length ||
        isAsciiWhitespaceCode(boundaryChar) ||
        boundaryChar === 40 || // '('
        boundaryChar === 61)) || // '='
    node.children?.some(
      (c) =>
        (Cst.Identifier.is(asSyntaxNode(c)) || c.type === "identifier" || c.name === name) && c.text?.trim() === name,
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

function getNodeRange(
  node: EditableSyntaxNode | EditableModArgument | null | undefined,
): { startLine: number; startCol: number; endLine: number; endCol: number } | null {
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

function getConnectEquationStatementNode(connectEq: ConnectEquationLike | null | undefined): EditableSyntaxNode | null {
  const rawNode = connectEq?.cstNode ?? connectEq?.ast;
  if (!rawNode) return null;
  const parent = rawNode.parent;
  if (
    parent &&
    (Cst.SomeEquation.is(asSyntaxNode(parent)) || parent.type === "some_equation" || parent.type === "SomeEquation")
  ) {
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
  const lineCall = findKeywordCallOpenParen(trimmed, "Line");
  if (!lineCall || lineCall.startIndex !== 0 || !trimmed.endsWith(")")) {
    return `Line(${newPointsCore}, ${fallbackColorCore})`;
  }

  const pointsAssign = findKeywordBraceAssignmentStart(trimmed, "points");
  if (pointsAssign) {
    const pStart = pointsAssign.startIndex;
    const openBraceIdx = pointsAssign.openBraceIndex;
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

  const innerStart = lineCall.openParenIndex + 1;
  const innerContent = trimmed.slice(innerStart, -1).trim();
  if (innerContent.length === 0) {
    return `Line(${newPointsCore}, ${fallbackColorCore})`;
  }
  return `Line(${newPointsCore}, ${innerContent})`;
}

function getAnnotationClauseNode(node: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null {
  if (!node) return null;
  if (node.annotationClause) return node.annotationClause;
  const findAnn = (n: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null => {
    if (!n) return null;
    if (Cst.AnnotationClause.is(asSyntaxNode(n))) return n;
    for (const ch of n.children || []) {
      const res = findAnn(ch);
      if (res) return res;
    }
    return null;
  };
  return findAnn(node);
}

function getDeclarationIdentNodeFromDecl(decl: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null {
  if (!decl) return null;
  if (decl.identifier) return decl.identifier;
  if (Cst.Declaration.is(asSyntaxNode(decl))) {
    const cstName = Cst.Declaration.name(asSyntaxNode(decl));
    if (cstName) return cstName;
  }
  const findIdent = (n: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null => {
    if (!n) return null;
    if (Cst.Identifier.is(asSyntaxNode(n))) return n;
    for (const ch of n.children || []) {
      const res = findIdent(ch);
      if (res) return res;
    }
    return null;
  };
  return findIdent(decl);
}

function getDeclarationNode(
  node: EditableSyntaxNode | null | undefined,
  componentName?: string,
): EditableSyntaxNode | null {
  if (!node) return null;
  if (!componentName) {
    if (node.declaration) return node.declaration;
    if (Cst.ComponentDeclaration.is(asSyntaxNode(node))) {
      const cstDecl = Cst.ComponentDeclaration.declaration(asSyntaxNode(node));
      if (cstDecl) return cstDecl;
    }
  }
  const decls: EditableSyntaxNode[] = [];
  const collectDecls = (n: EditableSyntaxNode | null | undefined) => {
    if (!n) return;
    if (Cst.Declaration.is(asSyntaxNode(n))) {
      decls.push(n);
      return;
    }
    if (n.declaration) {
      decls.push(n.declaration);
      return;
    }
    for (const ch of n.children || []) {
      collectDecls(ch);
    }
  };
  collectDecls(node);
  if (componentName) {
    const matched = decls.find((d) => getDeclarationIdentNodeFromDecl(d)?.text?.trim() === componentName);
    if (matched) return matched;
  }
  return decls[0] ?? null;
}

function getDeclarationIdentNode(
  node: EditableSyntaxNode | null | undefined,
  componentName?: string,
): EditableSyntaxNode | null {
  if (!node) return null;
  if (componentName) {
    const decl = getDeclarationNode(node, componentName);
    const ident = getDeclarationIdentNodeFromDecl(decl);
    if (ident) return ident;
  }
  if (node.declaration?.identifier) return node.declaration.identifier;
  if (node.identifier) return node.identifier;
  const decl = getDeclarationNode(node, componentName) ?? node;
  return getDeclarationIdentNodeFromDecl(decl);
}

function getModificationNode(node: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null {
  if (!node) return null;
  const decl = getDeclarationNode(node) ?? node;
  if (decl.modification) return decl.modification;
  if (Cst.Declaration.is(asSyntaxNode(decl))) {
    const cstMod = Cst.Declaration.modification(asSyntaxNode(decl));
    if (cstMod) return cstMod;
  }
  const findMod = (n: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null => {
    if (!n) return null;
    if (Cst.Modification.is(asSyntaxNode(n))) return n;
    for (const ch of n.children || []) {
      const res = findMod(ch);
      if (res) return res;
    }
    return null;
  };
  return findMod(decl);
}

function getSubscriptsNode(node: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null {
  if (!node) return null;
  const decl = getDeclarationNode(node) ?? node;
  if (decl.arraySubscripts) return decl.arraySubscripts;
  if (Cst.Declaration.is(asSyntaxNode(decl))) {
    const cstSubs = Cst.Declaration.arraySubscripts(asSyntaxNode(decl));
    if (cstSubs) return cstSubs;
  }
  const findSub = (n: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null => {
    if (!n) return null;
    if (Cst.ArraySubscripts.is(asSyntaxNode(n))) return n;
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

function patchExistingPlacementCall(
  existingPlacementText: string,
  transformKey: "transformation" | "iconTransformation",
  newTransformCall: string,
): string {
  const masked = maskModelicaCommentsAndStrings(existingPlacementText);
  const plCall = findKeywordCallOpenParen(masked, "Placement");
  if (!plCall) return `Placement(${newTransformCall})`;
  const plClose = findBalancedClose(masked, plCall.openParenIndex, existingPlacementText.length);
  if (plClose === -1) return `Placement(${newTransformCall})`;

  const innerStart = plCall.openParenIndex + 1;
  const innerMasked = masked.slice(innerStart, plClose);
  const trCall = findKeywordCallOpenParen(innerMasked, transformKey);
  if (trCall) {
    const trStartOff = innerStart + trCall.startIndex;
    const trOpenParen = innerStart + trCall.openParenIndex;
    const trCloseParen = findBalancedClose(masked, trOpenParen, plClose);
    if (trCloseParen !== -1) {
      return (
        existingPlacementText.slice(0, trStartOff) + newTransformCall + existingPlacementText.slice(trCloseParen + 1)
      );
    }
  }

  const rawInner = existingPlacementText.slice(innerStart, plClose);
  const sep = rawInner.trim().length > 0 ? ", " : "";
  return (
    existingPlacementText.slice(0, innerStart) + `${newTransformCall}${sep}` + existingPlacementText.slice(innerStart)
  );
}

function applyScannedPlacementEdit(
  docText: string,
  lineStarts: number[],
  maskedText: string,
  scannedComp: ScannedComponentDecl,
  newPlacement: string,
  transformKey: "transformation" | "iconTransformation" = "transformation",
  newTransformCall?: string,
): TextEdit {
  if (scannedComp.annotationOpenParenOffset !== null && scannedComp.annotationCloseParenOffset !== null) {
    const annInnerStart = scannedComp.annotationOpenParenOffset + 1;
    const annClose = scannedComp.annotationCloseParenOffset;
    const maskedInner = maskedText.slice(annInnerStart, annClose);
    const plCall = findKeywordCallOpenParen(maskedInner, "Placement");
    if (plCall) {
      const plStartOff = annInnerStart + plCall.startIndex;
      const plOpenParen = annInnerStart + plCall.openParenIndex;
      const plCloseParen = findBalancedClose(maskedText, plOpenParen, annClose);
      if (plCloseParen !== -1) {
        const existingPlText = docText.slice(plStartOff, plCloseParen + 1);
        const patchedText = newTransformCall
          ? patchExistingPlacementCall(existingPlText, transformKey, newTransformCall)
          : newPlacement;
        return TextEdit.replace(
          Range.create(offsetToPosition(lineStarts, plStartOff), offsetToPosition(lineStarts, plCloseParen + 1)),
          patchedText,
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
  const component = Array.from(classInstance?.components ?? []).find((c) => c.name === item.name);
  const isIconLayer = Boolean((item as PlacementItem & { isIconLayer?: boolean }).isIconLayer);
  const transformKey: "transformation" | "iconTransformation" = isIconLayer ? "iconTransformation" : "transformation";

  // Detect existing transform & flip from explicit item override or original annotation
  let flipX = false;
  let flipY = false;
  let existingOriginX = 0;
  let existingOriginY = 0;
  let existingWidth = 20;
  let existingHeight = 20;

  const placement: IPlacement | null =
    typeof component?.annotation === "function" ? (component.annotation("Placement") as IPlacement | null) : null;
  const layerTrans = isIconLayer ? placement?.iconTransformation : placement?.transformation;
  const extent = layerTrans?.extent ?? placement?.transformation?.extent;
  if (Array.isArray(layerTrans?.origin) && layerTrans.origin.length >= 2) {
    if (Number.isFinite(Number(layerTrans.origin[0]))) existingOriginX = Number(layerTrans.origin[0]);
    if (Number.isFinite(Number(layerTrans.origin[1]))) existingOriginY = Number(layerTrans.origin[1]);
  }
  if (extent && extent.length >= 2) {
    const [[x1, y1], [x2, y2]] = extent;
    if (Number.isFinite(x1) && Number.isFinite(x2)) {
      flipX = x1 > x2;
      if (Math.abs(x2 - x1) > 0) existingWidth = Math.abs(x2 - x1);
    }
    if (Number.isFinite(y1) && Number.isFinite(y2)) {
      flipY = y1 > y2;
      if (Math.abs(y2 - y1) > 0) existingHeight = Math.abs(y2 - y1);
    }
  }
  if (item.flipX !== undefined) flipX = Boolean(item.flipX);
  if (item.flipY !== undefined) flipY = Boolean(item.flipY);

  const safeW = Number.isFinite(item.width) ? item.width : existingWidth;
  const safeH = Number.isFinite(item.height) ? item.height : existingHeight;
  const w = Math.round(safeW);
  const h = Math.round(safeH);
  const originX = Number.isFinite(item.x) ? Math.round(item.x + safeW / 2) : Math.round(existingOriginX);
  const originY = Number.isFinite(item.y) ? Math.round(-(item.y + safeH / 2)) : Math.round(existingOriginY);
  const existingRot = Number.isFinite(Number(layerTrans?.rotation)) ? Number(layerTrans?.rotation) : 0;
  const r = Number.isFinite(item.rotation) ? Math.round(-(item.rotation ?? 0)) : Math.round(existingRot);
  const rotationPart = r !== 0 ? `, rotation=${r}` : "";

  const ex1 = flipX ? w / 2 : -(w / 2);
  const ex2 = flipX ? -(w / 2) : w / 2;
  const ey1 = flipY ? h / 2 : -(h / 2);
  const ey2 = flipY ? -(h / 2) : h / 2;
  const newTransformationCore = `origin={${originX},${originY}}, extent={{${ex1},${ey1}},{${ex2},${ey2}}}${rotationPart}`;
  const newTransformCall = `${transformKey}(${newTransformationCore})`;
  const newPlacement = `Placement(${newTransformCall})`;

  const abstractNode = getAstNodeFromInstance(component);
  const compRange = getNodeRange(abstractNode);

  if (compRange) {
    const { startLine, startCol, endLine, endCol } = compRange;
    const text = getTextInRange(lines, startLine, startCol, endLine, endCol);
    const hasExactIdentifier = containsWholeWordOutsideStrings(maskModelicaCommentsAndStrings(text), item.name);

    if (hasExactIdentifier) {
      const annotationClause = getAnnotationClauseNode(abstractNode);
      const annRangeInfo = getNodeRange(annotationClause);

      if (annRangeInfo) {
        if (annotationClause) {
          const placementNode = findDescendantModification(annotationClause, "Placement");
          if (placementNode && placementNode.startPosition) {
            const plRange = getNodeRange(placementNode);
            const rawExistingPl = plRange
              ? getTextInRange(lines, plRange.startLine, plRange.startCol, plRange.endLine, plRange.endCol)
              : "";
            const patchedPlacement = rawExistingPl.trimStart().startsWith("Placement")
              ? patchExistingPlacementCall(rawExistingPl, transformKey, newTransformCall)
              : newPlacement;
            const patchRes = CstUnparser.patchAndUnparse({
              target: asUnparserNode(placementNode),
              replaceText: patchedPlacement,
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

          const classModNode = annotationClause.children?.find((c) => Cst.ClassModification.is(asSyntaxNode(c)));
          if (classModNode && classModNode.children && classModNode.children.length > 0) {
            const cmRange = getNodeRange(classModNode);
            const cmSlice = cmRange
              ? getTextInRange(lines, cmRange.startLine, cmRange.startCol, cmRange.endLine, cmRange.endCol)
              : "";
            if (
              cmSlice.startsWith("(") &&
              !findKeywordCallOpenParen(maskModelicaCommentsAndStrings(cmSlice), "Placement")
            ) {
              const patchRes = CstUnparser.patchAndUnparse({
                target: asUnparserNode(classModNode),
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
    return applyScannedPlacementEdit(
      docText,
      layout.lineStarts,
      layout.maskedText,
      scannedComp,
      newPlacement,
      transformKey,
      newTransformCall,
    );
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
  const component = Array.from(classInstance?.components ?? []).find((c) => c.name === item.name);
  if (component) {
    const abstractNode = getAstNodeFromInstance(component);
    const annotationClause = getAnnotationClauseNode(abstractNode);
    if (annotationClause) {
      const placementNode = findDescendantModification(annotationClause, "Placement");
      if (placementNode) return null;
    }
    const compRange = getNodeRange(abstractNode);
    if (compRange) {
      const text = getTextInRange(lines, compRange.startLine, compRange.startCol, compRange.endLine, compRange.endCol);
      if (findKeywordCallOpenParen(maskModelicaCommentsAndStrings(text), "Placement")) return null;
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
    if (findKeywordCallOpenParen(maskedInner, "Placement")) return null;
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

  const astNode = getAstNodeFromInstance(classInstance);
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
      // Advance past any trailing comments (e.g. `/* ... */` or `// ...`) inside targetEqSec
      // so we never insert a `connect(...)` statement inside a multi-line block comment.
      let safeOffset = lastCodeEndOffset;
      while (safeOffset < targetEqSec.endOffset) {
        const ch = docText[safeOffset]!;
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
          safeOffset++;
          continue;
        }
        if (ch === "/" && docText[safeOffset + 1] === "/") {
          const nl = docText.indexOf("\n", safeOffset + 2);
          safeOffset = nl === -1 || nl >= targetEqSec.endOffset ? targetEqSec.endOffset : nl;
          break;
        }
        if (ch === "/" && docText[safeOffset + 1] === "*") {
          const closeIdx = docText.indexOf("*/", safeOffset + 2);
          safeOffset = closeIdx === -1 ? targetEqSec.endOffset : Math.min(closeIdx + 2, targetEqSec.endOffset);
          continue;
        }
        break;
      }

      const safePos = offsetToPosition(layout.lineStarts, safeOffset);
      const restOfLine = layout.maskedText.slice(safeOffset).split("\n", 1)[0]!.trim();

      if (restOfLine === "") {
        return [TextEdit.insert({ line: safePos.line + 1, character: 0 }, connectEq)];
      }
      return [TextEdit.insert(safePos, `\n${connectEq.trimEnd()}`)];
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

function getConnectEndpoints(ce: ConnectEquationLike): { source: string; target: string } {
  const source =
    ce.lhs ?? ce.componentReference1?.parts?.map((c) => c.identifier?.text ?? c.text ?? "")?.join(".") ?? "";
  const target =
    ce.rhs ?? ce.componentReference2?.parts?.map((c) => c.identifier?.text ?? c.text ?? "")?.join(".") ?? "";
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
  if (!findKeywordCallOpenParen(masked, "connect")) return false;
  const norm = stripWhitespaceAroundDots(slice);
  return norm.includes(source) && norm.includes(target);
}

export function computeConnectRemove(
  docText: string,
  classInstance: ModelicaClassInstance,
  source: string,
  target: string,
): TextEdit[] {
  const lines = docText.split("\n");

  const connectEqs = getConnectEquationsList(classInstance);
  const connectEq = findBestConnectMatch(connectEqs, getConnectEndpoints, source, target);

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
        let scanEnd = delEnd;
        while (scanEnd < comp.clauseEndOffset && isAsciiWhitespaceCode(layout.maskedText.charCodeAt(scanEnd))) {
          scanEnd++;
        }
        if (scanEnd < comp.clauseEndOffset && layout.maskedText[scanEnd] === ",") {
          scanEnd++;
          while (scanEnd < comp.clauseEndOffset && isAsciiWhitespaceCode(layout.maskedText.charCodeAt(scanEnd))) {
            scanEnd++;
          }
          delEnd = scanEnd;
        } else {
          let scanStart = delStart;
          while (
            scanStart > comp.clauseStartOffset &&
            isAsciiWhitespaceCode(layout.maskedText.charCodeAt(scanStart - 1))
          ) {
            scanStart--;
          }
          if (scanStart > comp.clauseStartOffset && layout.maskedText[scanStart - 1] === ",") {
            scanStart--;
            while (
              scanStart > comp.clauseStartOffset &&
              isAsciiWhitespaceCode(layout.maskedText.charCodeAt(scanStart - 1))
            ) {
              scanStart--;
            }
            delStart = scanStart;
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
  getConnectEquationsList(classInstance).forEach((ce) => {
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
    const component = Array.from(classInstance?.components ?? []).find((c) => c.name === name);
    if (!component) continue;

    const compNode = getAstNodeFromInstance(component);
    const isDeclLike = (n: EditableSyntaxNode | null | undefined): boolean =>
      Cst.ComponentDeclaration.is(asSyntaxNode(n)) ||
      Cst.Declaration.is(asSyntaxNode(n)) ||
      n?.type === "component_declaration" ||
      n?.type === "declaration";

    let targetDeleteNode = compNode?.parent ?? compNode;
    if (isDeclLike(compNode) && compNode?.parent) {
      const siblingDecls = (compNode.parent.children || []).filter(isDeclLike);
      if (siblingDecls.length > 1) {
        const allDeleted = siblingDecls.every((s) => {
          const id = getDeclarationIdentNode(s)?.text?.trim();
          return id ? nameSet.has(id) : false;
        });
        if (!allDeleted) {
          const patchRes = CstUnparser.patchAndUnparse({
            target: asUnparserNode(compNode.parent),
            deleteChildren: [asUnparserNode(compNode)],
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
        if (
          compNode.parent.parent &&
          (Cst.ComponentClause?.is?.(asSyntaxNode(compNode.parent.parent)) ||
            compNode.parent.parent.type === "component_clause")
        ) {
          targetDeleteNode = compNode.parent.parent;
        }
      }
    } else if (compNode) {
      const nestedDecls: EditableSyntaxNode[] = [];
      const collectDecls = (n: EditableSyntaxNode | null | undefined) => {
        if (!n) return;
        if (isDeclLike(n)) {
          nestedDecls.push(n);
          return;
        }
        for (const ch of n.children || []) collectDecls(ch);
      };
      collectDecls(compNode);
      if (nestedDecls.length > 1) {
        const matchedDecl = nestedDecls.find((d) => getDeclarationIdentNode(d, name)?.text?.trim() === name);
        const allDeleted = nestedDecls.every((d) => {
          const id = getDeclarationIdentNode(d)?.text?.trim();
          return id ? nameSet.has(id) : false;
        });
        if (matchedDecl && matchedDecl.parent && !allDeleted) {
          const patchRes = CstUnparser.patchAndUnparse({
            target: asUnparserNode(matchedDecl.parent),
            deleteChildren: [asUnparserNode(matchedDecl)],
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
    }

    const compRange = getNodeRange(targetDeleteNode);
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
    const lnCall = findKeywordCallOpenParen(maskedInner, "Line");
    if (lnCall) {
      const lnStartOff = annInnerStart + lnCall.startIndex;
      const lnOpenParen = annInnerStart + lnCall.openParenIndex;
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
  const usedCstConnects = new Set<ConnectEquationLike>();
  const usedScannedConnects = new Set<ScannedConnectStmt>();

  const docText = lines.join("\n");
  let cachedLayout: ReturnType<typeof scanModelicaClassLayout> | undefined;
  const getLayout = () => {
    if (cachedLayout === undefined) {
      cachedLayout = scanModelicaClassLayout(docText, classInstance?.name);
    }
    return cachedLayout;
  };

  const connectEqs = getConnectEquationsList(classInstance);

  for (const edge of edges) {
    const pointsStr = `{${edge.points.map((p) => `{${p.x},${p.y}}`).join(", ")}}`;
    const newPointsCore = `points=${pointsStr}`;
    const inferredColor = inferModelicaDomainColor(edge.source, edge.target, classInstance);
    const colorCore = `color={${inferredColor[0]}, ${inferredColor[1]}, ${inferredColor[2]}}`;
    const defaultLineAnnotation = `Line(${newPointsCore}, ${colorCore})`;

    const connectEq = findBestConnectMatch(connectEqs, getConnectEndpoints, edge.source, edge.target, usedCstConnects);
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
                  target: asUnparserNode(lineNode),
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
              const classModNode = annotationClause.children?.find((c) => Cst.ClassModification.is(asSyntaxNode(c)));
              if (classModNode && classModNode.children && classModNode.children.length > 0) {
                const cmRange = getNodeRange(classModNode);
                const cmSlice = cmRange
                  ? getTextInRange(lines, cmRange.startLine, cmRange.startCol, cmRange.endLine, cmRange.endCol)
                  : "";
                if (
                  cmSlice.startsWith("(") &&
                  !findKeywordCallOpenParen(maskModelicaCommentsAndStrings(cmSlice), "Line")
                ) {
                  const patchRes = CstUnparser.patchAndUnparse({
                    target: asUnparserNode(classModNode),
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
            const annCall = findKeywordCallOpenParen(maskModelicaCommentsAndStrings(annText), "annotation");
            if (annCall) {
              const rewritten = rewriteAnnotationLineInText(
                annText,
                newPointsCore,
                colorCore,
                defaultLineAnnotation,
                annCall,
              );
              if (rewritten !== null) {
                newText = rewritten;
                if (newText !== annText) {
                  edits.push(TextEdit.replace(annRange, newText));
                }
                handledViaCst = true;
              }
            }
          }
        } else {
          const textMasked = maskModelicaCommentsAndStrings(text);
          const annCall = findKeywordCallOpenParen(textMasked, "annotation");
          if (annCall) {
            const rewritten = rewriteAnnotationLineInText(
              text,
              newPointsCore,
              colorCore,
              defaultLineAnnotation,
              annCall,
            );
            if (rewritten !== null) {
              newText = rewritten;
              if (newText !== text) {
                edits.push(TextEdit.replace(range, newText));
              }
              handledViaCst = true;
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
  let semiOffset = 0;
  while (semiOffset < rawSuffix.length && isAsciiWhitespaceCode(rawSuffix.charCodeAt(semiOffset))) semiOffset++;
  const adjustedEndCol =
    semiOffset < rawSuffix.length && rawSuffix[semiOffset] === ";" ? endCol + semiOffset + 1 : endCol;

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

function collectClassBodyReferenceRenameEdits(
  layout: ReturnType<typeof scanModelicaClassLayout> & object,
  oldName: string,
  newName: string,
  alreadyHandled: Array<{ start: number; end: number }>,
): TextEdit[] {
  const edits: TextEdit[] = [];
  const { maskedText, lineStarts, headerEndOffset, endKeywordOffset } = layout;
  const bodyStart = Math.max(0, headerEndOffset);
  const bodyEnd = Math.min(maskedText.length, endKeywordOffset);
  if (bodyEnd <= bodyStart) return edits;

  // Exclude class/component/connect annotation(...) blocks and connect(...) headers
  const excluded: Array<{ start: number; end: number }> = [...alreadyHandled];
  for (const ca of layout.classAnnotations) {
    excluded.push({ start: ca.keywordOffset, end: ca.statementEndOffset });
  }
  for (const comp of layout.components) {
    if (comp.annotationKeywordOffset !== null && comp.annotationCloseParenOffset !== null) {
      excluded.push({ start: comp.annotationKeywordOffset, end: comp.annotationCloseParenOffset + 1 });
    }
  }
  for (const conn of layout.connects) {
    excluded.push({ start: conn.startOffset, end: conn.closeConnectParenOffset + 1 });
    if (conn.annotationKeywordOffset !== null && conn.annotationCloseParenOffset !== null) {
      excluded.push({ start: conn.annotationKeywordOffset, end: conn.annotationCloseParenOffset + 1 });
    }
  }

  const isExcluded = (start: number, end: number) => excluded.some((r) => start < r.end && end > r.start);

  const isInPublicOrProtectedHeader = (offset: number) => {
    let activeKind = "public";
    for (const sec of layout.sections) {
      if (sec.keywordOffset <= offset) activeKind = sec.kind;
      else break;
    }
    return activeKind === "public" || activeKind === "protected";
  };

  let parenDepth = 0;
  let i = bodyStart;
  while (i < bodyEnd) {
    const ch = maskedText[i]!;
    if (ch === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
      i++;
      continue;
    }

    if (
      maskedText.startsWith(oldName, i) &&
      (i === 0 || !isAsciiIdentContinue(maskedText.charCodeAt(i - 1))) &&
      (i + oldName.length >= maskedText.length || !isAsciiIdentContinue(maskedText.charCodeAt(i + oldName.length)))
    ) {
      const matchEnd = i + oldName.length;
      if (!isExcluded(i, matchEnd)) {
        // Check preceding non-whitespace character: never rename dotted member accesses (other.oldName)
        let prev = i - 1;
        while (prev >= bodyStart && isAsciiWhitespaceCode(maskedText.charCodeAt(prev))) prev--;
        const isDottedMember = prev >= bodyStart && maskedText[prev] === ".";

        // Check if match is an LHS parameter modification key like `Comp c(oldName = 5)`
        let next = matchEnd;
        while (next < bodyEnd && isAsciiWhitespaceCode(maskedText.charCodeAt(next))) next++;
        const isAssignEq =
          next < bodyEnd && maskedText[next] === "=" && maskedText[next + 1] !== "=" && maskedText[prev] !== ":"; // ignore `:=` equation context safely covered by section check
        const isModLhsKey = isAssignEq && parenDepth > 0 && isInPublicOrProtectedHeader(i);

        // Do not rename a sibling component's declarator name if one somehow shared the identifier
        if (!isDottedMember && !isModLhsKey) {
          edits.push(
            TextEdit.replace(
              Range.create(offsetToPosition(lineStarts, i), offsetToPosition(lineStarts, matchEnd)),
              newName,
            ),
          );
          alreadyHandled.push({ start: i, end: matchEnd });
        }
      }
      i = matchEnd;
      continue;
    }

    i++;
  }

  return edits;
}

export function computeNameEdit(
  classInstance: ModelicaClassInstance,
  oldName: string,
  newName: string,
  docText?: string,
): TextEdit[] {
  if (!oldName || !newName || oldName === newName) return [];

  const effectiveDocText = docText ?? getAstNodeFromInstance(classInstance)?.tree?.sourceCode ?? undefined;

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
      const handledSpans: Array<{ start: number; end: number }> = [];
      // Protect all component declaration type specifiers and identifier headers from body-ref sweeps
      for (const comp of layout.components) {
        handledSpans.push({
          start: comp.declStartOffset,
          end: comp.subscriptsEndOffset ?? comp.identEndOffset,
        });
      }

      // Also update all connect(oldName.port, ...) / connect(oldName, ...) references in the class!
      const replaceEndpointPrefix = (refStart: number, refEnd: number) => {
        const rawRef = effectiveDocText.slice(refStart, refEnd);
        if (rawRef.startsWith(oldName)) {
          let after = oldName.length;
          while (after < rawRef.length && isAsciiWhitespaceCode(rawRef.charCodeAt(after))) after++;
          if (after === rawRef.length || rawRef[after] === "." || rawRef[after] === "[") {
            edits.push(
              TextEdit.replace(
                Range.create(
                  offsetToPosition(layout.lineStarts, refStart),
                  offsetToPosition(layout.lineStarts, refStart + oldName.length),
                ),
                newName,
              ),
            );
            handledSpans.push({ start: refStart, end: refStart + oldName.length });
          }
        }
      };

      for (const conn of layout.connects) {
        replaceEndpointPrefix(conn.lhsStartOffset, conn.lhsEndOffset);
        replaceEndpointPrefix(conn.rhsStartOffset, conn.rhsEndOffset);
      }

      // Safely rename whole-word non-dotted references inside equation/algorithm/modifier RHS expressions
      edits.push(...collectClassBodyReferenceRenameEdits(layout, oldName, newName, handledSpans));

      return deduplicateAndSort(edits);
    }
  }

  const component = Array.from(classInstance?.components ?? []).find((c) => c.name === oldName);
  if (!component) return [];

  const abstractNode = getAstNodeFromInstance(component);
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

function findDescriptionStringNode(node: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null {
  if (!node) return null;
  const isString = (n: EditableSyntaxNode | null | undefined): boolean =>
    Cst.DescriptionString.is(asSyntaxNode(n)) || Cst.StringLiteral.is(asSyntaxNode(n));

  if (isString(node)) return node;

  // Search direct children first
  for (const child of node.children || []) {
    if (isString(child)) return child;
  }

  // If there is a description node, search within it (specifically avoiding annotation_clause)
  const descNode =
    node.description ??
    (Cst.ComponentDeclaration.is(asSyntaxNode(node))
      ? Cst.ComponentDeclaration.description(asSyntaxNode(node))
      : null) ??
    (node.children || []).find((c) => Cst.Description.is(asSyntaxNode(c)));
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
  const escapedDescription = newDescription.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const component = Array.from(classInstance?.components ?? []).find((c) => c.name === componentName);

  if (component) {
    const abstractNode = getAstNodeFromInstance(component);
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
    const abstractNode = getAstNodeFromInstance(component);
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

interface MatchedArgumentNodes {
  argumentNode: EditableSyntaxNode;
  elementModNode: EditableSyntaxNode;
  valueModNode: EditableSyntaxNode | null | undefined;
  ownerContainer: EditableSyntaxNode;
  matchedName: string;
}

function findArgumentByName(
  classModOrArgList: EditableSyntaxNode | null | undefined,
  name: string,
): MatchedArgumentNodes | null {
  if (!classModOrArgList) return null;
  const findArgs = (node: EditableSyntaxNode | null | undefined): EditableSyntaxNode[] => {
    const results: EditableSyntaxNode[] = [];
    if (!node) return results;
    if (Cst.Argument.is(asSyntaxNode(node))) {
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
    const findElemMod = (n: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null => {
      if (!n) return null;
      if (Cst.ElementModification.is(asSyntaxNode(n))) return n;
      for (const ch of n.children || []) {
        const found = findElemMod(ch);
        if (found) return found;
      }
      return null;
    };
    const elemMod = findElemMod(arg);
    if (!elemMod) continue;

    const findName = (n: EditableSyntaxNode | null | undefined): EditableSyntaxNode | null => {
      if (!n) return null;
      if (Cst.Name.is(asSyntaxNode(n)) || n.type === "name") return n;
      if (Cst.Identifier.is(asSyntaxNode(n))) return n;
      for (const ch of n.children || []) {
        if (Cst.Modification.is(asSyntaxNode(ch)) || Cst.ClassModification.is(asSyntaxNode(ch))) continue;
        const found = findName(ch);
        if (found) return found;
      }
      return null;
    };
    const nameNode =
      (Cst.ElementModification.is(asSyntaxNode(elemMod))
        ? Cst.ElementModification.name(asSyntaxNode(elemMod))
        : null) ?? findName(elemMod);
    const argName = nameNode?.text ? stripWhitespaceAroundDots(nameNode.text.trim()) : "";
    if (!argName) continue;

    const valueModNode =
      (Cst.ElementModification.is(asSyntaxNode(elemMod))
        ? Cst.ElementModification.modification(asSyntaxNode(elemMod))
        : null) ??
      (elemMod.children || []).find(
        (c) => Cst.Modification.is(asSyntaxNode(c)) || Cst.ClassModification.is(asSyntaxNode(c)),
      );

    if (argName === name) {
      return {
        argumentNode: arg,
        elementModNode: elemMod,
        valueModNode,
        ownerContainer: classModOrArgList,
        matchedName: argName,
      };
    }

    if (name.startsWith(`${argName}.`) && valueModNode) {
      const rest = name.slice(argName.length + 1);
      const nestedCm =
        (Cst.ClassModification.is(asSyntaxNode(valueModNode)) ? valueModNode : null) ??
        valueModNode.children?.find(
          (c) => Cst.ClassModification.is(asSyntaxNode(c)) || c.type === "class_modification",
        );
      if (nestedCm) {
        const nestedArgList = nestedCm.children?.find((c) => Cst.ArgumentList.is(asSyntaxNode(c))) ?? nestedCm;
        const nestedMatch = findArgumentByName(nestedArgList, rest);
        if (nestedMatch) return nestedMatch;
      }
    }
  }

  return null;
}

function findNestedModificationContainer(
  classModOrArgList: EditableSyntaxNode | null | undefined,
  name: string,
): { containerNode: EditableSyntaxNode; leafName: string } | null {
  if (!classModOrArgList || !name.includes(".")) return null;
  for (const arg of getAllArgumentNodes(classModOrArgList)) {
    const elemMod =
      (arg.children || []).find((c) => Cst.ElementModification.is(asSyntaxNode(c))) ??
      (Cst.ElementModification.is(asSyntaxNode(arg)) ? arg : null);
    if (!elemMod) continue;
    const nameNode =
      (Cst.ElementModification.is(asSyntaxNode(elemMod))
        ? Cst.ElementModification.name(asSyntaxNode(elemMod))
        : null) ??
      (elemMod.children || []).find((c) => Cst.Name.is(asSyntaxNode(c)) || Cst.Identifier.is(asSyntaxNode(c)));
    const argName = nameNode?.text ? stripWhitespaceAroundDots(nameNode.text.trim()) : "";
    if (!argName || !name.startsWith(`${argName}.`)) continue;
    const rest = name.slice(argName.length + 1);
    const valueModNode =
      (Cst.ElementModification.is(asSyntaxNode(elemMod))
        ? Cst.ElementModification.modification(asSyntaxNode(elemMod))
        : null) ??
      (elemMod.children || []).find(
        (c) => Cst.Modification.is(asSyntaxNode(c)) || Cst.ClassModification.is(asSyntaxNode(c)),
      );
    const nestedCm =
      (Cst.ClassModification.is(asSyntaxNode(valueModNode)) ? valueModNode : null) ??
      valueModNode?.children?.find((c) => Cst.ClassModification.is(asSyntaxNode(c)) || c.type === "class_modification");
    if (nestedCm) {
      const nestedArgList = nestedCm.children?.find((c) => Cst.ArgumentList.is(asSyntaxNode(c))) ?? nestedCm;
      return findNestedModificationContainer(nestedArgList, rest) ?? { containerNode: nestedArgList, leafName: rest };
    }
  }
  return null;
}

function getAllArgumentNodes(classModOrArgList: EditableSyntaxNode | null | undefined): EditableSyntaxNode[] {
  if (!classModOrArgList) return [];
  const results: EditableSyntaxNode[] = [];
  const walk = (node: EditableSyntaxNode | null | undefined) => {
    if (!node) return;
    if (Cst.Argument.is(asSyntaxNode(node))) {
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

function patchScannedModificationArgs(
  docText: string,
  maskedText: string,
  lineStarts: number[],
  openParenOffset: number,
  closeParenOffset: number,
  modEndOffset: number | null,
  parameterName: string,
  newValue: string,
): TextEdit[] {
  const shouldRemove = newValue === "";
  const innerStart = openParenOffset + 1;
  const innerEnd = closeParenOffset;
  const segments = splitTopLevelModificationSegments(docText, maskedText, innerStart, innerEnd);
  const argIndex = segments.findIndex((seg) =>
    matchesModificationArgHead(maskedText.slice(seg.trimmedStart, seg.trimmedEnd), parameterName),
  );

  if (argIndex !== -1) {
    const seg = segments[argIndex]!;
    if (shouldRemove) {
      if (segments.length <= 1) {
        const startPos = offsetToPosition(lineStarts, openParenOffset);
        const endPos = offsetToPosition(lineStarts, modEndOffset ?? closeParenOffset + 1);
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

    // Find top-level `=` inside this argument segment (after any nested `(...)`)
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
      const hasSpace = afterEq.length > 0 && isAsciiWhitespaceCode(afterEq.charCodeAt(0));
      const startPos = offsetToPosition(lineStarts, eqOffset);
      const endPos = offsetToPosition(lineStarts, seg.trimmedEnd);
      return [TextEdit.replace(Range.create(startPos, endPos), `${hasSpace ? "= " : "="}${newValue}`)];
    }

    // Segment has no top-level `=` (e.g. `each Real x` or `v(start=0)`): append binding cleanly without wiping prefixes or nested attributes
    const endPos = offsetToPosition(lineStarts, seg.trimmedEnd);
    return [TextEdit.insert(endPos, ` = ${newValue}`)];
  }

  // If dotted path (e.g. `v.start`) wasn't flat, recurse into matching prefix's nested `(...)` (e.g. `v(fixed=true)`)
  const dotIdx = parameterName.indexOf(".");
  if (dotIdx !== -1) {
    const head = parameterName.slice(0, dotIdx);
    const tail = parameterName.slice(dotIdx + 1);
    const headIdx = segments.findIndex((seg) =>
      matchesModificationArgHead(maskedText.slice(seg.trimmedStart, seg.trimmedEnd), head),
    );
    if (headIdx !== -1) {
      const headSeg = segments[headIdx]!;
      let nestedOpen = -1;
      for (let i = headSeg.trimmedStart; i < headSeg.trimmedEnd; i++) {
        if (maskedText[i] === "(") {
          nestedOpen = i;
          break;
        }
      }
      if (nestedOpen !== -1) {
        const nestedClose = findBalancedClose(maskedText, nestedOpen, headSeg.trimmedEnd + 1);
        if (nestedClose !== -1) {
          return patchScannedModificationArgs(
            docText,
            maskedText,
            lineStarts,
            nestedOpen,
            nestedClose,
            null,
            tail,
            newValue,
          );
        }
      }
    }
  }

  if (shouldRemove) return [];
  const closePos = offsetToPosition(lineStarts, innerEnd);
  const hasArgs = segments.length > 0;
  return [TextEdit.insert(closePos, `${hasArgs ? ", " : ""}${parameterName} = ${newValue}`)];
}

function computeScannedParameterEdit(
  docText: string,
  classInstance: ModelicaClassInstance,
  componentName: string,
  parameterName: string,
  newValue: string,
): TextEdit[] {
  const astNode = getAstNodeFromInstance(classInstance);
  const classRange = getNodeRange(astNode);
  const layout = scanModelicaClassLayout(docText, classInstance?.name, classRange?.startLine);
  if (!layout) return [];

  const scannedComp = layout.components.find((c) => c.name === componentName);
  if (!scannedComp) return [];

  const shouldRemove = newValue === "";
  const { lineStarts, maskedText } = layout;

  if (scannedComp.modOpenParenOffset !== null && scannedComp.modCloseParenOffset !== null) {
    return patchScannedModificationArgs(
      docText,
      maskedText,
      lineStarts,
      scannedComp.modOpenParenOffset,
      scannedComp.modCloseParenOffset,
      scannedComp.modEndOffset,
      parameterName,
      newValue,
    );
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
  const component = Array.from(classInstance?.components ?? []).find((c) => c.name === componentName);
  if (!component) {
    return docText !== undefined
      ? computeScannedParameterEdit(docText, classInstance, componentName, parameterName, newValue)
      : [];
  }

  const abstractNode = getAstNodeFromInstance(component);
  if (!abstractNode) {
    return docText !== undefined
      ? computeScannedParameterEdit(docText, classInstance, componentName, parameterName, newValue)
      : [];
  }

  const declNode = getDeclarationNode(abstractNode, componentName) ?? abstractNode;

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
      if (!containsWholeWordOutsideStrings(actualSlice, componentName)) {
        return computeScannedParameterEdit(docText!, classInstance, componentName, parameterName, newValue);
      }
    }
  }

  const shouldRemove = newValue === "";

  // 1. Check for real CST structure (nodes with children / startPosition)
  const modNode = getModificationNode(declNode);
  const classModNode = modNode
    ? (modNode.children?.find((c) => Cst.ClassModification.is(asSyntaxNode(c))) ??
      (Cst.ClassModification.is(asSyntaxNode(modNode)) ? modNode : null))
    : null;

  if (classModNode && classModNode.children && classModNode.children.length > 0) {
    const argListNode = classModNode.children?.find((c) => Cst.ArgumentList.is(asSyntaxNode(c)));
    const containerNode = argListNode ?? classModNode;
    const existingArg = findArgumentByName(containerNode, parameterName);

    if (existingArg) {
      const targetContainer = existingArg.ownerContainer ?? containerNode;
      if (shouldRemove) {
        const allArgs = getAllArgumentNodes(targetContainer);
        if (allArgs.length <= 1) {
          // Sole argument in its class modification: remove enclosing modification / parent arg
          const target =
            targetContainer === containerNode ? (modNode ?? classModNode) : (targetContainer.parent ?? targetContainer);
          const patchRes = CstUnparser.patchAndUnparse({
            target: asUnparserNode(target),
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

        // Multiple arguments: delete this argument from its argument_list
        const patchRes = CstUnparser.patchAndUnparse({
          target: asUnparserNode(targetContainer),
          deleteChildren: [asUnparserNode(existingArg.argumentNode)],
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

      // Update existing argument value while preserving nested ClassModification (`R(unit="Ohm") = 10` or `v(start=0)`)
      if (existingArg.valueModNode) {
        const vm = existingArg.valueModNode;
        const nestedCm =
          (Cst.ClassModification.is(asSyntaxNode(vm)) || vm.type === "class_modification" ? vm : null) ??
          vm.children?.find((c) => Cst.ClassModification.is(asSyntaxNode(c)) || c.type === "class_modification");
        if (nestedCm) {
          const vmRange = getNodeRange(vm);
          const cmRange = getNodeRange(nestedCm);
          if (vmRange && cmRange) {
            const afterCmText = docLines
              ? getTextInRange(docLines, cmRange.endLine, cmRange.endCol, vmRange.endLine, vmRange.endCol)
              : "";
            const eqIdx = afterCmText.indexOf("=");
            if (
              eqIdx !== -1 ||
              (typeof vm.text === "string" && vm.text.indexOf("=", nestedCm.text?.length ?? 0) !== -1)
            ) {
              const afterEq = eqIdx !== -1 ? afterCmText.slice(eqIdx + 1) : "";
              const hasSpaceAfterEq = afterEq.length > 0 && isAsciiWhitespaceCode(afterEq.charCodeAt(0));
              return [
                TextEdit.replace(
                  Range.create(cmRange.endLine, cmRange.endCol, vmRange.endLine, vmRange.endCol),
                  hasSpaceAfterEq ? ` = ${newValue}` : `=${newValue}`,
                ),
              ];
            }
            return [TextEdit.insert(Position.create(cmRange.endLine, cmRange.endCol), ` = ${newValue}`)];
          }
        }

        const modStr = vm.text || "";
        const hasSpaceAfterEq =
          modStr.startsWith("=") && modStr.length > 1 && isAsciiWhitespaceCode(modStr.charCodeAt(1));
        const newModText = hasSpaceAfterEq ? `= ${newValue}` : `=${newValue}`;
        const patchRes = CstUnparser.patchAndUnparse({
          target: asUnparserNode(vm),
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
        const emRange = getNodeRange(existingArg.elementModNode);
        if (emRange) {
          return [TextEdit.insert(Position.create(emRange.endLine, emRange.endCol), ` = ${newValue}`)];
        }
        const patchRes = CstUnparser.patchAndUnparse({
          target: asUnparserNode(existingArg.elementModNode),
          replaceText: `${existingArg.matchedName || parameterName} = ${newValue}`,
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
      // Argument not found — if dotted path has an existing parent container (e.g. `v(fixed=true)` for `v.start`), insert there
      if (shouldRemove) return [];
      const nestedTarget = findNestedModificationContainer(containerNode, parameterName);
      const insertContainer = nestedTarget ? nestedTarget.containerNode : containerNode;
      const insertName = nestedTarget ? nestedTarget.leafName : parameterName;
      const patchRes = CstUnparser.patchAndUnparse({
        target: asUnparserNode(insertContainer),
        insertChildren: [
          {
            content: `${insertName} = ${newValue}`,
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
  const legacyClassMod = declNode.modification?.classModification;
  const legacyModArgs = legacyClassMod?.modificationArguments;
  if (legacyClassMod && legacyModArgs) {
    const classMod = legacyClassMod;
    const modArgs = legacyModArgs;

    const argIndex = modArgs.findIndex((arg) => {
      if (!arg.name?.parts) return false;

      const nameText = arg.name.parts.map((p) => p.text ?? "").join(".");
      return nameText === parameterName;
    });

    if (argIndex !== -1) {
      const existingArg = modArgs[argIndex]!;
      const argRange = getNodeRange(existingArg);
      if (shouldRemove) {
        let startLine = argRange?.startLine ?? existingArg.startPosition?.row ?? 0;
        let startCol = argRange?.startCol ?? existingArg.startPosition?.column ?? 0;
        let endLine = argRange?.endLine ?? existingArg.endPosition?.row ?? 0;
        let endCol = argRange?.endCol ?? existingArg.endPosition?.column ?? 0;

        const nextArg = modArgs[argIndex + 1];
        const nextRange = getNodeRange(nextArg);
        if (nextRange) {
          endLine = nextRange.startLine;
          endCol = nextRange.startCol;
        } else if (argIndex > 0) {
          const prevArg = modArgs[argIndex - 1];
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
      const hasArgs = modArgs.length > 0;
      const modRange = getNodeRange(classMod);
      const endLine = modRange?.endLine ?? classMod.endPosition?.row ?? 0;
      const endCol = modRange?.endCol ?? classMod.endPosition?.column ?? 0;
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

export interface ComponentIconCoordinateSystem {
  extent?: [[number, number], [number, number]] | undefined;
  initialScale?: number | undefined;
}

export function computeComponentInsert(
  classInstance: ModelicaClassInstance,
  className: string,
  componentName: string,
  x: number,
  y: number,
  docText: string,
  componentIconCoord?: ComponentIconCoordinateSystem | null | undefined,
): TextEdit[] {
  const initialScale =
    componentIconCoord?.initialScale &&
    Number.isFinite(componentIconCoord.initialScale) &&
    componentIconCoord.initialScale > 0
      ? componentIconCoord.initialScale
      : 0.1;
  const extent = componentIconCoord?.extent;

  let width = 200;
  let height = 200;
  if (extent && extent.length >= 2 && extent[0] && extent[1]) {
    const extW = Math.abs(extent[1][0] - extent[0][0]);
    const extH = Math.abs(extent[1][1] - extent[0][1]);
    if (extW > 0 && Number.isFinite(extW)) width = extW;
    if (extH > 0 && Number.isFinite(extH)) height = extH;
  }
  const w = width * initialScale;
  const h = height * initialScale;

  const originX = Math.round(x);
  const originY = -Math.round(y);
  const annotation = `annotation(Placement(transformation(origin={${originX},${originY}}, extent={{-${w / 2},-${h / 2}},{${w / 2},${h / 2}}})))`;
  const componentDecl = `  ${className} ${componentName} ${annotation};\n`;

  const lines = docText.split("\n");
  const astNode = getAstNodeFromInstance(classInstance);
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
  const astNode = getAstNodeFromInstance(classInstance);
  const classRange = getNodeRange(astNode);

  // Build the new coordinateSystem(...) arguments string
  const formatCoordSys = (existing?: {
    extent?: [[number, number], [number, number]] | undefined;
    grid?: [number, number] | undefined;
    preserveAspectRatio?: boolean | undefined;
    initialScale?: number | undefined;
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

  const existingDiagram: IDiagram | null =
    typeof classInstance?.annotation === "function" ? (classInstance.annotation("Diagram") as IDiagram | null) : null;
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
      const diagramCall = findKeywordCallOpenParen(maskedAnnInner, "Diagram");
      if (!diagramCall) continue;

      const diagOpenOffset = annInnerStart + diagramCall.openParenIndex;
      const diagCloseOffset = findBalancedClose(maskedText, diagOpenOffset, annClose);
      if (diagCloseOffset === -1) continue;

      const diagInnerStart = diagOpenOffset + 1;
      const maskedDiagInner = maskedText.slice(diagInnerStart, diagCloseOffset);
      const csCall = findKeywordCallOpenParen(maskedDiagInner, "coordinateSystem");
      if (csCall) {
        const csStartOffset = diagInnerStart + csCall.startIndex;
        const csOpenOffset = diagInnerStart + csCall.openParenIndex;
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

/**
 * Plans fast Modelica diagram edits (`move`, `resize`, `rotate`, `moveEdge`, `connect`, `disconnect`,
 * `reconnect`, `deleteComponents`, `updateName`, `updateDescription`, `updateParameter`, `updateProperty`)
 * directly against a live {@link CstDocumentSession}, coalescing all resulting edits through {@link CstTransaction}.
 * Returns `null` for actions requiring full workspace resolution (e.g. `addComponent`, icon primitive edits).
 */
export function planModelicaEditsOnSession(
  session: CstDocumentSession,
  actions: ReadonlyArray<Record<string, unknown>>,
  className?: string,
): { edits: CstTextEdit[]; hasStructural: boolean } | null {
  if (actions.length === 0) return { edits: [], hasStructural: false };

  // Defer workspace-dependent or icon-primitive actions to the LSP backend
  const unsupported = actions.some((a) => {
    const t = String(a["type"] ?? "");
    if (
      t === "addComponent" ||
      t === "addIconPrimitive" ||
      t === "updateIconPrimitive" ||
      t === "deleteIconPrimitive" ||
      t === "reorderIconPrimitive" ||
      t === "updateCoordinateSystem"
    ) {
      return true;
    }
    if (t === "move" && Array.isArray(a["items"])) {
      return (a["items"] as Array<{ name?: string }>).some((i) => i.name?.startsWith("__icon_gfx_"));
    }
    if (t === "resize" && a["item"]) {
      return String((a["item"] as { name?: string }).name ?? "").startsWith("__icon_gfx_");
    }
    if (t === "deleteComponents" && Array.isArray(a["names"])) {
      return (a["names"] as string[]).some((n) => n.startsWith("__icon_gfx_"));
    }
    return false;
  });
  if (unsupported) return null;

  const docText = session.text;
  const fallbackInstance = buildFallbackClassInstance(docText, className);
  if (!fallbackInstance) return null;

  const tx = new CstTransaction(session);
  let hasStructural = false;

  const pushEdits = (rawEdits: TextEdit[]) => {
    for (const e of rawEdits) {
      const startOff = session.positionToOffset(e.range.start);
      const endOff = session.positionToOffset(e.range.end);
      tx.replaceRange(startOff, endOff, e.newText);
    }
  };

  for (const act of actions) {
    const t = String(act["type"] ?? "");
    if (t === "move" && Array.isArray(act["items"])) {
      pushEdits(computePlacementEdits(docText, fallbackInstance, act["items"] as PlacementItem[]));
    } else if ((t === "resize" || t === "rotate") && act["item"]) {
      pushEdits(computePlacementEdits(docText, fallbackInstance, [act["item"] as PlacementItem]));
    } else if (t === "moveEdge" && Array.isArray(act["edges"])) {
      pushEdits(computeEdgePointEdits(docText.split("\n"), fallbackInstance, act["edges"] as EdgeItem[]));
    } else if (t === "connect" && typeof act["source"] === "string" && typeof act["target"] === "string") {
      pushEdits(
        computeConnectInsert(
          docText,
          fallbackInstance,
          act["source"],
          act["target"],
          act["points"] as Array<{ x: number; y: number }> | undefined,
        ),
      );
      hasStructural = true;
    } else if (t === "disconnect" && typeof act["source"] === "string" && typeof act["target"] === "string") {
      pushEdits(computeConnectRemove(docText, fallbackInstance, act["source"], act["target"]));
      hasStructural = true;
    } else if (
      t === "reconnect" &&
      typeof act["oldSource"] === "string" &&
      typeof act["oldTarget"] === "string" &&
      typeof act["newSource"] === "string" &&
      typeof act["newTarget"] === "string"
    ) {
      pushEdits(computeConnectRemove(docText, fallbackInstance, act["oldSource"], act["oldTarget"]));
      pushEdits(
        computeConnectInsert(
          docText,
          fallbackInstance,
          act["newSource"],
          act["newTarget"],
          act["points"] as Array<{ x: number; y: number }> | undefined,
        ),
      );
      hasStructural = true;
    } else if (t === "deleteComponents" && Array.isArray(act["names"])) {
      pushEdits(computeComponentsDelete(docText, fallbackInstance, act["names"] as string[]));
      hasStructural = true;
    } else if (t === "updateName" && typeof act["oldName"] === "string" && typeof act["newName"] === "string") {
      pushEdits(computeNameEdit(fallbackInstance, act["oldName"], act["newName"], docText));
      hasStructural = true;
    } else if (t === "updateDescription" && typeof act["name"] === "string" && typeof act["description"] === "string") {
      pushEdits(computeDescriptionEdit(docText, fallbackInstance, act["name"], act["description"]));
    } else if (t === "updateParameter" && typeof act["name"] === "string" && typeof act["parameter"] === "string") {
      pushEdits(
        computeParameterEdit(fallbackInstance, act["name"], act["parameter"], String(act["value"] ?? ""), docText),
      );
    } else if (t === "updateProperty" && typeof act["name"] === "string" && typeof act["key"] === "string") {
      pushEdits(computeParameterEdit(fallbackInstance, act["name"], act["key"], String(act["value"] ?? ""), docText));
    }
  }

  return { edits: tx.commit().edits, hasStructural };
}
