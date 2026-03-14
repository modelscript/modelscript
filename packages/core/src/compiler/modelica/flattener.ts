// SPDX-License-Identifier: AGPL-3.0-or-later

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
  ModelicaWhenEquation,
  ModelicaWhenStatement,
  ModelicaWhileStatement,
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
  ModelicaExpressionSyntaxNode,
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
  /** Bindings for for-loop index variables (used during equation unrolling). */
  loopVariables?: Map<string, number>;
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

export class ModelicaFlattener extends ModelicaModelVisitor<[string, ModelicaDAE]> {
  visitArrayClassInstance(node: ModelicaArrayClassInstance, args: [string, ModelicaDAE]): void {
    this.visitClassInstance(node, args);
  }

  visitEntity(node: ModelicaEntity, args: [string, ModelicaDAE]): void {
    this.visitClassInstance(node, args);
  }

  visitClassInstance(node: ModelicaClassInstance, args: [string, ModelicaDAE]): void {
    for (const element of node.elements) {
      if (element instanceof ModelicaComponentInstance) element.accept(this, args);
    }
    for (const declaredElement of node.declaredElements) {
      if (declaredElement instanceof ModelicaExtendsClassInstance) declaredElement.accept(this, args);
    }
    for (const equationSyntaxNode of node.abstractSyntaxNode?.equations ?? []) {
      equationSyntaxNode.accept(new ModelicaSyntaxFlattener(), {
        prefix: args[0],
        classInstance: node,
        dae: args[1],
        stmtCollector: [],
      });
    }
    for (const algorithmSection of node.algorithmSections) {
      const collector: ModelicaStatement[] = [];
      for (const statement of algorithmSection.statements) {
        statement.accept(new ModelicaSyntaxFlattener(), {
          prefix: args[0],
          classInstance: node,
          dae: args[1],
          stmtCollector: collector,
        });
      }
      if (collector.length > 0) {
        args[1].algorithms.push(collector);
      }
    }
  }

  visitComponentInstance(node: ModelicaComponentInstance, args: [string, ModelicaDAE]): void {
    const name = args[0] === "" ? (node.name ?? "?") : args[0] + "." + node.name;
    const { causality, isFinal, isProtected } = node;

    if (node.classInstance instanceof ModelicaPredefinedClassInstance) {
      const attributes = new Map(
        node.modification?.modificationArguments.flatMap((m) => {
          if (m.name === "annotation") return [];
          return m.name && m.expression ? [[m.name, m.expression]] : [];
        }),
      );
      const isCompileTimeEvaluable =
        node.variability === ModelicaVariability.PARAMETER || node.variability === ModelicaVariability.CONSTANT;
      const expression = isCompileTimeEvaluable
        ? (node.modification?.evaluatedExpression ?? null)
        : (node.modification?.expression ?? null);
      let variable;
      const varExpression = expression;

      if (node.classInstance instanceof ModelicaBooleanClassInstance) {
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
      } else if (node.classInstance instanceof ModelicaIntegerClassInstance) {
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
          node.variability,
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
          node.variability,
          node.modification?.description ?? node.description,
          causality,
          isFinal,
        );
      }
      if (variable) {
        args[1].variables.push(variable);
      }
    } else if (node.classInstance instanceof ModelicaEnumerationClassInstance) {
      const attributes = new Map(
        node.modification?.modificationArguments.flatMap((m) =>
          m.name && m.expression ? [[m.name, m.expression]] : [],
        ),
      );
      const expression = node.modification?.expression ?? null;
      const varExpression = expression;
      const variable = new ModelicaEnumerationVariable(
        name,
        varExpression,
        attributes,
        node.variability,
        node.modification?.description ?? node.description,
        node.classInstance.enumerationLiterals,
        causality,
        isFinal,
        isProtected,
      );
      args[1].variables.push(variable);
    } else if (node.classInstance instanceof ModelicaArrayClassInstance) {
      // Capture the array-level binding expression BEFORE iterating elements.
      const arrayBindingExpression = node.modification?.expression ?? null;

      // For parameter/constant variables, split the binding into per-element values.
      const isCompileTimeEvaluable =
        node.variability === ModelicaVariability.PARAMETER || node.variability === ModelicaVariability.CONSTANT;
      const flatBindingElements =
        isCompileTimeEvaluable && arrayBindingExpression instanceof ModelicaArray
          ? [...arrayBindingExpression.flatElements]
          : null;

      const shape = node.classInstance.shape;
      const index = new Array(shape.length).fill(1);
      let elementIndex = 0;
      for (const declaredElement of node.classInstance.declaredElements) {
        const elementName = name + "[" + index.join(",") + "]";
        if (
          declaredElement instanceof ModelicaPredefinedClassInstance ||
          declaredElement instanceof ModelicaEnumerationClassInstance
        ) {
          const attributes = new Map(
            declaredElement.modification?.modificationArguments.flatMap((m) =>
              m.name && m.expression ? [[m.name, m.expression]] : [],
            ),
          );
          // For parameter arrays with a binding, use the split element value.
          // For non-parameter arrays with a binding, suppress inline (emit equation later).
          // Otherwise use the element's own modification expression.
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
            );
          }
          if (variable) {
            args[1].variables.push(variable);
          }
        } else {
          declaredElement?.accept(this, [elementName, args[1]]);
        }
        elementIndex++;
        if (!this.incrementIndex(index, shape)) break;
      }

      // For non-parameter arrays, emit the array-level binding as a separate equation
      // Skip if the outermost dimension is 0 (completely empty array)
      if (arrayBindingExpression && !flatBindingElements && (shape[0] ?? 0) > 0) {
        // Cast integer literals to Real when the element type is Real
        const firstElement = node.classInstance.declaredElements[0];
        const isRealArray =
          firstElement instanceof ModelicaRealClassInstance ||
          (firstElement instanceof ModelicaArrayClassInstance &&
            firstElement.elementClassInstance instanceof ModelicaRealClassInstance);
        const rhs = isRealArray
          ? (castToReal(arrayBindingExpression) ?? arrayBindingExpression)
          : arrayBindingExpression;
        // Use a RealVariable as a lightweight name-reference for the LHS.
        const lhs = new ModelicaRealVariable(name, null, new Map(), null);
        args[1].equations.push(new ModelicaSimpleEquation(lhs, rhs));
      }
    } else {
      node.classInstance?.accept(this, [name, args[1]]);
    }
  }

  visitExtendsClassInstance(node: ModelicaExtendsClassInstance, args: [string, ModelicaDAE]): void {
    if (!node.classInstance) return;
    for (const declaredElement of node.classInstance.declaredElements ?? []) {
      if (declaredElement instanceof ModelicaExtendsClassInstance) declaredElement.accept(this, args);
    }
    for (const equationSyntaxNode of node.classInstance.abstractSyntaxNode?.equations ?? []) {
      equationSyntaxNode.accept(new ModelicaSyntaxFlattener(), {
        prefix: args[0],
        classInstance: node.classInstance,
        dae: args[1],
        stmtCollector: [],
      });
    }
  }

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

class ModelicaSyntaxFlattener extends ModelicaSyntaxVisitor<ModelicaExpression, FlattenerContext> {
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
    const flatArgs: ModelicaExpression[] = [];
    for (const arg of node.functionCallArguments?.arguments ?? []) {
      const flatArg = arg.expression?.accept(this, ctx);
      if (flatArg) flatArgs.push(flatArg);
    }
    // Evaluate built-in array constructors at flatten time
    if (functionName === "fill" && flatArgs.length >= 2) {
      const shape = extractShape(flatArgs.slice(1));
      if (shape && flatArgs[0]) return buildFilledArray(shape, flatArgs[0]);
    }
    if (functionName === "zeros" && flatArgs.length >= 1) {
      const shape = extractShape(flatArgs);
      if (shape) return buildFilledArray(shape, new ModelicaIntegerLiteral(0));
    }
    if (functionName === "ones" && flatArgs.length >= 1) {
      const shape = extractShape(flatArgs);
      if (shape) return buildFilledArray(shape, new ModelicaIntegerLiteral(1));
    }
    const result = new ModelicaFunctionCallExpression(functionName, flatArgs);
    // Collect function definition if it's a user-defined function
    this.#collectFunctionDefinition(functionName, ctx);
    return result;
  }

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

    // Flatten the function's elements, equations, and algorithm sections
    const flattener = new ModelicaFlattener();
    flattener.visitClassInstance(resolved, ["", fnDae]);

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
          for (const expr of call.arguments?.expressions ?? []) {
            // External function arguments are typically simple identifiers
            argNames.push(String(expr));
          }
          const returnVar = call.output?.parts?.map((p) => p.identifier?.text ?? "").join(".") ?? "";
          if (returnVar) {
            declText += ` ${returnVar} = ${callName}(${argNames.join(", ")})`;
          } else if (callName) {
            declText += ` ${callName}(${argNames.join(", ")})`;
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
    const name =
      (ctx.prefix === "" ? "" : ctx.prefix + ".") + node.parts.map((c) => c.identifier?.text ?? "<ERROR>").join(".");
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
          (ctx.prefix === "" ? "" : ctx.prefix + ".") + node.parts.map((c) => c.identifier?.text ?? "").join(".");
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
      return new ModelicaIntegerLiteral(ctx.loopVariables.get(simpleName) ?? 0);
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
      if (isRealTyped(target, ctx.dae)) source = castToReal(source) ?? source;
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
      if (isRealTyped(expression1, ctx.dae)) expression2 = castToReal(expression2) ?? expression2;
      if (isRealTyped(expression2, ctx.dae)) expression1 = castToReal(expression1) ?? expression1;
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
    if (operator && operand) return new ModelicaUnaryExpression(operator, operand);
    return null;
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

function isRealTyped(expr: ModelicaExpression, dae?: ModelicaDAE): boolean {
  if (expr instanceof ModelicaRealVariable) return true;
  if (expr instanceof ModelicaRealLiteral) return true;
  if (expr instanceof ModelicaBinaryExpression)
    return isRealTyped(expr.operand1, dae) || isRealTyped(expr.operand2, dae);
  if (expr instanceof ModelicaUnaryExpression) return isRealTyped(expr.operand, dae);
  if (expr instanceof ModelicaNameExpression && dae) {
    const v = dae.variables.find((variable) => variable.name === expr.name);
    if (v instanceof ModelicaRealVariable) return true;
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
    expr instanceof ModelicaStringLiteral
  );
}

function canonicalizeBinaryExpression(
  operator: ModelicaBinaryOperator,
  operand1: ModelicaExpression,
  operand2: ModelicaExpression,
  dae?: ModelicaDAE,
): ModelicaExpression {
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
  if (operator === ModelicaBinaryOperator.SUBTRACTION && dae) {
    const op2 = wrapIntegerAsReal(operand2, dae);
    if (op2 !== operand2) {
      return new ModelicaBinaryExpression(operator, operand1, op2);
    }
  }
  if (
    (operator === ModelicaBinaryOperator.ADDITION || operator === ModelicaBinaryOperator.MULTIPLICATION) &&
    !isLiteral(operand1) &&
    isLiteral(operand2)
  ) {
    return new ModelicaBinaryExpression(operator, operand2, operand1);
  }

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
