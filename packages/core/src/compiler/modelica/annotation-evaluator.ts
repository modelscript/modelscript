// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ModelicaAnnotationClauseSyntaxNode,
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
  ModelicaClassModificationSyntaxNode,
  ModelicaElementModificationSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
} from "@modelscript/modelica-polyglot/ast";
import {
  ModelicaArray,
  ModelicaBooleanLiteral,
  ModelicaEnumerationLiteral,
  ModelicaExpression,
  ModelicaIntegerLiteral,
  ModelicaObject,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
} from "@modelscript/symbolics";
import { ModelicaScriptScope, Scope } from "../scope.js";
import { ModelicaInterpreter } from "./interpreter.js";

// ── Annotation Enum Definitions ─────────────────────────────────────────────
// These are the standard Modelica annotation enumeration types that appear
// in Icon/Diagram/Placement annotations. We register them in the evaluator's
// scope so the interpreter can resolve qualified references like FillPattern.Solid.

type EnumDef = Record<string, number>;

const ANNOTATION_ENUMS: Record<string, EnumDef> = {
  FillPattern: {
    None: 0,
    Solid: 1,
    Horizontal: 2,
    Vertical: 3,
    Cross: 4,
    Forward: 5,
    Backward: 6,
    CrossDiag: 7,
    HorizontalCylinder: 8,
    VerticalCylinder: 9,
    Sphere: 10,
  },
  LinePattern: { None: 0, Solid: 1, Dash: 2, Dot: 3, DashDot: 4, DashDotDot: 5 },
  Arrow: { None: 0, Open: 1, Filled: 2, Half: 3 },
  Smooth: { None: 0, Bezier: 1 },
  BorderPattern: { None: 0, Raised: 1, Sunken: 2, Engraved: 3 },
  EllipseClosure: { None: 0, Chord: 1, Radial: 2, Automatic: 3 },
  TextAlignment: { Left: 0, Center: 1, Right: 2 },
  TextStyle: { Bold: 0, Italic: 1, UnderLine: 2 },
};

/**
 * A minimal stub that acts as a class instance for annotation enum types.
 * It resolves literal names (e.g., "Solid") to ModelicaEnumerationLiteral values.
 */
class AnnotationEnumClassInstance {
  name: string;
  private literals: Map<string, ModelicaEnumerationLiteral>;

  constructor(name: string, members: EnumDef) {
    this.name = name;
    this.literals = new Map();
    for (const [litName, ordinal] of Object.entries(members)) {
      this.literals.set(litName, new ModelicaEnumerationLiteral(ordinal, litName, null, name));
    }
  }

  resolveSimpleName(name: string): AnnotationEnumLiteralInstance | null {
    const lit = this.literals.get(name);
    if (!lit) return null;
    return new AnnotationEnumLiteralInstance(name, lit);
  }
}

/**
 * A minimal stub representing a resolved enum literal as a "component instance"
 * that the interpreter's visitComponentReference can extract a value from.
 */
class AnnotationEnumLiteralInstance {
  name: string;
  classInstance: AnnotationEnumClassInstance | null = null;
  instantiated = true;
  instantiating = false;
  variability = "constant" as const;
  modification: { evaluatedExpression: ModelicaEnumerationLiteral; expression: ModelicaEnumerationLiteral };

  constructor(name: string, literal: ModelicaEnumerationLiteral) {
    this.name = name;
    this.modification = { evaluatedExpression: literal, expression: literal };
  }

  instantiate() {
    /* no-op */
  }
}

/**
 * A lightweight synchronous evaluator to convert raw ModelicaAnnotationClauseSyntaxNode
 * structures from the polyglot CST into plain JSON objects matching IIcon / IPlacement.
 */
export class AnnotationEvaluator {
  private _interpreter: ModelicaInterpreter | null = null;
  private get interpreter() {
    if (!this._interpreter) {
      this._interpreter = new ModelicaInterpreter(false);
    }
    return this._interpreter;
  }

  private scope: Scope;

  constructor(
    private evalScope?: Scope | null,
    private overrideModification?: any,
  ) {
    const scope = new ModelicaScriptScope(evalScope ?? null);

    // Register annotation enum types in the scope so the interpreter can resolve
    // qualified references like FillPattern.Solid, LinePattern.Dash, etc.
    for (const [enumName, members] of Object.entries(ANNOTATION_ENUMS)) {
      const enumClass = new AnnotationEnumClassInstance(enumName, members);
      scope.classDefinitions.set(enumName, enumClass as any);
    }

    // Safely inject component parameter overrides so the ModelicaInterpreter can resolve dynamic expressions
    // without polluting the class scope's variable mappings.
    if (overrideModification) {
      (scope as any).modification = overrideModification;
    }

    this.scope = scope;
  }

  /**
   * Evaluate an annotation by name (like "Icon", "Diagram", or "Placement")
   */
  public evaluate(ast: ModelicaAnnotationClauseSyntaxNode | null | undefined, name: string): any {
    if (!ast?.classModification) return null;
    const layerMod = this.findModByName(ast.classModification, name);
    if (!layerMod) return null;

    return this.parseMod(layerMod, name);
  }

  private findModByName(
    classMod: ModelicaClassModificationSyntaxNode | null | undefined,
    name: string,
  ): ModelicaElementModificationSyntaxNode | null {
    if (!classMod) return null;
    for (const arg of classMod.modificationArguments) {
      if (arg instanceof ModelicaElementModificationSyntaxNode) {
        if (arg.name?.parts?.[0]?.text === name) return arg;
      }
    }
    return null;
  }

  private parseMod(mod: ModelicaElementModificationSyntaxNode, name: string): any {
    const result: any = { "@type": name };

    if (mod.modification?.classModification) {
      for (const arg of mod.modification.classModification.modificationArguments) {
        if (arg instanceof ModelicaElementModificationSyntaxNode) {
          const argName = arg.name?.parts?.[0]?.text;
          if (argName) {
            result[argName] = this.parseValue(arg, argName);
            if (argName === "visible") {
              console.log(`[AnnotationEvaluator] Parsed visible for ${name}: `, result[argName]);
            }
          }
        }
      }
    } else if (mod.modification?.modificationExpression?.expression) {
      const expr = mod.modification.modificationExpression.expression;
      if (name === "graphics") {
        return this.parseGraphicsArray(expr);
      } else if (expr instanceof ModelicaFunctionCallSyntaxNode) {
        return this.parseFunctionCall(expr);
      }
      return this.toJSON(expr.accept(this.interpreter, this.scope));
    }

    return result;
  }

  private parseValue(arg: ModelicaElementModificationSyntaxNode, fallbackName: string): any {
    // If it's a nested class modification (like transformation(extent=...))
    if (arg.modification?.classModification) {
      return this.parseMod(arg, arg.name?.parts?.[0]?.text ?? fallbackName);
    }

    const expr = arg.modification?.modificationExpression?.expression;
    if (!expr) return null;

    // "graphics" usually contains array constructors we want to unroll
    if (fallbackName === "graphics") {
      return this.parseGraphicsArray(expr);
    }

    if (expr instanceof ModelicaFunctionCallSyntaxNode) {
      return this.parseFunctionCall(expr);
    }

    return this.toJSON(expr.accept(this.interpreter, this.scope));
  }

  private parseFunctionCall(node: ModelicaFunctionCallSyntaxNode): any {
    const funcNameParts = node.functionReference?.parts?.map((p) => p.identifier?.text);
    const funcName = funcNameParts ? funcNameParts[funcNameParts.length - 1] : "Unknown";
    const obj: any = { "@type": funcName };

    for (const arg of node.functionCallArguments?.namedArguments ?? []) {
      if (arg.identifier?.text && arg.argument?.expression) {
        obj[arg.identifier.text] = this.parseValueForExpr(arg.argument.expression);
      }
    }

    // Best-effort positional mapping for visibility (first parameter in Modelica graphic items)
    const posArgs = node.functionCallArguments?.arguments ?? [];
    if (posArgs.length > 0 && posArgs[0] && obj.visible === undefined) {
      const val = posArgs[0].expression?.accept(this.interpreter, this.scope);
      if (val instanceof ModelicaBooleanLiteral) {
        obj.visible = val.value;
      }
    }

    return obj;
  }

  private parseValueForExpr(expr: ModelicaExpressionSyntaxNode): any {
    if (expr instanceof ModelicaFunctionCallSyntaxNode) return this.parseFunctionCall(expr);
    return this.toJSON(expr.accept(this.interpreter, this.scope));
  }

  private parseGraphicsArray(expr: ModelicaExpressionSyntaxNode): any[] {
    const graphics: any[] = [];
    const walkGraphics = (node: ModelicaExpressionSyntaxNode) => {
      if (node instanceof ModelicaFunctionCallSyntaxNode) {
        graphics.push(this.parseFunctionCall(node));
      } else if (node instanceof ModelicaArrayConcatenationSyntaxNode) {
        for (const list of node.expressionLists) {
          for (const e of list.expressions) {
            if (e) walkGraphics(e);
          }
        }
      } else if (node instanceof ModelicaArrayConstructorSyntaxNode) {
        for (const e of node.expressionList?.expressions ?? []) {
          if (e) walkGraphics(e);
        }
      }
    };
    walkGraphics(expr);
    return graphics;
  }

  private toJSON(expr: ModelicaExpression | null): any {
    if (!expr) return null;
    if (expr instanceof ModelicaArray) return expr.elements.map((e) => this.toJSON(e));
    if (expr instanceof ModelicaRealLiteral) return expr.value;
    if (expr instanceof ModelicaIntegerLiteral) return expr.value;
    if (expr instanceof ModelicaStringLiteral) return expr.value;
    if (expr instanceof ModelicaBooleanLiteral) return expr.value;
    if (expr instanceof ModelicaEnumerationLiteral) return expr.stringValue;
    if (expr instanceof ModelicaObject) {
      const obj: any = {};
      for (const [k, v] of expr.elements.entries()) {
        obj[k] = this.toJSON(v);
      }
      return obj;
    }
    return null;
  }
}
