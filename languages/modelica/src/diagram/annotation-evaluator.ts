// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

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

function resolveAnnotationName(name: string, evalScope: any): any {
  const dotIdx = name.indexOf(".");
  if (dotIdx > 0) {
    const root = name.substring(0, dotIdx);
    const member = name.substring(dotIdx + 1);
    const enumDef = ANNOTATION_ENUMS[root];
    if (enumDef && member in enumDef) {
      return enumDef[member];
    }
  }

  if (!evalScope) return undefined;

  if (typeof evalScope.resolveSimpleName === "function") {
    const resolved = evalScope.resolveSimpleName(name);
    if (resolved != null) {
      const mod = resolved.modification;
      if (mod) {
        const expr = mod.evaluatedExpression ?? mod.expression;
        if (expr != null) {
          if (typeof expr === "number" || typeof expr === "boolean" || typeof expr === "string") return expr;
          if (typeof expr.value !== "undefined") return expr.value;
        }
      }
      return resolved;
    }
  }

  return undefined;
}

export function evaluateCSTExpression(node: any, evalScope?: any): any {
  if (!node) return null;

  if (typeof node.value === "number" || typeof node.value === "boolean") {
    return node.value;
  }
  if (node.type === "unsigned_integer" || node.type === "IntegerLiteral") {
    return parseInt(node.text ?? String(node.value), 10);
  }
  if (node.type === "unsigned_real" || node.type === "RealLiteral") {
    return parseFloat(node.text ?? String(node.value));
  }
  if (node.type === "true" || node.text === "true") return true;
  if (node.type === "false" || node.text === "false") return false;

  if (
    typeof node.text === "string" &&
    !node.parts &&
    !node.operand &&
    !node.operand1 &&
    !node.functionReference &&
    !node.expressionList
  ) {
    if (node.text.startsWith('"') && node.text.endsWith('"')) {
      return node.text.slice(1, -1);
    }
    if (node.type === "string_literal" || node.type === "StringLiteral" || node.syntaxKind?.includes("String")) {
      return node.text.replace(/^"|"$/g, "");
    }
  }

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

  if (("operand1" in node || "left" in node) && ("operand2" in node || "right" in node)) {
    const left = evaluateCSTExpression(node.operand1 ?? node.left, evalScope);
    const right = evaluateCSTExpression(node.operand2 ?? node.right, evalScope);
    if (left === null || right === null) return null;
    const op = node.operator;

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

    return null;
  }

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

  if ("functionReference" in node) {
    const funcNameParts = node.functionReference?.parts?.map((p: any) => p.identifier?.text ?? p.name ?? p.text ?? p);
    const funcName = funcNameParts ? funcNameParts[funcNameParts.length - 1] : null;
    if (funcName === "DynamicSelect") {
      const posArgs = node.functionCallArguments?.arguments ?? [];
      if (posArgs.length > 0 && posArgs[0]?.expression) {
        return evaluateCSTExpression(posArgs[0].expression, evalScope);
      }
      return null;
    }
    return null;
  }

  return null;
}

const conditionCache = new WeakMap<any, boolean | undefined>();

export function evaluateCondition(component: any, parentContext?: any): boolean | undefined {
  const node = component.abstractSyntaxNode;
  if (!node || !("conditionAttribute" in node) || !node.conditionAttribute?.condition) return true;

  const cached = conditionCache.get(component);
  if (cached !== undefined) return cached;

  const condition = node.conditionAttribute.condition;
  const scope = parentContext ?? component.parent ?? component;
  try {
    const result = evaluateCSTExpression(condition, scope);
    if (typeof result === "boolean") {
      conditionCache.set(component, result);
      return result;
    }
  } catch (e) {
    console.warn(`[evaluateCondition] failed for ${component.name}:`, e);
  }
  return undefined;
}

export class AnnotationEvaluator {
  private scope: any;

  constructor(
    private evalScope?: any | null,
    private overrideModification?: unknown,
  ) {
    this.scope = evalScope ?? null;
  }

  public evaluate(ast: any, name: string): any {
    let classMod = ast?.classModification;
    if (!classMod && ast?.annotationClause?.classModification) {
      classMod = ast.annotationClause.classModification;
    }
    if (!classMod) return null;
    const layerMod = this.findModByName(classMod, name);
    if (!layerMod) return null;

    return this.parseMod(layerMod, name);
  }

  private findModByName(classMod: any, name: string): any {
    if (!classMod) return null;
    const args = classMod.modificationArguments ?? [];
    for (const arg of args) {
      const argName = arg.name?.parts?.[0]?.identifier?.text ?? arg.name?.parts?.[0]?.text ?? arg.name?.text;
      if (argName === name) return arg;
    }
    return null;
  }

  private parseMod(mod: any, name: string): any {
    const result: any = { "@type": name };

    if (mod.modification?.classModification) {
      const args = mod.modification.classModification.modificationArguments ?? [];
      for (const arg of args) {
        const argName = arg.name?.parts?.[0]?.identifier?.text ?? arg.name?.parts?.[0]?.text ?? arg.name?.text;
        if (argName) {
          let mappedName = argName;
          if (name === "Rectangle" && argName === "cornerRadius") {
            mappedName = "radius";
          }
          result[mappedName] = this.parseValue(arg, argName);
        }
      }
    } else if (mod.modification?.modificationExpression?.expression) {
      const expr = mod.modification.modificationExpression.expression;
      if (name === "graphics") {
        return this.parseGraphicsArray(expr);
      } else if (expr && "functionReference" in expr) {
        return this.parseFunctionCall(expr);
      }
      return this.toJSON(evaluateCSTExpression(expr, this.scope));
    }

    return result;
  }

  private parseValue(arg: any, fallbackName: string): any {
    const argName = arg.name?.parts?.[0]?.identifier?.text ?? arg.name?.parts?.[0]?.text ?? arg.name?.text;
    if (arg.modification?.classModification) {
      return this.parseMod(arg, argName ?? fallbackName);
    }

    const expr = arg.modification?.modificationExpression?.expression;
    if (!expr) return null;

    if (fallbackName === "graphics") {
      return this.parseGraphicsArray(expr);
    }

    if (expr && "functionReference" in expr) {
      return this.parseFunctionCall(expr);
    }

    return this.toJSON(evaluateCSTExpression(expr, this.scope));
  }

  private parseFunctionCall(node: any): any {
    const funcNameParts = node.functionReference?.parts?.map((p: any) => p.identifier?.text ?? p.name ?? p.text ?? p);
    const funcName = funcNameParts ? funcNameParts[funcNameParts.length - 1] : "Unknown";

    if (funcName === "DynamicSelect") {
      const posArgs = node.functionCallArguments?.arguments ?? [];
      if (posArgs.length > 0 && posArgs[0]?.expression) {
        return this.parseValueForExpr(posArgs[0].expression);
      }
      return null;
    }

    const obj: any = { "@type": funcName };

    for (const arg of node.functionCallArguments?.namedArguments ?? []) {
      const argIdent = arg.identifier?.text ?? arg.name;
      if (argIdent && arg.argument?.expression) {
        let argName = argIdent;
        if (funcName === "Rectangle" && argName === "cornerRadius") {
          argName = "radius";
        }
        obj[argName] = this.parseValueForExpr(arg.argument.expression);
      }
    }

    const posArgs = node.functionCallArguments?.arguments ?? [];
    if (posArgs.length > 0 && posArgs[0] && obj.visible === undefined) {
      const val = evaluateCSTExpression(posArgs[0].expression, this.scope);
      if (typeof val === "boolean") {
        obj.visible = val;
      }
    }

    return obj;
  }

  private parseValueForExpr(expr: any): any {
    if (expr && "functionReference" in expr) return this.parseFunctionCall(expr);
    return this.toJSON(evaluateCSTExpression(expr, this.scope));
  }

  private parseGraphicsArray(expr: any): any[] {
    const graphics: any[] = [];
    const walkGraphics = (node: any) => {
      if (!node) return;
      if ("functionReference" in node) {
        graphics.push(this.parseFunctionCall(node));
      } else if ("expressionLists" in node && Array.isArray(node.expressionLists)) {
        for (const list of node.expressionLists) {
          for (const e of list.expressions ?? []) {
            if (e) walkGraphics(e);
          }
        }
      } else if ("expressionList" in node) {
        for (const e of node.expressionList?.expressions ?? []) {
          if (e) walkGraphics(e);
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
