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
  ModelicaNamedElement,
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

  visitComponentInstance(node: ModelicaComponentInstance, args: [string, ModelicaDAE]): void {
    // Skip pure `outer` components — they reference an `inner` declaration higher up
    // and should not generate their own variables. `inner outer` still generates a variable.
    if (node.isOuter && !node.isInner) return;

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
    let arrayBindingExpression = node.modification?.expression ?? null;
    // If the interpreter couldn't evaluate the binding (e.g., if-expression with parameter
    // condition), try the syntax flattener which can handle symbolic expressions
    if (!arrayBindingExpression && node.modification?.modificationExpression?.expression) {
      const syntaxFlattener = new ModelicaSyntaxFlattener();
      arrayBindingExpression =
        node.modification.modificationExpression.expression.accept(syntaxFlattener, {
          prefix: args[0],
          classInstance: node.parent ?? ({} as ModelicaClassInstance),
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
        }) ?? null;
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
      shape = arrayBindingExpression.shape;
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
        declaredElement?.accept(this, [elementName, args[1]]);
      }
      elementIndex++;
      if (!this.incrementIndex(index, shape)) break;
    }

    if (arrayBindingExpression && !flatBindingElements && (shape[0] ?? 0) > 0) {
      const firstElement = arrayClassInstance.declaredElements[0];
      const isRealArray =
        firstElement instanceof ModelicaRealClassInstance ||
        (firstElement instanceof ModelicaArrayClassInstance &&
          firstElement.elementClassInstance instanceof ModelicaRealClassInstance);
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
      const args = expr.args.map((a) => this.#foldExpression(a, dae, visited, inlineParameters));
      const folded = tryFoldBuiltinFunction(expr.functionName, args);
      if (folded) return folded;

      // Strip noEvent() wrapper during constant folding
      if (expr.functionName === "noEvent" && args.length === 1 && args[0] && isLiteral(args[0])) {
        return args[0];
      }

      // Evaluate String() conversion
      if (expr.functionName === "String" && args.length >= 1) {
        const arg0 = args[0];
        if (arg0 instanceof ModelicaIntegerLiteral) {
          return new ModelicaStringLiteral(String(arg0.value));
        } else if (arg0 instanceof ModelicaRealLiteral) {
          return new ModelicaStringLiteral(String(arg0.value));
        } else if (arg0 instanceof ModelicaBooleanLiteral) {
          return new ModelicaStringLiteral(arg0.value ? "true" : "false");
        } else if (arg0 instanceof ModelicaStringLiteral) {
          return arg0;
        }
      }

      // Fold Boolean min/max
      if ((expr.functionName === "min" || expr.functionName === "max") && args.length === 2) {
        if (args[0] instanceof ModelicaBooleanLiteral && args[1] instanceof ModelicaBooleanLiteral) {
          const a = args[0].value;
          const b = args[1].value;
          if (expr.functionName === "min") return new ModelicaBooleanLiteral(a && b);
          return new ModelicaBooleanLiteral(a || b);
        }
      }

      // Fold Integer(enum) and String(enum) conversions
      if (expr.functionName === "Integer" && args.length === 1 && args[0] instanceof ModelicaEnumerationLiteral) {
        return new ModelicaIntegerLiteral(args[0].ordinalValue);
      }
      if (expr.functionName === "String" && args.length >= 1 && args[0] instanceof ModelicaEnumerationLiteral) {
        return new ModelicaStringLiteral(args[0].stringValue);
      }

      // Fold enum min/max
      if ((expr.functionName === "min" || expr.functionName === "max") && args.length === 2) {
        if (args[0] instanceof ModelicaEnumerationLiteral && args[1] instanceof ModelicaEnumerationLiteral) {
          if (expr.functionName === "min") {
            return args[0].ordinalValue <= args[1].ordinalValue ? args[0] : args[1];
          }
          return args[0].ordinalValue >= args[1].ordinalValue ? args[0] : args[1];
        }
      }
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
        (expr.variability === ModelicaVariability.CONSTANT || expr.variability === ModelicaVariability.PARAMETER) &&
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
            (inlineParameters && variable.variability === ModelicaVariability.PARAMETER)) &&
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

        // Return a partially or fully folded SubscriptedExpression
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
    const elements: ModelicaExpression[] = [];
    const shape = [node.expressionLists.length, node.expressionLists[0]?.expressions?.length ?? 0];
    for (const expressionList of node.expressionLists ?? []) {
      for (const expression of expressionList.expressions ?? []) {
        const element = expression.accept(this, ctx);
        if (element != null) elements.push(element);
      }
    }
    return new ModelicaArray(shape, elements);
  }

  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    const elements: ModelicaExpression[] = [];
    for (const expression of node.expressionList?.expressions ?? []) {
      const element = expression.accept(this, ctx);
      if (element != null) elements.push(element);
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
    return node.expression?.accept(this, ctx) ?? null;
  }

  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, ctx: FlattenerContext): ModelicaExpression | null {
    // Use parts-based name for regular ComponentReference functions.
    // Fall back to functionReferenceName for keyword functions (der/initial/pure).
    let functionName =
      node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ||
      (node.functionReferenceName ?? "");
    let flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      const flatArg = arg.expression?.accept(this, ctx);
      if (flatArg) flatArgs.push(flatArg);
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

    // Evaluate built-in array constructors at flatten time
    if (functionName === "array" && flatArgs.length >= 1) {
      return new ModelicaArray([flatArgs.length], flatArgs);
    }
    if (functionName === "fill" && flatArgs.length >= 2) {
      const shape = extractShape(flatArgs.slice(1));
      if (shape && flatArgs[0]) return buildFilledArray(shape, flatArgs[0]);
    }
    if (functionName === "zeros" && flatArgs.length >= 1) {
      const shape = extractShape(flatArgs);
      if (shape) return buildFilledArray(shape, new ModelicaIntegerLiteral(0));
      // Symbolic args: rewrite zeros(n) → fill(0.0, n)
      return new ModelicaFunctionCallExpression("fill", [new ModelicaRealLiteral(0.0), ...flatArgs]);
    }
    if (functionName === "ones" && flatArgs.length >= 1) {
      const shape = extractShape(flatArgs);
      if (shape) return buildFilledArray(shape, new ModelicaIntegerLiteral(1));
      // Symbolic args: rewrite ones(n) → fill(1.0, n)
      return new ModelicaFunctionCallExpression("fill", [new ModelicaRealLiteral(1.0), ...flatArgs]);
    }
    // Evaluate size function
    if (functionName === "size" && flatArgs.length >= 1) {
      const arrayArg = flatArgs[0];
      if (arrayArg instanceof ModelicaArray) {
        if (flatArgs.length === 1) {
          const totalSize = arrayArg.shape.reduce((a, b) => a * b, 1);
          return new ModelicaIntegerLiteral(totalSize);
        } else if (flatArgs.length === 2 && flatArgs[1] instanceof ModelicaIntegerLiteral) {
          const dim = flatArgs[1].value;
          if (dim >= 1 && dim <= arrayArg.shape.length) {
            return new ModelicaIntegerLiteral(arrayArg.shape[dim - 1] ?? 0);
          }
        }
      }
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
    // Per-parameter type coercion: coerce integer args to Real only where the
    // built-in function signature expects a Real parameter
    if (builtinDef) {
      for (let i = 0; i < flatArgs.length && i < builtinDef.inputs.length; i++) {
        if (builtinDef.inputs[i]?.type === "Real") {
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

    // Check if the function resolves to an external clause mapping to a builtin
    // (e.g. `function f = Modelica.Math.atan2` where atan2 has `external "C" y=atan2(u1,u2)`)
    if (!builtinDef) {
      const externalBuiltin = this.#resolveExternalBuiltin(functionName, ctx);
      if (externalBuiltin) {
        functionName = externalBuiltin;
        builtinDef = BUILTIN_FUNCTIONS.get(functionName);
      }
    }

    // Collect function definition BEFORE type coercion so we can use per-parameter types
    this.#collectFunctionDefinition(functionName, ctx, resolvedOverride, componentPrefix);

    // Expand default arguments for user-defined functions, but ONLY if they are inherently
    // literals structurally. Injecting other parameter-reliant defaults (e.g. `y = 2.0 * x`)
    // into the caller's DAE overrides closures incorrectly.
    if (!builtinDef) {
      const funcDef = ctx.dae.functions.find((f) => f.name === functionName);
      if (funcDef) {
        const inputVars = funcDef.variables.filter((v) => v.causality === "input");
        while (flatArgs.length < inputVars.length) {
          const param = inputVars[flatArgs.length];
          if (!param?.expression) break;
          if (isLiteral(param.expression) || isLiteralArray(param.expression)) {
            flatArgs.push(param.expression);
          } else {
            break;
          }
        }
      }
    }

    // Per-parameter type coercion: coerce integer args to Real only where the
    // function signature expects a Real parameter
    if (!builtinDef) {
      const funcDef = ctx.dae.functions.find((f) => f.name === functionName);

      if (funcDef) {
        const inputVars = funcDef.variables.filter((v) => v.causality === "input");
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

    const result = new ModelicaFunctionCallExpression(functionName, flatArgs);

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
      const interp = new ModelicaInterpreter(true);
      const evalResult = node.accept(interp, ctx.classInstance);
      if (evalResult) {
        return evalResult;
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
          const callName = ext.externalFunctionCall?.functionName?.text ?? cls.name ?? "";
          if (callName && ModelicaSyntaxFlattener.#isBuiltinFunction(callName)) {
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
    // Skip if already collected or currently being collected (prevents recursion)
    if (ctx.dae.functions.some((f) => f.name === functionName)) return;
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
        // Coerce integer literals to real for Real-typed function params (e.g. 5 → 5.0)
        if (expression instanceof ModelicaIntegerLiteral) {
          expression = new ModelicaRealLiteral(expression.value);
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
        );
      }
      fnDae.variables.push(variable);
    }

    // Register the function definition early to prevent infinite recursion when
    // the function body references itself (directly or via name resolution).
    ctx.dae.functions.push(fnDae);

    // Flatten algorithm and equation sections (these still use the standard path)

    for (const equationSection of resolved.equationSections) {
      for (const eq of equationSection.equations) {
        eq.accept(new ModelicaSyntaxFlattener(), {
          prefix: "",
          classInstance: resolved,
          dae: fnDae,
          stmtCollector: [],
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
          ...(componentPrefix ? { componentFunctionPrefix: componentPrefix } : {}),
        });
      }
      if (collector.length > 0) {
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
    // fnDae was already pushed earlier to prevent recursion
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
    const outputs = node.outputs.filter((o): o is ModelicaExpressionSyntaxNode => o != null);
    if (outputs.length === 1) return outputs[0]?.accept(this, ctx) ?? null;
    // Multi-output: build as array
    const elements: ModelicaExpression[] = [];
    for (const output of outputs) {
      const expr = output.accept(this, ctx);
      if (expr) elements.push(expr);
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
        // Walk up the instance hierarchy to find the inner declaration
        let scope = ctx.classInstance.parent instanceof ModelicaClassInstance ? ctx.classInstance.parent : null;
        let prefixParts = effectivePrefix.split(".");
        // Remove one prefix level for each scope we walk up
        while (scope) {
          prefixParts = prefixParts.slice(0, -1);
          // Check if this scope has an inner component with the same name
          for (const el of scope.declaredElements) {
            if (el instanceof ModelicaComponentInstance && el.name === firstPartName && el.isInner) {
              // Found the inner — use its prefix
              effectivePrefix = prefixParts.join(".");
              scope = null; // break outer while
              break;
            }
          }
          if (scope) scope = scope.parent instanceof ModelicaClassInstance ? scope.parent : null;
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
            const subExpr = sub.expression.accept(this, ctx);

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
        return new ModelicaArray([arrayElements.length], arrayElements);
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
      ctx.stmtCollector.push(new ModelicaAssignmentStatement(target, source));
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
    ctx.stmtCollector.push(new ModelicaComplexAssignmentStatement(targets, source));
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
        ctx.dae.diagnostics.push(
          makeDiagnostic(ModelicaErrorCode.FOR_ITERATOR_NOT_1D, forIndex.expression, indexName, fullShape.join(", ")),
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

  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, ctx: FlattenerContext): null {
    let expression1 = node.expression1?.accept(this, ctx);
    let expression2 = node.expression2?.accept(this, ctx);
    if (expression1 && expression2) {
      // When the LHS is a tuple (output expression list), wrap the RHS as a
      // matching tuple instead of splitting into per-element scalar equations.
      if (expression1 instanceof ModelicaTupleExpression && expression2 instanceof ModelicaArray) {
        const flat2 = [...expression2.flatElements];
        // Coerce Integer elements to Real where the LHS element is Real-typed
        const coerced: ModelicaExpression[] = [];
        for (let i = 0; i < flat2.length; i++) {
          let rhs = flat2[i];
          const lhs = expression1.elements[i];
          if (rhs && lhs && isRealTyped(lhs, ctx.dae)) {
            rhs = coerceToReal(rhs, ctx.dae) ?? rhs;
          }
          if (rhs) coerced.push(rhs);
        }
        const tupleRHS = new ModelicaTupleExpression(coerced);
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
      // Expand array-to-array equations into per-element scalar equations
      if (expression1 instanceof ModelicaArray && expression2 instanceof ModelicaArray) {
        const flat1 = [...expression1.flatElements];
        const flat2 = [...expression2.flatElements];
        const count = Math.min(flat1.length, flat2.length);
        for (let i = 0; i < count; i++) {
          let e1 = flat1[i];
          let e2 = flat2[i];
          if (!e1 || !e2) continue;
          if (e1 instanceof ModelicaRealVariable) e2 = castToReal(e2) ?? e2;
          if (e2 instanceof ModelicaRealVariable) e1 = castToReal(e1) ?? e1;
          ctx.dae.equations.push(new ModelicaSimpleEquation(e1, e2));
        }
        return null;
      }
      // Widen integers to Real when the other side is Real-typed
      if (isRealTyped(expression1, ctx.dae)) expression2 = coerceToReal(expression2, ctx.dae) ?? expression2;
      if (isRealTyped(expression2, ctx.dae)) expression1 = coerceToReal(expression1, ctx.dae) ?? expression1;
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
    return new ModelicaRealLiteral(node.value);
  }
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
        // Check for encoded array function parameters (e.g., positionvector[1] → \0[3]\0positionvector)
        const bracketIdx = expression.name.indexOf("[");
        const baseName = bracketIdx >= 0 ? expression.name.substring(0, bracketIdx) : expression.name;
        const encodedMatch = dae.variables.find((v) => v.name.startsWith("\0") && v.name.endsWith("\0" + baseName));
        if (encodedMatch instanceof ModelicaRealVariable) {
          // Element of a Real array, no coercion needed
        } else {
          return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
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
    if (builtinDef) return builtinDef.outputType === "Real";
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
  if (isRealTyped(operand1, dae)) operand2 = castToReal(operand2) ?? operand2;
  if (isRealTyped(operand2, dae)) operand1 = castToReal(operand1) ?? operand1;
  if (operator === ModelicaBinaryOperator.SUBTRACTION && isLiteral(operand2)) {
    const negated = new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, operand2);
    return new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, negated, operand1);
  }
  // Canonicalize commutative operations: put literals on the left
  // (but NOT for string concatenation, which is not commutative)
  if (
    (operator === ModelicaBinaryOperator.ADDITION || operator === ModelicaBinaryOperator.MULTIPLICATION) &&
    !isLiteral(operand1) &&
    isLiteral(operand2) &&
    !(operand2 instanceof ModelicaStringLiteral)
  ) {
    return new ModelicaBinaryExpression(operator, operand2, operand1);
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
  return expr;
}

/**
 * Try to evaluate a built-in function call with literal arguments at compile time.
 * Returns the evaluated result as a literal, or null if evaluation is not possible.
 */
function tryFoldBuiltinFunction(functionName: string, args: ModelicaExpression[]): ModelicaExpression | null {
  // Zero-argument identity values for reduction functions over empty ranges
  if (args.length === 0) {
    switch (functionName) {
      case "sum":
        return new ModelicaIntegerLiteral(0);
      case "product":
        return new ModelicaIntegerLiteral(1);
      case "min":
        return new ModelicaRealLiteral(8.777798510069901e304);
      case "max":
        return new ModelicaRealLiteral(-8.777798510069901e304);
      default:
        return null;
    }
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

  // Single-argument math functions
  if (numArgs.length === 1) {
    const x = numArgs[0] ?? 0;
    const realFns: Record<string, (x: number) => number> = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
      sinh: Math.sinh,
      cosh: Math.cosh,
      tanh: Math.tanh,
      exp: Math.exp,
      log: Math.log,
      log10: Math.log10,
      sqrt: Math.sqrt,
      der: () => 0.0,
    };
    const fn = realFns[functionName];
    if (fn) {
      // Domain checks
      if ((functionName === "log" || functionName === "log10") && x <= 0) {
        throw new Error(`Argument ${x} of ${functionName} is out of range (x > 0)`);
      }
      if (functionName === "sqrt" && x < 0) {
        throw new Error(`Argument ${x} of sqrt is out of range (x >= 0)`);
      }
      const result = fn(x);
      if (!Number.isFinite(result)) return null;
      return new ModelicaRealLiteral(result);
    }
    // abs and sign preserve Integer type: abs(Integer) -> Integer, abs(Real) -> Real
    if (functionName === "abs" || functionName === "sign") {
      const mathFn = functionName === "abs" ? Math.abs : Math.sign;
      const result = mathFn(x);
      if (!Number.isFinite(result)) return null;
      if (args[0] instanceof ModelicaIntegerLiteral) return new ModelicaIntegerLiteral(result);
      return new ModelicaRealLiteral(result);
    }
    // Integer-returning functions
    const intFns: Record<string, (x: number) => number> = {
      ceil: Math.ceil,
      floor: Math.floor,
      integer: Math.floor,
    };
    const intFn = intFns[functionName];
    if (intFn) {
      const result = intFn(x);
      if (!Number.isFinite(result)) return null;
      return new ModelicaIntegerLiteral(result);
    }
  }

  // Two-argument functions
  if (numArgs.length === 2) {
    const [a, b] = numArgs as [number, number];
    const bothInteger = args[0] instanceof ModelicaIntegerLiteral && args[1] instanceof ModelicaIntegerLiteral;
    const literal = (v: number) => (bothInteger ? new ModelicaIntegerLiteral(v) : new ModelicaRealLiteral(v));
    switch (functionName) {
      case "max":
        return literal(Math.max(a, b));
      case "min":
        return literal(Math.min(a, b));
      case "mod":
        return b !== 0 ? literal(a - Math.floor(a / b) * b) : null;
      case "rem":
        return b !== 0 ? literal(a - Math.trunc(a / b) * b) : null;
      case "div":
        return b !== 0 ? new ModelicaIntegerLiteral(Math.trunc(a / b)) : null;
      case "atan2":
        return new ModelicaRealLiteral(Math.atan2(a, b));
    }
  }

  return null;
}
