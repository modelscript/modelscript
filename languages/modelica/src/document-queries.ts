// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure CST-walking document queries for Modelica source files.
 *
 * Replaces regex-based source scanning in editor/workbench layers with
 * deterministic traversals over the native WebAssembly GLR parser's CST.
 */

import { isSignedAsciiNumberText } from "./flattener/expressions/cst-utils.js";

/**
 * Structural CST node interface compatible with `@modelscript/modelica/parser`'s
 * `SyntaxNode` as well as duck-typed CST nodes across workspace packages.
 */
export interface ModelicaCstNode {
  readonly type: string;
  readonly text?: string;
  readonly startOffset?: number;
  readonly endOffset?: number;
  readonly startIndex?: number;
  readonly endIndex?: number;
  readonly startPosition?: { readonly row: number; readonly column: number };
  readonly endPosition?: { readonly row: number; readonly column: number };
  readonly children?: readonly ModelicaCstNode[];
  readonly namedChildren?: readonly ModelicaCstNode[];
  childForFieldName?(name: string): ModelicaCstNode | null | undefined;
}

/**
 * A scalar numeric `parameter` or `constant` declaration extracted from a Modelica CST,
 * including exact character offsets for regex-free source editing.
 */
export interface ModelicaScalarParameter {
  /** Component identifier name. */
  name: string;
  /** Exact raw numeric literal text of the binding (e.g. `"41840.0"`, `"-9.81"`, `"1e-3"`). */
  value: string;
  /** Optional `unit="..."` modification string if present. */
  unit?: string;
  /** 1-based line number of the declaration. */
  line: number;
  /** Character start offset of the component declaration in `source`. */
  startOffset: number;
  /** Character end offset of the component declaration in `source`. */
  endOffset: number;
  /** Character start offset of the scalar numeric binding expression in `source`. */
  valueStartOffset: number;
  /** Character end offset of the scalar numeric binding expression in `source`. */
  valueEndOffset: number;
}

/** Parsed CST modifier value (string, number, boolean, or numeric vector). */
export type ModelicaModifierValue = string | number | boolean | number[];

/**
 * Structured CAD annotation or MSL MultiBody visualizer component entry
 * extracted from a Modelica CST, compatible with `RawCadVariableEntry`.
 */
export interface ModelicaCadAnnotationEntry {
  /** Component variable name. */
  name: string;
  /** Origin of the CAD metadata. */
  kind: "annotation" | "modifier" | "multibody";
  /** Declared Modelica type specifier (without leading dot). */
  typeSpecifier: string;
  /** Unqualified short type name (last dot-separated segment). */
  shortType: string;
  /** Canonical CAD annotation string (e.g. `CAD(uri="...", scale={1, 1, 1})`), if available. */
  cad?: string;
  /** Resolved shapeType (explicit modifier or MultiBody default), if applicable. */
  shapeType?: string;
  /** Parsed CST modifiers on the component declaration or CAD annotation. */
  modifiers: Record<string, ModelicaModifierValue>;
}

// ---------------------------------------------------------------------------
// Low-level CST helpers (zero regex)
// ---------------------------------------------------------------------------

function getStartOffset(node: ModelicaCstNode): number {
  return node.startOffset ?? node.startIndex ?? 0;
}

function getEndOffset(node: ModelicaCstNode): number {
  return node.endOffset ?? node.endIndex ?? 0;
}

function getNodeText(node: ModelicaCstNode, source: string): string {
  const start = node.startOffset ?? node.startIndex;
  const end = node.endOffset ?? node.endIndex;
  if (typeof start === "number" && typeof end === "number" && end >= start && end <= source.length) {
    return source.slice(start, end);
  }
  return node.text ?? "";
}

function getChildren(node: ModelicaCstNode): readonly ModelicaCstNode[] {
  return node.children ?? [];
}

function getField(node: ModelicaCstNode, fieldName: string): ModelicaCstNode | null {
  if (typeof node.childForFieldName === "function") {
    const found = node.childForFieldName(fieldName);
    if (found) return found;
  }
  return null;
}

function findDirectChildByType(node: ModelicaCstNode, typeName: string): ModelicaCstNode | null {
  for (const child of getChildren(node)) {
    if (child.type === typeName) return child;
  }
  return null;
}

function splitAsciiWords(text: string): string[] {
  const words: string[] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? text.charCodeAt(i) : 32;
    const isWs = c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12;
    if (isWs) {
      if (start !== -1) {
        words.push(text.slice(start, i));
        start = -1;
      }
    } else if (start === -1) {
      start = i;
    }
  }
  return words;
}

function computeOneBasedLine(source: string, offset: number): number {
  let line = 1;
  const limit = Math.min(offset, source.length);
  for (let i = 0; i < limit; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function unquoteStringLiteral(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.charCodeAt(0) !== 34 || trimmed.charCodeAt(trimmed.length - 1) !== 34) {
    return null;
  }
  let out = "";
  for (let i = 1; i < trimmed.length - 1; i++) {
    const ch = trimmed[i]!;
    if (ch === "\\" && i + 1 < trimmed.length - 1) {
      const next = trimmed[i + 1]!;
      if (next === '"' || next === "\\") {
        out += next;
        i++;
        continue;
      }
      if (next === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (next === "t") {
        out += "\t";
        i++;
        continue;
      }
      if (next === "r") {
        out += "\r";
        i++;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function collectElementModifications(classModNode: ModelicaCstNode): ModelicaCstNode[] {
  const result: ModelicaCstNode[] = [];
  const stack: ModelicaCstNode[] = [...getChildren(classModNode)].reverse();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "element_modification") {
      result.push(cur);
      continue;
    }
    // Do not descend into nested class_modification scopes
    if (cur.type === "class_modification" || cur.type === "class_definition") {
      continue;
    }
    const children = getChildren(cur);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]!);
    }
  }
  return result;
}

function getElementModName(elemMod: ModelicaCstNode, source: string): string {
  const nameNode = getField(elemMod, "name") ?? findDirectChildByType(elemMod, "name");
  return nameNode ? getNodeText(nameNode, source).trim() : "";
}

function getElementModModification(elemMod: ModelicaCstNode): ModelicaCstNode | null {
  return getField(elemMod, "modification") ?? findDirectChildByType(elemMod, "modification");
}

function getModificationClassMod(modNode: ModelicaCstNode): ModelicaCstNode | null {
  return getField(modNode, "class_modification") ?? findDirectChildByType(modNode, "class_modification");
}

function getModificationExpr(modNode: ModelicaCstNode): ModelicaCstNode | null {
  return getField(modNode, "modification_expression") ?? findDirectChildByType(modNode, "modification_expression");
}

/**
 * Unwraps single-child expression wrapper nodes until reaching a meaningful expression or leaf.
 */
function unwrapExpressionNode(node: ModelicaCstNode): ModelicaCstNode {
  let cur = node;
  while (true) {
    const children = getChildren(cur);
    if (children.length === 1) {
      const only = children[0]!;
      if (
        cur.type === "modification_expression" ||
        cur.type === "expression" ||
        cur.type === "simple_expression" ||
        cur.type === "logical_expression" ||
        cur.type === "logical_term" ||
        cur.type === "logical_factor" ||
        cur.type === "relation" ||
        cur.type === "arithmetic_expression" ||
        cur.type === "term" ||
        cur.type === "factor" ||
        cur.type === "primary" ||
        cur.type === "lhs_expression" ||
        cur.type === "lhs_primary"
      ) {
        cur = only;
        continue;
      }
    }
    break;
  }
  return cur;
}

/**
 * Evaluates a CST expression node as a scalar numeric literal (optionally signed with `+` or `-`).
 * Returns `null` for non-numeric expressions (identifiers, function calls, binary ops, arrays).
 */
function parseScalarNumberFromExprCst(exprNode: ModelicaCstNode, source: string): number | null {
  const unwrapped = unwrapExpressionNode(exprNode);
  const type = unwrapped.type;

  if (type === "unsigned_number" || type === "unsigned_integer" || type === "unsigned_real") {
    const raw = getNodeText(unwrapped, source).trim();
    if (!isSignedAsciiNumberText(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  // Unary sign: `(+ | -) operand`
  const children = getChildren(unwrapped);
  if (children.length === 2) {
    const opText = getNodeText(children[0]!, source).trim();
    if (opText === "+" || opText === "-") {
      const operandVal = parseScalarNumberFromExprCst(children[1]!, source);
      if (operandVal !== null) {
        return opText === "-" ? -operandVal : operandVal;
      }
    }
  }

  return null;
}

/**
 * Parses a Modelica CST expression node into a JS modifier value:
 * string literal, boolean literal, scalar numeric literal, or numeric array `{a, b, c}`.
 */
function parseModifierValueFromExprCst(exprNode: ModelicaCstNode, source: string): ModelicaModifierValue | undefined {
  const unwrapped = unwrapExpressionNode(exprNode);
  const type = unwrapped.type;
  const rawText = getNodeText(unwrapped, source).trim();

  if (type === "string_literal") {
    const str = unquoteStringLiteral(rawText);
    return str !== null ? str : undefined;
  }

  if (rawText === "true") return true;
  if (rawText === "false") return false;

  const num = parseScalarNumberFromExprCst(unwrapped, source);
  if (num !== null) return num;

  // Array literal `{ expr1, expr2, ... }`
  const children = getChildren(unwrapped);
  if (
    children.length >= 2 &&
    getNodeText(children[0]!, source).trim() === "{" &&
    getNodeText(children[children.length - 1]!, source).trim() === "}"
  ) {
    const arrayArgsNode = getField(unwrapped, "arguments") ?? findDirectChildByType(unwrapped, "array_arguments");
    if (!arrayArgsNode) return undefined;

    const nums: number[] = [];
    let cur: ModelicaCstNode | null = arrayArgsNode;
    while (cur) {
      const curChildren = getChildren(cur);
      // Reject array comprehensions (`{expr for i in ...}`)
      for (const ch of curChildren) {
        if (ch.type === "for_indices" || getNodeText(ch, source).trim() === "for") {
          return undefined;
        }
      }
      const elemExpr = findDirectChildByType(cur, "expression");
      if (!elemExpr) return undefined;
      const elemVal = parseScalarNumberFromExprCst(elemExpr, source);
      if (elemVal === null) return undefined;
      nums.push(elemVal);

      cur = findDirectChildByType(cur, "array_arguments_non_first");
    }
    return nums.length > 0 ? nums : undefined;
  }

  return undefined;
}

function parseModifiersFromClassMod(
  classModNode: ModelicaCstNode,
  source: string,
): Record<string, ModelicaModifierValue> {
  const modifiers: Record<string, ModelicaModifierValue> = {};
  for (const elemMod of collectElementModifications(classModNode)) {
    const key = getElementModName(elemMod, source);
    if (!key) continue;
    const mod = getElementModModification(elemMod);
    if (!mod) continue;
    const expr = getModificationExpr(mod);
    if (!expr) continue;
    const val = parseModifierValueFromExprCst(expr, source);
    if (val !== undefined) {
      modifiers[key] = val;
    }
  }
  return modifiers;
}

// ---------------------------------------------------------------------------
// 1. Primary Modelica Class Name Extraction
// ---------------------------------------------------------------------------

const CLASS_KINDS = new Set(["model", "block", "class", "connector", "record", "package", "function", "type"]);

const SIMULATABLE_CLASS_KINDS = new Set(["model", "block", "class"]);

function extractClassKind(classDefNode: ModelicaCstNode, source: string): string | null {
  const prefixesNode =
    getField(classDefNode, "class_prefixes") ?? findDirectChildByType(classDefNode, "class_prefixes");
  if (!prefixesNode) return null;
  const words = splitAsciiWords(getNodeText(prefixesNode, source));
  for (let i = words.length - 1; i >= 0; i--) {
    const lower = words[i]!.toLowerCase();
    if (CLASS_KINDS.has(lower)) {
      return lower;
    }
  }
  return null;
}

function extractClassName(classDefNode: ModelicaCstNode, source: string): string | null {
  const specWrapper =
    getField(classDefNode, "class_specifier") ?? findDirectChildByType(classDefNode, "class_specifier");
  const specNode =
    (specWrapper &&
      (findDirectChildByType(specWrapper, "long_class_specifier") ??
        findDirectChildByType(specWrapper, "short_class_specifier") ??
        findDirectChildByType(specWrapper, "der_class_specifier"))) ??
    specWrapper ??
    findDirectChildByType(classDefNode, "long_class_specifier") ??
    findDirectChildByType(classDefNode, "short_class_specifier") ??
    findDirectChildByType(classDefNode, "der_class_specifier");

  if (!specNode) return null;
  const nameNode = getField(specNode, "name") ?? findDirectChildByType(specNode, "identifier");
  if (!nameNode) return null;
  const name = getNodeText(nameNode, source).trim();
  return name.length > 0 ? name : null;
}

function annotationClauseHasExperiment(annNode: ModelicaCstNode, source: string): boolean {
  const classMod = findDirectChildByType(annNode, "class_modification");
  if (!classMod) return false;
  for (const elemMod of collectElementModifications(classMod)) {
    if (getElementModName(elemMod, source).toLowerCase() === "experiment") {
      const mod = getElementModModification(elemMod);
      if (mod && getModificationClassMod(mod)) {
        return true;
      }
    }
  }
  return false;
}

function classBodyHasExperimentAnnotation(classDefNode: ModelicaCstNode, source: string): boolean {
  const stack: ModelicaCstNode[] = [...getChildren(classDefNode)].reverse();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    // Do not attribute a nested class's experiment(...) annotation to its enclosing class
    if (cur.type === "class_definition") {
      continue;
    }
    if (cur.type === "annotation_clause") {
      if (annotationClauseHasExperiment(cur, source)) {
        return true;
      }
      continue;
    }
    const children = getChildren(cur);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]!);
    }
  }
  return false;
}

/**
 * Extracts the primary simulatable class name from a parsed Modelica CST.
 *
 * Selection priority (matching `extractPrimaryModelicaClassName`):
 * 1. First `model`, `block`, or `class` containing an `experiment(...)` annotation in its body.
 * 2. Otherwise, the last `model`, `block`, or `class` in document order.
 * 3. Otherwise, the first class definition of any kind.
 */
export function extractPrimaryModelicaClassNameFromCst(
  rootNode: ModelicaCstNode | null | undefined,
  source: string,
): string | null {
  if (!rootNode || !source) return null;

  const classes: { kind: string; name: string; hasExperiment: boolean }[] = [];

  const walk = (node: ModelicaCstNode): void => {
    if (node.type === "class_definition") {
      const kind = extractClassKind(node, source);
      const name = extractClassName(node, source);
      if (kind && name) {
        const hasExperiment = SIMULATABLE_CLASS_KINDS.has(kind) && classBodyHasExperimentAnnotation(node, source);
        classes.push({ kind, name, hasExperiment });
      }
    }
    for (const child of getChildren(node)) {
      walk(child);
    }
  };

  walk(rootNode);

  if (classes.length === 0) return null;

  for (const entry of classes) {
    if (entry.hasExperiment) {
      return entry.name;
    }
  }

  for (let i = classes.length - 1; i >= 0; i--) {
    if (SIMULATABLE_CLASS_KINDS.has(classes[i]!.kind)) {
      return classes[i]!.name;
    }
  }

  return classes[0]!.name;
}

// ---------------------------------------------------------------------------
// 2. Scalar Parameter Extraction
// ---------------------------------------------------------------------------

function hasParameterOrConstantPrefix(compClause: ModelicaCstNode, source: string): boolean {
  const prefixNode = getField(compClause, "type_prefix") ?? findDirectChildByType(compClause, "type_prefix");
  if (!prefixNode) return false;
  const words = splitAsciiWords(getNodeText(prefixNode, source));
  return words.includes("parameter") || words.includes("constant");
}

function collectComponentDeclarations(compClause: ModelicaCstNode): ModelicaCstNode[] {
  const decls: ModelicaCstNode[] = [];
  const compList = getField(compClause, "component_list") ?? findDirectChildByType(compClause, "component_list");
  if (compList) {
    if (compList.type === "component_declaration") {
      decls.push(compList);
      return decls;
    }
    for (const child of getChildren(compList)) {
      if (child.type === "component_declaration") {
        decls.push(child);
      }
    }
    if (decls.length > 0) return decls;
  }
  for (const child of getChildren(compClause)) {
    if (child.type === "component_declaration") {
      decls.push(child);
    }
  }
  return decls;
}

/**
 * Extracts scalar numeric `parameter` and `constant` declarations from a parsed Modelica CST,
 * returning exact character offsets for both the declaration and its numeric binding value.
 */
export function extractModelicaParametersFromCst(
  rootNode: ModelicaCstNode | null | undefined,
  source: string,
): ModelicaScalarParameter[] {
  if (!rootNode || !source) return [];

  const params: ModelicaScalarParameter[] = [];

  const walk = (node: ModelicaCstNode): void => {
    if (node.type === "component_clause") {
      if (
        hasParameterOrConstantPrefix(node, source) &&
        !(getField(node, "array_subscripts") ?? findDirectChildByType(node, "array_subscripts"))
      ) {
        for (const compDecl of collectComponentDeclarations(node)) {
          const decl = getField(compDecl, "declaration") ?? findDirectChildByType(compDecl, "declaration");
          if (!decl) continue;
          // Skip array parameters
          if (getField(decl, "array_subscripts") ?? findDirectChildByType(decl, "array_subscripts")) {
            continue;
          }
          const nameNode = getField(decl, "name") ?? findDirectChildByType(decl, "identifier");
          const modNode = getField(decl, "modification") ?? findDirectChildByType(decl, "modification");
          if (!nameNode || !modNode) continue;

          const modExpr = getModificationExpr(modNode);
          if (!modExpr) continue;

          // Verify scalar numeric literal binding via CST structure
          const numericVal = parseScalarNumberFromExprCst(modExpr, source);
          if (numericVal === null) continue;

          const name = getNodeText(nameNode, source).trim();
          if (!name) continue;

          const valueStartOffset = getStartOffset(modExpr);
          const valueEndOffset = getEndOffset(modExpr);
          const value = source.slice(valueStartOffset, valueEndOffset);

          // Extract optional `unit="..."` from declaration's class_modification
          let unit: string | undefined;
          const classMod = getModificationClassMod(modNode);
          if (classMod) {
            for (const elemMod of collectElementModifications(classMod)) {
              if (getElementModName(elemMod, source) === "unit") {
                const unitMod = getElementModModification(elemMod);
                const unitExpr = unitMod ? getModificationExpr(unitMod) : null;
                if (unitExpr) {
                  const parsedUnit = parseModifierValueFromExprCst(unitExpr, source);
                  if (typeof parsedUnit === "string") {
                    unit = parsedUnit;
                  }
                }
                break;
              }
            }
          }

          const startOffset = getStartOffset(compDecl);
          const endOffset = getEndOffset(compDecl);
          const line =
            compDecl.startPosition !== undefined
              ? compDecl.startPosition.row + 1
              : computeOneBasedLine(source, startOffset);

          const entry: ModelicaScalarParameter = {
            name,
            value,
            line,
            startOffset,
            endOffset,
            valueStartOffset,
            valueEndOffset,
          };
          if (unit !== undefined) {
            entry.unit = unit;
          }
          params.push(entry);
        }
      }
      return;
    }

    for (const child of getChildren(node)) {
      walk(child);
    }
  };

  walk(rootNode);
  return params;
}

// ---------------------------------------------------------------------------
// 3. CAD Annotation & MSL MultiBody Component Extraction
// ---------------------------------------------------------------------------

const MULTIBODY_VISUALIZER_TYPES = new Set([
  "FixedShape",
  "FixedShape2",
  "Shape",
  "FixedArrow",
  "SignalArrow",
  "ForceArrow",
  "TorqueArrow",
  "VelocityArrow",
  "Arrow",
  "DoubleArrow",
  "Vector",
  "Torus",
  "VoluminousWheel",
  "Rectangle",
  "PipeWithScalarField",
]);

const MULTIBODY_PART_TYPES = new Set(["BodyCylinder", "BodyBox", "BodyShape", "Body", "FixedTranslation"]);
const MULTIBODY_FORCE_TYPES = new Set(["Spring"]);
const MULTIBODY_JOINT_TYPES = new Set(["Revolute", "Prismatic"]);

const MULTIBODY_ARROW_TYPES = new Set([
  "FixedArrow",
  "SignalArrow",
  "ForceArrow",
  "TorqueArrow",
  "VelocityArrow",
  "Arrow",
  "DoubleArrow",
  "Vector",
]);

function normalizeTypeSpecifier(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

function getShortTypeName(typeSpec: string): string {
  const lastDot = typeSpec.lastIndexOf(".");
  return lastDot >= 0 ? typeSpec.slice(lastDot + 1) : typeSpec;
}

function matchMultiBodyShortType(typeSpec: string): string | null {
  let rel = normalizeTypeSpecifier(typeSpec);
  const mslPrefix = "Modelica.Mechanics.MultiBody.";
  if (rel.startsWith(mslPrefix)) {
    rel = rel.slice(mslPrefix.length);
  }
  const segs = rel.split(".");
  if (segs[0] === "Visualizers") {
    const shortType = segs.length === 3 && segs[1] === "Advanced" ? segs[2]! : segs.length === 2 ? segs[1]! : null;
    if (shortType && MULTIBODY_VISUALIZER_TYPES.has(shortType)) {
      return shortType;
    }
  } else if (segs[0] === "Parts" && segs.length === 2 && MULTIBODY_PART_TYPES.has(segs[1]!)) {
    return segs[1]!;
  } else if (segs[0] === "Forces" && segs.length === 2 && MULTIBODY_FORCE_TYPES.has(segs[1]!)) {
    return segs[1]!;
  } else if (segs[0] === "Joints" && segs.length === 2 && MULTIBODY_JOINT_TYPES.has(segs[1]!)) {
    return segs[1]!;
  }
  return null;
}

function resolveMultiBodyShapeType(shortType: string, modifiers: Record<string, ModelicaModifierValue>): string {
  if (shortType === "Torus" || shortType === "VoluminousWheel") {
    return "surface:torus";
  }
  if (shortType === "Rectangle") {
    return "surface:rectangle";
  }
  if (shortType === "PipeWithScalarField") {
    return "surface:pipeWithScalarField";
  }
  if (MULTIBODY_ARROW_TYPES.has(shortType)) {
    const rawQuantity = modifiers["quantity"];
    const quantity = typeof rawQuantity === "string" ? rawQuantity.toLowerCase() : "";
    return shortType === "DoubleArrow" || quantity.includes("torque") ? "doublearrow" : "arrow";
  }
  const rawShapeType = modifiers["shapeType"];
  if (typeof rawShapeType === "string" && rawShapeType.length > 0) {
    return rawShapeType.startsWith("modelica://") ? rawShapeType : rawShapeType.toLowerCase();
  }
  if (shortType === "Spring") return "spring";
  if (shortType === "BodyBox") return "box";
  if (shortType === "Body") return "sphere";
  return "cylinder";
}

function findAnnotationClauseInDescription(compDecl: ModelicaCstNode): ModelicaCstNode | null {
  const desc = getField(compDecl, "description") ?? findDirectChildByType(compDecl, "description");
  if (!desc) return null;
  return findDirectChildByType(desc, "annotation_clause");
}

/**
 * Extracts CAD annotations, explicit `CAD="CAD(...)"` modifiers, and
 * `Modelica.Mechanics.MultiBody` visualizer/part/force/joint components from a parsed Modelica CST.
 */
export function extractModelicaCadAnnotationsFromCst(
  rootNode: ModelicaCstNode | null | undefined,
  source: string,
): ModelicaCadAnnotationEntry[] {
  if (!rootNode || !source) return [];

  const results: ModelicaCadAnnotationEntry[] = [];
  const seenCadKeys = new Set<string>();
  const seenMultiBodyNames = new Set<string>();

  const pushCadEntry = (entry: ModelicaCadAnnotationEntry): void => {
    const key = entry.cad ? `${entry.name}:${entry.cad}` : `${entry.name}:`;
    if (seenCadKeys.has(key)) return;
    seenCadKeys.add(key);
    results.push(entry);
  };

  const walk = (node: ModelicaCstNode): void => {
    if (node.type === "component_clause") {
      const typeSpecNode = getField(node, "type_specifier") ?? findDirectChildByType(node, "type_specifier");
      const typeSpecifier = typeSpecNode ? normalizeTypeSpecifier(getNodeText(typeSpecNode, source)) : "";
      const shortType = getShortTypeName(typeSpecifier);
      const multiBodyShort = matchMultiBodyShortType(typeSpecifier);

      for (const compDecl of collectComponentDeclarations(node)) {
        const decl = getField(compDecl, "declaration") ?? findDirectChildByType(compDecl, "declaration");
        if (!decl) continue;
        const nameNode = getField(decl, "name") ?? findDirectChildByType(decl, "identifier");
        if (!nameNode) continue;
        const varName = getNodeText(nameNode, source).trim();
        if (!varName) continue;

        const declMod = getField(decl, "modification") ?? findDirectChildByType(decl, "modification");
        const declClassMod = declMod ? getModificationClassMod(declMod) : null;
        const declModifiers = declClassMod ? parseModifiersFromClassMod(declClassMod, source) : {};

        // 1. Check component `annotation(... CAD(...) / cad(...) / CADPort(...) ...)`
        const annClause = findAnnotationClauseInDescription(compDecl);
        if (annClause) {
          const annClassMod = findDirectChildByType(annClause, "class_modification");
          if (annClassMod) {
            for (const elemMod of collectElementModifications(annClassMod)) {
              const modName = getElementModName(elemMod, source);
              if (modName === "CAD" || modName === "cad" || modName === "CADPort") {
                const innerMod = getElementModModification(elemMod);
                const innerClassMod = innerMod ? getModificationClassMod(innerMod) : null;
                if (innerClassMod) {
                  const prefix = modName === "CADPort" ? "CADPort" : "CAD";
                  const cadStr = `${prefix}${getNodeText(innerClassMod, source)}`;
                  const cadModifiers = parseModifiersFromClassMod(innerClassMod, source);
                  pushCadEntry({
                    name: varName,
                    kind: "annotation",
                    typeSpecifier,
                    shortType,
                    cad: cadStr,
                    modifiers: cadModifiers,
                  });
                }
              }
            }
          }
        }

        // 2. Check explicit `CAD="CAD(...)"` or `CAD="CADPort(...)"` string modifier
        const explicitCad = declModifiers["CAD"];
        if (typeof explicitCad === "string" && (explicitCad.startsWith("CAD(") || explicitCad.startsWith("CADPort("))) {
          pushCadEntry({
            name: varName,
            kind: "modifier",
            typeSpecifier,
            shortType,
            cad: explicitCad,
            modifiers: declModifiers,
          });
        }

        // 3. Check MSL MultiBody Visualizers / Parts / Forces / Joints
        if (multiBodyShort && !seenMultiBodyNames.has(varName)) {
          seenMultiBodyNames.add(varName);
          const shapeType = resolveMultiBodyShapeType(multiBodyShort, declModifiers);
          results.push({
            name: varName,
            kind: "multibody",
            typeSpecifier,
            shortType: multiBodyShort,
            shapeType,
            modifiers: declModifiers,
          });
        }
      }
      return;
    }

    for (const child of getChildren(node)) {
      walk(child);
    }
  };

  walk(rootNode);
  return results;
}
