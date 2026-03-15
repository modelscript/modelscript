// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "../../util/io.js";
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
  ModelicaDAE,
  ModelicaEnumerationLiteral,
  ModelicaEnumerationVariable,
  ModelicaEquation,
  ModelicaExpression,
  ModelicaForEquation,
  ModelicaForStatement,
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
  ModelicaUnaryExpression,
  ModelicaVariable,
  ModelicaWhenEquation,
  ModelicaWhenStatement,
  ModelicaWhileStatement,
  type ModelicaObject,
} from "./dae.js";
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
  ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance,
  ModelicaStringClassInstance,
} from "./model.js";
import {
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
  ModelicaExpressionSyntaxNode,
  ModelicaFlow,
  ModelicaForEquationSyntaxNode,
  ModelicaForStatementSyntaxNode,
  ModelicaFunctionArgumentSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIfElseExpressionSyntaxNode,
  ModelicaIfEquationSyntaxNode,
  ModelicaIfStatementSyntaxNode,
  ModelicaLongClassSpecifierSyntaxNode,
  ModelicaOutputExpressionListSyntaxNode,
  ModelicaProcedureCallStatementSyntaxNode,
  ModelicaRangeExpressionSyntaxNode,
  ModelicaReturnStatementSyntaxNode,
  ModelicaSimpleAssignmentStatementSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
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
    for (const equationSection of node.equationSections) {
      const target = equationSection.initial ? args[1].initialEquations : args[1].equations;
      const savedEquations = args[1].equations;
      // Temporarily redirect equation collection to the right target
      args[1].equations = target;
      for (const eq of equationSection.equations) {
        eq.accept(new ModelicaSyntaxFlattener(), {
          prefix: args[0],
          classInstance: node,
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
        });
      }
      args[1].equations = savedEquations;
    }
    for (const algorithmSection of node.algorithmSections) {
      const collector: ModelicaStatement[] = [];
      for (const statement of algorithmSection.statements) {
        statement.accept(new ModelicaSyntaxFlattener(), {
          prefix: args[0],
          classInstance: node,
          dae: args[1],
          stmtCollector: collector,
          structuralFinalParams: this.#structuralFinalParams,
        });
      }
      if (collector.length > 0) {
        if (algorithmSection.initial) {
          args[1].initialAlgorithms.push(collector);
        } else {
          args[1].algorithms.push(collector);
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
  // Track parameter names that are structurally significant (used in conditional component declarations)
  #structuralFinalParams = new Set<string>();

  visitComponentInstance(node: ModelicaComponentInstance, args: [string, ModelicaDAE]): void {
    // Skip pure `outer` components — they reference an `inner` declaration higher up
    // and should not generate their own variables. `inner outer` still generates a variable.
    if (node.isOuter && !node.isInner) return;

    // Skip components removed by the `break` modifier in an extends clause.
    // Only check at the top level (empty prefix) — nested sub-components (e.g., y.x)
    // should not be matched by a `break x` targeting the top-level component x.
    if (args[0] === "") {
      const activeClass = this.activeClassStack[this.activeClassStack.length - 1];
      if (activeClass?.isBrokenElement(node.name)) return;
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
    const { causality } = node;
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
      variable = new ModelicaRealVariable(
        name,
        castToReal(varExpression),
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

    // Process recursive extends
    for (const declaredElement of node.classInstance.declaredElements ?? []) {
      if (declaredElement instanceof ModelicaExtendsClassInstance) declaredElement.accept(this, args);
    }

    // Process equation sections from base class
    for (const equationSection of node.classInstance.equationSections) {
      const target = equationSection.initial ? args[1].initialEquations : args[1].equations;
      const savedEquations = args[1].equations;
      args[1].equations = target;
      for (const eq of equationSection.equations) {
        eq.accept(new ModelicaSyntaxFlattener(), {
          prefix: args[0],
          classInstance: node.classInstance,
          dae: args[1],
          stmtCollector: [],
          structuralFinalParams: this.#structuralFinalParams,
        });
      }
      args[1].equations = savedEquations;
    }

    // Process algorithm sections from base class
    for (const algorithmSection of node.classInstance.algorithmSections) {
      const collector: ModelicaStatement[] = [];
      for (const statement of algorithmSection.statements) {
        statement.accept(new ModelicaSyntaxFlattener(), {
          prefix: args[0],
          classInstance: node.classInstance,
          dae: args[1],
          stmtCollector: collector,
          structuralFinalParams: this.#structuralFinalParams,
        });
      }
      if (collector.length > 0) {
        if (algorithmSection.initial) {
          args[1].initialAlgorithms.push(collector);
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
            let newExpr = this.#foldExpression(variable.expression, dae);
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
  #foldExpression(expr: ModelicaExpression, dae?: ModelicaDAE, visited = new Set<string>()): ModelicaExpression {
    if (expr instanceof ModelicaBinaryExpression) {
      const op1 = this.#foldExpression(expr.operand1, dae, visited);
      const op2 = this.#foldExpression(expr.operand2, dae, visited);
      return canonicalizeBinaryExpression(expr.operator, op1, op2, dae);
    } else if (expr instanceof ModelicaUnaryExpression) {
      const op1 = this.#foldExpression(expr.operand, dae, visited);
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
          this.#foldExpression(new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, e), dae, visited),
        );
        return new ModelicaArray(op1.shape, foldedElements);
      }
      return new ModelicaUnaryExpression(expr.operator, op1);
    } else if (expr instanceof ModelicaFunctionCallExpression) {
      const args = expr.args.map((a) => this.#foldExpression(a, dae, visited));
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
        if (!nonDistributive.has(expr.functionName)) {
          const newElements = arr.elements.map((e) =>
            this.#foldExpression(new ModelicaFunctionCallExpression(expr.functionName, [e]), dae, visited),
          );
          return new ModelicaArray(arr.shape, newElements);
        }
      }
      return new ModelicaFunctionCallExpression(expr.functionName, args);
    } else if (expr instanceof ModelicaArray) {
      const newElements = expr.elements.map((e) => this.#foldExpression(e, dae, visited));
      return new ModelicaArray(expr.shape, newElements);
    } else if (expr instanceof ModelicaIfElseExpression) {
      const cond = this.#foldExpression(expr.condition, dae, visited);
      if (cond instanceof ModelicaBooleanLiteral) {
        if (cond.value) return this.#foldExpression(expr.thenExpression, dae, visited);

        for (const elseif of expr.elseIfClauses) {
          const elifCond = this.#foldExpression(elseif.condition, dae, visited);
          if (elifCond instanceof ModelicaBooleanLiteral) {
            if (elifCond.value) return this.#foldExpression(elseif.expression, dae, visited);
          } else {
            // Cannot guarantee compile-time evaluation beyond this point
            break;
          }
        }
        return this.#foldExpression(expr.elseExpression, dae, visited);
      }

      // If we cannot fully evaluate the condition, at least construct a folded nested expression
      const newElseIfs = expr.elseIfClauses.map((ei) => ({
        condition: this.#foldExpression(ei.condition, dae, visited),
        expression: this.#foldExpression(ei.expression, dae, visited),
      }));
      return new ModelicaIfElseExpression(
        cond,
        this.#foldExpression(expr.thenExpression, dae, visited),
        newElseIfs,
        this.#foldExpression(expr.elseExpression, dae, visited),
      );
    } else if (expr instanceof ModelicaVariable) {
      if (
        (expr.variability === ModelicaVariability.CONSTANT || expr.variability === ModelicaVariability.PARAMETER) &&
        expr.expression
      ) {
        if (!visited.has(expr.name)) {
          const newVisited = new Set(visited).add(expr.name);
          const folded = this.#foldExpression(expr.expression, dae, newVisited);
          if (isLiteral(folded) || folded instanceof ModelicaArray) return folded;
        }
      }
    } else if (expr instanceof ModelicaNameExpression) {
      if (dae && !visited.has(expr.name)) {
        const variable = dae.variables.find((v) => v.name === expr.name);
        if (
          variable &&
          (variable.variability === ModelicaVariability.CONSTANT ||
            variable.variability === ModelicaVariability.PARAMETER) &&
          variable.expression
        ) {
          const newVisited = new Set(visited).add(expr.name);
          const folded = this.#foldExpression(variable.expression, dae, newVisited);
          if (isLiteral(folded) || folded instanceof ModelicaArray) return folded;
        }
      }
    } else if (expr instanceof ModelicaSubscriptedExpression) {
      if (dae) {
        // Evaluate base and subscripts
        const base = this.#foldExpression(expr.base, dae, visited);
        const subscripts = expr.subscripts.map((s) => this.#foldExpression(s, dae, visited));

        // If it's a direct reference to a flattened scalar variable element like intArray[1]
        if (base instanceof ModelicaNameExpression && subscripts.every((s) => s instanceof ModelicaIntegerLiteral)) {
          const flatName = base.name + "[" + subscripts.map((s) => (s as ModelicaIntegerLiteral).value).join(",") + "]";
          if (!visited.has(flatName)) {
            const variable = dae.variables.find((v) => v.name === flatName);
            if (
              variable &&
              (variable.variability === ModelicaVariability.CONSTANT ||
                variable.variability === ModelicaVariability.PARAMETER) &&
              variable.expression
            ) {
              const newVisited = new Set(visited).add(flatName);
              const folded = this.#foldExpression(variable.expression, dae, newVisited);
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
          const foldedStart = this.#foldExpression(range.start, dae, visited);
          const foldedEnd = this.#foldExpression(range.end, dae, visited);
          if (foldedStart instanceof ModelicaIntegerLiteral && foldedEnd instanceof ModelicaIntegerLiteral) {
            const start = foldedStart.value;
            const end = foldedEnd.value;
            const step = range.step
              ? ((this.#foldExpression(range.step, dae, visited) as ModelicaIntegerLiteral)?.value ?? 1)
              : 1;
            const elements: ModelicaExpression[] = [];
            for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
              const flatName = base.name + "[" + i + "]";
              const variable = dae.variables.find((v) => v.name === flatName);
              if (
                variable &&
                (variable.variability === ModelicaVariability.CONSTANT ||
                  variable.variability === ModelicaVariability.PARAMETER) &&
                variable.expression
              ) {
                const folded = this.#foldExpression(variable.expression, dae, visited);
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
  /** Built-in function names that should not be looked up as user-defined functions. */
  static readonly #builtinFunctions = new Set([
    "abs",
    "acos",
    "actualStream",
    "asin",
    "assert",
    "atan",
    "atan2",
    "backSample",
    "cardinality",
    "cat",
    "ceil",
    "change",
    "Clock",
    "cos",
    "cosh",
    "cross",
    "delay",
    "der",
    "diagonal",
    "div",
    "edge",
    "end",
    "exp",
    "fill",
    "floor",
    "hold",
    "homotopy",
    "identity",
    "initial",
    "initialState",
    "inStream",
    "integer",
    "interval",
    "linspace",
    "log",
    "log10",
    "matrix",
    "max",
    "min",
    "mod",
    "noClock",
    "noEvent",
    "ones",
    "pre",
    "previous",
    "print",
    "product",
    "promote",
    "reinit",
    "rem",
    "rooted",
    "sample",
    "scalar",
    "semiLinear",
    "shiftSample",
    "sign",
    "sin",
    "sinh",
    "size",
    "skew",
    "smooth",
    "spatialDistribution",
    "sqrt",
    "subSample",
    "sum",
    "superSample",
    "symmetric",
    "tan",
    "tanh",
    "terminal",
    "terminate",
    "transpose",
    "vector",
    "zeros",
    "String",
    "Integer",
    "Real",
    "Boolean",
  ]);
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
    const functionName =
      node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ||
      (node.functionReferenceName ?? "");
    let flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      const flatArg = arg.expression?.accept(this, ctx);
      if (flatArg) flatArgs.push(flatArg);
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

    // Evaluate built-in math/arithmetic functions at flatten time when all args are literals
    const foldedResult = tryFoldBuiltinFunction(functionName, flatArgs);
    if (foldedResult) return foldedResult;
    // Coerce integer literal arguments to Real when any sibling argument is Real-typed
    if (flatArgs.some((a) => isRealTyped(a, ctx.dae))) {
      for (let i = 0; i < flatArgs.length; i++) {
        const coerced = castToReal(flatArgs[i] ?? null);
        if (coerced && coerced !== flatArgs[i]) flatArgs[i] = coerced;
      }
    }
    const result = new ModelicaFunctionCallExpression(functionName, flatArgs);

    // Only inline user-defined function calls when ALL arguments are compile-time constants.
    // Parameters are NOT constants — they can change between simulations.
    if (!hasParameterArg && flatArgs.every((arg) => isLiteral(arg) || arg instanceof ModelicaArray)) {
      const interp = new ModelicaInterpreter(true);
      const evalResult = node.accept(interp, ctx.classInstance);
      if (evalResult) {
        this.#collectFunctionDefinition(functionName, ctx);
        return evalResult;
      }
    }

    // Collect function definition if it's a user-defined function
    this.#collectFunctionDefinition(functionName, ctx);
    return result;
  }

  /** Recursively scan an AST syntax node for function call references and collect their definitions. */
  collectFunctionRefsFromAST(node: ModelicaExpressionSyntaxNode | null | undefined, ctx: FlattenerContext): void {
    if (!node) return;
    if (node instanceof ModelicaFunctionCallSyntaxNode) {
      const funcName =
        node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ||
        (node.functionReferenceName ?? "");
      if (funcName) this.#collectFunctionDefinition(funcName, ctx);
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

  /** Resolve a function name and flatten its definition into ctx.dae.functions. */
  #collectFunctionDefinition(functionName: string, ctx: FlattenerContext): void {
    // Skip built-in functions
    const simpleName = functionName.includes(".") ? (functionName.split(".").pop() ?? functionName) : functionName;
    if (ModelicaSyntaxFlattener.#builtinFunctions.has(simpleName)) return;
    if (ModelicaSyntaxFlattener.#builtinFunctions.has(functionName)) return;
    // Skip if already collected
    if (ctx.dae.functions.some((f) => f.name === functionName)) return;

    // Resolve the function name via the class instance scope
    const parts = functionName.split(".");
    const resolved = ctx.classInstance.resolveName(parts);
    if (!(resolved instanceof ModelicaClassInstance)) return;
    if (resolved.classKind !== ModelicaClassKind.FUNCTION && resolved.classKind !== ModelicaClassKind.OPERATOR_FUNCTION)
      return;

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

    // Flatten algorithm and equation sections (these still use the standard path)

    for (const equationSection of resolved.equationSections) {
      for (const eq of equationSection.equations) {
        eq.accept(new ModelicaSyntaxFlattener(), {
          prefix: "",
          classInstance: resolved,
          dae: fnDae,
          stmtCollector: [],
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

    ctx.dae.functions.push(fnDae);
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
    return elements.length > 0 ? new ModelicaArray([elements.length], elements) : null;
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
    const name =
      (effectivePrefix === "" ? "" : effectivePrefix + ".") +
      node.parts.map((c) => c.identifier?.text ?? "<ERROR>").join(".");
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
        // Build subscript expressions
        const subscripts: ModelicaExpression[] = [];
        let hasSymbolic = false;
        for (const sub of subscriptNodes) {
          if (sub.flexible) {
            subscripts.push(new ModelicaColonExpression());
          } else if (sub.expression) {
            const subExpr = sub.expression.accept(this, ctx);
            // Treat any non-concrete subscript as symbolic (not just bare names).
            // e.g. `a[1+i]` produces a BinaryExpression — still symbolic.
            if (subExpr && !(subExpr instanceof ModelicaIntegerLiteral)) hasSymbolic = true;
            subscripts.push(subExpr ?? new ModelicaNameExpression("?"));
          }
        }
        // Only use symbolic subscript path when subscripts contain unresolvable names
        // (e.g. loop variables like i, j in preserved for-statements). Otherwise resolve concretely.
        if (hasSymbolic) {
          return new ModelicaSubscriptedExpression(new ModelicaNameExpression(name), subscripts);
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
        // Fall back to the interpreter for more complex expressions (e.g. a[end-b[end]])
        const arrayPrefix = baseName + "[";
        const arraySize = ctx.dae.variables.filter((v) => v.name.startsWith(arrayPrefix)).length;
        const interp = new ModelicaInterpreter();
        interp.endValue = arraySize > 0 ? arraySize : null;
        const resolvedIndices: number[] = [];
        for (const sub of subscriptNodes) {
          if (sub.flexible) break;
          if (!sub.expression) break;
          const indexExpr = sub.expression.accept(interp, ctx.classInstance);
          if (indexExpr instanceof ModelicaIntegerLiteral) {
            resolvedIndices.push(indexExpr.value);
          } else {
            break;
          }
        }
        if (resolvedIndices.length === subscriptNodes.length) {
          const indexedName = baseName + "[" + resolvedIndices.join(",") + "]";
          for (const variable of ctx.dae.variables) {
            if (variable.name === indexedName) return variable;
          }
        }
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
    }
    // Fall back to a symbolic name for unresolved references (e.g. loop variables in preserved for-statements)
    // But first check if there's a loop variable binding for equation unrolling
    const simpleName = node.parts.length === 1 ? (node.parts[0]?.identifier?.text ?? null) : null;
    if (simpleName && ctx.loopVariables?.has(simpleName)) {
      const loopVal = ctx.loopVariables.get(simpleName);
      if (loopVal instanceof ModelicaExpression) return loopVal;
      return new ModelicaIntegerLiteral(loopVal ?? 0);
    }
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
      if (isRealTyped(target, ctx.dae)) source = coerceToReal(source, ctx.dae) ?? source;
      ctx.stmtCollector.push(new ModelicaAssignmentStatement(target, source));
    }
    return null;
  }

  visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, ctx: FlattenerContext): null {
    const functionName = node.functionReference?.parts?.map((p) => p.identifier?.text ?? "").join(".") ?? "";
    const flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      const flatArg = arg.expression?.accept(this, ctx);
      if (flatArg) flatArgs.push(flatArg);
    }
    // Coerce integer arguments to Real for built-in functions that expect Real args
    const realArgBuiltins = new Set(["reinit", "assert", "terminate"]);
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
    const innerStatements = this.flattenStatements(node.statements ?? [], ctx);
    let statements = innerStatements;
    for (let i = node.forIndexes.length - 1; i >= 0; i--) {
      const forIndex = node.forIndexes[i];
      if (!forIndex) continue;
      const indexName = forIndex.identifier?.text ?? "?";
      const range = forIndex.expression?.accept(this, ctx);
      if (!range) continue;
      const forStmt = new ModelicaForStatement(indexName, range, statements);
      statements = [forStmt];
    }
    for (const stmt of statements) ctx.stmtCollector.push(stmt);
    return null;
  }

  visitIfStatement(node: ModelicaIfStatementSyntaxNode, ctx: FlattenerContext): null {
    const condition = node.condition?.accept(this, ctx);
    if (!condition) return null;
    const thenStatements = this.flattenStatements(node.statements ?? [], ctx);
    const elseIfClauses: { condition: ModelicaExpression; statements: ModelicaStatement[] }[] = [];
    for (const clause of node.elseIfStatementClauses ?? []) {
      const clauseCondition = clause.condition?.accept(this, ctx);
      if (!clauseCondition) continue;
      const clauseStatements = this.flattenStatements(clause.statements ?? [], ctx);
      elseIfClauses.push({ condition: clauseCondition, statements: clauseStatements });
    }
    const elseStatements = this.flattenStatements(node.elseStatements ?? [], ctx);
    ctx.stmtCollector.push(new ModelicaIfStatement(condition, thenStatements, elseIfClauses, elseStatements));
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
        // Flow variables: a.f + b.f = 0.0
        const lhs = new ModelicaBinaryExpression(
          ModelicaBinaryOperator.ADDITION,
          new ModelicaNameExpression(info1.fullName),
          new ModelicaNameExpression(info2.fullName),
        );
        ctx.dae.equations.push(new ModelicaSimpleEquation(lhs, new ModelicaRealLiteral(0.0)));
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
          subs.push(val?.toString() ?? "");
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
    const args = expression.args.map((a) => castToReal(a) ?? a);
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
  if (expression instanceof ModelicaNameExpression && dae) {
    const variable = dae.variables.find((v) => v.name === expression.name);
    if (variable && !(variable instanceof ModelicaRealVariable)) {
      return new ModelicaFunctionCallExpression("/*Real*/", [expression]);
    }
  }
  // Recurse into binary expressions
  if (expression instanceof ModelicaBinaryExpression) {
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
  }
  if (expr instanceof ModelicaNameExpression && expr.name === "time") return true;
  if (expr instanceof ModelicaSubscriptedExpression) return isRealTyped(expr.base, dae);
  if (expr instanceof ModelicaFunctionCallExpression) {
    return expr.args.some((a) => isRealTyped(a, dae));
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

function canonicalizeBinaryExpression(
  operator: ModelicaBinaryOperator,
  operand1: ModelicaExpression,
  operand2: ModelicaExpression,
  dae?: ModelicaDAE,
): ModelicaExpression {
  // Constant fold string concatenation
  if (
    operator === ModelicaBinaryOperator.ADDITION &&
    operand1 instanceof ModelicaStringLiteral &&
    operand2 instanceof ModelicaStringLiteral
  ) {
    return new ModelicaStringLiteral(operand1.value + operand2.value);
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
      const newElements = operand1.elements.map((e) => canonicalizeBinaryExpression(scalarOp, e, operand2, dae));
      return new ModelicaArray(operand1.shape, newElements);
    }
  } else if (isLiteral(operand1) && operand2 instanceof ModelicaArray) {
    if (scalarOp === "+" || scalarOp === "-" || scalarOp === "*" || scalarOp === "/") {
      const newElements = (operand2 as ModelicaArray).elements.map((e) =>
        canonicalizeBinaryExpression(scalarOp, operand1, e, dae),
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
