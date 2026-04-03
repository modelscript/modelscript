import type { ModelicaSyntaxNode } from "./syntax.js";
// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "../../util/io.js";

import { performBltTransformation } from "./blt.js";
import { BUILTIN_FUNCTIONS, BUILTIN_VARIABLES } from "./builtins.js";
import {
  ModelicaArray,
  ModelicaArrayEquation,
  ModelicaAssignmentStatement,
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaBooleanVariable,
  ModelicaBreakStatement,
  ModelicaClockPartition,
  ModelicaClockVariable,
  ModelicaColonExpression,
  ModelicaComplexAssignmentStatement,
  ModelicaComprehensionExpression,
  ModelicaDAE,
  ModelicaDAEPrinter,
  ModelicaEnumerationLiteral,
  ModelicaEnumerationVariable,
  ModelicaEquation,
  ModelicaExpression,
  ModelicaExpressionVariable,
  ModelicaForEquation,
  ModelicaForStatement,
  ModelicaFunctionCallEquation,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIfEquation,
  ModelicaIfStatement,
  ModelicaInitialStateEquation,
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
  ModelicaState,
  ModelicaStateMachine,
  ModelicaStatement,
  ModelicaStringLiteral,
  ModelicaStringVariable,
  ModelicaSubscriptedExpression,
  ModelicaTransitionEquation,
  ModelicaTupleExpression,
  ModelicaUnaryExpression,
  ModelicaVariable,
  ModelicaWhenEquation,
  ModelicaWhenStatement,
  ModelicaWhileStatement,
  type ModelicaElseIfClause,
  type ModelicaElseWhenClause,
  type ModelicaFunctionTypeSignature,
  type ModelicaObject,
} from "./dae.js";
import { makeDiagnostic, ModelicaErrorCode } from "./errors.js";
import { buildFilledArray, ModelicaInterpreter } from "./interpreter.js";
import {
  ModelicaArrayClassInstance,
  ModelicaBooleanClassInstance,
  ModelicaClassInstance,
  ModelicaClockClassInstance,
  ModelicaComponentInstance,
  ModelicaElementModification,
  ModelicaEntity,
  ModelicaEnumerationClassInstance,
  ModelicaExpressionClassInstance,
  ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance,
  ModelicaModelVisitor,
  ModelicaModification,
  ModelicaNamedElement,
  ModelicaParameterModification,
  ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance,
  ModelicaShortClassInstance,
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
  ModelicaElementModificationSyntaxNode,
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
  activeClassStack?: ModelicaClassInstance[] | undefined;
  /** Map from class instance in the stack to its corresponding prefix in the DAE. */
  activePrefixes?: Map<ModelicaClassInstance, string> | undefined;
  /** Stream variable connections from connect equations, for inStream() expansion. */
  streamConnections?: { side1: string; side2: string }[];
  /** Deferred flow variable connection pairs for connection-set-based flow balance generation. */
  flowConnectPairs?: { name1: string; name2: string }[];
  /** Monomorphization bindings for higher order functions */
  functionBindings?: Map<string, ModelicaPartialFunctionExpression | string>;

  options?: ModelicaCompilerOptions;
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
        const funcVar = ctx.dae.variables.getEncoded(varName);
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
              const interp = new ModelicaInterpreter(true);
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
        const matchingVars = ctx.dae.variables.getArrayElements(arrayArg.name);

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

import type { ModelicaCompilerOptions } from "../context.js";

/**
 * Visitor that traverses the semantic Modelica object model and flattens it into a DAE structure.
 * This class handles the instantiation and flattening of arrays, records, blocks, models, and variables.
 */
/**
 * Resolves through ShortClasses and ExtendsClasses to find a predefined base class,
 * returning it if found, or null otherwise.
 */
function getUnderlyingPredefinedClass(cls: ModelicaClassInstance | null): ModelicaPredefinedClassInstance | null {
  if (!cls) return null;
  if (cls instanceof ModelicaPredefinedClassInstance) return cls;
  if (cls instanceof ModelicaShortClassInstance) return getUnderlyingPredefinedClass(cls.classInstance);
  // Recursively check extends clauses for user-defined short classes extending predefined types
  for (const el of cls.elements) {
    if (el instanceof ModelicaExtendsClassInstance && el.classInstance) {
      const base = getUnderlyingPredefinedClass(el.classInstance);
      if (base) return base;
    }
  }
  return null;
}

export class ModelicaFlattener extends ModelicaModelVisitor<[string, ModelicaDAE]> {
  options: ModelicaCompilerOptions;

  constructor(options?: ModelicaCompilerOptions) {
    super();
    this.options = options ?? {};
  }
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
  activePrefixes: Map<ModelicaClassInstance, string> = new Map<ModelicaClassInstance, string>();
  /**
   * Pre-pass: scan connect equations for references to expandable connector members
   * that don't exist yet, and create virtual components on the expandable connector.
   * Per §9.1.3, expandable connectors are dynamically augmented by connect equations.
   */
  #augmentExpandableConnectors(node: ModelicaClassInstance): void {
    for (const section of node.abstractSyntaxNode?.sections ?? []) {
      if (!(section instanceof ModelicaEquationSectionSyntaxNode)) continue;
      for (const eq of section.equations) {
        if (!(eq instanceof ModelicaConnectEquationSyntaxNode)) continue;
        const ref1 = eq.componentReference1;
        const ref2 = eq.componentReference2;
        if (!ref1 || !ref2) continue;

        // Try to augment each side if it references an expandable connector member
        this.#tryAugmentExpandableRef(ref1, ref2, node);
        this.#tryAugmentExpandableRef(ref2, ref1, node);
      }
    }
  }

  /**
   * If `ref` points to a member of an expandable connector that doesn't exist,
   * create a virtual component using the type from `otherRef`.
   */
  #tryAugmentExpandableRef(
    ref: ModelicaComponentReferenceSyntaxNode,
    otherRef: ModelicaComponentReferenceSyntaxNode,
    scope: ModelicaClassInstance,
  ): void {
    const parts = ref.parts;
    if (parts.length < 2) return;

    // Resolve the root component (e.g., "bus" in "bus.speed")
    const rootName = parts[0]?.identifier?.text;
    if (!rootName) return;
    const rootElement = scope.resolveSimpleName(rootName, false, true);
    if (!(rootElement instanceof ModelicaComponentInstance)) return;
    if (!rootElement.instantiated && !rootElement.instantiating) rootElement.instantiate();

    const rootClass = rootElement.classInstance;
    if (!rootClass?.isExpandable) return;

    // Check if the referenced member already exists
    const memberName = parts[1]?.identifier?.text;
    if (!memberName) return;
    const existing = rootClass.resolveSimpleName(memberName, false, true);
    if (existing) return;

    // Resolve the other side to determine the type
    const otherRootName = otherRef.parts[0]?.identifier?.text;
    if (!otherRootName) return;
    let otherComp: ModelicaComponentInstance | null = null;
    const otherRootElement = scope.resolveSimpleName(otherRootName, false, true);
    if (otherRootElement instanceof ModelicaComponentInstance) {
      otherComp = otherRootElement;
      // Walk multi-part references (e.g., source.y → resolve y within source's class)
      for (let i = 1; i < otherRef.parts.length; i++) {
        const partName = otherRef.parts[i]?.identifier?.text;
        if (!partName || !otherComp) break;
        if (!otherComp.instantiated && !otherComp.instantiating) otherComp.instantiate();
        let lookupClass: ModelicaClassInstance | null = otherComp.classInstance;
        if (lookupClass instanceof ModelicaArrayClassInstance) {
          lookupClass = lookupClass.elementClassInstance;
        }
        if (!lookupClass) {
          otherComp = null;
          break;
        }
        const inner = lookupClass.resolveSimpleName(partName, false, true);
        if (inner instanceof ModelicaComponentInstance) {
          otherComp = inner;
        } else {
          otherComp = null;
          break;
        }
      }
    }

    if (!otherComp) return;
    if (!otherComp.instantiated && !otherComp.instantiating) otherComp.instantiate();

    // Create a virtual component on the expandable connector
    const virtualComp = new ModelicaComponentInstance(rootClass, null);
    virtualComp.name = memberName;
    // Copy type from the other side
    if (otherComp.classInstance) {
      virtualComp.classInstance = otherComp.classInstance;
    }
    virtualComp.flowPrefix = otherComp.flowPrefix;
    virtualComp.causality = otherComp.causality;
    virtualComp.variability = otherComp.variability;
    rootClass.virtualComponents.set(memberName, virtualComp);
  }

  /**
   * Visits a class instance, flattening its components, equations, algorithm sections, and extended elements.
   *
   * @param node - The class instance to flatten.
   * @param args - A tuple of `[prefixString, activeDAE]` to pass context down.
   */
  visitClassInstance(node: ModelicaClassInstance, args: [string, ModelicaDAE]): void {
    // Check for Optimization modifiers (objective)
    if (node.classKind === ModelicaClassKind.OPTIMIZATION) {
      // For top-level optimization classes, the modifier (objective = cost, startTime = 0, ...)
      // lives on the LongClassSpecifier's classModification, not on node.modification.
      const classSpec = node.abstractSyntaxNode?.classSpecifier;
      const classMod = classSpec instanceof ModelicaLongClassSpecifierSyntaxNode ? classSpec.classModification : null;
      if (classMod) {
        for (const modArg of classMod.modificationArguments) {
          if (
            modArg instanceof ModelicaElementModificationSyntaxNode &&
            modArg.identifier?.text === "objective" &&
            modArg.modification?.modificationExpression?.expression
          ) {
            args[1].objective = modArg.modification.modificationExpression.expression.accept(
              new ModelicaSyntaxFlattener(this.options),
              {
                prefix: args[0],
                classInstance: node,
                dae: args[1],
                stmtCollector: [],
                activeClassStack: this.activeClassStack,
                activePrefixes: this.activePrefixes,
                structuralFinalParams: new Set<string>(),
              },
            ) as ModelicaExpression;
          }
        }
      }
      // Also try the instance-level modification (e.g. when the model is used as a component type)
      if (!args[1].objective && node.modification) {
        for (const modArg of node.modification.modificationArguments) {
          if (
            modArg instanceof ModelicaElementModification &&
            modArg.name === "objective" &&
            modArg.modificationExpression?.expression
          ) {
            args[1].objective = modArg.modificationExpression.expression.accept(
              new ModelicaSyntaxFlattener(this.options),
              {
                prefix: args[0],
                classInstance: node,
                dae: args[1],
                stmtCollector: [],
                activeClassStack: this.activeClassStack,
                activePrefixes: this.activePrefixes,
                structuralFinalParams: new Set<string>(),
              },
            ) as ModelicaExpression;
          }
        }
      }
    }

    // Pre-pass: augment expandable connectors with virtual components from connect equations
    this.#augmentExpandableConnectors(node);

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
    this.activePrefixes.set(node, args[0]);
    for (const element of node.elements) {
      if (element instanceof ModelicaComponentInstance) element.accept(this, args);
    }
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
        eq.accept(new ModelicaSyntaxFlattener(this.options), {
          prefix: args[0],
          classInstance: node,
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
          connectedFlowVars: this.#connectedFlowVars,
          activeClassStack: this.activeClassStack,
          activePrefixes: this.activePrefixes,
          flowConnectPairs: this.#flowConnectPairs,
          streamConnections: this.#streamConnectPairs,
        });
      }
      args[1].equations = savedEquations;
    }
    // Process algorithm sections in declaration order
    for (const section of localSections) {
      if (section instanceof ModelicaAlgorithmSectionSyntaxNode) {
        const collector: ModelicaStatement[] = [];
        for (const statement of section.statements) {
          statement.accept(new ModelicaSyntaxFlattener(this.options), {
            prefix: args[0],
            classInstance: node,
            dae: args[1],
            stmtCollector: collector,
            structuralFinalParams: this.#structuralFinalParams,
            activePrefixes: this.activePrefixes,
            activeClassStack: this.activeClassStack,
          });
        }
        if (section.initial) {
          if (collector.length > 0) {
            args[1].initialAlgorithms.push(collector);
          }
        } else {
          args[1].algorithms.push(collector);
        }
      }
    }
    // ── Generate connection-set-based flow balance equations ──
    // Build connection sets from the deferred flow connect pairs using Union-Find,
    // then generate one sum-to-zero equation per connection set.
    if (this.#flowConnectPairs.length > 0) {
      // Union-Find data structure for grouping flow variables into connection sets
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        let root = x;
        while (parent.get(root) !== root && parent.has(root)) {
          root = parent.get(root) ?? root;
        }
        // Path compression
        let cur = x;
        while (cur !== root) {
          const next = parent.get(cur) ?? cur;
          parent.set(cur, root);
          cur = next;
        }
        return root;
      };
      const union = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
      };

      // Initialize each flow variable as its own parent
      for (const pair of this.#flowConnectPairs) {
        if (!parent.has(pair.name1)) parent.set(pair.name1, pair.name1);
        if (!parent.has(pair.name2)) parent.set(pair.name2, pair.name2);
        union(pair.name1, pair.name2);
      }

      // Group flow variables by connection set
      const connectionSets = new Map<string, Set<string>>();
      for (const name of parent.keys()) {
        const root = find(name);
        let set = connectionSets.get(root);
        if (!set) {
          set = new Set<string>();
          connectionSets.set(root, set);
        }
        set.add(name);
      }

      // Generate one flow balance equation per connection set: sum(all_flows) = 0
      const dae = args[1];
      for (const [, flowVars] of connectionSets) {
        if (flowVars.size <= 1) continue; // Single-element sets don't need balance
        const names = [...flowVars];
        // Build: -(f1 + f2 + f3 + ...) = 0
        const firstName = names[0];
        if (!firstName) continue;
        let sum: ModelicaExpression = new ModelicaNameExpression(firstName);
        for (let i = 1; i < names.length; i++) {
          const n = names[i];
          if (!n) continue;
          sum = new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, sum, new ModelicaNameExpression(n));
        }
        const lhs = new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, sum);
        dae.equations.push(new ModelicaSimpleEquation(lhs, new ModelicaRealLiteral(0.0)));
      }

      // Clear pairs so they're not processed again in nested flattening
      this.#flowConnectPairs = [];
    }

    // ── Generate inStream equations from stream connections ──
    // For a 2-port connection connect(a, b) with stream variable s:
    //   inStream(a.s) = b.s  and  inStream(b.s) = a.s
    // For N-port connections (N > 2), the mixing equation is:
    //   inStream(a.s) = (Σ_{j≠a} max(-f_j, 0) * s_j) / (Σ_{j≠a} max(-f_j, 0))
    // We implement the simplified 2-port case here (most common in practice).
    if (this.#streamConnectPairs.length > 0) {
      const dae = args[1];
      for (const pair of this.#streamConnectPairs) {
        // inStream(side1) = side2
        const inStreamName1 = `$inStream(${pair.side1})`;
        dae.variables.push(new ModelicaRealVariable(inStreamName1, null, new Map(), null));
        dae.equations.push(
          new ModelicaSimpleEquation(new ModelicaNameExpression(inStreamName1), new ModelicaNameExpression(pair.side2)),
        );

        // inStream(side2) = side1
        const inStreamName2 = `$inStream(${pair.side2})`;
        dae.variables.push(new ModelicaRealVariable(inStreamName2, null, new Map(), null));
        dae.equations.push(
          new ModelicaSimpleEquation(new ModelicaNameExpression(inStreamName2), new ModelicaNameExpression(pair.side1)),
        );
      }
      this.#streamConnectPairs = [];
    }

    this.activePrefixes.delete(node);
    this.activeClassStack.pop();

    // Restore previous structural params
    this.#structuralFinalParams = savedStructural;

    if (this.activeClassStack.length === 0) {
      this.#assembleStateMachines(args[1]);
      this.#partitionClocks(args[1]);
      this.#extractEventIndicators(args[1]);

      // Extract experiment annotation (StartTime, StopTime, Tolerance, Interval)
      for (const ann of node.annotations) {
        if (ann.name === "experiment" && ann instanceof ModelicaClassInstance) {
          const getNum = (paramName: string): number | undefined => {
            const mod = ann.modification?.getModificationArgument(paramName);
            if (mod && "expression" in mod) {
              const expr = (mod as { expression?: ModelicaExpression | null }).expression;
              if (expr instanceof ModelicaRealLiteral) return expr.value;
              if (expr instanceof ModelicaIntegerLiteral) return expr.value;
            }
            return undefined;
          };
          const getBool = (paramName: string): boolean | undefined => {
            const mod = ann.modification?.getModificationArgument(paramName);
            if (mod && "expression" in mod) {
              const expr = (mod as { expression?: ModelicaExpression | null }).expression;
              if (expr instanceof ModelicaBooleanLiteral) return expr.value;
            }
            return undefined;
          };
          const exp = args[1].experiment;
          const startTime = getNum("StartTime");
          const stopTime = getNum("StopTime");
          const tolerance = getNum("Tolerance");
          const interval = getNum("Interval");
          const eqOut = getBool("__modelscript_equidistantOutput");
          if (startTime !== undefined) exp.startTime = startTime;
          if (stopTime !== undefined) exp.stopTime = stopTime;
          if (tolerance !== undefined) exp.tolerance = tolerance;
          if (interval !== undefined) exp.interval = interval;
          if (eqOut !== undefined) exp.__modelscript_equidistantOutput = eqOut;
        }
      }
    }
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
  // Deferred flow connection pairs for connection-set-based flow balance generation
  #flowConnectPairs: { name1: string; name2: string }[] = [];
  // Deferred stream connection pairs for inStream() equation generation
  #streamConnectPairs: { side1: string; side2: string }[] = [];
  // Track parameter names that are structurally significant (used in conditional component declarations)
  #structuralFinalParams = new Set<string>();
  // Carry outer brokenConnects through nested extends chains
  #outerBrokenConnects = new Set<string>();
  // Track current array element index for distributing array-valued modifiers
  // e.g., A a[2](n={1,2}) → a[1].n=1, a[2].n=2
  #arrayElementIndex: number | null = null;
  // Map from fully qualified component name to its generated subset of DAE variables and equations
  #componentContents = new Map<string, { variables: ModelicaVariable[]; equations: ModelicaEquation[] }>();

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
      const interp = new ModelicaInterpreter(true);
      const conditionValue = conditionExpr.accept(interp, node.parent ?? undefined);
      if (conditionValue instanceof ModelicaBooleanLiteral && !conditionValue.value) return;
    }

    const name = args[0] === "" ? (node.name ?? "?") : args[0] + "." + node.name;

    // Use the more restrictive variability between the outer context and this component's own
    const effectiveVariability = this.#outerVariability ?? node.variability;

    if (name.includes("V.f") || name.includes("V.phase")) {
      console.log(
        `Checking ${name}: classInstance=${node.classInstance?.constructor.name}, underlying=${getUnderlyingPredefinedClass(node.classInstance)?.constructor.name ?? "NULL"}`,
      );
    }

    if (getUnderlyingPredefinedClass(node.classInstance)) {
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

      const startVars = args[1].variables.length;
      const startEqs = args[1].equations.length;

      node.classInstance?.accept(this, [name, args[1]]);

      const endVars = args[1].variables.length;
      const endEqs = args[1].equations.length;
      this.#componentContents.set(name, {
        variables: args[1].variables.slice(startVars, endVars),
        equations: args[1].equations.slice(startEqs, endEqs),
      });

      this.#outerVariability = savedVar;
      this.#outerFinal = savedFinal;
      this.#outerProtected = savedProtected;
      this.#parentObjectExpression = savedParentObj;
    }
  }

  #getEvaluationScope(
    node: ModelicaComponentInstance,
    defaultPrefix: string,
  ): { prefix: string; classInstance: ModelicaClassInstance } {
    const defaultCtx = node.parent ?? ({} as ModelicaClassInstance);
    const modScope = node.modification?.scope;
    if (!modScope) return { prefix: defaultPrefix, classInstance: defaultCtx };

    const parts = defaultPrefix ? defaultPrefix.split(".") : [];

    // The activeClassStack contains the hierarchy of class instances being flattened.
    // Index 0 represents the root model (prefix "").
    // Index 1 represents the first nested component's class instance. Its prefix corresponds to the first part.
    // If defaultPrefix is "Vb.signalSource" (length 2), activeClassStack will typically have length 3:
    // [0] RLC (root, prefix="")
    // [1] SineVoltage (instantiated as Vb, prefix="Vb")
    // [2] Sine (instantiated as Vb.signalSource, prefix="Vb.signalSource")
    for (let i = this.activeClassStack.length - 1; i >= 0; i--) {
      const ancestorClass = this.activeClassStack[i];
      if (!ancestorClass) continue;

      let match = false;
      if (
        ancestorClass === modScope ||
        (ancestorClass as { originalClassInstance?: unknown }).originalClassInstance === modScope
      ) {
        match = true;
      } else if (ancestorClass instanceof ModelicaComponentInstance) {
        if (
          ancestorClass.classInstance === modScope ||
          (ancestorClass.classInstance as { originalClassInstance?: unknown })?.originalClassInstance === modScope
        ) {
          match = true;
        }
      }

      if (match) {
        // Find how many parts correspond to this index
        // Generally, the prefix has one fewer parts than the active class stack depth.
        // Wait: The prefix string accumulates component names.
        // Stack index 0 -> 0 parts -> ""
        // Stack index 1 -> 1 part  -> "Vb"
        // Stack index 2 -> 2 parts -> "Vb.signalSource"
        const prefix = i === 0 || parts.length === 0 ? "" : parts.slice(0, Math.min(i, parts.length)).join(".");
        return { prefix, classInstance: ancestorClass };
      }
    }

    return { prefix: defaultPrefix, classInstance: defaultCtx };
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
        const syntaxFlattener = new ModelicaSyntaxFlattener(this.options);
        const evalScope = this.#getEvaluationScope(node, args[0]);
        expression =
          node.modification.modificationExpression.expression.accept(syntaxFlattener, {
            prefix: evalScope.prefix,
            classInstance: evalScope.classInstance,
            dae: args[1],
            stmtCollector: [],
            structuralFinalParams: this.#structuralFinalParams,
            activeClassStack: this.activeClassStack,
            activePrefixes: this.activePrefixes,
          }) ?? null;
      }
      // Even if the constant was evaluated, collect any function definitions
      // referenced in the raw binding expression (e.g., constant Integer s = mySize({1,2,3}))
      const rawConstExpr = node.modification?.modificationExpression?.expression;
      if (rawConstExpr) {
        const syntaxFlattener = new ModelicaSyntaxFlattener(this.options);
        const evalScope = this.#getEvaluationScope(node, args[0]);
        syntaxFlattener.collectFunctionRefsFromAST(rawConstExpr, {
          prefix: evalScope.prefix,
          classInstance: evalScope.classInstance,
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
          activeClassStack: this.activeClassStack,
          activePrefixes: this.activePrefixes,
        });
      }
    } else if (variability === ModelicaVariability.PARAMETER) {
      // Parameters: prefer symbolic expression over evaluated literal.
      // Parameters can change between simulations so we want to keep references
      // like sqrt(a) instead of collapsing to 2.236...
      // First try the syntax flattener on the raw AST modification expression
      expression = null;
      if (node.modification?.modificationExpression?.expression) {
        const syntaxFlattener = new ModelicaSyntaxFlattener(this.options);
        const evalScope = this.#getEvaluationScope(node, args[0]);
        expression =
          node.modification.modificationExpression.expression.accept(syntaxFlattener, {
            prefix: evalScope.prefix,
            classInstance: evalScope.classInstance,
            dae: args[1],
            stmtCollector: [],
            structuralFinalParams: this.#structuralFinalParams,
            activeClassStack: this.activeClassStack,
            activePrefixes: this.activePrefixes,
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
      // Finally, if still no expression, use 'start' as the default for parameters
      if (!expression && variability === ModelicaVariability.PARAMETER) {
        expression = attributes.get("start") ?? null;
      }
    } else {
      // For non-constant, non-parameter: prefer symbolic reference from syntax flattener
      // (e.g., `r1.x` → ModelicaNameExpression("r1.x")) so constant folding can resolve it
      // from the DAE where record constructor values are properly applied.
      expression = null;
      if (node.modification?.modificationExpression?.expression) {
        const syntaxFlattener = new ModelicaSyntaxFlattener(this.options);
        expression =
          node.modification.modificationExpression.expression.accept(syntaxFlattener, {
            prefix: args[0],
            classInstance: node.parent ?? ({} as ModelicaClassInstance),
            dae: args[1],
            stmtCollector: [],
            structuralFinalParams: this.#structuralFinalParams,
            activeClassStack: this.activeClassStack,
            activePrefixes: this.activePrefixes,
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
    } else if (node.classInstance instanceof ModelicaClockClassInstance) {
      variable = new ModelicaClockVariable(
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
    } else if (node.classInstance instanceof ModelicaExpressionClassInstance) {
      variable = new ModelicaExpressionVariable(
        name,
        varExpression,
        attributes,
        variability,
        node.modification?.description ?? node.description,
        causality,
        isFinal,
        isProtected,
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
      // Extract CAD and CADPort annotations
      const formatCADAnnotation = (modName: string, modArg: { modificationArguments: unknown[] }): string => {
        const parts: string[] = [];
        for (const arg of modArg.modificationArguments) {
          if (arg instanceof ModelicaElementModification && arg.name) {
            const expr = arg.expression;
            if (expr instanceof ModelicaStringLiteral) parts.push(`${arg.name}="${expr.value}"`);
            else if (expr instanceof ModelicaRealLiteral || expr instanceof ModelicaIntegerLiteral)
              parts.push(`${arg.name}=${expr.value}`);
            else if (expr instanceof ModelicaBooleanLiteral) parts.push(`${arg.name}=${expr.value ? "true" : "false"}`);
            else if (expr instanceof ModelicaArray) {
              const vals = expr.elements
                .map((e) => (e instanceof ModelicaRealLiteral || e instanceof ModelicaIntegerLiteral ? e.value : 0))
                .join(", ");
              parts.push(`${arg.name}={${vals}}`);
            }
          }
        }
        return `${modName}(${parts.join(", ")})`;
      };

      if (node.annotations && Array.isArray(node.annotations)) {
        const cadAnnotation = node.annotations.find((a) => a.name === "CAD");
        if (cadAnnotation instanceof ModelicaClassInstance && cadAnnotation.modification) {
          variable.cadAnnotationString = formatCADAnnotation("CAD", cadAnnotation.modification);
        } else {
          const cadPortAnnotation = node.annotations.find((a) => a.name === "CADPort");
          if (cadPortAnnotation instanceof ModelicaClassInstance && cadPortAnnotation.modification) {
            variable.cadAnnotationString = formatCADAnnotation("CADPort", cadPortAnnotation.modification);
          }
        }
      }

      // Set flow/stream prefix for connector variables
      if (node.flowPrefix === ModelicaFlow.FLOW) variable.flowPrefix = "flow";
      else if (node.flowPrefix === ModelicaFlow.STREAM) variable.flowPrefix = "stream";
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
    // If the interpreter returned a ModelicaArray of ModelicaObjects (type structure, not values),
    // discard it so the syntax flattener can produce proper qualified name references.
    if (
      arrayBindingExpression instanceof ModelicaArray &&
      arrayBindingExpression.elements.length > 0 &&
      arrayBindingExpression.elements.every(
        (e) => e && typeof e === "object" && "elements" in e && (e as ModelicaObject).elements instanceof Map,
      )
    ) {
      arrayBindingExpression = null;
    }
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
    // array with 0-dimensions), try the syntax flattener which handles symbolic expressions.
    // Also, for non-parameter/non-constant arrays, run the syntax flattener and check if
    // its result contains symbolic name references (e.g., parameter `alpha`). If so,
    // prefer the syntax-flattened result to preserve those symbolic references in equations.
    const isCompileTimeEvaluableEarly =
      node.variability === ModelicaVariability.PARAMETER || node.variability === ModelicaVariability.CONSTANT;
    const hasMalformedBinding =
      arrayBindingExpression instanceof ModelicaArray && arrayBindingExpression.flatShape.includes(0);
    const rawASTExpr = node.modification?.modificationExpression?.expression;
    let usedSyntaxFlattener = false;
    if ((!arrayBindingExpression || hasMalformedBinding || !isCompileTimeEvaluableEarly) && rawASTExpr) {
      const savedBinding = arrayBindingExpression;
      if (hasMalformedBinding) arrayBindingExpression = null;
      const syntaxFlattener = new ModelicaSyntaxFlattener(this.options);
      const syntaxResult =
        rawASTExpr.accept(syntaxFlattener, {
          prefix: args[0],
          classInstance: node.parent ?? ({} as ModelicaClassInstance),
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
          activeClassStack: this.activeClassStack,
          activePrefixes: this.activePrefixes,
        }) ?? null;
      if (syntaxResult) {
        if (!isCompileTimeEvaluableEarly && savedBinding && !hasMalformedBinding) {
          // For non-compile-time arrays where the interpreter already produced a result,
          // only prefer the syntax result if it contains symbolic name references
          // (e.g., parameter `alpha`). Otherwise keep the interpreter result for proper
          // constant evaluation and type promotion (e.g., identity(N) → {{1.0, 0.0, ...}}).
          if (expressionHasNameRefs(syntaxResult, args[1])) {
            arrayBindingExpression = syntaxResult;
            usedSyntaxFlattener = true;
          }
        } else {
          // Interpreter failed → use syntax flattener as fallback
          arrayBindingExpression = syntaxResult;
          usedSyntaxFlattener = true;
        }
      }
    }
    // Collect function definitions from the raw binding expression even when the
    // interpreter already evaluated the binding (e.g., fun(5) → {1,1,1,1,1}).
    // Without this, the function definition wouldn't appear in the DAE output.
    if (arrayBindingExpression && node.modification?.modificationExpression?.expression) {
      const syntaxFlattener = new ModelicaSyntaxFlattener(this.options);
      syntaxFlattener.collectFunctionRefsFromAST(node.modification.modificationExpression.expression, {
        prefix: args[0],
        classInstance: node.parent ?? ({} as ModelicaClassInstance),
        dae: args[1],
        stmtCollector: [],
        structuralFinalParams: this.#structuralFinalParams,
        activeClassStack: this.activeClassStack,
        activePrefixes: this.activePrefixes,
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

    if (this.options.arrayMode === "preserve") {
      const elementClass = arrayClassInstance.elementClassInstance;
      const attributes = new Map<string, ModelicaExpression>();
      if (elementClass instanceof ModelicaRealClassInstance) {
        for (const key of ["start", "min", "max", "nominal"]) {
          if (elementClass.modification?.modificationArguments) {
            for (const m of elementClass.modification.modificationArguments) {
              if (m.name === key && m.expression) {
                const casted = castToReal(m.expression);
                if (casted) attributes.set(key, casted);
              }
            }
          }
        }
      }
      const varExpression = arrayBindingExpression;
      let variable;
      if (elementClass instanceof ModelicaBooleanClassInstance) {
        variable = new ModelicaBooleanVariable(
          name,
          varExpression,
          attributes,
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
          isProtected,
        );
      } else if (elementClass instanceof ModelicaIntegerClassInstance) {
        variable = new ModelicaIntegerVariable(
          name,
          varExpression,
          attributes,
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
          isProtected,
        );
      } else if (elementClass instanceof ModelicaRealClassInstance) {
        variable = new ModelicaRealVariable(
          name,
          varExpression,
          attributes,
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
          isProtected,
        );
      } else if (elementClass instanceof ModelicaStringClassInstance) {
        variable = new ModelicaStringVariable(
          name,
          varExpression,
          attributes,
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
          isProtected,
        );
      }

      if (variable) {
        variable.arrayDimensions = shape;
        if (!this.#emittedVarNames.has(variable.name)) {
          this.#emittedVarNames.add(variable.name);
          args[1].variables.push(variable);
        }
      }
      return;
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
      // Apply castToReal for interpreter-evaluated expressions (which may contain
      // Integer literals that need promotion in Real array context, e.g., {1, 2, 3.0}
      // → {1.0, 2.0, 3.0}). Skip for syntax-flattened expressions to preserve the
      // original literal types alongside symbolic parameter references.
      let rhs =
        isRealArray && !usedSyntaxFlattener
          ? (castToReal(arrayBindingExpression) ?? arrayBindingExpression)
          : arrayBindingExpression;

      // Expand name references (e.g., w.axisColor_x) to per-element subscripted arrays
      // (e.g., {w.axisColor_x[1], w.axisColor_x[2], w.axisColor_x[3]})
      if (rhs instanceof ModelicaNameExpression || rhs instanceof ModelicaVariable) {
        const totalElements = shape.reduce((a: number, b: number) => a * b, 1);
        if (totalElements > 0) {
          const elements: ModelicaExpression[] = [];
          for (let i = 1; i <= totalElements; i++) {
            elements.push(new ModelicaSubscriptedExpression(rhs, [new ModelicaIntegerLiteral(i)]));
          }
          rhs = new ModelicaArray([totalElements], elements);
        }
      }

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
          eq.accept(new ModelicaSyntaxFlattener(this.options), {
            prefix: args[0],
            classInstance: node.classInstance,
            dae: args[1],
            stmtCollector: [],
            structuralFinalParams: this.#structuralFinalParams,
            connectedFlowVars: this.#connectedFlowVars,
            activeClassStack: this.activeClassStack,
            activePrefixes: this.activePrefixes,
            flowConnectPairs: this.#flowConnectPairs,
            streamConnections: this.#streamConnectPairs,
            ...(brokenNames.size > 0 ? { brokenNames } : {}),
            ...(brokenConnects.size > 0 ? { brokenConnects } : {}),
          });
        }
        args[1].equations = savedEquations;
      } else if (section instanceof ModelicaAlgorithmSectionSyntaxNode) {
        const collector: ModelicaStatement[] = [];
        for (const statement of section.statements) {
          statement.accept(new ModelicaSyntaxFlattener(this.options), {
            prefix: args[0],
            classInstance: node.classInstance,
            dae: args[1],
            stmtCollector: collector,
            structuralFinalParams: this.#structuralFinalParams,
            activeClassStack: this.activeClassStack,
          });
        }
        if (section.initial) {
          if (collector.length > 0) {
            args[1].initialAlgorithms.push(collector);
          }
        } else {
          args[1].algorithms.push(collector);
        }
      }
    }
  }

  /**
   * Performs a topological-sort-like evaluation by repeatedly folding constant and parameter expressions
   * until no more simplifications can be made. This resolves forward references between constants.
   */
  generateFlowBalanceEquations(dae: ModelicaDAE) {
    // In Modelica, only UNCONNECTED flow variables get a boundary flow balance equation
    // f = 0.0. If they are connected, they participate in the sum-to-zero equation.
    for (const flowVar of this.#allFlowVars) {
      if (!this.#connectedFlowVars.has(flowVar)) {
        console.log(`Generating 0.0 for unconnected flow: ${flowVar}`);
        dae.equations.push(
          new ModelicaSimpleEquation(new ModelicaNameExpression(flowVar), new ModelicaRealLiteral(0.0)),
        );
      }
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
            // Handle name=array equations created by post-fold vectorization
            // (e.g., y = {hold(z[1]), hold(z[2])} → y[1] = hold(z[1]), y[2] = hold(z[2]))
            let expanded = false;
            if (newExpr1 instanceof ModelicaNameExpression && newExpr2 instanceof ModelicaArray) {
              const vars = dae.variables
                .filter((v) => v.name.startsWith(newExpr1.name + "["))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
              const flat2 = [...newExpr2.flatElements];
              if (vars.length === flat2.length && vars.length > 0) {
                for (let i = 0; i < vars.length; i++) {
                  const v = vars[i];
                  const rhs = flat2[i];
                  if (!v || !rhs) continue;
                  const lhs = new ModelicaNameExpression(v.name);
                  newEquations.push(new ModelicaSimpleEquation(lhs, rhs, equation.description));
                }
                expanded = true;
                changed = true;
              }
            } else if (newExpr2 instanceof ModelicaNameExpression && newExpr1 instanceof ModelicaArray) {
              const vars = dae.variables
                .filter((v) => v.name.startsWith(newExpr2.name + "["))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
              const flat1 = [...newExpr1.flatElements];
              if (vars.length === flat1.length && vars.length > 0) {
                for (let i = 0; i < vars.length; i++) {
                  const v = vars[i];
                  const lhs = flat1[i];
                  if (!v || !lhs) continue;
                  const rhs = new ModelicaNameExpression(v.name);
                  newEquations.push(new ModelicaSimpleEquation(lhs, rhs, equation.description));
                }
                expanded = true;
                changed = true;
              }
            }
            if (!expanded) {
              if (newExpr1 !== equation.expression1 || newExpr2 !== equation.expression2) {
                changed = true;
              }
              newEquations.push(new ModelicaSimpleEquation(newExpr1, newExpr2, equation.description));
            }
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
        const variable = dae.variables.get(expr.name);
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
            const variable = dae.variables.get(flatName);
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

        // Expand multi-dimensional slice subscripts: x[1:2, :] → {{x[1,1], x[1,2]}, {x[2,1], x[2,2]}}
        const isSlice = subscripts.some(
          (s) =>
            s instanceof ModelicaRangeExpression || s instanceof ModelicaColonExpression || s instanceof ModelicaArray,
        );
        if (base instanceof ModelicaNameExpression && isSlice) {
          // Resolve colons to 1:size(base, d)
          const resolvedSubscripts = subscripts.map((s, d) => {
            if (s instanceof ModelicaColonExpression) {
              const sizeExpr = new ModelicaFunctionCallExpression("size", [base, new ModelicaIntegerLiteral(d + 1)]);
              const sizeVal = this.#foldExpression(sizeExpr, dae, visited, inlineParameters);
              return new ModelicaRangeExpression(new ModelicaIntegerLiteral(1), sizeVal);
            }
            return s;
          });

          // Evaluate range/scalar subscripts to arrays of integers
          const axes: number[][] = [];
          for (const s of resolvedSubscripts) {
            if (s instanceof ModelicaRangeExpression) {
              const startVal = this.#foldExpression(s.start, dae, visited, inlineParameters);
              const endVal = this.#foldExpression(s.end, dae, visited, inlineParameters);
              if (startVal instanceof ModelicaIntegerLiteral && endVal instanceof ModelicaIntegerLiteral) {
                const step = s.step
                  ? ((this.#foldExpression(s.step, dae, visited, inlineParameters) as ModelicaIntegerLiteral)?.value ??
                    1)
                  : 1;
                const arr = [];
                for (let i = startVal.value; step > 0 ? i <= endVal.value : i >= endVal.value; i += step) {
                  arr.push(i);
                }
                axes.push(arr);
              } else {
                return new ModelicaSubscriptedExpression(base, subscripts); // fallback if variable size
              }
            } else if (s instanceof ModelicaArray) {
              const arr = [];
              for (const el of s.flatElements) {
                if (!el) return new ModelicaSubscriptedExpression(base, subscripts);
                const foldedEl = this.#foldExpression(el, dae, visited, inlineParameters);
                if (foldedEl instanceof ModelicaIntegerLiteral) {
                  arr.push(foldedEl.value);
                } else {
                  return new ModelicaSubscriptedExpression(base, subscripts); // fallback for symbolic subscripts
                }
              }
              axes.push(arr);
            } else {
              const foldedS = this.#foldExpression(s, dae, visited, inlineParameters);
              if (foldedS instanceof ModelicaIntegerLiteral) {
                axes.push([foldedS.value]);
              } else {
                return new ModelicaSubscriptedExpression(base, subscripts); // fallback for symbolic subscripts
              }
            }
          }

          // Build nested array from axes
          const buildNestedArray = (axisIndex: number, currentIndices: number[]): ModelicaExpression => {
            if (axisIndex >= axes.length) {
              const flatName = base.name + "[" + currentIndices.join(",") + "]";
              const variable = dae.variables.get(flatName);
              if (
                variable &&
                (variable.variability === ModelicaVariability.CONSTANT ||
                  (inlineParameters && variable.variability === ModelicaVariability.PARAMETER)) &&
                variable.expression
              ) {
                return this.#foldExpression(variable.expression, dae, visited, inlineParameters);
              }
              return new ModelicaSubscriptedExpression(
                base,
                currentIndices.map((i) => new ModelicaIntegerLiteral(i)),
              );
            }
            const axis = axes[axisIndex];
            if (!axis) return base; // fallback
            const elements = [];
            for (const val of axis) {
              currentIndices.push(val);
              elements.push(buildNestedArray(axisIndex + 1, currentIndices));
              currentIndices.pop();
            }
            // Modelica rule: scalar subscripts drop the dimension
            const originalSubscript = subscripts[axisIndex];
            if (
              !(
                originalSubscript instanceof ModelicaRangeExpression ||
                originalSubscript instanceof ModelicaColonExpression ||
                originalSubscript instanceof ModelicaArray
              )
            ) {
              return elements[0] ?? base;
            }
            return new ModelicaArray([elements.length], elements);
          };

          const expr = buildNestedArray(0, []);
          if (expr instanceof ModelicaArray || isSlice) return expr;
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
          if (dae.variables.has(flatName)) {
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

  /**
   * Post-processes the flattened DAE to identify and assemble Modelica 3.3 State Machines.
   * Scans for `transition` and `initialState` equations, identifies state components,
   * clusters them by scope into `stateMachine` structures, and moves their variables
   * and equations inside the clustered state containers.
   */
  #assembleStateMachines(dae: ModelicaDAE): void {
    const nodes = new Set<string>();
    const adjMap = new Map<string, string[]>();
    const initEqs = new Map<string, ModelicaInitialStateEquation>();

    const addEdge = (u: string, v: string) => {
      nodes.add(u);
      nodes.add(v);
      if (!adjMap.has(u)) adjMap.set(u, []);
      if (!adjMap.has(v)) adjMap.set(v, []);
      adjMap.get(u)?.push(v);
      adjMap.get(v)?.push(u);
    };

    // Graph Construction
    for (const eq of dae.equations) {
      if (eq instanceof ModelicaInitialStateEquation) {
        nodes.add(eq.stateName);
        initEqs.set(eq.stateName, eq);
      } else if (eq instanceof ModelicaTransitionEquation) {
        addEdge(eq.fromState, eq.toState);
      }
    }

    if (nodes.size === 0) return;

    // Connected Components
    const components: string[][] = [];
    const visited = new Set<string>();
    for (const startNode of nodes) {
      if (!visited.has(startNode)) {
        const comp: string[] = [];
        const q = [startNode];
        visited.add(startNode);
        while (q.length > 0) {
          const curr = q.shift();
          if (!curr) continue;
          comp.push(curr);
          const neighbors = adjMap.get(curr) || [];
          for (const n of neighbors) {
            if (!visited.has(n)) {
              visited.add(n);
              q.push(n);
            }
          }
        }
        components.push(comp);
      }
    }

    const allMachines = new Map<string, { sm: ModelicaStateMachine; parentPrefix: string; rank: number }>();

    // Pass 1: For each connected component, build its StateMachine
    for (const comp of components) {
      // Find the init equation to name the machine
      let smName = comp[0] || "stateMachine";
      for (const node of comp) {
        if (initEqs.has(node)) {
          smName = node;
          break;
        }
      }

      const parentParts = smName.split(".");
      parentParts.pop();
      const parentPrefix = parentParts.join(".");

      const stateMachine = new ModelicaStateMachine(smName);

      for (const fullName of comp) {
        const stateNode = new ModelicaState(fullName);

        // Grab contents generated for this state component
        const contents = this.#componentContents.get(fullName);
        if (contents) {
          // Move variables and equations to the state, intersecting with DAE to avoid duplicated nested captures
          const varSet = new Set(contents.variables);
          stateNode.variables = dae.variables.filter((v: ModelicaVariable) => varSet.has(v));
          dae.variables.bulkRemove(varSet);

          const eqSet = new Set(contents.equations);
          stateNode.equations = dae.equations.filter((e: ModelicaEquation) => eqSet.has(e));
          dae.equations = dae.equations.filter((e: ModelicaEquation) => !eqSet.has(e));
        }

        stateMachine.states.push(stateNode);
      }

      // Move transitional equations for this component from dae to stateMachine
      const compSet = new Set(comp);
      const smEquations: ModelicaEquation[] = [];
      dae.equations = dae.equations.filter((eq: ModelicaEquation) => {
        if (eq instanceof ModelicaInitialStateEquation && compSet.has(eq.stateName)) {
          smEquations.push(eq);
          return false;
        } else if (eq instanceof ModelicaTransitionEquation && compSet.has(eq.fromState)) {
          smEquations.push(eq);
          return false;
        }
        return true;
      });
      stateMachine.equations = smEquations;

      allMachines.set(smName, { sm: stateMachine, parentPrefix, rank: parentPrefix.split(".").length });
    }

    // Pass 2: Link the hierarchical state machines together (bottom up)
    const sortedMachines = Array.from(allMachines.values()).sort((a, b) => b.rank - a.rank);

    for (const { sm, parentPrefix } of sortedMachines) {
      if (!parentPrefix) {
        dae.stateMachines.push(sm);
      } else {
        let foundParent = false;
        for (const meta of allMachines.values()) {
          const parentState = meta.sm.states.find((s: ModelicaState) => s.name === parentPrefix);
          if (parentState) {
            parentState.stateMachines.push(sm);
            foundParent = true;
            break;
          }
        }
        if (!foundParent) {
          dae.stateMachines.push(sm); // Fallback if parent missing
        }
      }
    }
  }

  /**
   * Post-processes the flattened DAE to partition equations into clock domains.
   * Scans for `sample()` function calls in equations, assigns each a clock domain ID,
   * and groups related equations and variables into `ModelicaClockPartition` instances.
   *
   * Equations that do not reference any `sample()` / `hold()` / `previous()` remain
   * in the continuous-time domain (clockDomain = undefined).
   */
  #partitionClocks(dae: ModelicaDAE): void {
    let nextClockId = 0;
    // Map from sample() expression hash to clock domain ID
    const sampleClockMap = new Map<string, number>();

    // Pass 1: Scan all equations for sample() calls and assign clock IDs
    const clockOps = new Set(["sample", "hold", "previous", "subSample", "superSample", "shiftSample", "backSample"]);

    const findClockOps = (expr: ModelicaExpression): string | null => {
      if (expr instanceof ModelicaFunctionCallExpression && clockOps.has(expr.functionName)) {
        return expr.hash;
      }
      if (expr instanceof ModelicaFunctionCallExpression) {
        for (const arg of expr.args) {
          const found = findClockOps(arg);
          if (found) return found;
        }
      }
      if ("expression1" in expr && expr.expression1) {
        const found = findClockOps(expr.expression1 as ModelicaExpression);
        if (found) return found;
      }
      if ("expression2" in expr && expr.expression2) {
        const found = findClockOps(expr.expression2 as ModelicaExpression);
        if (found) return found;
      }
      if ("expression" in expr && expr.expression && expr.expression !== expr) {
        const found = findClockOps(expr.expression as ModelicaExpression);
        if (found) return found;
      }
      return null;
    };

    for (const eq of dae.equations) {
      if (eq instanceof ModelicaSimpleEquation) {
        const h1 = findClockOps(eq.expression1);
        const h2 = findClockOps(eq.expression2);
        const hash = h1 ?? h2;
        if (hash) {
          let clockId = sampleClockMap.get(hash);
          if (clockId === undefined) {
            clockId = nextClockId++;
            sampleClockMap.set(hash, clockId);
          }
          eq.clockDomain = clockId;
        }
      }
    }

    // Pass 2: Build clock partitions from tagged equations
    if (nextClockId === 0) return; // No clocked equations found

    const partitionMap = new Map<number, ModelicaClockPartition>();
    for (let i = 0; i < nextClockId; i++) {
      partitionMap.set(i, new ModelicaClockPartition(i));
    }

    // Pass 2.5: Base-Clock Inference (GCD/LCM)
    // Extract Clock(num, den) arguments from sample() calls and compute the global base clock
    const clockExprs = new Map<number, ModelicaFunctionCallExpression>();
    for (const eq of dae.equations) {
      if (eq.clockDomain !== undefined && eq instanceof ModelicaSimpleEquation) {
        if (!clockExprs.has(eq.clockDomain)) {
          const findSample = (expr: ModelicaExpression): ModelicaFunctionCallExpression | null => {
            if (expr instanceof ModelicaFunctionCallExpression && clockOps.has(expr.functionName)) return expr;
            if (expr instanceof ModelicaFunctionCallExpression) {
              for (const arg of expr.args) {
                const found = findSample(arg);
                if (found) return found;
              }
            }
            if ("expression1" in expr && expr.expression1) {
              const f = findSample(expr.expression1 as ModelicaExpression);
              if (f) return f;
            }
            if ("expression2" in expr && expr.expression2) {
              const f = findSample(expr.expression2 as ModelicaExpression);
              if (f) return f;
            }
            if ("expression" in expr && expr.expression && expr.expression !== expr) {
              const f = findSample(expr.expression as ModelicaExpression);
              if (f) return f;
            }
            return null;
          };
          const call = findSample(eq.expression1) ?? findSample(eq.expression2);
          if (call) clockExprs.set(eq.clockDomain, call);
        }
      }
    }

    // Helper math functions for base-clock inference
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);

    // Compute base clock: GCD(nums) / LCM(dens)
    let baseNum = 0;
    let baseDen = 1;
    let hasFractionalClocks = false;

    for (const call of clockExprs.values()) {
      // Look for Clock(num, den) in the arguments of sample/hold
      const clockArg = call.args.find((a) => a instanceof ModelicaFunctionCallExpression && a.functionName === "Clock");
      if (clockArg instanceof ModelicaFunctionCallExpression && clockArg.args.length === 2) {
        const numExpr = clockArg.args[0];
        const denExpr = clockArg.args[1];
        if (numExpr instanceof ModelicaIntegerLiteral && denExpr instanceof ModelicaIntegerLiteral) {
          const num = numExpr.value;
          const den = denExpr.value;
          if (hasFractionalClocks) {
            baseNum = gcd(baseNum, num);
            baseDen = lcm(baseDen, den);
          } else {
            baseNum = num;
            baseDen = den;
            hasFractionalClocks = true;
          }
        }
      }
    }

    const globalBaseClock = hasFractionalClocks
      ? new ModelicaFunctionCallExpression("Clock", [
          new ModelicaIntegerLiteral(baseNum),
          new ModelicaIntegerLiteral(baseDen),
        ])
      : null;

    for (const partition of partitionMap.values()) {
      partition.baseClock = globalBaseClock;
    }

    // Assign equations to partitions
    for (const eq of dae.equations) {
      if (eq.clockDomain !== undefined) {
        partitionMap.get(eq.clockDomain)?.equations.push(eq);
      }
    }

    // Tag variables referenced in clocked equations
    const clockedVarNames = new Set<string>();
    for (const eq of dae.equations) {
      if (eq.clockDomain === undefined) continue;
      if (eq instanceof ModelicaSimpleEquation) {
        if (eq.expression1 instanceof ModelicaNameExpression) clockedVarNames.add(eq.expression1.name);
        if (eq.expression2 instanceof ModelicaNameExpression) clockedVarNames.add(eq.expression2.name);
      }
    }

    for (const v of dae.variables) {
      if (clockedVarNames.has(v.name)) {
        // Find which clock domain this variable belongs to
        for (const eq of dae.equations) {
          if (eq.clockDomain === undefined) continue;
          if (eq instanceof ModelicaSimpleEquation) {
            if (
              (eq.expression1 instanceof ModelicaNameExpression && eq.expression1.name === v.name) ||
              (eq.expression2 instanceof ModelicaNameExpression && eq.expression2.name === v.name)
            ) {
              v.clockDomain = eq.clockDomain;
              partitionMap.get(eq.clockDomain)?.variables.push(v);
              break;
            }
          }
        }
      }
    }

    dae.clockPartitions = [...partitionMap.values()].filter((p) => p.equations.length > 0);
  }

  /**
   * Scans the fully assembled DAE for relational operators and `when` clauses.
   * Extracts zero-crossing expressions into DAE `eventIndicators` and discrete
   * updates into `whenClauses`.
   */
  #extractEventIndicators(dae: ModelicaDAE): void {
    const indicators = new Set<string>();

    const extractExpr = (expr: ModelicaExpression) => {
      if (expr instanceof ModelicaBinaryExpression) {
        if (
          expr.operator === ModelicaBinaryOperator.LESS_THAN ||
          expr.operator === ModelicaBinaryOperator.LESS_THAN_OR_EQUAL ||
          expr.operator === ModelicaBinaryOperator.GREATER_THAN ||
          expr.operator === ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL ||
          expr.operator === ModelicaBinaryOperator.EQUALITY ||
          expr.operator === ModelicaBinaryOperator.INEQUALITY
        ) {
          // Add `expr.operand1 - expr.operand2` as an event indicator
          const diff = new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, expr.operand1, expr.operand2);
          const hash = diff.hash;
          if (!indicators.has(hash)) {
            indicators.add(hash);
            dae.eventIndicators.push(diff);
          }
        }
        extractExpr(expr.operand1);
        extractExpr(expr.operand2);
      } else if (expr instanceof ModelicaUnaryExpression) {
        extractExpr(expr.operand);
      } else if (expr instanceof ModelicaFunctionCallExpression) {
        for (const arg of expr.args) extractExpr(arg);
      } else if (expr instanceof ModelicaIfElseExpression) {
        extractExpr(expr.condition);
        extractExpr(expr.thenExpression);
        for (const clause of expr.elseIfClauses) {
          extractExpr(clause.condition);
          extractExpr(clause.expression);
        }
        extractExpr(expr.elseExpression);
      } else if (expr instanceof ModelicaArray) {
        for (const el of expr.elements) extractExpr(el);
      }
    };

    const extractEq = (eq: ModelicaEquation) => {
      if (eq instanceof ModelicaSimpleEquation) {
        extractExpr(eq.expression1);
        extractExpr(eq.expression2);
      } else if (eq instanceof ModelicaIfEquation) {
        extractExpr(eq.condition);
        for (const e of eq.equations) extractEq(e);
        for (const elseIf of eq.elseIfClauses) {
          extractExpr(elseIf.condition);
          for (const e of elseIf.equations) extractEq(e);
        }
        for (const e of eq.elseEquations) extractEq(e);
      } else if (eq instanceof ModelicaWhenEquation) {
        dae.whenClauses.push(eq);
        extractExpr(eq.condition);
        for (const e of eq.equations) extractEq(e);
        for (const elseWhen of eq.elseWhenClauses) {
          extractExpr(elseWhen.condition);
          for (const e of elseWhen.equations) extractEq(e);
        }
      } else if (eq instanceof ModelicaForEquation) {
        for (const e of eq.equations) extractEq(e);
      }
    };

    for (const eq of dae.equations) extractEq(eq);
    for (const eq of dae.initialEquations) extractEq(eq);

    // Remove when equations from continuous equations lists so they don't corrupt BLT
    dae.equations = dae.equations.filter((eq) => !(eq instanceof ModelicaWhenEquation));
    dae.initialEquations = dae.initialEquations.filter((eq) => !(eq instanceof ModelicaWhenEquation));
  }
}

/**
 * Internal visitor class specifically to flatten Modelica AST syntax models
 * (equations, expressions, algorithms) during the DAE translation process.
 */
class ModelicaSyntaxFlattener extends ModelicaSyntaxVisitor<ModelicaExpression, FlattenerContext> {
  constructor(public options?: ModelicaCompilerOptions) {
    super();
  }
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
    if (!operator || !operand1 || !operand2) return null;

    // Check for operator record dispatch: if either operand is an operator record type,
    // rewrite `a op b` as `RecordType.'op'.funcName(a, b)` or `RecordType.'op'(a, b)`.
    const opStr = "'" + operator + "'";
    const operatorInfo =
      this.#resolveOperatorRecordFunction(operand1, opStr, ctx) ??
      this.#resolveOperatorRecordFunction(operand2, opStr, ctx);
    if (operatorInfo) {
      const { qualifiedName, resolvedClass } = operatorInfo;
      this.#collectFunctionDefinition(qualifiedName, ctx, resolvedClass);
      return new ModelicaFunctionCallExpression(qualifiedName, [operand1, operand2]);
    }

    return canonicalizeBinaryExpression(operator, operand1, operand2, ctx.dae);
  }

  /**
   * Resolve the operator function for a binary expression operand.
   * Given an operand expression, determines if its type is an `operator record`,
   * and if so, looks up the operator (e.g., `'*'`) among the record's elements.
   *
   * Handles two syntactic forms:
   * - `operator '*'` containing `function mul` → qualified name: `Complex.'*'.mul`
   * - `operator function '+'` (shorthand) → qualified name: `Rec.'+'`
   *
   * @returns The qualified function name and resolved class, or null.
   */
  #resolveOperatorRecordFunction(
    operand: ModelicaExpression,
    operatorName: string,
    ctx: FlattenerContext,
  ): { qualifiedName: string; resolvedClass: ModelicaClassInstance } | null {
    // Operand must be a named reference we can resolve to a component
    if (!(operand instanceof ModelicaNameExpression)) return null;
    const componentNames = operand.name.split(".");
    const resolved = ctx.classInstance.resolveName(componentNames);
    if (!(resolved instanceof ModelicaComponentInstance)) return null;
    resolved.instantiate();

    // The component's declared type must be an operator record
    const declaredType = resolved.declaredType;
    if (!declaredType || declaredType.classKind !== ModelicaClassKind.OPERATOR_RECORD) return null;
    declaredType.instantiate();

    const typeName = declaredType.name ?? "";

    // Search for the operator element within the record type
    for (const el of declaredType.elements) {
      if (!(el instanceof ModelicaClassInstance)) continue;

      // Case 1: `operator function '+'` shorthand — the operator IS the function
      if (el.classKind === ModelicaClassKind.OPERATOR_FUNCTION && el.name === operatorName) {
        const qualifiedName = `${typeName}.${operatorName}`;
        return { qualifiedName, resolvedClass: el };
      }

      // Case 2: `operator '*'` containing nested `function mul`
      if (el.classKind === ModelicaClassKind.OPERATOR && el.name === operatorName) {
        el.instantiate();
        // Find the first function inside the operator
        for (const fn of el.elements) {
          if (fn instanceof ModelicaClassInstance && fn.classKind === ModelicaClassKind.FUNCTION && fn.name) {
            const qualifiedName = `${typeName}.${operatorName}.${fn.name}`;
            return { qualifiedName, resolvedClass: fn };
          }
        }
      }
    }
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

    // Monomorphization: Resolve bound function parameters dynamically
    let boundArgsMap: Map<string, ModelicaExpression> | null = null;
    if (ctx.functionBindings?.has(functionName)) {
      const boundItem = ctx.functionBindings.get(functionName);
      if (typeof boundItem === "string") {
        functionName = boundItem;
      } else if (boundItem instanceof ModelicaPartialFunctionExpression) {
        functionName = boundItem.functionName;
        boundArgsMap = new Map();
        for (const namedArg of boundItem.namedArgs) {
          boundArgsMap.set(namedArg.name, namedArg.value);
        }
      }
    }

    let flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      let flatArg: ModelicaExpression | null;
      if (arg.functionPartialApplication) {
        flatArg = this.visitFunctionPartialApplication(arg.functionPartialApplication, ctx);
      } else {
        flatArg = arg.expression?.accept(this, ctx) ?? null;
      }
      if (flatArg) flatArgs.push(flatArg);
    }

    // Merge bound arguments into the flattened arguments array
    if (boundArgsMap && boundArgsMap.size > 0) {
      // Resolve the target function to correctly align named bound arguments with positions
      const resolved = ctx.classInstance.resolveName(functionName.split("."));
      if (
        resolved instanceof ModelicaClassInstance &&
        (resolved.classKind === ModelicaClassKind.FUNCTION ||
          resolved.classKind === ModelicaClassKind.OPERATOR_FUNCTION)
      ) {
        if (!resolved.instantiated) resolved.instantiate();
        const inputs = Array.from(resolved.components).filter((c) => c.causality?.toString() === "input");

        const mergedArgs: ModelicaExpression[] = [];
        let positionalIndex = 0;
        for (const input of inputs) {
          const inputName = input.name ?? "";
          const boundValue = boundArgsMap.get(inputName);
          if (boundValue) {
            mergedArgs.push(boundValue);
          } else if (positionalIndex < flatArgs.length) {
            mergedArgs.push(flatArgs[positionalIndex] as ModelicaExpression);
            positionalIndex++;
          }
        }
        // Append any remaining arguments
        while (positionalIndex < flatArgs.length) {
          mergedArgs.push(flatArgs[positionalIndex] as ModelicaExpression);
          positionalIndex++;
        }
        flatArgs = mergedArgs;
      }
    }

    // Handle record constructor calls: Complex(re=2.0, im=3.0) or Rec(r = 1.0)
    // Record constructors use the record type name as the function name and may have named arguments.
    {
      const resolved = ctx.classInstance.resolveName(functionName.split("."));
      if (
        resolved instanceof ModelicaClassInstance &&
        (resolved.classKind === ModelicaClassKind.OPERATOR_RECORD || resolved.classKind === ModelicaClassKind.RECORD)
      ) {
        const qualifiedName = this.#resolveFullyQualifiedName(functionName, ctx);
        // Collect named arguments and convert to positional order matching record components
        const namedArgsMap = new Map<string, ModelicaExpression>();
        for (const namedArg of node.functionCallArguments?.namedArguments ?? []) {
          const argName = namedArg.identifier?.text ?? "";
          const argValue = namedArg.argument?.expression?.accept(this, ctx) ?? null;
          if (argName && argValue) {
            namedArgsMap.set(argName, argValue);
          }
        }

        // Build positional args: named args mapped to component declaration order
        resolved.instantiate();
        const components = [...resolved.components].filter((c) => {
          if (!c.name || c.isProtected) return false;
          if (c.classInstance instanceof ModelicaClassInstance) {
            const kind = c.classInstance.classKind;
            if (kind === ModelicaClassKind.FUNCTION || kind === ModelicaClassKind.OPERATOR_FUNCTION) {
              return false;
            }
          }
          return true;
        });
        const orderedArgs: ModelicaExpression[] = [];
        let positionalIdx = 0;
        for (const comp of components) {
          const compName = comp.name ?? "";
          if (namedArgsMap.has(compName)) {
            orderedArgs.push(namedArgsMap.get(compName) ?? new ModelicaIntegerLiteral(0));
          } else if (positionalIdx < flatArgs.length) {
            const positionalArg = flatArgs[positionalIdx];
            if (positionalArg) orderedArgs.push(positionalArg);
            positionalIdx++;
          }
        }
        // If there were only positional args (no named), use them directly
        if (namedArgsMap.size === 0 && flatArgs.length > 0) {
          // positional args already collected
        } else if (orderedArgs.length > 0) {
          flatArgs = orderedArgs;
        }

        // Collect the auto-generated record constructor function
        this.#collectRecordConstructor(qualifiedName, resolved, ctx);
        return new ModelicaFunctionCallExpression(qualifiedName, flatArgs);
      }
    }

    // Operator record dispatch for String(x): when the argument is an operator record,
    // rewrite String(x) as RecordType.'String'(x) using the operator function.
    if (functionName === "String" && flatArgs.length >= 1) {
      const arg0 = flatArgs[0];
      if (arg0) {
        const stringOp = this.#resolveOperatorRecordFunction(arg0, "'String'", ctx);
        if (stringOp) {
          const { qualifiedName, resolvedClass } = stringOp;
          this.#collectFunctionDefinition(qualifiedName, ctx, resolvedClass);
          return new ModelicaFunctionCallExpression(qualifiedName, flatArgs);
        }
      }
    }

    // Operator record dispatch for '0' (zero literal): when zeros() is called with
    // an operator record type argument, rewrite to RecordType.'0'() zero constructor.
    if (functionName === "zeros" && flatArgs.length >= 1) {
      const arg0 = flatArgs[0];
      if (arg0) {
        const zeroOp = this.#resolveOperatorRecordFunction(arg0, "'0'", ctx);
        if (zeroOp) {
          const { qualifiedName, resolvedClass } = zeroOp;
          this.#collectFunctionDefinition(qualifiedName, ctx, resolvedClass);
          return new ModelicaFunctionCallExpression(qualifiedName, []);
        }
      }
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
              const interp = new ModelicaInterpreter(true);
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
        const isArrayVar = !!ctx.dae.variables.getEncoded(arg.name) || ctx.dae.variables.hasArrayElements(arg.name);
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
          if (arg instanceof ModelicaNameExpression) {
            const foundVar = ctx.dae.variables.get(arg.name);
            return !!foundVar && foundVar instanceof ModelicaIntegerVariable;
          }
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
      // Skip arg coercion for Clock constructor and polymorphic synchronous operators.
      // Clock is polymorphic (§16.3), and sync ops like hold/previous preserve arg types.
      if (functionName !== "Clock" && !POLYMORPHIC_SYNC_OPS.has(functionName)) {
        for (let i = 0; i < flatArgs.length && i < effectiveInputs.length; i++) {
          if (effectiveInputs[i]?.type === "Real") {
            const coerced = castToReal(flatArgs[i] ?? null);
            if (coerced && coerced !== flatArgs[i]) flatArgs[i] = coerced;
          }
        }
      }
    }
    // Clock constructor is polymorphic (§16.3): Clock(), Clock(Integer, Integer),
    // Clock(Real), Clock(Boolean, Real), Clock(Clock, String).
    // Do NOT coerce its args; pass through as-is.
    // Also add default Clock() for synchronous sample(u) → sample(u, Clock())
    if (functionName === "sample" && flatArgs.length === 1) {
      // If the single arg is Real-typed, this is a synchronous sample (not the Boolean sample(start,interval))
      if (flatArgs[0] && isRealTyped(flatArgs[0], ctx.dae)) {
        flatArgs.push(new ModelicaFunctionCallExpression("Clock", []));
      }
    }
    // Clock constructor default arguments (§16.3):
    // Clock(intervalCounter) → Clock(intervalCounter, 1) — rational clock, default resolution=1
    // Clock(condition) → Clock(condition, 0.0) — event clock, default startInterval=0.0
    if (functionName === "Clock" && flatArgs.length === 1 && flatArgs[0]) {
      if (isIntegerTyped(flatArgs[0], ctx.dae)) {
        // Rational clock: Clock(intervalCounter) → Clock(intervalCounter, 1)
        flatArgs.push(new ModelicaIntegerLiteral(1));
      } else if (isBooleanTyped(flatArgs[0], ctx.dae)) {
        // Event clock: Clock(condition) → Clock(condition, 0.0)
        flatArgs.push(new ModelicaRealLiteral(0.0));
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
    // Specialized Higher-Order Function Execution (Monomorphization)
    let finalFunctionName = isExternalBuiltinAlias ? functionName : originalName;
    let finalArgs = flatArgs;

    if (!builtinDef) {
      const fDef =
        ctx.dae.functions.find((f) => f.name === functionName) ||
        ctx.rootDae?.functions.find((f) => f.name === functionName);
      if (fDef) {
        const inputVars = fDef.variables.filter((v) => v.causality === "input");
        let hasHigherOrderArg = false;
        const newBindings = new Map<string, ModelicaPartialFunctionExpression | string>();
        const filteredArgs: ModelicaExpression[] = [];

        for (let i = 0; i < flatArgs.length && i < inputVars.length; i++) {
          const inVar = inputVars[i];
          const argVal = flatArgs[i];
          if (inVar?.functionType) {
            hasHigherOrderArg = true;
            if (argVal instanceof ModelicaPartialFunctionExpression) {
              newBindings.set(inVar.name, argVal);
            } else if (argVal instanceof ModelicaNameExpression) {
              newBindings.set(inVar.name, argVal.name);
            }
          } else if (argVal) {
            filteredArgs.push(argVal);
          }
        }

        // Push any remaining defaults that were expanded
        for (let i = inputVars.length; i < flatArgs.length; i++) {
          const argVal = flatArgs[i];
          if (argVal) filteredArgs.push(argVal);
        }

        if (hasHigherOrderArg) {
          // Generate deterministic specialized name based on bound function names
          const hashPairs = Array.from(newBindings.entries()).map(([k, v]) => {
            const vName = v instanceof ModelicaPartialFunctionExpression ? v.functionName : v;
            return `${k}_${vName.replace(/\\./g, "_")}`;
          });
          const specializedName = `${functionName}$${hashPairs.join("$")}`;

          // Resolve the base function class instance to use as an override
          let baseResolved: ModelicaClassInstance | undefined = resolvedOverride;
          if (!baseResolved && ctx.classInstance) {
            const parts = originalName.split(".");
            const r = ctx.classInstance.resolveName(parts);
            if (r instanceof ModelicaClassInstance) baseResolved = r;
          }

          if (baseResolved) {
            const baseBindings = ctx.functionBindings ? Array.from(ctx.functionBindings.entries()) : [];
            const specializedCtx: FlattenerContext = {
              ...ctx,
              functionBindings: new Map([...baseBindings, ...Array.from(newBindings.entries())]),
            };
            this.#collectFunctionDefinition(specializedName, specializedCtx, baseResolved, componentPrefix);

            finalFunctionName = specializedName;
            finalArgs = filteredArgs;
          }
        }
      }
    }

    const result = new ModelicaFunctionCallExpression(finalFunctionName, finalArgs);

    // Only inline user-defined function calls when ALL arguments are compile-time constants.
    // Parameters are NOT constants — they can change between simulations.
    // Check for: literals, literal arrays, or constant variable references with known values.
    const isConstantEvaluable = (expr: ModelicaExpression): boolean => {
      if (isLiteral(expr) || isLiteralArray(expr)) return true;
      if (expr instanceof ModelicaNameExpression) {
        const variable = ctx.dae.variables.get(expr.name);
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
    if (!(resolved instanceof ModelicaClassInstance || resolved instanceof ModelicaComponentInstance))
      return functionName;

    // Build FQ name by walking the parent chain
    const nameSegments: string[] = [];
    let current: ModelicaNamedElement | null = resolved;
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

  /**
   * Collect an auto-generated record constructor function for a record/operator record type.
   * Generates a function with input parameters matching the record's components and
   * a single output parameter of the record type.
   * E.g., `function Complex "Automatically generated record constructor for Complex"`
   */
  #collectRecordConstructor(recordName: string, recordClass: ModelicaClassInstance, ctx: FlattenerContext): void {
    const targetDae = ctx.rootDae ?? ctx.dae;
    if (ModelicaSyntaxFlattener.#hasFunctionInDAE(targetDae, recordName)) return;
    if (ModelicaSyntaxFlattener.#collectingFunctions.has(recordName)) return;
    ModelicaSyntaxFlattener.#collectingFunctions.add(recordName);

    const fnDae = new ModelicaDAE(recordName);
    fnDae.classKind = "function";
    fnDae.description = `Automatically generated record constructor for ${recordName}`;

    recordClass.instantiate();
    // Add input parameters for each record component (only non-operator elements)
    for (const comp of recordClass.components) {
      if (!comp.name) continue;
      comp.instantiate();
      // Skip operator classes (they are not constructor parameters)
      if (
        comp.classInstance instanceof ModelicaClassInstance &&
        (comp.classInstance.classKind === ModelicaClassKind.OPERATOR ||
          comp.classInstance.classKind === ModelicaClassKind.OPERATOR_FUNCTION)
      )
        continue;

      const typeInstance =
        comp.classInstance instanceof ModelicaArrayClassInstance
          ? comp.classInstance.elementClassInstance
          : comp.classInstance;

      let variable: ModelicaVariable;
      if (typeInstance instanceof ModelicaIntegerClassInstance) {
        variable = new ModelicaIntegerVariable(comp.name, null, new Map(), null, null, "input");
      } else if (typeInstance instanceof ModelicaBooleanClassInstance) {
        variable = new ModelicaBooleanVariable(comp.name, null, new Map(), null, null, "input");
      } else if (typeInstance instanceof ModelicaStringClassInstance) {
        variable = new ModelicaStringVariable(comp.name, null, new Map(), null, null, "input");
      } else {
        variable = new ModelicaRealVariable(comp.name, null, new Map(), null, null, "input");
      }
      fnDae.variables.push(variable);
    }

    // Add output parameter of the record type
    const outputVar = new ModelicaRealVariable("res", null, new Map(), null, null, "output");
    outputVar.customTypeName = recordName;
    fnDae.variables.push(outputVar);

    targetDae.functions.unshift(fnDae);
    ModelicaSyntaxFlattener.#collectingFunctions.delete(recordName);
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
              const syntaxFlattener = new ModelicaSyntaxFlattener(this.options);
              const flatExpr = sub.expression.accept(syntaxFlattener, {
                prefix: "",
                classInstance: resolved,
                dae: fnDae,
                stmtCollector: [],
                activeClassStack: ctx.activeClassStack,
                activePrefixes: ctx.activePrefixes,
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
        const syntaxFlattener = new ModelicaSyntaxFlattener(this.options);
        expression =
          element.modification.modificationExpression.expression.accept(syntaxFlattener, {
            prefix: "",
            classInstance: resolved,
            dae: fnDae,
            stmtCollector: [],
            loopVariables: enclosingConstants,
            activeClassStack: ctx.activeClassStack,
            activePrefixes: ctx.activePrefixes,
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

        // For record-typed parameters (operator record, record), set custom type name
        // so the DAE prints e.g. "input Complex c1" instead of "input Real c1"
        if (
          typeInstance instanceof ModelicaClassInstance &&
          (typeInstance.classKind === ModelicaClassKind.OPERATOR_RECORD ||
            typeInstance.classKind === ModelicaClassKind.RECORD)
        ) {
          variable.customTypeName = typeInstance.name ?? null;
        }
      }

      if (ctx.functionBindings?.has(compName)) {
        // Skip emitting this variable as an argument! It is statically bound.
        continue;
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
    if (
      resolved.parent &&
      "jsSource" in resolved.parent &&
      typeof (resolved.parent as { jsSource?: unknown }).jsSource === "string"
    ) {
      fnDae.jsSource = (resolved.parent as { jsSource: string }).jsSource;
      const jsP = (resolved.parent as { jsPath?: string }).jsPath;
      if (typeof jsP === "string") fnDae.jsPath = jsP;
    }
    targetDae.functions.push(fnDae);

    // Flatten algorithm and equation sections (these still use the standard path)

    for (const equationSection of resolved.equationSections) {
      for (const eq of equationSection.equations) {
        eq.accept(new ModelicaSyntaxFlattener(this.options), {
          prefix: "",
          classInstance: resolved,
          dae: fnDae,
          stmtCollector: [],
          rootDae: targetDae,
          activeClassStack: ctx.activeClassStack,
          activePrefixes: ctx.activePrefixes,
          ...(componentPrefix ? { componentFunctionPrefix: componentPrefix } : {}),
          ...(ctx.functionBindings ? { functionBindings: ctx.functionBindings } : {}),
        });
      }
    }
    for (const algorithmSection of resolved.algorithmSections) {
      const collector: ModelicaStatement[] = [];
      for (const statement of algorithmSection.statements) {
        statement.accept(new ModelicaSyntaxFlattener(this.options), {
          prefix: "",
          classInstance: resolved,
          dae: fnDae,
          stmtCollector: collector,
          rootDae: targetDae,
          activeClassStack: ctx.activeClassStack,
          activePrefixes: ctx.activePrefixes,
          ...(componentPrefix ? { componentFunctionPrefix: componentPrefix } : {}),
          ...(ctx.functionBindings ? { functionBindings: ctx.functionBindings } : {}),
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

        if (ext.annotationClause?.classModification?.modificationArguments) {
          for (const arg of ext.annotationClause.classModification.modificationArguments) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const modArg = arg as any;
            if (modArg.name?.text && modArg.modification?.expression) {
              const nameText = modArg.name.text;
              if (nameText === "Include" || nameText === "Library") {
                const exprCsn = modArg.modification.expression.concreteSyntaxNode;
                if (exprCsn) {
                  // Recursively extract all STRING tokens from the AST subtree
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const extractStrings = (node: any): string[] => {
                    const result: string[] = [];
                    if (node.type === "STRING" && node.text) {
                      const text = node.text.substring(1, node.text.length - 1);
                      result.push(text.replace(/""/g, '"').replace(/\\"/g, '"'));
                    }
                    for (let i = 0; i < node.childCount; i++) {
                      const child = node.child(i);
                      if (child) result.push(...extractStrings(child));
                    }
                    return result;
                  };
                  const values = extractStrings(exprCsn);
                  if (nameText === "Include") fnDae.externalIncludes.push(...values);
                  else fnDae.externalLibraries.push(...values);
                }
              }
            }
          }
        }
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
    const rawName = node.parts.map((c) => c.identifier?.text ?? "<ERROR>").join(".");
    // Built-in variables like 'time' should never be prefixed
    const isBuiltinVar = rawName === "time";

    let name: string;
    if (!isBuiltinVar && !node.global && ctx.classInstance) {
      // Resolve the full identifier to determine if it belongs to the instance hierarchy or is global
      const resolved = ctx.classInstance.resolveName(node.parts.map((p) => p.identifier?.text ?? ""));
      const firstPartName = node.parts[0]?.identifier?.text ?? "";
      const firstPartResolved = ctx.classInstance.resolveName([firstPartName]);

      if (
        firstPartResolved instanceof ModelicaComponentInstance ||
        firstPartResolved instanceof ModelicaClassInstance
      ) {
        // Find if any class in the active stack "owns" the BASE of this element
        let ownerPrefix: string | undefined;

        if (ctx.activeClassStack && ctx.activePrefixes) {
          for (let i = ctx.activeClassStack.length - 1; i >= 0; i--) {
            const stackClass = ctx.activeClassStack[i];
            if (!stackClass) continue;

            // Resolve the base identifier against this class in the stack
            const localResolved = stackClass.resolveName([firstPartName]);
            if (localResolved) {
              let isOwned = false;

              // We compare abstractSyntaxNodes to handle cloned instances sharing the same declaration.
              const localAST =
                "abstractSyntaxNode" in localResolved
                  ? (localResolved as { abstractSyntaxNode?: unknown }).abstractSyntaxNode
                  : undefined;
              const resolvedAST =
                firstPartResolved && "abstractSyntaxNode" in firstPartResolved
                  ? (firstPartResolved as { abstractSyntaxNode?: unknown }).abstractSyntaxNode
                  : undefined;

              if (localResolved === firstPartResolved || (localAST && resolvedAST && localAST === resolvedAST)) {
                // verify that stackClass (or its base classes) is the lexical parent of the resolved element.
                const ownerClass = localResolved.parent;
                if (localResolved === stackClass) {
                  isOwned = true;
                } else {
                  const queue: ModelicaClassInstance[] = [stackClass];
                  const visited = new Set<ModelicaClassInstance>();

                  while (queue.length > 0) {
                    const cls = queue.shift();
                    if (!cls || visited.has(cls)) continue;
                    visited.add(cls);

                    const clsAST =
                      "abstractSyntaxNode" in cls
                        ? (cls as { abstractSyntaxNode?: unknown }).abstractSyntaxNode
                        : undefined;
                    const ownerAST =
                      ownerClass && "abstractSyntaxNode" in ownerClass
                        ? (ownerClass as { abstractSyntaxNode?: unknown }).abstractSyntaxNode
                        : undefined;

                    if (cls === ownerClass || cls === localResolved || (clsAST && ownerAST && clsAST === ownerAST)) {
                      isOwned = true;
                      break;
                    }

                    for (const ext of cls.extendsClassInstances) {
                      if (ext.classInstance) {
                        queue.push(ext.classInstance);
                      }
                    }
                  }
                }
              }

              if (isOwned) {
                ownerPrefix = ctx.activePrefixes.get(stackClass);
                break;
              }
            }
          }
        }

        if (ownerPrefix !== undefined) {
          name = (ownerPrefix === "" ? "" : ownerPrefix + ".") + rawName;
        } else {
          if (rawName === "v" || rawName === "i" || rawName === "p.v") {
            // console.log(`[REF DEBUG] rawName=${rawName} prefix=${ctx.prefix} ownerPrefix=MISSING`);
          }
          // Not found in any active instance — it's an external/imported reference
          // Use fully qualified name to avoid incorrect prefixing
          name = this.#resolveFullyQualifiedName(rawName, ctx);
        }

        // Fold constants immediately if they have an evaluated value
        if (resolved instanceof ModelicaComponentInstance && resolved.variability === ModelicaVariability.CONSTANT) {
          const evaluated = resolved.modification?.evaluatedExpression;
          if (evaluated && isLiteral(evaluated)) {
            return evaluated;
          }
        }
      } else {
        // Fallback for unresolved or other cases: keep original logic but be careful
        name = (ctx.prefix === "" ? "" : ctx.prefix + ".") + rawName;
      }
    } else if (isBuiltinVar) {
      name = rawName;
    } else {
      // Global reference (.Modelica...) or no classInstance context
      name = rawName;
    }
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
        const baseName = name;
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
          const variable = ctx.dae.variables.get(indexedName);
          if (variable) return variable;
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
        const arraySize = ctx.dae.variables.getArrayElements(arrayPrefix.slice(0, -1)).length;
        const interp = new ModelicaInterpreter(true);
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
          const variable = ctx.dae.variables.get(indexedName);
          if (variable) return variable;
        }
        // Expand range subscripts into a ModelicaArray of individual indexed variables
        // e.g. work[4:-1:2] → [work[4], work[3], work[2]]
        if (rangeIndices && rangeIndices.length > 0) {
          const elements: ModelicaExpression[] = [];
          for (const idx of rangeIndices) {
            const indexedName = baseName + "[" + [...resolvedIndices, idx].join(",") + "]";
            const variable = ctx.dae.variables.get(indexedName);
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
      const variable = ctx.dae.variables.get(name);
      if (variable) return variable;
      // If exact match not found, look for array element variables with this prefix
      // This handles references like x[:] or bare array name y
      const prefix = name + "[";
      const arrayElements = ctx.dae.variables.getArrayElements(prefix.slice(0, -1));
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
      if (ctx.dae.variables.getEncoded(name)) {
        return new ModelicaNameExpression(name);
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
      const interp = new ModelicaInterpreter(true);
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
      // Skip zero-element array assignments (e.g., Real r[0]; r := f(time) is a no-op)
      if (effectiveTarget instanceof ModelicaArray && effectiveTarget.elements.length === 0) {
        return null;
      }
      ctx.stmtCollector.push(
        withLoc(new ModelicaAssignmentStatement(effectiveTarget, source), node as unknown as ModelicaSyntaxNode),
      );
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
    ctx.stmtCollector.push(withLoc(new ModelicaProcedureCallStatement(call), node as unknown as ModelicaSyntaxNode));
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
      if (target)
        ctx.stmtCollector.push(
          withLoc(new ModelicaAssignmentStatement(target, subscripted), node as unknown as ModelicaSyntaxNode),
        );
    } else {
      ctx.stmtCollector.push(
        withLoc(new ModelicaComplexAssignmentStatement(targets, source), node as unknown as ModelicaSyntaxNode),
      );
    }
    // Collect function definition if it's a user-defined function
    this.#collectFunctionDefinition(functionName, ctx);
    return null;
  }

  visitBreakStatement(node: ModelicaBreakStatementSyntaxNode, ctx: FlattenerContext): null {
    ctx.stmtCollector.push(withLoc(new ModelicaBreakStatement(), node as unknown as ModelicaSyntaxNode));
    return null;
  }

  visitReturnStatement(node: ModelicaReturnStatementSyntaxNode, ctx: FlattenerContext): null {
    ctx.stmtCollector.push(withLoc(new ModelicaReturnStatement(), node as unknown as ModelicaSyntaxNode));
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
    for (const stmt of statements) ctx.stmtCollector.push(withLoc(stmt, node as unknown as ModelicaSyntaxNode));
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
    const arrayVars = ctx.dae.variables.getArrayElements(prefix.slice(0, -1));
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
            for (const stmt of branch.statements)
              ctx.stmtCollector.push(withLoc(stmt, node as unknown as ModelicaSyntaxNode));
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
      for (const stmt of resolvedElse) ctx.stmtCollector.push(withLoc(stmt, node as unknown as ModelicaSyntaxNode));
      return null;
    }

    // Build the optimized if-statement from remaining branches
    const mainBranch = keptBranches[0];
    if (!mainBranch) return null;
    const remainingElseIfs = keptBranches.slice(1);
    ctx.stmtCollector.push(
      withLoc(
        new ModelicaIfStatement(mainBranch.condition, mainBranch.statements, remainingElseIfs, resolvedElse),
        node as unknown as ModelicaSyntaxNode,
      ),
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
    ctx.stmtCollector.push(
      withLoc(
        new ModelicaWhenStatement(condition, thenStatements, elseWhenClauses),
        node as unknown as ModelicaSyntaxNode,
      ),
    );
    return null;
  }

  visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, ctx: FlattenerContext): null {
    const condition = node.condition?.accept(this, ctx);
    if (!condition) return null;
    const statements = this.flattenStatements(node.statements ?? [], ctx);
    ctx.stmtCollector.push(
      withLoc(new ModelicaWhileStatement(condition, statements), node as unknown as ModelicaSyntaxNode),
    );
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
    if (!comp1 || !comp2) {
      console.error(`Connect component resolution failed: ${name1}=${!!comp1}, ${name2}=${!!comp2}`);
      return null;
    }

    // Preserve structural connect pair for ECAD netlist extraction
    const dotIdx1 = name1.lastIndexOf(".");
    const dotIdx2 = name2.lastIndexOf(".");
    ctx.dae.connectPairs.push({
      a: name1,
      b: name2,
      aComponent: dotIdx1 >= 0 ? name1.substring(0, dotIdx1) : name1,
      bComponent: dotIdx2 >= 0 ? name2.substring(0, dotIdx2) : name2,
    });

    // Collect leaf variables from both connector sides
    const leaves1 = this.#collectConnectorLeaves(comp1, name1);
    const leaves2 = this.#collectConnectorLeaves(comp2, name2);

    // Match variables by their local name suffix and generate equations
    for (const [localName, info1] of leaves1) {
      const info2 = leaves2.get(localName);
      if (!info2) continue;

      if (info1.isStream) {
        // Stream variables: no direct connect equations generated.
        // Track the connection for inStream() expansion.
        if (!ctx.streamConnections) ctx.streamConnections = [];
        ctx.streamConnections.push({
          side1: info1.fullName,
          side2: info2.fullName,
        });
        continue;
      }

      if (info1.isFlow) {
        // Defer flow equation generation — collect pairs for connection-set-based KCL.
        // Per Modelica spec §9.2, all flows at a connection set node sum to zero.
        if (ctx.flowConnectPairs) {
          ctx.flowConnectPairs.push({ name1: info1.fullName, name2: info2.fullName });
        }
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
          const val = sub.expression?.accept(new ModelicaInterpreter(true), ctx.classInstance);
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
   * Returns a map from local variable name to {fullName, isFlow, isStream}.
   */
  #collectConnectorLeaves(
    comp: ModelicaComponentInstance,
    prefix: string,
  ): Map<string, { fullName: string; isFlow: boolean; isStream: boolean }> {
    const result = new Map<string, { fullName: string; isFlow: boolean; isStream: boolean }>();
    const classInst = comp.classInstance;
    if (!classInst) return result;

    // For predefined types (Real, Integer, etc.), this component IS the leaf
    if (getUnderlyingPredefinedClass(classInst)) {
      result.set("", {
        fullName: prefix,
        isFlow: comp.flowPrefix === ModelicaFlow.FLOW,
        isStream: comp.flowPrefix === ModelicaFlow.STREAM,
      });
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
      if (getUnderlyingPredefinedClass(elemClass)) {
        // Leaf variable
        result.set(element.name, {
          fullName: prefix + "." + element.name,
          isFlow: element.flowPrefix === ModelicaFlow.FLOW,
          isStream: element.flowPrefix === ModelicaFlow.STREAM,
        });
      } else if (elemClass instanceof ModelicaArrayClassInstance) {
        // Array of predefined types - enumerate elements
        const shape = (elemClass as ModelicaArrayClassInstance).shape;
        if (shape.length === 1 && shape[0] !== undefined) {
          for (let idx = 1; idx <= shape[0]; idx++) {
            result.set(element.name + "[" + idx + "]", {
              fullName: prefix + "." + element.name + "[" + idx + "]",
              isFlow: element.flowPrefix === ModelicaFlow.FLOW,
              isStream: element.flowPrefix === ModelicaFlow.STREAM,
            });
          }
        }
      }
      // Handle nested connector types recursively
      else {
        const nestedPrefix = prefix + "." + element.name;
        const nestedLeaves = this.#collectConnectorLeaves(element, nestedPrefix);
        for (const [nestedName, info] of nestedLeaves) {
          const localName = nestedName ? element.name + "." + nestedName : element.name;
          result.set(localName, info);
        }
      }
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
      let isScalarLHS: boolean;
      let lhsName: string | null = null;
      if (expression1 instanceof ModelicaVariable && !expression1.name.includes("[")) {
        lhsName = expression1.name;
      } else if (expression1 instanceof ModelicaNameExpression && !expression1.name.includes("[")) {
        lhsName = expression1.name;
      }
      if (lhsName) {
        const rootName = lhsName;
        const hasIndexedVars = ctx.dae.variables.hasArrayElements(rootName);
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
      // Handle record constructor equations: expand or suppress
      if (expression2 instanceof ModelicaFunctionCallExpression) {
        const funcCall = expression2;

        // Suppress no-arg record constructor equations (c1 = Complex()) via direct type resolution
        // This catches default equations from component initialization before the constructor is collected
        if (funcCall.args.length === 0) {
          const resolved = ctx.classInstance.resolveName(funcCall.functionName.split("."));
          if (
            resolved instanceof ModelicaClassInstance &&
            (resolved.classKind === ModelicaClassKind.OPERATOR_RECORD ||
              resolved.classKind === ModelicaClassKind.RECORD)
          ) {
            return null;
          }
        }

        const funcDef = ctx.dae.functions.find((f) => f.name === funcCall.functionName);
        if (funcDef) {
          // Expand record constructor equations: c1 = Complex(2.0, 3.0) → c1.re = 2.0; c1.im = 3.0
          const outputVar = funcDef.variables.find((v) => v.causality === "output");
          if (
            outputVar?.customTypeName &&
            funcCall.functionName === outputVar.customTypeName &&
            funcCall.args.length > 0
          ) {
            // Get the LHS base name
            const lhsName =
              expression1 instanceof ModelicaNameExpression
                ? expression1.name
                : expression1 instanceof ModelicaVariable
                  ? expression1.name
                  : null;
            if (lhsName) {
              // Match args to input variables in declaration order
              const inputVars = funcDef.variables.filter((v) => v.causality === "input");
              for (let i = 0; i < Math.min(inputVars.length, funcCall.args.length); i++) {
                const inputVar = inputVars[i];
                const arg = funcCall.args[i];
                if (!inputVar || !arg) continue;
                const fieldName = `${lhsName}.${inputVar.name}`;
                const lhs = new ModelicaNameExpression(fieldName);
                ctx.dae.equations.push(new ModelicaSimpleEquation(lhs, arg));
              }
              return null;
            }
          }

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
                          const v = ctx.dae.variables.get(e.name);
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
      // When both sides are bare name expressions referencing arrays (e.g., x = y where
      // both are 2D arrays), neither conditional above triggers. Expand both sides.
      if (!(expression1 instanceof ModelicaArray) && !(expression2 instanceof ModelicaArray)) {
        const exp1 = expandNameToArray(expression1);
        const exp2 = expandNameToArray(expression2);
        if (exp1 && exp2) {
          expression1 = exp1;
          expression2 = exp2;
        }
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
        e instanceof ModelicaNameExpression && ctx.dae.variables.hasArrayElements(e.name);
      if (isRealTyped(expression1, ctx.dae) && !isArrayName(expression2))
        expression2 = coerceToReal(expression2, ctx.dae) ?? expression2;
      if (isRealTyped(expression2, ctx.dae) && !isArrayName(expression1))
        expression1 = coerceToReal(expression1, ctx.dae) ?? expression1;

      if (this.options?.arrayMode === "preserve") {
        const isArrayTarget = (expr: ModelicaExpression): boolean => {
          if (expr instanceof ModelicaNameExpression) {
            const foundVar = ctx.dae.variables.get(expr.name);
            return !!foundVar && foundVar.arrayDimensions != null;
          }
          if (expr instanceof ModelicaVariable) {
            return expr.arrayDimensions != null;
          }
          if (expr instanceof ModelicaSubscriptedExpression) {
            return true;
          }
          if (expr instanceof ModelicaArray) {
            return true;
          }
          if (expr instanceof ModelicaFunctionCallExpression && expr.functionName === "der" && expr.args.length === 1) {
            const arg = expr.args[0];
            return arg ? isArrayTarget(arg) : false;
          }
          return false;
        };

        if (isArrayTarget(expression1)) {
          ctx.dae.equations.push(
            new ModelicaArrayEquation(
              expression1,
              expression2,
              node.description?.strings?.map((d) => d.text ?? "")?.join(" "),
            ),
          );
          return null;
        }
      }

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

    if (functionName === "initialState" && flatArgs[0] instanceof ModelicaNameExpression) {
      ctx.dae.equations.push(new ModelicaInitialStateEquation(flatArgs[0].name));
      return null;
    }

    if (functionName === "transition" && flatArgs.length >= 3) {
      const fromState = flatArgs[0] instanceof ModelicaNameExpression ? flatArgs[0].name : "";
      const toState = flatArgs[1] instanceof ModelicaNameExpression ? flatArgs[1].name : "";
      const condition = flatArgs[2];
      if (!condition) return null;

      // Parse named arguments for optional transition properties
      const namedArgsMap = new Map<string, ModelicaExpression>();
      for (const arg of node.functionCallArguments?.namedArguments ?? []) {
        const argName = arg.identifier?.text ?? "";
        const argValue = arg.argument?.expression?.accept(this, ctx);
        if (argName && argValue) namedArgsMap.set(argName, argValue);
      }

      const immediateArg = namedArgsMap.get("immediate") ?? flatArgs[3];
      const resetArg = namedArgsMap.get("reset") ?? flatArgs[4];
      const synchronizeArg = namedArgsMap.get("synchronize") ?? flatArgs[5];
      const priorityArg = namedArgsMap.get("priority") ?? flatArgs[6];

      const immediate =
        immediateArg instanceof ModelicaBooleanLiteral
          ? immediateArg.value
          : immediateArg instanceof ModelicaNameExpression && immediateArg.name === "true";

      const reset = resetArg
        ? resetArg instanceof ModelicaBooleanLiteral
          ? resetArg.value
          : resetArg instanceof ModelicaNameExpression && resetArg.name === "true"
        : true; // default true

      const synchronize = synchronizeArg
        ? synchronizeArg instanceof ModelicaBooleanLiteral
          ? synchronizeArg.value
          : synchronizeArg instanceof ModelicaNameExpression && synchronizeArg.name === "true"
        : false; // default false

      const priority = priorityArg instanceof ModelicaIntegerLiteral ? priorityArg.value : 1; // default 1

      ctx.dae.equations.push(
        new ModelicaTransitionEquation(fromState, toState, condition, immediate, reset, synchronize, priority),
      );
      return null;
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
      // Operator record dispatch: unary minus → RecordType.'-'.negate(x)
      const operatorInfo = this.#resolveOperatorRecordFunction(operand, "'-'", ctx);
      if (operatorInfo) {
        const { qualifiedName, resolvedClass } = operatorInfo;
        this.#collectFunctionDefinition(qualifiedName, ctx, resolvedClass);
        return new ModelicaFunctionCallExpression(qualifiedName, [operand]);
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
    // Skip polymorphic synchronous operators (hold, previous, etc.) — they
    // preserve the type of their first argument.
    if (POLYMORPHIC_SYNC_OPS.has(expression.functionName)) return expression;
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

/**
 * Check if an expression tree contains symbolic references to parameter-variability
 * variables in the DAE. Used to detect when a syntax-flattened expression preserves
 * symbolic parameter references (e.g., `alpha`) that the interpreter would collapse.
 * Constant references (e.g., `FrameColor`) are NOT matched because they should be evaluated.
 */
function expressionHasNameRefs(expr: ModelicaExpression, dae: ModelicaDAE): boolean {
  if (expr instanceof ModelicaNameExpression) {
    // Check if this name refers to a parameter variable in the DAE
    const v = dae.variables.get(expr.name);
    if (v && v.variability === ModelicaVariability.PARAMETER) return true;
    // If not found as a DAE variable, it's likely a constant or unresolved — skip
    return false;
  }
  if (expr instanceof ModelicaVariable) {
    if (expr.variability === ModelicaVariability.PARAMETER) return true;
    return false;
  }
  if (expr instanceof ModelicaArray) {
    return expr.elements.some((e) => expressionHasNameRefs(e, dae));
  }
  if (expr instanceof ModelicaBinaryExpression) {
    return expressionHasNameRefs(expr.operand1, dae) || expressionHasNameRefs(expr.operand2, dae);
  }
  if (expr instanceof ModelicaUnaryExpression) {
    return expressionHasNameRefs(expr.operand, dae);
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    return expr.args.some((a) => expressionHasNameRefs(a, dae));
  }
  return false;
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
      const variable = dae.variables.get(expression.name);
      if (variable instanceof ModelicaRealVariable) {
        // Already Real-typed, no coercion needed
      } else if (!variable) {
        // Check for array name references — e.g., "B" when "B[1,1]", "B[1,2]" etc. exist
        const arrayEls = dae.variables.getArrayElements(expression.name);
        const arrayEl = arrayEls.length > 0 ? arrayEls[0] : undefined;
        if (arrayEl instanceof ModelicaRealVariable) {
          // Array of Real variables — no coercion needed
        } else if (arrayEl) {
          return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
        } else {
          // Check for encoded array function parameters (e.g., positionvector[1] → \0[3]\0positionvector)
          const bracketIdx = expression.name.indexOf("[");
          const baseName = bracketIdx >= 0 ? expression.name.substring(0, bracketIdx) : expression.name;
          const encodedMatch = dae.variables.getEncoded(baseName);
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
  // Wrap non-Real function calls in /*Real*/ (e.g., hold(3) → /*Real*/(hold(3)))
  if (expression instanceof ModelicaFunctionCallExpression) {
    if (!isRealTyped(expression, dae)) {
      return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
    }
  }
  return expression;
}

/**
 * Synchronous operators that are polymorphic — they return the same type as their first argument.
 * e.g., previous(x) returns Integer if x is Integer, Real if x is Real.
 */
const POLYMORPHIC_SYNC_OPS = new Set([
  "previous",
  "hold",
  "sample",
  "interval",
  "noClock",
  "subSample",
  "superSample",
  "backSample",
  "shiftSample",
  "inStream",
  "actualStream",
]);

function isRealTyped(expr: ModelicaExpression, dae?: ModelicaDAE): boolean {
  if (expr instanceof ModelicaRealVariable && !expr.customTypeName) return true;
  if (expr instanceof ModelicaRealLiteral) return true;
  if (expr instanceof ModelicaArray) return expr.elements.some((e) => isRealTyped(e, dae));
  if (expr instanceof ModelicaBinaryExpression)
    return isRealTyped(expr.operand1, dae) || isRealTyped(expr.operand2, dae);
  if (expr instanceof ModelicaUnaryExpression) return isRealTyped(expr.operand, dae);
  if (expr instanceof ModelicaNameExpression && dae) {
    const exactMatch = dae.variables.get(expr.name);
    if (exactMatch instanceof ModelicaRealVariable && !exactMatch.customTypeName) return true;

    const arrayEls = dae.variables.getArrayElements(expr.name);
    const arrayElement = arrayEls.length > 0 ? arrayEls[0] : undefined;
    if (arrayElement instanceof ModelicaRealVariable && !arrayElement.customTypeName) return true;

    // Check for encoded array function parameters (\0[dims]\0name)
    const encodedMatch = dae.variables.getEncoded(expr.name);
    if (encodedMatch instanceof ModelicaRealVariable && !encodedMatch.customTypeName) return true;
  }
  if (expr instanceof ModelicaNameExpression && expr.name === "time") return true;
  if (expr instanceof ModelicaSubscriptedExpression) return isRealTyped(expr.base, dae);
  if (expr instanceof ModelicaFunctionCallExpression) {
    // Polymorphic synchronous operators: return type matches first argument type
    if (POLYMORPHIC_SYNC_OPS.has(expr.functionName)) {
      return expr.args.length > 0 && expr.args[0] ? isRealTyped(expr.args[0], dae) : false;
    }
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
    const exactMatch = dae.variables.get(expr.name);
    if (exactMatch instanceof ModelicaIntegerVariable) return true;

    const intArrayEls = dae.variables.getArrayElements(expr.name);
    const arrayElement = intArrayEls.length > 0 ? intArrayEls[0] : undefined;
    if (arrayElement instanceof ModelicaIntegerVariable) return true;
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    // Polymorphic synchronous operators: return type matches first argument type
    if (POLYMORPHIC_SYNC_OPS.has(expr.functionName)) {
      return expr.args.length > 0 && expr.args[0] ? isIntegerTyped(expr.args[0], dae) : false;
    }
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

/** Check whether an expression is Boolean-typed (e.g., comparisons, Boolean variables, logical ops). */
function isBooleanTyped(expr: ModelicaExpression, dae?: ModelicaDAE): boolean {
  if (expr instanceof ModelicaBooleanLiteral) return true;
  if (expr instanceof ModelicaBooleanVariable) return true;
  if (expr instanceof ModelicaBinaryExpression) {
    // Comparison operators always return Boolean
    const compOps = new Set(["<", ">", "<=", ">=", "==", "<>"]);
    if (compOps.has(expr.operator)) return true;
    // Logical operators (and, or) return Boolean
    if (expr.operator === "and" || expr.operator === "or") return true;
    return false;
  }
  if (expr instanceof ModelicaUnaryExpression) {
    if (expr.operator === "not") return true;
    return false;
  }
  if (expr instanceof ModelicaNameExpression && dae) {
    const exactMatch = dae.variables.get(expr.name);
    if (exactMatch instanceof ModelicaBooleanVariable) return true;
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    const builtinDef = BUILTIN_FUNCTIONS.get(expr.functionName);
    if (builtinDef?.outputType === "Boolean") return true;
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
    const encoded = dae.variables.getEncoded(op1Name);
    if (encoded) {
      const expanded = expandArrayVariable(encoded);
      if (expanded) operand1 = expanded;
    }
  }
  if (dae && operand2 instanceof ModelicaNameExpression) {
    const op2Name = operand2.name;
    const encoded = dae.variables.getEncoded(op2Name);
    if (encoded) {
      const expanded = expandArrayVariable(encoded);
      if (expanded) operand2 = expanded;
    }
  }

  // Constant fold array operations (elementwise)
  const isElementwiseOp = operator.startsWith(".");
  const scalarOp = (isElementwiseOp ? operator.substring(1) : operator) as ModelicaBinaryOperator;

  // Scalar .op scalar → strip the dot prefix (e.g. t .+ u → t + u)
  if (isElementwiseOp && !(operand1 instanceof ModelicaArray) && !(operand2 instanceof ModelicaArray)) {
    return canonicalizeBinaryExpression(scalarOp, operand1, operand2, dae);
  }

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
    if (scalarOp === "+" || scalarOp === "-" || scalarOp === "*" || scalarOp === "/" || scalarOp === "^") {
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
  } else if (operand1 instanceof ModelicaArray && !(operand2 instanceof ModelicaArray)) {
    // Array op scalar: broadcast when operand2 is any scalar (literal or variable)
    if (scalarOp === "+" || scalarOp === "-" || scalarOp === "*" || scalarOp === "/" || scalarOp === "^") {
      // For + and -, array op scalar is only valid for element-wise operators (.+, .-)
      if ((scalarOp === "+" || scalarOp === "-") && !isElementwiseOp) {
        // Don't broadcast — return as symbolic expression
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
      // For non-element-wise * and /, only broadcast with literal scalars
      if (!isElementwiseOp && !isLiteral(operand2)) {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
      if (isElementwiseOp) {
        // Element-wise: recurse to handle nested sub-arrays in multi-dim arrays
        const newElements = operand1.elements.map((e) => canonicalizeBinaryExpression(operator, e, operand2, dae));
        return new ModelicaArray(operand1.shape, newElements);
      }
      // Non-element-wise: preserve source operand order (array * scalar)
      const newElements = operand1.elements.map((e) => new ModelicaBinaryExpression(scalarOp, e, operand2));
      return new ModelicaArray(operand1.shape, newElements);
    }
  } else if (!(operand1 instanceof ModelicaArray) && operand2 instanceof ModelicaArray) {
    // Scalar op array: broadcast when operand1 is any scalar (literal or variable)
    if (scalarOp === "+" || scalarOp === "-" || scalarOp === "*" || scalarOp === "/" || scalarOp === "^") {
      if ((scalarOp === "+" || scalarOp === "-") && !isElementwiseOp) {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
      // scalar / array is only valid with element-wise ./ operator; plain / is not allowed
      if (scalarOp === "/" && !isElementwiseOp) {
        throw new Error(`Type mismatch: scalar / array is not a valid operation. Use element-wise ./ instead.`);
      }
      // For non-element-wise * and ^, only broadcast with literal scalars
      if (!isElementwiseOp && !isLiteral(operand1)) {
        return new ModelicaBinaryExpression(operator, operand1, operand2);
      }
      if (isElementwiseOp) {
        // Element-wise: recurse to handle nested sub-arrays in multi-dim arrays
        // For commutative ops (+ and *), canonicalize to put element first (matching OMC)
        const isCommutative = scalarOp === "+" || scalarOp === "*";
        const newElements = (operand2 as ModelicaArray).elements.map((e) =>
          isCommutative
            ? canonicalizeBinaryExpression(operator, e, operand1, dae)
            : canonicalizeBinaryExpression(operator, operand1, e, dae),
        );
        return new ModelicaArray(operand2.shape, newElements);
      }
      // Non-element-wise: preserve source operand order (scalar * array)
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
    const variable = dae.variables.get(expr.name);
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

/**
 * Sorts DAE equations and identifies strongly connected components (algebraic loops)
 * using Tarjan's SCC algorithm.
 */
export function findAlgebraicLoops(dae: ModelicaDAE): void {
  const { sortedEquations, algebraicLoops } = performBltTransformation(dae);
  dae.sortedEquations = sortedEquations;

  if (algebraicLoops.length > 0) {
    console.log(`[DAE] Found ${algebraicLoops.length} algebraic loop(s) in ${dae.name}`);
    dae.algebraicLoops = algebraicLoops;
  }
}

function withLoc<T extends ModelicaStatement | ModelicaEquation>(
  node: T,
  syntaxNode: ModelicaSyntaxNode | null | undefined,
): T {
  if (syntaxNode?.sourceRange && "location" in node) {
    (
      node as unknown as { location?: { startLine: number; startCol: number; endLine: number; endCol: number } }
    ).location = {
      startLine: syntaxNode.sourceRange.startRow + 1,
      startCol: syntaxNode.sourceRange.startCol + 1,
      endLine: syntaxNode.sourceRange.endRow + 1,
      endCol: syntaxNode.sourceRange.endCol + 1,
    };
  }
  return node;
}
