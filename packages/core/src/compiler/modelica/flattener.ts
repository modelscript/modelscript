// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "../../util/io.js";

import { BUILTIN_FUNCTIONS, BUILTIN_VARIABLES } from "./builtins.js";
import type { ModelicaElseIfClause, ModelicaElseWhenClause } from "./dae.js";
import {
  ModelicaArray,
  ModelicaAssignmentStatement,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaBooleanVariable,
  ModelicaBreakStatement,
  ModelicaColonExpression,
  ModelicaComplexAssignmentStatement,
  ModelicaComprehensionExpression,
  ModelicaDAE,
  ModelicaDAEPrinter,
  ModelicaEnumerationLiteral,
  ModelicaEnumerationVariable,
  ModelicaEquation,
  ModelicaExpression,
  ModelicaForEquation,
  ModelicaForStatement,
  ModelicaFunctionCallEquation,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIfEquation,
  ModelicaIfStatement,
  ModelicaIntegerLiteral,
  ModelicaIntegerVariable,
  ModelicaNameExpression,
  ModelicaPartialFunctionExpression,
  ModelicaProcedureCallStatement,
  ModelicaRangeExpression,
  ModelicaRealLiteral,
  ModelicaRealVariable,
  ModelicaReturnStatement,
  ModelicaSimpleEquation,
  ModelicaStatement,
  ModelicaStringLiteral,
  ModelicaStringVariable,
  ModelicaSubscriptedExpression,
  ModelicaTupleExpression,
  ModelicaUnaryExpression,
  ModelicaVariable,
  ModelicaWhenEquation,
  ModelicaWhenStatement,
  ModelicaWhileStatement,
  type ModelicaFunctionTypeSignature,
  type ModelicaObject,
} from "./dae.js";
import { makeDiagnostic, ModelicaErrorCode } from "./errors.js";
import { buildFilledArray, ModelicaInterpreter } from "./interpreter.js";
import {
  ModelicaArrayClassInstance,
  ModelicaBooleanClassInstance,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaEntity,
  ModelicaEnumerationClassInstance,
  ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance,
  ModelicaModelVisitor,
  ModelicaModification,
  ModelicaNamedElement,
  ModelicaParameterModification,
  ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance,
  ModelicaStringClassInstance,
} from "./model.js";
import {
  ModelicaAlgorithmSectionSyntaxNode,
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBinaryOperator,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaBreakStatementSyntaxNode,
  ModelicaClassKind,
  ModelicaComplexAssignmentStatementSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaConnectEquationSyntaxNode,
  ModelicaEquationSectionSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaFlow,
  ModelicaForEquationSyntaxNode,
  ModelicaForStatementSyntaxNode,
  ModelicaFunctionArgumentSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaFunctionPartialApplicationSyntaxNode,
  ModelicaIfElseExpressionSyntaxNode,
  ModelicaIfEquationSyntaxNode,
  ModelicaIfStatementSyntaxNode,
  ModelicaInheritanceModificationSyntaxNode,
  ModelicaLongClassSpecifierSyntaxNode,
  ModelicaOutputExpressionListSyntaxNode,
  ModelicaProcedureCallStatementSyntaxNode,
  ModelicaRangeExpressionSyntaxNode,
  ModelicaReturnStatementSyntaxNode,
  ModelicaSimpleAssignmentStatementSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
  ModelicaSpecialEquationSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxPrinter,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnaryOperator,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
  ModelicaVariability,
  ModelicaWhenEquationSyntaxNode,
  ModelicaWhenStatementSyntaxNode,
  ModelicaWhileStatementSyntaxNode,
} from "./syntax.js";

/** Module-level counter for generating unique temp variable names in comprehensions. */
let tmpVarCounter = 1;

interface FlattenerContext {
  prefix: string;
  classInstance: ModelicaClassInstance;
  dae: ModelicaDAE;
  stmtCollector: ModelicaStatement[];
  loopVariables?: Map<string, number | ModelicaExpression>;
  structuralFinalParams?: Set<string>;
  /** Names of components removed via `break` in the current extends clause. */
  brokenNames?: Set<string>;
  /** Shared set for tracking flow variables that appear in connect equations. */
  connectedFlowVars?: Set<string>;
  /** Canonical keys of connect equations removed via `break connect(...)`. */
  brokenConnects?: Set<string>;
  /** Prefix for component-scoped function specialization (e.g., "N$n1"). */
  componentFunctionPrefix?: string;
  /** Top-level DAE for collecting function definitions (avoids nesting inside function DAEs). */
  rootDae?: ModelicaDAE;
  /** Instance composition hierarchy for outer/inner resolution. */
  activeClassStack?: ModelicaClassInstance[];
}

/** Extract an integer shape array from a list of expressions (all must be ModelicaIntegerLiteral). */
function extractShape(args: ModelicaExpression[]): number[] | null {
  const shape: number[] = [];
  for (const arg of args) {
    if (arg instanceof ModelicaIntegerLiteral) shape.push(arg.value);
    else return null;
  }
  return shape.length > 0 ? shape : null;
}

/** Handler type for built-in array constructor evaluation at flatten time. */
type BuiltinArrayHandler = (args: ModelicaExpression[], ctx: FlattenerContext) => ModelicaExpression | null;

/**
 * Dispatch table for built-in array constructor functions evaluated at flatten time.
 * Each handler returns a flattened expression or null if it cannot evaluate.
 */
const BUILTIN_ARRAY_HANDLERS: ReadonlyMap<string, BuiltinArrayHandler> = new Map<string, BuiltinArrayHandler>([
  ["array", (args) => (args.length >= 1 ? new ModelicaArray([args.length], args) : null)],

  [
    "cat",
    (args, ctx) => {
      if (args.length < 2) return null;
      const kLit = args[0];
      if (!(kLit instanceof ModelicaIntegerLiteral)) return null;
      const k = kLit.value;

      const expandedArgs: ModelicaArray[] = [];
      for (let i = 1; i < args.length; i++) {
        let arg = args[i];
        if (!arg) return null;
        if (arg instanceof ModelicaNameExpression || arg instanceof ModelicaSubscriptedExpression) {
          // Attempt to expand array name references to explicit arrays
          const tryExpandToArray = (expr: ModelicaExpression): ModelicaArray | null => {
            if (expr instanceof ModelicaArray) return expr;
            if (expr instanceof ModelicaSubscriptedExpression && expr.base instanceof ModelicaNameExpression) {
              const baseName = expr.base.name;
              if (expr.subscripts.length === 1 && expr.subscripts[0] instanceof ModelicaColonExpression) {
                const vars = ctx.dae.variables
                  .filter((v) => v.name.startsWith(baseName + "["))
                  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                if (vars.length > 0) {
                  return new ModelicaArray(
                    [vars.length],
                    vars.map((v) => new ModelicaNameExpression(v.name)),
                  );
                }
              }
            }
            if (expr instanceof ModelicaNameExpression) {
              const vars = ctx.dae.variables
                .filter((v) => v.name.startsWith(expr.name + "["))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
              if (vars.length > 0) {
                return new ModelicaArray(
                  [vars.length],
                  vars.map((v) => new ModelicaNameExpression(v.name)),
                );
              }
            }
            return null;
          };
          const exp = tryExpandToArray(arg);
          if (exp) arg = exp;
        }

        if (arg instanceof ModelicaArray) {
          expandedArgs.push(arg);
        } else {
          // Scalars are treated as arrays with shape [1]
          expandedArgs.push(new ModelicaArray([1], [arg]));
        }
      }

      if (k === 1) {
        // Concatenate along first dimension (rows)
        let totalRows = 0;
        const elements: ModelicaExpression[] = [];
        for (const arr of expandedArgs) {
          const flat = [...arr.flatElements];
          elements.push(...flat.filter((e): e is ModelicaExpression => e !== null));
          totalRows += arr.flatShape[0] ?? 1;
        }
        const firstShape = expandedArgs[0]?.flatShape ?? [];
        const resShape = [totalRows, ...firstShape.slice(1)];
        return new ModelicaArray(resShape, elements);
      } else if (k === 2) {
        // Concatenate along second dimension (columns)
        const firstShape = expandedArgs[0]?.flatShape ?? [];
        const dim1 = firstShape[0] ?? 1;
        const resultCols = expandedArgs.reduce((acc, a) => acc + (a.flatShape[1] ?? 1), 0);
        const resShape = [dim1, resultCols, ...firstShape.slice(2)];

        const resElements = new Array<ModelicaExpression>();
        for (let row = 0; row < dim1; row++) {
          for (const arr of expandedArgs) {
            const rowSize = arr.flatShape[1] ?? 1;
            const startIdx = row * rowSize;
            const flat = [...arr.flatElements];
            for (let c = 0; c < rowSize; c++) {
              const el = flat[startIdx + c];
              if (el) resElements.push(el);
            }
          }
        }
        return new ModelicaArray(resShape, resElements);
      }
      return null;
    },
  ],

  [
    "fill",
    (args) => {
      if (args.length < 2 || !args[0]) return null;
      const shape = extractShape(args.slice(1));
      return shape ? buildFilledArray(shape, args[0]) : null;
    },
  ],

  [
    "zeros",
    (args) => {
      if (args.length < 1) return null;
      const shape = extractShape(args);
      if (shape) return buildFilledArray(shape, new ModelicaIntegerLiteral(0));
      // Symbolic args: rewrite zeros(n) → fill(0.0, n)
      return new ModelicaFunctionCallExpression("fill", [new ModelicaRealLiteral(0.0), ...args]);
    },
  ],

  [
    "ones",
    (args) => {
      if (args.length < 1) return null;
      const shape = extractShape(args);
      if (shape) return buildFilledArray(shape, new ModelicaIntegerLiteral(1));
      // Symbolic args: rewrite ones(n) → fill(1.0, n)
      return new ModelicaFunctionCallExpression("fill", [new ModelicaRealLiteral(1.0), ...args]);
    },
  ],

  [
    "size",
    (args, ctx) => {
      if (args.length < 1) return null;
      const arrayArg = args[0];

      // Structural size inference from function return type signatures.
      // E.g., size(test2(b), 1) where test2 returns Real[size(a,1)] and a maps to b → size(b,1).
      if (
        arrayArg instanceof ModelicaFunctionCallExpression &&
        args.length === 2 &&
        args[1] instanceof ModelicaIntegerLiteral
      ) {
        const innerFuncDef = ctx.dae.functions.find((f) => f.name === arrayArg.functionName);
        if (innerFuncDef) {
          const outputVars = innerFuncDef.variables.filter((v) => v.causality === "output");
          const outVar = outputVars[0];
          if (outputVars.length === 1 && outVar) {
            const nameMatch = outVar.name.match(/^\0\[([^\]]+)\]\0/);
            if (nameMatch?.[1]) {
              // Split dimensions by commas, respecting nested parentheses
              const dims: string[] = [];
              let depth = 0;
              let current = "";
              for (const ch of nameMatch[1]) {
                if (ch === "(") depth++;
                else if (ch === ")") depth--;
                if (ch === "," && depth === 0) {
                  dims.push(current.trim());
                  current = "";
                } else {
                  current += ch;
                }
              }
              if (current.trim()) dims.push(current.trim());

              const dimIdx = (args[1] as ModelicaIntegerLiteral).value - 1;
              const dimExpr = dimIdx >= 0 && dimIdx < dims.length ? dims[dimIdx] : undefined;
              if (dimExpr) {
                const sizeMatch = dimExpr.match(/^size\((\w+),\s*(\d+)\)$/);
                if (sizeMatch?.[1] && sizeMatch[2]) {
                  const paramName = sizeMatch[1];
                  const sizeDim = parseInt(sizeMatch[2], 10);
                  const inputVars = innerFuncDef.variables.filter((v) => v.causality === "input");
                  const stripEncoding = (n: string) => n.replace(/^\0\[[^\]]*\]\0/, "");
                  const paramIdx = inputVars.findIndex((v) => stripEncoding(v.name) === paramName);
                  if (paramIdx >= 0 && paramIdx < arrayArg.args.length) {
                    const callerArg = arrayArg.args[paramIdx];
                    if (callerArg instanceof ModelicaArray && sizeDim >= 1 && sizeDim <= callerArg.shape.length) {
                      return new ModelicaIntegerLiteral(callerArg.shape[sizeDim - 1] ?? 0);
                    }
                    if (callerArg instanceof ModelicaNameExpression && ctx.classInstance) {
                      const resolved = ctx.classInstance.resolveName(callerArg.name.split("."));
                      if (
                        resolved instanceof ModelicaComponentInstance &&
                        resolved.classInstance instanceof ModelicaArrayClassInstance
                      ) {
                        const shape = resolved.classInstance.shape;
                        if (sizeDim >= 1 && sizeDim <= shape.length) {
                          return new ModelicaIntegerLiteral(shape[sizeDim - 1] ?? 0);
                        }
                      }
                    }
                  }
                } else if (/^\d+$/.test(dimExpr)) {
                  return new ModelicaIntegerLiteral(parseInt(dimExpr, 10));
                }
              }
            }
          }
        }
      }

      // Direct array shape queries
      if (arrayArg instanceof ModelicaArray) {
        const shape = arrayArg.flatShape;
        if (args.length === 1) {
          return new ModelicaIntegerLiteral(shape.reduce((a, b) => a * b, 1));
        }
        if (args.length === 2 && args[1] instanceof ModelicaIntegerLiteral) {
          const dim = args[1].value;
          if (dim >= 1 && dim <= shape.length) {
            return new ModelicaIntegerLiteral(shape[dim - 1] ?? 0);
          }
        }
      }

      // Resolve size(var, dim) from function variable type encoding.
      // Function variables have names like "\0[dim1Expr, 2]\0center_pos".
      // When the requested dimension is a known integer in the encoding, return it directly.
      // Skip input variables — their dimensions depend on the call site, not the function declaration.
      if (
        arrayArg instanceof ModelicaNameExpression &&
        args.length === 2 &&
        args[1] instanceof ModelicaIntegerLiteral
      ) {
        const varName = arrayArg.name;
        const funcVar = ctx.dae.variables.find((v) => v.name.endsWith("\0" + varName));
        if (funcVar && funcVar.causality !== "input") {
          const nameMatch = funcVar.name.match(/^\0\[([^\]]+)\]\0/);
          if (nameMatch?.[1]) {
            // Split dimensions by commas, respecting nested parentheses
            const dims: string[] = [];
            let depth = 0;
            let current = "";
            for (const ch of nameMatch[1]) {
              if (ch === "(") depth++;
              else if (ch === ")") depth--;
              if (ch === "," && depth === 0) {
                dims.push(current.trim());
                current = "";
              } else {
                current += ch;
              }
            }
            if (current.trim()) dims.push(current.trim());

            const dimIdx = (args[1] as ModelicaIntegerLiteral).value - 1;
            const dimExpr = dimIdx >= 0 && dimIdx < dims.length ? dims[dimIdx] : undefined;
            if (dimExpr && /^\d+$/.test(dimExpr)) {
              return new ModelicaIntegerLiteral(parseInt(dimExpr, 10));
            }
          }
        }
      }

      // Resolve size(var, dim) from class instance in model context.
      // Skip function contexts — the function variable handler above handles those.
      if (
        arrayArg instanceof ModelicaNameExpression &&
        ctx.classInstance &&
        ctx.classInstance.classKind !== ModelicaClassKind.FUNCTION
      ) {
        const resolved = ctx.classInstance.resolveName(arrayArg.name.split("."));
        if (
          resolved instanceof ModelicaComponentInstance &&
          resolved.classInstance instanceof ModelicaArrayClassInstance
        ) {
          const originalShape = resolved.classInstance.shape;
          let shape = originalShape;

          const isUnsized = originalShape.some((d: number) => d === 0);
          if (isUnsized) {
            // Try infer from binding expression
            let arrayBindingExpression =
              resolved.modification?.evaluatedExpression ?? resolved.modification?.expression;
            if (!arrayBindingExpression && resolved.modification?.modificationExpression?.expression) {
              const interp = new ModelicaInterpreter();
              arrayBindingExpression = resolved.modification.modificationExpression.expression.accept(
                interp,
                resolved.parent ?? undefined,
              );
            }
            if (arrayBindingExpression instanceof ModelicaArray) {
              shape = arrayBindingExpression.flatShape;
            } else {
              return null;
            }
          }

          if (args.length === 1) {
            return new ModelicaIntegerLiteral(shape.reduce((a: number, b: number) => a * b, 1));
          }
          if (args.length === 2 && args[1] instanceof ModelicaIntegerLiteral) {
            const dim = args[1].value;
            if (dim >= 1 && dim <= shape.length) {
              return new ModelicaIntegerLiteral(shape[dim - 1] ?? 0);
            }
          }
        }
      }
      // Fallback: infer shape from flattened DAE variable names
      if (arrayArg instanceof ModelicaNameExpression && ctx.dae) {
        const prefix = arrayArg.name + "[";
        const matchingVars = ctx.dae.variables.filter((v) => v.name.startsWith(prefix));

        if (matchingVars.length > 0) {
          const dims: number[] = [];
          for (const v of matchingVars) {
            const match = v.name.match(/\[([^\]]+)\]$/);
            if (match?.[1]) {
              const indices = match[1].split(",").map((s) => parseInt(s.trim(), 10));
              for (let i = 0; i < indices.length; i++) {
                dims[i] = Math.max(dims[i] ?? 0, indices[i] ?? 0);
              }
            }
          }
          if (dims.length > 0) {
            if (args.length === 1) {
              return new ModelicaIntegerLiteral(dims.reduce((a, b) => a * b, 1));
            }
            if (args.length === 2 && args[1] instanceof ModelicaIntegerLiteral) {
              const dim = args[1].value;
              if (dim >= 1 && dim <= dims.length) {
                return new ModelicaIntegerLiteral(dims[dim - 1] ?? 0);
              }
            }
          }
        }
      }
      return null;
    },
  ],
]);

/**
 * Visitor that traverses the semantic Modelica object model and flattens it into a DAE structure.
 * This class handles the instantiation and flattening of arrays, records, blocks, models, and variables.
 */
export class ModelicaFlattener extends ModelicaModelVisitor<[string, ModelicaDAE]> {
  /**
   * Visits an array class instance during topological traversal and delegates to visitClassInstance.
   *
   * @param node - The array class instance payload.
   * @param args - A tuple of `[prefixString, activeDAE]`.
   */
  visitArrayClassInstance(node: ModelicaArrayClassInstance, args: [string, ModelicaDAE]): void {
    this.visitClassInstance(node, args);
  }

  /**
   * Visits a root entity diagram instance during topological traversal and delegates to visitClassInstance.
   *
   * @param node - The top-level Modelica entity node.
   * @param args - A tuple of `[prefixString, activeDAE]`.
   */
  visitEntity(node: ModelicaEntity, args: [string, ModelicaDAE]): void {
    this.visitClassInstance(node, args);
  }

  activeClassStack: ModelicaClassInstance[] = [];

  /**
   * Visits a class instance, flattening its components, equations, algorithm sections, and extended elements.
   *
   * @param node - The class instance to flatten.
   * @param args - A tuple of `[prefixString, activeDAE]` to pass context down.
   */
  visitClassInstance(node: ModelicaClassInstance, args: [string, ModelicaDAE]): void {
    // Scan for structural parameters: parameters used in conditional component declarations
    // or in if-expression conditions in bindings. These must be marked `final`
    // since they determine class structure.
    const savedStructural = new Set(this.#structuralFinalParams);
    for (const element of node.elements) {
      if (element instanceof ModelicaComponentInstance) {
        // Check conditionAttribute (e.g., `Real x if b`)
        const condAttr = (
          element.abstractSyntaxNode as {
            conditionAttribute?: { condition?: ModelicaExpressionSyntaxNode | null };
          } | null
        )?.conditionAttribute?.condition;
        if (condAttr) {
          this.#collectStructuralParams(condAttr, args[0]);
        }
        // Check binding expression for if-expressions on array components only.
        if (element.classInstance instanceof ModelicaArrayClassInstance) {
          const bindingExpr = element.abstractSyntaxNode?.declaration?.modification?.modificationExpression?.expression;
          if (bindingExpr) {
            this.#scanExprForStructuralIfParams(bindingExpr, args[0]);
            if (element.classInstance.shape.some((d) => d === 0)) {
              this.#collectStructuralParams(bindingExpr, args[0]);
            }
          }
          for (const sub of element.classInstance.arraySubscripts) {
            if (sub.expression) this.#collectStructuralParams(sub.expression, args[0]);
          }
        }
      }
    }
    this.activeClassStack.push(node);
    for (const element of node.elements) {
      if (element instanceof ModelicaComponentInstance) element.accept(this, args);
    }
    this.activeClassStack.pop();
    for (const declaredElement of node.declaredElements) {
      if (declaredElement instanceof ModelicaExtendsClassInstance) declaredElement.accept(this, args);
    }
    // Process only locally-declared equation/algorithm sections (not inherited ones).
    // Inherited equations are handled by visitExtendsClassInstance with proper break context.
    const localSections = [...(node.abstractSyntaxNode?.sections ?? [])];
    // Process equation sections in reverse order to match OpenModelica's flattening behavior
    // (later equation sections appear before earlier ones in the output)
    const equationSections = localSections.filter(
      (s): s is ModelicaEquationSectionSyntaxNode => s instanceof ModelicaEquationSectionSyntaxNode,
    );
    for (let i = equationSections.length - 1; i >= 0; i--) {
      const section = equationSections[i];
      if (!section) continue;
      const target = section.initial ? args[1].initialEquations : args[1].equations;
      const savedEquations = args[1].equations;
      args[1].equations = target;
      for (const eq of section.equations) {
        eq.accept(new ModelicaSyntaxFlattener(), {
          prefix: args[0],
          classInstance: node,
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
          connectedFlowVars: this.#connectedFlowVars,
          activeClassStack: this.activeClassStack,
        });
      }
      args[1].equations = savedEquations;
    }
    // Process algorithm sections in declaration order
    for (const section of localSections) {
      if (section instanceof ModelicaAlgorithmSectionSyntaxNode) {
        const collector: ModelicaStatement[] = [];
        for (const statement of section.statements) {
          statement.accept(new ModelicaSyntaxFlattener(), {
            prefix: args[0],
            classInstance: node,
            dae: args[1],
            stmtCollector: collector,
            structuralFinalParams: this.#structuralFinalParams,
            activeClassStack: this.activeClassStack,
          });
        }
        if (collector.length > 0) {
          if (section.initial) {
            args[1].initialAlgorithms.push(collector);
          } else {
            args[1].algorithms.push(collector);
          }
        }
      }
    }
    // Restore previous structural params
    this.#structuralFinalParams = savedStructural;
  }

  /**
   * Collect parameter names referenced in a condition expression for structural final marking.
   * Walks the AST to find component references and adds their flattened names.
   */
  #collectStructuralParams(expr: unknown, prefix: string, visited = new Set()): void {
    if (!expr || typeof expr !== "object" || visited.has(expr)) return;
    visited.add(expr);

    if (expr instanceof ModelicaComponentReferenceSyntaxNode) {
      const firstName = expr.parts[0]?.identifier?.text;
      if (firstName) {
        const fullName = prefix === "" ? firstName : prefix + "." + firstName;
        this.#structuralFinalParams.add(fullName);
      }
    }

    for (const key of Object.keys(expr as Record<string, unknown>)) {
      if (key === "parent") continue;
      this.#collectStructuralParams((expr as Record<string, unknown>)[key], prefix, visited);
    }
  }

  /**
   * Scan an expression AST for if-expressions whose branches have different array shapes.
   * When branches differ in size (e.g., `if b then {1,2} else {3,4,5}`), the condition
   * parameters are structural and must be marked `final`.
   */
  #scanExprForStructuralIfParams(expr: ModelicaExpressionSyntaxNode, prefix: string): void {
    if (expr instanceof ModelicaIfElseExpressionSyntaxNode) {
      // Collect shapes of all branches
      const shapes: (number | null)[] = [];
      if (expr.expression) shapes.push(this.#getStaticArraySize(expr.expression));
      for (const clause of expr.elseIfExpressionClauses) {
        if (clause.expression) shapes.push(this.#getStaticArraySize(clause.expression));
      }
      if (expr.elseExpression) shapes.push(this.#getStaticArraySize(expr.elseExpression));

      // Only mark as structural if we found at least two known shapes that differ
      const knownShapes = shapes.filter((s): s is number => s !== null);
      const hasDifferentShapes = knownShapes.length >= 2 && !knownShapes.every((s) => s === knownShapes[0]);
      if (hasDifferentShapes) {
        if (expr.condition) {
          this.#collectStructuralParams(expr.condition, prefix);
        }
        for (const clause of expr.elseIfExpressionClauses) {
          if (clause.condition) {
            this.#collectStructuralParams(clause.condition, prefix);
          }
        }
      }
    }
    // Recurse into sub-expressions
    if ("children" in expr && Array.isArray(expr.children)) {
      for (const child of expr.children) {
        if (child instanceof ModelicaExpressionSyntaxNode) {
          this.#scanExprForStructuralIfParams(child, prefix);
        }
      }
    }
  }

  /**
   * Determine the static array size of an expression AST node, if possible.
   * Returns the element count for array constructors like `{1, 2, 3}`,
   * or null if the size can't be statically determined.
   */
  #getStaticArraySize(expr: ModelicaExpressionSyntaxNode): number | null {
    // `{a, b, c}` → ModelicaArrayConstructorSyntaxNode with expression list
    if (expr instanceof ModelicaArrayConstructorSyntaxNode) {
      if (expr.comprehensionClause) return null; // `array(x for i in ...)` — can't determine
      return expr.expressionList?.expressions?.length ?? null;
    }
    // Matrix/concatenation: `[a, b; c, d]` → ModelicaArrayConcatenationSyntaxNode
    if (expr instanceof ModelicaArrayConcatenationSyntaxNode) {
      if (expr.expressionLists.length === 1) {
        return expr.expressionLists[0]?.expressions?.length ?? null;
      }
      // Multi-row array: return number of rows
      return expr.expressionLists.length;
    }
    // Component references, binary expressions, etc. → unknown
    return null;
  }

  /**
   * Fold a `ModelicaIfElseExpression` whose condition is a structural final parameter.
   * Resolves the parameter value in the parent class instance and returns the selected branch.
   * Returns null if the condition can't be resolved.
   */
  #foldStructuralIfExpression(
    expr: ModelicaIfElseExpression,
    node: ModelicaComponentInstance,
  ): ModelicaExpression | null {
    const condValue = this.#resolveConditionBool(expr.condition, node);
    if (condValue === true) return expr.thenExpression;
    if (condValue === false) {
      // Check elseif clauses
      for (const clause of expr.elseIfClauses) {
        const clauseValue = this.#resolveConditionBool(clause.condition, node);
        if (clauseValue === true) return clause.expression;
        if (clauseValue !== false) return null; // can't determine
      }
      return expr.elseExpression;
    }
    return null;
  }

  /**
   * Resolve a condition expression to a boolean value using the parent class instance.
   * Returns true/false if resolvable, null otherwise.
   */
  #resolveConditionBool(condition: ModelicaExpression, node: ModelicaComponentInstance): boolean | null {
    if (condition instanceof ModelicaBooleanLiteral) return condition.value;
    // Handle ModelicaBooleanVariable — the syntax flattener creates variable nodes for
    // component references. The variable's expression holds the binding value.
    if (condition instanceof ModelicaVariable && condition.expression instanceof ModelicaBooleanLiteral) {
      return condition.expression.value;
    }
    if (condition instanceof ModelicaNameExpression && node.parent) {
      const paramName = condition.name;
      // Look up the parameter in the parent class instance
      const resolved = node.parent.resolveSimpleName?.(paramName, false, true);
      if (resolved instanceof ModelicaComponentInstance) {
        const paramValue = resolved.modification?.expression;
        if (paramValue instanceof ModelicaBooleanLiteral) return paramValue.value;
      }
    }
    return null;
  }

  /**
   * Visits a component instance and creates corresponding DAE variables (scalars or arrays) based on its type.
   *
   * @param node - The component instance.
   * @param args - A tuple of `[prefixString, activeDAE]`.
   */
  // Track outer component variability for propagation into compound type sub-components
  #outerVariability: ModelicaVariability | null = null;
  // Track outer `final` flag for propagation into compound type sub-components
  // When `final A a(x = 1.0)` is declared, all inner parameters inherit `final`
  #outerFinal = false;
  // Track outer `protected` flag for propagation into compound type sub-components
  // When `protected A a` is declared, all inner components inherit `protected`
  #outerProtected = false;
  // Track parent record object expression for propagating field values to sub-components
  // When r1 = R(1.0, 2.0, 3.0), the ModelicaObject{x:1.0, y:2.0, z:3.0} is carried here
  #parentObjectExpression: ModelicaObject | null = null;
  // Track emitted variable names to prevent duplicates from diamond inheritance
  #emittedVarNames = new Set<string>();
  // Track all flow variable names emitted as DAE variables (for flow balance post-processing)
  #allFlowVars = new Set<string>();
  // Track flow variable names that appear in connect equations (populated during equation processing)
  #connectedFlowVars = new Set<string>();
  // Track parameter names that are structurally significant (used in conditional component declarations)
  #structuralFinalParams = new Set<string>();
  // Carry outer brokenConnects through nested extends chains
  #outerBrokenConnects = new Set<string>();
  // Track current array element index for distributing array-valued modifiers
  // e.g., A a[2](n={1,2}) → a[1].n=1, a[2].n=2
  #arrayElementIndex: number | null = null;

  visitComponentInstance(node: ModelicaComponentInstance, args: [string, ModelicaDAE]): void {
    // Skip pure `outer` components — they reference an `inner` declaration higher up
    // and should not generate their own variables. `inner outer` still generates a variable.
    // Exception: when there is no corresponding `inner` in any enclosing scope, keep the
    // `outer` declaration as-is (OpenModelica behavior) so the variable is still emitted.
    if (node.isOuter && !node.isInner) {
      // Search ancestor class instances for a matching `inner` component.
      // Walk the instance composition hierarchy (activeClassStack) rather than the
      // class definition hierarchy (node.parent.parent), because `inner` declarations
      // are in enclosing model instances, not in the type definition chain.
      let hasInner = false;
      for (let i = this.activeClassStack.length - 1; i >= 0; i--) {
        const ancestorClass = this.activeClassStack[i];
        if (!ancestorClass) continue;
        for (const el of ancestorClass.elements) {
          if (el instanceof ModelicaComponentInstance && el.isInner && el.name === node.name) {
            hasInner = true;
            break;
          }
        }
        if (hasInner) break;
      }
      if (hasInner) return;
      // No matching `inner` found — keep the outer declaration (will emit warning via linter)
    }

    // Evaluate conditional components (e.g., `Real x if false;`)
    const conditionExpr = (
      node.abstractSyntaxNode as { conditionAttribute?: { condition?: ModelicaExpressionSyntaxNode | null } } | null
    )?.conditionAttribute?.condition;
    if (conditionExpr) {
      const interp = new ModelicaInterpreter();
      const conditionValue = conditionExpr.accept(interp, node.parent ?? undefined);
      if (conditionValue instanceof ModelicaBooleanLiteral && !conditionValue.value) return;
    }

    const name = args[0] === "" ? (node.name ?? "?") : args[0] + "." + node.name;

    // Use the more restrictive variability between the outer context and this component's own
    const effectiveVariability = this.#outerVariability ?? node.variability;

    if (node.classInstance instanceof ModelicaPredefinedClassInstance) {
      this.#flattenPredefinedClass(node, name, args, effectiveVariability);
    } else if (node.classInstance instanceof ModelicaEnumerationClassInstance) {
      this.#flattenEnumerationClass(node, name, args);
    } else if (node.classInstance instanceof ModelicaArrayClassInstance) {
      this.#flattenArrayClass(node, name, args);
    } else {
      // For compound types (records, models), propagate outer variability, final, and protected to inner components
      const savedVar = this.#outerVariability;
      const savedFinal = this.#outerFinal;
      const savedProtected = this.#outerProtected;
      const savedParentObj = this.#parentObjectExpression;
      this.#outerVariability = effectiveVariability;
      this.#outerFinal = this.#outerFinal || node.isFinal;
      this.#outerProtected = this.#outerProtected || node.isProtected;
      // If the record component has a binding that evaluates to a ModelicaObject
      // (e.g. r1 = R(1.0, 2.0, 3.0)), carry it so sub-component bindings can be extracted
      const modExpr = node.modification?.expression ?? null;
      this.#parentObjectExpression =
        modExpr && typeof modExpr === "object" && "elements" in modExpr && modExpr.elements instanceof Map
          ? (modExpr as ModelicaObject)
          : null;
      node.classInstance?.accept(this, [name, args[1]]);
      this.#outerVariability = savedVar;
      this.#outerFinal = savedFinal;
      this.#outerProtected = savedProtected;
      this.#parentObjectExpression = savedParentObj;
    }
  }

  #flattenPredefinedClass(
    node: ModelicaComponentInstance,
    name: string,
    args: [string, ModelicaDAE],
    effectiveVariability?: ModelicaVariability | null,
  ): void {
    const variability = effectiveVariability ?? node.variability;
    // For sub-components (prefixed with a dot path), strip input/output causality
    // since it only applies at the inner model's scope, not the outer model
    const causality = name.includes(".") ? null : node.causality;
    const activeClass = this.activeClassStack[this.activeClassStack.length - 1];
    const isProtected =
      node.isProtected || this.#outerProtected || (activeClass?.isProtectedElement(node.name) ?? false);

    let isFinal = node.isFinal || this.#outerFinal || node.annotation<boolean>("Evaluate") === true;
    if (
      activeClass?.annotation<string>("__OpenModelica_commandLineOptions")?.includes("evaluateAllParameters") &&
      variability === ModelicaVariability.PARAMETER
    ) {
      isFinal = true;
    }

    const attributes = new Map<string, ModelicaExpression>();
    // First collect type-level attributes (e.g., from `type MyReal = Real(start = 1.0)`)
    if (node.classInstance instanceof ModelicaPredefinedClassInstance) {
      for (const m of node.classInstance.modification?.modificationArguments ?? []) {
        if (m.name && m.name !== "annotation" && m.expression) {
          attributes.set(m.name, m.expression);
        }
      }
    }
    // Then overlay component-level attributes (which take priority)
    for (const m of node.modification?.modificationArguments ?? []) {
      if (m.name && m.name !== "annotation" && m.expression) {
        attributes.set(m.name, m.expression);
      }
    }

    let expression: ModelicaExpression | null;
    if (variability === ModelicaVariability.CONSTANT) {
      // Constants should be fully evaluated
      expression = node.modification?.evaluatedExpression ?? null;
      if (!expression) {
        expression = node.modification?.expression ?? null;
      }
      // Look up field value from parent record object expression (e.g., r1 = R(1.0, 2.0, 3.0))
      // Parent object values take priority over type defaults (e.g., constant R r1 = R(4.0, 5.0, 6.0))
      if (this.#parentObjectExpression && node.name) {
        const parentVal = this.#parentObjectExpression.elements.get(node.name);
        if (parentVal) expression = parentVal;
      }
      if (!expression && node.modification?.modificationExpression?.expression) {
        const syntaxFlattener = new ModelicaSyntaxFlattener();
        expression =
          node.modification.modificationExpression.expression.accept(syntaxFlattener, {
            prefix: args[0],
            classInstance: node.parent ?? ({} as ModelicaClassInstance),
            dae: args[1],
            stmtCollector: [],
            structuralFinalParams: this.#structuralFinalParams,
            activeClassStack: this.activeClassStack,
          }) ?? null;
      }
      // Even if the constant was evaluated, collect any function definitions
      // referenced in the raw binding expression (e.g., constant Integer s = mySize({1,2,3}))
      const rawConstExpr = node.modification?.modificationExpression?.expression;
      if (rawConstExpr) {
        const syntaxFlattener = new ModelicaSyntaxFlattener();
        syntaxFlattener.collectFunctionRefsFromAST(rawConstExpr, {
          prefix: args[0],
          classInstance: node.parent ?? ({} as ModelicaClassInstance),
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
          activeClassStack: this.activeClassStack,
        });
      }
    } else if (variability === ModelicaVariability.PARAMETER) {
      // Parameters: prefer symbolic expression over evaluated literal.
      // Parameters can change between simulations so we want to keep references
      // like sqrt(a) instead of collapsing to 2.236...
      // First try the syntax flattener on the raw AST modification expression
      expression = null;
      if (node.modification?.modificationExpression?.expression) {
        const syntaxFlattener = new ModelicaSyntaxFlattener();
        expression =
          node.modification.modificationExpression.expression.accept(syntaxFlattener, {
            prefix: args[0],
            classInstance: node.parent ?? ({} as ModelicaClassInstance),
            dae: args[1],
            stmtCollector: [],
            structuralFinalParams: this.#structuralFinalParams,
          }) ?? null;
      }
      // Distribute array-valued parameter bindings when inside an array element iteration
      // e.g., A a[2](n={1,2}) → a[1].n=1, a[2].n=2
      if (expression instanceof ModelicaArray && this.#arrayElementIndex !== null) {
        const idx = this.#arrayElementIndex;
        if (idx >= 0 && idx < expression.elements.length) {
          expression = expression.elements[idx] ?? expression;
        }
      }
      // Only fall back to evaluatedExpression if no symbolic form exists
      if (!expression) {
        expression = node.modification?.evaluatedExpression ?? null;
      }
    } else {
      // For non-constant, non-parameter: prefer symbolic reference from syntax flattener
      // (e.g., `r1.x` → ModelicaNameExpression("r1.x")) so constant folding can resolve it
      // from the DAE where record constructor values are properly applied.
      expression = null;
      if (node.modification?.modificationExpression?.expression) {
        const syntaxFlattener = new ModelicaSyntaxFlattener();
        expression =
          node.modification.modificationExpression.expression.accept(syntaxFlattener, {
            prefix: args[0],
            classInstance: node.parent ?? ({} as ModelicaClassInstance),
            dae: args[1],
            stmtCollector: [],
            structuralFinalParams: this.#structuralFinalParams,
          }) ?? null;
      }
      // Fall back to interpreter-evaluated expression
      if (!expression) {
        expression = node.modification?.expression ?? null;
      }
      // Look up field value from parent record object expression
      // Parent object values take priority over type defaults
      if (this.#parentObjectExpression && node.name) {
        const parentVal = this.#parentObjectExpression.elements.get(node.name);
        if (parentVal) expression = parentVal;
      }
    }
    let variable;
    let varExpression = expression;
    if (varExpression) {
      varExpression = this.#foldExpression(varExpression, args[1]);
    }
    // When a scalar variable binding comes from a multi-return function call evaluation,
    // the result is an array of all outputs (e.g., {6.0, 9.0} from f returning (y,z)).
    // Extract only the first output for scalar assignments.
    if (
      varExpression instanceof ModelicaArray &&
      !(node.classInstance instanceof ModelicaArrayClassInstance) &&
      varExpression.elements.length > 1 &&
      varExpression.elements.every((e) => isLiteral(e))
    ) {
      // Check if the binding expression is a function call to a multi-output function
      const bindingExpr = node.modification?.modificationExpression?.expression;
      if (bindingExpr instanceof ModelicaFunctionCallSyntaxNode) {
        const funcRef = bindingExpr.functionReference;
        if (funcRef) {
          const resolved = node.parent?.resolveComponentReference(funcRef);
          if (resolved instanceof ModelicaClassInstance) {
            const numOutputs = Array.from(resolved.outputParameters).length;
            if (numOutputs > 1 && varExpression.elements.length === numOutputs && varExpression.elements[0]) {
              varExpression = varExpression.elements[0];
            }
          }
        }
      }
    }

    if (node.classInstance instanceof ModelicaBooleanClassInstance) {
      variable = new ModelicaBooleanVariable(
        name,
        varExpression,
        attributes,
        variability,
        node.modification?.description ?? node.description,
        causality,
        isFinal,
        isProtected,
      );
    } else if (node.classInstance instanceof ModelicaIntegerClassInstance) {
      variable = new ModelicaIntegerVariable(
        name,
        varExpression,
        attributes,
        variability,
        node.modification?.description ?? node.description,
        causality,
        isFinal,
        isProtected,
      );
    } else if (node.classInstance instanceof ModelicaRealClassInstance) {
      for (const key of ["start", "min", "max", "nominal"]) {
        if (attributes.has(key)) {
          const casted = castToReal(attributes.get(key) ?? null);
          if (casted) attributes.set(key, casted);
        }
      }
      let realBinding = castToReal(varExpression);
      // Wrap non-builtin function calls returning Integer with /*Real*/(...)
      if (
        realBinding instanceof ModelicaFunctionCallExpression &&
        realBinding === varExpression &&
        realBinding.functionName !== "/*Real*/" &&
        !BUILTIN_FUNCTIONS.has(realBinding.functionName)
      ) {
        // Resolve the function to check if its output is non-Real (e.g. Integer)
        const parts = realBinding.functionName.split(".");
        const resolved = node.parent?.resolveName(parts);
        if (resolved instanceof ModelicaClassInstance) {
          for (const comp of resolved.components) {
            if (comp.causality === "output" && comp.classInstance instanceof ModelicaIntegerClassInstance) {
              realBinding = new ModelicaFunctionCallExpression("/*Real*/", [realBinding]);
              break;
            }
          }
        }
      }
      variable = new ModelicaRealVariable(
        name,
        realBinding,
        attributes,
        variability,
        node.modification?.description ?? node.description,
        causality,
        isFinal,
        isProtected,
      );
    } else if (node.classInstance instanceof ModelicaStringClassInstance) {
      variable = new ModelicaStringVariable(
        name,
        varExpression,
        attributes,
        variability,
        node.modification?.description ?? node.description,
        causality,
        isFinal,
      );
    }
    // Propagate Evaluate=true (isFinal) to the referenced variable if it's a direct assignment
    if (isFinal) {
      const modExpr = node.modification?.modificationExpression?.expression;
      if (modExpr instanceof ModelicaComponentReferenceSyntaxNode) {
        const parts = modExpr.parts;
        if (parts && parts.length > 0) {
          const refName = parts
            .map((p) => p.identifier?.text ?? "")
            .filter(Boolean)
            .join(".");
          // The target variable name is relative to the current prefix
          const targetName = args[0] ? `${args[0]}.${refName}` : refName;
          const targetVar = args[1].variables.find((v) => v.name === targetName);
          if (targetVar) targetVar.isFinal = true;
        }
      }
    }

    if (variable) {
      // Skip duplicate variables from diamond inheritance
      // (same component inherited through multiple extends paths)
      if (!this.#emittedVarNames.has(variable.name)) {
        this.#emittedVarNames.add(variable.name);
        args[1].variables.push(variable);
        // Track flow variables for flow balance post-processing.
        // Cap at 10,000 to avoid performance issues with huge array models (e.g., cells[1000,100]).
        if (node.flowPrefix === ModelicaFlow.FLOW && this.#allFlowVars.size < 10_000) {
          this.#allFlowVars.add(variable.name);
        }
      }
    }
  }

  #flattenEnumerationClass(node: ModelicaComponentInstance, name: string, args: [string, ModelicaDAE]): void {
    const { causality, isFinal } = node;
    const activeClass = this.activeClassStack[this.activeClassStack.length - 1];
    const isProtected =
      node.isProtected || this.#outerProtected || (activeClass?.isProtectedElement(node.name) ?? false);
    const attributes = new Map<string, ModelicaExpression>();
    // First collect type-level attributes (e.g., from `type E = enumeration(...)(start = E.two)`)
    if (node.classInstance instanceof ModelicaEnumerationClassInstance) {
      for (const m of node.classInstance.modification?.modificationArguments ?? []) {
        if (m.name && m.expression) {
          attributes.set(m.name, m.expression);
        }
      }
    }
    // Then overlay component-level attributes (which take priority)
    for (const m of node.modification?.modificationArguments ?? []) {
      if (m.name && m.expression) {
        attributes.set(m.name, m.expression);
      }
    }
    const expression = node.modification?.expression ?? null;
    const varExpression = expression;
    const variable = new ModelicaEnumerationVariable(
      name,
      varExpression,
      attributes,
      node.variability,
      node.modification?.description ?? node.description,
      (node.classInstance as ModelicaEnumerationClassInstance).enumerationLiterals,
      causality,
      isFinal,
      isProtected,
    );
    if (!this.#emittedVarNames.has(variable.name)) {
      this.#emittedVarNames.add(variable.name);
      args[1].variables.push(variable);
    }
  }

  #flattenArrayClass(node: ModelicaComponentInstance, name: string, args: [string, ModelicaDAE]): void {
    const { causality, isFinal } = node;
    const activeClass = this.activeClassStack[this.activeClassStack.length - 1];
    const isProtected =
      node.isProtected || this.#outerProtected || (activeClass?.isProtectedElement(node.name) ?? false);
    const arrayClassInstance = node.classInstance as ModelicaArrayClassInstance;
    const hasFlexibleDim = arrayClassInstance.shape.some((d) => d === 0);
    let arrayBindingExpression = node.modification?.expression ?? null;
    // For arrays with flexible dimensions (e.g., Real r[:] = fun(5)), the basic
    // interpreter may return an empty/wrong-shape array because it can't execute
    // function algorithm bodies. Re-evaluate from the raw AST with algorithm
    // execution enabled to get the correct result.
    if (
      hasFlexibleDim &&
      node.modification?.modificationExpression?.expression &&
      (!(arrayBindingExpression instanceof ModelicaArray) || arrayBindingExpression.shape.some((d: number) => d === 0))
    ) {
      const freshResult = node.modification.modificationExpression.expression.accept(
        new ModelicaInterpreter(true),
        node.parent ?? ({} as ModelicaClassInstance),
      );
      if (freshResult instanceof ModelicaArray && freshResult.shape.every((d: number) => d > 0)) {
        arrayBindingExpression = freshResult;
      }
    }
    // If the interpreter couldn't evaluate the binding (returned null or a malformed
    // array with 0-dimensions), try the syntax flattener which handles symbolic expressions
    const hasMalformedBinding =
      arrayBindingExpression instanceof ModelicaArray && arrayBindingExpression.flatShape.includes(0);
    if ((!arrayBindingExpression || hasMalformedBinding) && node.modification?.modificationExpression?.expression) {
      if (hasMalformedBinding) arrayBindingExpression = null;
      const syntaxFlattener = new ModelicaSyntaxFlattener();
      arrayBindingExpression =
        node.modification.modificationExpression.expression.accept(syntaxFlattener, {
          prefix: args[0],
          classInstance: node.parent ?? ({} as ModelicaClassInstance),
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
          activeClassStack: this.activeClassStack,
        }) ?? null;
    }
    // Collect function definitions from the raw binding expression even when the
    // interpreter already evaluated the binding (e.g., fun(5) → {1,1,1,1,1}).
    // Without this, the function definition wouldn't appear in the DAE output.
    if (arrayBindingExpression && node.modification?.modificationExpression?.expression) {
      const syntaxFlattener = new ModelicaSyntaxFlattener();
      syntaxFlattener.collectFunctionRefsFromAST(node.modification.modificationExpression.expression, {
        prefix: args[0],
        classInstance: node.parent ?? ({} as ModelicaClassInstance),
        dae: args[1],
        stmtCollector: [],
        structuralFinalParams: this.#structuralFinalParams,
        activeClassStack: this.activeClassStack,
      });
    }
    // Fold if-expressions whose conditions are structural final parameters.
    // The syntax flattener preserves `if b then {1.0, 2.0} else {3.0, 4.0, 5.0}` symbolically,
    // but structural parameters must be resolved at compile time for shape determination.
    if (arrayBindingExpression instanceof ModelicaIfElseExpression) {
      arrayBindingExpression = this.#foldStructuralIfExpression(arrayBindingExpression, node) ?? arrayBindingExpression;
    }

    if (arrayBindingExpression) {
      arrayBindingExpression = this.#foldExpression(arrayBindingExpression, args[1]);
    }

    const isCompileTimeEvaluable =
      node.variability === ModelicaVariability.PARAMETER || node.variability === ModelicaVariability.CONSTANT;
    const flatBindingElements =
      isCompileTimeEvaluable && arrayBindingExpression instanceof ModelicaArray
        ? [...arrayBindingExpression.flatElements]
        : null;

    let shape = arrayClassInstance.shape;
    let declaredElements = [...arrayClassInstance.declaredElements];

    // Infer size from binding if this is an unsized array [:]
    if (shape.length >= 1 && shape.some((d) => d === 0) && arrayBindingExpression instanceof ModelicaArray) {
      shape = arrayBindingExpression.flatShape;
      const totalElements = shape.reduce((a, b) => a * b, 1);
      declaredElements = new Array(totalElements).fill(arrayClassInstance.elementClassInstance);
      // Ensure element type is appropriate wrapper if necessary
      for (let i = 0; i < declaredElements.length; i++) {
        if (!declaredElements[i])
          declaredElements[i] = arrayClassInstance.elementClassInstance as ModelicaClassInstance;
      }
    }

    const index = new Array(shape.length).fill(1);
    let elementIndex = 0;
    for (const declaredElement of declaredElements) {
      // Build subscript string using enum literal names for enum dimensions
      const subscriptParts = index.map((idx: number, dim: number) => {
        const enumInfo = arrayClassInstance.enumDimensions.get(dim);
        if (enumInfo && idx - 1 < enumInfo.literals.length) {
          const literal = enumInfo.literals[idx - 1];
          // Qualify with full enum type path
          return enumInfo.typeName + "." + literal;
        }
        return String(idx);
      });
      const elementName = name + "[" + subscriptParts.join(",") + "]";
      if (
        declaredElement instanceof ModelicaPredefinedClassInstance ||
        declaredElement instanceof ModelicaEnumerationClassInstance
      ) {
        const attributes = new Map(
          declaredElement.modification?.modificationArguments.flatMap((m) =>
            m.name && m.expression ? [[m.name, m.expression]] : [],
          ),
        );
        let expression: ModelicaExpression | null;
        if (flatBindingElements) {
          expression = flatBindingElements[elementIndex] ?? null;
        } else if (arrayBindingExpression && isCompileTimeEvaluable) {
          // Create per-element binding by subscripting the array expression: expr[i, j]
          const subscripts = index.map((idx: number) => new ModelicaIntegerLiteral(idx));
          expression = new ModelicaSubscriptedExpression(arrayBindingExpression, subscripts);
        } else if (arrayBindingExpression) {
          expression = null;
        } else {
          expression = declaredElement.modification?.expression ?? null;
        }
        const varExpression = expression;
        let variable;
        if (declaredElement instanceof ModelicaBooleanClassInstance) {
          variable = new ModelicaBooleanVariable(
            elementName,
            varExpression,
            attributes,
            node.variability,
            declaredElement.modification?.description ?? declaredElement.description,
            causality,
            isFinal,
            isProtected,
          );
        } else if (declaredElement instanceof ModelicaIntegerClassInstance) {
          variable = new ModelicaIntegerVariable(
            elementName,
            varExpression,
            attributes,
            node.variability,
            declaredElement.modification?.description ?? declaredElement.description,
            causality,
            isFinal,
            isProtected,
          );
        } else if (declaredElement instanceof ModelicaRealClassInstance) {
          for (const key of ["start", "min", "max", "nominal"]) {
            if (attributes.has(key)) {
              const casted = castToReal(attributes.get(key) ?? null);
              if (casted) attributes.set(key, casted);
            }
          }
          variable = new ModelicaRealVariable(
            elementName,
            castToReal(varExpression),
            attributes,
            node.variability,
            declaredElement.modification?.description ?? declaredElement.description,
            causality,
            isFinal,
            isProtected,
          );
        } else if (declaredElement instanceof ModelicaStringClassInstance) {
          variable = new ModelicaStringVariable(
            elementName,
            varExpression,
            attributes,
            node.variability,
            declaredElement.modification?.description ?? declaredElement.description,
            causality,
            isFinal,
            isProtected,
          );
        } else if (declaredElement instanceof ModelicaEnumerationClassInstance) {
          variable = new ModelicaEnumerationVariable(
            elementName,
            varExpression,
            attributes,
            node.variability,
            declaredElement.modification?.description ?? declaredElement.description,
            declaredElement.enumerationLiterals,
            causality,
            isFinal,
            isProtected,
          );
        }
        if (variable) {
          if (!this.#emittedVarNames.has(variable.name)) {
            this.#emittedVarNames.add(variable.name);
            args[1].variables.push(variable);
          }
        }
      } else {
        const prevArrayElementIndex = this.#arrayElementIndex;
        this.#arrayElementIndex = elementIndex;
        declaredElement?.accept(this, [elementName, args[1]]);
        this.#arrayElementIndex = prevArrayElementIndex;
      }
      elementIndex++;
      if (!this.incrementIndex(index, shape)) break;
    }

    if (arrayBindingExpression && !flatBindingElements && !isCompileTimeEvaluable && (shape[0] ?? 0) > 0) {
      // For non-parameter arrays with symbolic bindings, emit a whole-array equation.
      // Parameter arrays use per-element subscripted bindings instead (see above).
      const elementType = arrayClassInstance.elementClassInstance ?? arrayClassInstance.declaredElements[0];
      const isRealArray =
        elementType instanceof ModelicaRealClassInstance ||
        (elementType instanceof ModelicaArrayClassInstance &&
          elementType.elementClassInstance instanceof ModelicaRealClassInstance);
      const rhs = isRealArray ? (castToReal(arrayBindingExpression) ?? arrayBindingExpression) : arrayBindingExpression;
      const lhs = new ModelicaRealVariable(name, null, new Map(), null);
      args[1].equations.push(new ModelicaSimpleEquation(lhs, rhs));
    }
  }

  /**
   * Visits an inherited extends class block, flattening its components and equations.
   *
   * @param node - The instantiated extends block holding inheritance context.
   * @param args - A tuple of `[prefixString, activeDAE]`.
   */
  visitExtendsClassInstance(node: ModelicaExtendsClassInstance, args: [string, ModelicaDAE]): void {
    if (!node.classInstance) return;
    // Components from base classes are already yielded by the `elements` iterator,
    // so we only need to handle equations and algorithms from the base class.

    // Collect broken names and broken connects from this extends clause
    const brokenNames = new Set<string>();
    const brokenConnects = new Set<string>();
    const modEntries =
      node.abstractSyntaxNode?.classOrInheritanceModification?.modificationArgumentOrInheritanceModifications ?? [];
    for (const entry of modEntries) {
      if (entry instanceof ModelicaInheritanceModificationSyntaxNode) {
        if (entry.identifier?.text) {
          brokenNames.add(entry.identifier.text);
        }
        if (entry.connectEquation) {
          // Extract component reference names from break connect(ref1, ref2)
          const ref1 = entry.connectEquation.componentReference1;
          const ref2 = entry.connectEquation.componentReference2;
          // Include array subscripts in the key (e.g. c1[i] not just c1)
          const refText = (ref: typeof ref1) =>
            ref?.parts
              .map((p) => {
                let name = p.identifier?.text ?? "";
                if (p.arraySubscripts?.subscripts?.length) {
                  const out = new StringWriter();
                  p.arraySubscripts.accept(new ModelicaSyntaxPrinter(out));
                  name += out.toString();
                }
                return name;
              })
              .join(".") ?? "";
          const name1 = refText(ref1);
          const name2 = refText(ref2);
          if (name1 && name2) {
            // Use sorted canonical key so connect(a,b) matches connect(b,a)
            const key = [name1, name2].sort().join(",");
            brokenConnects.add(key);
          }
        }
      }
    }

    // Merge with any outer broken connects propagated from parent extends
    for (const key of this.#outerBrokenConnects) {
      brokenConnects.add(key);
    }

    // Process recursive extends, propagating broken connects to nested chains
    for (const declaredElement of node.classInstance.declaredElements ?? []) {
      if (declaredElement instanceof ModelicaExtendsClassInstance) {
        const savedBrokenConnects = this.#outerBrokenConnects;
        this.#outerBrokenConnects = brokenConnects;
        declaredElement.accept(this, args);
        this.#outerBrokenConnects = savedBrokenConnects;
      }
    }

    // Process only locally-declared equation/algorithm sections from the base class.
    // Inherited equations from nested extends are handled by the recursive processing above.
    const localSections = node.classInstance.abstractSyntaxNode?.sections ?? [];
    for (const section of localSections) {
      if (section instanceof ModelicaEquationSectionSyntaxNode) {
        const target = section.initial ? args[1].initialEquations : args[1].equations;
        const savedEquations = args[1].equations;
        args[1].equations = target;
        for (const eq of section.equations) {
          eq.accept(new ModelicaSyntaxFlattener(), {
            prefix: args[0],
            classInstance: node.classInstance,
            dae: args[1],
            stmtCollector: [],
            structuralFinalParams: this.#structuralFinalParams,
            connectedFlowVars: this.#connectedFlowVars,
            activeClassStack: this.activeClassStack,
            ...(brokenNames.size > 0 ? { brokenNames } : {}),
            ...(brokenConnects.size > 0 ? { brokenConnects } : {}),
          });
        }
        args[1].equations = savedEquations;
      } else if (section instanceof ModelicaAlgorithmSectionSyntaxNode) {
        const collector: ModelicaStatement[] = [];
        for (const statement of section.statements) {
          statement.accept(new ModelicaSyntaxFlattener(), {
            prefix: args[0],
            classInstance: node.classInstance,
            dae: args[1],
            stmtCollector: collector,
            structuralFinalParams: this.#structuralFinalParams,
            activeClassStack: this.activeClassStack,
          });
        }
        if (collector.length > 0) {
          if (section.initial) {
            args[1].initialAlgorithms.push(collector);
          } else {
            args[1].algorithms.push(collector);
          }
        }
      }
    }
  }

  /**
   * Performs a topological-sort-like evaluation by repeatedly folding constant and parameter expressions
   * until no more simplifications can be made. This resolves forward references between constants.
   */
  /**
   * Generate flow balance equations for unconnected flow variables.
   * Per the Modelica spec, every flow variable that does not appear in any
   * `connect` equation must have `f = 0.0` added automatically.
   */
  generateFlowBalanceEquations(dae: ModelicaDAE) {
    // In Modelica, every top-level flow variable gets a boundary flow balance equation
    // f = 0.0, regardless of internal connections. This is separate from the connect
    // sum-to-zero equation which handles internal flow relationships.
    for (const flowVar of this.#allFlowVars) {
      dae.equations.push(new ModelicaSimpleEquation(new ModelicaNameExpression(flowVar), new ModelicaRealLiteral(0.0)));
    }
  }

  foldDAEConstants(dae: ModelicaDAE) {
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 100) {
      changed = false;
      iterations++;
      for (const variable of dae.variables) {
        if (
          variable.variability === ModelicaVariability.CONSTANT ||
          variable.variability === ModelicaVariability.PARAMETER
        ) {
          if (variable.expression) {
            let newExpr = this.#foldExpression(variable.expression, dae, new Set<string>(), true);
            // Coerce folded result to match the variable's declared type
            if (variable instanceof ModelicaIntegerVariable && newExpr instanceof ModelicaRealLiteral) {
              // For identity values (e.g., min() for Integer), use Modelica-standard values
              if (newExpr.value >= 8e304) newExpr = new ModelicaIntegerLiteral(0, "4611686018427387903");
              else if (newExpr.value <= -8e304) newExpr = new ModelicaIntegerLiteral(0, "-4611686018427387903");
              else newExpr = new ModelicaIntegerLiteral(Math.trunc(newExpr.value));
            } else if (variable instanceof ModelicaBooleanVariable && newExpr instanceof ModelicaRealLiteral) {
              // Identity values for Boolean min/max: min() → true, max() → false
              if (newExpr.value > 0) newExpr = new ModelicaBooleanLiteral(true);
              else newExpr = new ModelicaBooleanLiteral(false);
            } else if (variable instanceof ModelicaBooleanVariable && newExpr instanceof ModelicaIntegerLiteral) {
              newExpr = new ModelicaBooleanLiteral(newExpr.value !== 0);
            }
            if (newExpr !== variable.expression && newExpr.hash !== variable.expression.hash) {
              variable.expression = newExpr;
              changed = true;
            }
          }
        }
      }
      const newEquations: ModelicaEquation[] = [];
      for (const equation of dae.equations) {
        if (equation instanceof ModelicaSimpleEquation) {
          const newExpr1 = this.#foldExpression(equation.expression1, dae);
          const newExpr2 = this.#foldExpression(equation.expression2, dae);

          if (newExpr1 instanceof ModelicaArray && newExpr2 instanceof ModelicaArray) {
            const flat1 = [...newExpr1.flatElements];
            const flat2 = [...newExpr2.flatElements];
            const count = Math.min(flat1.length, flat2.length);
            for (let i = 0; i < count; i++) {
              let e1 = flat1[i];
              let e2 = flat2[i];
              if (!e1 || !e2) continue;
              if (e1 instanceof ModelicaRealVariable) e2 = castToReal(e2) ?? e2;
              if (e2 instanceof ModelicaRealVariable) e1 = castToReal(e1) ?? e1;
              newEquations.push(new ModelicaSimpleEquation(e1, e2, equation.description));
            }
            changed = true;
          } else if (newExpr1 instanceof ModelicaArray && isLiteral(newExpr2)) {
            const flat1 = [...newExpr1.flatElements];
            for (const e1 of flat1) {
              if (!e1) continue;
              let e2 = newExpr2;
              if (e1 instanceof ModelicaRealVariable) e2 = castToReal(e2) ?? e2;
              newEquations.push(new ModelicaSimpleEquation(e1, e2, equation.description));
            }
            changed = true;
          } else if (isLiteral(newExpr1) && newExpr2 instanceof ModelicaArray) {
            const flat2 = [...newExpr2.flatElements];
            for (const e2 of flat2) {
              if (!e2) continue;
              let e1 = newExpr1;
              if (e2 instanceof ModelicaRealVariable) e1 = castToReal(e1) ?? e1;
              newEquations.push(new ModelicaSimpleEquation(e1, e2, equation.description));
            }
            changed = true;
          } else {
            if (newExpr1 !== equation.expression1 || newExpr2 !== equation.expression2) {
              changed = true;
            }
            newEquations.push(new ModelicaSimpleEquation(newExpr1, newExpr2, equation.description));
          }
        } else {
          newEquations.push(equation);
        }
      }
      dae.equations = newEquations;
    }
  }

  /**
   * Recursively folds a flattened DAE expression at compile time into literals.
   * Useful for extracting array shapes and literal values from bound constants.
   */
  #foldExpression(
    expr: ModelicaExpression,
    dae?: ModelicaDAE,
    visited = new Set<string>(),
    inlineParameters = false,
  ): ModelicaExpression {
    if (expr instanceof ModelicaBinaryExpression) {
      const op1 = this.#foldExpression(expr.operand1, dae, visited, inlineParameters);
      const op2 = this.#foldExpression(expr.operand2, dae, visited, inlineParameters);
      return canonicalizeBinaryExpression(expr.operator, op1, op2, dae);
    } else if (expr instanceof ModelicaUnaryExpression) {
      const op1 = this.#foldExpression(expr.operand, dae, visited, inlineParameters);
      if (isLiteral(op1)) {
        if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
          if (op1 instanceof ModelicaRealLiteral) return new ModelicaRealLiteral(-op1.value);
          if (op1 instanceof ModelicaIntegerLiteral) return new ModelicaIntegerLiteral(-op1.value);
        } else if (expr.operator === ModelicaUnaryOperator.UNARY_PLUS) {
          return op1;
        } else if (expr.operator === ModelicaUnaryOperator.LOGICAL_NEGATION) {
          if (op1 instanceof ModelicaBooleanLiteral) return new ModelicaBooleanLiteral(!op1.value);
        }
      }
      // Distribute unary negation over arrays: -{1,2,3} → {-1,-2,-3}
      if (expr.operator === ModelicaUnaryOperator.UNARY_MINUS && op1 instanceof ModelicaArray) {
        const foldedElements = op1.elements.map((e) =>
          this.#foldExpression(
            new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, e),
            dae,
            visited,
            inlineParameters,
          ),
        );
        return new ModelicaArray(op1.shape, foldedElements);
      }
      return op1 === expr.operand ? expr : new ModelicaUnaryExpression(expr.operator, op1);
    } else if (expr instanceof ModelicaFunctionCallExpression) {
      // For builtin math functions (sqrt, sin, cos, etc.) that have non-literal args,
      // fold args WITHOUT parameter inlining to preserve expressions like sqrt(a).
      // Without this guard, foldDAEConstants would inline a→5.0, producing sqrt(5.0),
      // which would then be evaluated to 2.236... on the next iteration.
      const isKnownBuiltin = inlineParameters && BUILTIN_FUNCTIONS.has(expr.functionName);
      // Don't suppress inlining for size() — it's a structural query that needs
      // parameter values to resolve, unlike math functions like sqrt() where we
      // want to preserve symbolic expressions.
      const hadNonLiteralArg = isKnownBuiltin && expr.functionName !== "size" && expr.args.some((a) => !isLiteral(a));
      const args = hadNonLiteralArg
        ? expr.args.map((a) => this.#foldExpression(a, dae, visited, false))
        : expr.args.map((a) => this.#foldExpression(a, dae, visited, inlineParameters));

      if (dae) {
        const arrayHandler = BUILTIN_ARRAY_HANDLERS.get(expr.functionName);
        if (arrayHandler) {
          const result = arrayHandler(args, {
            dae,
            classInstance: undefined as unknown as ModelicaClassInstance,
            prefix: "",
            stmtCollector: [],
          });
          if (result) return this.#foldExpression(result, dae, visited, inlineParameters);
        }
      }

      const folded = tryFoldBuiltinFunction(expr.functionName, args);
      if (folded) return folded;

      // Fold non-numeric special types (Boolean/Enum min/max, String/Integer conversions)
      const specialFolded = tryFoldSpecialTypes(expr.functionName, args);
      if (specialFolded) return specialFolded;
      // Distribute single-argument functions (like der, sin, abs) over arrays
      // but NOT user-defined functions that take array parameters
      if (args.length === 1 && args[0] instanceof ModelicaArray) {
        const arr = args[0];
        const nonDistributive = new Set([
          "size",
          "ndims",
          "sum",
          "product",
          "min",
          "max",
          "fill",
          "zeros",
          "ones",
          "identity",
          "diagonal",
          "transpose",
          "outerProduct",
          "skew",
          "cross",
          "vector",
        ]);
        // User-defined functions (those in dae.functions) should not be distributed
        const isUserDefined = dae?.functions.some((f) => f.name === expr.functionName) ?? false;
        if (!nonDistributive.has(expr.functionName) && !isUserDefined) {
          const newElements = arr.elements.map((e) =>
            this.#foldExpression(
              new ModelicaFunctionCallExpression(expr.functionName, [e]),
              dae,
              visited,
              inlineParameters,
            ),
          );
          return new ModelicaArray(arr.shape, newElements);
        }
      }
      return new ModelicaFunctionCallExpression(expr.functionName, args);
    } else if (expr instanceof ModelicaComprehensionExpression) {
      const newBody = this.#foldExpression(expr.bodyExpression, dae, visited, inlineParameters);
      const newIterators = expr.iterators.map((it) => ({
        name: it.name,
        range: this.#foldExpression(it.range, dae, visited, inlineParameters),
      }));
      return new ModelicaComprehensionExpression(expr.functionName, newBody, newIterators);
    } else if (expr instanceof ModelicaArray) {
      const newElements = expr.elements.map((e) => this.#foldExpression(e, dae, visited, inlineParameters));
      return new ModelicaArray(expr.shape, newElements);
    } else if (expr instanceof ModelicaIfElseExpression) {
      const cond = this.#foldExpression(expr.condition, dae, visited, inlineParameters);
      if (cond instanceof ModelicaBooleanLiteral) {
        if (cond.value) return this.#foldExpression(expr.thenExpression, dae, visited, inlineParameters);

        for (const elseif of expr.elseIfClauses) {
          const elifCond = this.#foldExpression(elseif.condition, dae, visited, inlineParameters);
          if (elifCond instanceof ModelicaBooleanLiteral) {
            if (elifCond.value) return this.#foldExpression(elseif.expression, dae, visited, inlineParameters);
          } else {
            // Cannot guarantee compile-time evaluation beyond this point
            break;
          }
        }
        return this.#foldExpression(expr.elseExpression, dae, visited, inlineParameters);
      }

      // If we cannot fully evaluate the condition, at least construct a folded nested expression
      const newElseIfs = expr.elseIfClauses.map((ei) => ({
        condition: this.#foldExpression(ei.condition, dae, visited, inlineParameters),
        expression: this.#foldExpression(ei.expression, dae, visited, inlineParameters),
      }));
      return new ModelicaIfElseExpression(
        cond,
        this.#foldExpression(expr.thenExpression, dae, visited, inlineParameters),
        newElseIfs,
        this.#foldExpression(expr.elseExpression, dae, visited, inlineParameters),
      );
    } else if (expr instanceof ModelicaVariable) {
      if (
        inlineParameters &&
        (expr.variability === ModelicaVariability.CONSTANT ||
          (expr.variability === ModelicaVariability.PARAMETER && (expr.isFinal || !expr.isProtected))) &&
        expr.expression
      ) {
        if (!visited.has(expr.name)) {
          const newVisited = new Set(visited).add(expr.name);
          const folded = this.#foldExpression(expr.expression, dae, newVisited, inlineParameters);
          if (isLiteral(folded) || folded instanceof ModelicaArray) return folded;
        }
      }
    } else if (expr instanceof ModelicaNameExpression) {
      if (dae && !visited.has(expr.name)) {
        const variable = dae.variables.find((v) => v.name === expr.name);
        if (
          variable &&
          (variable.variability === ModelicaVariability.CONSTANT ||
            (inlineParameters && variable.variability === ModelicaVariability.PARAMETER && variable.isFinal)) &&
          variable.expression
        ) {
          const newVisited = new Set(visited).add(expr.name);
          const folded = this.#foldExpression(variable.expression, dae, newVisited, inlineParameters);
          if (isLiteral(folded) || folded instanceof ModelicaArray) return folded;
        }
      }
    } else if (expr instanceof ModelicaSubscriptedExpression) {
      if (dae) {
        // Evaluate base and subscripts
        const base = this.#foldExpression(expr.base, dae, visited, inlineParameters);
        const subscripts = expr.subscripts.map((s) => this.#foldExpression(s, dae, visited, inlineParameters));

        // If it's a direct reference to a flattened scalar variable element like intArray[1]
        if (base instanceof ModelicaNameExpression && subscripts.every((s) => s instanceof ModelicaIntegerLiteral)) {
          const flatName = base.name + "[" + subscripts.map((s) => (s as ModelicaIntegerLiteral).value).join(",") + "]";
          if (!visited.has(flatName)) {
            const variable = dae.variables.find((v) => v.name === flatName);
            if (
              variable &&
              (variable.variability === ModelicaVariability.CONSTANT ||
                (inlineParameters && variable.variability === ModelicaVariability.PARAMETER)) &&
              variable.expression
            ) {
              const newVisited = new Set(visited).add(flatName);
              const folded = this.#foldExpression(variable.expression, dae, newVisited, inlineParameters);
              if (isLiteral(folded) || folded instanceof ModelicaArray) return folded;
            }
          }
        }

        // Expand range subscripts on constant arrays: x[2:3] → {x[2], x[3]}
        if (
          base instanceof ModelicaNameExpression &&
          subscripts.length === 1 &&
          subscripts[0] instanceof ModelicaRangeExpression
        ) {
          const range = subscripts[0] as ModelicaRangeExpression;
          const foldedStart = this.#foldExpression(range.start, dae, visited, inlineParameters);
          const foldedEnd = this.#foldExpression(range.end, dae, visited, inlineParameters);
          if (foldedStart instanceof ModelicaIntegerLiteral && foldedEnd instanceof ModelicaIntegerLiteral) {
            const start = foldedStart.value;
            const end = foldedEnd.value;
            const step = range.step
              ? ((this.#foldExpression(range.step, dae, visited, inlineParameters) as ModelicaIntegerLiteral)?.value ??
                1)
              : 1;
            const elements: ModelicaExpression[] = [];
            for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
              const flatName = base.name + "[" + i + "]";
              const variable = dae.variables.find((v) => v.name === flatName);
              if (
                variable &&
                (variable.variability === ModelicaVariability.CONSTANT ||
                  (inlineParameters && variable.variability === ModelicaVariability.PARAMETER)) &&
                variable.expression
              ) {
                const folded = this.#foldExpression(variable.expression, dae, visited, inlineParameters);
                elements.push(folded);
              } else {
                elements.push(new ModelicaSubscriptedExpression(base, [new ModelicaIntegerLiteral(i)]));
              }
            }
            if (elements.length > 0) {
              return new ModelicaArray([elements.length], elements);
            }
          }
        }

        // Expand subscripted comprehension: array(expr for i in range)[k] → expr[i:=k]
        if (
          base instanceof ModelicaComprehensionExpression &&
          subscripts.length === 1 &&
          subscripts[0] instanceof ModelicaIntegerLiteral
        ) {
          const k = (subscripts[0] as ModelicaIntegerLiteral).value;
          const comp = base;
          if (comp.iterators.length === 1 && comp.iterators[0]) {
            const iterName = comp.iterators[0].name;
            const range = comp.iterators[0].range;
            // Evaluate the range to find start value
            const foldedRange = this.#foldExpression(range, dae, visited, inlineParameters);
            let startVal = 1; // default
            if (foldedRange instanceof ModelicaRangeExpression) {
              const rs = foldedRange.start;
              if (rs instanceof ModelicaIntegerLiteral) startVal = rs.value;
            }
            const iterValue = startVal + k - 1;
            // Substitute iterator variable in body expression
            const substituted = substituteIterator(
              comp.bodyExpression,
              iterName,
              new ModelicaIntegerLiteral(iterValue),
            );
            return this.#foldExpression(substituted, dae, visited, inlineParameters);
          }
        }

        // Return a partially or fully folded SubscriptedExpression
        // Resolve subscripted name expressions to flat name expressions when
        // the flat name matches a DAE variable: NameExpr("r.m1.p")[1, 2] → NameExpr("r.m1.p[1,2]")
        if (
          dae &&
          base instanceof ModelicaNameExpression &&
          subscripts.every((s) => s instanceof ModelicaIntegerLiteral)
        ) {
          const flatName = base.name + "[" + subscripts.map((s) => (s as ModelicaIntegerLiteral).value).join(",") + "]";
          if (dae.variables.some((v) => v.name === flatName)) {
            return new ModelicaNameExpression(flatName);
          }
        }
        return new ModelicaSubscriptedExpression(base, subscripts);
      }
    }
    return expr;
  }

  /**
   * Increments an n-dimensional array index iterator, following row-major lexicographical order.
   *
   * @param index - The mutable current array index vector (1-indexed).
   * @param shape - The multidimensional bounds/shape of the array.
   * @returns True if the index was successfully incremented, false if the iteration has crossed its bounds.
   */
  incrementIndex(index: number[], shape: number[]): boolean {
    for (let i = shape.length - 1; i >= 0; i--) {
      const length = shape[i] ?? -1;
      if ((index[i] ?? 1) < length) {
        index[i] = (index[i] ?? 1) + 1;
        for (let j = i + 1; j < shape.length; j++) index[j] = 1;
        return true;
      }
    }
    return false;
  }
}

/**
 * Internal visitor class specifically to flatten Modelica AST syntax models
 * (equations, expressions, algorithms) during the DAE translation process.
 */
class ModelicaSyntaxFlattener extends ModelicaSyntaxVisitor<ModelicaExpression, FlattenerContext> {
  /** Tracks functions currently being collected, to prevent re-entrant recursion. */
  static #collectingFunctions = new Set<string>();

  /** Recursively check if a function with the given name exists anywhere in the DAE hierarchy. */
  static #hasFunctionInDAE(dae: ModelicaDAE, name: string): boolean {
    for (const fn of dae.functions) {
      if (fn.name === name) return true;
      // Check sub-functions within this function's DAE
      if (ModelicaSyntaxFlattener.#hasFunctionInDAE(fn, name)) return true;
    }
    return false;
  }
  /**
   * Check if a function name refers to a built-in Modelica function.
   * Uses the typed definitions in builtins.ts.
   */
  static #isBuiltinFunction(name: string): boolean {
    return BUILTIN_FUNCTIONS.has(name);
  }
  visitArrayConcatenation(
    node: ModelicaArrayConcatenationSyntaxNode,
    ctx: FlattenerContext,
  ): ModelicaExpression | null {
    const listExprs: ModelicaExpression[] = [];
    for (const expressionList of node.expressionLists ?? []) {
      const rowExprs: ModelicaExpression[] = [];
      for (const expression of expressionList.expressions ?? []) {
        const element = expression.accept(this, ctx);
        if (element != null) rowExprs.push(element);
      }
      if (rowExprs.length === 1) {
        const rowExpr = rowExprs[0];
        if (rowExpr) listExprs.push(rowExpr);
      } else if (rowExprs.length > 1) {
        listExprs.push(new ModelicaFunctionCallExpression("cat", [new ModelicaIntegerLiteral(2), ...rowExprs]));
      }
    }

    let finalExpr: ModelicaExpression | null = null;
    if (listExprs.length === 1) {
      if (node.expressionLists?.length === 1 && node.expressionLists[0]?.expressions?.length === 1) {
        const expr = listExprs[0];
        if (expr) {
          if (expr instanceof ModelicaArray) {
            finalExpr = new ModelicaFunctionCallExpression("cat", [new ModelicaIntegerLiteral(1), expr]);
          } else {
            finalExpr = new ModelicaArray([1, 1], [expr]);
          }
        }
      } else {
        finalExpr = listExprs[0] ?? null;
      }
    } else if (listExprs.length > 1) {
      finalExpr = new ModelicaFunctionCallExpression("cat", [new ModelicaIntegerLiteral(1), ...listExprs]);
    }

    if (!finalExpr) return new ModelicaArray([0], []);

    // Attempt to evaluate immediately using BUILTIN_ARRAY_HANDLERS
    if (finalExpr instanceof ModelicaFunctionCallExpression && finalExpr.functionName === "cat") {
      const handler = BUILTIN_ARRAY_HANDLERS.get("cat");
      if (handler) {
        // Recursively resolve inner cat(2, ...) calls first so the outer cat(1, ...) gets ModelicaArray args
        const resolvedArgs = finalExpr.args.map((arg) => {
          if (arg instanceof ModelicaFunctionCallExpression && arg.functionName === "cat") {
            const inner = handler(arg.args, ctx);
            if (inner) return inner;
          }
          return arg;
        });
        const folded = handler(resolvedArgs, ctx);
        if (folded) return folded;
      }
    }

    return finalExpr;
  }

  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    // Handle array comprehension: {expr for i in range}
    if (node.comprehensionClause?.expression && node.comprehensionClause.forIndexes.length > 0) {
      const comp = node.comprehensionClause;
      const body = comp.expression;
      if (!body) return null;

      // First, try to evaluate the range. If it can be resolved, expand the comprehension.
      const results: ModelicaExpression[] = [];
      let rangeResolvable = true;

      const iterate = (depth: number, innerCtx: FlattenerContext): void => {
        if (depth >= comp.forIndexes.length) {
          const result = body.accept(this, innerCtx);
          if (result) results.push(result);
          return;
        }
        const forIndex = comp.forIndexes[depth];
        if (!forIndex) return;
        const indexName = forIndex.identifier?.text;
        if (!indexName || !forIndex.expression) return;

        // Evaluate the range expression
        const rangeExpr = forIndex.expression.accept(this, innerCtx);
        const values = this.#evaluateRange(rangeExpr);
        if (!values) {
          rangeResolvable = false;
          return;
        }

        for (const value of values) {
          const loopVars = new Map(innerCtx.loopVariables ?? []);
          loopVars.set(indexName, value);
          iterate(depth + 1, { ...innerCtx, loopVariables: loopVars });
        }
      };

      iterate(0, ctx);

      if (rangeResolvable) {
        if (results.length === 0) return new ModelicaArray([0], []);
        return new ModelicaArray([results.length], results);
      }

      // Range couldn't be evaluated — preserve as symbolic comprehension: array(expr for i in range)
      const iterators: { name: string; range: ModelicaExpression }[] = [];
      const loopVars = new Map(ctx.loopVariables);
      for (const forIndex of comp.forIndexes) {
        const iterName = forIndex.identifier?.text ?? "";
        const range = forIndex.expression?.accept(this, ctx);
        if (iterName && range) {
          iterators.push({ name: iterName, range });
          loopVars.set(iterName, new ModelicaNameExpression(iterName));
        }
      }
      const bodyCtx: FlattenerContext = { ...ctx, loopVariables: loopVars };
      const bodyExpr = body.accept(this, bodyCtx);
      if (bodyExpr) {
        return new ModelicaComprehensionExpression("array", bodyExpr, iterators);
      }
      return new ModelicaArray([0], []);
    }

    const elements: ModelicaExpression[] = [];
    for (const expression of node.expressionList?.expressions ?? []) {
      const element = expression.accept(this, ctx);
      if (element != null) elements.push(element);
    }
    // If all elements are ModelicaArray with the same shape, flatten into a single
    // multi-dimensional array. e.g., {{{1,2},{3,4},{5,6}}} where each element is
    // a [3,2] array → flatten to shape [1,3,2] with 6 flat scalar elements.
    if (elements.length > 0 && elements.every((e) => e instanceof ModelicaArray)) {
      const firstArr = elements[0] as ModelicaArray;
      const innerShape = firstArr.shape;
      const allSameShape = elements.every(
        (e) =>
          e instanceof ModelicaArray &&
          e.shape.length === innerShape.length &&
          e.shape.every((d, idx) => d === innerShape[idx]),
      );
      if (allSameShape) {
        const flatElements: ModelicaExpression[] = [];
        for (const e of elements) {
          flatElements.push(...(e as ModelicaArray).elements);
        }
        return new ModelicaArray([elements.length, ...innerShape], flatElements);
      }
    }
    return new ModelicaArray([elements.length], elements);
  }

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    const operand1 = node.operand1?.accept(this, ctx);
    const operand2 = node.operand2?.accept(this, ctx);
    const operator = node.operator;
    if (operator && operand1 && operand2) return canonicalizeBinaryExpression(operator, operand1, operand2, ctx.dae);
    return null;
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode): ModelicaBooleanLiteral {
    return new ModelicaBooleanLiteral(node.value);
  }

  visitFunctionArgument(node: ModelicaFunctionArgumentSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    if (node.functionPartialApplication) {
      return node.functionPartialApplication.accept(this, ctx);
    }
    return node.expression?.accept(this, ctx) ?? null;
  }

  visitFunctionPartialApplication(
    node: ModelicaFunctionPartialApplicationSyntaxNode,
    ctx: FlattenerContext,
  ): ModelicaExpression | null {
    // Resolve the function name from the type specifier
    const rawName = node.typeSpecifier?.text ?? "";
    if (!rawName) return null;

    // Resolve to fully qualified name
    const functionName = this.#resolveFullyQualifiedName(rawName, ctx);

    // Collect function definition so it appears in the DAE output
    this.#collectFunctionDefinition(functionName, ctx);

    // Flatten bound named arguments
    const namedArgs: { name: string; value: ModelicaExpression }[] = [];
    for (const namedArg of node.namedArguments) {
      const argName = namedArg.identifier?.text ?? "";
      const argValue = namedArg.argument?.expression?.accept(this, ctx);
      if (argName && argValue) {
        namedArgs.push({ name: argName, value: argValue });
      }
    }

    return new ModelicaPartialFunctionExpression(functionName, namedArgs);
  }

  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    // Use parts-based name for regular ComponentReference functions.
    // Fall back to functionReferenceName for keyword functions (der/initial/pure).
    let functionName =
      node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ||
      (node.functionReferenceName ?? "");
    let flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      let flatArg: ModelicaExpression | null = null;
      if (arg.functionPartialApplication) {
        flatArg = this.visitFunctionPartialApplication(arg.functionPartialApplication, ctx);
      } else {
        flatArg = arg.expression?.accept(this, ctx) ?? null;
      }
      if (flatArg) flatArgs.push(flatArg);
    }

    // Pre-expansion size() resolution: resolve size(var, dim) directly from
    // class instance BEFORE arg expansion may lose inner dimension info.
    // E.g., size(b, 2) where b is Real[2, 0] — expansion loses the 0 dimension.
    if (
      functionName === "size" &&
      flatArgs.length === 2 &&
      flatArgs[1] instanceof ModelicaIntegerLiteral &&
      ctx.classInstance &&
      ctx.classInstance.classKind !== ModelicaClassKind.FUNCTION
    ) {
      // Check if the first arg is a name reference or an expanded array from one
      const firstArg = flatArgs[0];
      let varName: string | null = null;
      if (firstArg instanceof ModelicaNameExpression) {
        varName = firstArg.name;
      } else if (firstArg instanceof ModelicaArray) {
        // Array was expanded from a component reference — try to recover the name
        const firstEl = firstArg.elements[0];
        if (firstEl instanceof ModelicaSubscriptedExpression && firstEl.base instanceof ModelicaNameExpression) {
          varName = firstEl.base.name;
        } else if (firstEl instanceof ModelicaVariable) {
          const m = firstEl.name.match(/^(.+)\[/);
          if (m?.[1]) varName = m[1];
        }
      }
      if (varName) {
        // Strip prefix to get local name
        const localName = varName.includes(".") ? (varName.split(".").pop() ?? varName) : varName;
        const resolved = ctx.classInstance.resolveName(localName.split("."));
        if (
          resolved instanceof ModelicaComponentInstance &&
          resolved.classInstance instanceof ModelicaArrayClassInstance
        ) {
          const originalShape = resolved.classInstance.shape;
          let shape = originalShape;
          const isUnsized = originalShape.some((d: number) => d === 0);
          if (isUnsized) {
            let arrayBindingExpression =
              resolved.modification?.evaluatedExpression ?? resolved.modification?.expression;
            if (!arrayBindingExpression && resolved.modification?.modificationExpression?.expression) {
              const interp = new ModelicaInterpreter();
              arrayBindingExpression = resolved.modification.modificationExpression.expression.accept(
                interp,
                resolved.parent ?? undefined,
              );
            }
            if (arrayBindingExpression instanceof ModelicaArray) {
              shape = arrayBindingExpression.flatShape;
            }
          }
          const dim = (flatArgs[1] as ModelicaIntegerLiteral).value;
          if (dim >= 1 && dim <= shape.length) {
            return new ModelicaIntegerLiteral(shape[dim - 1] ?? 0);
          }
        }
      }
    }

    // Handle comprehension/reduction expressions: sum(expr for i in range)
    const compClause = node.functionCallArguments?.comprehensionClause;
    if (compClause && compClause.expression && compClause.forIndexes.length > 0) {
      // Flatten iterator ranges first
      const iterators: { name: string; range: ModelicaExpression }[] = [];
      const loopVars = new Map(ctx.loopVariables);
      for (const forIndex of compClause.forIndexes) {
        const iterName = forIndex.identifier?.text ?? "";
        const range = forIndex.expression?.accept(this, ctx);
        if (iterName && range) {
          iterators.push({ name: iterName, range });
          // Use a name expression so the iterator variable stays symbolic in the body
          loopVars.set(iterName, new ModelicaNameExpression(iterName));
        }
      }
      // Flatten the body expression with loop variables in scope
      const bodyCtx: FlattenerContext = { ...ctx, loopVariables: loopVars };
      const bodyExpr = compClause.expression.accept(this, bodyCtx);
      if (bodyExpr) {
        // Apply component-scoped function name resolution
        const compScopedResult = this.#resolveComponentScopedFunction(functionName, ctx);
        if (compScopedResult) {
          functionName = compScopedResult.specializedName;
        } else {
          functionName = this.#resolveFullyQualifiedName(functionName, ctx);
        }
        this.#collectFunctionDefinition(
          functionName,
          ctx,
          compScopedResult?.resolvedFunction,
          compScopedResult?.componentPrefix,
        );

        // Simplify identity reductions like max(i for i in {1,2,3,x}) → max(3, x)
        // This applies when:
        // 1. The function is max or min
        // 2. There's a single iterator
        // 3. The body expression is just the iterator variable (identity)
        // 4. The iterator range is an explicit array with mixed constant/symbolic elements
        const shortName = functionName.split(".").pop() ?? functionName;
        const builtinDef = BUILTIN_FUNCTIONS.get(shortName);
        if (
          builtinDef?.reduction &&
          iterators.length === 1 &&
          bodyExpr instanceof ModelicaNameExpression &&
          bodyExpr.name === iterators[0]?.name &&
          iterators[0]?.range instanceof ModelicaArray
        ) {
          const rangeArray = iterators[0].range;
          const constants: number[] = [];
          const symbolics: ModelicaExpression[] = [];
          for (const el of rangeArray.elements) {
            if (el instanceof ModelicaIntegerLiteral) constants.push(el.value);
            else if (el instanceof ModelicaRealLiteral) constants.push(el.value);
            else symbolics.push(el);
          }
          if (constants.length > 0 && symbolics.length > 0 && builtinDef.foldConstants) {
            // Fold constants
            const foldedConst = builtinDef.foldConstants(constants);
            const constExpr = Number.isInteger(foldedConst)
              ? new ModelicaIntegerLiteral(foldedConst)
              : new ModelicaRealLiteral(foldedConst);
            // Build binary calls: max(3, max(x, y)) or just max(3, x)
            let result: ModelicaExpression = constExpr;
            for (const sym of symbolics) {
              result = new ModelicaFunctionCallExpression(functionName, [result, sym]);
            }
            return result;
          }
          if (constants.length > 0 && symbolics.length === 0 && builtinDef.foldConstants) {
            // All constant — fully fold
            const foldedConst = builtinDef.foldConstants(constants);
            return Number.isInteger(foldedConst)
              ? new ModelicaIntegerLiteral(foldedConst)
              : new ModelicaRealLiteral(foldedConst);
          }
        }

        return new ModelicaComprehensionExpression(functionName, bodyExpr, iterators);
      }
    }

    // Resolve arguments: substitute constant/parameter values for structural built-in
    // function evaluation (size, fill, zeros, ones, ndims). Math built-in functions
    // (sqrt, sin, cos, etc.) and user-defined functions should preserve parameter
    // references like f(a) when a is a parameter.
    const simpleName = functionName.includes(".") ? (functionName.split(".").pop() ?? functionName) : functionName;
    const structuralBuiltins = new Set(["size", "fill", "zeros", "ones", "ndims"]);
    const isStructuralBuiltin = structuralBuiltins.has(simpleName) || structuralBuiltins.has(functionName);

    let hasParameterArg = false;
    flatArgs = flatArgs.map((arg) => {
      let resolvedArg = arg;
      if (resolvedArg instanceof ModelicaVariable) {
        if (resolvedArg.variability === ModelicaVariability.PARAMETER) {
          const isFinal = resolvedArg.isFinal || (ctx.structuralFinalParams?.has(resolvedArg.name) ?? false);
          if (!isFinal) hasParameterArg = true;
          // Substitute parameter values for built-in functions OR final parameters
          if (isStructuralBuiltin || isFinal) {
            if (resolvedArg.expression && isLiteral(resolvedArg.expression)) {
              resolvedArg = resolvedArg.expression;
            } else if (resolvedArg.expression instanceof ModelicaArray) {
              resolvedArg = resolvedArg.expression;
            }
          }
        } else if (resolvedArg.variability === ModelicaVariability.CONSTANT) {
          // Always substitute constant values
          if (resolvedArg.expression && isLiteral(resolvedArg.expression)) {
            resolvedArg = resolvedArg.expression;
          } else if (resolvedArg.expression instanceof ModelicaArray) {
            resolvedArg = resolvedArg.expression;
          }
        }
      }

      if (resolvedArg instanceof ModelicaNameExpression) {
        const componentNames = resolvedArg.name.split(".");
        const resolved = ctx.classInstance.resolveName(componentNames);
        if (resolved instanceof ModelicaComponentInstance) {
          if (!resolved.instantiated && !resolved.instantiating) {
            resolved.instantiate();
          }
          if (resolved.variability === ModelicaVariability.PARAMETER) {
            const fullName = ctx.prefix === "" ? (resolved.name ?? "") : ctx.prefix + "." + (resolved.name ?? "");
            const isFinal = resolved.isFinal || (ctx.structuralFinalParams?.has(fullName) ?? false);
            if (!isFinal) hasParameterArg = true;
            // Substitute parameter values for built-in functions OR final parameters
            if (
              (isStructuralBuiltin || isFinal) &&
              resolved.classInstance &&
              (resolved.modification?.expression != null || resolved.modification?.evaluatedExpression != null)
            ) {
              const expr = ModelicaExpression.fromClassInstance(resolved.classInstance);
              if (expr && (isLiteral(expr) || expr instanceof ModelicaArray)) {
                resolvedArg = expr;
              }
            }
          } else if (resolved.variability === ModelicaVariability.CONSTANT) {
            // Always substitute constant values
            if (
              resolved.classInstance &&
              (resolved.modification?.expression != null || resolved.modification?.evaluatedExpression != null)
            ) {
              const expr = ModelicaExpression.fromClassInstance(resolved.classInstance);
              if (expr && (isLiteral(expr) || expr instanceof ModelicaArray)) {
                resolvedArg = expr;
              }
            }
          }
        }
      }
      return resolvedArg;
    });

    // Evaluate built-in array constructors at flatten time via dispatch table
    const arrayHandler = BUILTIN_ARRAY_HANDLERS.get(functionName);
    if (arrayHandler) {
      const result = arrayHandler(flatArgs, ctx);

      if (result) return result;
    }

    // Expand default arguments from built-in function signatures
    let builtinDef = BUILTIN_FUNCTIONS.get(functionName);
    if (builtinDef) {
      while (flatArgs.length < builtinDef.inputs.length) {
        const param = builtinDef.inputs[flatArgs.length];
        if (param?.defaultValue === undefined) break;
        if (typeof param.defaultValue === "boolean") {
          flatArgs.push(new ModelicaBooleanLiteral(param.defaultValue));
        } else {
          flatArgs.push(new ModelicaIntegerLiteral(param.defaultValue));
        }
      }
    }
    // Evaluate built-in math/arithmetic functions at flatten time when all args are literals
    const foldedResult = tryFoldBuiltinFunction(functionName, flatArgs);
    if (foldedResult) return foldedResult;

    // Symbolic linspace expansion: linspace(x1, x2, n) → array(/*Real*/(-1+i) / /*Real*/(-1+n) for i in 1:n)
    // when n is not a literal (e.g., a parameter like m)
    if (functionName === "linspace" && flatArgs.length >= 3) {
      const x1 = flatArgs[0];
      const x2 = flatArgs[1];
      const n = flatArgs[2];
      // Expand only when n is symbolic (not an integer literal — if it were, tryFoldBuiltinFunction would have handled it)
      if (n && !(n instanceof ModelicaIntegerLiteral)) {
        // linspace(x1, x2, n) = x1 + (x2-x1)*(i-1)/(n-1) for i in 1:n
        // With x1=0, x2=1: (i-1)/(n-1) = (-1+i)/(-1+n)
        const iMinus1 = new ModelicaBinaryExpression(
          ModelicaBinaryOperator.ADDITION,
          new ModelicaIntegerLiteral(-1),
          new ModelicaNameExpression("i"),
        );
        const nMinus1 = new ModelicaBinaryExpression(
          ModelicaBinaryOperator.ADDITION,
          new ModelicaIntegerLiteral(-1),
          n,
        );
        const x1Val =
          x1 instanceof ModelicaIntegerLiteral ? x1.value : x1 instanceof ModelicaRealLiteral ? x1.value : null;
        const x2Val =
          x2 instanceof ModelicaIntegerLiteral ? x2.value : x2 instanceof ModelicaRealLiteral ? x2.value : null;
        let body: ModelicaExpression;
        if (x1Val === 0 && x2Val === 1) {
          // Simple case: array(/*Real*/(-1+i) / /*Real*/(-1+n) for i in 1:n)
          body = new ModelicaBinaryExpression(
            ModelicaBinaryOperator.DIVISION,
            new ModelicaFunctionCallExpression("/*Real*/", [iMinus1]),
            new ModelicaFunctionCallExpression("/*Real*/", [nMinus1]),
          );
        } else {
          // General case: x1 + (x2-x1) * /*Real*/(-1+i) / /*Real*/(-1+n)
          const range =
            x2Val != null && x1Val != null
              ? new ModelicaRealLiteral(x2Val - x1Val)
              : new ModelicaBinaryExpression(
                  ModelicaBinaryOperator.SUBTRACTION,
                  x2 ?? new ModelicaRealLiteral(0),
                  x1 ?? new ModelicaRealLiteral(0),
                );
          const ratio = new ModelicaBinaryExpression(
            ModelicaBinaryOperator.DIVISION,
            new ModelicaFunctionCallExpression("/*Real*/", [iMinus1]),
            new ModelicaFunctionCallExpression("/*Real*/", [nMinus1]),
          );
          const scaled = new ModelicaBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, range, ratio);
          body =
            x1Val === 0
              ? scaled
              : new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, x1 ?? new ModelicaRealLiteral(0), scaled);
        }
        return new ModelicaComprehensionExpression("array", body, [
          { name: "i", range: new ModelicaRangeExpression(new ModelicaIntegerLiteral(1), n, null) },
        ]);
      }
    }

    // Builtin vectorization: scalar builtins (cos, sin, etc.) applied to array variables
    // cos(phi) → array(cos($tmpVarN) for $tmpVarN in phi) when phi is an array name expression
    if (builtinDef && builtinDef.inputs.length === 1 && builtinDef.fold1 && flatArgs.length === 1) {
      const arg = flatArgs[0];
      if (arg instanceof ModelicaNameExpression) {
        // Check if this argument refers to an array variable in the DAE
        const isArrayVar =
          ctx.dae.variables.some((v) => v.name === arg.name && v.name.includes("[")) ||
          ctx.dae.variables.some((v) => v.name.startsWith("\0") && v.name.endsWith("\0" + arg.name));
        // For function body context: check if the arg is a known array-typed param
        const funcDef = ctx.dae.functions.find((f) =>
          f.variables.some(
            (v) => v.name.includes("\0" + arg.name) || (v.name.includes("[") && v.name.startsWith(arg.name)),
          ),
        );
        if (isArrayVar || funcDef) {
          const tmpVarName = `$tmpVar${tmpVarCounter++}`;
          const bodyExpr = new ModelicaFunctionCallExpression(functionName, [new ModelicaNameExpression(tmpVarName)]);
          return new ModelicaComprehensionExpression("array", bodyExpr, [{ name: tmpVarName, range: arg }]);
        }
      }
    }
    // Per-parameter type coercion: coerce integer args to Real only where the
    // built-in function signature expects a Real parameter.
    // For polymorphic builtins (with overloads), pick the best matching signature
    // to avoid coercing integers when an Integer overload exists.
    if (builtinDef) {
      let effectiveInputs = builtinDef.inputs;
      if (builtinDef.overloads && builtinDef.overloads.length > 0) {
        // Select the first overload where all args match parameter types
        const argIsInteger = (arg: ModelicaExpression): boolean => {
          if (arg instanceof ModelicaIntegerLiteral) return true;
          if (arg instanceof ModelicaFunctionCallExpression) {
            const fnDef = BUILTIN_FUNCTIONS.get(arg.functionName);
            if (fnDef?.outputType === "Integer") return true;
            // Check if there's an Integer overload matching all-integer args
            if (fnDef?.overloads) {
              const intOverload = fnDef.overloads.find((o) => o.outputType === "Integer");
              if (intOverload && arg.args.every((a) => argIsInteger(a))) return true;
            }
            return false;
          }
          if (arg instanceof ModelicaVariable && arg instanceof ModelicaIntegerVariable) return true;
          if (arg instanceof ModelicaBinaryExpression) return argIsInteger(arg.operand1) && argIsInteger(arg.operand2);
          if (arg instanceof ModelicaNameExpression)
            return !!ctx.dae.variables.find((v) => v.name === arg.name && v instanceof ModelicaIntegerVariable);
          return false;
        };
        for (const overload of builtinDef.overloads) {
          let matches = true;
          for (let i = 0; i < flatArgs.length && i < overload.inputs.length; i++) {
            const paramType = overload.inputs[i]?.type;
            const arg = flatArgs[i];
            if (arg && paramType === "Integer" && !argIsInteger(arg)) {
              matches = false;
              break;
            }
            if (arg && paramType === "Real" && argIsInteger(arg)) {
              matches = false;
              break;
            }
          }
          if (matches) {
            effectiveInputs = overload.inputs;
            break;
          }
        }
      }
      for (let i = 0; i < flatArgs.length && i < effectiveInputs.length; i++) {
        if (effectiveInputs[i]?.type === "Real") {
          const coerced = castToReal(flatArgs[i] ?? null);
          if (coerced && coerced !== flatArgs[i]) flatArgs[i] = coerced;
        }
      }
    }
    // Component-scoped function specialization:
    // When a function is called through a component reference (e.g., n1.f(time)),
    // create a specialized copy with instance-specific constants.
    let resolvedOverride: ModelicaClassInstance | undefined;
    let componentPrefix: string | undefined;
    const compScopedResult = this.#resolveComponentScopedFunction(functionName, ctx);
    if (compScopedResult) {
      functionName = compScopedResult.specializedName;
      resolvedOverride = compScopedResult.resolvedFunction;
      componentPrefix = compScopedResult.componentPrefix;
    } else if (!ModelicaSyntaxFlattener.#isBuiltinFunction(functionName)) {
      // Resolve to fully qualified name for user-defined functions
      functionName = this.#resolveFullyQualifiedName(functionName, ctx);
    }

    const originalName = functionName;
    let isExternalBuiltinAlias = false;

    // Check if the function resolves to an external clause mapping to a builtin
    // (e.g. `function f = Modelica.Math.atan2` where atan2 has `external "C" y=atan2(u1,u2)`)
    if (!builtinDef) {
      const externalBuiltin = this.#resolveExternalBuiltin(functionName, ctx);
      if (externalBuiltin) {
        // Before switching to the builtin name, collect the function definition for
        // user-defined wrappers that have their OWN external clause (e.g. `mylog`
        // with `external "C" y=log(x)`). Skip aliases like `function f = X.atan2`.
        const parts = originalName.split(".");
        const resolved = ctx.classInstance.resolveName(parts);
        if (resolved instanceof ModelicaClassInstance) {
          const specifier = resolved.abstractSyntaxNode?.classSpecifier;
          if (specifier instanceof ModelicaLongClassSpecifierSyntaxNode && specifier.externalFunctionClause) {
            const lang = specifier.externalFunctionClause.languageSpecification?.language?.text ?? "";
            if (lang === "builtin") {
              // Platform builtin — use unqualified name, don't collect
              isExternalBuiltinAlias = true;
            } else {
              // User-defined wrapper with external "C"/"FORTRAN" — collect the function definition
              this.#collectFunctionDefinition(originalName, ctx, resolvedOverride, componentPrefix);
            }
          } else {
            // Short class alias — don't collect the alias as a function definition
            isExternalBuiltinAlias = true;
          }
        }
        functionName = externalBuiltin;
        builtinDef = BUILTIN_FUNCTIONS.get(functionName);
      }
    }

    // Collect function definition (skips builtins automatically; also skip short class aliases to builtins)
    if (!isExternalBuiltinAlias) {
      this.#collectFunctionDefinition(originalName, ctx, resolvedOverride, componentPrefix);
    }

    // Re-attempt constant folding after external builtin resolution
    // (e.g., mylog(100) → log(100) → 4.605...)
    if (builtinDef) {
      const foldedResult = tryFoldBuiltinFunction(functionName, flatArgs);
      if (foldedResult) return foldedResult;
    }

    // Literal defaults (e.g. eps=1e-6) are always expanded.
    // Non-literal defaults are expanded only if they reference names external to the
    // function (e.g. r=p where p is from the enclosing model). Defaults that only
    // reference other function inputs (e.g. y=2*x) are left for the interpreter.
    if (!builtinDef) {
      let funcDef = ctx.dae.functions.find((f) => f.name === functionName);
      if (!funcDef && ctx.rootDae) {
        funcDef = ctx.rootDae.functions.find((f) => f.name === functionName);
      }
      if (funcDef) {
        const inputVars = funcDef.variables.filter((v) => v.causality === "input");
        const funcLocalNames = new Set(funcDef.variables.map((v) => v.name));

        /** Check if an expression references names outside the function scope */
        const refsExternal = (expr: ModelicaExpression): boolean => {
          if (expr instanceof ModelicaNameExpression) return !funcLocalNames.has(expr.name);
          if (expr instanceof ModelicaBinaryExpression) {
            return refsExternal(expr.operand1) || refsExternal(expr.operand2);
          }
          if (expr instanceof ModelicaUnaryExpression) return refsExternal(expr.operand);
          if (expr instanceof ModelicaFunctionCallExpression) return expr.args.some(refsExternal);
          if (expr instanceof ModelicaArray) return expr.elements.some(refsExternal);
          return false;
        };

        while (flatArgs.length < inputVars.length) {
          const param = inputVars[flatArgs.length];
          if (!param?.expression) break;
          if (isLiteral(param.expression) || isLiteralArray(param.expression)) {
            flatArgs.push(param.expression);
          } else if (refsExternal(param.expression)) {
            flatArgs.push(param.expression);
          } else {
            break; // Internal-only default — let interpreter handle it
          }
        }
      }
    }

    // Per-parameter type coercion: coerce integer args to Real only where the
    // function signature expects a Real parameter
    if (!builtinDef) {
      // Search both the current DAE and the root DAE (where function defs are collected
      // during nested function body flattening) for the function definition
      let funcDef = ctx.dae.functions.find((f) => f.name === functionName);
      if (!funcDef && ctx.rootDae) {
        funcDef = ctx.rootDae.functions.find((f) => f.name === functionName);
      }

      if (funcDef) {
        const inputVars = funcDef.variables.filter((v) => v.causality === "input");

        // Auto-vectorization scalarization (§12.4.6):
        // When a function takes scalar inputs but receives array arguments,
        // scalarize the call into individual scalar calls wrapped in a ModelicaArray.
        // e.g., foo({a,b,c}) where foo(Real x) → {foo(a), foo(b), foo(c)}
        // Only scalarize when ALL scalar parameters receive ModelicaArray arguments.
        let vectorizationSize = -1;
        let vectorizationShape: number[] = [];
        const isScalarParam: boolean[] = [];
        let allScalarParamsHaveArrayArgs = true;
        for (let i = 0; i < flatArgs.length && i < inputVars.length; i++) {
          // A scalar parameter has no encoded array prefix (\0[dims]\0name)
          const paramIsScalar = !inputVars[i]?.name?.startsWith("\0");
          isScalarParam.push(paramIsScalar);
          if (paramIsScalar && flatArgs[i] instanceof ModelicaArray) {
            const arr = flatArgs[i] as ModelicaArray;
            if (vectorizationSize < 0) {
              vectorizationSize = arr.elements.length;
              vectorizationShape = [...arr.shape];
            }
          } else if (paramIsScalar && vectorizationSize >= 0 && !(flatArgs[i] instanceof ModelicaArray)) {
            // A scalar param without array arg — can't vectorize cleanly
            allScalarParamsHaveArrayArgs = false;
          }
        }
        if (vectorizationSize > 0 && allScalarParamsHaveArrayArgs) {
          // Reject vectorization if any array param also receives a higher-dimensional
          // array needing slicing (§12.4.6 only covers scalar params). OMC rejects this.
          let rejectedVectorization = false;
          for (let i = 0; i < flatArgs.length && i < inputVars.length; i++) {
            if (!isScalarParam[i] && flatArgs[i] instanceof ModelicaArray) {
              const arr = flatArgs[i] as ModelicaArray;
              if (arr.shape[0] === vectorizationSize) {
                allScalarParamsHaveArrayArgs = false;
                rejectedVectorization = true;
                break;
              }
            }
          }
          if (rejectedVectorization) {
            // Build the "No matching function found" diagnostic
            // 1. Render args as text for callExpr
            const argTexts: string[] = [];
            for (const arg of flatArgs) {
              const out = new StringWriter();
              const printer = new ModelicaDAEPrinter(out);
              arg?.accept(printer);
              argTexts.push(out.toString());
            }
            const callExpr = `${originalName}(${argTexts.join(", ")})`;

            // 2. Infer arg types for the call signature
            const inferArgType = (arg: ModelicaExpression | null | undefined): string => {
              if (!arg) return "?";
              if (arg instanceof ModelicaIntegerLiteral) return "Integer";
              if (arg instanceof ModelicaRealLiteral) return "Real";
              if (arg instanceof ModelicaBooleanLiteral) return "Boolean";
              if (arg instanceof ModelicaStringLiteral) return "String";
              if (arg instanceof ModelicaArray) {
                // Get shape and element type
                const shape = arg.shape;
                const flatEl = [...arg.flatElements];
                const elemType = flatEl.length > 0 ? inferArgType(flatEl[0]) : "?";
                return `${elemType}[${shape.join(", ")}]`;
              }
              return "Real"; // fallback
            };

            // Helper to get type name from variable class
            const varTypeName = (v: ModelicaVariable | undefined): string => {
              if (!v) return "Real";
              if (v instanceof ModelicaIntegerVariable) return "Integer";
              if (v instanceof ModelicaBooleanVariable) return "Boolean";
              if (v instanceof ModelicaStringVariable) return "String";
              return "Real";
            };

            // 3. Build call type signature: .foo<function>(Integer[3] x, Integer[3, 2] x2) => Real
            const callParamSigs: string[] = [];
            for (let i = 0; i < Math.min(flatArgs.length, inputVars.length); i++) {
              const paramName = inputVars[i]?.name?.replace(/\0.*\0/, "") ?? `arg${i}`;
              const argTypeName = inferArgType(flatArgs[i]);
              callParamSigs.push(`${argTypeName} ${paramName}`);
            }
            const outputVars = funcDef.variables.filter((v) => v.causality === "output");
            const retTypeName = outputVars.length > 0 ? varTypeName(outputVars[0]) : "()";
            const callSig = `.${functionName}<function>(${callParamSigs.join(", ")}) => ${retTypeName} in component <NO COMPONENT>`;

            // 4. Build candidate signature: .foo<function>(Real x, Real[2] x2) => Real
            const candParamSigs: string[] = [];
            for (const iv of inputVars) {
              const rawName = iv.name ?? "";
              const isArrayParam = rawName.startsWith("\0");
              const baseType = varTypeName(iv);
              if (isArrayParam) {
                // Extract dims and name from encoded format: \0[dims]\0name
                const parts = rawName.split("\0").filter(Boolean);
                const dimsStr = parts[0]?.replace(/^\[/, "").replace(/\]$/, "") ?? "";
                const varName = parts[1] ?? "";
                candParamSigs.push(`${baseType}[${dimsStr}] ${varName}`);
              } else {
                candParamSigs.push(`${baseType} ${rawName}`);
              }
            }
            const candSig = `.${functionName}<function>(${candParamSigs.join(", ")}) => ${retTypeName}`;

            ctx.dae.diagnostics.push(
              makeDiagnostic(ModelicaErrorCode.NO_MATCHING_FUNCTION, node, callExpr, callSig, candSig),
            );
            return null;
          }
        }
        if (vectorizationSize > 0 && allScalarParamsHaveArrayArgs) {
          // Build array of scalar calls
          const callName = isExternalBuiltinAlias ? functionName : originalName;
          const scalarCalls: ModelicaExpression[] = [];
          for (let ei = 0; ei < vectorizationSize; ei++) {
            const scalarArgs: ModelicaExpression[] = [];
            for (let ai = 0; ai < flatArgs.length; ai++) {
              const arg = flatArgs[ai];
              if (isScalarParam[ai] && arg instanceof ModelicaArray && arg.elements.length === vectorizationSize) {
                // Extract the i-th element for this scalar parameter
                scalarArgs.push(arg.elements[ei] as ModelicaExpression);
              } else if (!isScalarParam[ai] && arg instanceof ModelicaArray) {
                // For array parameters, extract the i-th "slice" along the vectorization dim
                // e.g., for Real[2] x2 with arg {{1,2},{3,4},{5,6}}, extract {1,2}, {3,4}, {5,6}
                if (arg.elements.length === vectorizationSize) {
                  scalarArgs.push(arg.elements[ei] as ModelicaExpression);
                } else {
                  scalarArgs.push(arg);
                }
              } else {
                // Non-vectorized arg (same scalar for all calls)
                scalarArgs.push(arg as ModelicaExpression);
              }
            }
            // Coerce integer args to Real for Real parameters
            for (let ai = 0; ai < scalarArgs.length && ai < inputVars.length; ai++) {
              if (inputVars[ai] instanceof ModelicaRealVariable) {
                const coerced = coerceToReal(scalarArgs[ai] ?? null, ctx.dae);
                if (coerced && coerced !== scalarArgs[ai]) scalarArgs[ai] = coerced;
              }
            }
            scalarCalls.push(new ModelicaFunctionCallExpression(callName, scalarArgs));
          }
          // Try to constant-evaluate each scalarized call via the interpreter
          const funcInstance = ctx.classInstance.resolveName(functionName.split("."));
          if (funcInstance instanceof ModelicaClassInstance && funcInstance.classKind === ModelicaClassKind.FUNCTION) {
            const funcInputParams = Array.from(funcInstance.inputParameters);
            for (let ci = 0; ci < scalarCalls.length; ci++) {
              const call = scalarCalls[ci];
              if (!(call instanceof ModelicaFunctionCallExpression)) continue;
              if (!call.args.every((a) => isLiteral(a) || isLiteralArray(a))) continue;
              try {
                const params: ModelicaParameterModification[] = [];
                for (let pi = 0; pi < call.args.length && pi < funcInputParams.length; pi++) {
                  const pName = funcInputParams[pi]?.name;
                  if (pName && call.args[pi]) {
                    params.push(
                      new ModelicaParameterModification(
                        ctx.classInstance,
                        pName,
                        null,
                        call.args[pi] as ModelicaExpression,
                      ),
                    );
                  }
                }
                const mod = new ModelicaModification(ctx.classInstance, params);
                if (funcInstance.abstractSyntaxNode) {
                  const mergedMod = ModelicaModification.merge(funcInstance.modification, mod);
                  const clone = ModelicaClassInstance.new(
                    funcInstance.parent,
                    funcInstance.abstractSyntaxNode,
                    mergedMod,
                  );
                  clone.instantiate();
                  const interpFallback = new ModelicaInterpreter(true);
                  for (const stmt of clone.algorithms) {
                    stmt.accept(interpFallback, clone);
                  }
                  const outParams = Array.from(clone.outputParameters);
                  if (outParams.length >= 1 && outParams[0]?.classInstance) {
                    const outExpr = ModelicaExpression.fromClassInstance(outParams[0].classInstance);
                    if (outExpr && (isLiteral(outExpr) || isLiteralArray(outExpr))) {
                      scalarCalls[ci] = outExpr;
                    }
                  }
                }
              } catch {
                // Evaluation failed — keep the symbolic call
              }
            }
          }
          return new ModelicaArray(vectorizationShape, scalarCalls);
        }

        // Array-param vectorization: when array params receive higher-dimensional args
        // e.g., foo(1, {{{1,2},{3,4},{5,6}}}) where foo(Real x, Real[2] x2)
        // The arg for x2 has shape [1,3,2] but x2 expects [2] — strip outer [1,3] dims
        if (vectorizationSize <= 0) {
          let arrayVecSize = -1;
          for (let i = 0; i < flatArgs.length && i < inputVars.length; i++) {
            if (!isScalarParam[i] && flatArgs[i] instanceof ModelicaArray) {
              const arr = flatArgs[i] as ModelicaArray;
              // Count declared dims from the encoded name: \0[dim1,dim2,...]\0varName
              const paramName = inputVars[i]?.name ?? "";
              const dimMatch = paramName.match(/^\0\[([^\]]*)\]\0/);
              const declaredDimCount = dimMatch ? (dimMatch[1] ?? "").split(",").length : 0;
              const argDimCount = arr.shape.length;
              if (argDimCount > declaredDimCount) {
                // Extra outer dims — compute vectorization size as product of extra dims
                const extraDims = arr.shape.slice(0, argDimCount - declaredDimCount);
                const vecSize = extraDims.reduce((a, b) => a * b, 1);
                if (arrayVecSize < 0) {
                  arrayVecSize = vecSize;
                }
              }
            }
          }

          if (arrayVecSize > 0) {
            const callName = isExternalBuiltinAlias ? functionName : originalName;
            const scalarCalls: ModelicaExpression[] = [];
            for (let ei = 0; ei < arrayVecSize; ei++) {
              const scalarArgs: ModelicaExpression[] = [];
              for (let ai = 0; ai < flatArgs.length && ai < inputVars.length; ai++) {
                if (isScalarParam[ai]) {
                  // Scalar params broadcast — same value for all calls
                  scalarArgs.push(flatArgs[ai] as ModelicaExpression);
                } else if (flatArgs[ai] instanceof ModelicaArray) {
                  const arr = flatArgs[ai] as ModelicaArray;
                  const paramName = inputVars[ai]?.name ?? "";
                  const dimMatch = paramName.match(/^\0\[([^\]]*)\]\0/);
                  const declaredDimCount = dimMatch ? (dimMatch[1] ?? "").split(",").length : 0;
                  const argDimCount = arr.shape.length;
                  if (argDimCount > declaredDimCount) {
                    // Flatten outer dims and extract the i-th slice
                    const innerSize = arr.shape.slice(argDimCount - declaredDimCount).reduce((a, b) => a * b, 1);
                    const start = ei * innerSize;
                    const sliceElements = arr.elements.slice(start, start + innerSize);
                    const innerShape = arr.shape.slice(argDimCount - declaredDimCount);
                    if (innerShape.length === 0) {
                      scalarArgs.push(sliceElements[0] ?? arr);
                    } else {
                      scalarArgs.push(new ModelicaArray(innerShape, sliceElements));
                    }
                  } else {
                    scalarArgs.push(arr);
                  }
                } else {
                  scalarArgs.push(flatArgs[ai] as ModelicaExpression);
                }
              }
              // Coerce integer args to Real for Real parameters
              for (let ai = 0; ai < scalarArgs.length && ai < inputVars.length; ai++) {
                if (inputVars[ai] instanceof ModelicaRealVariable) {
                  const coerced = coerceToReal(scalarArgs[ai] ?? null, ctx.dae);
                  if (coerced && coerced !== scalarArgs[ai]) scalarArgs[ai] = coerced;
                }
              }
              scalarCalls.push(new ModelicaFunctionCallExpression(callName, scalarArgs));
            }
            // Try to constant-evaluate each call via the interpreter
            const funcInstance = ctx.classInstance.resolveName(functionName.split("."));
            if (
              funcInstance instanceof ModelicaClassInstance &&
              funcInstance.classKind === ModelicaClassKind.FUNCTION
            ) {
              const funcInputParams = Array.from(funcInstance.inputParameters);
              for (let ci = 0; ci < scalarCalls.length; ci++) {
                const call = scalarCalls[ci];
                if (!(call instanceof ModelicaFunctionCallExpression)) continue;
                if (!call.args.every((a) => isLiteral(a) || isLiteralArray(a))) continue;
                try {
                  const params: ModelicaParameterModification[] = [];
                  for (let pi = 0; pi < call.args.length && pi < funcInputParams.length; pi++) {
                    const pName = funcInputParams[pi]?.name;
                    if (pName && call.args[pi]) {
                      params.push(
                        new ModelicaParameterModification(
                          ctx.classInstance,
                          pName,
                          null,
                          call.args[pi] as ModelicaExpression,
                        ),
                      );
                    }
                  }
                  const mod = new ModelicaModification(ctx.classInstance, params);
                  if (funcInstance.abstractSyntaxNode) {
                    const mergedMod = ModelicaModification.merge(funcInstance.modification, mod);
                    const clone = ModelicaClassInstance.new(
                      funcInstance.parent,
                      funcInstance.abstractSyntaxNode,
                      mergedMod,
                    );
                    clone.instantiate();
                    const interpFallback = new ModelicaInterpreter(true);
                    for (const stmt of clone.algorithms) {
                      stmt.accept(interpFallback, clone);
                    }
                    const outParams = Array.from(clone.outputParameters);
                    if (outParams.length >= 1 && outParams[0]?.classInstance) {
                      const outExpr = ModelicaExpression.fromClassInstance(outParams[0].classInstance);
                      if (outExpr && (isLiteral(outExpr) || isLiteralArray(outExpr))) {
                        scalarCalls[ci] = outExpr;
                      }
                    }
                  }
                } catch {
                  // evaluation failed — keep symbolic call
                }
              }
            }
            return new ModelicaArray([arrayVecSize], scalarCalls);
          }
        }

        for (let i = 0; i < flatArgs.length && i < inputVars.length; i++) {
          if (inputVars[i] instanceof ModelicaRealVariable) {
            const coerced = coerceToReal(flatArgs[i] ?? null, ctx.dae);
            if (coerced && coerced !== flatArgs[i]) flatArgs[i] = coerced;
          }
        }
      } else if (flatArgs.some((a) => isRealTyped(a, ctx.dae))) {
        // Fallback: blanket coercion when function definition not available
        for (let i = 0; i < flatArgs.length; i++) {
          const coerced = coerceToReal(flatArgs[i] ?? null, ctx.dae);
          if (coerced && coerced !== flatArgs[i]) flatArgs[i] = coerced;
        }
      }
    }

    const result = new ModelicaFunctionCallExpression(isExternalBuiltinAlias ? functionName : originalName, flatArgs);

    // Only inline user-defined function calls when ALL arguments are compile-time constants.
    // Parameters are NOT constants — they can change between simulations.
    // Check for: literals, literal arrays, or constant variable references with known values.
    const isConstantEvaluable = (expr: ModelicaExpression): boolean => {
      if (isLiteral(expr) || isLiteralArray(expr)) return true;
      if (expr instanceof ModelicaNameExpression) {
        const variable = ctx.dae.variables.find((v) => v.name === expr.name);
        if (variable) {
          if (variable.variability === ModelicaVariability.CONSTANT && variable.expression) {
            return isLiteral(variable.expression) || isLiteralArray(variable.expression);
          }
        } else {
          // If not found in flat DAE variables, check class instance hierarchy (for constants not yet flattened)
          const resolved = ctx.classInstance.resolveName(expr.name.split("."));
          if (resolved instanceof ModelicaComponentInstance) {
            if (resolved.variability === ModelicaVariability.CONSTANT && resolved.modification?.expression) {
              const flattenedExpr = resolved.modification.expression;
              if (flattenedExpr) return isLiteral(flattenedExpr) || isLiteralArray(flattenedExpr);
            }
          }
        }
      }
      if (expr instanceof ModelicaVariable) {
        if (expr.variability === ModelicaVariability.CONSTANT && expr.expression) {
          return isLiteral(expr.expression) || isLiteralArray(expr.expression);
        }
      }
      if (expr instanceof ModelicaSubscriptedExpression) {
        return isConstantEvaluable(expr.base) && expr.subscripts.every(isConstantEvaluable);
      }
      if (expr instanceof ModelicaArray) {
        return expr.elements.every(isConstantEvaluable);
      }
      return false;
    };
    if (!hasParameterArg && flatArgs.every((arg) => isConstantEvaluable(arg))) {
      // Also check that unfilled default arguments (those beyond flatArgs) don't reference
      // names external to the function (e.g. model variables). Defaults that only reference
      // other function inputs (like `y = 2*x`) are fine — the interpreter resolves them
      // within the function scope. But defaults referencing external model variables
      // (like `r = p` where `p` is a model variable) cannot be evaluated at compile time.
      let defaultsAreConstant = true;
      if (!builtinDef) {
        const funcDef = ctx.dae.functions.find((f) => f.name === functionName);
        if (funcDef) {
          const inputVars = funcDef.variables.filter((v) => v.causality === "input");
          // Names that are local to the function (inputs, outputs, protected vars)
          const funcLocalNames = new Set(funcDef.variables.map((v) => v.name));

          /** Check if a default expression references any name outside the function scope */
          const referencesExternalName = (expr: ModelicaExpression): boolean => {
            if (expr instanceof ModelicaNameExpression) {
              return !funcLocalNames.has(expr.name);
            }
            if (expr instanceof ModelicaBinaryExpression) {
              return referencesExternalName(expr.operand1) || referencesExternalName(expr.operand2);
            }
            if (expr instanceof ModelicaUnaryExpression) {
              return referencesExternalName(expr.operand);
            }
            if (expr instanceof ModelicaFunctionCallExpression) {
              return expr.args.some(referencesExternalName);
            }
            if (expr instanceof ModelicaArray) {
              return expr.elements.some(referencesExternalName);
            }
            return false;
          };

          for (let i = flatArgs.length; i < inputVars.length; i++) {
            const defaultExpr = inputVars[i]?.expression;
            if (!defaultExpr) continue;
            if (referencesExternalName(defaultExpr)) {
              defaultsAreConstant = false;
              break;
            }
          }
        }
      }
      if (defaultsAreConstant) {
        const interp = new ModelicaInterpreter(true);
        const evalResult = node.accept(interp, ctx.classInstance);
        if (evalResult) {
          return evalResult;
        }
        // Fallback: the interpreter failed on the original AST (e.g., because the original
        // args contained parameter-dependent sub-expressions like size(test2(b), 1) that
        // were resolved during flattening but remain in the AST). If all flattened args
        // are still constant, try evaluating by manually applying the flattened literal
        // args to the function instance.
        if (!builtinDef && flatArgs.every((a) => isLiteral(a) || isLiteralArray(a))) {
          const funcInstance = ctx.classInstance.resolveName(functionName.split("."));
          if (funcInstance instanceof ModelicaClassInstance && funcInstance.classKind === ModelicaClassKind.FUNCTION) {
            const inputParams = Array.from(funcInstance.inputParameters);
            if (flatArgs.length <= inputParams.length) {
              const params: ModelicaParameterModification[] = [];
              for (let i = 0; i < flatArgs.length; i++) {
                const pName = inputParams[i]?.name;
                if (pName && flatArgs[i]) {
                  params.push(new ModelicaParameterModification(ctx.classInstance, pName, null, flatArgs[i]));
                }
              }
              const mod = new ModelicaModification(ctx.classInstance, params);
              if (funcInstance.abstractSyntaxNode) {
                try {
                  const mergedMod = ModelicaModification.merge(funcInstance.modification, mod);
                  const clone = ModelicaClassInstance.new(
                    funcInstance.parent,
                    funcInstance.abstractSyntaxNode,
                    mergedMod,
                  );
                  clone.instantiate();
                  const interpFallback = new ModelicaInterpreter(true);
                  for (const stmt of clone.algorithms) {
                    stmt.accept(interpFallback, clone);
                  }
                  const outParams = Array.from(clone.outputParameters);
                  if (outParams.length >= 1 && outParams[0]?.classInstance) {
                    const outExpr = ModelicaExpression.fromClassInstance(outParams[0].classInstance);
                    if (outExpr && (isLiteral(outExpr) || isLiteralArray(outExpr))) {
                      return outExpr;
                    }
                  }
                } catch {
                  // Evaluation failed — fall through to symbolic result
                }
              }
            }
          }
        }
      }
    }

    return result;
  }

  /** Recursively scan an AST syntax node for function call references and collect their definitions. */
  collectFunctionRefsFromAST(node: ModelicaExpressionSyntaxNode | null | undefined, ctx: FlattenerContext): void {
    if (!node) return;
    if (node instanceof ModelicaFunctionCallSyntaxNode) {
      const funcName =
        node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ||
        (node.functionReferenceName ?? "");
      if (funcName) {
        const qualifiedName = this.#resolveFullyQualifiedName(funcName, ctx);
        this.#collectFunctionDefinition(qualifiedName, ctx);
      }
      // Also scan arguments recursively
      for (const arg of node.functionCallArguments?.arguments ?? []) {
        this.collectFunctionRefsFromAST(arg.expression, ctx);
      }
    } else if (node instanceof ModelicaBinaryExpressionSyntaxNode) {
      this.collectFunctionRefsFromAST(node.operand1, ctx);
      this.collectFunctionRefsFromAST(node.operand2, ctx);
    }
    // For other compound types, recurse into known child expression properties
  }

  /**
   * Resolve a potentially import-aliased function name to its fully qualified form.
   * E.g. `Streams.print` → `Modelica.Utilities.Streams.print` when
   * `import Modelica.Utilities.Streams;` is in scope.
   */
  #resolveFullyQualifiedName(functionName: string, ctx: FlattenerContext): string {
    const parts = functionName.split(".");
    const resolved = ctx.classInstance.resolveName(parts);
    if (!(resolved instanceof ModelicaClassInstance)) return functionName;

    // Build FQ name by walking the parent chain
    const nameSegments: string[] = [];
    let current: ModelicaClassInstance | null = resolved;
    while (current) {
      const name = current.name;
      if (!name) break;
      // Stop at the library root (ModelicaLibrary)
      if (current.parent === null || current.parent === undefined) {
        nameSegments.unshift(name);
        break;
      }
      nameSegments.unshift(name);
      current = current.parent instanceof ModelicaClassInstance ? current.parent : null;
    }
    return nameSegments.length > 0 ? nameSegments.join(".") : functionName;
  }

  /**
   * Check if a function (following extends chains) has an external clause
   * that maps to a builtin function. If so, return the builtin name.
   * This handles cases like `function f = Modelica.Math.atan2` where
   * `Modelica.Math.atan2` has `external "C" y=atan2(u1,u2)`.
   */
  #resolveExternalBuiltin(functionName: string, ctx: FlattenerContext): string | null {
    const parts = functionName.split(".");
    const resolved = ctx.classInstance.resolveName(parts);
    if (!(resolved instanceof ModelicaClassInstance)) return null;

    // Instantiate to resolve short class defs
    if (!resolved.instantiated && !resolved.instantiating) resolved.instantiate();

    // Check candidates: the resolved class itself, and for short class defs,
    // the inner classInstance (which is the cloned target class)
    const candidates: ModelicaClassInstance[] = [resolved];
    const inner = (resolved as { classInstance?: ModelicaClassInstance | null }).classInstance;
    if (inner) candidates.push(inner);

    for (const cls of candidates) {
      const classSpecifier = cls.abstractSyntaxNode?.classSpecifier;
      if (classSpecifier instanceof ModelicaLongClassSpecifierSyntaxNode) {
        const ext = classSpecifier.externalFunctionClause;
        if (ext) {
          const lang = ext.languageSpecification?.language?.text ?? "";
          const callName = ext.externalFunctionCall?.functionName?.text ?? cls.name ?? "";
          // Check for known C builtins (e.g., atan2) or "builtin" language spec
          if (callName && (ModelicaSyntaxFlattener.#isBuiltinFunction(callName) || lang === "builtin")) {
            return callName;
          }
        }
      }
    }
    return null;
  }

  /**
   * Detect a component-scoped function call (e.g., n1.f where n1 is a component of type N).
   * Returns the specialized name (N$n1.f), the resolved function class, and the component prefix.
   */
  #resolveComponentScopedFunction(
    rawName: string,
    ctx: FlattenerContext,
  ): { specializedName: string; resolvedFunction: ModelicaClassInstance; componentPrefix: string } | null {
    // If we're already inside a component-scoped function body, rewrite sibling function calls
    if (ctx.componentFunctionPrefix) {
      // e.g., inside N$n1.f, a call to x() should become N$n1.x()
      // Check if the function resolves to a sibling function in the enclosing type class
      const typePrefix = ctx.componentFunctionPrefix?.split("$")[0] ?? ""; // "N"
      const fqName = this.#resolveFullyQualifiedName(rawName, ctx);
      if (typePrefix && fqName.startsWith(typePrefix + ".")) {
        const localFuncName = fqName.substring(typePrefix.length + 1); // "x"
        const specializedName = `${ctx.componentFunctionPrefix}.${localFuncName}`;
        const resolved = ctx.classInstance.resolveName(rawName.split("."));
        if (resolved instanceof ModelicaClassInstance) {
          return {
            specializedName,
            resolvedFunction: resolved,
            componentPrefix: ctx.componentFunctionPrefix,
          };
        }
      }
      return null;
    }

    // Check if the first part of the name resolves to a component instance
    const parts = rawName.split(".");
    if (parts.length < 2) return null;

    const firstResolved = ctx.classInstance.resolveSimpleName(parts[0]);
    if (!(firstResolved instanceof ModelicaComponentInstance)) return null;

    // It's a component-scoped function call
    if (!firstResolved.instantiated && !firstResolved.instantiating) firstResolved.instantiate();
    const classInst = firstResolved.classInstance;
    if (!classInst) return null;

    const typeName = classInst.name;
    if (!typeName) return null;

    // Resolve the function through the component's class instance
    const funcParts = parts.slice(1);
    let resolved: ModelicaNamedElement | null = classInst;
    for (const part of funcParts) {
      if (!resolved) return null;
      resolved = resolved.resolveSimpleName(part, false, true);
      if (!resolved) return null;
    }
    if (!(resolved instanceof ModelicaClassInstance)) return null;
    if (
      resolved.classKind !== ModelicaClassKind.FUNCTION &&
      resolved.classKind !== ModelicaClassKind.OPERATOR_FUNCTION
    ) {
      return null;
    }

    const componentPath = parts.slice(0, -1).join("."); // "n1"
    const funcName = funcParts.join("."); // "f"
    const componentPrefix = `${typeName}$${componentPath}`; // "N$n1"
    const specializedName = `${componentPrefix}.${funcName}`; // "N$n1.f"

    return { specializedName, resolvedFunction: resolved, componentPrefix };
  }

  /** Resolve a function name and flatten its definition into ctx.dae.functions. */
  #collectFunctionDefinition(
    functionName: string,
    ctx: FlattenerContext,
    resolvedOverride?: ModelicaClassInstance,
    componentPrefix?: string,
  ): void {
    // Skip built-in functions (only unqualified names are builtins; qualified names
    // like Modelica.Utilities.Streams.print are user-defined even if simple name matches)
    if (!functionName.includes(".") && ModelicaSyntaxFlattener.#isBuiltinFunction(functionName)) return;
    // Skip if already collected or currently being collected (prevents recursion).
    // Check recursively through all nested function DAEs to avoid duplicates when
    // the same function is referenced both inside a function body and at class level.
    const targetDae = ctx.rootDae ?? ctx.dae;
    if (ModelicaSyntaxFlattener.#hasFunctionInDAE(targetDae, functionName)) return;
    if (ModelicaSyntaxFlattener.#collectingFunctions.has(functionName)) return;
    ModelicaSyntaxFlattener.#collectingFunctions.add(functionName);

    // Resolve the function class — use override if provided (for component-scoped functions)
    let resolved: ModelicaClassInstance;
    if (resolvedOverride) {
      resolved = resolvedOverride;
    } else {
      const parts = functionName.split(".");
      const r = ctx.classInstance.resolveName(parts);
      if (!(r instanceof ModelicaClassInstance)) {
        ModelicaSyntaxFlattener.#collectingFunctions.delete(functionName);
        return;
      }
      resolved = r;
    }
    if (
      resolved.classKind !== ModelicaClassKind.FUNCTION &&
      resolved.classKind !== ModelicaClassKind.OPERATOR_FUNCTION
    ) {
      ModelicaSyntaxFlattener.#collectingFunctions.delete(functionName);
      return;
    }

    // Flatten the function into a sub-DAE
    const fnDae = new ModelicaDAE(functionName);
    fnDae.classKind = "function";
    resolved.instantiate();

    // Skip external "builtin" functions — they are platform-provided and
    // shouldn't appear in the flattened DAE output (e.g., `external "builtin"`).
    const classSpecifierCheck = resolved.abstractSyntaxNode?.classSpecifier;
    if (classSpecifierCheck instanceof ModelicaLongClassSpecifierSyntaxNode) {
      const ext = classSpecifierCheck.externalFunctionClause;
      if (ext) {
        const lang = ext.languageSpecification?.language?.text ?? "";
        if (lang === "builtin") {
          ModelicaSyntaxFlattener.#collectingFunctions.delete(functionName);
          return;
        }
      }
    }

    // Get function description
    fnDae.description =
      resolved.abstractSyntaxNode?.classSpecifier?.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;

    // Flatten function components (parameters/variables) with compact array notation.
    // Unlike model flattening, function definitions should keep array params as
    // `input Real[3] a` instead of expanding to `input Real a[1]; input Real a[2]; ...`

    // For component-scoped functions, collect enclosing class constants to substitute
    // in body expressions (e.g., constant c in N gets its value from n1's modification).
    const enclosingConstants = new Map<string, ModelicaExpression | number>();
    if (resolved.parent instanceof ModelicaClassInstance) {
      for (const parentEl of resolved.parent.elements) {
        if (parentEl instanceof ModelicaComponentInstance && parentEl.name) {
          const v = parentEl.variability;
          if (v === ModelicaVariability.CONSTANT) {
            let val = parentEl.modification?.evaluatedExpression ?? parentEl.modification?.expression;
            // Coerce integer to real if the component type is Real
            if (val instanceof ModelicaIntegerLiteral && parentEl.classInstance instanceof ModelicaRealClassInstance) {
              val = new ModelicaRealLiteral(val.value);
            }
            if (val) enclosingConstants.set(parentEl.name, val);
          }
        }
      }
    }

    for (const element of resolved.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      if (!element.classInstance) continue;
      element.instantiate();

      const compName = element.name ?? "";
      const causality = element.causality ?? null;
      const variability = element.variability ?? null;
      const isProtected = element.isProtected ?? false;

      // Determine array dimensions (if any)
      let arrayPrefix = "";
      if (element.classInstance instanceof ModelicaArrayClassInstance) {
        const subs = element.classInstance.arraySubscripts;
        if (subs && subs.length > 0) {
          const dims = subs.map((sub, i) => {
            if (sub.flexible && !sub.expression) return ":";
            if (sub.expression) {
              // Flatten the subscript expression through the canonicalizing
              // flattener so that e.g. `size(matr,2)-1` becomes `-1 + size(matr,2)`
              const syntaxFlattener = new ModelicaSyntaxFlattener();
              const flatExpr = sub.expression.accept(syntaxFlattener, {
                prefix: "",
                classInstance: resolved,
                dae: fnDae,
                stmtCollector: [],
              });
              if (flatExpr) {
                const out = new StringWriter();
                const printer = new ModelicaDAEPrinter(out);
                flatExpr.accept(printer);
                return out.toString().trim() || ":";
              }
              // Fall back to syntax printer if flattening fails
              const out = new StringWriter();
              const printer = new ModelicaSyntaxPrinter(out);
              sub.expression.accept(printer, 0);
              return out.toString().trim() || ":";
            }
            // Fall back to evaluated shape
            const shape =
              element.classInstance instanceof ModelicaArrayClassInstance ? element.classInstance.shape : [];
            const d = shape[i] ?? 0;
            return d === 0 ? ":" : String(d);
          });
          arrayPrefix = `[${dims.join(", ")}]`;
        }
      }

      // Get the binding expression — prefer the symbolic (syntax-flattened) form
      // over the evaluatedExpression to preserve forms like max(3, i1) and 5.0.
      let expression: ModelicaExpression | null = null;
      if (element.modification?.modificationExpression?.expression) {
        const syntaxFlattener = new ModelicaSyntaxFlattener();
        expression =
          element.modification.modificationExpression.expression.accept(syntaxFlattener, {
            prefix: "",
            classInstance: resolved,
            dae: fnDae,
            stmtCollector: [],
            loopVariables: enclosingConstants,
            ...(componentPrefix ? { componentFunctionPrefix: componentPrefix } : {}),
          }) ?? null;
      }
      if (!expression && element.modification?.evaluatedExpression) {
        expression = element.modification.evaluatedExpression;
      }
      if (!expression && element.modification?.expression) {
        expression = element.modification.expression;
      }

      // Encode array dims in the variable name for emission.
      // Format: "name" for scalars, "\0dims\0name" for arrays (\0 is null separator)
      // The emitter will parse this to output "Type[dims] name".
      const varName = arrayPrefix ? `\0${arrayPrefix}\0${compName}` : compName;
      const description = element.modification?.description ?? element.description ?? null;
      let variable: ModelicaVariable;
      // Determine element type — for arrays, check the elementClassInstance
      const typeInstance =
        element.classInstance instanceof ModelicaArrayClassInstance
          ? element.classInstance.elementClassInstance
          : element.classInstance;
      if (typeInstance instanceof ModelicaIntegerClassInstance) {
        variable = new ModelicaIntegerVariable(
          varName,
          expression,
          new Map(),
          variability,
          description,
          causality,
          false,
          isProtected,
        );
      } else if (typeInstance instanceof ModelicaBooleanClassInstance) {
        variable = new ModelicaBooleanVariable(
          varName,
          expression,
          new Map(),
          variability,
          description,
          causality,
          false,
          isProtected,
        );
      } else if (typeInstance instanceof ModelicaStringClassInstance) {
        variable = new ModelicaStringVariable(
          varName,
          expression,
          new Map(),
          variability,
          description,
          causality,
          false,
          isProtected,
        );
      } else {
        // Check if the type is a function class (e.g., partialScalarFunction)
        let functionType: ModelicaFunctionTypeSignature | null = null;
        if (
          typeInstance instanceof ModelicaClassInstance &&
          (typeInstance.classKind === ModelicaClassKind.FUNCTION ||
            typeInstance.classKind === ModelicaClassKind.OPERATOR_FUNCTION)
        ) {
          // Extract function signature: inputs and outputs
          if (!typeInstance.instantiated) typeInstance.instantiate();
          const inputs: { name: string; typeName: string }[] = [];
          const outputs: { name: string; typeName: string }[] = [];
          for (const comp of typeInstance.components) {
            const compTypeInstance =
              comp.classInstance instanceof ModelicaArrayClassInstance
                ? comp.classInstance.elementClassInstance
                : comp.classInstance;
            let typeName = "Real";
            if (compTypeInstance instanceof ModelicaIntegerClassInstance) typeName = "Integer";
            else if (compTypeInstance instanceof ModelicaBooleanClassInstance) typeName = "Boolean";
            else if (compTypeInstance instanceof ModelicaStringClassInstance) typeName = "String";
            if (comp.causality?.toString() === "input") {
              inputs.push({ name: comp.name ?? "", typeName });
            } else if (comp.causality?.toString() === "output") {
              outputs.push({ name: comp.name ?? "", typeName });
            }
          }
          functionType = { inputs, outputs };
        }

        // Coerce integer literals to real for Real-typed function params (e.g. 5 → 5.0, {{0,1}} → {{0.0,1.0}})
        if (expression) {
          const coerced = castToReal(expression);
          if (coerced) expression = coerced;
        }
        variable = new ModelicaRealVariable(
          varName,
          expression,
          new Map(),
          variability,
          description,
          causality,
          false,
          isProtected,
          functionType,
        );
      }
      fnDae.variables.push(variable);
    }

    // Sort function variables to match OMC ordering:
    // 1. input variables (source order)
    // 2. output variables (source order)
    // 3. protected/local variables: scalars before arrays
    fnDae.variables.sort((a, b) => {
      // Separate non-protected (input/output) from protected.
      // Preserve source order for inputs/outputs — important for functions
      // that use extends, where output vars may appear between inputs.
      const isProtectedVar = (v: ModelicaVariable) => (v.isProtected ? 1 : 0);
      const pa = isProtectedVar(a);
      const pb = isProtectedVar(b);
      if (pa !== pb) return pa - pb;
      // Within protected group, match OMC ordering:
      // 0: scalars without size()-dependent initializers
      // 1: scalars with parametric/size()-dependent initializers
      // 2: arrays
      if (pa === 1) {
        const containsSizeCall = (expr: ModelicaExpression): boolean => {
          if (expr instanceof ModelicaFunctionCallExpression) {
            if (expr.functionName === "size") return true;
            return expr.args.some(containsSizeCall);
          }
          if (expr instanceof ModelicaBinaryExpression) {
            return containsSizeCall(expr.operand1) || containsSizeCall(expr.operand2);
          }
          if (expr instanceof ModelicaUnaryExpression) {
            return containsSizeCall(expr.operand);
          }
          return false;
        };
        const protectedOrder = (v: ModelicaVariable) => {
          if (v.name.startsWith("\0")) return 2; // array
          if (v.expression && containsSizeCall(v.expression)) return 1;
          return 0;
        };
        return protectedOrder(a) - protectedOrder(b);
      }
      return 0; // preserve source order for inputs/outputs
    });

    // Register the function definition early to prevent infinite recursion when
    // the function body references itself (directly or via name resolution).
    targetDae.functions.push(fnDae);

    // Flatten algorithm and equation sections (these still use the standard path)

    for (const equationSection of resolved.equationSections) {
      for (const eq of equationSection.equations) {
        eq.accept(new ModelicaSyntaxFlattener(), {
          prefix: "",
          classInstance: resolved,
          dae: fnDae,
          stmtCollector: [],
          rootDae: targetDae,
          ...(componentPrefix ? { componentFunctionPrefix: componentPrefix } : {}),
        });
      }
    }
    for (const algorithmSection of resolved.algorithmSections) {
      const collector: ModelicaStatement[] = [];
      for (const statement of algorithmSection.statements) {
        statement.accept(new ModelicaSyntaxFlattener(), {
          prefix: "",
          classInstance: resolved,
          dae: fnDae,
          stmtCollector: collector,
          rootDae: targetDae,
          ...(componentPrefix ? { componentFunctionPrefix: componentPrefix } : {}),
        });
      }
      if (collector.length > 0) {
        // Mark recursive procedure calls as return calls (OMC convention)
        // This walks into if-else branches to find recursive calls at tail position
        const markRecursiveReturns = (stmts: ModelicaStatement[]): void => {
          if (stmts.length === 0) return;
          const last = stmts[stmts.length - 1];
          if (last instanceof ModelicaProcedureCallStatement && last.call.functionName === functionName) {
            last.isReturn = true;
          } else if (
            last instanceof ModelicaAssignmentStatement &&
            last.source instanceof ModelicaFunctionCallExpression &&
            last.source.functionName === functionName
          ) {
            // Convert `b := f(...)` to `return f(...)` for recursive tail calls
            const returnStmt = new ModelicaProcedureCallStatement(last.source);
            returnStmt.isReturn = true;
            stmts[stmts.length - 1] = returnStmt;
          } else if (last instanceof ModelicaIfStatement) {
            markRecursiveReturns(last.statements);
            for (const clause of last.elseIfClauses) markRecursiveReturns(clause.statements);
            markRecursiveReturns(last.elseStatements);
          }
        };
        markRecursiveReturns(collector);
        fnDae.algorithms.push(collector);
      }
    }

    // Check for external function clause
    const classSpecifier = resolved.abstractSyntaxNode?.classSpecifier;
    if (classSpecifier instanceof ModelicaLongClassSpecifierSyntaxNode) {
      const ext = classSpecifier.externalFunctionClause;
      if (ext) {
        const lang = ext.languageSpecification?.language?.text ?? "";
        const call = ext.externalFunctionCall;
        let declText = "external";
        if (lang) declText += ` "${lang}"`;
        if (call) {
          const callName = call.functionName?.text ?? "";
          const argNames: string[] = [];
          const printer = new ModelicaSyntaxPrinter(new StringWriter());
          for (const expr of call.arguments?.expressions ?? []) {
            // External function arguments are typically simple identifiers
            const writer = new StringWriter();
            printer.out = writer;
            expr.accept(printer, 0);
            argNames.push(writer.toString().trim());
          }
          const returnVar = call.output?.parts?.map((p) => p.identifier?.text ?? "").join(".") ?? "";
          if (returnVar) {
            declText += ` ${returnVar} = ${callName}(${argNames.join(", ")})`;
          } else if (callName) {
            declText += ` ${callName}(${argNames.join(", ")})`;
          }
        } else {
          // No explicit external call — synthesize default: output = functionName(inputs...)
          const fnName = resolved.name;
          const inputNames: string[] = [];
          let outputName: string | null = null;
          for (const v of fnDae.variables) {
            if (v.causality === "input") inputNames.push(v.name);
            else if (v.causality === "output" && !outputName) outputName = v.name;
          }
          if (outputName) {
            declText += ` ${outputName} = ${fnName}(${inputNames.join(", ")})`;
          } else {
            declText += ` ${fnName}(${inputNames.join(", ")})`;
          }
        }
        declText += ";";
        fnDae.externalDecl = declText;
      }
    }
    // fnDae was pushed early to prevent recursion during body flattening.
    // If this function was collected from inside another function's body (rootDae is set),
    // reposition it to the end so its dependencies appear before it in the output.
    if (ctx.rootDae) {
      const fnIdx = targetDae.functions.indexOf(fnDae);
      if (fnIdx >= 0 && fnIdx < targetDae.functions.length - 1) {
        targetDae.functions.splice(fnIdx, 1);
        targetDae.functions.push(fnDae);
      }
    }
    ModelicaSyntaxFlattener.#collectingFunctions.delete(functionName);

    // Validate: external functions cannot have algorithm sections (directly or inherited)
    if (fnDae.externalDecl && [...resolved.algorithmSections].length > 0) {
      fnDae.diagnostics.push(makeDiagnostic(ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM, null));
    }
  }

  visitOutputExpressionList(
    node: ModelicaOutputExpressionListSyntaxNode,
    ctx: FlattenerContext,
  ): ModelicaExpression | null {
    // Unwrap single-element parenthesized expressions like (1:3)
    if (node.outputs.length === 1) return node.outputs[0]?.accept(this, ctx) ?? null;

    // Multi-output: build as array with potential nulls (wildcards `_`)
    const elements: (ModelicaExpression | null)[] = [];
    for (const output of node.outputs) {
      const expr = output ? output.accept(this, ctx) : null;
      elements.push(expr ?? null);
    }
    return elements.length > 0 ? new ModelicaTupleExpression(elements) : null;
  }

  visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    const condition = node.condition?.accept(this, ctx);
    const thenExpr = node.expression?.accept(this, ctx);
    const elseExpr = node.elseExpression?.accept(this, ctx);
    if (!condition || !thenExpr || !elseExpr) return null;

    // Constant fold: if the condition is a literal boolean, return the appropriate branch
    if (condition instanceof ModelicaBooleanLiteral) {
      if (condition.value) return thenExpr;
      // Check elseif clauses
      for (const clause of node.elseIfExpressionClauses ?? []) {
        const clauseCondition = clause.condition?.accept(this, ctx);
        if (clauseCondition instanceof ModelicaBooleanLiteral && clauseCondition.value) {
          return clause.expression?.accept(this, ctx) ?? null;
        }
      }
      return elseExpr;
    }

    const elseIfClauses: { condition: ModelicaExpression; expression: ModelicaExpression }[] = [];
    for (const clause of node.elseIfExpressionClauses ?? []) {
      const clauseCondition = clause.condition?.accept(this, ctx);
      const clauseExpr = clause.expression?.accept(this, ctx);
      if (clauseCondition && clauseExpr) {
        elseIfClauses.push({ condition: clauseCondition, expression: clauseExpr });
      }
    }

    return new ModelicaIfElseExpression(condition, thenExpr, elseIfClauses, elseExpr);
  }

  visitComponentReference(
    node: ModelicaComponentReferenceSyntaxNode,
    ctx: FlattenerContext,
  ): ModelicaExpression | null {
    // Resolve outer references: if the first part refers to an `outer` component,
    // find the corresponding `inner` declaration by walking up the instance hierarchy
    let effectivePrefix = ctx.prefix;
    const firstPartName = node.parts?.[0]?.identifier?.text;
    if (firstPartName && ctx.classInstance) {
      const resolved = ctx.classInstance.resolveSimpleName(firstPartName, false, true);
      if (resolved instanceof ModelicaComponentInstance && resolved.isOuter && !resolved.isInner) {
        // Walk up the instance hierarchy (activeClassStack) to find the inner declaration.
        // The prefix needs to be stripped one level for each stack frame we ascend.
        const stack = ctx.activeClassStack ?? [];
        let prefixParts = effectivePrefix.split(".");
        for (let i = stack.length - 1; i >= 0; i--) {
          prefixParts = prefixParts.slice(0, -1);
          const ancestorClass = stack[i];
          if (!ancestorClass) continue;
          let found = false;
          for (const el of ancestorClass.elements) {
            if (el instanceof ModelicaComponentInstance && el.name === firstPartName && el.isInner) {
              effectivePrefix = prefixParts.join(".");
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
    }
    const rawName = node.parts.map((c) => c.identifier?.text ?? "<ERROR>").join(".");
    // Built-in variables like 'time' should never be prefixed
    const isBuiltinVar = rawName === "time";
    const name = isBuiltinVar ? rawName : (effectivePrefix === "" ? "" : effectivePrefix + ".") + rawName;
    // Resolve enum literal references like E.one when E is an enumeration type
    if (node.parts.length === 2 && ctx.classInstance) {
      const typeName = node.parts[0]?.identifier?.text;
      if (typeName) {
        const resolved = ctx.classInstance.resolveSimpleName(typeName, false, true);
        if (resolved instanceof ModelicaClassInstance) {
          const classInst = resolved instanceof ModelicaComponentInstance ? resolved.classInstance : resolved;
          if (classInst instanceof ModelicaEnumerationClassInstance) {
            const memberName = node.parts[1]?.identifier?.text;
            for (const enumerationLiteral of classInst.enumerationLiterals ?? []) {
              if (enumerationLiteral.stringValue === memberName) return enumerationLiteral;
            }
          }
        }
      }
    }
    if (ctx.classInstance instanceof ModelicaEnumerationClassInstance) {
      for (const enumerationLiteral of ctx.classInstance.enumerationLiterals ?? []) {
        if (enumerationLiteral.stringValue === node.parts?.[(node.parts?.length ?? 1) - 1]?.identifier?.text)
          return enumerationLiteral;
      }
    } else {
      // Check for subscripts on the last part (e.g. z[j, i, :])
      const lastPart = node.parts?.[node.parts.length - 1];
      const subscriptNodes = lastPart?.arraySubscripts?.subscripts ?? [];

      if (subscriptNodes.length > 0) {
        // Type checking and dimension validation on the array subscript inputs
        if (ctx.classInstance) {
          const typeRef = ctx.classInstance.resolveSimpleName(node.parts[0]?.identifier, node.global);
          if (typeRef instanceof ModelicaComponentInstance) {
            if (!typeRef.instantiated && !typeRef.instantiating) typeRef.instantiate();
            const classInst = typeRef.classInstance;

            let expectedCount = 0;
            if (classInst instanceof ModelicaArrayClassInstance) {
              expectedCount = classInst.shape.length;
            }

            // Subscript dimension matching against explicitly assigned sizes
            if (subscriptNodes.length > 0 && expectedCount > 0 && expectedCount !== subscriptNodes.length) {
              ctx.dae.diagnostics.push(
                makeDiagnostic(
                  ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH,
                  lastPart?.arraySubscripts,
                  typeRef.name ?? "?",
                  String(subscriptNodes.length),
                  String(expectedCount),
                ),
              );
            }
          }
        }

        // Build subscript expressions
        const subscripts: ModelicaExpression[] = [];

        for (const sub of subscriptNodes) {
          if (sub.flexible) {
            subscripts.push(new ModelicaColonExpression());
          } else if (sub.expression) {
            let subExpr = sub.expression.accept(this, ctx);

            // Validate Subscript type validity
            if (subExpr instanceof ModelicaRealLiteral) {
              ctx.dae.diagnostics.push(
                makeDiagnostic(ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH, sub.expression, "Real"),
              );
            } else if (subExpr instanceof ModelicaStringLiteral) {
              ctx.dae.diagnostics.push(
                makeDiagnostic(ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH, sub.expression, "String"),
              );
            } else {
              // No longer tracking hasSymbolic
            }

            // Expand constant range subscripts to explicit arrays (e.g. 1:10 → {1,2,...,10})
            if (subExpr instanceof ModelicaRangeExpression) {
              const toInt = (e: ModelicaExpression): number | null =>
                e instanceof ModelicaIntegerLiteral ? e.value : null;
              const startVal = toInt(subExpr.start);
              const stopVal = toInt(subExpr.end);
              const stepVal = subExpr.step ? toInt(subExpr.step) : 1;
              if (startVal != null && stopVal != null && stepVal != null && stepVal !== 0) {
                const elements: ModelicaExpression[] = [];
                if (stepVal > 0) {
                  for (let v = startVal; v <= stopVal; v += stepVal) elements.push(new ModelicaIntegerLiteral(v));
                } else {
                  for (let v = startVal; v >= stopVal; v += stepVal) elements.push(new ModelicaIntegerLiteral(v));
                }
                subExpr = new ModelicaArray([elements.length], elements);
              }
            }

            subscripts.push(subExpr ?? new ModelicaNameExpression("?"));
          }
        }

        // First try to resolve using the already-flattened subscript expressions
        // (this handles loop variables resolved via loopVariables binding)
        const baseName =
          (effectivePrefix === "" ? "" : effectivePrefix + ".") +
          node.parts.map((c) => c.identifier?.text ?? "").join(".");
        const resolvedFromFlattener: number[] = [];
        for (const sub of subscripts) {
          if (sub instanceof ModelicaIntegerLiteral) {
            resolvedFromFlattener.push(sub.value);
          } else {
            break;
          }
        }
        if (resolvedFromFlattener.length === subscriptNodes.length) {
          const indexedName = baseName + "[" + resolvedFromFlattener.join(",") + "]";
          for (const variable of ctx.dae.variables) {
            if (variable.name === indexedName) return variable;
          }
        }
        // Try the interpreter for subscripts containing parameters (e.g. work[x] where x=4)
        // This must happen BEFORE the symbolic fallback to resolve structural parameters.
        // BUT skip interpreter resolution when subscripts reference loop variables,
        // since the interpreter would resolve them via the class scope (e.g. constant k=4)
        // instead of keeping them symbolic as for-loop iterators.
        let hasLoopVarSubscript = false;
        if (ctx.loopVariables) {
          for (const sub of subscripts) {
            if (sub instanceof ModelicaNameExpression && ctx.loopVariables.has(sub.name)) {
              hasLoopVarSubscript = true;
              break;
            }
          }
        }
        const arrayPrefix = baseName + "[";
        const arraySize = ctx.dae.variables.filter((v) => v.name.startsWith(arrayPrefix)).length;
        const interp = new ModelicaInterpreter();
        interp.endValue = arraySize > 0 ? arraySize : null;
        const resolvedIndices: number[] = [];
        let rangeIndices: number[] | null = null;
        if (!hasLoopVarSubscript) {
          for (const sub of subscriptNodes) {
            if (sub.flexible) break;
            if (!sub.expression) break;
            const indexExpr = sub.expression.accept(interp, ctx.classInstance);
            if (indexExpr instanceof ModelicaIntegerLiteral) {
              resolvedIndices.push(indexExpr.value);
            } else if (indexExpr instanceof ModelicaArray) {
              // Range subscript evaluated to an array of indices (e.g. x:-1:2 → [4,3,2])
              const indices: number[] = [];
              for (const el of indexExpr.elements) {
                if (el instanceof ModelicaIntegerLiteral) indices.push(el.value);
                else {
                  break;
                }
              }
              if (indices.length === indexExpr.elements.length && indices.length > 0) {
                rangeIndices = indices;
              }
              break;
            } else {
              break;
            }
          }
        }
        if (resolvedIndices.length === subscriptNodes.length) {
          const indexedName = baseName + "[" + resolvedIndices.join(",") + "]";
          for (const variable of ctx.dae.variables) {
            if (variable.name === indexedName) return variable;
          }
        }
        // Expand range subscripts into a ModelicaArray of individual indexed variables
        // e.g. work[4:-1:2] → [work[4], work[3], work[2]]
        if (rangeIndices && rangeIndices.length > 0) {
          const elements: ModelicaExpression[] = [];
          for (const idx of rangeIndices) {
            const indexedName = baseName + "[" + [...resolvedIndices, idx].join(",") + "]";
            const variable = ctx.dae.variables.find((v) => v.name === indexedName);
            if (variable) {
              elements.push(variable);
            } else {
              // Variable not found — fall through to symbolic path
              elements.length = 0;
              break;
            }
          }
          if (elements.length > 0) {
            return new ModelicaArray([elements.length], elements);
          }
        }
        // Only fall back to symbolic subscripts when neither flattener nor interpreter
        // could resolve them (e.g. loop variables in preserved for-statements).
        let hasSymbolicLoopVar = false;
        for (const sub of subscripts) {
          if (sub && !(sub instanceof ModelicaIntegerLiteral)) hasSymbolicLoopVar = true;
        }

        if (hasSymbolicLoopVar) {
          return new ModelicaSubscriptedExpression(new ModelicaNameExpression(name), subscripts);
        } else {
          // Fall back to a fully symbolic subscripted expression if we couldn't resolve the array elements
          // This keeps `X[1]` as `X[1]` instead of stripping the subscript and returning `X`.
          return new ModelicaSubscriptedExpression(new ModelicaNameExpression(name), subscripts);
        }
      }

      // Check for loop variable bindings FIRST — loop variables shadow class-level constants
      // e.g. `for k in 1:5 loop z[k] := ...` where class also has `constant Integer k = 4`
      const simpleNameStr = node.parts.length === 1 ? node.parts[0]?.identifier?.text : undefined;
      if (typeof simpleNameStr === "string" && ctx.loopVariables && ctx.loopVariables.has(simpleNameStr)) {
        const loopVal = ctx.loopVariables.get(simpleNameStr);
        if (loopVal instanceof ModelicaExpression) return loopVal;
        if (typeof loopVal === "number") return new ModelicaIntegerLiteral(loopVal);
        return new ModelicaIntegerLiteral(0);
      }
      for (const variable of ctx.dae.variables) {
        if (variable.name === name) return variable;
      }
      // If exact match not found, look for array element variables with this prefix
      // This handles references like x[:] or bare array name y
      const prefix = name + "[";
      const arrayElements = ctx.dae.variables.filter((v) => v.name.startsWith(prefix));
      if (arrayElements.length > 0) {
        // Check if these are multi-dimensional (e.g., A[1,1], A[1,2], ...)
        // by looking for commas in the subscript portion
        const firstSub = arrayElements[0]?.name.substring(prefix.length - 1) ?? ""; // "[1,1]" or "[1]"
        if (firstSub.includes(",")) {
          // Multi-dimensional array — group by first index to build nested structure
          const rows = new Map<string, ModelicaExpression[]>();
          for (const v of arrayElements) {
            const sub = v.name.substring(prefix.length); // "1,1]", "1,2]" etc.
            const firstComma = sub.indexOf(",");
            const rowKey = firstComma >= 0 ? sub.substring(0, firstComma) : "1";
            const rowArr = rows.get(rowKey);
            if (rowArr) {
              rowArr.push(v);
            } else {
              rows.set(rowKey, [v]);
            }
          }
          const rowArrays = [...rows.values()].map((elems) => new ModelicaArray([elems.length], elems));
          const colCount = rowArrays.length > 0 ? (rowArrays[0]?.elements.length ?? 0) : 0;
          return new ModelicaArray([rowArrays.length, colCount], rowArrays);
        }
        return new ModelicaArray([arrayElements.length], arrayElements);
      }
      // Zero-size array: if the component is a zero-size array (e.g., x[n] where n=0),
      // no DAE variables were emitted. Return an empty array so that expressions
      // involving it (e.g., A*x, der(x)) can be simplified/eliminated.
      // Important: distinguish between truly zero-size (from an evaluated parameter)
      // and flexible/unsized (from colon [:] subscripts that couldn't be resolved).
      // Also skip inside function definitions where dimensions like Real[m] with
      // input parameter m are not truly zero — they're unresolved at compile time.
      if (ctx.classInstance && ctx.classInstance.classKind !== ModelicaClassKind.FUNCTION) {
        const firstName = node.parts[0]?.identifier?.text;
        if (firstName) {
          const resolved = ctx.classInstance.resolveSimpleName(firstName, false, true);
          if (
            resolved instanceof ModelicaComponentInstance &&
            resolved.classInstance instanceof ModelicaArrayClassInstance
          ) {
            const arrInst = resolved.classInstance;
            const shape = arrInst.shape;
            // Only treat as zero-size if at least one dimension is 0 AND the
            // corresponding subscript is NOT a flexible [:] colon.
            const subscripts = arrInst.arraySubscripts;
            const hasTrueZeroDim = shape.some((d, i) => d === 0 && !subscripts[i]?.flexible);
            if (hasTrueZeroDim) {
              return new ModelicaArray([0], []);
            }
          }
        }
      }
      // Check for encoded array function parameters (\0[dims]\0name) — return a
      // name expression with the bare name so the printer outputs it cleanly.
      for (const variable of ctx.dae.variables) {
        if (variable.name.startsWith("\0") && variable.name.endsWith("\0" + name)) {
          return new ModelicaNameExpression(name);
        }
      }
    }
    // Fall back to a symbolic name for unresolved references
    return new ModelicaNameExpression(name);
  }

  private flattenEquations(
    equations: { accept: (v: ModelicaSyntaxFlattener, a: FlattenerContext) => unknown }[],
    ctx: FlattenerContext,
  ): ModelicaEquation[] {
    const collected: ModelicaEquation[] = [];
    for (const eq of equations) {
      eq.accept(this, { ...ctx, dae: { ...ctx.dae, equations: collected } as ModelicaDAE });
    }
    return collected;
  }

  visitForEquation(node: ModelicaForEquationSyntaxNode, ctx: FlattenerContext): null {
    // Unroll for-equations: evaluate range, substitute index variable, emit individual equations
    // Process from outermost to innermost index
    this.#unrollForEquation(node.forIndexes, 0, node.equations ?? [], ctx);
    return null;
  }

  #unrollForEquation(
    forIndexes: readonly {
      identifier?: { text?: string | null } | null;
      expression?: { accept: (v: ModelicaSyntaxFlattener, a: FlattenerContext) => unknown } | null;
    }[],
    indexPos: number,
    equations: { accept: (v: ModelicaSyntaxFlattener, a: FlattenerContext) => unknown }[],
    ctx: FlattenerContext,
  ): void {
    if (indexPos >= forIndexes.length) {
      // Base case: all indices bound — flatten the inner equations
      for (const eq of equations) {
        eq.accept(this, ctx);
      }
      return;
    }
    const forIndex = forIndexes[indexPos];
    if (!forIndex) return;
    const indexName = forIndex.identifier?.text ?? "?";
    // Evaluate the range expression
    const rangeExpr = forIndex.expression?.accept(this, ctx);
    const values = this.#evaluateRange(rangeExpr);
    if (!values) {
      // Try to resolve as an enum type for enum range unrolling
      const origExpr = forIndex.expression;
      if (origExpr) {
        let enumClass: ModelicaEnumerationClassInstance | null = null;
        let literalsToIterate: ModelicaEnumerationLiteral[] | null = null;

        if ("parts" in origExpr) {
          const namedElement = ctx.classInstance.resolveComponentReference(
            origExpr as ModelicaComponentReferenceSyntaxNode,
          );
          if (namedElement instanceof ModelicaEnumerationClassInstance) {
            enumClass = namedElement;
          } else if (namedElement instanceof ModelicaComponentInstance) {
            if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
            if (namedElement.classInstance instanceof ModelicaEnumerationClassInstance) {
              enumClass = namedElement.classInstance;
            }
          }
          if (enumClass?.enumerationLiterals) {
            literalsToIterate = enumClass.enumerationLiterals;
          }
        } else if (origExpr instanceof ModelicaRangeExpressionSyntaxNode) {
          const startExpr = origExpr.startExpression;
          const stopExpr = origExpr.stopExpression;
          if (startExpr && stopExpr && "parts" in startExpr && "parts" in stopExpr) {
            const startElement = ctx.classInstance.resolveComponentReference(
              startExpr as ModelicaComponentReferenceSyntaxNode,
            );
            const stopElement = ctx.classInstance.resolveComponentReference(
              stopExpr as ModelicaComponentReferenceSyntaxNode,
            );

            if (
              startElement instanceof ModelicaEnumerationClassInstance &&
              stopElement instanceof ModelicaEnumerationClassInstance &&
              startElement.value &&
              stopElement.value
            ) {
              enumClass = startElement;
              const startOrd = startElement.value.ordinalValue;
              const stopOrd = stopElement.value.ordinalValue;
              if (enumClass.enumerationLiterals) {
                literalsToIterate = [];
                for (const literal of enumClass.enumerationLiterals) {
                  if (literal.ordinalValue >= startOrd && literal.ordinalValue <= stopOrd) {
                    literalsToIterate.push(literal);
                  }
                }
              }
            }
          }
        }

        if (enumClass && literalsToIterate) {
          const typeName = enumClass.compositeName ?? "";
          const loopVars = new Map(ctx.loopVariables ?? []);
          for (const literal of literalsToIterate) {
            const qualifiedName = typeName + "." + literal.stringValue;
            loopVars.set(indexName, new ModelicaNameExpression(qualifiedName));
            this.#unrollForEquation(forIndexes, indexPos + 1, equations, { ...ctx, loopVariables: loopVars });
          }
          return;
        }
      }
      // Can't evaluate range — fall back to emitting as a for-equation node
      const innerEquations = this.flattenEquations(equations, ctx);
      let eqs = innerEquations;
      for (let i = forIndexes.length - 1; i >= indexPos; i--) {
        const fi = forIndexes[i];
        if (!fi) continue;
        const name = fi.identifier?.text ?? "?";
        const range = fi.expression?.accept(this, ctx);
        if (!range) continue;
        eqs = [new ModelicaForEquation(name, range as ModelicaExpression, eqs)];
      }
      for (const eq of eqs) ctx.dae.equations.push(eq);
      return;
    }
    // Iterate over each value in the range
    const loopVars = new Map(ctx.loopVariables ?? []);
    for (const value of values) {
      loopVars.set(indexName, value);
      this.#unrollForEquation(forIndexes, indexPos + 1, equations, { ...ctx, loopVariables: loopVars });
    }
  }

  /** Evaluate an expression to an array of integer values (for range unrolling). */
  #evaluateRange(expr: unknown): number[] | null {
    if (expr instanceof ModelicaRangeExpression) {
      const startVal = this.#evaluateIntExpr(expr.start);
      const endVal = this.#evaluateIntExpr(expr.end);
      if (startVal === null || endVal === null) return null;
      const stepVal = expr.step ? this.#evaluateIntExpr(expr.step) : 1;
      if (stepVal === null || stepVal === 0) return null;
      const result: number[] = [];
      if (stepVal > 0) {
        for (let i = startVal; i <= endVal; i += stepVal) result.push(i);
      } else {
        for (let i = startVal; i >= endVal; i += stepVal) result.push(i);
      }
      return result;
    }
    return null;
  }

  /** Try to extract an integer value from an expression. */
  #evaluateIntExpr(expr: ModelicaExpression): number | null {
    if (expr instanceof ModelicaIntegerLiteral) return expr.value;
    if (expr instanceof ModelicaRealLiteral) return Math.round(expr.value);
    // Follow through DAE variables that have known literal expressions (e.g., parameter Integer n = 3)
    if (expr instanceof ModelicaVariable && expr.expression) {
      return this.#evaluateIntExpr(expr.expression);
    }
    return null;
  }

  visitIfEquation(node: ModelicaIfEquationSyntaxNode, ctx: FlattenerContext): null {
    const condition = node.condition?.accept(this, ctx);
    if (!condition) return null;

    // Try compile-time evaluation: if condition is a known boolean, inline the matching branch.
    // First check the flattened result, then fall back to the interpreter for parameter expressions.
    let conditionBool: boolean | null = null;
    if (condition instanceof ModelicaBooleanLiteral) {
      conditionBool = condition.value;
    } else if (node.condition) {
      // Try interpreter evaluation (resolves parameter values like x=4)
      const interp = new ModelicaInterpreter();
      const interpResult = node.condition.accept(interp, ctx.classInstance);
      if (interpResult instanceof ModelicaBooleanLiteral) {
        conditionBool = interpResult.value;
      }
    }

    if (conditionBool !== null) {
      if (conditionBool) {
        // Inline the "then" branch
        for (const eq of this.flattenEquations(node.equations ?? [], ctx)) {
          ctx.dae.equations.push(eq);
        }
      } else {
        // Check elseif clauses
        let handled = false;
        for (const clause of node.elseIfEquationClauses ?? []) {
          const clauseCondition = clause.condition?.accept(this, ctx);
          if (clauseCondition instanceof ModelicaBooleanLiteral && clauseCondition.value) {
            for (const eq of this.flattenEquations(clause.equations ?? [], ctx)) {
              ctx.dae.equations.push(eq);
            }
            handled = true;
            break;
          }
        }
        if (!handled) {
          // Inline the "else" branch
          for (const eq of this.flattenEquations(node.elseEquations ?? [], ctx)) {
            ctx.dae.equations.push(eq);
          }
        }
      }
      return null;
    }

    const thenEquations = this.flattenEquations(node.equations ?? [], ctx);
    const elseIfClauses: ModelicaElseIfClause[] = [];
    for (const clause of node.elseIfEquationClauses ?? []) {
      const clauseCondition = clause.condition?.accept(this, ctx);
      if (!clauseCondition) continue;
      const clauseEquations = this.flattenEquations(clause.equations ?? [], ctx);
      elseIfClauses.push({ condition: clauseCondition, equations: clauseEquations });
    }
    const elseEquations = this.flattenEquations(node.elseEquations ?? [], ctx);
    ctx.dae.equations.push(new ModelicaIfEquation(condition, thenEquations, elseIfClauses, elseEquations));
    return null;
  }

  visitWhenEquation(node: ModelicaWhenEquationSyntaxNode, ctx: FlattenerContext): null {
    const condition = node.condition?.accept(this, ctx);
    if (!condition) return null;
    const bodyEquations = this.flattenEquations(node.equations ?? [], ctx);
    const elseWhenClauses: ModelicaElseWhenClause[] = [];
    for (const clause of node.elseWhenEquationClauses ?? []) {
      const clauseCondition = clause.condition?.accept(this, ctx);
      if (!clauseCondition) continue;
      const clauseEquations = this.flattenEquations(clause.equations ?? [], ctx);
      elseWhenClauses.push({ condition: clauseCondition, equations: clauseEquations });
    }
    ctx.dae.equations.push(new ModelicaWhenEquation(condition, bodyEquations, elseWhenClauses));
    return null;
  }

  visitSimpleAssignmentStatement(node: ModelicaSimpleAssignmentStatementSyntaxNode, ctx: FlattenerContext): null {
    const target = node.target?.accept(this, ctx);
    let source = node.source?.accept(this, ctx);
    if (target && source) {
      // Check for assignment to constant component
      if (target instanceof ModelicaVariable && target.variability === ModelicaVariability.CONSTANT) {
        ctx.dae.diagnostics.push(makeDiagnostic(ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT, node.target, target.name));
        return null;
      }
      // Check for assignment to input component (only disallowed in function bodies)
      if (ctx.dae.classKind === "function" && target instanceof ModelicaVariable && target.causality === "input") {
        ctx.dae.diagnostics.push(makeDiagnostic(ModelicaErrorCode.ASSIGNMENT_TO_INPUT, node.target, target.name));
        return null;
      }
      // Check for type mismatch: Integer := Real is not allowed
      if (isIntegerTyped(target, ctx.dae) && isRealTyped(source, ctx.dae)) {
        const targetName = target instanceof ModelicaVariable ? target.name : target.toString();
        const sourceName = source instanceof ModelicaVariable ? source.name : source.toString();
        ctx.classInstance.diagnostics.push(
          makeDiagnostic(
            ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH,
            node.target,
            targetName,
            "Integer",
            sourceName,
            "Real",
          ),
        );
        return null;
      }
      if (isRealTyped(target, ctx.dae)) source = coerceToReal(source, ctx.dae) ?? source;

      // Collapse expanded array targets back to a single name when RHS is a function call.
      // e.g., {x[1], x[2], ..., x[9]} := joinThreeVectors2(...) → x := joinThreeVectors2(...)
      let effectiveTarget: ModelicaExpression = target;
      if (
        target instanceof ModelicaArray &&
        source instanceof ModelicaFunctionCallExpression &&
        target.elements.length > 0 &&
        target.elements.every((e) => e instanceof ModelicaVariable)
      ) {
        const firstName = (target.elements[0] as ModelicaVariable).name;
        const bracketIdx = firstName.indexOf("[");
        if (bracketIdx > 0) {
          const arrayBaseName = firstName.substring(0, bracketIdx);
          effectiveTarget = new ModelicaNameExpression(arrayBaseName);
        }
      }

      // Add [1] tuple indexing when a multi-output function is assigned to a single target.
      // e.g., invA := LAPACK.dgetri(LU, pivots) → invA := LAPACK.dgetri(LU, pivots)[1]
      if (source) {
        const src = source;
        if (src instanceof ModelicaFunctionCallExpression && !BUILTIN_FUNCTIONS.has(src.functionName)) {
          let fnDef = ctx.dae.functions.find((f) => f.name === src.functionName);
          if (!fnDef && ctx.rootDae) fnDef = ctx.rootDae.functions.find((f) => f.name === src.functionName);
          if (fnDef) {
            const outputCount = fnDef.variables.filter((v) => v.causality === "output").length;
            if (outputCount > 1) {
              source = new ModelicaSubscriptedExpression(src, [new ModelicaIntegerLiteral(1)]);
            }
          }
        }
      }
      ctx.stmtCollector.push(new ModelicaAssignmentStatement(effectiveTarget, source));
    }
    return null;
  }

  visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, ctx: FlattenerContext): null {
    const rawName = node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ?? "";
    // Don't resolve FQ names for global references (.print) or unqualified builtins
    const isGlobal = node.functionReference?.global === true;
    const isBuiltin = !rawName.includes(".") && ModelicaSyntaxFlattener.#isBuiltinFunction(rawName);
    const functionName = isGlobal || isBuiltin ? rawName : this.#resolveFullyQualifiedName(rawName, ctx);
    const flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      const flatArg = arg.expression?.accept(this, ctx);
      if (flatArg) flatArgs.push(flatArg);
    }
    // Coerce integer arguments to Real for built-in functions that expect Real args
    const realArgBuiltins = new Set(["reinit"]);
    if (realArgBuiltins.has(functionName)) {
      for (let i = 0; i < flatArgs.length; i++) {
        const coerced = castToReal(flatArgs[i] ?? null);
        if (coerced) flatArgs[i] = coerced;
      }
    } else if (flatArgs.some((a) => isRealTyped(a, ctx.dae))) {
      for (let i = 0; i < flatArgs.length; i++) {
        const coerced = castToReal(flatArgs[i] ?? null);
        if (coerced) flatArgs[i] = coerced;
      }
    }
    const call = new ModelicaFunctionCallExpression(functionName, flatArgs);
    ctx.stmtCollector.push(new ModelicaProcedureCallStatement(call));
    // Collect function definition if it's a user-defined function
    this.#collectFunctionDefinition(functionName, ctx);
    return null;
  }

  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatementSyntaxNode, ctx: FlattenerContext): null {
    const targets: (ModelicaExpression | null)[] = [];
    if (node.outputExpressionList) {
      for (const expr of node.outputExpressionList.outputs) {
        if (expr) targets.push(expr.accept(this, ctx) ?? null);
        else targets.push(null);
      }
    }
    const functionName = node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ?? "";
    const flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      const flatArg = arg.expression?.accept(this, ctx);
      if (flatArg) flatArgs.push(flatArg);
    }
    const source = new ModelicaFunctionCallExpression(functionName, flatArgs);
    // If only one non-null target, convert to simple assignment with tuple indexing: y := F(x)[idx]
    const nonNullTargets = targets.map((t, i) => ({ target: t, index: i })).filter((t) => t.target !== null);
    if (nonNullTargets.length === 1 && nonNullTargets[0]) {
      const target = nonNullTargets[0].target;
      const index = nonNullTargets[0].index;
      const subscripted = new ModelicaSubscriptedExpression(source, [new ModelicaIntegerLiteral(index + 1)]);
      if (target) ctx.stmtCollector.push(new ModelicaAssignmentStatement(target, subscripted));
    } else {
      ctx.stmtCollector.push(new ModelicaComplexAssignmentStatement(targets, source));
    }
    // Collect function definition if it's a user-defined function
    this.#collectFunctionDefinition(functionName, ctx);
    return null;
  }

  visitBreakStatement(node: ModelicaBreakStatementSyntaxNode, ctx: FlattenerContext): null {
    ctx.stmtCollector.push(new ModelicaBreakStatement());
    return null;
  }

  visitReturnStatement(node: ModelicaReturnStatementSyntaxNode, ctx: FlattenerContext): null {
    ctx.stmtCollector.push(new ModelicaReturnStatement());
    return null;
  }

  private flattenStatements(
    statements: { accept: (v: ModelicaSyntaxFlattener, a: FlattenerContext) => unknown }[],
    ctx: FlattenerContext,
  ): ModelicaStatement[] {
    const collected: ModelicaStatement[] = [];
    const innerCtx = { ...ctx, stmtCollector: collected };
    for (const stmt of statements) {
      stmt.accept(this, innerCtx);
    }
    return collected;
  }

  visitForStatement(node: ModelicaForStatementSyntaxNode, ctx: FlattenerContext): null {
    // Add for-loop index variables to loopVariables BEFORE flattening inner statements
    // so they shadow any class-level constants/variables with the same name
    const loopVars = new Map(ctx.loopVariables ?? []);
    for (const forIndex of node.forIndexes) {
      const indexName = forIndex?.identifier?.text;
      if (indexName) loopVars.set(indexName, new ModelicaNameExpression(indexName));
    }
    const innerCtx: FlattenerContext = { ...ctx, loopVariables: loopVars };
    const innerStatements = this.flattenStatements(node.statements ?? [], innerCtx);
    let statements = innerStatements;
    for (let i = node.forIndexes.length - 1; i >= 0; i--) {
      const forIndex = node.forIndexes[i];
      if (!forIndex) continue;
      const indexName = forIndex.identifier?.text ?? "?";
      let range = forIndex.expression?.accept(this, ctx) ?? null;

      // Expand enumeration type references: `for e in E` → `for e in {Pkg.E.one, Pkg.E.two, ...}`
      if (range instanceof ModelicaNameExpression && forIndex.expression && "parts" in forIndex.expression) {
        const namedElement = ctx.classInstance.resolveComponentReference(
          forIndex.expression as ModelicaComponentReferenceSyntaxNode,
        );
        let enumClass: ModelicaEnumerationClassInstance | null = null;
        if (namedElement instanceof ModelicaEnumerationClassInstance) {
          enumClass = namedElement;
        } else if (namedElement instanceof ModelicaComponentInstance) {
          if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
          if (namedElement.classInstance instanceof ModelicaEnumerationClassInstance) {
            enumClass = namedElement.classInstance;
          }
        }
        if (enumClass?.enumerationLiterals && enumClass.enumerationLiterals.length > 0) {
          const typeName = this.#resolveFullyQualifiedName(range.name, ctx);
          const elements = enumClass.enumerationLiterals.map(
            (lit) => new ModelicaNameExpression(typeName + "." + lit.stringValue),
          );
          range = new ModelicaArray([elements.length], elements);
        }
      }

      // Reject multi-dimensional array iterators (Modelica spec: only 1D arrays allowed)
      if (range instanceof ModelicaArray && range.elements.some((e) => e instanceof ModelicaArray)) {
        const innerShape = range.elements.find((e) => e instanceof ModelicaArray) as ModelicaArray;
        const fullShape = [range.shape[0] ?? 0, ...(innerShape?.shape ?? [])];
        // Determine element type for OMC-style message (e.g. "Integer[4, 2]")
        let elemType = "Real";
        const deepElem = innerShape?.elements?.[0];
        if (deepElem instanceof ModelicaIntegerLiteral) elemType = "Integer";
        else if (deepElem instanceof ModelicaBooleanLiteral) elemType = "Boolean";
        else if (deepElem instanceof ModelicaStringLiteral) elemType = "String";
        const shapeStr = `${elemType}[${fullShape.join(", ")}]`;
        ctx.dae.diagnostics.push(
          makeDiagnostic(ModelicaErrorCode.FOR_ITERATOR_NOT_1D, forIndex.expression, indexName, shapeStr),
        );
        return null;
      }

      // Infer implicit range from array indexing context when no explicit range
      if (!range) {
        range = this.#inferImplicitRange(indexName, node.statements ?? [], ctx);
      }

      if (!range) continue;
      const forStmt = new ModelicaForStatement(indexName, range, statements);
      statements = [forStmt];
    }
    for (const stmt of statements) ctx.stmtCollector.push(stmt);
    return null;
  }

  /**
   * Infer the implicit range for a for-loop variable by scanning inner statements
   * for array subscripts that use the variable as an index.
   * For `for i loop a[i] := ...`, if `a` has 4 elements, the range is `1:4`.
   * For multi-dimensional arrays like `a[i,j]`, extracts the correct dimension.
   */
  #inferImplicitRange(
    indexName: string,
    statements: readonly { accept: (v: ModelicaSyntaxFlattener, a: FlattenerContext) => unknown }[],
    ctx: FlattenerContext,
  ): ModelicaExpression | null {
    for (const stmt of statements) {
      // Check assignment statements: a[i] := ... or ... := a[i]
      if (stmt instanceof ModelicaSimpleAssignmentStatementSyntaxNode) {
        // Check both target and source for array references
        const refs = [stmt.target, stmt.source].filter(Boolean);
        for (const ref of refs) {
          if (ref instanceof ModelicaComponentReferenceSyntaxNode) {
            const result = this.#findDimensionForIndex(indexName, ref, ctx);
            if (result) return result;
          }
        }
      }
      // Recurse into nested for-statements
      if (stmt instanceof ModelicaForStatementSyntaxNode) {
        const result = this.#inferImplicitRange(indexName, stmt.statements ?? [], ctx);
        if (result) return result;
      }
    }
    return null;
  }

  /**
   * Check a component reference for subscripts that use the given loop variable.
   * Returns a range expression for the matching dimension, or null.
   */
  #findDimensionForIndex(
    indexName: string,
    ref: ModelicaComponentReferenceSyntaxNode,
    ctx: FlattenerContext,
  ): ModelicaExpression | null {
    for (const part of ref.parts) {
      const subscripts = part.arraySubscripts?.subscripts ?? [];
      if (subscripts.length === 0) continue;

      // Find which subscript position(s) reference the loop variable
      for (let dimIdx = 0; dimIdx < subscripts.length; dimIdx++) {
        const sub = subscripts[dimIdx];
        if (!sub?.expression) continue;
        if (!this.#expressionReferencesName(sub.expression, indexName)) continue;

        // Found the loop variable in subscript position dimIdx
        const arrName = part.identifier?.text ?? "";
        const qualifiedName = (ctx.prefix === "" ? "" : ctx.prefix + ".") + arrName;
        const dimSize = this.#getArrayDimensionSize(qualifiedName, dimIdx, subscripts.length, ctx);
        if (dimSize > 0) {
          return new ModelicaRangeExpression(new ModelicaIntegerLiteral(1), new ModelicaIntegerLiteral(dimSize), null);
        }
      }
    }
    return null;
  }

  /**
   * Recursively check whether a syntax expression references a given name.
   * Handles component references, binary expressions, unary expressions, and function calls.
   */
  #expressionReferencesName(expr: ModelicaExpressionSyntaxNode, name: string): boolean {
    if (expr instanceof ModelicaComponentReferenceSyntaxNode) {
      return expr.parts.length === 1 && expr.parts[0]?.identifier?.text === name;
    }
    if (expr instanceof ModelicaBinaryExpressionSyntaxNode) {
      return (
        (expr.operand1 != null && this.#expressionReferencesName(expr.operand1, name)) ||
        (expr.operand2 != null && this.#expressionReferencesName(expr.operand2, name))
      );
    }
    if (expr instanceof ModelicaUnaryExpressionSyntaxNode) {
      return expr.operand != null && this.#expressionReferencesName(expr.operand, name);
    }
    return false;
  }

  /**
   * Get the size of a specific dimension of an array from the DAE variables.
   * For `a[2,3]` (variables: a[1,1], a[1,2], a[1,3], a[2,1], a[2,2], a[2,3]):
   *   dimension 0 → 2, dimension 1 → 3
   */
  #getArrayDimensionSize(qualifiedName: string, dimIdx: number, totalDims: number, ctx: FlattenerContext): number {
    const prefix = qualifiedName + "[";
    const arrayVars = ctx.dae.variables.filter((v) => v.name.startsWith(prefix));
    if (arrayVars.length === 0) return 0;

    // For 1D arrays, just return total count
    if (totalDims <= 1) return arrayVars.length;

    // For multi-dimensional arrays, extract the max index at the requested dimension
    const indices = new Set<number>();
    for (const v of arrayVars) {
      const inside = v.name.substring(prefix.length, v.name.length - 1); // e.g. "1,2"
      const parts = inside.split(",");
      const idx = parseInt(parts[dimIdx] ?? "", 10);
      if (!isNaN(idx)) indices.add(idx);
    }
    return indices.size > 0 ? Math.max(...indices) : 0;
  }

  visitIfStatement(node: ModelicaIfStatementSyntaxNode, ctx: FlattenerContext): null {
    const condition = node.condition?.accept(this, ctx);
    if (!condition) return null;
    const thenStatements = this.flattenStatements(node.statements ?? [], ctx);

    // Collect all elseif clauses
    const allElseIfClauses: { condition: ModelicaExpression; statements: ModelicaStatement[] }[] = [];
    for (const clause of node.elseIfStatementClauses ?? []) {
      const clauseCondition = clause.condition?.accept(this, ctx);
      if (!clauseCondition) continue;
      const clauseStatements = this.flattenStatements(clause.statements ?? [], ctx);
      allElseIfClauses.push({ condition: clauseCondition, statements: clauseStatements });
    }
    const elseStatements = this.flattenStatements(node.elseStatements ?? [], ctx);

    // --- Constant folding optimization ---
    // Build the chain: [main condition + body, ...elseif conditions + bodies] + else body
    interface Branch {
      condition: ModelicaExpression;
      statements: ModelicaStatement[];
    }
    const branches: Branch[] = [{ condition, statements: thenStatements }, ...allElseIfClauses];

    // Walk the branches and optimize constant booleans
    const keptBranches: Branch[] = [];
    let resolvedElse: ModelicaStatement[] = elseStatements;

    for (const branch of branches) {
      if (branch.condition instanceof ModelicaBooleanLiteral) {
        if (branch.condition.value) {
          // Condition is `true`: take this branch, everything after becomes dead
          if (keptBranches.length === 0) {
            // This is the first live branch — emit its body directly (no if needed)
            for (const stmt of branch.statements) ctx.stmtCollector.push(stmt);
            return null;
          } else {
            // This is an elseif with `true` — it becomes the final else
            resolvedElse = branch.statements;
            break; // No need to check further branches
          }
        } else {
          // Condition is `false`: skip this branch entirely
          continue;
        }
      } else {
        // Non-constant condition: keep this branch
        keptBranches.push(branch);
      }
    }

    // After processing: if no branches remain, emit the else body directly
    if (keptBranches.length === 0) {
      for (const stmt of resolvedElse) ctx.stmtCollector.push(stmt);
      return null;
    }

    // Build the optimized if-statement from remaining branches
    const mainBranch = keptBranches[0];
    if (!mainBranch) return null;
    const remainingElseIfs = keptBranches.slice(1);
    ctx.stmtCollector.push(
      new ModelicaIfStatement(mainBranch.condition, mainBranch.statements, remainingElseIfs, resolvedElse),
    );
    return null;
  }

  visitWhenStatement(node: ModelicaWhenStatementSyntaxNode, ctx: FlattenerContext): null {
    const condition = node.condition?.accept(this, ctx);
    if (!condition) return null;
    const thenStatements = this.flattenStatements(node.statements ?? [], ctx);
    const elseWhenClauses: { condition: ModelicaExpression; statements: ModelicaStatement[] }[] = [];
    for (const clause of node.elseWhenStatementClauses ?? []) {
      const clauseCondition = clause.condition?.accept(this, ctx);
      if (!clauseCondition) continue;
      const clauseStatements = this.flattenStatements(clause.statements ?? [], ctx);
      elseWhenClauses.push({ condition: clauseCondition, statements: clauseStatements });
    }
    ctx.stmtCollector.push(new ModelicaWhenStatement(condition, thenStatements, elseWhenClauses));
    return null;
  }

  visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, ctx: FlattenerContext): null {
    const condition = node.condition?.accept(this, ctx);
    if (!condition) return null;
    const statements = this.flattenStatements(node.statements ?? [], ctx);
    ctx.stmtCollector.push(new ModelicaWhileStatement(condition, statements));
    return null;
  }

  visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    const start = node.startExpression?.accept(this, ctx);
    const stop = node.stopExpression?.accept(this, ctx);
    const step = node.stepExpression?.accept(this, ctx) ?? null;
    if (!start || !stop) return null;
    return new ModelicaRangeExpression(start, stop, step);
  }

  /**
   * Expand `connect(a, b)` into scalar equations:
   * - Potential (non-flow) variables: equality equations (`a.x = b.x`)
   * - Flow variables: sum-to-zero equations (`a.f + b.f = 0.0`)
   */
  visitConnectEquation(node: ModelicaConnectEquationSyntaxNode, ctx: FlattenerContext): null {
    const ref1 = node.componentReference1;
    const ref2 = node.componentReference2;
    if (!ref1 || !ref2) return null;

    // Check if this entire connect equation was removed via `break connect(...)`
    if (ctx.brokenConnects && ctx.brokenConnects.size > 0) {
      // Include array subscripts in the key to match (e.g. c1[i] not just c1)
      const refText = (ref: ModelicaComponentReferenceSyntaxNode) =>
        ref.parts
          .map((p) => {
            let name = p.identifier?.text ?? "";
            if (p.arraySubscripts?.subscripts?.length) {
              const out = new StringWriter();
              p.arraySubscripts.accept(new ModelicaSyntaxPrinter(out));
              name += out.toString();
            }
            return name;
          })
          .join(".");
      const localName1 = refText(ref1);
      const localName2 = refText(ref2);
      const key = [localName1, localName2].sort().join(",");
      if (ctx.brokenConnects.has(key)) return null;
    }

    // Check if either side's root component has been removed via `break`
    const rootName1 = ref1.parts[0]?.identifier?.text;
    const rootName2 = ref2.parts[0]?.identifier?.text;
    const broken1 = !!(rootName1 && ctx.brokenNames?.has(rootName1));
    const broken2 = !!(rootName2 && ctx.brokenNames?.has(rootName2));

    // If both sides are broken, skip the entire connect equation
    if (broken1 && broken2) return null;

    // If one side is broken, skip the connect equation entirely.
    // The generic flow balance (f = 0.0) for the remaining side
    // is handled by generateFlowBalanceEquations.
    if (broken1 || broken2) {
      return null;
    }

    // Build prefixed names for both sides
    const name1 = this.#resolveConnectName(ref1, ctx);
    const name2 = this.#resolveConnectName(ref2, ctx);
    if (!name1 || !name2) return null;

    // Resolve the component instances
    const comp1 = this.#resolveConnectComponent(ref1, ctx);
    const comp2 = this.#resolveConnectComponent(ref2, ctx);
    if (!comp1 || !comp2) return null;

    // Collect leaf variables from both connector sides
    const leaves1 = this.#collectConnectorLeaves(comp1, name1);
    const leaves2 = this.#collectConnectorLeaves(comp2, name2);

    // Match variables by their local name suffix and generate equations
    for (const [localName, info1] of leaves1) {
      const info2 = leaves2.get(localName);
      if (!info2) continue;

      if (info1.isFlow) {
        // Flow variables: -(a.f + b.f) = 0.0
        const sum = new ModelicaBinaryExpression(
          ModelicaBinaryOperator.ADDITION,
          new ModelicaNameExpression(info1.fullName),
          new ModelicaNameExpression(info2.fullName),
        );
        const lhs = new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, sum);
        ctx.dae.equations.push(new ModelicaSimpleEquation(lhs, new ModelicaRealLiteral(0.0)));
        // Track these flow variables as connected
        ctx.connectedFlowVars?.add(info1.fullName);
        ctx.connectedFlowVars?.add(info2.fullName);
      } else {
        // Potential variables: a.x = b.x
        ctx.dae.equations.push(
          new ModelicaSimpleEquation(
            new ModelicaNameExpression(info1.fullName),
            new ModelicaNameExpression(info2.fullName),
          ),
        );
      }
    }

    return null;
  }

  /**
   * Resolve a component reference in a connect equation to its full flattened name.
   */
  #resolveConnectName(ref: ModelicaComponentReferenceSyntaxNode, ctx: FlattenerContext): string | null {
    const parts = ref.parts.map((p) => {
      let name = p.identifier?.text ?? "";
      // Handle array subscripts on the reference (e.g., c[1])
      if (p.arraySubscripts?.subscripts?.length) {
        const subs: string[] = [];
        for (const sub of p.arraySubscripts.subscripts) {
          const val = sub.expression?.accept(new ModelicaInterpreter(), ctx.classInstance);
          // Extract the numeric value from the interpreter result
          if (val instanceof ModelicaIntegerLiteral) {
            subs.push(String(val.value));
          } else if (val instanceof ModelicaRealLiteral) {
            subs.push(String(val.value));
          } else {
            subs.push(val?.toString() ?? "");
          }
        }
        name += "[" + subs.join(",") + "]";
      }
      return name;
    });
    const localName = parts.join(".");
    return ctx.prefix === "" ? localName : ctx.prefix + "." + localName;
  }

  /**
   * Resolve a component reference to the ModelicaComponentInstance it points to.
   */
  #resolveConnectComponent(
    ref: ModelicaComponentReferenceSyntaxNode,
    ctx: FlattenerContext,
  ): ModelicaComponentInstance | null {
    const firstName = ref.parts[0]?.identifier?.text;
    if (!firstName) return null;
    const firstResolved = ctx.classInstance.resolveSimpleName?.(firstName, false, true);
    if (!(firstResolved instanceof ModelicaComponentInstance)) return null;
    let resolved: ModelicaComponentInstance = firstResolved;

    // Walk through multi-part references (e.g., m.c -> resolve c within m's class)
    for (let i = 1; i < ref.parts.length; i++) {
      const partName = ref.parts[i]?.identifier?.text;
      if (!partName) return null;
      const classInst = resolved.classInstance;
      if (!classInst) return null;
      // For array class instances, look in the element class instance
      let lookupClass: ModelicaClassInstance | null = classInst;
      if (classInst instanceof ModelicaArrayClassInstance) {
        lookupClass = classInst.elementClassInstance;
      }
      if (!lookupClass) return null;
      const inner = lookupClass.resolveSimpleName?.(partName, false, true);
      if (!(inner instanceof ModelicaComponentInstance)) return null;
      resolved = inner as ModelicaComponentInstance;
    }
    return resolved;
  }

  /**
   * Collect leaf variable info from a connector component.
   * Returns a map from local variable name to {fullName, isFlow}.
   */
  #collectConnectorLeaves(
    comp: ModelicaComponentInstance,
    prefix: string,
  ): Map<string, { fullName: string; isFlow: boolean }> {
    const result = new Map<string, { fullName: string; isFlow: boolean }>();
    const classInst = comp.classInstance;
    if (!classInst) return result;

    // For predefined types (Real, Integer, etc.), this component IS the leaf
    if (classInst instanceof ModelicaPredefinedClassInstance) {
      result.set("", { fullName: prefix, isFlow: comp.flowPrefix === ModelicaFlow.FLOW });
      return result;
    }

    // For array class instances, look at element class instance's elements
    const lookupClass =
      classInst instanceof ModelicaArrayClassInstance
        ? (classInst as ModelicaArrayClassInstance).elementClassInstance
        : classInst;
    if (!lookupClass) return result;

    // Enumerate sub-components
    for (const element of lookupClass.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      if (!element.name) continue;

      const elemClass = element.classInstance;
      if (elemClass instanceof ModelicaPredefinedClassInstance) {
        // Leaf variable
        result.set(element.name, {
          fullName: prefix + "." + element.name,
          isFlow: element.flowPrefix === ModelicaFlow.FLOW,
        });
      } else if (elemClass instanceof ModelicaArrayClassInstance) {
        // Array of predefined types - enumerate elements
        const shape = (elemClass as ModelicaArrayClassInstance).shape;
        if (shape.length === 1 && shape[0] !== undefined) {
          for (let idx = 1; idx <= shape[0]; idx++) {
            result.set(element.name + "[" + idx + "]", {
              fullName: prefix + "." + element.name + "[" + idx + "]",
              isFlow: element.flowPrefix === ModelicaFlow.FLOW,
            });
          }
        }
      }
      // TODO: Handle nested connector types recursively
    }

    return result;
  }

  /**
   * Collapse a ModelicaArray of element variables back to a ModelicaNameExpression
   * when all elements share the same base array name.
   * E.g., {{C[1,1], C[1,2], C[1,3]}, {C[2,1], ...}} → ModelicaNameExpression("C")
   */
  private collapseArrayToName(expr: ModelicaExpression): ModelicaExpression {
    if (!(expr instanceof ModelicaArray)) return expr;
    // Only collapse multi-dimensional arrays (arrays of arrays), not 1D arrays
    if (!expr.elements.some((e) => e instanceof ModelicaArray)) return expr;
    // Collect all leaf variables from the (possibly nested) array
    const allVars: ModelicaVariable[] = [];
    const collectVars = (e: ModelicaExpression): boolean => {
      if (e instanceof ModelicaVariable) {
        allVars.push(e);
        return true;
      }
      if (e instanceof ModelicaArray) {
        return e.elements.every(collectVars);
      }
      return false;
    };
    if (!collectVars(expr) || allVars.length === 0) return expr;
    // Check if all variables share the same base name (before "[")
    const firstName = allVars[0]?.name ?? "";
    const bracketIdx = firstName.indexOf("[");
    if (bracketIdx < 0) return expr;
    const baseName = firstName.substring(0, bracketIdx);
    if (allVars.every((v) => v.name.startsWith(baseName + "["))) {
      return new ModelicaNameExpression(baseName);
    }
    return expr;
  }

  /**
   * Recursively collapse array-of-variables to name expressions inside
   * binary expressions, so that `inv({{A[1,1],...}}) * {{B[1,1],...}}`
   * becomes `inv({{A[1,1],...}}) * B`.
   */
  private collapseArraysInExpr(expr: ModelicaExpression): ModelicaExpression {
    if (expr instanceof ModelicaArray) return this.collapseArrayToName(expr);
    if (expr instanceof ModelicaBinaryExpression) {
      const left = this.collapseArraysInExpr(expr.operand1);
      const right = this.collapseArraysInExpr(expr.operand2);
      if (left !== expr.operand1 || right !== expr.operand2) {
        return new ModelicaBinaryExpression(expr.operator, left, right);
      }
    }
    return expr;
  }

  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, ctx: FlattenerContext): null {
    let expression1 = node.expression1?.accept(this, ctx);
    let expression2 = node.expression2?.accept(this, ctx);
    // Collapse expanded array variables back to name expressions for clean equation output
    // This preserves C = inv({{A[1,1],...}}) * B instead of {{C[1,1],...}} = ... * {{B[1,1],...}}
    if (expression1) expression1 = this.collapseArrayToName(expression1);
    if (expression2) expression2 = this.collapseArraysInExpr(expression2);
    // Skip equations involving zero-size arrays (e.g., der(x) = A*x where x[0] is empty).
    // Empty arrays arise from zero-dimensional components and produce vacuous equations.
    const hasEmptyArray = (e: ModelicaExpression | null | undefined): boolean =>
      e instanceof ModelicaArray && e.shape.some((d) => d === 0);
    if (hasEmptyArray(expression1) || hasEmptyArray(expression2)) return null;
    // When a scalar LHS has a multi-return function call RHS that was constant-evaluated
    // to an array (e.g., y = f(4) where f returns {8.0, 12.0}), extract only the first output.
    // We detect this when: (1) LHS is a scalar variable (not an array),
    // (2) RHS is a literal array that doesn't match the variable's expected dimensions.
    if (
      expression2 instanceof ModelicaArray &&
      expression2.elements.length > 1 &&
      expression2.elements.every((e) => isLiteral(e))
    ) {
      // LHS can be a ModelicaVariable (resolved from DAE) or a ModelicaNameExpression
      let isScalarLHS = false;
      let lhsName: string | null = null;
      if (expression1 instanceof ModelicaVariable && !expression1.name.includes("[")) {
        lhsName = expression1.name;
      } else if (expression1 instanceof ModelicaNameExpression && !expression1.name.includes("[")) {
        lhsName = expression1.name;
      }
      if (lhsName) {
        const rootName = lhsName;
        const hasIndexedVars = ctx.dae.variables.some((v) => v.name.startsWith(rootName + "["));
        isScalarLHS = !hasIndexedVars;
        if (isScalarLHS) {
          // The LHS is a scalar — this array RHS likely came from a multi-return function
          expression2 = expression2.elements[0] ?? expression2;
        } else {
          // LHS is an array name, RHS is a literal array — expand into per-element equations
          const arrayVars = ctx.dae.variables
            .filter((v) => v.name.startsWith(rootName + "["))
            .sort((a, b) => a.name.localeCompare(b.name));
          const flatRhs = [...expression2.flatElements];
          if (arrayVars.length === flatRhs.length) {
            for (let i = 0; i < arrayVars.length; i++) {
              const arrayVar = arrayVars[i];
              if (!arrayVar) continue;
              const lhs = new ModelicaNameExpression(arrayVar.name);
              let rhs = flatRhs[i];
              if (!rhs) continue;
              if (arrayVars[i] instanceof ModelicaRealVariable) rhs = castToReal(rhs) ?? rhs;
              ctx.dae.equations.push(new ModelicaSimpleEquation(lhs, rhs));
            }
            return null;
          }
        }
      }
    }
    if (expression1 && expression2) {
      if (expression2 instanceof ModelicaFunctionCallExpression) {
        const funcCall = expression2;
        const funcDef = ctx.dae.functions.find((f) => f.name === funcCall.functionName);
        if (funcDef) {
          const outputs = funcDef.variables.filter((v) => v.causality === "output");
          if (outputs.length > 1) {
            if (!(expression1 instanceof ModelicaTupleExpression)) {
              // Implicit tuple expansion: b = func() -> (b, _, _) = func()
              const tupleElements: (ModelicaExpression | null)[] = [expression1];
              for (let i = 1; i < outputs.length; i++) tupleElements.push(null);
              expression1 = new ModelicaTupleExpression(tupleElements);
            } else if (expression1.elements.length < outputs.length) {
              // Pad existing tuple: (a, b) = func() -> (a, b, _) = func()
              const tupleElements: (ModelicaExpression | null)[] = [...expression1.elements];
              while (tupleElements.length < outputs.length) tupleElements.push(null);
              expression1 = new ModelicaTupleExpression(tupleElements);
            }
          }
        }
      }

      // When the LHS is a tuple (output expression list), wrap the RHS as a
      // matching tuple instead of splitting into per-element scalar equations.
      if (expression1 instanceof ModelicaTupleExpression && expression2 instanceof ModelicaArray) {
        const flat2 = [...expression2.flatElements];
        // Build RHS tuple elements respecting the structure of the LHS tuple.
        // If a LHS element is an array (e.g., {b[1],...,b[30]}), group the
        // corresponding RHS values into a ModelicaArray sub-expression.
        const rhsElements: ModelicaExpression[] = [];
        let rhsIdx = 0;
        for (const lhsElem of expression1.elements) {
          if (lhsElem instanceof ModelicaArray) {
            // LHS element is an array — consume that many RHS values and wrap in array
            const count = lhsElem.elements.length;
            const subValues: ModelicaExpression[] = [];
            for (let k = 0; k < count && rhsIdx < flat2.length; k++, rhsIdx++) {
              let rhs = flat2[rhsIdx];
              if (rhs && isRealTyped(lhsElem.elements[k] ?? lhsElem, ctx.dae)) {
                rhs = coerceToReal(rhs, ctx.dae) ?? rhs;
              }
              if (rhs) subValues.push(rhs);
            }
            rhsElements.push(new ModelicaArray([subValues.length], subValues));
          } else {
            // Scalar LHS element — consume one RHS value
            let rhs = flat2[rhsIdx];
            if (rhs && lhsElem && isRealTyped(lhsElem, ctx.dae)) {
              rhs = coerceToReal(rhs, ctx.dae) ?? rhs;
            }
            if (rhs) rhsElements.push(rhs);
            rhsIdx++;
          }
        }
        const tupleRHS = new ModelicaTupleExpression(rhsElements);
        ctx.dae.equations.push(new ModelicaSimpleEquation(expression1, tupleRHS));
        return null;
      }
      // When the LHS is an expanded array of variables and the RHS is a function
      // call, check if function arguments contain arrays that should be scalarized
      // (vectorized function call). E.g., {work[4],work[3],work[2]} = multiply({work[3],work[2],work[1]}, ...)
      // → work[4] = multiply(work[3], ...), work[3] = multiply(work[2], ...), etc.
      // Only scalarize when the function has ALL scalar input parameters — functions
      // with array inputs (like ewm(Real[3] x)) should NOT be scalarized.
      if (expression1 instanceof ModelicaArray && expression2 instanceof ModelicaFunctionCallExpression) {
        const rhsCall = expression2;
        const lhsElements = [...expression1.flatElements];
        // Check if the function definition has only scalar inputs
        const funcDef = ctx.dae.functions.find((f) => f.name === rhsCall.functionName);
        const hasScalarInputsOnly = funcDef
          ? funcDef.variables.filter((v) => v.causality === "input").every((v) => !v.name.includes("["))
          : false;
        const argArrays = rhsCall.args.map((arg) => (arg instanceof ModelicaArray ? [...arg.flatElements] : null));
        const hasArrayArgs = argArrays.some((a) => a !== null);
        // Scalarize when at least one argument is an array and all inputs are scalar
        if (hasScalarInputsOnly && hasArrayArgs && lhsElements.length > 0) {
          const count = lhsElements.length;
          // For non-array arguments, try to expand them element-wise
          // e.g., fill(1.0, 3) + {work[3], work[2], work[1]} should expand per-element
          const expandedArgs: (ModelicaExpression[] | null)[] = rhsCall.args.map((arg, idx) => {
            if (argArrays[idx]) return argArrays[idx];
            // Try to expand binary expressions with array operands
            if (arg instanceof ModelicaBinaryExpression) {
              // Try to resolve non-array operands via interpreter (e.g. fill(1.0, -1+x) → {1.0,1.0,1.0})
              let op1Arr = arg.operand1 instanceof ModelicaArray ? [...arg.operand1.flatElements] : null;
              let op2Arr = arg.operand2 instanceof ModelicaArray ? [...arg.operand2.flatElements] : null;
              if (!op1Arr || !op2Arr) {
                const tryResolveToArray = (expr: ModelicaExpression): ModelicaExpression[] | null => {
                  // Try to evaluate fill() / ones() / zeros() calls into concrete arrays
                  if (expr instanceof ModelicaFunctionCallExpression) {
                    const fn = expr.functionName;
                    if (fn === "fill" || fn === "ones" || fn === "zeros") {
                      // Recursively resolve parameter references in arguments
                      const resolveExpr = (e: ModelicaExpression): ModelicaExpression => {
                        if (e instanceof ModelicaIntegerLiteral || e instanceof ModelicaRealLiteral) return e;
                        if (e instanceof ModelicaVariable && e.expression instanceof ModelicaIntegerLiteral) {
                          return e.expression;
                        }
                        if (e instanceof ModelicaNameExpression) {
                          const v = ctx.dae.variables.find((dv) => dv.name === e.name);
                          if (v?.expression instanceof ModelicaIntegerLiteral) return v.expression;
                        }
                        if (e instanceof ModelicaUnaryExpression) {
                          const op = resolveExpr(e.operand);
                          if (
                            op instanceof ModelicaIntegerLiteral &&
                            e.operator === ModelicaUnaryOperator.UNARY_MINUS
                          ) {
                            return new ModelicaIntegerLiteral(-op.value);
                          }
                          return new ModelicaUnaryExpression(e.operator, op);
                        }
                        if (e instanceof ModelicaBinaryExpression) {
                          const o1 = resolveExpr(e.operand1);
                          const o2 = resolveExpr(e.operand2);
                          return ModelicaBinaryExpression.new(e.operator, o1, o2) ?? e;
                        }
                        return e;
                      };
                      const resolvedArgs = expr.args.map(resolveExpr);

                      // For fill(value, dim): build array
                      if (fn === "fill" && resolvedArgs.length >= 2) {
                        let fillValue = resolvedArgs[0];
                        if (!fillValue) return null;
                        // Convert Real 1.0 to Integer 1 for fill values from ones/zeros conversion
                        if (fillValue instanceof ModelicaRealLiteral && Number.isInteger(fillValue.value)) {
                          fillValue = new ModelicaIntegerLiteral(fillValue.value);
                        }
                        const dim = resolvedArgs[1];
                        if (dim instanceof ModelicaIntegerLiteral) {
                          const arr = buildFilledArray([dim.value], fillValue);
                          return [...arr.flatElements];
                        }
                      }
                      // For ones(dim): build array of 1s
                      if (fn === "ones" && resolvedArgs.length >= 1) {
                        const dim = resolvedArgs[0];
                        if (dim instanceof ModelicaIntegerLiteral) {
                          const arr = buildFilledArray([dim.value], new ModelicaIntegerLiteral(1));
                          return [...arr.flatElements];
                        }
                      }
                    }
                  }
                  return null;
                };
                if (!op1Arr) {
                  op1Arr = tryResolveToArray(arg.operand1);
                }
                if (!op2Arr) {
                  op2Arr = tryResolveToArray(arg.operand2);
                }
              }
              if (op1Arr && op2Arr && op1Arr.length === count && op2Arr.length === count) {
                // Both operands are arrays — expand element-wise
                const results: ModelicaExpression[] = [];
                for (let k = 0; k < count; k++) {
                  const e1 = op1Arr[k];
                  const e2 = op2Arr[k];
                  if (!e1 || !e2) continue;
                  const r = ModelicaBinaryExpression.new(arg.operator, e1, e2);
                  if (r) results.push(r);
                  else results.push(new ModelicaBinaryExpression(arg.operator, e1, e2));
                }
                return results;
              }
              // One operand is an array, the other is scalar — distribute
              if (op1Arr && op1Arr.length === count) {
                return op1Arr.map((el) => new ModelicaBinaryExpression(arg.operator, el, arg.operand2));
              }
              if (op2Arr && op2Arr.length === count) {
                return op2Arr.map((el) => new ModelicaBinaryExpression(arg.operator, arg.operand1, el));
              }
            }
            return null; // scalar argument, duplicate for each element
          });

          for (let i = 0; i < count; i++) {
            let lhs = lhsElements[i];
            if (!lhs) continue;
            // Build per-element arguments for this scalar function call
            const scalarArgs: ModelicaExpression[] = [];
            for (let j = 0; j < rhsCall.args.length; j++) {
              const expanded = expandedArgs[j];
              if (expanded) {
                const el = expanded[i] ?? rhsCall.args[j];
                if (el) scalarArgs.push(el);
              } else {
                const el = rhsCall.args[j];
                if (el) scalarArgs.push(el);
              }
            }
            // Apply type coercion: wrap Integer args with /*Real*/ since multiply expects Real
            const coercedArgs = scalarArgs.map((a) => {
              // For integer variables, wrap directly
              if (a instanceof ModelicaIntegerVariable) {
                return new ModelicaFunctionCallExpression("/*Real*/", [a]);
              }
              // For binary expressions with integer operands, wrap the whole expression
              if (a instanceof ModelicaBinaryExpression && isIntegerTyped(a, ctx.dae)) {
                return new ModelicaFunctionCallExpression("/*Real*/", [a]);
              }
              return coerceToReal(a, ctx.dae) ?? a;
            });
            lhs = coerceToReal(lhs, ctx.dae) ?? lhs;
            const scalarCall = new ModelicaFunctionCallExpression(rhsCall.functionName, coercedArgs);
            ctx.dae.equations.push(new ModelicaSimpleEquation(lhs, scalarCall));
          }
          // Collect function definition
          this.#collectFunctionDefinition(rhsCall.functionName, ctx);
          return null;
        }
        // Fallback: use a compact name expression for the LHS instead of the full array.
        // E.g., {result[1], result[2], result[3]} = ewm(...) → result = ewm(...)
        const elements = lhsElements;
        if (elements.length > 0) {
          // Extract common root name from all indexed elements
          const rootNames = elements.map((e) => {
            const elName = e instanceof ModelicaVariable ? e.name : e instanceof ModelicaNameExpression ? e.name : null;
            if (!elName) return null;
            const bracketIdx = elName.indexOf("[");
            return bracketIdx >= 0 ? elName.substring(0, bracketIdx) : null;
          });
          const firstRoot = rootNames[0];
          if (firstRoot && rootNames.every((r) => r === firstRoot)) {
            expression1 = new ModelicaNameExpression(firstRoot);
          }
        }
      }

      // Expand subscripted colon expressions and bare array names to ModelicaArray
      // e.g., x[:] → {x[1], x[2], ...} or y → {y[1], y[2], ...}
      // Only expand when needed for array-to-array scalarization
      const expandSubscriptedColon = (expr: ModelicaExpression): ModelicaArray | null => {
        if (expr instanceof ModelicaSubscriptedExpression && expr.base instanceof ModelicaNameExpression) {
          const baseName = expr.base.name;
          if (expr.subscripts.length === 1 && expr.subscripts[0] instanceof ModelicaColonExpression) {
            const vars = ctx.dae.variables
              .filter((v) => v.name.startsWith(baseName + "["))
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            if (vars.length > 0) {
              return new ModelicaArray(
                [vars.length],
                vars.map((v) => new ModelicaNameExpression(v.name)),
              );
            }
          }
        }
        return null;
      };
      const expandNameToArray = (expr: ModelicaExpression): ModelicaArray | null => {
        if (expr instanceof ModelicaNameExpression) {
          const vars = ctx.dae.variables
            .filter((v) => v.name.startsWith(expr.name + "["))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          if (vars.length > 0) {
            return new ModelicaArray(
              [vars.length],
              vars.map((v) => new ModelicaNameExpression(v.name)),
            );
          }
        }
        return null;
      };

      // First expand explicit colon-subscripts (x[:])
      const colon1 = expandSubscriptedColon(expression1);
      const colon2 = expandSubscriptedColon(expression2);
      if (colon1) expression1 = colon1;
      if (colon2) expression2 = colon2;
      // Then expand bare names only if the other side is already an array (or was just expanded)
      if (expression1 instanceof ModelicaArray && !(expression2 instanceof ModelicaArray)) {
        const exp2 = expandNameToArray(expression2);
        if (exp2) expression2 = exp2;
      }
      if (expression2 instanceof ModelicaArray && !(expression1 instanceof ModelicaArray)) {
        const exp1 = expandNameToArray(expression1);
        if (exp1) expression1 = exp1;
      }

      // Expand array-to-array equations into per-element scalar equations
      if (expression1 instanceof ModelicaArray && expression2 instanceof ModelicaArray) {
        const flat1 = [...expression1.flatElements];
        const flat2 = [...expression2.flatElements];
        const count = Math.min(flat1.length, flat2.length);
        for (let i = 0; i < count; i++) {
          let e1 = flat1[i];
          let e2 = flat2[i];
          if (!e1 || !e2) continue;
          if (isRealTyped(e1, ctx.dae)) e2 = castToReal(e2) ?? e2;
          if (isRealTyped(e2, ctx.dae)) e1 = castToReal(e1) ?? e1;
          ctx.dae.equations.push(new ModelicaSimpleEquation(e1, e2));
        }
        return null;
      }
      // Widen integers to Real when the other side is Real-typed
      // Skip coercion for collapsed array name expressions (they already reference Real arrays)
      const isArrayName = (e: ModelicaExpression): boolean =>
        e instanceof ModelicaNameExpression && ctx.dae.variables.some((v) => v.name.startsWith(e.name + "["));
      if (isRealTyped(expression1, ctx.dae) && !isArrayName(expression2))
        expression2 = coerceToReal(expression2, ctx.dae) ?? expression2;
      if (isRealTyped(expression2, ctx.dae) && !isArrayName(expression1))
        expression1 = coerceToReal(expression1, ctx.dae) ?? expression1;
      ctx.dae.equations.push(
        new ModelicaSimpleEquation(
          expression1,
          expression2,
          node.description?.strings?.map((d) => d.text ?? "")?.join(" "),
        ),
      );
    }
    return null;
  }

  visitSpecialEquation(node: ModelicaSpecialEquationSyntaxNode, ctx: FlattenerContext): null {
    const rawName = node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ?? "";
    const isGlobal = node.functionReference?.global === true;
    const isBuiltin = !rawName.includes(".") && ModelicaSyntaxFlattener.#isBuiltinFunction(rawName);
    const functionName = isGlobal || isBuiltin ? rawName : this.#resolveFullyQualifiedName(rawName, ctx);
    const flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      const flatArg = arg.expression?.accept(this, ctx);
      if (flatArg) flatArgs.push(flatArg);
    }
    // Coerce integer arguments to Real for built-in functions that expect Real args
    const realArgBuiltins = new Set<string>([]);
    if (realArgBuiltins.has(functionName)) {
      for (let i = 0; i < flatArgs.length; i++) {
        const coerced = castToReal(flatArgs[i] ?? null);
        if (coerced) flatArgs[i] = coerced;
      }
    }
    const call = new ModelicaFunctionCallExpression(functionName, flatArgs);
    ctx.dae.equations.push(new ModelicaFunctionCallEquation(call));
    // Collect function definition if it's a user-defined function
    this.#collectFunctionDefinition(functionName, ctx);
    return null;
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode): ModelicaExpression | null {
    return new ModelicaStringLiteral(node.text ?? "");
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    const operand = node.operand?.accept(this, ctx);
    const operator = node.operator;
    if (!operator || !operand) return null;
    // Constant fold: negate/plus numeric literals directly
    if (operator === ModelicaUnaryOperator.UNARY_MINUS) {
      if (operand instanceof ModelicaRealLiteral) return new ModelicaRealLiteral(-operand.value);
      if (operand instanceof ModelicaIntegerLiteral) return new ModelicaIntegerLiteral(-operand.value);
      // Distribute negation into first factor of multiplication: -(a * b) → (-a) * b
      if (
        operand instanceof ModelicaBinaryExpression &&
        (operand.operator === ModelicaBinaryOperator.MULTIPLICATION ||
          operand.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION)
      ) {
        const negatedFirst = new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, operand.operand1);
        return new ModelicaBinaryExpression(operand.operator, negatedFirst, operand.operand2);
      }
    }
    if (operator === ModelicaUnaryOperator.UNARY_PLUS) {
      if (operand instanceof ModelicaRealLiteral || operand instanceof ModelicaIntegerLiteral) return operand;
    }
    return new ModelicaUnaryExpression(operator, operand);
  }

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode): ModelicaIntegerLiteral | null {
    return new ModelicaIntegerLiteral(node.value);
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode): ModelicaRealLiteral | null {
    return new ModelicaRealLiteral(node.value, node.text ?? undefined);
  }
}

/**
 * Recursively substitute all occurrences of a named iterator variable in an expression
 * with a given replacement value. Used for expanding comprehension subscripts:
 * array(expr for i in 1:N)[k] → expr{i := k}
 */
function substituteIterator(expr: ModelicaExpression, iterName: string, value: ModelicaExpression): ModelicaExpression {
  if (expr instanceof ModelicaNameExpression && expr.name === iterName) {
    return value;
  }
  if (expr instanceof ModelicaBinaryExpression) {
    const op1 = substituteIterator(expr.operand1, iterName, value);
    const op2 = substituteIterator(expr.operand2, iterName, value);
    return op1 === expr.operand1 && op2 === expr.operand2
      ? expr
      : new ModelicaBinaryExpression(expr.operator, op1, op2);
  }
  if (expr instanceof ModelicaUnaryExpression) {
    const op = substituteIterator(expr.operand, iterName, value);
    return op === expr.operand ? expr : new ModelicaUnaryExpression(expr.operator, op);
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    const args = expr.args.map((a) => substituteIterator(a, iterName, value));
    return new ModelicaFunctionCallExpression(expr.functionName, args);
  }
  if (expr instanceof ModelicaSubscriptedExpression) {
    const base = substituteIterator(expr.base, iterName, value);
    const subs = expr.subscripts.map((s) => substituteIterator(s, iterName, value));
    return new ModelicaSubscriptedExpression(base, subs);
  }
  if (expr instanceof ModelicaArray) {
    const els = expr.elements.map((e) => substituteIterator(e, iterName, value));
    return new ModelicaArray(expr.shape, els);
  }
  if (expr instanceof ModelicaIfElseExpression) {
    const cond = substituteIterator(expr.condition, iterName, value);
    const then_ = substituteIterator(expr.thenExpression, iterName, value);
    const else_ = substituteIterator(expr.elseExpression, iterName, value);
    const elseIfs = expr.elseIfClauses.map((ei) => ({
      condition: substituteIterator(ei.condition, iterName, value),
      expression: substituteIterator(ei.expression, iterName, value),
    }));
    return new ModelicaIfElseExpression(cond, then_, elseIfs, else_);
  }
  return expr;
}

function castToReal(expression: ModelicaExpression | null): ModelicaExpression | null {
  if (!expression) return null;
  if (expression instanceof ModelicaIntegerLiteral) return new ModelicaRealLiteral(expression.value);
  if (expression instanceof ModelicaArray) {
    return new ModelicaArray(
      expression.shape,
      expression.elements.map((e) => castToReal(e) as ModelicaExpression),
    );
  }
  if (expression instanceof ModelicaUnaryExpression) {
    const operand = castToReal(expression.operand) ?? expression.operand;
    if (operand !== expression.operand) return new ModelicaUnaryExpression(expression.operator, operand);
  }
  if (expression instanceof ModelicaBinaryExpression) {
    const op1 = castToReal(expression.operand1) ?? expression.operand1;
    const op2 = castToReal(expression.operand2) ?? expression.operand2;
    if (op1 !== expression.operand1 || op2 !== expression.operand2)
      return new ModelicaBinaryExpression(expression.operator, op1, op2);
  }
  if (expression instanceof ModelicaFunctionCallExpression) {
    // Use per-parameter coercion for built-in functions; only coerce args whose
    // corresponding parameter type is Real according to the function signature.
    // For user-defined functions, do NOT coerce arguments here — they handle
    // their own per-parameter coercion during function call flattening.
    const builtinDef = BUILTIN_FUNCTIONS.get(expression.functionName);
    if (!builtinDef) return expression; // User-defined: already correctly coerced
    if (builtinDef.outputType !== "Real") return expression;
    const args = expression.args.map((a, i) => {
      if (builtinDef.inputs[i]?.type !== "Real") return a;
      return castToReal(a) ?? a;
    });
    if (args.some((a, i) => a !== expression.args[i]))
      return new ModelicaFunctionCallExpression(expression.functionName, args);
  }
  if (expression instanceof ModelicaRangeExpression) {
    const start = castToReal(expression.start) ?? expression.start;
    const end = castToReal(expression.end) ?? expression.end;
    const step = expression.step ? castToReal(expression.step) : null;
    if (start !== expression.start || end !== expression.end || step !== expression.step)
      return new ModelicaRangeExpression(start, end, step);
  }
  if (expression instanceof ModelicaIfElseExpression) {
    const thenExpr = castToReal(expression.thenExpression) ?? expression.thenExpression;
    const elseExpr = castToReal(expression.elseExpression) ?? expression.elseExpression;
    const elseIfClauses = expression.elseIfClauses.map((c) => ({
      condition: c.condition,
      expression: castToReal(c.expression) ?? c.expression,
    }));
    if (thenExpr !== expression.thenExpression || elseExpr !== expression.elseExpression)
      return new ModelicaIfElseExpression(expression.condition, thenExpr, elseIfClauses, elseExpr);
  }
  return expression;
}

// Like castToReal, but also wraps non-literal Integer-typed expressions
// in type-cast comments (e.g. wrapping i as  Real  (i) ).
// Use only in equation/statement contexts where the type cast should be visible in the output.
function coerceToReal(expression: ModelicaExpression | null, dae?: ModelicaDAE): ModelicaExpression | null {
  if (!expression) return null;
  // First try castToReal for literal/structural conversion
  const casted = castToReal(expression);
  if (casted !== expression) return casted;
  // Wrap Integer variables in /*Real*/(...)
  if (expression instanceof ModelicaIntegerVariable) {
    return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
  }
  if (expression instanceof ModelicaEnumerationLiteral) {
    return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
  }
  // Check if a named expression refers to a non-Real variable (Integer, Boolean, etc.)
  // or an unresolved name (e.g. loop variables which are Integer by default)
  if (expression instanceof ModelicaNameExpression && dae) {
    // Check built-in variables first (e.g., time is Real)
    const builtinType = BUILTIN_VARIABLES.get(expression.name);
    if (builtinType === "Real") {
      // Already Real-typed, no coercion needed
    } else if (builtinType) {
      return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
    } else {
      const variable = dae.variables.find((v) => v.name === expression.name);
      if (variable instanceof ModelicaRealVariable) {
        // Already Real-typed, no coercion needed
      } else if (!variable) {
        // Check for array name references — e.g., "B" when "B[1,1]", "B[1,2]" etc. exist
        const arrayPrefix = expression.name + "[";
        const arrayEl = dae.variables.find((v) => v.name.startsWith(arrayPrefix));
        if (arrayEl instanceof ModelicaRealVariable) {
          // Array of Real variables — no coercion needed
        } else if (arrayEl) {
          return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
        } else {
          // Check for encoded array function parameters (e.g., positionvector[1] → \0[3]\0positionvector)
          const bracketIdx = expression.name.indexOf("[");
          const baseName = bracketIdx >= 0 ? expression.name.substring(0, bracketIdx) : expression.name;
          const encodedMatch = dae.variables.find((v) => v.name.startsWith("\0") && v.name.endsWith("\0" + baseName));
          if (encodedMatch instanceof ModelicaRealVariable) {
            // Element of a Real array, no coercion needed
          } else {
            return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
          }
        }
      } else {
        return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
      }
    }
  }
  // Recurse into binary expressions
  if (expression instanceof ModelicaBinaryExpression) {
    // If neither operand is already Real-typed, wrap the entire expression
    if (!isRealTyped(expression.operand1, dae) && !isRealTyped(expression.operand2, dae)) {
      return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
    }
    const op1 = coerceToReal(expression.operand1, dae) ?? expression.operand1;
    const op2 = coerceToReal(expression.operand2, dae) ?? expression.operand2;
    if (op1 !== expression.operand1 || op2 !== expression.operand2)
      return new ModelicaBinaryExpression(expression.operator, op1, op2);
  }
  // Recurse into unary expressions
  if (expression instanceof ModelicaUnaryExpression) {
    const operand = coerceToReal(expression.operand, dae) ?? expression.operand;
    if (operand !== expression.operand) return new ModelicaUnaryExpression(expression.operator, operand);
  }
  return expression;
}

function isRealTyped(expr: ModelicaExpression, dae?: ModelicaDAE): boolean {
  if (expr instanceof ModelicaRealVariable) return true;
  if (expr instanceof ModelicaRealLiteral) return true;
  if (expr instanceof ModelicaBinaryExpression)
    return isRealTyped(expr.operand1, dae) || isRealTyped(expr.operand2, dae);
  if (expr instanceof ModelicaUnaryExpression) return isRealTyped(expr.operand, dae);
  if (expr instanceof ModelicaNameExpression && dae) {
    const exactMatch = dae.variables.find((variable) => variable.name === expr.name);
    if (exactMatch instanceof ModelicaRealVariable) return true;

    const prefix = expr.name + "[";
    const arrayElement = dae.variables.find((variable) => variable.name.startsWith(prefix));
    if (arrayElement instanceof ModelicaRealVariable) return true;

    // Check for encoded array function parameters (\0[dims]\0name)
    const encodedMatch = dae.variables.find((v) => v.name.startsWith("\0") && v.name.endsWith("\0" + expr.name));
    if (encodedMatch instanceof ModelicaRealVariable) return true;
  }
  if (expr instanceof ModelicaNameExpression && expr.name === "time") return true;
  if (expr instanceof ModelicaSubscriptedExpression) return isRealTyped(expr.base, dae);
  if (expr instanceof ModelicaFunctionCallExpression) {
    // Use the function's output type from the built-in signatures
    const builtinDef = BUILTIN_FUNCTIONS.get(expr.functionName);
    if (builtinDef) {
      // For polymorphic functions with Integer overloads (e.g., max, min),
      // check if the Integer overload matches (all args are integer-typed).
      // If so, the output is Integer, not Real.
      if (builtinDef.overloads) {
        const intOverload = builtinDef.overloads.find((o) => o.outputType === "Integer");
        if (intOverload && expr.args.every((a) => isIntegerTyped(a, dae))) {
          return false;
        }
      }
      return builtinDef.outputType === "Real";
    }
    // Fallback for non-builtin functions: if any arg is Real, assume output is Real
    return expr.args.some((a) => isRealTyped(a, dae));
  }
  return false;
}

function isIntegerTyped(expr: ModelicaExpression, dae?: ModelicaDAE): boolean {
  if (expr instanceof ModelicaIntegerVariable) return true;
  if (expr instanceof ModelicaIntegerLiteral) return true;
  if (expr instanceof ModelicaBinaryExpression)
    return isIntegerTyped(expr.operand1, dae) && isIntegerTyped(expr.operand2, dae);
  if (expr instanceof ModelicaUnaryExpression) return isIntegerTyped(expr.operand, dae);
  if (expr instanceof ModelicaNameExpression && dae) {
    const exactMatch = dae.variables.find((variable) => variable.name === expr.name);
    if (exactMatch instanceof ModelicaIntegerVariable) return true;

    const prefix = expr.name + "[";
    const arrayElement = dae.variables.find((variable) => variable.name.startsWith(prefix));
    if (arrayElement instanceof ModelicaIntegerVariable) return true;
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    const builtinDef = BUILTIN_FUNCTIONS.get(expr.functionName);
    if (builtinDef) {
      if (builtinDef.outputType === "Integer") return true;
      // For polymorphic functions, check if Integer overload matches
      if (builtinDef.overloads) {
        const intOverload = builtinDef.overloads.find((o) => o.outputType === "Integer");
        if (intOverload && expr.args.every((a) => isIntegerTyped(a, dae))) return true;
      }
    }
    // Fallback for non-builtin functions: if all args are Integer, assume output is Integer
    if (!builtinDef && expr.args.length > 0 && expr.args.every((a) => isIntegerTyped(a, dae))) return true;
    return false;
  }
  return false;
}

function isLiteral(expr: ModelicaExpression): boolean {
  return (
    expr instanceof ModelicaIntegerLiteral ||
    expr instanceof ModelicaRealLiteral ||
    expr instanceof ModelicaBooleanLiteral ||
    expr instanceof ModelicaStringLiteral ||
    expr instanceof ModelicaEnumerationLiteral
  );
}

/** Check if an expression is a ModelicaArray whose elements are all literals (recursively). */
function isLiteralArray(expr: ModelicaExpression): boolean {
  if (!(expr instanceof ModelicaArray)) return false;
  return expr.elements.every((e) => isLiteral(e) || isLiteralArray(e));
}

/**
 * Expand an array-typed function variable (encoded as \0[dims]\0name) into a
 * ModelicaArray of indexed ModelicaNameExpression elements.
 * E.g., \0[3]\0positionvector → {positionvector[1], positionvector[2], positionvector[3]}
 */
function expandArrayVariable(variable: ModelicaVariable): ModelicaArray | null {
  const name = variable.name;
  if (!name.startsWith("\0")) return null;
  const secondNull = name.indexOf("\0", 1);
  if (secondNull < 0) return null;
  const dimsStr = name.substring(1, secondNull); // "[3]"
  const baseName = name.substring(secondNull + 1); // "positionvector"
  // Parse dimensions — for now handle simple 1D arrays like [3]
  const dimMatch = dimsStr.match(/^\[(\d+)\]$/);
  if (!dimMatch) return null;
  const size = parseInt(dimMatch[1] ?? "0", 10);
  const elements: ModelicaExpression[] = [];
  for (let i = 1; i <= size; i++) {
    elements.push(new ModelicaNameExpression(`${baseName}[${i}]`));
  }
  return new ModelicaArray([size], elements);
}

function canonicalizeBinaryExpression(
  operator: ModelicaBinaryOperator,
  operand1: ModelicaExpression,
  operand2: ModelicaExpression,
  dae?: ModelicaDAE,
): ModelicaExpression {
  // Substitute constant variables with their literal binding values
  if (
    operand1 instanceof ModelicaVariable &&
    operand1.variability === ModelicaVariability.CONSTANT &&
    operand1.expression &&
    isLiteral(operand1.expression)
  ) {
    operand1 = operand1.expression;
  }
  if (
    operand2 instanceof ModelicaVariable &&
    operand2.variability === ModelicaVariability.CONSTANT &&
    operand2.expression &&
    isLiteral(operand2.expression)
  ) {
    operand2 = operand2.expression;
  }
  // Constant fold string concatenation
  if (
    operator === ModelicaBinaryOperator.ADDITION &&
    operand1 instanceof ModelicaStringLiteral &&
    operand2 instanceof ModelicaStringLiteral
  ) {
    return new ModelicaStringLiteral(operand1.value + operand2.value);
  }
  // Expand array-typed function parameters (encoded as \0[dims]\0name) into
  // ModelicaArray of indexed name expressions for scalar-array binary operations.
  // Look up from the DAE since the operands are ModelicaNameExpressions at this point.
  if (dae && operand1 instanceof ModelicaNameExpression) {
    const op1Name = operand1.name;
    const encoded = dae.variables.find((v) => v.name.startsWith("\0") && v.name.endsWith("\0" + op1Name));
    if (encoded) {
      const expanded = expandArrayVariable(encoded);
      if (expanded) operand1 = expanded;
    }
  }
  if (dae && operand2 instanceof ModelicaNameExpression) {
    const op2Name = operand2.name;
    const encoded = dae.variables.find((v) => v.name.startsWith("\0") && v.name.endsWith("\0" + op2Name));
    if (encoded) {
      const expanded = expandArrayVariable(encoded);
      if (expanded) operand2 = expanded;
    }
  }

  // Constant fold array operations (elementwise)
  const isElementwiseOp = operator.startsWith(".");
  const scalarOp = (isElementwiseOp ? operator.substring(1) : operator) as ModelicaBinaryOperator;

  if (operand1 instanceof ModelicaArray && operand2 instanceof ModelicaArray) {
    // Matrix-vector multiplication: M[m,n] * v[n] → w[m] where w[i] = sum(M[i,j] * v[j])
    // This applies only to non-elementwise * (Modelica semantics).
    if (
      !isElementwiseOp &&
      operator === ModelicaBinaryOperator.MULTIPLICATION &&
      operand1.shape.length === 2 &&
      operand2.shape.length === 1
    ) {
      const nRows = operand1.shape[0] ?? 0;
      const nCols = operand1.shape[1] ?? 0;
      const vecLen = operand2.shape[0] ?? 0;
      if (nCols === vecLen && nCols > 0 && nRows > 0) {
        // operand1.elements are row arrays: [row0, row1, ...]
        const resultElements: ModelicaExpression[] = [];
        for (let i = 0; i < nRows; i++) {
          const row = operand1.elements[i];
          const rowElements = row instanceof ModelicaArray ? row.elements : [row];
          // Build dot product: row[0]*v[0] + row[1]*v[1] + ...
          let dotProduct: ModelicaExpression | null = null;
          for (let j = 0; j < nCols; j++) {
            const mij = rowElements[j];
            const vj = operand2.elements[j];
            if (!mij || !vj) continue;
            const term = canonicalizeBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, mij, vj, dae);
            if (!dotProduct) {
              dotProduct = term;
            } else {
              dotProduct = canonicalizeBinaryExpression(ModelicaBinaryOperator.ADDITION, dotProduct, term, dae);
            }
          }
          resultElements.push(dotProduct ?? new ModelicaIntegerLiteral(0));
        }
        return new ModelicaArray([nRows], resultElements);
      }
    }
    if (scalarOp === "+" || scalarOp === "-" || scalarOp === "*" || scalarOp === "/") {
      if (operand1.elements.length === operand2.elements.length) {
        const newElements = operand1.elements.map((e1, i) =>
          canonicalizeBinaryExpression(
            scalarOp,
            e1,
            (operand2 as ModelicaArray).elements[i] as ModelicaExpression,
            dae,
          ),
        );
        return new ModelicaArray(operand1.shape, newElements);
      }
    }
  } else if (operand1 instanceof ModelicaArray && isLiteral(operand2)) {
    if (scalarOp === "+" || scalarOp === "-" || scalarOp === "*" || scalarOp === "/") {
      // Build elements directly to preserve source operand order (array * scalar)
      const newElements = operand1.elements.map((e) => new ModelicaBinaryExpression(scalarOp, e, operand2));
      return new ModelicaArray(operand1.shape, newElements);
    }
  } else if (isLiteral(operand1) && operand2 instanceof ModelicaArray) {
    if (scalarOp === "+" || scalarOp === "-" || scalarOp === "*" || scalarOp === "/") {
      // Build elements directly to preserve source operand order (scalar * array)
      const newElements = (operand2 as ModelicaArray).elements.map(
        (e) => new ModelicaBinaryExpression(scalarOp, operand1, e),
      );
      return new ModelicaArray(operand2.shape, newElements);
    }
  }

  // Constant fold: evaluate binary operations with two numeric literal operands
  if (
    (operand1 instanceof ModelicaRealLiteral || operand1 instanceof ModelicaIntegerLiteral) &&
    (operand2 instanceof ModelicaRealLiteral || operand2 instanceof ModelicaIntegerLiteral)
  ) {
    const v1 = operand1.value;
    const v2 = operand2.value;
    let result: number | null = null;
    switch (operator) {
      case ModelicaBinaryOperator.ADDITION:
        result = v1 + v2;
        break;
      case ModelicaBinaryOperator.SUBTRACTION:
        result = v1 - v2;
        break;
      case ModelicaBinaryOperator.MULTIPLICATION:
        result = v1 * v2;
        break;
      case ModelicaBinaryOperator.DIVISION:
        result = v2 !== 0 ? v1 / v2 : null;
        break;
      case ModelicaBinaryOperator.EXPONENTIATION:
        result = v1 ** v2;
        break;
    }
    if (result != null && Number.isFinite(result)) {
      // Return Integer if both operands were Integer and the result is an exact integer
      if (
        operand1 instanceof ModelicaIntegerLiteral &&
        operand2 instanceof ModelicaIntegerLiteral &&
        Number.isInteger(result)
      ) {
        return new ModelicaIntegerLiteral(result);
      }
      return new ModelicaRealLiteral(result);
    }
    // Constant fold comparison operators with two numeric literals
    let boolResult: boolean | null = null;
    switch (operator) {
      case ModelicaBinaryOperator.LESS_THAN:
        boolResult = v1 < v2;
        break;
      case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
        boolResult = v1 <= v2;
        break;
      case ModelicaBinaryOperator.GREATER_THAN:
        boolResult = v1 > v2;
        break;
      case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
        boolResult = v1 >= v2;
        break;
      case ModelicaBinaryOperator.EQUALITY:
        boolResult = v1 === v2;
        break;
      case ModelicaBinaryOperator.INEQUALITY:
        boolResult = v1 !== v2;
        break;
    }
    if (boolResult != null) return new ModelicaBooleanLiteral(boolResult);
  }
  // Empty (zero-size) array elimination: operations with empty arrays collapse.
  // Multiplication with an empty array yields the empty array (zero-size product → 0).
  // Addition with an empty array yields the other operand (additive identity).
  const isEmptyArray = (e: ModelicaExpression) => e instanceof ModelicaArray && e.shape.some((d) => d === 0);
  if (isEmptyArray(operand1) || isEmptyArray(operand2)) {
    if (
      operator === ModelicaBinaryOperator.MULTIPLICATION ||
      operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
    ) {
      return isEmptyArray(operand1) ? operand1 : operand2;
    }
    if (operator === ModelicaBinaryOperator.ADDITION || operator === ModelicaBinaryOperator.SUBTRACTION) {
      return isEmptyArray(operand1) ? operand2 : operand1;
    }
    // For any other operator, return the empty array
    return isEmptyArray(operand1) ? operand1 : operand2;
  }
  // Subtraction cancellation: x - x → 0
  if (operator === ModelicaBinaryOperator.SUBTRACTION && operand1.hash === operand2.hash) {
    return new ModelicaIntegerLiteral(0);
  }
  // Additive identity: 0 + x → x, x + 0 → x
  if (operator === ModelicaBinaryOperator.ADDITION) {
    if (
      (operand1 instanceof ModelicaRealLiteral || operand1 instanceof ModelicaIntegerLiteral) &&
      operand1.value === 0
    ) {
      return operand2;
    }
    if (
      (operand2 instanceof ModelicaRealLiteral || operand2 instanceof ModelicaIntegerLiteral) &&
      operand2.value === 0
    ) {
      return operand1;
    }
  }
  // Multiplicative zero: 0 * x → 0, x * 0 → 0
  if (
    operator === ModelicaBinaryOperator.MULTIPLICATION ||
    operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
  ) {
    if (
      (operand1 instanceof ModelicaRealLiteral || operand1 instanceof ModelicaIntegerLiteral) &&
      operand1.value === 0
    ) {
      return operand1;
    }
    if (
      (operand2 instanceof ModelicaRealLiteral || operand2 instanceof ModelicaIntegerLiteral) &&
      operand2.value === 0
    ) {
      return operand2;
    }
  }
  // Multiplicative identity: 1 * x → x, x * 1 → x
  if (
    operator === ModelicaBinaryOperator.MULTIPLICATION ||
    operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
  ) {
    if (
      (operand1 instanceof ModelicaRealLiteral || operand1 instanceof ModelicaIntegerLiteral) &&
      operand1.value === 1
    ) {
      return operand2;
    }
    if (
      (operand2 instanceof ModelicaRealLiteral || operand2 instanceof ModelicaIntegerLiteral) &&
      operand2.value === 1
    ) {
      return operand1;
    }
  }
  if (operator === ModelicaBinaryOperator.DIVISION && operand2 instanceof ModelicaIntegerLiteral) {
    const reciprocal = new ModelicaRealLiteral(1.0 / operand2.value);
    const castOp1 = wrapIntegerAsReal(operand1, dae);
    return new ModelicaBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, reciprocal, castOp1);
  }
  // Promote integer operands to Real when the other operand is Real-typed
  // Try wrapIntegerAsReal first (produces /*Real*/ casts); only fall back to castToReal
  // for expressions that wrapIntegerAsReal cannot handle.
  if (isRealTyped(operand1, dae)) {
    const wrapped = wrapIntegerAsReal(operand2, dae);
    operand2 = wrapped !== operand2 ? wrapped : (castToReal(operand2) ?? operand2);
  }
  if (isRealTyped(operand2, dae)) {
    const wrapped = wrapIntegerAsReal(operand1, dae);
    operand1 = wrapped !== operand1 ? wrapped : (castToReal(operand1) ?? operand1);
  }
  if (operator === ModelicaBinaryOperator.SUBTRACTION && isLiteral(operand2)) {
    const negated = new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, operand2);
    return new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, negated, operand1);
  }
  // Subtraction partial cancellation: (a + x) - x → a, (x + a) - x → a
  if (
    operator === ModelicaBinaryOperator.SUBTRACTION &&
    operand1 instanceof ModelicaBinaryExpression &&
    operand1.operator === ModelicaBinaryOperator.ADDITION
  ) {
    if (operand1.operand2.hash === operand2.hash) {
      return operand1.operand1;
    }
    if (operand1.operand1.hash === operand2.hash) {
      return operand1.operand2;
    }
  }
  // Canonicalize a - c * expr → a + (-c) * expr when c is a numeric literal
  if (
    operator === ModelicaBinaryOperator.SUBTRACTION &&
    operand2 instanceof ModelicaBinaryExpression &&
    operand2.operator === ModelicaBinaryOperator.MULTIPLICATION &&
    isLiteral(operand2.operand1)
  ) {
    const negatedCoeff = new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, operand2.operand1);
    const negatedMul = new ModelicaBinaryExpression(
      ModelicaBinaryOperator.MULTIPLICATION,
      negatedCoeff,
      operand2.operand2,
    );
    return new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, operand1, negatedMul);
  }
  // Algebraic simplification: x + c * x → (1 + c) * x (and symmetric forms)
  // e.g., x[j] + x[j] * 0.01 → 0.01 * x[j] + x[j] (after lit-left) → 1.01 * x[j]
  if (operator === ModelicaBinaryOperator.ADDITION) {
    // Check for pattern: a + c * a or c * a + a
    const tryFold = (baseExpr: ModelicaExpression, multExpr: ModelicaExpression): ModelicaExpression | null => {
      if (multExpr instanceof ModelicaBinaryExpression && multExpr.operator === ModelicaBinaryOperator.MULTIPLICATION) {
        // c * a: check if multExpr.operand2 matches baseExpr
        if (isLiteral(multExpr.operand1) && multExpr.operand2.hash === baseExpr.hash) {
          const c = multExpr.operand1;
          const one =
            c instanceof ModelicaIntegerLiteral ? new ModelicaIntegerLiteral(1) : new ModelicaRealLiteral(1.0);
          const newCoeff = canonicalizeBinaryExpression(ModelicaBinaryOperator.ADDITION, one, c, dae);
          return canonicalizeBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, newCoeff, baseExpr, dae);
        }
        // a * c: check if multExpr.operand1 matches baseExpr
        if (isLiteral(multExpr.operand2) && multExpr.operand1.hash === baseExpr.hash) {
          const c = multExpr.operand2;
          const one =
            c instanceof ModelicaIntegerLiteral ? new ModelicaIntegerLiteral(1) : new ModelicaRealLiteral(1.0);
          const newCoeff = canonicalizeBinaryExpression(ModelicaBinaryOperator.ADDITION, one, c, dae);
          return canonicalizeBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, newCoeff, baseExpr, dae);
        }
      }
      return null;
    };
    const folded = tryFold(operand1, operand2) ?? tryFold(operand2, operand1);
    if (folded) return folded;
  }
  // Canonicalize commutative operations: put literals on the left
  // (but NOT for string concatenation, which is not commutative)
  // Recurse through canonicalize so subsequent rules (e.g., additive constant collection) trigger.
  if (
    (operator === ModelicaBinaryOperator.ADDITION || operator === ModelicaBinaryOperator.MULTIPLICATION) &&
    !isLiteral(operand1) &&
    isLiteral(operand2) &&
    !(operand2 instanceof ModelicaStringLiteral)
  ) {
    return canonicalizeBinaryExpression(operator, operand2, operand1, dae);
  }
  // Additive constant collection: c1 + (c2 + x) → (c1 + c2) + x
  // Collects numeric constants in addition chains for constant folding.
  if (operator === ModelicaBinaryOperator.ADDITION && isLiteral(operand1)) {
    if (
      operand2 instanceof ModelicaBinaryExpression &&
      operand2.operator === ModelicaBinaryOperator.ADDITION &&
      isLiteral(operand2.operand1)
    ) {
      const folded = canonicalizeBinaryExpression(ModelicaBinaryOperator.ADDITION, operand1, operand2.operand1, dae);
      return canonicalizeBinaryExpression(ModelicaBinaryOperator.ADDITION, folded, operand2.operand2, dae);
    }
  }
  // Re-associate multiplications to float literal factors left:
  // (expr * literal) * other → literal * (expr * other)
  // (literal * expr) already handled by lit-left above; this covers the case
  // where the inner multiplication produced literal on the right.
  if (
    operator === ModelicaBinaryOperator.MULTIPLICATION &&
    operand1 instanceof ModelicaBinaryExpression &&
    operand1.operator === ModelicaBinaryOperator.MULTIPLICATION
  ) {
    // (a * c) * b where c is literal → c * (a * b)
    if (isLiteral(operand1.operand2) && !isLiteral(operand1.operand1)) {
      const inner = canonicalizeBinaryExpression(
        ModelicaBinaryOperator.MULTIPLICATION,
        operand1.operand1,
        operand2,
        dae,
      );
      return canonicalizeBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, operand1.operand2, inner, dae);
    }
    // (c * a) * b where c is literal → c * (a * b)
    if (isLiteral(operand1.operand1) && !isLiteral(operand2)) {
      const inner = canonicalizeBinaryExpression(
        ModelicaBinaryOperator.MULTIPLICATION,
        operand1.operand2,
        operand2,
        dae,
      );
      return canonicalizeBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, operand1.operand1, inner, dae);
    }
  }
  // Right-side re-association (left-associative output): a * (c * b) → (c * a) * b when c is literal
  if (
    operator === ModelicaBinaryOperator.MULTIPLICATION &&
    operand2 instanceof ModelicaBinaryExpression &&
    operand2.operator === ModelicaBinaryOperator.MULTIPLICATION &&
    isLiteral(operand2.operand1) &&
    !isLiteral(operand1)
  ) {
    const left = canonicalizeBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, operand2.operand1, operand1, dae);
    return canonicalizeBinaryExpression(ModelicaBinaryOperator.MULTIPLICATION, left, operand2.operand2, dae);
  }
  // Wrap integer variables with /*Real*/ when used with Real operands in any arithmetic context
  if (dae) {
    if (isRealTyped(operand1, dae)) {
      const op2 = wrapIntegerAsReal(operand2, dae);
      if (op2 !== operand2) {
        return new ModelicaBinaryExpression(operator, operand1, op2);
      }
    }
    if (isRealTyped(operand2, dae)) {
      const op1 = wrapIntegerAsReal(operand1, dae);
      if (op1 !== operand1) {
        return new ModelicaBinaryExpression(operator, op1, operand2);
      }
    }
  }

  // Preserve operand order for all operations to correctly match test expectations
  return new ModelicaBinaryExpression(operator, operand1, operand2);
}

function wrapIntegerAsReal(expr: ModelicaExpression, dae?: ModelicaDAE): ModelicaExpression {
  if (expr instanceof ModelicaIntegerVariable) {
    return new ModelicaFunctionCallExpression("/*Real*/", [expr]);
  }
  if (dae && expr instanceof ModelicaNameExpression) {
    const variable = dae.variables.find((v) => v.name === expr.name);
    if (variable instanceof ModelicaIntegerVariable) {
      return new ModelicaFunctionCallExpression("/*Real*/", [expr]);
    }
  }
  // Wrap entire Integer-typed function calls
  if (expr instanceof ModelicaFunctionCallExpression && expr.functionName !== "/*Real*/") {
    if (isIntegerTyped(expr, dae)) {
      return new ModelicaFunctionCallExpression("/*Real*/", [expr]);
    }
    // For user-defined functions: if not recognized as Real and all args are Integer, wrap
    const builtinDef = BUILTIN_FUNCTIONS.get(expr.functionName);
    if (!builtinDef && expr.args.length > 0 && expr.args.every((a) => isIntegerTyped(a, dae))) {
      return new ModelicaFunctionCallExpression("/*Real*/", [expr]);
    }
  }
  // Wrap Integer-typed binary expressions that contain user-defined function calls.
  // This produces /*Real*/(2 + f(x)) instead of 2.0 + f(x) (OMC-compatible).
  if (expr instanceof ModelicaBinaryExpression && isIntegerTyped(expr, dae)) {
    const containsUserFunctionCall = (e: ModelicaExpression): boolean => {
      if (
        e instanceof ModelicaFunctionCallExpression &&
        e.functionName !== "/*Real*/" &&
        !BUILTIN_FUNCTIONS.has(e.functionName)
      )
        return true;
      if (e instanceof ModelicaBinaryExpression)
        return containsUserFunctionCall(e.operand1) || containsUserFunctionCall(e.operand2);
      if (e instanceof ModelicaUnaryExpression) return containsUserFunctionCall(e.operand);
      return false;
    };
    if (containsUserFunctionCall(expr)) {
      return new ModelicaFunctionCallExpression("/*Real*/", [expr]);
    }
  }
  return expr;
}

/**
 * Handler type for non-numeric constant folding (Boolean, Enum, String conversions).
 * Returns a folded expression or null if not applicable.
 */
type SpecialTypeFoldHandler = (args: ModelicaExpression[]) => ModelicaExpression | null;

/**
 * Dispatch table for non-numeric type constant folding.
 * These handle cases that `tryFoldBuiltinFunction` cannot because they involve
 * non-numeric types (Boolean, Enum, String).
 */
const SPECIAL_TYPE_FOLD_HANDLERS: ReadonlyMap<string, SpecialTypeFoldHandler> = new Map<string, SpecialTypeFoldHandler>(
  [
    [
      "noEvent",
      (args) => {
        if (args.length === 1 && args[0] && isLiteral(args[0])) return args[0];
        return null;
      },
    ],

    [
      "String",
      (args) => {
        if (args.length < 1) return null;
        const arg0 = args[0];
        if (arg0 instanceof ModelicaIntegerLiteral) return new ModelicaStringLiteral(String(arg0.value));
        if (arg0 instanceof ModelicaRealLiteral) return new ModelicaStringLiteral(String(arg0.value));
        if (arg0 instanceof ModelicaBooleanLiteral) return new ModelicaStringLiteral(arg0.value ? "true" : "false");
        if (arg0 instanceof ModelicaStringLiteral) return arg0;
        if (arg0 instanceof ModelicaEnumerationLiteral) return new ModelicaStringLiteral(arg0.stringValue);
        return null;
      },
    ],

    [
      "Integer",
      (args) => {
        if (args.length === 1 && args[0] instanceof ModelicaEnumerationLiteral) {
          return new ModelicaIntegerLiteral(args[0].ordinalValue);
        }
        return null;
      },
    ],

    [
      "min",
      (args) => {
        if (args.length !== 2) return null;
        if (args[0] instanceof ModelicaBooleanLiteral && args[1] instanceof ModelicaBooleanLiteral) {
          return new ModelicaBooleanLiteral(args[0].value && args[1].value);
        }
        if (args[0] instanceof ModelicaEnumerationLiteral && args[1] instanceof ModelicaEnumerationLiteral) {
          return args[0].ordinalValue <= args[1].ordinalValue ? args[0] : args[1];
        }
        return null;
      },
    ],

    [
      "max",
      (args) => {
        if (args.length !== 2) return null;
        if (args[0] instanceof ModelicaBooleanLiteral && args[1] instanceof ModelicaBooleanLiteral) {
          return new ModelicaBooleanLiteral(args[0].value || args[1].value);
        }
        if (args[0] instanceof ModelicaEnumerationLiteral && args[1] instanceof ModelicaEnumerationLiteral) {
          return args[0].ordinalValue >= args[1].ordinalValue ? args[0] : args[1];
        }
        return null;
      },
    ],
  ],
);

/**
 * Try to fold function calls with non-numeric argument types (Boolean, Enum, String).
 * This complements `tryFoldBuiltinFunction` which only handles numeric literals.
 */
function tryFoldSpecialTypes(functionName: string, args: ModelicaExpression[]): ModelicaExpression | null {
  return SPECIAL_TYPE_FOLD_HANDLERS.get(functionName)?.(args) ?? null;
}

/**
 * Try to evaluate a built-in function call with literal arguments at compile time.
 * Returns the evaluated result as a literal, or null if evaluation is not possible.
 * Driven by metadata on {@link BuiltinFunctionDef}: `fold1`, `fold2`, `domainCheck`,
 * `identityValue`, and `preserveIntegerType`.
 */
function tryFoldBuiltinFunction(functionName: string, args: ModelicaExpression[]): ModelicaExpression | null {
  const def = BUILTIN_FUNCTIONS.get(functionName);
  if (!def) return null;

  // Zero-argument identity values for reduction functions over empty ranges
  if (args.length === 0 && def.identityValue !== undefined) {
    return Number.isInteger(def.identityValue)
      ? new ModelicaIntegerLiteral(def.identityValue)
      : new ModelicaRealLiteral(def.identityValue);
  }

  // Extract numeric values from all arguments
  const numArgs: number[] = [];
  for (const arg of args) {
    if (arg instanceof ModelicaRealLiteral || arg instanceof ModelicaIntegerLiteral) {
      numArgs.push(arg.value);
    } else {
      return null; // Non-literal argument — can't fold
    }
  }

  // Single-argument constant folding
  if (numArgs.length === 1 && def.fold1) {
    const x = numArgs[0] ?? 0;
    def.domainCheck?.(x);
    const result = def.fold1(x);
    if (!Number.isFinite(result)) return null;
    // Type-preserving functions (abs, sign): Integer in → Integer out
    if (def.preserveIntegerType && args[0] instanceof ModelicaIntegerLiteral) {
      return new ModelicaIntegerLiteral(result);
    }
    // Integer-output functions (ceil, floor, integer, div): always return Integer
    if (def.outputType === "Integer") return new ModelicaIntegerLiteral(result);
    return new ModelicaRealLiteral(result);
  }

  // Two-argument constant folding
  if (numArgs.length === 2 && def.fold2) {
    const [a, b] = numArgs as [number, number];
    const result = def.fold2(a, b);
    if (!Number.isFinite(result)) return null;
    // Integer output: either the function always returns Integer, or both args are Integer (polymorphic)
    const bothInteger = args[0] instanceof ModelicaIntegerLiteral && args[1] instanceof ModelicaIntegerLiteral;
    if (def.outputType === "Integer" || (bothInteger && Number.isInteger(result))) {
      return new ModelicaIntegerLiteral(result);
    }
    return new ModelicaRealLiteral(result);
  }

  return null;
}
