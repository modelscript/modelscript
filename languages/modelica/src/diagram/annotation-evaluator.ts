// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Cst } from "../../src-gen/bindings.js";
import { resolveModelicaConstant } from "../constants.js";
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

// ── Safe Arithmetic Evaluator ───────────────────────────────────────────────

import { evalArithmeticString } from "../flattener/expressions/cst-utils.js";

/**
 * Evaluates safe arithmetic expressions, delegating to the unified
 * canonical arithmetic string evaluator in cst-utils.
 */
export function evalSafeArithmetic(exprStr: string): number | null {
  if (!exprStr) return null;
  return evalArithmeticString(exprStr, true);
}

// ── Value & Scope Extraction Helpers ────────────────────────────────────────

const activeNameResolutions = new Set<string>();

function findNamedModExprInClassMod(classMod: any, targetName: string): any {
  if (!classMod || !targetName) return null;
  if (Array.isArray(classMod.modificationArguments)) {
    for (const arg of classMod.modificationArguments) {
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
  const walk = (node: any): any => {
    if (!node) return null;
    if (
      Cst.ElementModification.is(node) ||
      node.type === "element_modification" ||
      node.type === "ElementModification"
    ) {
      let modName: string | null = null;
      if (Cst.ElementModification.is(node)) {
        const n = Cst.ElementModification.name(node);
        if (n?.text) modName = n.text.trim();
      }
      if (!modName) {
        const children = node.children || node.namedChildren;
        if (Array.isArray(children)) {
          const nameNode = children.find(
            (c: any) => Cst.Identifier.is(c) || Cst.Name.is(c) || c.type === "identifier" || c.type === "name",
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
  return walk(classMod);
}

function extractModExprFromCstNode(node: any, targetArgName?: string): any {
  if (!node) return null;
  let curr = node;
  while (
    curr &&
    (Cst.Identifier.is(curr) ||
      Cst.Name.is(curr) ||
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
    (Cst.Declaration.is(curr) || curr.type === "declaration" || curr.type === "Declaration") &&
    curr.parent &&
    (Cst.ComponentDeclaration.is(curr.parent) ||
      curr.parent.type === "component_declaration" ||
      curr.parent.type === "ComponentDeclaration")
  ) {
    curr = curr.parent;
  }

  const decl =
    (Cst.ComponentDeclaration.is(curr) ? Cst.ComponentDeclaration.declaration(curr) : null) ??
    curr.children?.find((c: any) => Cst.Declaration.is(c) || c.type === "declaration" || c.type === "Declaration") ??
    curr;

  const modNode =
    decl?.modification ??
    curr?.modification ??
    (Cst.Declaration.is(decl) ? Cst.Declaration.modification(decl) : null) ??
    decl?.children?.find(
      (c: any) => Cst.Modification.is(c) || c.type === "modification" || c.type === "Modification",
    ) ??
    curr?.children?.find((c: any) => Cst.Modification.is(c) || c.type === "modification" || c.type === "Modification");

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

function findExtendsModExprInClassCst(classCstNode: any, targetArgName: string): any {
  if (!classCstNode || !targetArgName) return null;
  const walk = (node: any, depth: number): any => {
    if (!node || depth > 6) return null;
    if (Cst.ExtendsClause.is(node) || node.type === "extends_clause" || node.type === "ExtendsClause") {
      const classMod = extractClassModNode(node);
      if (classMod) {
        const found = findNamedModExprInClassMod(classMod, targetArgName);
        if (found) return found;
      }
      return null;
    }
    // Do not descend into nested class definitions
    if (
      depth > 0 &&
      (Cst.ClassDefinition.is(node) || node.type === "class_definition" || node.type === "ClassDefinition")
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

function evaluateRawOrCstExpr(expr: any, evalScope?: any): any {
  if (expr == null) return undefined;
  if (typeof expr === "number" || typeof expr === "boolean") return expr;
  if (typeof expr === "string") {
    const t = expr.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t) && !isNaN(Number(t))) return parseFloat(t);
    return t;
  }
  if (typeof expr.value === "number" || typeof expr.value === "boolean" || typeof expr.value === "string") {
    return evaluateRawOrCstExpr(expr.value, evalScope);
  }
  if (typeof expr.text === "string" && !Array.isArray(expr.children)) {
    const t = expr.text.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t) && !isNaN(Number(t))) return parseFloat(t);
    const resolved = resolveAnnotationName(t, evalScope);
    if (resolved !== undefined) return resolved;
  }
  const val = evaluateCSTExpression(expr, evalScope);
  return val !== null ? val : undefined;
}

function extractEvaluatedValue(resolved: any, evalScope?: any): any {
  if (resolved == null) return undefined;
  if (typeof resolved === "number" || typeof resolved === "boolean" || typeof resolved === "string") {
    return resolved;
  }
  if (typeof resolved.value === "number" || typeof resolved.value === "boolean" || typeof resolved.value === "string") {
    return resolved.value;
  }
  const mod = resolved.modification;
  if (mod) {
    let expr =
      mod.evaluatedExpression ?? mod.expression ?? mod.modificationExpression?.expression ?? mod.bindingExpression;
    if (expr == null && typeof mod.getModificationArgument === "function") {
      const startArg = mod.getModificationArgument("start");
      expr = startArg?.expression ?? startArg?.value;
    }
    if (expr != null) {
      const val = evaluateRawOrCstExpr(expr, resolved.parent ?? evalScope);
      if (val !== undefined) return val;
    }
  }

  const symId = resolved.id ?? resolved.declaration?.id ?? resolved.entry?.id;
  const db =
    resolved.db ??
    resolved.parent?.db ??
    evalScope?.db ??
    evalScope?.classInstance?.db ??
    (typeof evalScope?.query === "function" ? evalScope : null);

  const cstNode =
    resolved.cstNode ??
    resolved.abstractSyntaxNode ??
    resolved.declaration?.cstNode ??
    (symId !== undefined && typeof db?.cstNode === "function" ? db.cstNode(symId) : null);
  if (cstNode) {
    const exprNode = extractModExprFromCstNode(cstNode);
    if (exprNode) {
      const val = evaluateRawOrCstExpr(exprNode, resolved.parent ?? evalScope);
      if (val !== undefined && val !== resolved.name) return val;
    }
  }

  if (symId !== undefined && typeof db?.query === "function") {
    try {
      const effMod = db.query("effectiveModification", symId);
      if (effMod) {
        let bindExpr = effMod.bindingExpression;
        if (bindExpr == null && Array.isArray(effMod.args)) {
          const startArg = effMod.args.find((a: any) => a?.name === "start");
          bindExpr = startArg?.value ?? startArg?.expression;
        }
        if (bindExpr != null) {
          const val = evaluateRawOrCstExpr(bindExpr, resolved.parent ?? evalScope);
          if (val !== undefined && val !== resolved.name) return val;
        }
      }
    } catch {}
  }

  return undefined;
}

function resolveAnnotationName(name: string, evalScope: any): any {
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
      const mod = compInst.modification;
      if (mod) {
        if (typeof mod.getModificationArgument === "function") {
          const modArg = mod.getModificationArgument(trimmed);
          if (modArg !== undefined) {
            const val = extractEvaluatedValue(modArg, compInst.parent ?? evalScope);
            if (val !== undefined && val !== trimmed) return val;
          }
        }
        const argsList = mod.arguments ?? mod.args;
        if (Array.isArray(argsList)) {
          const foundArg = argsList.find((a: any) => a?.name === trimmed);
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
      const compCst = compInst.cstNode ?? compInst.abstractSyntaxNode ?? compInst.declaration?.cstNode;
      if (compCst) {
        const modExpr = extractModExprFromCstNode(compCst, trimmed);
        if (modExpr) {
          const val = evaluateRawOrCstExpr(modExpr, compInst.parent ?? evalScope);
          if (val !== undefined && val !== trimmed) return val;
        }
      }
      const compSymId = compInst.id ?? compInst.declaration?.id ?? compInst.entry?.id;
      const compDb =
        compInst.db ?? compInst.parent?.db ?? evalScope.db ?? evalScope.classInstance?.db ?? compInst.classInstance?.db;
      if (compSymId !== undefined && typeof compDb?.query === "function") {
        try {
          const effMod = compDb.query("effectiveModification", compSymId);
          if (effMod?.args) {
            const foundArg = Array.isArray(effMod.args)
              ? effMod.args.find((a: any) => a?.name === trimmed)
              : effMod.args.get?.(trimmed);
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

    // 5. Resolve via Scope Hierarchy (QueryDB / ModelicaClassInstance / parent class)
    const candidateScopes: any[] = [];
    for (const s of [
      evalScope,
      evalScope.classInstance,
      evalScope.componentInstance?.classInstance,
      evalScope.parent,
    ]) {
      if (s && !candidateScopes.includes(s)) candidateScopes.push(s);
    }

    // 5a. Check extends_clause modifications in the class hierarchy (e.g. `extends ConditionalHeatPort(useHeatPort=true)`)
    const visitedClasses = new Set<any>();
    const checkExtendsMods = (cls: any): any => {
      if (!cls || visitedClasses.has(cls)) return undefined;
      visitedClasses.add(cls);
      const clsCst = cls.cstNode ?? cls.abstractSyntaxNode;
      if (clsCst) {
        const extModExpr = findExtendsModExprInClassCst(clsCst, trimmed);
        if (extModExpr) {
          const val = evaluateRawOrCstExpr(extModExpr, cls);
          if (val !== undefined && val !== trimmed) return val;
        }
      }
      if (Array.isArray(cls.extendsClassInstances)) {
        for (const ext of cls.extendsClassInstances) {
          if (ext?.cstNode) {
            const extModExpr = extractModExprFromCstNode(ext.cstNode, trimmed);
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
      const extVal = checkExtendsMods(scope);
      if (extVal !== undefined) return extVal;
    }

    for (const scope of candidateScopes) {
      // Direct method resolveSimpleName (mock objects or legacy classes)
      if (typeof scope.resolveSimpleName === "function") {
        const resolved = scope.resolveSimpleName(trimmed);
        if (resolved != null) {
          const val = extractEvaluatedValue(resolved, scope);
          if (val !== undefined) return val;
        }
      }

      // Salsa QueryDB (has .query and .byName)
      if (typeof scope.query === "function") {
        const scopeId = scope.currentClassId ?? scope.id;
        if (scopeId !== undefined) {
          try {
            const resolver = scope.query("resolveSimpleName", scopeId);
            if (typeof resolver === "function") {
              const sym = resolver(trimmed);
              if (sym != null) {
                const val = extractEvaluatedValue(sym, scope);
                if (val !== undefined) return val;
              }
            }
          } catch {}
        }
        if (typeof scope.byName === "function") {
          const syms = scope.byName(trimmed);
          if (syms && syms.length > 0) {
            const val = extractEvaluatedValue(syms[0], scope);
            if (val !== undefined) return val;
          }
        }
      }

      // ModelicaClassInstance (with resolveName or components / elements list)
      if (typeof scope.resolveName === "function") {
        const resolved = scope.resolveName(parts);
        if (resolved != null) {
          const val = extractEvaluatedValue(resolved, scope);
          if (val !== undefined) return val;
        }
      }

      const findInClassHierarchy = (cls: any, seen = new Set<any>()): any => {
        if (!cls || seen.has(cls)) return undefined;
        seen.add(cls);
        if (Array.isArray(cls.components)) {
          const comp = cls.components.find((c: any) => c.name === trimmed);
          if (comp != null) {
            const val = extractEvaluatedValue(comp, cls);
            if (val !== undefined) return val;
          }
        }
        if (Array.isArray(cls.elements)) {
          const elem = cls.elements.find((e: any) => e.name === trimmed);
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
      if (hierarchyVal !== undefined) return hierarchyVal;
    }

    return undefined;
  } finally {
    activeNameResolutions.delete(trimmed);
  }
}

// ── Array & Matrix Literal Parser ───────────────────────────────────────────

export function parseModelicaArrayLiteral(text: string, evalScope?: any): any[] {
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
      return item.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (/^[+-]?\d+$/.test(item)) {
      return parseInt(item, 10);
    }
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(item) && !isNaN(Number(item))) {
      return parseFloat(item);
    }
    if (item === "true") return true;
    if (item === "false") return false;

    // Check safe arithmetic expressions (e.g. 10 + 20, -50 + 5)
    if (/^[0-9+\-*/().\s^eE]+$/.test(item)) {
      const arith = evalSafeArithmetic(item);
      if (arith !== null) return arith;
    }

    const resolved = resolveAnnotationName(item, evalScope);
    if (resolved !== undefined) return resolved;

    return item;
  });
}

// ── CST Array and Matrix Extraction Helpers ─────────────────────────────────

function extractCSTArrayElements(node: any): any[] {
  const elements: any[] = [];
  const walk = (n: any) => {
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

function extractCSTMatrixRows(node: any): any[][] | null {
  if (!Array.isArray(node.children)) return null;
  const hasSemicolon = node.children.some((c: any) => c.type === ";" || c.text === ";");
  if (!hasSemicolon) return null;
  const rows: any[][] = [];
  let currentRow: any[] = [];
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

export function evaluateCSTExpression(node: any, evalScope?: any): any {
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
    if (Array.isArray(node.children) && node.children.length === 1) {
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
    return rawText.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (/^[+-]?\d+$/.test(rawText)) {
    return parseInt(rawText, 10);
  }
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawText) && !isNaN(Number(rawText))) {
    return parseFloat(rawText);
  }

  // 1. Array / Matrix evaluation directly on CST
  if (Array.isArray(node.children) && node.children.length >= 2) {
    const firstText = (node.children[0].text ?? node.children[0].type)?.trim();
    const lastText = (
      node.children[node.children.length - 1].text ?? node.children[node.children.length - 1].type
    )?.trim();
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
    (node.children[0].type === "(" || node.children[0].text === "(") &&
    (node.children[2].type === ")" || node.children[2].text === ")")
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
    const op = node.children[0].text?.trim();
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
  let leftNode: any = null;
  let rightNode: any = null;
  let binaryOp: any = null;

  if (("operand1" in node || "left" in node) && ("operand2" in node || "right" in node)) {
    leftNode = node.operand1 ?? node.left;
    rightNode = node.operand2 ?? node.right;
    binaryOp = node.operator;
  } else if (Array.isArray(node.children) && node.children.length === 3) {
    const opText = node.children[1].text?.trim();
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
  if (Array.isArray(node.children) && node.children.length >= 6 && node.children[0].text === "if") {
    const thenIdx = node.children.findIndex((c: any) => c.text === "then");
    const elseIdx = node.children.findIndex((c: any) => c.text === "else");
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
      .map((p: any) => p.identifier?.text ?? p.name ?? p.text ?? (typeof p === "string" ? p : ""))
      .filter(Boolean);
    if (!parts || parts.length === 0) return null;
    const fullName = parts.join(".");
    const resolved = resolveAnnotationName(fullName, evalScope);
    if (resolved !== undefined) return resolved;
    if (parts.length > 1) {
      let current = resolveAnnotationName(parts[0], evalScope);
      for (let i = 1; i < parts.length; i++) {
        if (current == null) return null;
        if (typeof current.resolveSimpleName === "function") {
          current = current.resolveSimpleName(parts[i]);
          if (current?.modification) {
            const expr = current.modification.evaluatedExpression ?? current.modification.expression;
            if (expr != null && (typeof expr === "number" || typeof expr === "boolean" || typeof expr === "string")) {
              current = expr;
            }
          }
        } else {
          return null;
        }
      }
      return current;
    }
    return null;
  }

  // 7. Array Expression Lists
  if ("expressionList" in node) {
    const elements = node.expressionList?.expressions ?? [];
    return elements.map((e: any) => evaluateCSTExpression(e, evalScope));
  }
  if ("expressionLists" in node && Array.isArray(node.expressionLists)) {
    const result: any[] = [];
    for (const list of node.expressionLists) {
      const row = (list.expressions ?? []).map((e: any) => evaluateCSTExpression(e, evalScope));
      result.push(row);
    }
    return result.length === 1 ? result[0] : result;
  }

  // 8. Function Calls & Built-in Math Functions (CST & AST)
  let funcName: string | null = null;
  let funcArgs: any[] = [];
  if ("functionReference" in node) {
    const funcNameParts = node.functionReference?.parts?.map((p: any) => p.identifier?.text ?? p.name ?? p.text ?? p);
    funcName = funcNameParts ? funcNameParts[funcNameParts.length - 1] : null;
    const posArgs = node.functionCallArguments?.arguments ?? [];
    funcArgs = posArgs.map((a: any) => a.expression ?? a);
  } else if (node.type === "primary" || node.type === "function_call") {
    const compRef = node.children?.find(
      (c: any) => c.type === "component_reference" || c.type === "ComponentReference",
    );
    if (compRef) {
      funcName = compRef.text?.trim() ?? null;
      const callArgs = node.children?.find(
        (c: any) => c.type === "function_call_args" || c.type === "FunctionCallArgs",
      );
      if (callArgs) {
        const extracted: any[] = [];
        const walkCallArgs = (n: any) => {
          if (!n) return;
          if (n.type === "function_argument" || n.type === "FunctionArgument") {
            const expr = n.children?.find((c: any) => c.type === "expression" || c.type === "Expression") ?? n;
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
  if (rawText && /^[0-9+\-*/().\s^eE]+$/.test(rawText)) {
    const arith = evalSafeArithmetic(rawText);
    if (arith !== null) return arith;
  }

  return null;
}

// ── Condition Attribute Evaluator ───────────────────────────────────────────

export function evaluateCondition(component: any, parentContext?: any): boolean | undefined {
  let node = component?.cstNode ?? component?.abstractSyntaxNode ?? component?.declaration?.cstNode;
  if (!node && component?.id != null) {
    const db = component.db ?? component.parent?.db ?? parentContext?.db ?? parentContext?.classInstance?.db;
    if (typeof db?.cstNode === "function") {
      try {
        node = db.cstNode(component.id);
      } catch {}
    }
  }
  if (!node) return true;

  while (
    node &&
    !Cst.ComponentDeclaration.is(node) &&
    !Cst.ComponentClause.is(node) &&
    !("conditionAttribute" in node) &&
    node.parent &&
    (Cst.Declaration.is(node) ||
      Cst.Identifier.is(node) ||
      node.type === "declaration" ||
      node.type === "Declaration" ||
      node.type === "identifier" ||
      node.type === "Identifier" ||
      Cst.ComponentDeclaration.is(node.parent))
  ) {
    node = node.parent;
  }

  let condition: any = null;
  if ("conditionAttribute" in node) {
    condition = node.conditionAttribute?.condition;
  } else if (Cst.ComponentDeclaration.is(node)) {
    const condAttr = node.children?.find((c: any) => Cst.ConditionAttribute.is(c));
    condition = condAttr?.children?.find((c: any) => Cst.Expression.is(c)) ?? condAttr?.children?.[1];
  } else if (Cst.ComponentClause.is(node)) {
    const condAttr = node.children?.find((c: any) => Cst.ConditionAttribute.is(c));
    condition = condAttr?.children?.find((c: any) => Cst.Expression.is(c)) ?? condAttr?.children?.[1];
  }
  if (!condition && node.parent && (Cst.ComponentDeclaration.is(node.parent) || Cst.ComponentClause.is(node.parent))) {
    const condAttr = node.parent.children?.find((c: any) => Cst.ConditionAttribute.is(c));
    condition = condAttr?.children?.find((c: any) => Cst.Expression.is(c)) ?? condAttr?.children?.[1];
  }
  if (!condition) return true;

  const scope =
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

function extractClassModNode(node: any): any {
  if (!node) return null;
  return (
    node.modification?.classModification ??
    node.classModification ??
    node.children?.find((c: any) => Cst.ClassModification.is(c)) ??
    node.children?.find((c: any) => Cst.Modification.is(c))?.children?.find((c: any) => Cst.ClassModification.is(c)) ??
    null
  );
}

function extractModExprNode(node: any): any {
  if (!node) return null;
  return (
    node.modification?.modificationExpression?.expression ??
    node.modification?.expression ??
    node.expression ??
    node.children?.find((c: any) => Cst.ModificationExpression.is(c) || Cst.Expression.is(c)) ??
    node.children
      ?.find((c: any) => Cst.Modification.is(c))
      ?.children?.find((c: any) => Cst.ModificationExpression.is(c) || Cst.Expression.is(c)) ??
    null
  );
}

function applyPositionalArguments(obj: any, funcName: string, positionalValues: any[]): void {
  let valIdx = 0;
  if (valIdx < positionalValues.length && typeof positionalValues[valIdx] === "boolean" && obj.visible === undefined) {
    obj.visible = positionalValues[valIdx++];
  }
  if (valIdx < positionalValues.length && Array.isArray(positionalValues[valIdx])) {
    const arr = positionalValues[valIdx++];
    if (funcName === "Line" || funcName === "Polygon") {
      if (obj.points === undefined) obj.points = arr;
    } else if (funcName === "Rectangle" || funcName === "Ellipse" || funcName === "Text" || funcName === "Bitmap") {
      if (obj.extent === undefined) obj.extent = arr;
    }
  }
  if (valIdx < positionalValues.length) {
    const nextVal = positionalValues[valIdx];
    if (typeof nextVal === "string") {
      if (funcName === "Text" && obj.textString === undefined && obj.string === undefined) {
        obj.textString = nextVal;
        obj.string = nextVal;
        valIdx++;
      } else if (funcName === "Bitmap" && obj.fileName === undefined) {
        obj.fileName = nextVal;
        valIdx++;
      }
    }
  }
  while (valIdx < positionalValues.length) {
    const extraVal = positionalValues[valIdx++];
    if (Array.isArray(extraVal) && extraVal.length === 3 && typeof extraVal[0] === "number") {
      if ((funcName === "Line" || funcName === "Polygon") && obj.color === undefined && obj.lineColor === undefined) {
        obj.color = extraVal;
        obj.lineColor = extraVal;
      } else if (obj.fillColor === undefined) {
        obj.fillColor = extraVal;
      }
    }
  }
}

export class AnnotationEvaluator {
  private scope: any;
  public dynamicBindings: {
    property?: string | undefined;
    staticExpr: any;
    dynamicExpr: any;
    variableName?: string | undefined;
  }[] = [];
  public interactiveBindings: {
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
  }[] = [];

  constructor(evalScope?: any | null) {
    this.scope = evalScope ?? null;
  }

  public evaluate(ast: any, name: string): any {
    if (!ast) return null;
    if (typeof ast.text === "string") {
      const hasAnnotation =
        ast.text.includes("annotation") ||
        (ast.parent &&
          ast.parent.type !== "class_definition" &&
          ast.parent.type !== "composition" &&
          ast.parent.type !== "stored_definition" &&
          typeof ast.parent.text === "string" &&
          ast.parent.text.includes("annotation")) ||
        (ast.nextNamedSibling &&
          typeof ast.nextNamedSibling.text === "string" &&
          ast.nextNamedSibling.text.includes("annotation"));
      if (!hasAnnotation) {
        return null;
      }
    }

    const classMods = this.extractAllClassModifications(ast);
    if (classMods.length === 0) return null;

    let mergedResult: any = null;
    for (const classMod of classMods) {
      const layerMod = this.findModByName(classMod, name);
      if (layerMod) {
        const parsed = this.parseMod(layerMod, name);
        if (parsed) {
          if (!mergedResult) {
            mergedResult = parsed;
          } else if (typeof parsed === "object" && typeof mergedResult === "object") {
            Object.assign(mergedResult, parsed);
          }
        }
      }
    }

    if (mergedResult && typeof mergedResult === "object" && this.dynamicBindings.length > 0) {
      mergedResult.dynamicBindings = [...this.dynamicBindings];
    }

    return mergedResult;
  }

  /**
   * Discovers and extracts all classModification containers associated with the node.
   * Handles multiple annotation(...) clauses at the class or component level.
   */
  public extractAllClassModifications(ast: any): any[] {
    if (!ast) return [];
    const clauses: any[] = [];
    this.findAllAnnotationClauses(ast, 0, clauses);

    // Fallbacks for inner declarations: check parent and next sibling
    if (
      clauses.length === 0 &&
      ast.parent &&
      ast.parent.type !== "class_definition" &&
      ast.parent.type !== "composition" &&
      ast.parent.type !== "stored_definition"
    ) {
      this.findAllAnnotationClauses(ast.parent, 0, clauses);
    }
    if (clauses.length === 0 && ast.nextNamedSibling) {
      const sib = ast.nextNamedSibling;
      if (Cst.AnnotationClause.is(sib)) {
        clauses.push(sib);
      }
    }

    const classMods: any[] = [];
    if (ast.classModification) classMods.push(ast.classModification);
    if (ast.annotationClause?.classModification) classMods.push(ast.annotationClause.classModification);

    for (const ann of clauses) {
      if (ann.classModification) {
        classMods.push(ann.classModification);
        continue;
      }
      const children = ann.children || ann.namedChildren;
      if (Array.isArray(children)) {
        const cm = children.find((c: any) => Cst.ClassModification.is(c));
        if (cm) {
          classMods.push(cm);
          continue;
        }
      }
      classMods.push(ann);
    }

    return classMods;
  }

  private findAllAnnotationClauses(node: any, depth = 0, collected: any[] = []): any[] {
    if (!node || depth > 8) return collected;
    if (Cst.AnnotationClause.is(node)) {
      collected.push(node);
      return collected;
    }
    const children = node.children || node.namedChildren;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (Cst.AnnotationClause.is(child)) {
          collected.push(child);
        } else {
          this.findAllAnnotationClauses(child, depth + 1, collected);
        }
      }
    }
    return collected;
  }

  /**
   * Evaluates Interactive(...) or Dialog(...) annotations on a component or parameter.
   */
  public evaluateInteractive(ast: any, variableName: string): any {
    const classMods = this.extractAllClassModifications(ast);
    if (classMods.length === 0) return null;

    let foundBinding: any = null;

    for (const classMod of classMods) {
      // Check Interactive annotation
      let interMod = this.findModByName(classMod, "Interactive");
      if (!interMod) interMod = this.findModByName(classMod, "__OpenModelica_interactive");
      if (!interMod) interMod = this.findModByName(classMod, "__Dymola_interactive");

      if (interMod) {
        const parsed = this.parseMod(interMod, "Interactive");
        const action = parsed.type ?? parsed.action ?? "toggle";
        const binding: any = {
          action,
          variableName,
          targetSelector: parsed.targetSelector ?? parsed.clickTarget,
          label: parsed.label ?? parsed.description,
          min: parsed.min,
          max: parsed.max,
          step: parsed.step,
          unit: parsed.unit,
          onValue: parsed.onValue,
          offValue: parsed.offValue,
          confirmPrompt: parsed.confirmPrompt,
        };
        this.interactiveBindings.push(binding);
        if (!foundBinding) foundBinding = binding;
      }

      // Check Dialog annotation
      const dialogMod = this.findModByName(classMod, "Dialog");
      if (dialogMod) {
        const parsed = this.parseMod(dialogMod, "Dialog");
        const action = parsed.min !== undefined && parsed.max !== undefined ? "slider" : "numeric";
        const binding: any = {
          action,
          variableName,
          label: parsed.description ?? parsed.label,
          min: parsed.min,
          max: parsed.max,
          step: parsed.step,
          unit: parsed.unit,
          options: parsed.selector
            ? Array.isArray(parsed.selector)
              ? parsed.selector.map((s: any) => ({ label: String(s), value: s }))
              : undefined
            : undefined,
        };
        this.interactiveBindings.push(binding);
        if (!foundBinding) foundBinding = binding;
      }
    }

    return foundBinding;
  }

  private extractArgName(arg: any): string | null {
    if (!arg) return null;
    if (typeof arg.name === "string") return arg.name;
    const fromParts = arg.name?.parts?.[0]?.identifier?.text ?? arg.name?.parts?.[0]?.text ?? arg.name?.text;
    if (fromParts) return fromParts;
    if (Cst.ElementModification.is(arg)) {
      const n = Cst.ElementModification.name(arg);
      if (n?.text) return n.text.trim();
    }
    const children = arg.children || arg.namedChildren;
    if (Array.isArray(children)) {
      const nameNode = children.find(
        (c: any) => Cst.Identifier.is(c) || Cst.Name.is(c) || c.type === "identifier" || c.type === "name",
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

  private getArgumentsFromClassMod(classMod: any): any[] {
    if (!classMod) return [];
    if (classMod.modificationArguments) return classMod.modificationArguments;
    const result: any[] = [];
    const walk = (node: any) => {
      if (!node) return;
      if (Cst.ElementModification.is(node)) {
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

  private findModByName(classMod: any, name: string): any {
    if (!classMod) return null;
    const args = this.getArgumentsFromClassMod(classMod);
    for (const arg of args) {
      const argName = this.extractArgName(arg);
      if (argName && this.matchesAnnotationName(argName, name)) return arg;
    }
    return null;
  }

  private parseMod(mod: any, name: string): any {
    const result: any = { "@type": name };
    const classMod = extractClassModNode(mod);

    if (classMod) {
      const args = this.getArgumentsFromClassMod(classMod);
      for (const arg of args) {
        const argName = this.extractArgName(arg);
        if (argName) {
          const mappedName = normalizeArgName(name, argName);
          const val = this.parseValue(arg, argName);
          if (result[mappedName] !== undefined) {
            if (Array.isArray(result[mappedName])) {
              result[mappedName].push(val);
            } else {
              result[mappedName] = [result[mappedName], val];
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
      } else if (expr && "functionReference" in expr) {
        return this.parseFunctionCall(expr, name);
      }
      if (expr) {
        return this.toJSON(evaluateCSTExpression(expr, this.scope));
      }
    }

    return result;
  }

  private parseValue(arg: any, fallbackName: string): any {
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

    if (expr && "functionReference" in expr) {
      return this.parseFunctionCall(expr, argName);
    }

    const evaluated = this.toJSON(evaluateCSTExpression(expr, this.scope));
    if (argName === "visible" && typeof evaluated !== "boolean") {
      return false;
    }
    return evaluated;
  }

  private extractCstFunctionArgs(node: any): { named: [string, any][]; positional: any[] } {
    const named: [string, any][] = [];
    const positional: any[] = [];

    const callArgs = node.children?.find((c: any) => Cst.FunctionCallArgs.is(c));
    if (!callArgs) return { named, positional };

    const walkArgs = (n: any) => {
      if (!n) return;
      if (Cst.NamedArgument.is(n)) {
        const identNode = n.children?.find((c: any) => Cst.Identifier.is(c));
        const funcArg = n.children?.find((c: any) => Cst.FunctionArgument.is(c) || Cst.Expression.is(c));
        if (identNode && funcArg) {
          named.push([identNode.text?.trim() ?? "", funcArg]);
        }
        return;
      }
      if (Cst.FunctionArgument.is(n)) {
        const expr = n.children?.find((c: any) => Cst.Expression.is(c)) ?? n;
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

  private parseFunctionCall(node: any, propertyName?: string): any {
    let funcName = "Unknown";
    if (node.functionReference) {
      const funcNameParts = node.functionReference?.parts?.map((p: any) => p.identifier?.text ?? p.name ?? p.text ?? p);
      funcName = funcNameParts ? funcNameParts[funcNameParts.length - 1] : "Unknown";
    } else {
      const compRef =
        node.children?.find((c: any) => Cst.ComponentReference.is(c)) ??
        (Cst.ComponentReference.is(node) ? node : null);
      if (compRef) {
        funcName = compRef.text?.trim() ?? "Unknown";
      } else {
        const ident = node.children?.find((c: any) => Cst.Identifier.is(c));
        if (ident) funcName = ident.text?.trim() ?? "Unknown";
      }
    }

    if (funcName === "DynamicSelect") {
      const posArgs = node.functionCallArguments?.arguments ?? [];
      if (posArgs.length > 0 && posArgs[0]?.expression) {
        const staticVal = this.parseValueForExpr(posArgs[0].expression, propertyName);
        if (posArgs.length > 1 && posArgs[1]?.expression) {
          const dynExpr = posArgs[1].expression;
          const varName = dynExpr.text ?? dynExpr.identifier?.text ?? dynExpr.name ?? "";
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
        if (rawArgs.positional.length > 1) {
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

    const obj: any = { "@type": funcName };

    // Named arguments (AST)
    if (node.functionCallArguments?.namedArguments) {
      for (const arg of node.functionCallArguments.namedArguments) {
        const argIdent = arg.identifier?.text ?? arg.name;
        if (argIdent && arg.argument?.expression) {
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
        posArgs.map((p: any) => evaluateCSTExpression(p.expression ?? p, this.scope)),
      );
    }

    // Fallback: extract points if not resolved
    if (
      obj.points === undefined &&
      node.text &&
      (funcName === "Polygon" || funcName === "Line" || node.text.includes("points="))
    ) {
      const recovered = extractPointsFromText(node.text);
      if (recovered) {
        obj.points = recovered;
      }
    }

    return obj;
  }

  private parseValueForExpr(expr: any, propName?: string): any {
    if (!expr) return null;
    let unwrapped = expr;
    while (unwrapped) {
      if (
        Cst.FunctionArgument.is(unwrapped) ||
        Cst.Expression.is(unwrapped) ||
        Cst.ModificationExpression.is(unwrapped)
      ) {
        if (Array.isArray(unwrapped.children) && unwrapped.children.length === 1) {
          unwrapped = unwrapped.children[0];
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if ("functionReference" in unwrapped) return this.parseFunctionCall(unwrapped, propName);
    if (Cst.Primary.is(unwrapped)) {
      const compRef = unwrapped.children?.find((c: any) => Cst.ComponentReference.is(c));
      const callArgs = unwrapped.children?.find((c: any) => Cst.FunctionCallArgs.is(c));
      if (compRef && callArgs) return this.parseFunctionCall(unwrapped, propName);
    }
    const evaluated = this.toJSON(evaluateCSTExpression(unwrapped, this.scope));
    if (propName === "visible" && typeof evaluated !== "boolean") {
      return false;
    }
    return evaluated;
  }

  private parseGraphicsArray(expr: any): any[] {
    const graphics: any[] = [];
    const walkGraphics = (node: any) => {
      if (!node) return;
      if ("functionReference" in node) {
        graphics.push(this.parseFunctionCall(node));
        return;
      }
      if (Cst.Primary.is(node)) {
        const compRef = node.children?.find((c: any) => Cst.ComponentReference.is(c));
        const callArgs = node.children?.find((c: any) => Cst.FunctionCallArgs.is(c));
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

  private toJSON(val: any): any {
    if (val === null || val === undefined) return null;
    if (typeof val === "number" || typeof val === "boolean" || typeof val === "string") return val;
    if (Array.isArray(val)) return val.map((e) => this.toJSON(e));
    if (typeof val === "object" && val.elements instanceof Map) {
      const obj: any = {};
      for (const [k, v] of val.elements.entries()) {
        obj[k] = this.toJSON(v);
      }
      return obj;
    }
    return null;
  }
}

export function extractPointsFromText(text: string): [number, number][] | null {
  const idx = text.search(/\bpoints\s*=\s*\{/);
  if (idx === -1) return null;
  const startBrace = text.indexOf("{", idx);
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
