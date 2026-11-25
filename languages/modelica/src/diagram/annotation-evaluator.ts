// SPDX-License-Identifier: AGPL-3.0-or-later

import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { resolveModelicaConstant } from "../constants.js";
import {
  evalArithmeticString,
  isAsciiIdentContinue,
  isAsciiWhitespaceCode,
  isSignedAsciiIntText,
  isSignedAsciiNumberText,
} from "../flattener/expressions/cst-utils.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "../types.js";

// ── Annotation Enum Definitions ─────────────────────────────────────────────

type EnumDef = Record<string, string>;

export const ANNOTATION_ENUMS: Record<string, EnumDef> = {
  FillPattern: {
    None: "None",
    Solid: "Solid",
    Horizontal: "Horizontal",
    Vertical: "Vertical",
    Cross: "Cross",
    Forward: "Forward",
    Backward: "Backward",
    CrossDiag: "CrossDiag",
    HorizontalCylinder: "HorizontalCylinder",
    VerticalCylinder: "VerticalCylinder",
    Sphere: "Sphere",
  },
  LinePattern: { None: "None", Solid: "Solid", Dash: "Dash", Dot: "Dot", DashDot: "DashDot", DashDotDot: "DashDotDot" },
  Arrow: { None: "None", Open: "Open", Filled: "Filled", Half: "Half" },
  Smooth: { None: "None", Bezier: "Bezier" },
  BorderPattern: { None: "None", Raised: "Raised", Sunken: "Sunken", Engraved: "Engraved" },
  EllipseClosure: { None: "None", Chord: "Chord", Radial: "Radial", Automatic: "Automatic" },
  TextAlignment: { Left: "Left", Center: "Center", Right: "Right" },
  TextStyle: { Bold: "Bold", Italic: "Italic", UnderLine: "UnderLine" },
};

function unescapeDoubleQuotedInner(inner: string): string {
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === '"' || next === "\\") {
        out += next;
        i++;
        continue;
      }
    }
    out += inner[i];
  }
  return out;
}

function tryParseNumericLiteral(t: string): number | undefined {
  if (isSignedAsciiIntText(t)) return parseInt(t, 10);
  if (isSignedAsciiNumberText(t)) {
    const n = parseFloat(t);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

function tryParseScalarText(t: string): number | boolean | undefined {
  if (t === "true") return true;
  if (t === "false") return false;
  return tryParseNumericLiteral(t);
}

function isSafeArithmeticText(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      (c >= 48 && c <= 57) ||
      c === 43 ||
      c === 45 ||
      c === 42 ||
      c === 47 ||
      c === 40 ||
      c === 41 ||
      c === 46 ||
      c === 94 ||
      c === 101 ||
      c === 69 ||
      isAsciiWhitespaceCode(c)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

// ── Safe Arithmetic Evaluator ───────────────────────────────────────────────

/**
 * Evaluates safe arithmetic expressions, delegating to the unified
 * canonical arithmetic string evaluator in cst-utils.
 */
export function evalSafeArithmetic(exprStr: string): number | null {
  if (!exprStr) return null;
  return evalArithmeticString(exprStr, true);
}

// ── Annotation Value & Structural Types ─────────────────────────────────────

export type AnnotationPrimitive = string | number | boolean | null;
export type AnnotationValue = AnnotationPrimitive | AnnotationValue[] | AnnotationRecord;
export interface AnnotationRecord {
  [key: string]: AnnotationValue | undefined;
}

export interface ExperimentAnnotation extends AnnotationRecord {
  StartTime?: AnnotationValue | undefined;
  startTime?: AnnotationValue | undefined;
  StopTime?: AnnotationValue | undefined;
  stopTime?: AnnotationValue | undefined;
  Tolerance?: AnnotationValue | undefined;
  tolerance?: AnnotationValue | undefined;
  Interval?: AnnotationValue | undefined;
  interval?: AnnotationValue | undefined;
  NumberOfIntervals?: AnnotationValue | undefined;
  numberOfIntervals?: AnnotationValue | undefined;
  Algorithm?: AnnotationValue | undefined;
  algorithm?: AnnotationValue | undefined;
  EquidistantOutput?: AnnotationValue | undefined;
  equidistantOutput?: AnnotationValue | undefined;
}

export interface WebGpuAnnotation extends AnnotationRecord {
  workgroupSize?: AnnotationValue | undefined;
  precision?: AnnotationValue | undefined;
  parallelInstances?: AnnotationValue | undefined;
}

export interface AudioClockAnnotation extends AnnotationRecord {
  sampleRate?: AnnotationValue | undefined;
  targetHz?: AnnotationValue | undefined;
  realtimeFactor?: AnnotationValue | undefined;
}

export interface SdeAnnotation extends AnnotationRecord {
  method?: AnnotationValue | undefined;
  ensemblePaths?: AnnotationValue | undefined;
  seed?: AnnotationValue | undefined;
}

export interface BvpAnnotation extends AnnotationRecord {
  boundaryConditions?: AnnotationValue | undefined;
  method?: AnnotationValue | undefined;
  intervals?: AnnotationValue | undefined;
}

export interface SurrogateAnnotation extends AnnotationRecord {
  architecture?: AnnotationValue | undefined;
  datasetUri?: AnnotationValue | undefined;
  errorTolerance?: AnnotationValue | undefined;
}

export interface FeaMeshAnnotation extends AnnotationRecord {
  cadUri?: AnnotationValue | undefined;
  meshType?: AnnotationValue | undefined;
  material?: AnnotationValue | undefined;
  loadConnector?: AnnotationValue | undefined;
  feedbackDeflection?: AnnotationValue | undefined;
}

export interface CfdFlowAnnotation extends AnnotationRecord {
  grid?: AnnotationValue | undefined;
  dx?: AnnotationValue | undefined;
  turbulenceModel?: AnnotationValue | undefined;
  velocityVariable?: AnnotationValue | undefined;
  dragForceVariable?: AnnotationValue | undefined;
}

export interface DiffusionAnnotation extends AnnotationRecord {
  coefficient?: AnnotationValue | undefined;
  value?: AnnotationValue | undefined;
}

export interface BooleanFlagAnnotation extends AnnotationRecord {
  value?: AnnotationValue | undefined;
}

export interface DocumentationAnnotation extends AnnotationRecord {
  info?: AnnotationValue | undefined;
  revisions?: AnnotationValue | undefined;
}

export interface InteractiveBinding {
  action: "momentary" | "toggle" | "numeric" | "slider" | "selector" | "faceplate";
  variableName: string;
  targetSelector?: string | undefined;
  label?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  unit?: string | undefined;
  options?: { label: string; value: number | string }[] | undefined;
  onValue?: number | boolean | string | undefined;
  offValue?: number | boolean | string | undefined;
  confirmPrompt?: string | undefined;
}

interface AnnotationNamePartLike {
  identifier?: { text?: string | undefined } | undefined;
  name?: string | undefined;
  text?: string | undefined;
}

interface AnnotationNameLike {
  parts?: AnnotationNamePartLike[] | undefined;
  text?: string | undefined;
}

interface AnnotationModArgLike {
  name?: string | AnnotationNameLike | undefined;
  value?: unknown;
  expression?: unknown;
  modification?: AnnotationModNodeLike | undefined;
  classModification?: AnnotationNodeLike | undefined;
  children?: AnnotationNodeLike[] | undefined;
  namedChildren?: AnnotationNodeLike[] | undefined;
}

interface AnnotationModNodeLike {
  evaluatedExpression?: unknown;
  expression?: unknown;
  bindingExpression?: unknown;
  modificationExpression?: { expression?: unknown } | undefined;
  classModification?: AnnotationNodeLike | undefined;
  arguments?: AnnotationModArgLike[] | undefined;
  args?: AnnotationModArgLike[] | Map<string, AnnotationModArgLike> | undefined;
  getModificationArgument?: ((name: string) => unknown) | undefined;
}

interface AnnotationNodeLike {
  type?: string | undefined;
  text?: string | undefined;
  value?: unknown;
  name?: string | AnnotationNameLike | undefined;
  ptr?: number | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  tree?: { sourceCode?: string | undefined } | undefined;
  parent?: AnnotationNodeLike | null | undefined;
  nextNamedSibling?: AnnotationNodeLike | null | undefined;
  children?: AnnotationNodeLike[] | undefined;
  namedChildren?: AnnotationNodeLike[] | undefined;
  modification?: AnnotationModNodeLike | undefined;
  classModification?: AnnotationNodeLike | undefined;
  annotationClause?: { classModification?: AnnotationNodeLike | undefined } | undefined;
  modificationArguments?: AnnotationNodeLike[] | undefined;
  conditionAttribute?: { condition?: unknown } | undefined;
  operand?: unknown;
  operator?: string | ModelicaUnaryOperator | ModelicaBinaryOperator | undefined;
  operand1?: unknown;
  operand2?: unknown;
  left?: unknown;
  right?: unknown;
  condition?: unknown;
  expression?: unknown;
  thenExpression?: unknown;
  elseIfExpressionClauses?: Array<{ condition?: unknown; expression?: unknown }> | undefined;
  elseExpression?: unknown;
  startExpression?: unknown;
  stopExpression?: unknown;
  stepExpression?: unknown;
  parts?: Array<string | AnnotationNamePartLike> | undefined;
  expressionList?: { expressions?: unknown[] | undefined } | undefined;
  expressionLists?: Array<{ expressions?: unknown[] | undefined }> | undefined;
  functionReference?: { parts?: Array<string | AnnotationNamePartLike> | undefined } | undefined;
  functionCallArguments?:
    | {
        arguments?: Array<{ expression?: unknown } | AnnotationNodeLike> | undefined;
        namedArguments?:
          | Array<{
              identifier?: { text?: string | undefined } | undefined;
              name?: string | undefined;
              argument?: { expression?: unknown } | undefined;
            }>
          | undefined;
      }
    | undefined;
  identifier?: { text?: string | undefined } | undefined;
}

interface AnnotationDbLike {
  cstNode?: ((id: number) => unknown) | undefined;
  query?: ((name: string, id: number) => unknown) | undefined;
  byName?: ((name: string) => unknown[] | undefined) | undefined;
}

interface AnnotationScopeLike {
  id?: number | undefined;
  currentClassId?: number | undefined;
  name?: string | undefined;
  value?: unknown;
  defaultValue?: unknown;
  isClassInstance?: boolean | undefined;
  db?: AnnotationDbLike | undefined;
  parent?: AnnotationScopeLike | null | undefined;
  componentInstance?: AnnotationScopeLike | null | undefined;
  classInstance?: AnnotationScopeLike | null | undefined;
  declaration?:
    | {
        id?: number | undefined;
        cstNode?: AnnotationNodeLike | null | undefined;
        metadata?: { defaultValue?: unknown } | undefined;
      }
    | null
    | undefined;
  entry?: { id?: number | undefined } | null | undefined;
  cstNode?: AnnotationNodeLike | ((id: number) => unknown) | null | undefined;
  abstractSyntaxNode?: AnnotationNodeLike | null | undefined;
  modification?: AnnotationModNodeLike | null | undefined;
  extendsClassInstances?: AnnotationScopeLike[] | undefined;
  components?: AnnotationScopeLike[] | undefined;
  elements?: AnnotationScopeLike[] | undefined;
  _cachedConditionNode?: unknown;
  resolveSimpleName?: ((name: string) => unknown) | undefined;
  resolveName?: ((parts: string[]) => unknown) | undefined;
  query?: ((name: string, id: number) => unknown) | undefined;
  byName?: ((name: string) => unknown[] | undefined) | undefined;
}

function asAnnotationNode(value: unknown): AnnotationNodeLike | null {
  if (!value || typeof value !== "object") return null;
  return value as AnnotationNodeLike;
}

function asSyntaxNode(node: AnnotationNodeLike): SyntaxNode {
  return node as unknown as SyntaxNode;
}

function asAnnotationScope(value: unknown): AnnotationScopeLike | null {
  if (!value || typeof value !== "object") return null;
  return value as AnnotationScopeLike;
}

function asAnnotationDb(value: unknown): AnnotationDbLike | null {
  if (!value || typeof value !== "object") return null;
  return value as AnnotationDbLike;
}

function getScopeCstNode(scope: AnnotationScopeLike | null | undefined): AnnotationNodeLike | null {
  if (!scope) return null;
  const direct = typeof scope.cstNode === "function" ? null : scope.cstNode;
  return direct ?? scope.abstractSyntaxNode ?? scope.declaration?.cstNode ?? null;
}

// ── Value & Scope Extraction Helpers ────────────────────────────────────────

const activeNameResolutions = new Set<string>();

function findNamedModExprInClassMod(classMod: unknown, targetName: string): unknown {
  const root = asAnnotationNode(classMod);
  if (!root || !targetName) return null;
  if (Array.isArray(root.modificationArguments)) {
    for (const arg of root.modificationArguments) {
      const argName =
        typeof arg?.name === "string"
          ? arg.name
          : (arg?.name?.parts?.[0]?.identifier?.text ?? arg?.name?.parts?.[0]?.text ?? arg?.name?.text);
      if (argName?.trim() === targetName) {
        const direct = extractModExprNode(arg);
        if (direct) return direct;
        const subClassMod = extractClassModNode(arg);
        if (subClassMod) return findNamedModExprInClassMod(subClassMod, "start");
      }
    }
  }
  const walk = (node: AnnotationNodeLike | null | undefined): unknown => {
    if (!node) return null;
    if (
      Cst.ElementModification.is(asSyntaxNode(node)) ||
      node.type === "element_modification" ||
      node.type === "ElementModification"
    ) {
      let modName: string | null = null;
      if (Cst.ElementModification.is(asSyntaxNode(node))) {
        const n = Cst.ElementModification.name(asSyntaxNode(node));
        if (n?.text) modName = n.text.trim();
      }
      if (!modName) {
        const children = node.children || node.namedChildren;
        if (Array.isArray(children)) {
          const nameNode = children.find(
            (c) =>
              Cst.Identifier.is(asSyntaxNode(c)) ||
              Cst.Name.is(asSyntaxNode(c)) ||
              c.type === "identifier" ||
              c.type === "name",
          );
          if (nameNode?.text) modName = nameNode.text.trim();
        }
      }
      if (modName === targetName) {
        const direct = extractModExprNode(node);
        if (direct) return direct;
        const subClassMod = extractClassModNode(node);
        if (subClassMod) return findNamedModExprInClassMod(subClassMod, "start");
      }
      return null;
    }
    const children = node.namedChildren || node.children || [];
    for (const child of children) {
      if (child.text === "(" || child.text === ")" || child.text === ",") continue;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

function extractModExprFromCstNode(nodeInput: unknown, targetArgName?: string): unknown {
  const node = asAnnotationNode(nodeInput);
  if (!node) return null;
  if (targetArgName && typeof node.tree?.sourceCode === "string") {
    const src: string = node.tree.sourceCode;
    const sIdx = node.startIndex ?? 0;
    const eIdx = node.endIndex ?? src.length;
    const annIdx = src.indexOf("annotation", sIdx);
    const limitIdx = annIdx !== -1 && annIdx < eIdx ? annIdx : eIdx;
    const pos = src.indexOf(targetArgName, sIdx);
    if (pos === -1 || pos >= limitIdx) {
      return null;
    }
  }
  let curr: AnnotationNodeLike = node;
  while (
    curr &&
    (Cst.Identifier.is(asSyntaxNode(curr)) ||
      Cst.Name.is(asSyntaxNode(curr)) ||
      curr.type === "identifier" ||
      curr.type === "Identifier" ||
      curr.type === "name" ||
      curr.type === "Name") &&
    curr.parent
  ) {
    curr = curr.parent;
  }
  if (
    curr &&
    (Cst.Declaration.is(asSyntaxNode(curr)) || curr.type === "declaration" || curr.type === "Declaration") &&
    curr.parent &&
    (Cst.ComponentDeclaration.is(asSyntaxNode(curr.parent)) ||
      curr.parent.type === "component_declaration" ||
      curr.parent.type === "ComponentDeclaration")
  ) {
    curr = curr.parent;
  }

  const decl: AnnotationNodeLike =
    (Cst.ComponentDeclaration.is(asSyntaxNode(curr))
      ? asAnnotationNode(Cst.ComponentDeclaration.declaration(asSyntaxNode(curr)))
      : null) ??
    curr.children?.find(
      (c) => Cst.Declaration.is(asSyntaxNode(c)) || c.type === "declaration" || c.type === "Declaration",
    ) ??
    curr;

  const modNode: unknown =
    decl.modification ??
    curr.modification ??
    (Cst.Declaration.is(asSyntaxNode(decl)) ? Cst.Declaration.modification(asSyntaxNode(decl)) : null) ??
    decl.children?.find(
      (c) => Cst.Modification.is(asSyntaxNode(c)) || c.type === "modification" || c.type === "Modification",
    ) ??
    curr.children?.find(
      (c) => Cst.Modification.is(asSyntaxNode(c)) || c.type === "modification" || c.type === "Modification",
    );

  if (targetArgName) {
    const classMod = extractClassModNode(modNode ?? decl ?? curr);
    if (classMod) {
      return findNamedModExprInClassMod(classMod, targetArgName);
    }
    return null;
  }

  const directExpr = extractModExprNode(modNode ?? decl ?? curr);
  if (directExpr) return directExpr;

  const classMod = extractClassModNode(modNode ?? decl ?? curr);
  if (classMod) {
    return findNamedModExprInClassMod(classMod, "start");
  }
  return null;
}

function findExtendsModExprInClassCst(classCstNodeInput: unknown, targetArgName: string): unknown {
  const classCstNode = asAnnotationNode(classCstNodeInput);
  if (!classCstNode || !targetArgName) return null;
  if (typeof classCstNode.tree?.sourceCode === "string") {
    const src: string = classCstNode.tree.sourceCode;
    const sIdx = classCstNode.startIndex ?? 0;
    const eIdx = classCstNode.endIndex ?? src.length;
    const extPos = src.indexOf("extends", sIdx);
    if (extPos === -1 || extPos >= eIdx) return null;
    const argPos = src.indexOf(targetArgName, extPos);
    if (argPos === -1 || argPos >= eIdx) return null;
  }
  const walk = (node: AnnotationNodeLike | null | undefined, depth: number): unknown => {
    if (!node || depth > 6) return null;
    const t = node.type;
    if (Cst.ExtendsClause.is(asSyntaxNode(node)) || t === "extends_clause" || t === "ExtendsClause") {
      const classMod = extractClassModNode(node);
      if (classMod) {
        const found = findNamedModExprInClassMod(classMod, targetArgName);
        if (found) return found;
      }
      return null;
    }
    // Do not descend into nested class definitions, components, equations, algorithms, or annotations
    if (
      depth > 0 &&
      (Cst.ClassDefinition.is(asSyntaxNode(node)) ||
        t === "class_definition" ||
        t === "ClassDefinition" ||
        t === "component_clause" ||
        t === "ComponentClause" ||
        t === "equation_section" ||
        t === "EquationSection" ||
        t === "algorithm_section" ||
        t === "AlgorithmSection" ||
        t === "annotation_clause" ||
        t === "AnnotationClause" ||
        t === "import_clause" ||
        t === "ImportClause")
    ) {
      return null;
    }
    const children = node.children || node.namedChildren || [];
    for (const child of children) {
      const found = walk(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(classCstNode, 0);
}

function evaluateRawOrCstExpr(expr: unknown, evalScope?: unknown): AnnotationValue | undefined {
  if (expr == null) return undefined;
  if (typeof expr === "number" || typeof expr === "boolean") return expr;
  if (typeof expr === "string") {
    const t = expr.trim();
    const prim = tryParseScalarText(t);
    if (prim !== undefined) return prim;
    return t;
  }
  const exprNode = asAnnotationNode(expr);
  if (
    exprNode &&
    (typeof exprNode.value === "number" || typeof exprNode.value === "boolean" || typeof exprNode.value === "string")
  ) {
    return evaluateRawOrCstExpr(exprNode.value, evalScope);
  }
  if (exprNode && typeof exprNode.text === "string" && !Array.isArray(exprNode.children)) {
    const t = exprNode.text.trim();
    const prim = tryParseScalarText(t);
    if (prim !== undefined) return prim;
    const resolved = resolveAnnotationName(t, evalScope);
    if (resolved !== undefined) return resolved;
  }
  const val = evaluateCSTExpression(expr, evalScope);
  return val !== null ? val : undefined;
}

function extractEvaluatedValue(resolvedInput: unknown, evalScope?: unknown): AnnotationValue | undefined {
  if (resolvedInput == null) return undefined;
  if (typeof resolvedInput === "number" || typeof resolvedInput === "boolean" || typeof resolvedInput === "string") {
    return resolvedInput;
  }
  const resolved = asAnnotationScope(resolvedInput);
  if (!resolved) return undefined;
  if (typeof resolved.value === "number" || typeof resolved.value === "boolean" || typeof resolved.value === "string") {
    return resolved.value;
  }
  const mod = resolved.modification;
  if (mod) {
    let expr =
      mod.evaluatedExpression ?? mod.expression ?? mod.modificationExpression?.expression ?? mod.bindingExpression;
    if (expr == null && typeof mod.getModificationArgument === "function") {
      const startArg = asAnnotationNode(mod.getModificationArgument("start"));
      expr = startArg?.expression ?? startArg?.value;
    }
    if (expr != null) {
      const val = evaluateRawOrCstExpr(expr, resolved.parent ?? evalScope);
      if (val !== undefined) return val;
    }
  }

  const symId = resolved.id ?? resolved.declaration?.id ?? resolved.entry?.id;
  const scopeObj = asAnnotationScope(evalScope);
  const db: AnnotationDbLike | null =
    resolved.db ??
    resolved.parent?.db ??
    scopeObj?.db ??
    scopeObj?.classInstance?.db ??
    (typeof scopeObj?.query === "function" ? asAnnotationDb(scopeObj) : null);

  const cstNode =
    getScopeCstNode(resolved) ??
    (symId !== undefined && typeof db?.cstNode === "function" ? asAnnotationNode(db.cstNode(symId)) : null);
  if (cstNode) {
    const exprNode = extractModExprFromCstNode(cstNode);
    if (exprNode) {
      const val = evaluateRawOrCstExpr(exprNode, resolved.parent ?? evalScope);
      if (val !== undefined && val !== resolved.name) return val;
    }
  }

  if (symId !== undefined && typeof db?.query === "function") {
    try {
      const effMod = db.query("effectiveModification", symId) as AnnotationModNodeLike | null | undefined;
      if (effMod) {
        let bindExpr = effMod.bindingExpression;
        if (bindExpr == null && Array.isArray(effMod.args)) {
          const startArg = effMod.args.find((a) => a?.name === "start");
          bindExpr = startArg?.value ?? startArg?.expression;
        }
        if (bindExpr != null) {
          const val = evaluateRawOrCstExpr(bindExpr, resolved.parent ?? evalScope);
          if (val !== undefined && val !== resolved.name) return val;
        }
      }
    } catch {}
  }

  const defaultVal = resolved.defaultValue ?? resolved.declaration?.metadata?.defaultValue;
  if (typeof defaultVal === "number" || typeof defaultVal === "boolean" || typeof defaultVal === "string") {
    return defaultVal;
  }

  return undefined;
}

const classResolvedNameCache = new WeakMap<object, Map<string, AnnotationValue | undefined>>();
let activeScopeDeps: Map<string, unknown> | null = null;

function resolveAnnotationName(name: string, evalScope: unknown): AnnotationValue | undefined {
  if (!name || typeof name !== "string") return undefined;
  const trimmed = name.trim();

  // 1. Built-in mathematical & physical constants (Modelica.Constants)
  const constVal = resolveModelicaConstant(trimmed);
  if (constVal !== undefined) return constVal;

  // 2. Qualified enum (e.g. FillPattern.Solid or Modelica.Icons.FillPattern.Solid)
  const parts = trimmed.split(".");
  if (parts.length >= 2) {
    const typeName = parts[parts.length - 2]!;
    const member = parts[parts.length - 1]!;
    const enumDef = ANNOTATION_ENUMS[typeName];
    if (enumDef && member in enumDef) {
      return enumDef[member];
    }
  }

  // 3. Unqualified enum (e.g. Solid, Dash, Bezier, Left, Center, Right)
  if (parts.length === 1) {
    for (const enumDef of Object.values(ANNOTATION_ENUMS)) {
      if (trimmed in enumDef) {
        return enumDef[trimmed];
      }
    }
  }

  const isTopLevelDep = activeScopeDeps !== null && activeNameResolutions.size === 0;
  const resolvedVal = resolveAnnotationNameInScope(trimmed, parts, evalScope);
  if (isTopLevelDep && activeScopeDeps && !activeScopeDeps.has(trimmed)) {
    activeScopeDeps.set(trimmed, resolvedVal);
  }
  return resolvedVal;
}

function resolveAnnotationNameInScope(
  trimmed: string,
  parts: string[],
  evalScopeInput: unknown,
): AnnotationValue | undefined {
  const evalScope = asAnnotationScope(evalScopeInput);
  if (!evalScope) return undefined;
  if (activeNameResolutions.has(trimmed)) return undefined;
  activeNameResolutions.add(trimmed);

  try {
    // 4. Component instance modification overrides (e.g. `Resistor R(R=100, useHeatPort=true)`)
    const compInst =
      evalScope.componentInstance ??
      (!evalScope.isClassInstance && (evalScope.classInstance || evalScope.declaration || evalScope.modification)
        ? evalScope
        : null);
    if (compInst) {
      const compCst = getScopeCstNode(compInst);
      let mayHaveOverride = true;
      if (compCst && typeof compCst.tree?.sourceCode === "string") {
        const src: string = compCst.tree.sourceCode;
        const sIdx = compCst.startIndex ?? 0;
        const eIdx = compCst.endIndex ?? src.length;
        const annIdx = src.indexOf("annotation", sIdx);
        const limitIdx = annIdx !== -1 && annIdx < eIdx ? annIdx : eIdx;
        const pos = src.indexOf(trimmed, sIdx);
        if (pos === -1 || pos >= limitIdx) {
          mayHaveOverride = false;
        }
      }
      if (mayHaveOverride) {
        const mod = compInst.modification;
        if (mod) {
          if (typeof mod.getModificationArgument === "function") {
            const modArg = mod.getModificationArgument(trimmed);
            if (modArg !== undefined) {
              const val = extractEvaluatedValue(modArg, compInst.parent ?? evalScope);
              if (val !== undefined && val !== trimmed) return val;
            }
          }
          const argsList = mod.arguments ?? (Array.isArray(mod.args) ? mod.args : undefined);
          if (Array.isArray(argsList)) {
            const foundArg = argsList.find((a) => a?.name === trimmed);
            if (foundArg !== undefined) {
              const val = evaluateRawOrCstExpr(
                foundArg.value ?? foundArg.expression ?? foundArg,
                compInst.parent ?? evalScope,
              );
              if (val !== undefined && val !== trimmed) return val;
            }
          }
          if (mod.classModification) {
            const modExpr = findNamedModExprInClassMod(mod.classModification, trimmed);
            if (modExpr) {
              const val = evaluateRawOrCstExpr(modExpr, compInst.parent ?? evalScope);
              if (val !== undefined && val !== trimmed) return val;
            }
          }
        }
        if (compCst) {
          const modExpr = extractModExprFromCstNode(compCst, trimmed);
          if (modExpr) {
            const val = evaluateRawOrCstExpr(modExpr, compInst.parent ?? evalScope);
            if (val !== undefined && val !== trimmed) return val;
          }
        }
        const compSymId = compInst.id ?? compInst.declaration?.id ?? compInst.entry?.id;
        const compDb =
          compInst.db ??
          compInst.parent?.db ??
          evalScope.db ??
          evalScope.classInstance?.db ??
          compInst.classInstance?.db;
        if (compSymId !== undefined && typeof compDb?.query === "function") {
          try {
            const effMod = compDb.query("effectiveModification", compSymId) as AnnotationModNodeLike | null | undefined;
            if (effMod?.args) {
              const foundArg = Array.isArray(effMod.args)
                ? effMod.args.find((a) => a?.name === trimmed)
                : effMod.args.get(trimmed);
              if (foundArg) {
                const val = evaluateRawOrCstExpr(
                  foundArg.value ?? foundArg.expression ?? foundArg,
                  compInst.parent ?? evalScope,
                );
                if (val !== undefined && val !== trimmed) return val;
              }
            }
          } catch {}
        }
      }
    }

    // 5. Resolve via Scope Hierarchy (QueryDB / ModelicaClassInstance / parent class)
    const candidateScopes: AnnotationScopeLike[] = [];
    for (const s of [
      evalScope,
      evalScope.classInstance,
      evalScope.componentInstance?.classInstance,
      evalScope.parent,
    ]) {
      if (s && !candidateScopes.includes(s)) candidateScopes.push(s);
    }

    // 5a. Check extends_clause modifications in the class hierarchy (e.g. `extends ConditionalHeatPort(useHeatPort=true)`)
    const visitedClasses = new Set<AnnotationScopeLike>();
    const checkExtendsMods = (cls: AnnotationScopeLike | null | undefined): AnnotationValue | undefined => {
      if (!cls || visitedClasses.has(cls)) return undefined;
      visitedClasses.add(cls);
      const clsCst = getScopeCstNode(cls);
      if (clsCst) {
        const extModExpr = findExtendsModExprInClassCst(clsCst, trimmed);
        if (extModExpr) {
          const val = evaluateRawOrCstExpr(extModExpr, cls);
          if (val !== undefined && val !== trimmed) return val;
        }
      }
      if (Array.isArray(cls.extendsClassInstances)) {
        for (const ext of cls.extendsClassInstances) {
          const extCst = getScopeCstNode(ext);
          if (extCst) {
            const extModExpr = extractModExprFromCstNode(extCst, trimmed);
            if (extModExpr) {
              const val = evaluateRawOrCstExpr(extModExpr, cls);
              if (val !== undefined && val !== trimmed) return val;
            }
          }
          const subVal = checkExtendsMods(ext?.classInstance ?? ext);
          if (subVal !== undefined) return subVal;
        }
      }
      return undefined;
    };

    for (const scope of candidateScopes) {
      if (scope.isClassInstance) {
        const cachedMap = classResolvedNameCache.get(scope);
        if (cachedMap && cachedMap.has(trimmed)) {
          const cachedVal = cachedMap.get(trimmed);
          if (cachedVal !== undefined) return cachedVal;
          continue;
        }
      }
      const extVal = checkExtendsMods(scope);
      if (extVal !== undefined) {
        if (scope.isClassInstance) {
          let cachedMap = classResolvedNameCache.get(scope);
          if (!cachedMap) {
            cachedMap = new Map<string, AnnotationValue | undefined>();
            classResolvedNameCache.set(scope, cachedMap);
          }
          cachedMap.set(trimmed, extVal);
        }
        return extVal;
      }
    }

    for (const scope of candidateScopes) {
      if (scope.isClassInstance) {
        const cachedMap = classResolvedNameCache.get(scope);
        if (cachedMap && cachedMap.has(trimmed)) {
          const cachedVal = cachedMap.get(trimmed);
          if (cachedVal !== undefined) return cachedVal;
          continue;
        }
      }
      const cacheOnClass = (val: AnnotationValue | undefined): AnnotationValue | undefined => {
        if (scope.isClassInstance) {
          let cachedMap = classResolvedNameCache.get(scope);
          if (!cachedMap) {
            cachedMap = new Map<string, AnnotationValue | undefined>();
            classResolvedNameCache.set(scope, cachedMap);
          }
          cachedMap.set(trimmed, val);
        }
        return val;
      };

      // Direct method resolveSimpleName (mock objects or legacy classes)
      if (typeof scope.resolveSimpleName === "function") {
        const resolved = scope.resolveSimpleName(trimmed);
        if (resolved != null) {
          const val = extractEvaluatedValue(resolved, scope);
          if (val !== undefined) return cacheOnClass(val);
        }
      }

      // Salsa QueryDB (has .query and .byName)
      if (typeof scope.query === "function") {
        const scopeId = scope.currentClassId ?? scope.id;
        if (scopeId !== undefined) {
          try {
            const resolver = scope.query("resolveSimpleName", scopeId);
            if (typeof resolver === "function") {
              const sym = (resolver as (n: string) => unknown)(trimmed);
              if (sym != null) {
                const val = extractEvaluatedValue(sym, scope);
                if (val !== undefined) return cacheOnClass(val);
              }
            }
          } catch {}
        }
        if (typeof scope.byName === "function") {
          const syms = scope.byName(trimmed);
          if (syms && syms.length > 0) {
            const val = extractEvaluatedValue(syms[0], scope);
            if (val !== undefined) return cacheOnClass(val);
          }
        }
      }

      // ModelicaClassInstance (with resolveName or components / elements list)
      if (typeof scope.resolveName === "function") {
        const resolved = scope.resolveName(parts);
        if (resolved != null) {
          const val = extractEvaluatedValue(resolved, scope);
          if (val !== undefined) return cacheOnClass(val);
        }
      }

      const findInClassHierarchy = (
        cls: AnnotationScopeLike | null | undefined,
        seen = new Set<AnnotationScopeLike>(),
      ): AnnotationValue | undefined => {
        if (!cls || seen.has(cls)) return undefined;
        seen.add(cls);
        if (Array.isArray(cls.components)) {
          const comp = cls.components.find((c) => c.name === trimmed);
          if (comp != null) {
            const val = extractEvaluatedValue(comp, cls);
            if (val !== undefined) return val;
          }
        }
        if (Array.isArray(cls.elements)) {
          const elem = cls.elements.find((e) => e.name === trimmed);
          if (elem != null) {
            const val = extractEvaluatedValue(elem, cls);
            if (val !== undefined) return val;
          }
        }
        if (Array.isArray(cls.extendsClassInstances)) {
          for (const ext of cls.extendsClassInstances) {
            const v = findInClassHierarchy(ext?.classInstance ?? ext, seen);
            if (v !== undefined) return v;
          }
        }
        return undefined;
      };

      const hierarchyVal = findInClassHierarchy(scope);
      if (hierarchyVal !== undefined) return cacheOnClass(hierarchyVal);
      cacheOnClass(undefined);
    }

    return undefined;
  } finally {
    activeNameResolutions.delete(trimmed);
  }
}

// ── Array & Matrix Literal Parser ───────────────────────────────────────────

export function parseModelicaArrayLiteral(text: string, evalScope?: unknown): AnnotationValue[] {
  const trimmed = text.trim();
  const isBraces = trimmed.startsWith("{") && trimmed.endsWith("}");
  const isBrackets = trimmed.startsWith("[") && trimmed.endsWith("]");
  if (!isBraces && !isBrackets) return [];

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];

  // Check for 2D matrix rows separated by ';'
  if (isBrackets && inner.includes(";")) {
    const rows: string[] = [];
    let curRow = "";
    let rDepth = 0;
    let rInStr = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') {
        let bs = 0;
        let j = i - 1;
        while (j >= 0 && inner[j] === "\\") {
          bs++;
          j--;
        }
        if (bs % 2 === 0) rInStr = !rInStr;
        curRow += ch;
      } else if (rInStr) {
        curRow += ch;
      } else if (ch === "{" || ch === "(" || ch === "[") {
        rDepth++;
        curRow += ch;
      } else if (ch === "}" || ch === ")" || ch === "]") {
        rDepth--;
        curRow += ch;
      } else if (ch === ";" && rDepth === 0) {
        rows.push(curRow.trim());
        curRow = "";
      } else {
        curRow += ch;
      }
    }
    if (curRow.trim()) rows.push(curRow.trim());
    if (rows.length > 1) {
      return rows.map((r) => parseModelicaArrayLiteral("[" + r + "]", evalScope));
    }
  }

  const elements: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '"') {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && inner[j] === "\\") {
        backslashCount++;
        j--;
      }
      if (backslashCount % 2 === 0) {
        inString = !inString;
      }
      current += char;
    } else if (inString) {
      current += char;
    } else if (char === "{" || char === "(" || char === "[") {
      depth++;
      current += char;
    } else if (char === "}" || char === ")" || char === "]") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      elements.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    elements.push(current.trim());
  }

  return elements.map((item) => {
    if ((item.startsWith("{") && item.endsWith("}")) || (item.startsWith("[") && item.endsWith("]"))) {
      return parseModelicaArrayLiteral(item, evalScope);
    }
    if (item.startsWith('"') && item.endsWith('"')) {
      return unescapeDoubleQuotedInner(item.slice(1, -1));
    }
    const itemNum = tryParseNumericLiteral(item);
    if (itemNum !== undefined) return itemNum;
    if (item === "true") return true;
    if (item === "false") return false;

    // Check safe arithmetic expressions (e.g. 10 + 20, -50 + 5)
    if (isSafeArithmeticText(item)) {
      const arith = evalSafeArithmetic(item);
      if (arith !== null) return arith;
    }

    const resolved = resolveAnnotationName(item, evalScope);
    if (resolved !== undefined) return resolved;

    return item;
  });
}

// ── CST Array and Matrix Extraction Helpers ─────────────────────────────────

function extractCSTArrayElements(node: AnnotationNodeLike): AnnotationNodeLike[] {
  const elements: AnnotationNodeLike[] = [];
  const walk = (n: AnnotationNodeLike | null | undefined) => {
    if (!n) return;
    if (n.type === "expression" || n.type === "Expression") {
      elements.push(n);
      return;
    }
    for (const child of n.children || []) {
      if (
        child.type === "{" ||
        child.type === "}" ||
        child.type === "," ||
        child.type === "[" ||
        child.type === "]" ||
        child.type === ";"
      )
        continue;
      walk(child);
    }
  };
  walk(node);
  return elements;
}

function extractCSTMatrixRows(node: AnnotationNodeLike): AnnotationNodeLike[][] | null {
  if (!Array.isArray(node.children)) return null;
  const hasSemicolon = node.children.some((c) => c.type === ";" || c.text === ";");
  if (!hasSemicolon) return null;
  const rows: AnnotationNodeLike[][] = [];
  let currentRow: AnnotationNodeLike[] = [];
  for (const c of node.children) {
    if (c.type === "[" || c.type === "]") continue;
    if (c.type === ";" || c.text === ";") {
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [];
    } else if (c.type === "expression_list" || c.type === "array_arguments") {
      currentRow.push(...extractCSTArrayElements(c));
    } else if (c.type === "expression") {
      currentRow.push(c);
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows.length > 0 ? rows : null;
}

// ── CST Expression Evaluator ────────────────────────────────────────────────

export function evaluateCSTExpression(nodeInput: unknown, evalScope?: unknown): AnnotationValue {
  let node = asAnnotationNode(nodeInput);
  if (!node) return null;

  // 0. Unwrap syntactic wrappers (modification_expression, function_argument, element_modification, single-child expression)
  while (
    node &&
    (node.type === "modification_expression" ||
      node.type === "ModificationExpression" ||
      node.type === "function_argument" ||
      node.type === "FunctionArgument" ||
      node.type === "element_modification" ||
      node.type === "ElementModification" ||
      (Array.isArray(node.children) &&
        node.children.length === 1 &&
        (node.type === "expression" || node.type === "Expression" || node.type === "simple_expression")))
  ) {
    if (Array.isArray(node.children) && node.children.length === 1 && node.children[0]) {
      node = node.children[0];
    } else {
      break;
    }
  }

  if (typeof node.value === "number" || typeof node.value === "boolean" || typeof node.value === "string") {
    return node.value;
  }

  const rawText = typeof node.text === "string" ? node.text.trim() : "";
  if (rawText === "true") return true;
  if (rawText === "false") return false;
  if (rawText.startsWith('"') && rawText.endsWith('"')) {
    return unescapeDoubleQuotedInner(rawText.slice(1, -1));
  }
  const numVal = tryParseNumericLiteral(rawText);
  if (numVal !== undefined) return numVal;

  // 1. Array / Matrix evaluation directly on CST
  if (Array.isArray(node.children) && node.children.length >= 2) {
    const firstChild = node.children[0];
    const lastChild = node.children[node.children.length - 1];
    const firstText = (firstChild?.text ?? firstChild?.type)?.trim();
    const lastText = (lastChild?.text ?? lastChild?.type)?.trim();
    if (
      (firstText === "{" && lastText === "}") ||
      (firstText === "[" && lastText === "]") ||
      (firstText === '"{"' && lastText === '"}"') ||
      (firstText === '"["' && lastText === '"]"')
    ) {
      const matrixRows = extractCSTMatrixRows(node);
      if (matrixRows) {
        return matrixRows.map((r) => r.map((e) => evaluateCSTExpression(e, evalScope)));
      }
      const elements = extractCSTArrayElements(node);
      return elements.map((e) => evaluateCSTExpression(e, evalScope));
    }
  }

  // 2. Fallback array parser for non-CST string inputs
  if ((rawText.startsWith("{") && rawText.endsWith("}")) || (rawText.startsWith("[") && rawText.endsWith("]"))) {
    return parseModelicaArrayLiteral(rawText, evalScope);
  }

  const resolvedEnum = resolveAnnotationName(rawText, evalScope);
  if (resolvedEnum !== undefined) return resolvedEnum;

  if (
    node.type === "component_reference" ||
    node.type === "ComponentReference" ||
    node.type === "identifier" ||
    node.type === "Identifier" ||
    node.type === "name" ||
    node.type === "Name"
  ) {
    return rawText;
  }

  if (node.type === "unsigned_integer" || node.type === "IntegerLiteral") {
    return parseInt(node.text ?? String(node.value), 10);
  }
  if (node.type === "unsigned_real" || node.type === "RealLiteral") {
    return parseFloat(node.text ?? String(node.value));
  }

  // 0. Single-child expression unwrap
  if (
    Array.isArray(node.children) &&
    node.children.length === 1 &&
    (node.type === "expression" || node.type === "Expression" || node.type === "simple_expression")
  ) {
    return evaluateCSTExpression(node.children[0], evalScope);
  }

  // 1. WASM CST Parenthesized Expression: (expr)
  if (
    Array.isArray(node.children) &&
    node.children.length === 3 &&
    (node.children[0]?.type === "(" || node.children[0]?.text === "(") &&
    (node.children[2]?.type === ")" || node.children[2]?.text === ")")
  ) {
    return evaluateCSTExpression(node.children[1], evalScope);
  }

  // 2. Unary Operators (CST & AST)
  if ("operand" in node && node.operand) {
    const operand = evaluateCSTExpression(node.operand, evalScope);
    if (operand === null) return null;
    const op = node.operator;
    if (
      op === ModelicaUnaryOperator.UNARY_MINUS ||
      op === ModelicaUnaryOperator.ELEMENTWISE_UNARY_MINUS ||
      op === "-" ||
      op === ".-"
    )
      return typeof operand === "number" ? -operand : null;
    if (
      op === ModelicaUnaryOperator.UNARY_PLUS ||
      op === ModelicaUnaryOperator.ELEMENTWISE_UNARY_PLUS ||
      op === "+" ||
      op === ".+"
    )
      return operand;
    if (op === ModelicaUnaryOperator.LOGICAL_NEGATION || op === "not")
      return typeof operand === "boolean" ? !operand : null;
    return null;
  }
  if (Array.isArray(node.children) && node.children.length === 2) {
    const op = node.children[0]?.text?.trim();
    if (op === "-" || op === ".-") {
      const operand = evaluateCSTExpression(node.children[1], evalScope);
      return typeof operand === "number" ? -operand : null;
    }
    if (op === "+" || op === ".+") {
      return evaluateCSTExpression(node.children[1], evalScope);
    }
    if (op === "not") {
      const operand = evaluateCSTExpression(node.children[1], evalScope);
      return typeof operand === "boolean" ? !operand : null;
    }
  }

  // 3. Binary Operators (CST & AST)
  let leftNode: unknown = null;
  let rightNode: unknown = null;
  let binaryOp: string | ModelicaBinaryOperator | ModelicaUnaryOperator | null | undefined = null;

  if (("operand1" in node || "left" in node) && ("operand2" in node || "right" in node)) {
    leftNode = node.operand1 ?? node.left;
    rightNode = node.operand2 ?? node.right;
    binaryOp = node.operator;
  } else if (Array.isArray(node.children) && node.children.length === 3) {
    const opText = node.children[1]?.text?.trim() ?? "";
    if (
      [
        "+",
        "-",
        "*",
        "/",
        "^",
        ".+",
        ".-",
        ".*",
        "./",
        ".^",
        "<",
        "<=",
        ">",
        ">=",
        "==",
        "<>",
        "!=",
        "and",
        "or",
      ].includes(opText)
    ) {
      leftNode = node.children[0];
      rightNode = node.children[2];
      binaryOp = opText;
    }
  }

  if (leftNode && rightNode && binaryOp) {
    const left = evaluateCSTExpression(leftNode, evalScope);
    const right = evaluateCSTExpression(rightNode, evalScope);
    if (left !== null && right !== null) {
      const op = binaryOp;
      if (typeof left === "number" && typeof right === "number") {
        switch (op) {
          case ModelicaBinaryOperator.ADDITION:
          case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
          case "+":
          case ".+":
            return left + right;
          case ModelicaBinaryOperator.SUBTRACTION:
          case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
          case "-":
          case ".-":
            return left - right;
          case ModelicaBinaryOperator.MULTIPLICATION:
          case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
          case "*":
          case ".*":
            return left * right;
          case ModelicaBinaryOperator.DIVISION:
          case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
          case "/":
          case "./":
            return right !== 0 ? left / right : null;
          case ModelicaBinaryOperator.EXPONENTIATION:
          case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
          case "^":
          case ".^":
            return Math.pow(left, right);
          case ModelicaBinaryOperator.LESS_THAN:
          case "<":
            return left < right;
          case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
          case "<=":
            return left <= right;
          case ModelicaBinaryOperator.GREATER_THAN:
          case ">":
            return left > right;
          case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
          case ">=":
            return left >= right;
          case ModelicaBinaryOperator.EQUALITY:
          case "==":
            return left === right;
          case ModelicaBinaryOperator.INEQUALITY:
          case "<>":
          case "!=":
            return left !== right;
        }
      }

      if (typeof left === "boolean" && typeof right === "boolean") {
        if (op === ModelicaBinaryOperator.LOGICAL_AND || op === "and") return left && right;
        if (op === ModelicaBinaryOperator.LOGICAL_OR || op === "or") return left || right;
        if (op === ModelicaBinaryOperator.EQUALITY || op === "==") return left === right;
        if (op === ModelicaBinaryOperator.INEQUALITY || op === "<>" || op === "!=") return left !== right;
      }

      if (typeof left === "string" && typeof right === "string") {
        if (op === ModelicaBinaryOperator.ADDITION || op === "+") return left + right;
        if (op === ModelicaBinaryOperator.EQUALITY || op === "==") return left === right;
        if (op === ModelicaBinaryOperator.INEQUALITY || op === "<>" || op === "!=") return left !== right;
      }
    }
  }

  // 4. Conditional (if-then-else) Expressions (CST & AST)
  if ("condition" in node && ("expression" in node || "thenExpression" in node)) {
    const expr = node.expression ?? node.thenExpression;
    const cond = evaluateCSTExpression(node.condition, evalScope);
    if (cond === true) return evaluateCSTExpression(expr, evalScope);
    if (node.elseIfExpressionClauses) {
      for (const clause of node.elseIfExpressionClauses) {
        const elseIfCond = evaluateCSTExpression(clause.condition, evalScope);
        if (elseIfCond === true) return evaluateCSTExpression(clause.expression, evalScope);
      }
    }
    if (cond === false) return evaluateCSTExpression(node.elseExpression, evalScope);
    return null;
  }
  if (Array.isArray(node.children) && node.children.length >= 6 && node.children[0]?.text === "if") {
    const thenIdx = node.children.findIndex((c) => c.text === "then");
    const elseIdx = node.children.findIndex((c) => c.text === "else");
    if (thenIdx > 1 && elseIdx > thenIdx + 1) {
      const cond = evaluateCSTExpression(node.children[1], evalScope);
      if (cond === true) {
        return evaluateCSTExpression(node.children[thenIdx + 1], evalScope);
      }
      if (cond === false) {
        return evaluateCSTExpression(node.children[elseIdx + 1], evalScope);
      }
    }
  }

  // 5. Range Expressions: start:stop or start:step:stop
  if ("startExpression" in node && "stopExpression" in node) {
    const start = evaluateCSTExpression(node.startExpression, evalScope);
    const stop = evaluateCSTExpression(node.stopExpression, evalScope);
    if (typeof start !== "number" || typeof stop !== "number") return null;
    const step = node.stepExpression ? evaluateCSTExpression(node.stepExpression, evalScope) : 1;
    if (typeof step !== "number" || step === 0) return null;
    const result: number[] = [];
    if (step > 0) {
      for (let v = start; v <= stop + 1e-10; v += step) result.push(v);
    } else {
      for (let v = start; v >= stop - 1e-10; v += step) result.push(v);
    }
    return result;
  }

  // 6. Parts (Dotted References)
  if ("parts" in node && Array.isArray(node.parts)) {
    const parts = node.parts
      .map((p) => (typeof p === "string" ? p : (p.identifier?.text ?? p.name ?? p.text ?? "")))
      .filter((p): p is string => Boolean(p));
    if (parts.length === 0) return null;
    const fullName = parts.join(".");
    const resolved = resolveAnnotationName(fullName, evalScope);
    if (resolved !== undefined) return resolved;
    if (parts.length > 1) {
      let current: unknown = resolveAnnotationName(parts[0]!, evalScope);
      for (let i = 1; i < parts.length; i++) {
        if (current == null) return null;
        const currScope = asAnnotationScope(current);
        if (currScope && typeof currScope.resolveSimpleName === "function") {
          current = currScope.resolveSimpleName(parts[i]!);
          const nextScope = asAnnotationScope(current);
          if (nextScope?.modification) {
            const expr = nextScope.modification.evaluatedExpression ?? nextScope.modification.expression;
            if (expr != null && (typeof expr === "number" || typeof expr === "boolean" || typeof expr === "string")) {
              current = expr;
            }
          }
        } else {
          return null;
        }
      }
      return (current ?? null) as AnnotationValue;
    }
    return null;
  }

  // 7. Array Expression Lists
  if ("expressionList" in node) {
    const elements = node.expressionList?.expressions ?? [];
    return elements.map((e) => evaluateCSTExpression(e, evalScope));
  }
  if ("expressionLists" in node && Array.isArray(node.expressionLists)) {
    const result: AnnotationValue[][] = [];
    for (const list of node.expressionLists) {
      const row = (list.expressions ?? []).map((e) => evaluateCSTExpression(e, evalScope));
      result.push(row);
    }
    return result.length === 1 ? (result[0] ?? []) : result;
  }

  // 8. Function Calls & Built-in Math Functions (CST & AST)
  let funcName: string | null = null;
  let funcArgs: unknown[] = [];
  if ("functionReference" in node) {
    const funcNameParts = node.functionReference?.parts?.map((p) =>
      typeof p === "string" ? p : (p.identifier?.text ?? p.name ?? p.text ?? ""),
    );
    funcName = funcNameParts && funcNameParts.length > 0 ? (funcNameParts[funcNameParts.length - 1] ?? null) : null;
    const posArgs = node.functionCallArguments?.arguments ?? [];
    funcArgs = posArgs.map((a) => ("expression" in a && a.expression !== undefined ? a.expression : a));
  } else if (node.type === "primary" || node.type === "function_call") {
    const compRef = node.children?.find((c) => c.type === "component_reference" || c.type === "ComponentReference");
    if (compRef) {
      funcName = compRef.text?.trim() ?? null;
      const callArgs = node.children?.find((c) => c.type === "function_call_args" || c.type === "FunctionCallArgs");
      if (callArgs) {
        const extracted: AnnotationNodeLike[] = [];
        const walkCallArgs = (n: AnnotationNodeLike | null | undefined) => {
          if (!n) return;
          if (n.type === "function_argument" || n.type === "FunctionArgument") {
            const expr = n.children?.find((c) => c.type === "expression" || c.type === "Expression") ?? n;
            extracted.push(expr);
            return;
          }
          for (const c of n.children || []) walkCallArgs(c);
        };
        walkCallArgs(callArgs);
        funcArgs = extracted;
      }
    }
  }

  if (funcName) {
    if (funcName === "DynamicSelect") {
      if (funcArgs.length > 0) {
        return evaluateCSTExpression(funcArgs[0], evalScope);
      }
      return null;
    }

    // Built-in Modelica mathematical functions
    const evalArgs = funcArgs.map((a) => evaluateCSTExpression(a, evalScope));
    const a0 = evalArgs[0];
    const a1 = evalArgs[1];
    if (typeof a0 === "number") {
      switch (funcName) {
        case "abs":
          return Math.abs(a0);
        case "sqrt":
          return a0 >= 0 ? Math.sqrt(a0) : null;
        case "sin":
          return Math.sin(a0);
        case "cos":
          return Math.cos(a0);
        case "tan":
          return Math.tan(a0);
        case "asin":
          return Math.asin(a0);
        case "acos":
          return Math.acos(a0);
        case "atan":
          return Math.atan(a0);
        case "atan2":
          return typeof a1 === "number" ? Math.atan2(a0, a1) : null;
        case "exp":
          return Math.exp(a0);
        case "log":
          return a0 > 0 ? Math.log(a0) : null;
        case "log10":
          return a0 > 0 ? Math.log10(a0) : null;
        case "floor":
          return Math.floor(a0);
        case "ceil":
          return Math.ceil(a0);
        case "min":
          return typeof a1 === "number" ? Math.min(a0, a1) : a0;
        case "max":
          return typeof a1 === "number" ? Math.max(a0, a1) : a0;
        case "mod":
          return typeof a1 === "number" && a1 !== 0 ? a0 % a1 : null;
      }
    }
    if (funcName === "String" && a0 !== null && a0 !== undefined) {
      return String(a0);
    }
  }

  // 9. Fallback: Safe text-based arithmetic evaluation (e.g. "10 + 5")
  if (rawText && isSafeArithmeticText(rawText)) {
    const arith = evalSafeArithmetic(rawText);
    if (arith !== null) return arith;
  }

  return null;
}

// ── Condition Attribute Evaluator ───────────────────────────────────────────

export function evaluateCondition(componentInput: unknown, parentContextInput?: unknown): boolean | undefined {
  const component = asAnnotationScope(componentInput);
  if (!component) return true;
  const parentContext = asAnnotationScope(parentContextInput);
  let condition: unknown = component._cachedConditionNode;
  if (condition === null) return true;

  if (condition === undefined) {
    let node: AnnotationNodeLike | null = getScopeCstNode(component);
    if (!node && component.id != null) {
      const db = component.db ?? component.parent?.db ?? parentContext?.db ?? parentContext?.classInstance?.db;
      if (typeof db?.cstNode === "function") {
        try {
          node = asAnnotationNode(db.cstNode(component.id));
        } catch {}
      }
    }
    if (!node) {
      component._cachedConditionNode = null;
      return true;
    }

    if (typeof node.tree?.sourceCode === "string" && !("conditionAttribute" in node)) {
      const src: string = node.tree.sourceCode;
      const sIdx = node.startIndex ?? 0;
      const eIdx = node.endIndex ?? src.length;
      const annIdx = src.indexOf("annotation", sIdx);
      const limitIdx = annIdx !== -1 && annIdx < eIdx ? annIdx : eIdx;
      const slice = src.slice(sIdx, limitIdx);
      if (!slice.includes(" if ") && !slice.includes("\tif ") && !slice.includes("\nif ")) {
        component._cachedConditionNode = null;
        return true;
      }
    }

    while (
      node &&
      !Cst.ComponentDeclaration.is(asSyntaxNode(node)) &&
      !Cst.ComponentClause.is(asSyntaxNode(node)) &&
      !("conditionAttribute" in node) &&
      node.parent &&
      (Cst.Declaration.is(asSyntaxNode(node)) ||
        Cst.Identifier.is(asSyntaxNode(node)) ||
        node.type === "declaration" ||
        node.type === "Declaration" ||
        node.type === "identifier" ||
        node.type === "Identifier" ||
        Cst.ComponentDeclaration.is(asSyntaxNode(node.parent)))
    ) {
      node = node.parent;
    }

    condition = null;
    if ("conditionAttribute" in node) {
      condition = node.conditionAttribute?.condition ?? null;
    } else if (Cst.ComponentDeclaration.is(asSyntaxNode(node))) {
      const condAttr = node.children?.find((c) => Cst.ConditionAttribute.is(asSyntaxNode(c)));
      condition =
        condAttr?.children?.find((c) => Cst.Expression.is(asSyntaxNode(c))) ?? condAttr?.children?.[1] ?? null;
    } else if (Cst.ComponentClause.is(asSyntaxNode(node))) {
      const condAttr = node.children?.find((c) => Cst.ConditionAttribute.is(asSyntaxNode(c)));
      condition =
        condAttr?.children?.find((c) => Cst.Expression.is(asSyntaxNode(c))) ?? condAttr?.children?.[1] ?? null;
    }
    if (
      !condition &&
      node.parent &&
      (Cst.ComponentDeclaration.is(asSyntaxNode(node.parent)) || Cst.ComponentClause.is(asSyntaxNode(node.parent)))
    ) {
      const condAttr = node.parent.children?.find((c) => Cst.ConditionAttribute.is(asSyntaxNode(c)));
      condition =
        condAttr?.children?.find((c) => Cst.Expression.is(asSyntaxNode(c))) ?? condAttr?.children?.[1] ?? null;
    }
    component._cachedConditionNode = condition;
    if (!condition) return true;
  }

  const scope: AnnotationScopeLike =
    parentContext && component.parent && parentContext !== component.parent
      ? {
          componentInstance:
            parentContext.componentInstance ??
            (!parentContext.isClassInstance &&
            (parentContext.classInstance || parentContext.declaration || parentContext.modification)
              ? parentContext
              : undefined),
          classInstance:
            parentContext.classInstance ?? (parentContext.isClassInstance ? parentContext : component.parent),
          parent: component.parent,
        }
      : (parentContext ?? component.parent ?? component);
  try {
    const result = evaluateCSTExpression(condition, scope);
    if (typeof result === "boolean") {
      return result;
    }
  } catch (e) {
    console.warn(`[evaluateCondition] failed for ${component.name}:`, e);
  }
  return undefined;
}

// ── Annotation Evaluator Class ──────────────────────────────────────────────

function normalizeArgName(funcOrTypeName: string, argName: string): string {
  if (funcOrTypeName === "Rectangle" && argName === "cornerRadius") {
    return "radius";
  }
  return argName;
}

function extractClassModNode(nodeInput: unknown): AnnotationNodeLike | null {
  const node = asAnnotationNode(nodeInput);
  if (!node) return null;
  return (
    node.modification?.classModification ??
    node.classModification ??
    node.children?.find((c) => Cst.ClassModification.is(asSyntaxNode(c))) ??
    node.children
      ?.find((c) => Cst.Modification.is(asSyntaxNode(c)))
      ?.children?.find((c) => Cst.ClassModification.is(asSyntaxNode(c))) ??
    null
  );
}

function extractModExprNode(nodeInput: unknown): unknown {
  const node = asAnnotationNode(nodeInput);
  if (!node) return null;
  return (
    node.modification?.modificationExpression?.expression ??
    node.modification?.expression ??
    node.expression ??
    node.children?.find((c) => Cst.ModificationExpression.is(asSyntaxNode(c)) || Cst.Expression.is(asSyntaxNode(c))) ??
    node.children
      ?.find((c) => Cst.Modification.is(asSyntaxNode(c)))
      ?.children?.find((c) => Cst.ModificationExpression.is(asSyntaxNode(c)) || Cst.Expression.is(asSyntaxNode(c))) ??
    null
  );
}

function applyPositionalArguments(obj: AnnotationRecord, funcName: string, positionalValues: AnnotationValue[]): void {
  let valIdx = 0;
  if (
    valIdx < positionalValues.length &&
    typeof positionalValues[valIdx] === "boolean" &&
    obj["visible"] === undefined
  ) {
    obj["visible"] = positionalValues[valIdx++];
  }
  if (valIdx < positionalValues.length && Array.isArray(positionalValues[valIdx])) {
    const arr = positionalValues[valIdx++];
    if (funcName === "Line" || funcName === "Polygon") {
      if (obj["points"] === undefined) obj["points"] = arr;
    } else if (funcName === "Rectangle" || funcName === "Ellipse" || funcName === "Text" || funcName === "Bitmap") {
      if (obj["extent"] === undefined) obj["extent"] = arr;
    }
  }
  if (valIdx < positionalValues.length) {
    const nextVal = positionalValues[valIdx];
    if (typeof nextVal === "string") {
      if (funcName === "Text" && obj["textString"] === undefined && obj["string"] === undefined) {
        obj["textString"] = nextVal;
        obj["string"] = nextVal;
        valIdx++;
      } else if (funcName === "Bitmap" && obj["fileName"] === undefined) {
        obj["fileName"] = nextVal;
        valIdx++;
      }
    }
  }
  while (valIdx < positionalValues.length) {
    const extraVal = positionalValues[valIdx++];
    if (Array.isArray(extraVal) && extraVal.length === 3 && typeof extraVal[0] === "number") {
      if (
        (funcName === "Line" || funcName === "Polygon") &&
        obj["color"] === undefined &&
        obj["lineColor"] === undefined
      ) {
        obj["color"] = extraVal;
        obj["lineColor"] = extraVal;
      } else if (obj["fillColor"] === undefined) {
        obj["fillColor"] = extraVal;
      }
    }
  }
}

const WASM_FILL_PATTERNS = [
  "None",
  "Solid",
  "Horizontal",
  "Vertical",
  "Cross",
  "Forward",
  "Backward",
  "CrossDiag",
  "HorizontalCylinder",
  "VerticalCylinder",
  "Sphere",
];
const WASM_LINE_PATTERNS = ["None", "Solid", "Dash", "Dot", "DashDot", "DashDotDot"];
const WASM_SMOOTH_MODES = ["None", "Bezier"];
const WASM_TEXT_ALIGNMENTS = ["Left", "Center", "Right"];
const WASM_ARROWS = ["None", "Open", "Filled", "Half"];
const WASM_BORDER_PATTERNS = ["None", "Raised", "Sunken", "Engraved"];
const WASM_CLOSURES = ["None", "Chord", "Radial", "Automatic"];

function unpackWasmColor(packed: number): [number, number, number] {
  return [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff];
}

interface WasmAnnotationExports {
  annotation_beginLayer?: (isDiagram: number) => void;
  annotation_appendClassLayer?: (ptr: number, startIdx: number, isDiagram: number) => number;
  annotation_scanIcon: (ptr: number, startIdx: number) => number;
  annotation_scanDiagram: (ptr: number, startIdx: number) => number;
  annotation_scanPlacement?: (ptr: number, startIdx: number) => number;
  annotation_scanConnectLine?: (ptr: number, startIdx: number) => number;
  annotation_hasIcon: () => number;
  annotation_hasCoordSys: () => number;
  annotation_getCoordX1: () => number;
  annotation_getCoordY1: () => number;
  annotation_getCoordX2: () => number;
  annotation_getCoordY2: () => number;
  annotation_getPreserveAspectRatio: () => number;
  annotation_hasGrid?: () => number;
  annotation_getGridX?: () => number;
  annotation_getGridY?: () => number;
  annotation_getGraphicCount?: () => number;
  annotation_getGraphicKind: (i: number) => number;
  annotation_getGraphicStroke: (i: number) => number;
  annotation_getGraphicFill: (i: number) => number;
  annotation_getGraphicFillPattern: (i: number) => number;
  annotation_getGraphicLinePattern: (i: number) => number;
  annotation_getGraphicThickness: (i: number) => number;
  annotation_getGraphicVisible: (i: number) => number;
  annotation_getGraphicOriginX: (i: number) => number;
  annotation_getGraphicOriginY: (i: number) => number;
  annotation_getGraphicRotation: (i: number) => number;
  annotation_getGraphicRectX1: (i: number) => number;
  annotation_getGraphicRectY1: (i: number) => number;
  annotation_getGraphicRectX2: (i: number) => number;
  annotation_getGraphicRectY2: (i: number) => number;
  annotation_getGraphicRadius: (i: number) => number;
  annotation_getGraphicPointsOffset: (i: number) => number;
  annotation_getGraphicPointsCount: (i: number) => number;
  annotation_getPointX: (idx: number) => number;
  annotation_getPointY: (idx: number) => number;
  annotation_getGraphicSmooth: (i: number) => number;
  annotation_getGraphicArrowStart?: (i: number) => number;
  annotation_getGraphicArrowEnd?: (i: number) => number;
  annotation_getGraphicArrowSize?: (i: number) => number;
  annotation_getGraphicTextOffset: (i: number) => number;
  annotation_getGraphicTextLen: (i: number) => number;
  annotation_getGraphicPoolTextOffset?: (i: number) => number;
  annotation_getGraphicPoolTextLen?: (i: number) => number;
  annotation_getGraphicFontNamePoolOffset?: (i: number) => number;
  annotation_getGraphicFontNamePoolLen?: (i: number) => number;
  annotation_getGraphicFileNamePoolOffset?: (i: number) => number;
  annotation_getGraphicFileNamePoolLen?: (i: number) => number;
  annotation_getGraphicImageSourcePoolOffset?: (i: number) => number;
  annotation_getGraphicImageSourcePoolLen?: (i: number) => number;
  annotation_getGraphicFontSize: (i: number) => number;
  annotation_getGraphicTextAlignment: (i: number) => number;
  annotation_getGraphicBorderPattern?: (i: number) => number;
  annotation_getGraphicStartAngle?: (i: number) => number;
  annotation_getGraphicEndAngle?: (i: number) => number;
  annotation_getGraphicHasEndAngle?: (i: number) => number;
  annotation_getGraphicClosure?: (i: number) => number;
  annotation_getGraphicTextStyleMask?: (i: number) => number;
  annotation_getPlacementVisible: () => number;
  annotation_getPlacementIconVisible: () => number;
  annotation_hasTransformation: () => number;
  annotation_transHasOrigin: () => number;
  annotation_getTransOriginX: () => number;
  annotation_getTransOriginY: () => number;
  annotation_transHasExtent: () => number;
  annotation_getTransX1: () => number;
  annotation_getTransY1: () => number;
  annotation_getTransX2: () => number;
  annotation_getTransY2: () => number;
  annotation_transHasRotation: () => number;
  annotation_getTransRotation: () => number;
  annotation_hasIconTransformation: () => number;
  annotation_iconTransHasOrigin: () => number;
  annotation_getIconTransOriginX: () => number;
  annotation_getIconTransOriginY: () => number;
  annotation_iconTransHasExtent: () => number;
  annotation_getIconTransX1: () => number;
  annotation_getIconTransY1: () => number;
  annotation_getIconTransX2: () => number;
  annotation_getIconTransY2: () => number;
  annotation_iconTransHasRotation: () => number;
  annotation_getIconTransRotation: () => number;
  annotation_renderIconSvg?: (ptr: number, startIdx: number, size: number) => number;
  annotation_renderAccumulatedIconSvg?: (size: number) => number;
  annotation_getSvgBufferPtr?: () => number;
  annotation_getTextPoolPtr?: () => number;
  annotation_getGraphicsBufferPtr?: () => number;
  annotation_getGraphicSlotStride?: () => number;
  annotation_getPointsXBufferPtr?: () => number;
  annotation_getPointsYBufferPtr?: () => number;
  annotation_getIconNameBufferPtr?: () => number;
  annotation_setIconNameLen?: (len: number) => void;
  getInputBuffer?: () => number;
  lsp_getInputBuffer?: () => number;
}

const utf8Decoder = new TextDecoder();

function ensureWasmAnnotationBuffer(ast: unknown): {
  exports: WasmAnnotationExports;
  src: string;
  wasmMemory?: { buffer: ArrayBuffer };
} | null {
  const astNode = ast as
    | {
        ptr?: number;
        startIndex?: number;
        endIndex?: number;
        tree?: {
          facade?: {
            exports?: WasmAnnotationExports;
            loadSource?: (s: string) => void;
            _activeAnnotationSource?: string;
            currentInputLength?: number;
            wasmMemory?: { buffer: ArrayBuffer };
          };
          sourceCode?: string;
        };
      }
    | null
    | undefined;
  if (!astNode || typeof astNode.ptr !== "number" || astNode.ptr <= 0) return null;
  const tree = astNode.tree;
  const facade = tree?.facade;
  const exports = facade?.exports;
  const src = tree?.sourceCode;
  if (!exports?.annotation_scanIcon || typeof src !== "string" || typeof facade?.loadSource !== "function") {
    return null;
  }

  let needsLoad = facade._activeAnnotationSource !== src || facade.currentInputLength !== src.length;
  if (!needsLoad && facade.wasmMemory && (exports.getInputBuffer || exports.lsp_getInputBuffer)) {
    const getInputBuf = exports.getInputBuffer ?? exports.lsp_getInputBuffer;
    const textPtr = getInputBuf ? getInputBuf() : 0;
    const startIdx = astNode.startIndex ?? 0;
    const endIdx = astNode.endIndex ?? src.length;
    if (textPtr > 0 && endIdx <= src.length && startIdx < endIdx) {
      const mem16 = new Uint16Array(facade.wasmMemory.buffer, textPtr, src.length);
      if (
        mem16[0] !== src.charCodeAt(0) ||
        mem16[startIdx] !== src.charCodeAt(startIdx) ||
        mem16[endIdx - 1] !== src.charCodeAt(endIdx - 1)
      ) {
        needsLoad = true;
      }
    }
  }

  if (needsLoad) {
    facade.loadSource(src);
    facade._activeAnnotationSource = src;
  }
  return facade.wasmMemory ? { exports, src, wasmMemory: facade.wasmMemory } : { exports, src };
}

function readPoolString(
  exports: WasmAnnotationExports,
  wasmMemory: { buffer: ArrayBuffer } | undefined,
  poolOff: number,
  poolLen: number,
): string {
  if (poolLen <= 0) return "";
  const poolPtr = exports.annotation_getTextPoolPtr?.() ?? 0;
  if (!wasmMemory || poolPtr <= 0) return "";
  const u16 = new Uint16Array(wasmMemory.buffer, poolPtr + poolOff * 2, poolLen);
  if (poolLen <= 2048) {
    return String.fromCharCode(...u16);
  }
  let out = "";
  for (let i = 0; i < poolLen; i += 2048) {
    out += String.fromCharCode(...u16.subarray(i, Math.min(poolLen, i + 2048)));
  }
  return out;
}

export interface WasmGraphicItem {
  "@type": string;
  extent?: [[number, number], [number, number]];
  points?: [number, number][];
  lineColor?: [number, number, number];
  textColor?: [number, number, number];
  color?: [number, number, number];
  fillColor?: [number, number, number];
  fillPattern?: string;
  pattern?: string;
  borderPattern?: string;
  lineThickness?: number;
  thickness?: number;
  radius?: number;
  smooth?: string;
  startAngle?: number;
  endAngle?: number;
  closure?: string;
  arrow?: [string, string];
  arrowSize?: number;
  textString?: string;
  string?: string;
  fontSize?: number;
  fontName?: string;
  textStyle?: string[];
  style?: string[];
  horizontalAlignment?: string;
  fileName?: string;
  imageSource?: string;
  visible?: boolean;
  origin?: [number, number];
  rotation?: number;
}

function readWasmGraphicSlot(
  exports: WasmAnnotationExports,
  src: string,
  i: number,
  wasmMemory?: { buffer: ArrayBuffer },
): WasmGraphicItem | undefined {
  const graphicsPtr = wasmMemory ? (exports.annotation_getGraphicsBufferPtr?.() ?? 0) : 0;
  if (wasmMemory && graphicsPtr > 0) {
    const slotStride = exports.annotation_getGraphicSlotStride?.() ?? 176;
    const dv = new DataView(wasmMemory.buffer, graphicsPtr + i * slotStride, slotStride);
    const kind = dv.getUint8(160);
    if (kind < 1 || kind > 6) return undefined;

    const x1 = dv.getFloat64(0, true);
    const y1 = dv.getFloat64(8, true);
    const x2 = dv.getFloat64(16, true);
    const y2 = dv.getFloat64(24, true);
    const ox = dv.getFloat64(32, true);
    const oy = dv.getFloat64(40, true);
    const rot = dv.getFloat64(48, true);
    const thickness = dv.getFloat64(56, true);
    const stroke = dv.getInt32(104, true);
    const fill = dv.getInt32(108, true);
    const fillPat = WASM_FILL_PATTERNS[dv.getUint8(161)] ?? "None";
    const linePat = WASM_LINE_PATTERNS[dv.getUint8(162)] ?? "Solid";
    const smoothIdx = dv.getUint8(163);
    const visible = dv.getUint8(164) !== 0;

    let item: WasmGraphicItem;
    if (kind === 1) {
      item = {
        "@type": "Rectangle",
        extent: [
          [x1, y1],
          [x2, y2],
        ],
        lineColor: unpackWasmColor(stroke >= 0 ? stroke : 0),
        fillPattern: fillPat,
        pattern: linePat,
        lineThickness: thickness,
        radius: dv.getFloat64(64, true),
      };
      const borderPatIdx = dv.getUint8(168);
      if (borderPatIdx !== 0) item.borderPattern = WASM_BORDER_PATTERNS[borderPatIdx] ?? "None";
      if (fill >= 0) item.fillColor = unpackWasmColor(fill);
    } else if (kind === 2) {
      item = {
        "@type": "Ellipse",
        extent: [
          [x1, y1],
          [x2, y2],
        ],
        lineColor: unpackWasmColor(stroke >= 0 ? stroke : 0),
        fillPattern: fillPat,
        pattern: linePat,
        lineThickness: thickness,
      };
      const startAng = dv.getFloat64(88, true);
      const endAng = dv.getFloat64(96, true);
      const hasEndAng = dv.getUint8(171) !== 0;
      const closureIdx = dv.getUint8(169);
      if (startAng !== 0) item.startAngle = startAng;
      if (hasEndAng || endAng !== 360) item.endAngle = endAng;
      if (closureIdx !== 0) item.closure = WASM_CLOSURES[closureIdx] ?? "None";
      if (fill >= 0) item.fillColor = unpackWasmColor(fill);
    } else if (kind === 3 || kind === 4) {
      const ptOff = dv.getInt32(112, true);
      const ptCount = dv.getInt32(116, true);
      const points: [number, number][] = new Array(ptCount);
      const pxPtr = exports.annotation_getPointsXBufferPtr?.() ?? 0;
      const pyPtr = exports.annotation_getPointsYBufferPtr?.() ?? 0;
      if (pxPtr > 0 && pyPtr > 0 && ptCount > 0) {
        const pxArr = new Float64Array(wasmMemory.buffer, pxPtr + ptOff * 8, ptCount);
        const pyArr = new Float64Array(wasmMemory.buffer, pyPtr + ptOff * 8, ptCount);
        for (let p = 0; p < ptCount; p++) {
          points[p] = [pxArr[p]!, pyArr[p]!];
        }
      } else {
        for (let p = 0; p < ptCount; p++) {
          points[p] = [exports.annotation_getPointX(ptOff + p), exports.annotation_getPointY(ptOff + p)];
        }
      }
      if (kind === 3) {
        item = {
          "@type": "Line",
          points,
          color: unpackWasmColor(stroke >= 0 ? stroke : 0),
          thickness,
          pattern: linePat,
          smooth: WASM_SMOOTH_MODES[smoothIdx] ?? "None",
        };
        const arrowStart = dv.getUint8(166);
        const arrowEnd = dv.getUint8(167);
        if (arrowStart !== 0 || arrowEnd !== 0) {
          item.arrow = [WASM_ARROWS[arrowStart] ?? "None", WASM_ARROWS[arrowEnd] ?? "None"];
        }
        const arrowSize = dv.getFloat64(80, true);
        if (arrowSize !== 0) {
          item.arrowSize = arrowSize;
        }
      } else {
        item = {
          "@type": "Polygon",
          points,
          lineColor: unpackWasmColor(stroke >= 0 ? stroke : 0),
          fillPattern: fillPat,
          pattern: linePat,
          lineThickness: thickness,
          smooth: WASM_SMOOTH_MODES[smoothIdx] ?? "None",
        };
        if (fill >= 0) item.fillColor = unpackWasmColor(fill);
      }
    } else if (kind === 5) {
      const poolOff = dv.getUint32(128, true);
      const poolLen = dv.getUint32(132, true);
      const textVal = readPoolString(exports, wasmMemory, poolOff, poolLen);
      const rgb = unpackWasmColor(stroke >= 0 ? stroke : 0);
      item = {
        "@type": "Text",
        extent: [
          [x1, y1],
          [x2, y2],
        ],
        lineColor: rgb,
        textColor: rgb,
        fillPattern: fillPat,
        pattern: linePat,
        lineThickness: thickness,
        textString: textVal,
        string: textVal,
        fontSize: dv.getFloat64(72, true),
        horizontalAlignment: WASM_TEXT_ALIGNMENTS[dv.getUint8(165)] ?? "Center",
      };
      const fnOff = dv.getUint32(136, true);
      const fnLen = dv.getUint32(140, true);
      if (fnLen > 0) {
        item.fontName = readPoolString(exports, wasmMemory, fnOff, fnLen);
      }
      const styleMask = dv.getUint8(170);
      if (styleMask !== 0) {
        const styles: string[] = [];
        if ((styleMask & 1) !== 0) styles.push("Bold");
        if ((styleMask & 2) !== 0) styles.push("Italic");
        if ((styleMask & 4) !== 0) styles.push("Underline");
        item.textStyle = styles;
        item.style = styles;
      }
      if (fill >= 0) item.fillColor = unpackWasmColor(fill);
    } else {
      item = {
        "@type": "Bitmap",
        extent: [
          [x1, y1],
          [x2, y2],
        ],
      };
      const fileOff = dv.getUint32(144, true);
      const fileLen = dv.getUint32(148, true);
      if (fileLen > 0) {
        item.fileName = readPoolString(exports, wasmMemory, fileOff, fileLen);
      }
      const imgOff = dv.getUint32(152, true);
      const imgLen = dv.getUint32(156, true);
      if (imgLen > 0) {
        item.imageSource = readPoolString(exports, wasmMemory, imgOff, imgLen);
      }
    }

    if (!visible) item.visible = false;
    if (ox !== 0 || oy !== 0) item.origin = [ox, oy];
    if (rot !== 0) item.rotation = rot;
    return item;
  }

  const kind: number = exports.annotation_getGraphicKind(i);
  const stroke: number = exports.annotation_getGraphicStroke(i);
  const fill: number = exports.annotation_getGraphicFill(i);
  const fillPat = WASM_FILL_PATTERNS[exports.annotation_getGraphicFillPattern(i)] ?? "None";
  const linePat = WASM_LINE_PATTERNS[exports.annotation_getGraphicLinePattern(i)] ?? "Solid";
  const thickness: number = exports.annotation_getGraphicThickness(i);
  const visible: boolean = exports.annotation_getGraphicVisible(i) !== 0;
  const ox: number = exports.annotation_getGraphicOriginX(i);
  const oy: number = exports.annotation_getGraphicOriginY(i);
  const rot: number = exports.annotation_getGraphicRotation(i);
  const borderPatIdx: number = exports.annotation_getGraphicBorderPattern?.(i) ?? 0;

  let item: WasmGraphicItem | undefined;
  if (kind === 1) {
    item = {
      "@type": "Rectangle",
      extent: [
        [exports.annotation_getGraphicRectX1(i), exports.annotation_getGraphicRectY1(i)],
        [exports.annotation_getGraphicRectX2(i), exports.annotation_getGraphicRectY2(i)],
      ],
      lineColor: unpackWasmColor(stroke >= 0 ? stroke : 0),
      fillPattern: fillPat,
      pattern: linePat,
      lineThickness: thickness,
      radius: exports.annotation_getGraphicRadius(i),
    };
    if (borderPatIdx !== 0) item.borderPattern = WASM_BORDER_PATTERNS[borderPatIdx] ?? "None";
    if (fill >= 0) item.fillColor = unpackWasmColor(fill);
  } else if (kind === 2) {
    item = {
      "@type": "Ellipse",
      extent: [
        [exports.annotation_getGraphicRectX1(i), exports.annotation_getGraphicRectY1(i)],
        [exports.annotation_getGraphicRectX2(i), exports.annotation_getGraphicRectY2(i)],
      ],
      lineColor: unpackWasmColor(stroke >= 0 ? stroke : 0),
      fillPattern: fillPat,
      pattern: linePat,
      lineThickness: thickness,
    };
    const startAng = exports.annotation_getGraphicStartAngle?.(i) ?? 0;
    const endAng = exports.annotation_getGraphicEndAngle?.(i) ?? 360;
    const hasEndAng = (exports.annotation_getGraphicHasEndAngle?.(i) ?? 0) !== 0;
    const closureIdx = exports.annotation_getGraphicClosure?.(i) ?? 0;
    if (startAng !== 0) item.startAngle = startAng;
    if (hasEndAng || endAng !== 360) item.endAngle = endAng;
    if (closureIdx !== 0) item.closure = WASM_CLOSURES[closureIdx] ?? "None";
    if (fill >= 0) item.fillColor = unpackWasmColor(fill);
  } else if (kind === 3) {
    const ptOff: number = exports.annotation_getGraphicPointsOffset(i);
    const ptCount: number = exports.annotation_getGraphicPointsCount(i);
    const points: [number, number][] = new Array(ptCount);
    for (let p = 0; p < ptCount; p++) {
      points[p] = [exports.annotation_getPointX(ptOff + p), exports.annotation_getPointY(ptOff + p)];
    }
    item = {
      "@type": "Line",
      points,
      color: unpackWasmColor(stroke >= 0 ? stroke : 0),
      thickness,
      pattern: linePat,
      smooth: WASM_SMOOTH_MODES[exports.annotation_getGraphicSmooth(i)] ?? "None",
    };
    const arrowStart: number = exports.annotation_getGraphicArrowStart?.(i) ?? 0;
    const arrowEnd: number = exports.annotation_getGraphicArrowEnd?.(i) ?? 0;
    if (arrowStart !== 0 || arrowEnd !== 0) {
      item.arrow = [WASM_ARROWS[arrowStart] ?? "None", WASM_ARROWS[arrowEnd] ?? "None"];
    }
    const arrowSize: number = exports.annotation_getGraphicArrowSize?.(i) ?? 0;
    if (arrowSize !== 0) {
      item.arrowSize = arrowSize;
    }
  } else if (kind === 4) {
    const ptOff: number = exports.annotation_getGraphicPointsOffset(i);
    const ptCount: number = exports.annotation_getGraphicPointsCount(i);
    const points: [number, number][] = new Array(ptCount);
    for (let p = 0; p < ptCount; p++) {
      points[p] = [exports.annotation_getPointX(ptOff + p), exports.annotation_getPointY(ptOff + p)];
    }
    item = {
      "@type": "Polygon",
      points,
      lineColor: unpackWasmColor(stroke >= 0 ? stroke : 0),
      fillPattern: fillPat,
      pattern: linePat,
      lineThickness: thickness,
      smooth: WASM_SMOOTH_MODES[exports.annotation_getGraphicSmooth(i)] ?? "None",
    };
    if (fill >= 0) item.fillColor = unpackWasmColor(fill);
  } else if (kind === 5) {
    let textVal = "";
    if (wasmMemory && typeof exports.annotation_getGraphicPoolTextLen === "function") {
      const poolOff = exports.annotation_getGraphicPoolTextOffset?.(i) ?? 0;
      const poolLen = exports.annotation_getGraphicPoolTextLen(i);
      textVal = readPoolString(exports, wasmMemory, poolOff, poolLen);
    } else {
      const textOff: number = exports.annotation_getGraphicTextOffset(i);
      const textLen: number = exports.annotation_getGraphicTextLen(i);
      textVal = textOff > 0 ? src.substring(textOff, textOff + textLen) : "";
    }
    item = {
      "@type": "Text",
      extent: [
        [exports.annotation_getGraphicRectX1(i), exports.annotation_getGraphicRectY1(i)],
        [exports.annotation_getGraphicRectX2(i), exports.annotation_getGraphicRectY2(i)],
      ],
      lineColor: unpackWasmColor(stroke >= 0 ? stroke : 0),
      textColor: unpackWasmColor(stroke >= 0 ? stroke : 0),
      fillPattern: fillPat,
      pattern: linePat,
      lineThickness: thickness,
      textString: textVal,
      string: textVal,
      fontSize: exports.annotation_getGraphicFontSize(i),
      horizontalAlignment: WASM_TEXT_ALIGNMENTS[exports.annotation_getGraphicTextAlignment(i)] ?? "Center",
    };
    const fnLen = exports.annotation_getGraphicFontNamePoolLen?.(i) ?? 0;
    if (fnLen > 0 && wasmMemory) {
      item.fontName = readPoolString(
        exports,
        wasmMemory,
        exports.annotation_getGraphicFontNamePoolOffset?.(i) ?? 0,
        fnLen,
      );
    }
    const styleMask = exports.annotation_getGraphicTextStyleMask?.(i) ?? 0;
    if (styleMask !== 0) {
      const styles: string[] = [];
      if ((styleMask & 1) !== 0) styles.push("Bold");
      if ((styleMask & 2) !== 0) styles.push("Italic");
      if ((styleMask & 4) !== 0) styles.push("Underline");
      item.textStyle = styles;
    }
    if (fill >= 0) item.fillColor = unpackWasmColor(fill);
  } else if (kind === 6) {
    item = {
      "@type": "Bitmap",
      extent: [
        [exports.annotation_getGraphicRectX1(i), exports.annotation_getGraphicRectY1(i)],
        [exports.annotation_getGraphicRectX2(i), exports.annotation_getGraphicRectY2(i)],
      ],
    };
    const fileLen = exports.annotation_getGraphicFileNamePoolLen?.(i) ?? 0;
    if (fileLen > 0 && wasmMemory) {
      item.fileName = readPoolString(
        exports,
        wasmMemory,
        exports.annotation_getGraphicFileNamePoolOffset?.(i) ?? 0,
        fileLen,
      );
    }
    const imgLen = exports.annotation_getGraphicImageSourcePoolLen?.(i) ?? 0;
    if (imgLen > 0 && wasmMemory) {
      item.imageSource = readPoolString(
        exports,
        wasmMemory,
        exports.annotation_getGraphicImageSourcePoolOffset?.(i) ?? 0,
        imgLen,
      );
    }
  } else {
    return undefined;
  }

  if (!visible) item.visible = false;
  if (ox !== 0 || oy !== 0) item.origin = [ox, oy];
  if (rot !== 0) item.rotation = rot;
  return item;
}

const wasmAstCache = new WeakMap<object, Map<number, unknown>>();

function getWasmAstCache(tree: unknown, ptr: number, mode: number): { hit: boolean; value: unknown } {
  if (!tree || typeof tree !== "object") return { hit: false, value: undefined };
  const map = wasmAstCache.get(tree);
  if (!map) return { hit: false, value: undefined };
  const key = ptr * 4 + mode;
  if (!map.has(key)) return { hit: false, value: undefined };
  return { hit: true, value: map.get(key) };
}

function setWasmAstCache<T>(tree: unknown, ptr: number, mode: number, value: T): T {
  if (!tree || typeof tree !== "object") return value;
  let map = wasmAstCache.get(tree);
  if (!map) {
    map = new Map<number, unknown>();
    wasmAstCache.set(tree, map);
  }
  map.set(ptr * 4 + mode, value);
  return value;
}

export interface WasmGraphicLayer {
  "@type": "Diagram" | "Icon";
  coordinateSystem?: {
    "@type": "coordinateSystem";
    extent: [[number, number], [number, number]];
    preserveAspectRatio: boolean;
    grid?: [number, number] | undefined;
  };
  graphics?: WasmGraphicItem[];
}

function evaluateGraphicsLayerWasm(ast: unknown, isDiagram: boolean): WasmGraphicLayer | null | undefined {
  const astNode = ast as
    | {
        ptr?: number;
        type?: string;
        startIndex?: number;
        endIndex?: number;
        children?: Array<{ type?: string; ptr?: number }>;
        tree?: { sourceCode?: string; facade?: unknown };
      }
    | null
    | undefined;
  if (!astNode || typeof astNode.ptr !== "number" || astNode.ptr <= 0) return undefined;
  const t = astNode.type;
  if (t !== "class_definition" && t !== "ClassDefinition" && t !== "stored_definition" && t !== "StoredDefinition") {
    return undefined;
  }
  const mode = isDiagram ? 1 : 0;
  let targetAst = astNode;
  if (t === "stored_definition" || t === "StoredDefinition") {
    const classDefs = (astNode.children || []).filter(
      (c: { type?: string }) => c.type === "class_definition" || c.type === "ClassDefinition",
    );
    if (classDefs.length === 1 && typeof classDefs[0]!.ptr === "number" && classDefs[0]!.ptr > 0) {
      targetAst = classDefs[0] as typeof targetAst;
    } else if (classDefs.length > 1) {
      return setWasmAstCache(astNode.tree, astNode.ptr, mode, undefined);
    }
  }
  const cached = getWasmAstCache(targetAst.tree, targetAst.ptr!, mode);
  if (cached.hit) return cached.value as WasmGraphicLayer | null | undefined;

  const src = targetAst.tree?.sourceCode;
  if (typeof src === "string") {
    const startIdx = targetAst.startIndex ?? 0;
    const endIdx = targetAst.endIndex ?? src.length;
    const targetUpper = isDiagram ? "Diagram" : "Icon";
    const targetLower = isDiagram ? "diagram" : "icon";
    const pos = src.indexOf(targetUpper, startIdx);
    const lowerPos = pos === -1 || pos >= endIdx ? src.indexOf(targetLower, startIdx) : pos;
    if (lowerPos === -1 || lowerPos >= endIdx) {
      return setWasmAstCache(targetAst.tree, targetAst.ptr!, mode, null);
    }
  }

  const ctx = ensureWasmAnnotationBuffer(targetAst);
  if (!ctx) return undefined;
  const { exports } = ctx;
  const scanFn = isDiagram ? exports.annotation_scanDiagram : exports.annotation_scanIcon;
  if (typeof scanFn !== "function") return undefined;

  const count: number = scanFn(targetAst.ptr!, targetAst.startIndex ?? 0);
  if (count < 0) return setWasmAstCache(targetAst.tree, targetAst.ptr!, mode, undefined);
  if (exports.annotation_hasIcon() === 0) return setWasmAstCache(targetAst.tree, targetAst.ptr!, mode, null);

  const layer: WasmGraphicLayer = { "@type": isDiagram ? "Diagram" : "Icon" };
  if (exports.annotation_hasCoordSys() !== 0) {
    layer.coordinateSystem = {
      "@type": "coordinateSystem",
      extent: [
        [exports.annotation_getCoordX1(), exports.annotation_getCoordY1()],
        [exports.annotation_getCoordX2(), exports.annotation_getCoordY2()],
      ],
      preserveAspectRatio: exports.annotation_getPreserveAspectRatio() !== 0,
    };
    if (typeof exports.annotation_hasGrid === "function" && exports.annotation_hasGrid() !== 0) {
      const gx = typeof exports.annotation_getGridX === "function" ? exports.annotation_getGridX() : 0;
      const gy = typeof exports.annotation_getGridY === "function" ? exports.annotation_getGridY() : 0;
      layer.coordinateSystem.grid = [gx, gy];
    }
  }

  if (count > 0) {
    const graphics: WasmGraphicItem[] = [];
    for (let i = 0; i < count; i++) {
      const item = readWasmGraphicSlot(exports, ctx.src, i, ctx.wasmMemory);
      if (!item) return setWasmAstCache(targetAst.tree, targetAst.ptr!, mode, undefined);
      graphics.push(item);
    }
    layer.graphics = graphics;
  }

  return setWasmAstCache(targetAst.tree, targetAst.ptr!, mode, layer);
}

/**
 * Evaluates and merges an ordered list of base-to-derived class AST/CST locations directly in WASM.
 */
export function evaluateInheritedLayerWasm(asts: unknown[], isDiagram: boolean): WasmGraphicLayer | null | undefined {
  if (!asts || asts.length === 0) return null;
  if (asts.length === 1) return evaluateGraphicsLayerWasm(asts[0], isDiagram);

  let activeExports: WasmAnnotationExports | undefined;
  let activeMem: { buffer: ArrayBuffer } | undefined;
  let initialized = false;
  let lastSrc = "";

  for (let idx = 0; idx < asts.length; idx++) {
    const astNode = asts[idx] as
      { ptr?: number; startIndex?: number; tree?: { sourceCode?: string; facade?: unknown } } | null | undefined;
    if (!astNode || typeof astNode.ptr !== "number" || astNode.ptr <= 0) return undefined;
    const ctx = ensureWasmAnnotationBuffer(astNode);
    if (!ctx) return undefined;
    if (!initialized) {
      if (
        typeof ctx.exports.annotation_beginLayer !== "function" ||
        typeof ctx.exports.annotation_appendClassLayer !== "function"
      ) {
        return undefined;
      }
      ctx.exports.annotation_beginLayer(isDiagram ? 1 : 0);
      activeExports = ctx.exports;
      activeMem = ctx.wasmMemory;
      initialized = true;
    }
    lastSrc = ctx.src;
    const count = ctx.exports.annotation_appendClassLayer!(astNode.ptr, astNode.startIndex ?? 0, isDiagram ? 1 : 0);
    if (count < 0) return undefined;
  }

  if (!activeExports) return undefined;
  if (activeExports.annotation_hasIcon() === 0) return null;

  const totalCount = activeExports.annotation_getGraphicCount?.() ?? 0;
  const layer: WasmGraphicLayer = { "@type": isDiagram ? "Diagram" : "Icon" };
  if (activeExports.annotation_hasCoordSys() !== 0) {
    layer.coordinateSystem = {
      "@type": "coordinateSystem",
      extent: [
        [activeExports.annotation_getCoordX1(), activeExports.annotation_getCoordY1()],
        [activeExports.annotation_getCoordX2(), activeExports.annotation_getCoordY2()],
      ],
      preserveAspectRatio: activeExports.annotation_getPreserveAspectRatio() !== 0,
    };
    if (typeof activeExports.annotation_hasGrid === "function" && activeExports.annotation_hasGrid() !== 0) {
      const gx = typeof activeExports.annotation_getGridX === "function" ? activeExports.annotation_getGridX() : 0;
      const gy = typeof activeExports.annotation_getGridY === "function" ? activeExports.annotation_getGridY() : 0;
      layer.coordinateSystem.grid = [gx, gy];
    }
  }

  if (totalCount > 0) {
    const graphics: WasmGraphicItem[] = [];
    for (let i = 0; i < totalCount; i++) {
      const item = readWasmGraphicSlot(activeExports, lastSrc, i, activeMem);
      if (!item) return undefined;
      graphics.push(item);
    }
    layer.graphics = graphics;
  }

  return layer;
}

/**
 * Fast-path in-WASM Icon annotation evaluator using the unmanaged linear graphics arena.
 * Returns:
 * - `null` if the class has no Icon annotation
 * - `IIcon` object if evaluated in WASM
 * - `undefined` if the annotation uses dynamic/non-literal constructs requiring the TypeScript fallback
 */
export function evaluateIconWasm(ast: unknown): WasmGraphicLayer | null | undefined {
  return evaluateGraphicsLayerWasm(ast, false);
}

/**
 * Fast-path in-WASM Diagram annotation evaluator using the unmanaged linear graphics arena.
 */
export function evaluateDiagramWasm(ast: unknown): WasmGraphicLayer | null | undefined {
  return evaluateGraphicsLayerWasm(ast, true);
}

interface WasmTransformation {
  "@type": "transformation" | "iconTransformation";
  origin?: [number, number];
  extent?: [[number, number], [number, number]];
  rotation?: number;
}

interface WasmPlacement {
  "@type": "Placement";
  visible?: boolean;
  iconVisible?: boolean;
  transformation?: WasmTransformation;
  iconTransformation?: WasmTransformation;
}

/**
 * Fast-path in-WASM Placement annotation evaluator for component declarations.
 */
export function evaluatePlacementWasm(ast: unknown): unknown {
  const astNode = ast as
    | {
        ptr?: number;
        startIndex?: number;
        endIndex?: number;
        type?: string;
        parent?: { ptr?: number; startIndex?: number; endIndex?: number };
        tree?: { sourceCode?: string };
      }
    | null
    | undefined;
  if (!astNode || typeof astNode.ptr !== "number" || astNode.ptr <= 0) return undefined;
  const cached = getWasmAstCache(astNode.tree, astNode.ptr, 2);
  if (cached.hit) return cached.value;

  let targetAst = astNode;
  const src = targetAst.tree?.sourceCode;
  if (typeof src === "string") {
    let startIdx = targetAst.startIndex ?? 0;
    let endIdx = targetAst.endIndex ?? src.length;
    let pos = src.indexOf("Placement", startIdx);
    let lowerPos = pos === -1 || pos >= endIdx ? src.indexOf("placement", startIdx) : pos;
    if (
      (lowerPos === -1 || lowerPos >= endIdx) &&
      (astNode.type === "declaration" ||
        astNode.type === "Declaration" ||
        astNode.type === "connect_equation" ||
        astNode.type === "ConnectEquation") &&
      astNode.parent &&
      typeof astNode.parent.ptr === "number" &&
      astNode.parent.ptr > 0
    ) {
      targetAst = astNode.parent;
      startIdx = targetAst.startIndex ?? 0;
      endIdx = targetAst.endIndex ?? src.length;
      pos = src.indexOf("Placement", startIdx);
      lowerPos = pos === -1 || pos >= endIdx ? src.indexOf("placement", startIdx) : pos;
    }
    if (lowerPos === -1 || lowerPos >= endIdx) {
      return setWasmAstCache(astNode.tree, astNode.ptr, 2, null);
    }
  } else if (
    (astNode.type === "declaration" ||
      astNode.type === "Declaration" ||
      astNode.type === "connect_equation" ||
      astNode.type === "ConnectEquation") &&
    astNode.parent &&
    typeof astNode.parent.ptr === "number" &&
    astNode.parent.ptr > 0
  ) {
    targetAst = astNode.parent;
  }

  const ctx = ensureWasmAnnotationBuffer(targetAst);
  if (!ctx) return undefined;
  const { exports } = ctx;
  if (typeof exports.annotation_scanPlacement !== "function") return undefined;

  const status: number = exports.annotation_scanPlacement(targetAst.ptr!, targetAst.startIndex ?? 0);
  if (status < 0) return setWasmAstCache(astNode.tree, astNode.ptr, 2, undefined);
  if (status === 0) return setWasmAstCache(astNode.tree, astNode.ptr, 2, null);

  const placement: WasmPlacement = { "@type": "Placement" };
  const vis: number = exports.annotation_getPlacementVisible();
  if (vis === 1) placement.visible = true;
  else if (vis === 0) placement.visible = false;

  const iconVis: number = exports.annotation_getPlacementIconVisible();
  if (iconVis === 1) placement.iconVisible = true;
  else if (iconVis === 0) placement.iconVisible = false;

  if (exports.annotation_hasTransformation() !== 0) {
    const trans: WasmTransformation = { "@type": "transformation" };
    if (exports.annotation_transHasOrigin() !== 0) {
      trans.origin = [exports.annotation_getTransOriginX(), exports.annotation_getTransOriginY()];
    }
    if (exports.annotation_transHasExtent() !== 0) {
      trans.extent = [
        [exports.annotation_getTransX1(), exports.annotation_getTransY1()],
        [exports.annotation_getTransX2(), exports.annotation_getTransY2()],
      ];
    }
    if (exports.annotation_transHasRotation() !== 0) {
      trans.rotation = exports.annotation_getTransRotation();
    }
    placement.transformation = trans;
  }

  if (exports.annotation_hasIconTransformation() !== 0) {
    const iconTrans: WasmTransformation = { "@type": "iconTransformation" };
    if (exports.annotation_iconTransHasOrigin() !== 0) {
      iconTrans.origin = [exports.annotation_getIconTransOriginX(), exports.annotation_getIconTransOriginY()];
    }
    if (exports.annotation_iconTransHasExtent() !== 0) {
      iconTrans.extent = [
        [exports.annotation_getIconTransX1(), exports.annotation_getIconTransY1()],
        [exports.annotation_getIconTransX2(), exports.annotation_getIconTransY2()],
      ];
    }
    if (exports.annotation_iconTransHasRotation() !== 0) {
      iconTrans.rotation = exports.annotation_getIconTransRotation();
    }
    placement.iconTransformation = iconTrans;
  }

  return setWasmAstCache(astNode.tree, astNode.ptr, 2, placement);
}

/**
 * Fast-path in-WASM Line annotation evaluator for connect(...) equations.
 */
export function evaluateConnectLineWasm(ast: unknown): unknown {
  const astNode = ast as
    | {
        ptr?: number;
        startIndex?: number;
        endIndex?: number;
        type?: string;
        parent?: { ptr?: number; startIndex?: number; endIndex?: number };
        tree?: { sourceCode?: string };
      }
    | null
    | undefined;
  if (!astNode || typeof astNode.ptr !== "number" || astNode.ptr <= 0) return undefined;
  const cached = getWasmAstCache(astNode.tree, astNode.ptr, 3);
  if (cached.hit) return cached.value;

  let targetAst = astNode;
  const src = targetAst.tree?.sourceCode;
  if (typeof src === "string") {
    let startIdx = targetAst.startIndex ?? 0;
    let endIdx = targetAst.endIndex ?? src.length;
    let pos = src.indexOf("Line", startIdx);
    let lowerPos = pos === -1 || pos >= endIdx ? src.indexOf("line", startIdx) : pos;
    if (
      (lowerPos === -1 || lowerPos >= endIdx) &&
      (astNode.type === "connect_equation" ||
        astNode.type === "ConnectEquation" ||
        astNode.type === "declaration" ||
        astNode.type === "Declaration") &&
      astNode.parent &&
      typeof astNode.parent.ptr === "number" &&
      astNode.parent.ptr > 0
    ) {
      targetAst = astNode.parent;
      startIdx = targetAst.startIndex ?? 0;
      endIdx = targetAst.endIndex ?? src.length;
      pos = src.indexOf("Line", startIdx);
      lowerPos = pos === -1 || pos >= endIdx ? src.indexOf("line", startIdx) : pos;
    }
    if (lowerPos === -1 || lowerPos >= endIdx) {
      return setWasmAstCache(astNode.tree, astNode.ptr, 3, null);
    }
  } else if (
    (astNode.type === "connect_equation" ||
      astNode.type === "ConnectEquation" ||
      astNode.type === "declaration" ||
      astNode.type === "Declaration") &&
    astNode.parent &&
    typeof astNode.parent.ptr === "number" &&
    astNode.parent.ptr > 0
  ) {
    targetAst = astNode.parent;
  }

  const ctx = ensureWasmAnnotationBuffer(targetAst);
  if (!ctx) return undefined;
  const { exports } = ctx;
  if (typeof exports.annotation_scanConnectLine !== "function") return undefined;

  const status: number = exports.annotation_scanConnectLine(targetAst.ptr!, targetAst.startIndex ?? 0);
  if (status < 0) return setWasmAstCache(astNode.tree, astNode.ptr, 3, undefined);
  if (status === 0) return setWasmAstCache(astNode.tree, astNode.ptr, 3, null);

  return setWasmAstCache(astNode.tree, astNode.ptr, 3, readWasmGraphicSlot(exports, ctx.src, 0, ctx.wasmMemory));
}

function setWasmIconName(
  exports: WasmAnnotationExports,
  wasmMemory: { buffer: ArrayBuffer } | undefined,
  iconName?: string,
): void {
  if (
    typeof exports.annotation_setIconNameLen !== "function" ||
    typeof exports.annotation_getIconNameBufferPtr !== "function"
  ) {
    return;
  }
  if (!iconName || !wasmMemory) {
    exports.annotation_setIconNameLen(0);
    return;
  }
  const ptr = exports.annotation_getIconNameBufferPtr();
  if (ptr <= 0) {
    exports.annotation_setIconNameLen(0);
    return;
  }
  const len = Math.min(iconName.length, 256);
  const u16 = new Uint16Array(wasmMemory.buffer, ptr, len);
  for (let i = 0; i < len; i++) {
    u16[i] = iconName.charCodeAt(i);
  }
  exports.annotation_setIconNameLen(len);
}

/**
 * Renders a standalone class Icon directly to a UTF-8 SVG string inside WebAssembly linear memory.
 * Returns `undefined` if the class has no standalone Icon or requires TypeScript fallback (e.g. Text macros).
 */
export function renderIconSvgWasm(ast: unknown, size = 16, iconName?: string): string | undefined {
  const astNode = ast as
    | {
        ptr?: number;
        startIndex?: number;
        tree?: { facade?: { wasmMemory?: { buffer: ArrayBuffer } } };
      }
    | null
    | undefined;
  if (!astNode || typeof astNode.ptr !== "number") return undefined;
  const ctx = ensureWasmAnnotationBuffer(astNode);
  if (!ctx) return undefined;
  const { exports, wasmMemory } = ctx;
  if (!exports.annotation_renderIconSvg || !exports.annotation_getSvgBufferPtr) return undefined;
  setWasmIconName(exports, wasmMemory, iconName);
  const svgLen: number = exports.annotation_renderIconSvg(astNode.ptr, astNode.startIndex ?? 0, size);
  if (svgLen <= 0) return undefined;
  const svgPtr: number = exports.annotation_getSvgBufferPtr();
  if (!wasmMemory || svgPtr <= 0) return undefined;
  const bytes = new Uint8Array(wasmMemory.buffer, svgPtr, svgLen);
  return utf8Decoder.decode(bytes);
}

/**
 * Renders a multi-layer inherited class Icon directly to a UTF-8 SVG string inside WebAssembly linear memory.
 */
export function renderInheritedIconSvgWasm(asts: unknown[], size = 16, iconName?: string): string | undefined {
  if (!asts || asts.length === 0) return undefined;
  if (asts.length === 1) return renderIconSvgWasm(asts[0], size, iconName);

  let activeExports: WasmAnnotationExports | undefined;
  let activeMem: { buffer: ArrayBuffer } | undefined;
  let initialized = false;

  for (let idx = 0; idx < asts.length; idx++) {
    const astNode = asts[idx] as
      | { ptr?: number; startIndex?: number; tree?: { facade?: { wasmMemory?: { buffer: ArrayBuffer } } } }
      | null
      | undefined;
    if (!astNode || typeof astNode.ptr !== "number" || astNode.ptr <= 0) return undefined;
    const ctx = ensureWasmAnnotationBuffer(astNode);
    if (!ctx) return undefined;
    if (!initialized) {
      if (
        typeof ctx.exports.annotation_beginLayer !== "function" ||
        typeof ctx.exports.annotation_appendClassLayer !== "function" ||
        typeof ctx.exports.annotation_renderAccumulatedIconSvg !== "function" ||
        typeof ctx.exports.annotation_getSvgBufferPtr !== "function"
      ) {
        return undefined;
      }
      ctx.exports.annotation_beginLayer(0);
      activeExports = ctx.exports;
      activeMem = ctx.wasmMemory;
      initialized = true;
    }
    const count = ctx.exports.annotation_appendClassLayer!(astNode.ptr, astNode.startIndex ?? 0, 0);
    if (count < 0) return undefined;
  }

  if (!activeExports || !activeMem) return undefined;
  setWasmIconName(activeExports, activeMem, iconName);
  const svgLen: number = activeExports.annotation_renderAccumulatedIconSvg!(size);
  if (svgLen <= 0) return undefined;
  const svgPtr: number = activeExports.annotation_getSvgBufferPtr!();
  if (svgPtr <= 0) return undefined;
  const bytes = new Uint8Array(activeMem.buffer, svgPtr, svgLen);
  return utf8Decoder.decode(bytes);
}

export interface DynamicBindingItem {
  property?: string | undefined;
  staticExpr: unknown;
  dynamicExpr: unknown;
  variableName?: string | undefined;
}

interface CachedTsEvalVariant {
  deps: Array<[string, unknown]>;
  result: AnnotationValue | null;
  dynamicBindings: DynamicBindingItem[];
}

const tsAstEvalCache = new WeakMap<object, Map<string, CachedTsEvalVariant[]>>();

function depValuesMatch(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!depValuesMatch(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}

function asAnnotationRecord(val: AnnotationValue | null | undefined): AnnotationRecord {
  return val && typeof val === "object" && !Array.isArray(val) ? val : {};
}

function isInteractiveAction(val: unknown): val is InteractiveBinding["action"] {
  return (
    val === "momentary" ||
    val === "toggle" ||
    val === "numeric" ||
    val === "slider" ||
    val === "selector" ||
    val === "faceplate"
  );
}

export class AnnotationEvaluator {
  private scope: unknown;
  public dynamicBindings: DynamicBindingItem[] = [];
  public interactiveBindings: InteractiveBinding[] = [];

  constructor(evalScope?: unknown) {
    this.scope = evalScope ?? null;
  }

  public evaluate(ast: unknown, name: "experiment"): ExperimentAnnotation | null;
  public evaluate(ast: unknown, name: "webgpu"): WebGpuAnnotation | null;
  public evaluate(ast: unknown, name: "audioclock"): AudioClockAnnotation | null;
  public evaluate(ast: unknown, name: "sde"): SdeAnnotation | null;
  public evaluate(ast: unknown, name: "bvp"): BvpAnnotation | null;
  public evaluate(ast: unknown, name: "surrogate"): SurrogateAnnotation | null;
  public evaluate(ast: unknown, name: "feamesh"): FeaMeshAnnotation | null;
  public evaluate(ast: unknown, name: "cfdflow"): CfdFlowAnnotation | null;
  public evaluate(ast: unknown, name: "diffusion"): DiffusionAnnotation | number | boolean | null;
  public evaluate(ast: unknown, name: "hideresult" | "evaluate" | "inline"): BooleanFlagAnnotation | boolean | null;
  public evaluate(ast: unknown, name: "Documentation" | "documentation"): DocumentationAnnotation | null;
  public evaluate(ast: unknown, name: string): AnnotationValue | null;
  public evaluate(ast: unknown, name: string): AnnotationValue | null {
    const astNode = asAnnotationNode(ast);
    if (!astNode) return null;
    if (name === "Icon" || name === "icon") {
      const wasmIcon = evaluateIconWasm(astNode);
      if (wasmIcon !== undefined) {
        return wasmIcon as unknown as AnnotationValue | null;
      }
    } else if (name === "Diagram" || name === "diagram") {
      const wasmDiag = evaluateDiagramWasm(astNode);
      if (wasmDiag !== undefined) {
        return wasmDiag as unknown as AnnotationValue | null;
      }
    } else if (name === "Placement" || name === "placement") {
      const wasmPlacement = evaluatePlacementWasm(astNode);
      if (wasmPlacement !== undefined) {
        return wasmPlacement as AnnotationValue | null;
      }
    } else if (name === "Line" || name === "line") {
      const wasmLine = evaluateConnectLineWasm(astNode);
      if (wasmLine !== undefined) {
        return wasmLine as AnnotationValue | null;
      }
    }

    const astTree = astNode.tree;
    const canCacheByPtr = Boolean(astTree && typeof astNode.ptr === "number" && astNode.ptr > 0);
    let treeCacheMap: Map<string, CachedTsEvalVariant[]> | undefined;
    const cacheKey = canCacheByPtr ? `${astNode.ptr}:${name.toLowerCase()}` : "";
    if (canCacheByPtr && astTree) {
      treeCacheMap = tsAstEvalCache.get(astTree);
      const variants = treeCacheMap?.get(cacheKey);
      if (variants) {
        for (let vIdx = 0; vIdx < variants.length; vIdx++) {
          const variant = variants[vIdx]!;
          let allMatch = true;
          for (let dIdx = 0; dIdx < variant.deps.length; dIdx++) {
            const [depName, expectedVal] = variant.deps[dIdx]!;
            const actualVal = resolveAnnotationName(depName, this.scope);
            if (!depValuesMatch(actualVal, expectedVal)) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) {
            if (variant.dynamicBindings.length > 0) {
              this.dynamicBindings.push(...variant.dynamicBindings);
            }
            return variant.result;
          }
        }
      }
    }

    if (typeof astNode.text === "string") {
      const hasAnnotation =
        astNode.text.includes("annotation") ||
        (astNode.parent &&
          astNode.parent.type !== "class_definition" &&
          astNode.parent.type !== "composition" &&
          astNode.parent.type !== "stored_definition" &&
          typeof astNode.parent.text === "string" &&
          astNode.parent.text.includes("annotation")) ||
        (astNode.nextNamedSibling &&
          typeof astNode.nextNamedSibling.text === "string" &&
          astNode.nextNamedSibling.text.includes("annotation"));
      if (!hasAnnotation) {
        if (canCacheByPtr && astTree) {
          if (!treeCacheMap) {
            treeCacheMap = new Map();
            tsAstEvalCache.set(astTree, treeCacheMap);
          }
          treeCacheMap.set(cacheKey, [{ deps: [], result: null, dynamicBindings: [] }]);
        }
        return null;
      }
    }

    const prevDeps = activeScopeDeps;
    const myDeps = canCacheByPtr ? new Map<string, unknown>() : null;
    if (canCacheByPtr) activeScopeDeps = myDeps;
    try {
      const classMods = this.extractAllClassModifications(astNode);
      if (classMods.length === 0) {
        if (canCacheByPtr && astTree && myDeps) {
          if (!treeCacheMap) {
            treeCacheMap = new Map();
            tsAstEvalCache.set(astTree, treeCacheMap);
          }
          treeCacheMap.set(cacheKey, [{ deps: [], result: null, dynamicBindings: [] }]);
        }
        return null;
      }

      let mergedResult: AnnotationValue | null = null;
      for (const classMod of classMods) {
        const layerMod = this.findModByName(classMod, name);
        if (layerMod) {
          const parsed = this.parseMod(layerMod, name);
          if (parsed !== null && parsed !== undefined) {
            if (mergedResult === null) {
              mergedResult = parsed;
            } else if (
              typeof parsed === "object" &&
              !Array.isArray(parsed) &&
              typeof mergedResult === "object" &&
              !Array.isArray(mergedResult)
            ) {
              const prevGraphics = Array.isArray(mergedResult["graphics"]) ? mergedResult["graphics"] : null;
              const nextGraphics = Array.isArray(parsed["graphics"]) ? parsed["graphics"] : null;
              const prevCoordSys =
                mergedResult["coordinateSystem"] &&
                typeof mergedResult["coordinateSystem"] === "object" &&
                !Array.isArray(mergedResult["coordinateSystem"])
                  ? (mergedResult["coordinateSystem"] as AnnotationRecord)
                  : null;
              const nextCoordSys =
                parsed["coordinateSystem"] &&
                typeof parsed["coordinateSystem"] === "object" &&
                !Array.isArray(parsed["coordinateSystem"])
                  ? (parsed["coordinateSystem"] as AnnotationRecord)
                  : null;
              Object.assign(mergedResult, parsed);
              if (prevGraphics && nextGraphics) {
                mergedResult["graphics"] = [...prevGraphics, ...nextGraphics];
              } else if (prevGraphics && !nextGraphics) {
                mergedResult["graphics"] = prevGraphics;
              }
              if (prevCoordSys && nextCoordSys) {
                mergedResult["coordinateSystem"] = { ...prevCoordSys, ...nextCoordSys };
              }
            }
          }
        }
      }

      if (
        mergedResult &&
        typeof mergedResult === "object" &&
        !Array.isArray(mergedResult) &&
        this.dynamicBindings.length > 0
      ) {
        mergedResult["dynamicBindings"] = [...this.dynamicBindings] as unknown as AnnotationValue;
      }

      if (canCacheByPtr && astTree && myDeps) {
        if (!treeCacheMap) {
          treeCacheMap = new Map();
          tsAstEvalCache.set(astTree, treeCacheMap);
        }
        let variants = treeCacheMap.get(cacheKey);
        if (!variants) {
          variants = [];
          treeCacheMap.set(cacheKey, variants);
        }
        if (variants.length < 8) {
          variants.push({
            deps: Array.from(myDeps.entries()),
            result: mergedResult,
            dynamicBindings: [...this.dynamicBindings],
          });
        }
      }

      return mergedResult;
    } finally {
      if (canCacheByPtr) activeScopeDeps = prevDeps;
    }
  }

  /**
   * Discovers and extracts all classModification containers associated with the node.
   * Handles multiple annotation(...) clauses at the class or component level.
   */
  public extractAllClassModifications(astInput: unknown): AnnotationNodeLike[] {
    let ast = asAnnotationNode(astInput);
    if (!ast) return [];
    if (ast.type === "stored_definition" || ast.type === "StoredDefinition") {
      const classDefs = (ast.children || []).filter(
        (c) => c.type === "class_definition" || c.type === "ClassDefinition",
      );
      if (classDefs.length === 1 && classDefs[0]) {
        ast = classDefs[0];
      }
    }
    const clauses: AnnotationNodeLike[] = [];
    const isClassRoot =
      ast.type === "class_definition" ||
      ast.type === "ClassDefinition" ||
      ast.type === "stored_definition" ||
      ast.type === "StoredDefinition";
    this.findAllAnnotationClauses(ast, 0, clauses, isClassRoot);

    // Fallbacks for inner declarations: check parent and next sibling
    if (
      clauses.length === 0 &&
      !isClassRoot &&
      ast.parent &&
      ast.parent.type !== "class_definition" &&
      ast.parent.type !== "composition" &&
      ast.parent.type !== "stored_definition"
    ) {
      this.findAllAnnotationClauses(ast.parent, 0, clauses, false);
    }
    if (clauses.length === 0 && !isClassRoot && ast.nextNamedSibling) {
      const sib = ast.nextNamedSibling;
      if (Cst.AnnotationClause.is(asSyntaxNode(sib))) {
        clauses.push(sib);
      }
    }

    const classMods: AnnotationNodeLike[] = [];
    if (ast.classModification) classMods.push(ast.classModification);
    if (ast.annotationClause?.classModification) classMods.push(ast.annotationClause.classModification);

    for (const ann of clauses) {
      if (ann.classModification) {
        classMods.push(ann.classModification);
        continue;
      }
      const children = ann.children || ann.namedChildren;
      if (Array.isArray(children)) {
        const cm = children.find((c) => Cst.ClassModification.is(asSyntaxNode(c)));
        if (cm) {
          classMods.push(cm);
          continue;
        }
      }
      classMods.push(ann);
    }

    return classMods;
  }

  private findAllAnnotationClauses(
    node: AnnotationNodeLike | null | undefined,
    depth = 0,
    collected: AnnotationNodeLike[] = [],
    isClassRoot = false,
    seenClassDef = false,
  ): AnnotationNodeLike[] {
    if (!node || depth > 8) return collected;
    if (Cst.AnnotationClause.is(asSyntaxNode(node))) {
      collected.push(node);
      return collected;
    }
    const children = node.children || node.namedChildren;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (Cst.AnnotationClause.is(asSyntaxNode(child))) {
          collected.push(child);
        } else if (isClassRoot) {
          const ct = child.type;
          const isChildClassDef =
            Cst.ClassDefinition.is(asSyntaxNode(child)) || ct === "class_definition" || ct === "ClassDefinition";
          if (isChildClassDef && seenClassDef) {
            continue;
          }
          if (
            ct === "component_clause" ||
            ct === "ComponentClause" ||
            ct === "component_declaration" ||
            ct === "ComponentDeclaration" ||
            ct === "some_equation" ||
            ct === "SomeEquation" ||
            ct === "statement" ||
            ct === "Statement" ||
            ct === "extends_clause" ||
            ct === "ExtendsClause" ||
            ct === "import_clause" ||
            ct === "ImportClause" ||
            ct === "short_class_definition" ||
            ct === "ShortClassDefinition"
          ) {
            continue;
          }
          this.findAllAnnotationClauses(
            child,
            depth + 1,
            collected,
            true,
            seenClassDef || isChildClassDef || node.type === "class_definition" || node.type === "ClassDefinition",
          );
        } else {
          this.findAllAnnotationClauses(child, depth + 1, collected, false, false);
        }
      }
    }
    return collected;
  }

  /**
   * Evaluates Interactive(...) or Dialog(...) annotations on a component or parameter.
   */
  public evaluateInteractive(ast: unknown, variableName: string): InteractiveBinding | null {
    const classMods = this.extractAllClassModifications(ast);
    if (classMods.length === 0) return null;

    let foundBinding: InteractiveBinding | null = null;
    const asOptStr = (v: AnnotationValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
    const asOptNum = (v: AnnotationValue | undefined): number | undefined => (typeof v === "number" ? v : undefined);
    const asOptVal = (v: AnnotationValue | undefined): number | boolean | string | undefined =>
      typeof v === "number" || typeof v === "boolean" || typeof v === "string" ? v : undefined;

    for (const classMod of classMods) {
      // Check Interactive annotation
      let interMod = this.findModByName(classMod, "Interactive");
      if (!interMod) interMod = this.findModByName(classMod, "__OpenModelica_interactive");
      if (!interMod) interMod = this.findModByName(classMod, "__Dymola_interactive");

      if (interMod) {
        const parsed = asAnnotationRecord(this.parseMod(interMod, "Interactive"));
        const rawAction = parsed["type"] ?? parsed["action"];
        const action: InteractiveBinding["action"] = isInteractiveAction(rawAction) ? rawAction : "toggle";
        const binding: InteractiveBinding = {
          action,
          variableName,
          targetSelector: asOptStr(parsed["targetSelector"] ?? parsed["clickTarget"]),
          label: asOptStr(parsed["label"] ?? parsed["description"]),
          min: asOptNum(parsed["min"]),
          max: asOptNum(parsed["max"]),
          step: asOptNum(parsed["step"]),
          unit: asOptStr(parsed["unit"]),
          onValue: asOptVal(parsed["onValue"]),
          offValue: asOptVal(parsed["offValue"]),
          confirmPrompt: asOptStr(parsed["confirmPrompt"]),
        };
        this.interactiveBindings.push(binding);
        if (!foundBinding) foundBinding = binding;
      }

      // Check Dialog annotation
      const dialogMod = this.findModByName(classMod, "Dialog");
      if (dialogMod) {
        const parsed = asAnnotationRecord(this.parseMod(dialogMod, "Dialog"));
        const action: InteractiveBinding["action"] =
          parsed["min"] !== undefined && parsed["max"] !== undefined ? "slider" : "numeric";
        const selectorVal = parsed["selector"];
        const binding: InteractiveBinding = {
          action,
          variableName,
          label: asOptStr(parsed["description"] ?? parsed["label"]),
          min: asOptNum(parsed["min"]),
          max: asOptNum(parsed["max"]),
          step: asOptNum(parsed["step"]),
          unit: asOptStr(parsed["unit"]),
          options: Array.isArray(selectorVal)
            ? selectorVal.map((s) => ({
                label: String(s),
                value: typeof s === "number" || typeof s === "string" ? s : String(s),
              }))
            : undefined,
        };
        this.interactiveBindings.push(binding);
        if (!foundBinding) foundBinding = binding;
      }
    }

    return foundBinding;
  }

  private extractArgName(arg: AnnotationNodeLike | null | undefined): string | null {
    if (!arg) return null;
    if (typeof arg.name === "string") return arg.name;
    const fromParts = arg.name?.parts?.[0]?.identifier?.text ?? arg.name?.parts?.[0]?.text ?? arg.name?.text;
    if (fromParts) return fromParts;
    if (Cst.ElementModification.is(asSyntaxNode(arg))) {
      const n = Cst.ElementModification.name(asSyntaxNode(arg));
      if (n?.text) return n.text.trim();
    }
    const children = arg.children || arg.namedChildren;
    if (Array.isArray(children)) {
      const nameNode = children.find(
        (c) =>
          Cst.Identifier.is(asSyntaxNode(c)) ||
          Cst.Name.is(asSyntaxNode(c)) ||
          c.type === "identifier" ||
          c.type === "name",
      );
      if (nameNode) return nameNode.text?.trim() ?? null;
    }
    return null;
  }

  private matchesAnnotationName(target: string, query: string): boolean {
    if (!target || !query) return false;
    if (target === query) return true;
    const t = target.toLowerCase();
    const q = query.toLowerCase();
    if (t === q) return true;

    const aliases: Record<string, string[]> = {
      experiment: ["experiment"],
      webgpu: ["webgpu", "__modelscript_webgpu"],
      audioclock: ["audioclock", "audio_clock", "__modelscript_audio_clock"],
      sde: ["sde", "__modelscript_sde"],
      bvp: ["bvp", "__modelscript_bvp"],
      diffusion: ["diffusion", "__modelscript_diffusion"],
      surrogate: ["surrogate", "__modelscript_surrogate"],
      sysml: ["sysml"],
      owl: ["owl"],
      telemetry: ["telemetry"],
      feamesh: ["feamesh", "fea_mesh"],
      cfdflow: ["cfdflow", "cfd_flow"],
      evaluate: ["evaluate"],
      inline: ["inline"],
      hideresult: ["hideresult", "hide_result"],
      smoothorder: ["smoothorder", "smooth_order"],
      interactive: ["interactive", "__openmodelica_interactive", "__dymola_interactive"],
    };

    for (const [key, list] of Object.entries(aliases)) {
      if (key === q || list.includes(q)) {
        if (key === t || list.includes(t)) return true;
      }
    }
    return false;
  }

  private getArgumentsFromClassMod(classMod: AnnotationNodeLike | null | undefined): AnnotationNodeLike[] {
    if (!classMod) return [];
    if (classMod.modificationArguments) return classMod.modificationArguments;
    const result: AnnotationNodeLike[] = [];
    const walk = (node: AnnotationNodeLike | null | undefined) => {
      if (!node) return;
      if (Cst.ElementModification.is(asSyntaxNode(node))) {
        result.push(node);
        return;
      }
      const children = node.namedChildren || node.children || [];
      for (const child of children) {
        if (child.text === "(" || child.text === ")" || child.text === ",") continue;
        walk(child);
      }
    };
    walk(classMod);
    return result;
  }

  private findModByName(classMod: AnnotationNodeLike | null | undefined, name: string): AnnotationNodeLike | null {
    if (!classMod) return null;
    const args = this.getArgumentsFromClassMod(classMod);
    for (const arg of args) {
      const argName = this.extractArgName(arg);
      if (argName && this.matchesAnnotationName(argName, name)) return arg;
    }
    return null;
  }

  private parseMod(mod: AnnotationNodeLike, name: string): AnnotationValue {
    const result: AnnotationRecord = { "@type": name };
    const classMod = extractClassModNode(mod);

    if (classMod) {
      const args = this.getArgumentsFromClassMod(classMod);
      for (const arg of args) {
        const argName = this.extractArgName(arg);
        if (argName) {
          const mappedName = normalizeArgName(name, argName);
          const val = this.parseValue(arg, argName);
          const existing = result[mappedName];
          if (existing !== undefined) {
            if (Array.isArray(existing)) {
              existing.push(val);
            } else {
              result[mappedName] = [existing, val];
            }
          } else {
            result[mappedName] = val;
          }
        }
      }
    } else {
      const expr = extractModExprNode(mod);
      if (name === "graphics") {
        return this.parseGraphicsArray(expr);
      }
      const exprNode = asAnnotationNode(expr);
      if (exprNode && "functionReference" in exprNode) {
        return this.parseFunctionCall(exprNode, name);
      }
      if (expr) {
        return this.toJSON(evaluateCSTExpression(expr, this.scope));
      }
    }

    return result;
  }

  private parseValue(arg: AnnotationNodeLike, fallbackName: string): AnnotationValue {
    const argName = this.extractArgName(arg) ?? fallbackName;
    const classMod = extractClassModNode(arg);

    if (classMod) {
      return this.parseMod(arg, argName);
    }

    const expr = extractModExprNode(arg);
    if (!expr) return null;

    if (fallbackName === "graphics") {
      return this.parseGraphicsArray(expr);
    }

    const exprNode = asAnnotationNode(expr);
    if (exprNode && "functionReference" in exprNode) {
      return this.parseFunctionCall(exprNode, argName);
    }

    const evaluated = this.toJSON(evaluateCSTExpression(expr, this.scope));
    if (argName === "visible" && typeof evaluated !== "boolean") {
      return false;
    }
    return evaluated;
  }

  private extractCstFunctionArgs(node: AnnotationNodeLike): {
    named: [string, AnnotationNodeLike][];
    positional: AnnotationNodeLike[];
  } {
    const named: [string, AnnotationNodeLike][] = [];
    const positional: AnnotationNodeLike[] = [];

    const callArgs = node.children?.find((c) => Cst.FunctionCallArgs.is(asSyntaxNode(c)));
    if (!callArgs) return { named, positional };

    const walkArgs = (n: AnnotationNodeLike | null | undefined) => {
      if (!n) return;
      if (Cst.NamedArgument.is(asSyntaxNode(n))) {
        const identNode = n.children?.find((c) => Cst.Identifier.is(asSyntaxNode(c)));
        const funcArg = n.children?.find(
          (c) => Cst.FunctionArgument.is(asSyntaxNode(c)) || Cst.Expression.is(asSyntaxNode(c)),
        );
        if (identNode && funcArg) {
          named.push([identNode.text?.trim() ?? "", funcArg]);
        }
        return;
      }
      if (Cst.FunctionArgument.is(asSyntaxNode(n))) {
        const expr = n.children?.find((c) => Cst.Expression.is(asSyntaxNode(c))) ?? n;
        positional.push(expr);
        return;
      }
      for (const child of n.children || []) {
        walkArgs(child);
      }
    };
    walkArgs(callArgs);
    return { named, positional };
  }

  private parseFunctionCall(node: AnnotationNodeLike, propertyName?: string): AnnotationValue {
    let funcName = "Unknown";
    if (node.functionReference) {
      const funcNameParts = node.functionReference.parts?.map((p) =>
        typeof p === "string" ? p : (p.identifier?.text ?? p.name ?? p.text ?? ""),
      );
      funcName =
        funcNameParts && funcNameParts.length > 0 ? (funcNameParts[funcNameParts.length - 1] ?? "Unknown") : "Unknown";
    } else {
      const compRef =
        node.children?.find((c) => Cst.ComponentReference.is(asSyntaxNode(c))) ??
        (Cst.ComponentReference.is(asSyntaxNode(node)) ? node : null);
      if (compRef) {
        funcName = compRef.text?.trim() ?? "Unknown";
      } else {
        const ident = node.children?.find((c) => Cst.Identifier.is(asSyntaxNode(c)));
        if (ident) funcName = ident.text?.trim() ?? "Unknown";
      }
    }

    if (funcName === "DynamicSelect") {
      const posArgs = node.functionCallArguments?.arguments ?? [];
      const firstPos = posArgs[0];
      if (posArgs.length > 0 && firstPos && "expression" in firstPos && firstPos.expression !== undefined) {
        const staticVal = this.parseValueForExpr(firstPos.expression, propertyName);
        const secondPos = posArgs[1];
        if (posArgs.length > 1 && secondPos && "expression" in secondPos && secondPos.expression !== undefined) {
          const dynExpr = secondPos.expression;
          const dynNode = asAnnotationNode(dynExpr);
          const varName =
            dynNode?.text ?? dynNode?.identifier?.text ?? (typeof dynNode?.name === "string" ? dynNode.name : "");
          this.dynamicBindings.push({
            property: propertyName,
            staticExpr: staticVal,
            dynamicExpr: dynExpr,
            variableName: varName,
          });
        }
        return staticVal;
      }
      const rawArgs = this.extractCstFunctionArgs(node);
      if (rawArgs.positional.length > 0) {
        const staticVal = this.parseValueForExpr(rawArgs.positional[0], propertyName);
        if (rawArgs.positional.length > 1 && rawArgs.positional[1]) {
          const dynExpr = rawArgs.positional[1];
          const varName = dynExpr.text?.trim() ?? "";
          this.dynamicBindings.push({
            property: propertyName,
            staticExpr: staticVal,
            dynamicExpr: dynExpr,
            variableName: varName,
          });
        }
        return staticVal;
      }
      return null;
    }

    const obj: AnnotationRecord = { "@type": funcName };

    // Named arguments (AST)
    if (node.functionCallArguments?.namedArguments) {
      for (const arg of node.functionCallArguments.namedArguments) {
        const argIdent = arg.identifier?.text ?? arg.name;
        if (argIdent && arg.argument?.expression !== undefined) {
          const argName = normalizeArgName(funcName, argIdent);
          obj[argName] = this.parseValueForExpr(arg.argument.expression, argName);
        }
      }
    } else {
      // Named arguments (CST)
      const rawArgs = this.extractCstFunctionArgs(node);
      for (const [argIdent, argExpr] of rawArgs.named) {
        const argName = normalizeArgName(funcName, argIdent);
        obj[argName] = this.parseValueForExpr(argExpr, argName);
      }
      // Positional arguments (CST)
      if (rawArgs.positional.length > 0) {
        applyPositionalArguments(
          obj,
          funcName,
          rawArgs.positional.map((p) => evaluateCSTExpression(p, this.scope)),
        );
      }
    }

    // Positional arguments (AST)
    const posArgs = node.functionCallArguments?.arguments ?? [];
    if (posArgs.length > 0) {
      applyPositionalArguments(
        obj,
        funcName,
        posArgs.map((p) =>
          evaluateCSTExpression("expression" in p && p.expression !== undefined ? p.expression : p, this.scope),
        ),
      );
    }

    // Fallback: extract points if not resolved
    if (
      obj["points"] === undefined &&
      node.text &&
      (funcName === "Polygon" || funcName === "Line" || node.text.includes("points="))
    ) {
      const recovered = extractPointsFromText(node.text);
      if (recovered) {
        obj["points"] = recovered;
      }
    }

    return obj;
  }

  private parseValueForExpr(expr: unknown, propName?: string): AnnotationValue {
    const startNode = asAnnotationNode(expr);
    if (!startNode) return null;
    let unwrapped: AnnotationNodeLike = startNode;
    while (unwrapped) {
      if (
        Cst.FunctionArgument.is(asSyntaxNode(unwrapped)) ||
        Cst.Expression.is(asSyntaxNode(unwrapped)) ||
        Cst.ModificationExpression.is(asSyntaxNode(unwrapped))
      ) {
        if (Array.isArray(unwrapped.children) && unwrapped.children.length === 1 && unwrapped.children[0]) {
          unwrapped = unwrapped.children[0];
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if ("functionReference" in unwrapped) return this.parseFunctionCall(unwrapped, propName);
    if (Cst.Primary.is(asSyntaxNode(unwrapped))) {
      const compRef = unwrapped.children?.find((c) => Cst.ComponentReference.is(asSyntaxNode(c)));
      const callArgs = unwrapped.children?.find((c) => Cst.FunctionCallArgs.is(asSyntaxNode(c)));
      if (compRef && callArgs) return this.parseFunctionCall(unwrapped, propName);
    }
    const evaluated = this.toJSON(evaluateCSTExpression(unwrapped, this.scope));
    if (propName === "visible" && typeof evaluated !== "boolean") {
      return false;
    }
    return evaluated;
  }

  private parseGraphicsArray(expr: unknown): AnnotationValue[] {
    const graphics: AnnotationValue[] = [];
    const walkGraphics = (nodeInput: unknown) => {
      const node = asAnnotationNode(nodeInput);
      if (!node) return;
      if ("functionReference" in node) {
        graphics.push(this.parseFunctionCall(node));
        return;
      }
      if (Cst.Primary.is(asSyntaxNode(node))) {
        const compRef = node.children?.find((c) => Cst.ComponentReference.is(asSyntaxNode(c)));
        const callArgs = node.children?.find((c) => Cst.FunctionCallArgs.is(asSyntaxNode(c)));
        if (compRef && callArgs) {
          graphics.push(this.parseFunctionCall(node));
          return;
        }
      }
      if ("expressionLists" in node && Array.isArray(node.expressionLists)) {
        for (const list of node.expressionLists) {
          for (const e of list.expressions ?? []) {
            if (e) walkGraphics(e);
          }
        }
        return;
      }
      if ("expressionList" in node) {
        for (const e of node.expressionList?.expressions ?? []) {
          if (e) walkGraphics(e);
        }
        return;
      }
      const children = node.children || node.namedChildren;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child.text === "{" || child.text === "}" || child.text === ",") continue;
          walkGraphics(child);
        }
      }
    };
    walkGraphics(expr);
    return graphics;
  }

  private toJSON(val: unknown): AnnotationValue {
    if (val === null || val === undefined) return null;
    if (typeof val === "number" || typeof val === "boolean" || typeof val === "string") return val;
    if (Array.isArray(val)) return val.map((e) => this.toJSON(e));
    if (typeof val === "object" && "elements" in val && (val as { elements?: unknown }).elements instanceof Map) {
      const obj: AnnotationRecord = {};
      for (const [k, v] of (val as { elements: Map<string, unknown> }).elements.entries()) {
        obj[k] = this.toJSON(v);
      }
      return obj;
    }
    return null;
  }
}

export function extractPointsFromText(text: string): [number, number][] | null {
  let startBrace = -1;
  let idx = 0;
  while (idx <= text.length - 6) {
    const pos = text.indexOf("points", idx);
    if (pos < 0) break;
    const prevOk = pos === 0 || !isAsciiIdentContinue(text.charCodeAt(pos - 1));
    const afterWord = pos + 6;
    const nextOk = afterWord >= text.length || !isAsciiIdentContinue(text.charCodeAt(afterWord));
    if (prevOk && nextOk) {
      let j = afterWord;
      while (j < text.length && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
      if (text[j] === "=") {
        j++;
        while (j < text.length && isAsciiWhitespaceCode(text.charCodeAt(j))) j++;
        if (text[j] === "{") {
          startBrace = j;
          break;
        }
      }
    }
    idx = pos + 1;
  }
  if (startBrace === -1) return null;
  let depth = 0;
  let endBrace = -1;
  for (let i = startBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        endBrace = i;
        break;
      }
    }
  }
  const inner = text.substring(startBrace, endBrace === -1 ? text.length : endBrace + 1);
  const parsed = parseModelicaArrayLiteral(inner);
  if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
    return parsed as [number, number][];
  }
  return null;
}
