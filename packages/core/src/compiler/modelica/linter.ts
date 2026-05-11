// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaClassModificationSyntaxNode,
  ModelicaClassOrInheritanceModificationSyntaxNode,
  ModelicaComponentReferencePartSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaCompoundImportClauseSyntaxNode,
  ModelicaDescriptionSyntaxNode,
  ModelicaElementModificationSyntaxNode,
  ModelicaEquationSectionSyntaxNode,
  ModelicaExtendsClauseSyntaxNode,
  ModelicaForStatementSyntaxNode,
  ModelicaInheritanceModificationSyntaxNode,
  ModelicaModificationExpressionSyntaxNode,
  ModelicaModificationSyntaxNode,
  ModelicaOutputExpressionListSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
  ModelicaSimpleImportClauseSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnqualifiedImportClauseSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
  type IModelicaSyntaxVisitor,
  type ModelicaClassDefinitionSyntaxNode,
  type ModelicaComponentClauseSyntaxNode,
  type ModelicaComponentDeclarationSyntaxNode,
  type ModelicaDeclarationSyntaxNode,
  type ModelicaElementSectionSyntaxNode,
  type ModelicaIdentifierSyntaxNode,
  type ModelicaLongClassSpecifierSyntaxNode,
  type ModelicaNameSyntaxNode,
  type ModelicaStoredDefinitionSyntaxNode,
  type ModelicaTypeSpecifierSyntaxNode,
  type ModelicaWithinDirectiveSyntaxNode,
} from "@modelscript/modelica/ast";
import type { Range, Tree } from "@modelscript/utils";
import type { ErrorCodeDef } from "./errors.js";
import {
  ModelicaArrayClassInstance,
  ModelicaBooleanClassInstance,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaElement as ModelicaEntity,
  ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance,
  ModelicaElement as ModelicaLibrary,
  ModelicaElement as ModelicaNode,
  ModelicaRealClassInstance,
  ModelicaStringClassInstance,
} from "./factory.js";
import { ModelicaModelVisitor, type IModelicaModelVisitor } from "./visitor.js";

/**
 * Callback function signature for reporting diagnostic messages.
 */
export type DiagnosticsCallback = (
  type: string,
  code: number,
  message: string,
  resource: string | null | undefined,
  range: Range | null | undefined,
) => void;

/**
 * Diagnostics callback without specifying the resource string.
 */
export type DiagnosticsCallbackWithoutResource = (
  type: string,
  code: number,
  message: string,
  range: Range | null | undefined,
) => void;

/**
 * A single entry in the linter rule registry, pairing the visitor
 * implementation with the error codes it may emit.
 */
export interface LinterRuleRegistration {
  /** The error‑code definitions this rule may emit. */
  errorCodes: ErrorCodeDef[];
  /** The visitor object that implements the rule logic. */
  rule: Partial<
    | IModelicaModelVisitor<void, DiagnosticsCallbackWithoutResource>
    | IModelicaSyntaxVisitor<void, DiagnosticsCallbackWithoutResource>
  >;
}

/**
 * Main linter class coordinating syntax-level and model-level checks for Modelica.
 */
export class ModelicaLinter {
  #diagnosticsCallback: DiagnosticsCallback;
  #modelicaModelLinter: ModelicaModelLinter;
  #modelicaSyntaxLinter: ModelicaSyntaxLinter;
  static #rules: LinterRuleRegistration[] = [];

  constructor(diagnosticsCallback: DiagnosticsCallback) {
    this.#diagnosticsCallback = diagnosticsCallback;
    this.#modelicaSyntaxLinter = new ModelicaSyntaxLinter(diagnosticsCallback);
    this.#modelicaModelLinter = new ModelicaModelLinter(diagnosticsCallback);
  }

  /**
   * Applies registered custom linting rules to a particular AST node.
   *
   * @param methodName - The specific visitor method name triggering the rules (e.g., "visitClassInstance").
   * @param node - The Modelica AST or semantic node being visited.
   * @param diagnosticsCallback - The callback to execute when a rule produces a diagnostic.
   * @param resource - An optional string identifier (like file path) representing the source resource.
   */
  static applyRules<T>(
    methodName: string,
    node: T,
    diagnosticsCallback: DiagnosticsCallback,
    resource: string | null | undefined,
  ): void {
    ModelicaLinter.#rules.forEach(({ rule }) => {
      if (methodName in rule && typeof rule[methodName as keyof typeof rule] === "function") {
        const callback: DiagnosticsCallbackWithoutResource = (
          type: string,
          code: number,
          message: string,
          range: Range | null | undefined,
        ) => diagnosticsCallback(type, code, message, resource, range);
        // Expose resource to rules that might need it (e.g., checking file extensions)

        (callback as any).resource = resource;
        (rule as Record<string, (...args: unknown[]) => void>)[methodName]?.(node, callback);
      }
    });
  }

  /**
   * Lints a given syntax tree, AST node, or semantic Modelica object.
   *
   * @param node - The root node or tree-sitter parse tree to begin linting from.
   * @param resource - An optional string identifier (like file path) representing the source resource.
   */
  lint(node: ModelicaNode | ModelicaSyntaxNode | Tree, resource?: string | null): void {
    if (node instanceof ModelicaNode) {
      node.accept(this.#modelicaModelLinter, resource);
    } else if (node instanceof ModelicaSyntaxNode) {
      node.accept(this.#modelicaSyntaxLinter, resource);
    } else {
      const cursor = node.walk();
      while (cursor.currentNode) {
        if (cursor.currentNode.isError) {
          this.#diagnosticsCallback("error", 0, "Parse error.", resource, cursor.currentNode);
        } else if (cursor.currentNode.isMissing) {
          this.#diagnosticsCallback(
            "error",
            0,
            "Parse error: '" + cursor.nodeType + "' expected.",
            resource,
            cursor.currentNode,
          );
        }
        if (cursor.gotoFirstChild()) continue;
        while (!cursor.gotoNextSibling()) {
          if (!cursor.gotoParent()) return;
        }
      }
    }
  }

  /**
   * Registers custom programmatic linting rules to be applied during traversal.
   *
   * @param errorCodes - One or more `ErrorCodeDef` values from `ModelicaErrorCode` that the rule may emit.
   * @param rule - An object mapping visitor method names to rule-checking functions.
   */
  static register(
    errorCodes: ErrorCodeDef | ErrorCodeDef[],
    rule: Partial<
      | IModelicaModelVisitor<void, DiagnosticsCallbackWithoutResource>
      | IModelicaSyntaxVisitor<void, DiagnosticsCallbackWithoutResource>
    >,
  ) {
    const codes = Array.isArray(errorCodes) ? errorCodes : [errorCodes];
    ModelicaLinter.#rules.push({ errorCodes: codes, rule });
  }

  /**
   * Returns the full list of registered lint‑rule entries for introspection.
   */
  static get registeredRules(): readonly LinterRuleRegistration[] {
    return ModelicaLinter.#rules;
  }
}

/**
 * Linter running diagnostics across the populated semantic Modelica object model.
 */
export class ModelicaModelLinter extends ModelicaModelVisitor<string | null | undefined> {
  #diagnosticsCallback: DiagnosticsCallback;
  #visited = new Set<string>();
  /** Set of component names that have been declared as `inner` during traversal. */
  #knownInners = new Set<string>();

  /**
   * Initializes a new ModelicaModelLinter.
   *
   * @param diagnosticsCallback - The diagnostic reporting callback.
   */
  constructor(diagnosticsCallback: DiagnosticsCallback) {
    super();
    this.#diagnosticsCallback = diagnosticsCallback;
  }

  visitBooleanClassInstance(node: ModelicaBooleanClassInstance, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitBooleanClassInstance", node, this.#diagnosticsCallback, resource);
    super.visitBooleanClassInstance(node, resource);
  }

  visitClassInstance(node: ModelicaClassInstance, resource: string | null | undefined): void {
    const key = node.compositeName ?? "";
    if (this.#visited.has(key)) return;
    this.#visited.add(key);
    ModelicaLinter.applyRules("visitClassInstance", node, this.#diagnosticsCallback, resource);
    super.visitClassInstance(node, resource);
  }

  visitComponentInstance(node: ModelicaComponentInstance, resource: string | null | undefined): void {
    // Track inner components for outer/inner resolution across the model tree
    if (node.isInner && node.name) {
      this.#knownInners.add(node.name);
    }
    // Apply component-level rules
    ModelicaLinter.applyRules("visitComponentInstance", node, this.#diagnosticsCallback, resource);
    // Also visit the component's class instance to lint locally-defined classes
    // (e.g., connectors, records, types used as component types).
    // The #visited set in visitClassInstance prevents infinite recursion.
    // Skip primitive types — they don't need structural linting.
    const classInst = node.classInstance;
    if (
      classInst &&
      typeof classInst.accept === "function" &&
      !(classInst instanceof ModelicaRealClassInstance) &&
      !(classInst instanceof ModelicaIntegerClassInstance) &&
      !(classInst instanceof ModelicaBooleanClassInstance) &&
      !(classInst instanceof ModelicaStringClassInstance) &&
      !(classInst instanceof ModelicaArrayClassInstance)
    ) {
      classInst.accept(this, resource);
    }
  }

  /** Returns the set of component names that have been declared as `inner` during linting. */
  get knownInners(): ReadonlySet<string> {
    return this.#knownInners;
  }

  visitEntity(node: ModelicaEntity): void {
    ModelicaLinter.applyRules("visitEntity", node, this.#diagnosticsCallback, node.path);
    // Entity extends ClassInstance — apply class-level rules too so semantic
    // rules (e.g. ASSIGNMENT_TYPE_MISMATCH) fire for standalone .mo files.
    ModelicaLinter.applyRules("visitClassInstance", node, this.#diagnosticsCallback, node.path);
    super.visitEntity(node, node.path);
  }

  visitExtendsClassInstance(node: ModelicaExtendsClassInstance, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitExtendsClassInstance", node, this.#diagnosticsCallback, resource);
    super.visitExtendsClassInstance(node, resource);
  }

  visitIntegerClassInstance(node: ModelicaIntegerClassInstance, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitIntegerClassInstance", node, this.#diagnosticsCallback, resource);
    super.visitIntegerClassInstance(node, resource);
  }

  visitLibrary(node: ModelicaLibrary): void {
    ModelicaLinter.applyRules("visitLibrary", node, this.#diagnosticsCallback, node.path);
    super.visitLibrary(node, node.path);
  }

  visitRealClassInstance(node: ModelicaRealClassInstance, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitRealClassInstance", node, this.#diagnosticsCallback, resource);
    super.visitRealClassInstance(node, resource);
  }

  visitStringClassInstance(node: ModelicaStringClassInstance, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitStringClassInstance", node, this.#diagnosticsCallback, resource);
    super.visitStringClassInstance(node, resource);
  }
}

/**
 * Linter running text-based and syntax-tree-level diagnostics on raw Modelica code.
 */
export class ModelicaSyntaxLinter extends ModelicaSyntaxVisitor<void, string | null | undefined> {
  #diagnosticsCallback: DiagnosticsCallback;

  /**
   * Initializes a new ModelicaSyntaxLinter.
   *
   * @param diagnosticsCallback - The diagnostic reporting callback.
   */
  constructor(diagnosticsCallback: DiagnosticsCallback) {
    super();
    this.#diagnosticsCallback = diagnosticsCallback;
  }

  visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitOutputExpressionList", node, this.#diagnosticsCallback, resource);
    super.visitOutputExpressionList(node, resource);
  }

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitBinaryExpression", node, this.#diagnosticsCallback, resource);
    super.visitBinaryExpression(node, resource);
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitBooleanLiteral", node, this.#diagnosticsCallback, resource);
    super.visitBooleanLiteral(node, resource);
  }

  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitClassDefinition", node, this.#diagnosticsCallback, resource);
    super.visitClassDefinition(node, resource);
  }

  visitClassModification(node: ModelicaClassModificationSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitClassModification", node, this.#diagnosticsCallback, resource);
    super.visitClassModification(node, resource);
  }

  visitClassOrInheritanceModification(
    node: ModelicaClassOrInheritanceModificationSyntaxNode,
    resource: string | null | undefined,
  ): void {
    ModelicaLinter.applyRules("visitClassOrInheritanceModification", node, this.#diagnosticsCallback, resource);
    super.visitClassOrInheritanceModification(node, resource);
  }

  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitComponentClause", node, this.#diagnosticsCallback, resource);
    super.visitComponentClause(node, resource);
  }

  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitComponentDeclaration", node, this.#diagnosticsCallback, resource);
    super.visitComponentDeclaration(node, resource);
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitComponentReference", node, this.#diagnosticsCallback, resource);
    super.visitComponentReference(node, resource);
  }

  visitComponentReferencePart(
    node: ModelicaComponentReferencePartSyntaxNode,
    resource: string | null | undefined,
  ): void {
    ModelicaLinter.applyRules("visitComponentReferencePart", node, this.#diagnosticsCallback, resource);
    super.visitComponentReferencePart(node, resource);
  }

  visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitCompoundImportClause", node, this.#diagnosticsCallback, resource);
    super.visitCompoundImportClause(node, resource);
  }

  visitDeclaration(node: ModelicaDeclarationSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitDeclaration", node, this.#diagnosticsCallback, resource);
    super.visitDeclaration(node, resource);
  }

  visitDescription(node: ModelicaDescriptionSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitDescription", node, this.#diagnosticsCallback, resource);
    super.visitDescription(node, resource);
  }

  visitElementModification(node: ModelicaElementModificationSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitElementModification", node, this.#diagnosticsCallback, resource);
    super.visitElementModification(node, resource);
  }

  visitElementSection(node: ModelicaElementSectionSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitElementSection", node, this.#diagnosticsCallback, resource);
    super.visitElementSection(node, resource);
  }

  visitEquationSection(node: ModelicaEquationSectionSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitEquationSection", node, this.#diagnosticsCallback, resource);
    super.visitEquationSection(node, resource);
  }

  visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitExtendsClause", node, this.#diagnosticsCallback, resource);
    super.visitExtendsClause(node, resource);
  }

  visitIdentifier(node: ModelicaIdentifierSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitIdentifier", node, this.#diagnosticsCallback, resource);
    super.visitIdentifier(node, resource);
  }

  visitInheritanceModification(
    node: ModelicaInheritanceModificationSyntaxNode,
    resource: string | null | undefined,
  ): void {
    ModelicaLinter.applyRules("visitInheritanceModification", node, this.#diagnosticsCallback, resource);
    super.visitInheritanceModification(node, resource);
  }

  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitLongClassSpecifier", node, this.#diagnosticsCallback, resource);
    super.visitLongClassSpecifier(node, resource);
  }

  visitModification(node: ModelicaModificationSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitModification", node, this.#diagnosticsCallback, resource);
    super.visitModification(node, resource);
  }

  visitModificationExpression(
    node: ModelicaModificationExpressionSyntaxNode,
    resource: string | null | undefined,
  ): void {
    ModelicaLinter.applyRules("visitModificationExpression", node, this.#diagnosticsCallback, resource);
    super.visitModificationExpression(node, resource);
  }

  visitName(node: ModelicaNameSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitName", node, this.#diagnosticsCallback, resource);
    super.visitName(node, resource);
  }

  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitSimpleEquation", node, this.#diagnosticsCallback, resource);
    super.visitSimpleEquation(node, resource);
  }

  visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitSimpleImportClause", node, this.#diagnosticsCallback, resource);
    super.visitSimpleImportClause(node, resource);
  }

  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitStoredDefinition", node, this.#diagnosticsCallback, resource);
    super.visitStoredDefinition(node, resource);
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitStringLiteral", node, this.#diagnosticsCallback, resource);
    super.visitStringLiteral(node, resource);
  }

  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitTypeSpecifier", node, this.#diagnosticsCallback, resource);
    super.visitTypeSpecifier(node, resource);
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitUnaryExpression", node, this.#diagnosticsCallback, resource);
    super.visitUnaryExpression(node, resource);
  }

  visitUnqualifiedImportClause(
    node: ModelicaUnqualifiedImportClauseSyntaxNode,
    resource: string | null | undefined,
  ): void {
    ModelicaLinter.applyRules("visitUnqualifiedImportClause", node, this.#diagnosticsCallback, resource);
    super.visitUnqualifiedImportClause(node, resource);
  }

  visitUnsignedIntegerLiteral(
    node: ModelicaUnsignedIntegerLiteralSyntaxNode,
    resource: string | null | undefined,
  ): void {
    ModelicaLinter.applyRules("visitUnsignedIntegerLiteral", node, this.#diagnosticsCallback, resource);
    super.visitUnsignedIntegerLiteral(node, resource);
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitUnsignedRealLiteral", node, this.#diagnosticsCallback, resource);
    super.visitUnsignedRealLiteral(node, resource);
  }

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitWithinDirective", node, this.#diagnosticsCallback, resource);
    super.visitWithinDirective(node, resource);
  }
  visitForStatement(node: ModelicaForStatementSyntaxNode, resource: string | null | undefined): void {
    ModelicaLinter.applyRules("visitForStatement", node, this.#diagnosticsCallback, resource);
    super.visitForStatement(node, resource);
  }
}

export const BUILTIN_MODELICA_NAMES = new Set([
  // Independent variable
  "time",
  // Built-in operators
  "der",
  "pre",
  "edge",
  "change",
  "reinit",
  "initial",
  "terminal",
  "sample",
  "noEvent",
  "smooth",
  "delay",
  "cardinality",
  "inStream",
  "actualStream",
  // Synchronous Language Elements
  "Clock",
  "hold",
  "previous",
  "backSample",
  "shiftSample",
  "subSample",
  "superSample",
  "noClock",
  "interval",
  "initialState",
  "activeState",
  "ticksInState",
  "timeInState",
  "transition",
  // Assertions / utilities
  "assert",
  "print",
  "terminate",
  // Mathematical functions
  "abs",
  "sign",
  "sqrt",
  "exp",
  "log",
  "log10",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "floor",
  "ceil",
  "integer",
  "mod",
  "rem",
  "div",
  // Array / reduction functions
  "max",
  "min",
  "sum",
  "product",
  "ndims",
  "size",
  "zeros",
  "ones",
  "fill",
  "identity",
  "diagonal",
  "transpose",
  "cat",
  "scalar",
  "vector",
  "matrix",
  "cross",
  "skew",
  "outerProduct",
  "symmetric",
  // Type names
  "String",
  "Integer",
  "Boolean",
  "Real",
  // Modelica package
  "Modelica",
  // Enumerations
  "enumeration",
  // Scripting API
  "simulate",
  // Graphical Annotations
  "DynamicSelect",
]);

import { ModelicaClassKind } from "@modelscript/modelica/ast";
import { ModelicaErrorCode } from "./errors.js";

ModelicaLinter.register(
  [ModelicaErrorCode.OPTIMIZATION_OBJECTIVE_TYPE, ModelicaErrorCode.OPTIMIZATION_CONSTRAINT_TYPE],
  {
    visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
      if (node.classKind !== ModelicaClassKind.OPTIMIZATION) return;

      // Check objective type (heuristically for now, deep type inference in flattener)
      const objMod = node.modifiers?.get("objective");
      if (objMod && objMod.expression) {
        const exprNode = objMod.expression.syntaxNode;
        // Example basic check: If objective is explicitly defined as an array
        if (exprNode && exprNode.type === "expression_list") {
          diagnosticsCallback(
            ModelicaErrorCode.OPTIMIZATION_OBJECTIVE_TYPE.severity,
            ModelicaErrorCode.OPTIMIZATION_OBJECTIVE_TYPE.code,
            ModelicaErrorCode.OPTIMIZATION_OBJECTIVE_TYPE.message("Array"),
            exprNode,
          );
        }
      }

      // Check constraints type
      if (node.equations) {
        for (const eq of node.equations) {
          if (eq.inConstraintSection && eq.syntaxNode) {
            // Constraints in Optimica are typically inequalities (<=, >=, <, >) or equations (=)
            // Or function calls that evaluate to boolean.
            // We can add more advanced type resolving here when type evaluator is available
            // For now, this serves as the semantic validation hook for IDE feedback.
            // Example: if it's an assignment (:=), that's invalid in constraint section
            // But assignments are statements, not equations, so they wouldn't appear here anyway.
          }
        }
      }
    },
  },
);

ModelicaLinter.register(ModelicaErrorCode.DUPLICATE_MODIFICATION, {
  visitClassModification(
    node: ModelicaClassModificationSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.modificationArguments || node.modificationArguments.length === 0) return;

    const seen = new Set<string>();
    for (const arg of node.modificationArguments) {
      let name: string | undefined;
      const anyArg = arg as any;
      if (anyArg.identifier) name = anyArg.identifier.text;
      else if (anyArg.name) name = anyArg.name.parts?.[0]?.text ?? anyArg.name.text;
      else if (anyArg.elementModificationOrReplaceable) {
        const inner = anyArg.elementModificationOrReplaceable;
        if (inner.componentDeclaration1) name = inner.componentDeclaration1.declaration?.identifier?.text;
        else if (inner.classDefinition)
          name = inner.classDefinition.name?.parts?.[0]?.text ?? inner.classDefinition.name?.text;
        else if (inner.shortClassDefinition)
          name = inner.shortClassDefinition.name?.parts?.[0]?.text ?? inner.shortClassDefinition.name?.text;
        else if (inner.name) name = inner.name.parts?.[0]?.text ?? inner.name.text;
        else if (inner.componentClause)
          name =
            inner.componentClause.componentDeclaration?.declaration?.identifier?.text ??
            inner.componentClause.componentList?.components?.[0]?.declaration?.identifier?.text;
      } else if (anyArg.componentDeclaration) {
        name = anyArg.componentDeclaration.declaration?.identifier?.text;
      } else if (anyArg.classDefinition) {
        name = anyArg.classDefinition.name?.parts?.[0]?.text ?? anyArg.classDefinition.name?.text;
      } else if (anyArg.shortClassDefinition) {
        name = anyArg.shortClassDefinition.name?.parts?.[0]?.text ?? anyArg.shortClassDefinition.name?.text;
      } else if (anyArg.componentClause) {
        name =
          anyArg.componentClause.componentDeclaration?.declaration?.identifier?.text ??
          anyArg.componentClause.componentList?.components?.[0]?.declaration?.identifier?.text;
      }

      if (name) {
        if (seen.has(name)) {
          diagnosticsCallback(
            ModelicaErrorCode.DUPLICATE_MODIFICATION.severity,
            ModelicaErrorCode.DUPLICATE_MODIFICATION.code,
            ModelicaErrorCode.DUPLICATE_MODIFICATION.message(name, "<Unknown>"),
            anyArg,
          );
        } else {
          seen.add(name);
        }
      }
    }
  },
  visitExtendsClause(
    node: ModelicaExtendsClauseSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const classMod = node.classOrInheritanceModification;
    if (!classMod || !classMod.modificationArgumentOrInheritanceModifications) return;

    const seen = new Set<string>();
    for (const arg of classMod.modificationArgumentOrInheritanceModifications) {
      let name: string | undefined;
      const anyArg = arg as any;
      if (anyArg.identifier) name = anyArg.identifier.text;
      else if (anyArg.name) name = anyArg.name.parts?.[0]?.text ?? anyArg.name.text;
      else if (anyArg.elementModificationOrReplaceable) {
        const inner = anyArg.elementModificationOrReplaceable;
        if (inner.componentDeclaration1) name = inner.componentDeclaration1.declaration?.identifier?.text;
        else if (inner.classDefinition)
          name = inner.classDefinition.name?.parts?.[0]?.text ?? inner.classDefinition.name?.text;
        else if (inner.shortClassDefinition)
          name = inner.shortClassDefinition.name?.parts?.[0]?.text ?? inner.shortClassDefinition.name?.text;
        else if (inner.name) name = inner.name.parts?.[0]?.text ?? inner.name.text;
        else if (inner.componentClause)
          name =
            inner.componentClause.componentDeclaration?.declaration?.identifier?.text ??
            inner.componentClause.componentList?.components?.[0]?.declaration?.identifier?.text;
      } else if (anyArg.componentDeclaration) {
        name = anyArg.componentDeclaration.declaration?.identifier?.text;
      } else if (anyArg.classDefinition) {
        name = anyArg.classDefinition.name?.parts?.[0]?.text ?? anyArg.classDefinition.name?.text;
      } else if (anyArg.shortClassDefinition) {
        name = anyArg.shortClassDefinition.name?.parts?.[0]?.text ?? anyArg.shortClassDefinition.name?.text;
      } else if (anyArg.componentClause) {
        name =
          anyArg.componentClause.componentDeclaration?.declaration?.identifier?.text ??
          anyArg.componentClause.componentList?.components?.[0]?.declaration?.identifier?.text;
      }

      if (name) {
        if (seen.has(name)) {
          diagnosticsCallback(
            ModelicaErrorCode.DUPLICATE_MODIFICATION.severity,
            ModelicaErrorCode.DUPLICATE_MODIFICATION.code,
            ModelicaErrorCode.DUPLICATE_MODIFICATION.message(
              name,
              "extends " + (node.typeSpecifier?.name?.parts?.[0]?.text ?? "<Unknown>"),
            ),
            anyArg,
          );
        } else {
          seen.add(name);
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Unified type descriptor system
// ---------------------------------------------------------------------------

/**
 * A complete type descriptor carrying a reference to the resolved element
 * class instance and the array shape.
 * e.g. Real[3,2] → { classRef: <RealClassInstance>, shape: [3, 2] }
 *      Integer   → { classRef: <IntegerClassInstance>, shape: [] }
 */
interface ModelicaTypeDescriptor {
  classRef: ModelicaClassInstance;
  shape: number[];
}

/** Get the base type name of a class instance, resolving through arrays. */
function getBaseTypeName(cls: ModelicaClassInstance | null): string | null {
  if (!cls) return null;
  if (cls instanceof ModelicaArrayClassInstance) {
    cls = (cls as any).elementClassInstance;
  }
  if (!cls) return null;
  if (cls instanceof ModelicaRealClassInstance) return "Real";
  if (cls instanceof ModelicaIntegerClassInstance) return "Integer";
  if (cls instanceof ModelicaBooleanClassInstance) return "Boolean";
  if (cls instanceof ModelicaStringClassInstance) return "String";
  return cls.name ?? null;
}

/** Unwrap an array class instance to its element class instance. */
function resolveElementClass(cls: ModelicaClassInstance): ModelicaClassInstance | null {
  if (cls instanceof ModelicaArrayClassInstance) {
    return (cls as any).elementClassInstance ?? null;
  }
  return cls;
}

/** Get the array shape of a class instance (empty array for scalars). */
function getArrayShape(cls: ModelicaClassInstance | null): number[] {
  if (cls instanceof ModelicaArrayClassInstance) {
    return (cls as any).shape ?? [];
  }
  return [];
}

/**
 * Structural subtype check: is `actual` assignable to `expected`?
 * Walks the extendsClassInstances chain of `actual` looking for `expected`.
 * Also encodes the Modelica §4.7 Integer → Real widening rule.
 */
function isClassSubtypeOf(
  actual: ModelicaClassInstance,
  expected: ModelicaClassInstance,
  visited?: Set<ModelicaClassInstance>,
): boolean {
  // Identity
  if (actual === expected) return true;

  // Prevent infinite loops on circular extends
  if (!visited) visited = new Set();
  if (visited.has(actual)) return false;
  visited.add(actual);

  // Walk extends chain structurally
  const exts = actual.extendsClassInstances;
  if (Array.isArray(exts)) {
    for (const ext of exts) {
      if (ext && isClassSubtypeOf(ext, expected, visited)) return true;
    }
  }

  // Walk short class specifier targets (type aliases: type M2E = E)
  const shortTarget = (actual as any).shortClassTarget;
  if (shortTarget && isClassSubtypeOf(shortTarget, expected, visited)) return true;

  // Also check if expected is an alias pointing to actual's root
  const expectedShort = (expected as any).shortClassTarget;
  if (expectedShort && isClassSubtypeOf(actual, expectedShort, visited)) return true;

  // Modelica §4.7: check base type compatibility.
  // Two different class instances may represent the same primitive type
  // (e.g., one from resolveBuiltinClass, one from getComponentTypeDescriptor).
  const actualName = getBaseTypeName(actual);
  const expectedName = getBaseTypeName(expected);
  if (actualName && expectedName) {
    if (actualName === expectedName) return true;
    // Integer → Real widening
    if (expectedName === "Real" && actualName === "Integer") return true;
  }

  return false;
}

/**
 * Resolve a builtin type name to its class instance from the context scope.
 */
function resolveBuiltinClass(name: string, contextCls: ModelicaClassInstance): ModelicaClassInstance | null {
  const resolved = contextCls.resolveSimpleName(name, false, true);
  if (resolved && !(resolved instanceof ModelicaComponentInstance)) {
    return resolved;
  }
  return null;
}

/** Extract a full type descriptor from a component's class instance. */
function getComponentTypeDescriptor(comp: ModelicaComponentInstance): ModelicaTypeDescriptor | null {
  if (!comp.classInstance) return null;
  const classRef = resolveElementClass(comp.classInstance);
  if (!classRef) return null;
  const shape = getArrayShape(comp.classInstance);
  // Also check component-level array dimensions (e.g., Real x[3])
  const compDims = (comp as any).arrayDimensions;
  if (Array.isArray(compDims) && compDims.length > 0 && shape.length === 0) {
    const dimValues = compDims.map((d: any) => d.value);
    if (dimValues.every((v: unknown) => typeof v === "number")) {
      return { classRef, shape: dimValues };
    }
  }
  return { classRef, shape };
}

/**
 * Infer a full type descriptor from an expression AST node.
 * Returns null if the type cannot be determined statically.
 */
function inferExpressionTypeDescriptor(expr: any, contextCls: ModelicaClassInstance): ModelicaTypeDescriptor | null {
  if (!expr) return null;

  const typeStr = expr["@type"];

  // Scalar literals — resolve to actual builtin class instances
  if (typeStr === "UNSIGNED_REAL" || typeStr === "unsigned_real" || typeStr === "FLOAT" || typeStr === "Real") {
    const cls = resolveBuiltinClass("Real", contextCls);
    return cls ? { classRef: cls, shape: [] } : null;
  }
  if (typeStr === "UNSIGNED_INTEGER" || typeStr === "unsigned_integer" || typeStr === "Integer") {
    const cls = resolveBuiltinClass("Integer", contextCls);
    return cls ? { classRef: cls, shape: [] } : null;
  }
  if (
    typeStr === "BOOLEAN" ||
    typeStr === "boolean_literal" ||
    typeStr === "Boolean" ||
    typeStr === "TRUE" ||
    typeStr === "FALSE" ||
    typeStr === "true_literal" ||
    typeStr === "false_literal"
  ) {
    const cls = resolveBuiltinClass("Boolean", contextCls);
    return cls ? { classRef: cls, shape: [] } : null;
  }
  if (typeStr === "STRING" || typeStr === "string_literal" || typeStr === "String") {
    const cls = resolveBuiltinClass("String", contextCls);
    return cls ? { classRef: cls, shape: [] } : null;
  }

  // Component references — resolve through the class instance to get full type + shape
  if (typeStr === "ComponentReference" || typeStr === "component_reference" || (expr.parts && !expr.operand1)) {
    const parts = expr.parts;
    if (parts && parts.length > 0) {
      const name = parts[0]?.identifier?.text;
      if (name) {
        if (name === "time") {
          const cls = resolveBuiltinClass("Real", contextCls);
          return cls ? { classRef: cls, shape: [] } : null;
        }
        let resolved = contextCls.resolveSimpleName(name, false, true);
        if (resolved instanceof ModelicaComponentInstance) {
          for (let i = 1; i < parts.length && resolved; i++) {
            const partName = parts[i]?.identifier?.text;
            if (!partName) break;
            const cls = (resolved as ModelicaComponentInstance).classInstance;
            if (!cls) return null;
            const elemCls = resolveElementClass(cls);
            if (!elemCls) return null;
            resolved = elemCls.resolveSimpleName?.(partName, false, true);
            if (!(resolved instanceof ModelicaComponentInstance)) return null;
          }
          if (resolved instanceof ModelicaComponentInstance) {
            return getComponentTypeDescriptor(resolved);
          }
        }
      }
    }
  }

  // Array constructors: {a, b, c} → shape = [n, ...innerShape], classRef = innerClassRef
  if (typeStr === "ArrayConstructor" && expr.expressionList) {
    const exprs = expr.expressionList.expressions ?? [];
    if (exprs.length === 0) {
      const cls = resolveBuiltinClass("Real", contextCls);
      return cls ? { classRef: cls, shape: [0] } : null;
    }
    const innerDesc = inferExpressionTypeDescriptor(exprs[0], contextCls);
    if (!innerDesc) return null;
    return { classRef: innerDesc.classRef, shape: [exprs.length, ...innerDesc.shape] };
  }

  // ArrayConcatenation: [a, b; c, d] → shape [numRows, numCols]
  if (typeStr === "ArrayConcatenation" && expr.expressionLists) {
    const rows = expr.expressionLists ?? [];
    const numRows = rows.length;
    const numCols = rows[0]?.expressions?.length ?? 0;
    const firstEl = rows[0]?.expressions?.[0];
    const innerDesc = firstEl ? inferExpressionTypeDescriptor(firstEl, contextCls) : null;
    if (!innerDesc) {
      const cls = resolveBuiltinClass("Real", contextCls);
      return cls ? { classRef: cls, shape: [numRows, numCols] } : null;
    }
    return { classRef: innerDesc.classRef, shape: [numRows, numCols] };
  }

  // Binary expressions — type promotion + shape propagation
  if (typeStr === "binary_expression" || expr.operand1) {
    const t1 = inferExpressionTypeDescriptor(expr.operand1, contextCls);
    const t2 = inferExpressionTypeDescriptor(expr.operand2, contextCls);

    // Relational / comparison / logical operators always return Boolean
    const op = expr.operator;
    const isRelational =
      op === BinOp.EQUALITY ||
      op === BinOp.INEQUALITY ||
      op === BinOp.LESS_THAN ||
      op === BinOp.LESS_THAN_OR_EQUAL ||
      op === BinOp.GREATER_THAN ||
      op === BinOp.GREATER_THAN_OR_EQUAL ||
      op === "==" ||
      op === "<>" ||
      op === "<" ||
      op === "<=" ||
      op === ">" ||
      op === ">=" ||
      op === "and" ||
      op === "or";

    let classRef: ModelicaClassInstance | null;
    if (isRelational) {
      classRef = resolveBuiltinClass("Boolean", contextCls);
    } else if (op === BinOp.DIVISION) {
      classRef = resolveBuiltinClass("Real", contextCls);
    } else {
      // Type promotion: if either operand is Real, result is Real
      const r1 = t1?.classRef ?? null;
      const r2 = t2?.classRef ?? null;
      if (r1 && r2) {
        const n1 = getBaseTypeName(r1);
        const n2 = getBaseTypeName(r2);
        if (n1 === "Real" || n2 === "Real") classRef = resolveBuiltinClass("Real", contextCls);
        else classRef = r1; // same type
      } else {
        classRef = r1 ?? r2;
      }
    }
    if (!classRef) return null;

    // Shape propagation
    const s1 = t1?.shape ?? [];
    const s2 = t2?.shape ?? [];
    let shape: number[];
    if (s1.length > 0 && s2.length === 0) shape = s1;
    else if (s2.length > 0 && s1.length === 0) shape = s2;
    else if (s1.length > 0) shape = s1;
    else shape = [];

    return { classRef, shape };
  }

  // Unary expressions
  if (typeStr === "unary_expression" || (expr.operand && !expr.operand1)) {
    return inferExpressionTypeDescriptor(expr.operand, contextCls);
  }

  // If expression: if c then a else b → type of a
  if (typeStr === "if_expression" || (expr.condition && expr.trueExpression)) {
    return inferExpressionTypeDescriptor(expr.trueExpression, contextCls);
  }

  // Function calls
  if (typeStr === "function_call" || expr.functionReference) {
    const funcName = expr.functionReferenceName || expr.functionReference?.parts?.[0]?.identifier?.text;
    if (funcName) {
      // Functions that always return Real
      if (
        [
          "sin",
          "cos",
          "tan",
          "sqrt",
          "exp",
          "log",
          "log10",
          "asin",
          "acos",
          "atan",
          "atan2",
          "sinh",
          "cosh",
          "tanh",
          "der",
        ].includes(funcName)
      ) {
        const cls = resolveBuiltinClass("Real", contextCls);
        return cls ? { classRef: cls, shape: [] } : null;
      }

      // Functions that preserve the type of their first argument
      if (["abs", "mod", "rem", "div", "pre", "previous", "noEvent", "smooth", "delay"].includes(funcName)) {
        // AST: expr.functionCallArguments.arguments[0].expression
        const fcArgs = expr.functionCallArguments?.arguments;
        const firstArg = Array.isArray(fcArgs) && fcArgs.length > 0 ? fcArgs[0]?.expression : null;
        if (firstArg) {
          const argDesc = inferExpressionTypeDescriptor(firstArg, contextCls);
          if (argDesc) return argDesc;
        }
        const cls = resolveBuiltinClass("Real", contextCls);
        return cls ? { classRef: cls, shape: [] } : null;
      }

      // Functions that return Boolean
      if (["initial", "terminal", "edge", "change"].includes(funcName)) {
        const cls = resolveBuiltinClass("Boolean", contextCls);
        return cls ? { classRef: cls, shape: [] } : null;
      }
      if (["integer", "size", "ndims", "Integer", "cardinality", "sign"].includes(funcName)) {
        const cls = resolveBuiltinClass("Integer", contextCls);
        return cls ? { classRef: cls, shape: [] } : null;
      }
      if (["String"].includes(funcName)) {
        const cls = resolveBuiltinClass("String", contextCls);
        return cls ? { classRef: cls, shape: [] } : null;
      }

      // User-defined functions — resolve output type
      const comp = contextCls.resolveSimpleName(funcName, false, true);
      if (comp instanceof ModelicaComponentInstance && comp.classInstance) {
        for (const el of comp.classInstance.elements) {
          if (el instanceof ModelicaComponentInstance && el.causality === "output" && el.classInstance) {
            return getComponentTypeDescriptor(el);
          }
        }
      }
    }
  }

  return null;
}

/**
 * Check whether `actual` type is assignment-compatible with `expected` type.
 * Uses structural subtype checking via the class instance hierarchy,
 * plus array shape matching.
 *
 * Returns null if compatible, or an error descriptor if not.
 */
function checkTypeCompatibility(
  expected: ModelicaTypeDescriptor,
  actual: ModelicaTypeDescriptor,
): { kind: "base_type" | "shape" | "non_array_mod" } | null {
  // Structural subtype check on classRef
  if (!isClassSubtypeOf(actual.classRef, expected.classRef)) {
    return { kind: "base_type" };
  }

  // Check shape compatibility
  if (expected.shape.length !== actual.shape.length) {
    if (expected.shape.length > 0 && actual.shape.length === 0) return { kind: "non_array_mod" };
    return { kind: "shape" };
  }
  for (let i = 0; i < expected.shape.length; i++) {
    if (expected.shape[i] !== actual.shape[i]) return { kind: "shape" };
  }

  return null; // compatible
}

/** Format a type descriptor as a human-readable string (e.g., "Real[3, 2]"). */
function formatTypeDescriptor(desc: ModelicaTypeDescriptor): string {
  const name = getBaseTypeName(desc.classRef) ?? "?";
  return desc.shape.length > 0 ? `${name}[${desc.shape.join(", ")}]` : name;
}

// --- Legacy shims (kept for callers that still use separate type/shape) ---

function inferExpressionType(expr: any, contextCls: ModelicaClassInstance): string | null {
  const desc = inferExpressionTypeDescriptor(expr, contextCls);
  return desc ? getBaseTypeName(desc.classRef) : null;
}

function inferExpressionShape(expr: any, contextCls?: ModelicaClassInstance): number[] {
  if (contextCls) {
    return inferExpressionTypeDescriptor(expr, contextCls)?.shape ?? [];
  }
  // Fallback without context: only handles literal shapes
  return inferExpressionShapeLiteral(expr);
}

/** Shape inference from literal structure only (no name resolution). */
function inferExpressionShapeLiteral(expr: any): number[] {
  if (!expr) return [];
  const typeStr = expr["@type"];
  if (typeStr === "ArrayConstructor" && expr.expressionList) {
    const exprs = expr.expressionList.expressions ?? [];
    if (exprs.length === 0) return [0];
    const innerShape = inferExpressionShapeLiteral(exprs[0]);
    return [exprs.length, ...innerShape];
  }
  if (typeStr === "ArrayConcatenation" && expr.expressionLists) {
    const rows = expr.expressionLists ?? [];
    return [rows.length, rows[0]?.expressions?.length ?? 0];
  }
  if (typeStr === "binary_expression" || expr.operand1) {
    const s1 = inferExpressionShapeLiteral(expr.operand1);
    const s2 = inferExpressionShapeLiteral(expr.operand2);
    if (s1.length > 0 && s2.length === 0) return s1;
    if (s2.length > 0 && s1.length === 0) return s2;
    if (s1.length > 0) return s1;
  }
  return [];
}

ModelicaLinter.register(
  [
    ModelicaErrorCode.TYPE_MISMATCH_BINDING,
    ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH,
    ModelicaErrorCode.NON_ARRAY_MODIFICATION,
    ModelicaErrorCode.BINDING_DIMENSION_MISMATCH,
  ],
  {
    visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
      if (node.classKind === ModelicaClassKind.FUNCTION || node.classKind === ModelicaClassKind.PACKAGE) return;

      for (const element of node.elements) {
        if (!(element instanceof ModelicaComponentInstance)) continue;
        if (!element.classInstance) continue;

        const expectedDesc = getComponentTypeDescriptor(element);
        if (!expectedDesc) continue;

        // Check the main binding expression
        const mod = element.modification;
        if (!mod) continue;

        const bindingExpr = mod.modificationExpression?.expression;
        if (!bindingExpr) continue;

        const actualDesc = inferExpressionTypeDescriptor(bindingExpr, node);
        if (!actualDesc) continue;

        const compat = checkTypeCompatibility(expectedDesc, actualDesc);
        if (!compat) continue;

        const astNode = element.abstractSyntaxNode;
        const exprText = getExpressionText(bindingExpr);

        if (compat.kind === "base_type") {
          // Base type mismatch (e.g., Real x = "hello", Integer x[3] = {"1","2","3"})
          diagnosticsCallback(
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.severity,
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
              element.name ?? "",
              formatTypeDescriptor(expectedDesc),
              exprText,
              formatTypeDescriptor(actualDesc),
            ),
            astNode,
          );
        } else if (compat.kind === "non_array_mod") {
          // Scalar assigned to array component (e.g., Real x[3] = 1)
          diagnosticsCallback(
            ModelicaErrorCode.NON_ARRAY_MODIFICATION.severity,
            ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
            ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(exprText, element.name ?? "?"),
            astNode,
          );
        } else if (compat.kind === "shape") {
          // Shape mismatch (e.g., Real x = {1,2,3} or Real x[3] = {1,2})
          diagnosticsCallback(
            ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.severity,
            ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
            ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
              element.name ?? "?",
              exprText,
              expectedDesc.shape.join(", "),
              actualDesc.shape.join(", "),
            ),
            astNode,
          );
        }
      }
    },
  },
);

// ---------------------------------------------------------------------------
// Type mismatch in builtin attributes (start, quantity, min, max, fixed, etc.)
// ---------------------------------------------------------------------------

/** Expected types for builtin attributes of each primitive type. */
const BUILTIN_ATTRIBUTE_TYPES: Record<string, Record<string, string>> = {
  Real: {
    start: "Real",
    min: "Real",
    max: "Real",
    nominal: "Real",
    quantity: "String",
    unit: "String",
    displayUnit: "String",
    fixed: "Boolean",
    stateSelect: "StateSelect",
  },
  Integer: {
    start: "Integer",
    min: "Integer",
    max: "Integer",
    quantity: "String",
    fixed: "Boolean",
  },
  Boolean: {
    start: "Boolean",
    quantity: "String",
    fixed: "Boolean",
  },
  String: {
    start: "String",
    quantity: "String",
  },
};

ModelicaLinter.register(ModelicaErrorCode.BUILTIN_ATTRIBUTE_TYPE_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      if (!element.classInstance) continue;

      const compTypeName = getBaseTypeName(element.classInstance);
      if (!compTypeName) continue;

      const attrTypes = BUILTIN_ATTRIBUTE_TYPES[compTypeName];
      if (!attrTypes) continue;

      const args = element.modification?.modificationArguments;
      if (!args) continue;

      for (const arg of args) {
        const attrName = typeof arg.name === "string" ? arg.name : arg.name?.text;
        if (!attrName) continue;

        const expectedType = attrTypes[attrName];
        if (!expectedType) continue;

        const expr = arg.modificationExpression?.expression ?? arg.expression;
        if (!expr) continue;

        const actualType = inferExpressionType(expr, node);
        if (!actualType) continue;

        // Check type compatibility
        let isMismatch = false;
        if (expectedType === "Real" && actualType !== "Real" && actualType !== "Integer") isMismatch = true;
        else if (expectedType === "Integer" && actualType !== "Integer") isMismatch = true;
        else if (expectedType === "Boolean" && actualType !== "Boolean") isMismatch = true;
        else if (expectedType === "String" && actualType !== "String") isMismatch = true;

        if (isMismatch) {
          diagnosticsCallback(
            ModelicaErrorCode.BUILTIN_ATTRIBUTE_TYPE_MISMATCH.severity,
            ModelicaErrorCode.BUILTIN_ATTRIBUTE_TYPE_MISMATCH.code,
            ModelicaErrorCode.BUILTIN_ATTRIBUTE_TYPE_MISMATCH.message(
              attrName,
              getExpressionText(expr),
              expectedType,
              actualType,
            ),
            element.abstractSyntaxNode ?? null,
          );
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Negative array dimensions: Real x[-2] is invalid
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.NEGATIVE_DIMENSION, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      const dims = (element as any).arrayDimensions;
      if (!Array.isArray(dims)) continue;
      for (const dim of dims) {
        // dim.value is set for simple integer literals; dim.text is set for expressions
        let val: number | undefined;
        if (typeof dim?.value === "number") {
          val = dim.value;
        } else if (typeof dim?.text === "string") {
          const parsed = parseInt(dim.text, 10);
          if (!isNaN(parsed)) val = parsed;
        }
        if (typeof val === "number" && val < 0) {
          diagnosticsCallback(
            ModelicaErrorCode.NEGATIVE_DIMENSION.severity,
            ModelicaErrorCode.NEGATIVE_DIMENSION.code,
            ModelicaErrorCode.NEGATIVE_DIMENSION.message(String(val), element.name ?? "?"),
            element.abstractSyntaxNode ?? null,
          );
        }
      }
    }
  },
});
ModelicaLinter.register(ModelicaErrorCode.CONSTANT_NOT_FIXED, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;

      if (element.variability !== "constant") continue;

      const args = element.modification?.modificationArguments;
      if (!args) continue;

      for (const arg of args) {
        if (arg.name === "fixed") {
          const expr = arg.modificationExpression?.expression ?? arg.expression;
          if (expr && (expr.type === "FALSE" || expr.type === "false_literal" || expr.text === "false")) {
            diagnosticsCallback(
              ModelicaErrorCode.CONSTANT_NOT_FIXED.severity,
              ModelicaErrorCode.CONSTANT_NOT_FIXED.code,
              ModelicaErrorCode.CONSTANT_NOT_FIXED.message(element.name ?? "?"),
              element.abstractSyntaxNode ?? null,
            );
          }
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Constant has no value: constant components must have a binding expression
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.CONSTANT_HAS_NO_VALUE, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Only check in models/blocks/classes — not in packages, functions, or types
    if (
      node.classKind === ModelicaClassKind.FUNCTION ||
      node.classKind === ModelicaClassKind.PACKAGE ||
      node.classKind === ModelicaClassKind.TYPE ||
      node.classKind === ModelicaClassKind.OPERATOR_FUNCTION
    ) {
      return;
    }

    // Skip inner/nested class definitions — constants in type definitions don't
    // need values until instantiated. Only check top-level models.
    if (node.parent && node.parent instanceof ModelicaClassInstance) {
      return;
    }

    /**
     * Check elements for unvalued constants. When `inheritedConstant` is true,
     * sub-components inherit constant variability from a parent even if they
     * are not explicitly marked constant themselves.
     */
    const checkElements = (
      elements: Iterable<any>,
      qualifiedPrefix: string,
      inheritedConstant: boolean,
      astForDiag: any,
    ) => {
      for (const element of elements) {
        if (!(element instanceof ModelicaComponentInstance)) continue;

        const compName = element.name ?? "";
        const qualifiedName = qualifiedPrefix ? `${qualifiedPrefix}.${compName}` : compName;

        const isConstant = element.variability === "constant" || inheritedConstant;

        if (!isConstant) continue;

        // Skip flow/stream variables — they get default zero values via equation sections
        const fp = (element as any).flowPrefix;
        if (fp === "flow" || fp === "stream" || fp === 1 || fp === 2) {
          continue;
        }

        // Check if this is a scalar primitive type (leaf)
        const isScalar =
          element.classInstance instanceof ModelicaRealClassInstance ||
          element.classInstance instanceof ModelicaIntegerClassInstance ||
          element.classInstance instanceof ModelicaBooleanClassInstance ||
          element.classInstance instanceof ModelicaStringClassInstance;

        if (isScalar) {
          // Check if there's a binding expression
          const mod = element.modification;
          const hasBinding = mod?.modificationExpression?.expression != null || mod?.expression != null;

          if (!hasBinding) {
            diagnosticsCallback(
              ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.severity,
              ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code,
              ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.message(qualifiedName),
              astForDiag ?? element.abstractSyntaxNode ?? null,
            );
            return; // OMC reports only the first missing constant value
          }
        } else if (element.classInstance) {
          // Composite type — recurse into its sub-components
          const cls =
            element.classInstance instanceof ModelicaArrayClassInstance
              ? (element.classInstance as any).elementClassInstance
              : element.classInstance;
          if (cls && cls.elements) {
            checkElements(cls.elements, qualifiedName, true, astForDiag ?? element.abstractSyntaxNode);
          }
        }
      }
    };

    checkElements(node.elements, "", false, null);
  },
});

// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.EQUATION_TYPE_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind === ModelicaClassKind.FUNCTION || node.classKind === ModelicaClassKind.PACKAGE) return;

    // Check simple equations for array dimension mismatches
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    for (const section of astNode.sections ?? []) {
      if (!(section instanceof ModelicaEquationSectionSyntaxNode)) continue;
      for (const eq of section.equations) {
        if (!(eq instanceof ModelicaSimpleEquationSyntaxNode)) continue;
        if (eq.operator && eq.operator !== "=") continue;

        const lhsRef = (eq.expression1 as any)?.parts;
        if (!lhsRef || lhsRef.length !== 1) continue;
        const lhsName = lhsRef[0]?.identifier?.text;
        if (!lhsName) continue;

        const lhsComp = node.resolveSimpleName(lhsName, false, true);
        if (!(lhsComp instanceof ModelicaComponentInstance)) continue;
        if (!lhsComp.classInstance) continue;

        const lhsShape = getArrayShape(lhsComp.classInstance);
        if (lhsShape.length === 0) continue;

        // Case 1: RHS is a simple component reference
        const rhsRef = (eq.expression2 as any)?.parts;
        if (rhsRef && rhsRef.length === 1) {
          const rhsName = rhsRef[0]?.identifier?.text;
          if (rhsName) {
            const rhsComp = node.resolveSimpleName(rhsName, false, true);
            if (rhsComp instanceof ModelicaComponentInstance && rhsComp.classInstance) {
              const rhsShape = getArrayShape(rhsComp.classInstance);
              if (
                rhsShape.length > 0 &&
                (lhsShape.length !== rhsShape.length || lhsShape.some((d, i) => d !== rhsShape[i]))
              ) {
                const lhsTypeName = getBaseTypeName(lhsComp.classInstance) ?? "Real";
                diagnosticsCallback(
                  ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
                  ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code,
                  ModelicaErrorCode.EQUATION_TYPE_MISMATCH.message(
                    lhsName,
                    rhsName,
                    `${lhsTypeName}[${lhsShape.join(", ")}]`,
                    `${lhsTypeName}[${rhsShape.join(", ")}]`,
                  ),
                  eq,
                );
                continue;
              }
            }
          }
        }

        // Case 2: RHS is an expression with an inferable shape (e.g., {2,4,6}/2)
        const rhsShape = inferExpressionShape(eq.expression2);
        if (
          rhsShape.length > 0 &&
          (lhsShape.length !== rhsShape.length || lhsShape.some((d, i) => d !== rhsShape[i]))
        ) {
          const lhsTypeName = getBaseTypeName(lhsComp.classInstance) ?? "Real";
          const rhsText = getExpressionText(eq.expression2);
          diagnosticsCallback(
            ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
            ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code,
            ModelicaErrorCode.EQUATION_TYPE_MISMATCH.message(
              lhsName,
              rhsText,
              `${lhsTypeName}[${lhsShape.join(", ")}]`,
              `${lhsTypeName}[${rhsShape.join(", ")}]`,
            ),
            eq,
          );
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Type mismatch in algorithm assignments: Real → Integer is not allowed
// ---------------------------------------------------------------------------
import {
  ModelicaAlgorithmSectionSyntaxNode as AlgoSection,
  ModelicaBinaryOperator as BinOp,
  ModelicaSimpleAssignmentStatementSyntaxNode as SimpleAssign,
} from "@modelscript/modelica/ast";

function getExpressionText(expr: any): string {
  if (!expr) return "...";
  // Component reference: reconstruct from parts
  if (expr.parts) {
    return expr.parts.map((p: any) => p.identifier?.text || p.name?.text || "?").join(".");
  }
  // Array constructor: {a, b, c}
  if (expr["@type"] === "ArrayConstructor" && expr.expressionList) {
    const exprs = expr.expressionList.expressions ?? [];
    return `{${exprs.map(getExpressionText).join(", ")}}`;
  }
  // Array concatenation: [a, b; c, d]
  if (expr["@type"] === "ArrayConcatenation" && expr.expressionLists) {
    const rows = expr.expressionLists ?? [];
    const rowTexts = rows.map((r: any) => (r.expressions ?? []).map(getExpressionText).join(", "));
    return `[${rowTexts.join("; ")}]`;
  }
  // String literals: ensure quotes
  if (expr["@type"] === "STRING" || expr["@type"] === "string_literal" || expr["@type"] === "String") {
    const text = expr.text || (expr.value !== undefined ? String(expr.value) : "");
    if (!text.startsWith('"')) return `"${text}"`;
    return text;
  }
  // Literal values
  if (expr.text !== undefined && expr.text !== null) return String(expr.text);
  if (expr.value !== undefined && expr.value !== null) return String(expr.value);
  // Function call
  if (expr.functionReference || expr.functionReferenceName) {
    return expr.functionReferenceName || getExpressionText(expr.functionReference) + "(...)";
  }
  // Binary expression
  if (expr.operand1 && expr.operand2) {
    return getExpressionText(expr.operand1) + " " + (expr.operator || "?") + " " + getExpressionText(expr.operand2);
  }
  // Unary expression
  if (expr.operand) {
    return (expr.operator || "-") + getExpressionText(expr.operand);
  }
  return "...";
}

ModelicaLinter.register(
  [
    ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH,
    ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT,
    ModelicaErrorCode.ASSIGNMENT_TO_INPUT,
  ],
  {
    visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
      const astNode = (node as any).abstractSyntaxNode;
      if (!astNode) return;

      for (const section of astNode.sections ?? []) {
        if (!(section instanceof AlgoSection)) continue;
        for (const stmt of section.statements ?? []) {
          if (!(stmt instanceof SimpleAssign)) continue;

          const targetParts = stmt.target?.parts;
          if (!targetParts || targetParts.length !== 1) continue;
          const targetName = targetParts[0]?.identifier?.text || (targetParts[0] as any)?.name?.text;
          if (!targetName) continue;

          const targetComp = node.resolveSimpleName(targetName, false, true);
          if (!(targetComp instanceof ModelicaComponentInstance)) continue;

          // 1. Check for assignments to constants/parameters
          if (targetComp.variability === "constant" || targetComp.variability === "parameter") {
            diagnosticsCallback(
              ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.severity,
              ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.code,
              ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.message(targetName, getExpressionText(stmt.source)),
              stmt.target,
            );
          }

          // 2. Check for assignments to inputs
          if (targetComp.causality === "input" && node.classKind !== ModelicaClassKind.FUNCTION) {
            // Inside functions, assigning to inputs is also typically forbidden, but wait, Modelica says:
            // "The formal inputs of a function are read-only".
            diagnosticsCallback(
              ModelicaErrorCode.ASSIGNMENT_TO_INPUT.severity,
              ModelicaErrorCode.ASSIGNMENT_TO_INPUT.code,
              ModelicaErrorCode.ASSIGNMENT_TO_INPUT.message(targetName),
              stmt.target,
            );
          }

          if (!targetComp.classInstance) continue;

          // 3. Check for type mismatch
          const targetType = getBaseTypeName(targetComp.classInstance);
          if (!targetType) continue;

          const sourceType = inferExpressionType(stmt.source, node);
          if (!sourceType) continue;

          // Modelica strictly forbids assigning Real to Integer, Boolean, String, etc.
          // Or assigning Integer to Boolean.
          // Assigning Integer to Real IS allowed.
          let isMismatch = false;
          if (targetType === "Integer" && sourceType === "Real") isMismatch = true;
          else if (targetType === "Boolean" && sourceType !== "Boolean") isMismatch = true;
          else if (targetType === "String" && sourceType !== "String") isMismatch = true;
          // Integer assigned to Real is OK.

          if (isMismatch) {
            diagnosticsCallback(
              ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.severity,
              ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
              ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.message(
                targetName,
                targetType,
                getExpressionText(stmt.source),
                sourceType,
              ),
              stmt,
            );
          }
        }
      }
    },
  },
);

// ---------------------------------------------------------------------------
// For iterator not 1D
// ---------------------------------------------------------------------------
import { ModelicaForEquationSyntaxNode as ForEq } from "@modelscript/modelica/ast";

ModelicaLinter.register(ModelicaErrorCode.FOR_ITERATOR_NOT_1D, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    function checkForIterator(forIndexes: any[]): void {
      for (const idx of forIndexes) {
        if (!idx.expression) continue;
        const shape = inferExpressionShape(idx.expression);
        if (shape.length > 1) {
          const typeName = "Integer"; // We'll just assume Integer for simplicity in error msg since shape is what matters
          const shapeStr = `${typeName}[${shape.join(", ")}]`;
          diagnosticsCallback(
            ModelicaErrorCode.FOR_ITERATOR_NOT_1D.severity,
            ModelicaErrorCode.FOR_ITERATOR_NOT_1D.code,
            ModelicaErrorCode.FOR_ITERATOR_NOT_1D.message(idx.identifier?.text ?? "?", shapeStr),
            idx,
          );
        }
      }
    }

    function checkStatementsForIterator(stmts: any[]): void {
      for (const stmt of stmts) {
        if (stmt instanceof ForStmt) {
          checkForIterator(stmt.forIndexes ?? []);
          checkStatementsForIterator(stmt.statements ?? []);
        } else if (stmt instanceof WhenStmt) {
          checkStatementsForIterator(stmt.statements ?? []);
          for (const elseWhen of stmt.elseWhenStatementClauses ?? []) {
            checkStatementsForIterator(elseWhen.statements ?? []);
          }
        } else if (stmt instanceof IfStmt) {
          checkStatementsForIterator(stmt.statements ?? []);
          checkStatementsForIterator(stmt.elseStatements ?? []);
          for (const elseIf of stmt.elseIfStatementClauses ?? []) {
            checkStatementsForIterator(elseIf.statements ?? []);
          }
        } else if (stmt instanceof WhileStmt) {
          checkStatementsForIterator(stmt.statements ?? []);
        }
      }
    }

    function checkEquationsForIterator(eqs: any[]): void {
      for (const eq of eqs) {
        if (eq instanceof ForEq) {
          checkForIterator(eq.forIndexes ?? []);
          checkEquationsForIterator(eq.equations ?? []);
        } else if (eq instanceof WhenEq) {
          checkEquationsForIterator(eq.equations ?? []);
          for (const elseWhen of (eq as any).elseWhenEquationClauses ?? []) {
            checkEquationsForIterator(elseWhen.equations ?? []);
          }
        } else if (eq["@type"] === "if_equation" || eq["@type"] === "IfEquation") {
          checkEquationsForIterator(eq.equations ?? []);
          checkEquationsForIterator(eq.elseEquations ?? []);
          for (const elseIf of eq.elseIfEquationClauses ?? []) {
            checkEquationsForIterator(elseIf.equations ?? []);
          }
        }
      }
    }

    for (const section of astNode.sections ?? []) {
      if (section instanceof AlgoSection) {
        checkStatementsForIterator(section.statements ?? []);
      } else if (section instanceof ModelicaEquationSectionSyntaxNode) {
        checkEquationsForIterator(section.equations ?? []);
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Nested when statements/equations
// ---------------------------------------------------------------------------
import {
  ModelicaForStatementSyntaxNode as ForStmt,
  ModelicaIfStatementSyntaxNode as IfStmt,
  ModelicaWhenEquationSyntaxNode as WhenEq,
  ModelicaWhenStatementSyntaxNode as WhenStmt,
  ModelicaWhileStatementSyntaxNode as WhileStmt,
} from "@modelscript/modelica/ast";

ModelicaLinter.register(ModelicaErrorCode.NESTED_WHEN, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    function checkStatementsForNestedWhen(stmts: any[], insideWhen: boolean, insideControl: boolean): void {
      for (const stmt of stmts) {
        if (stmt instanceof WhenStmt) {
          if (insideWhen) {
            diagnosticsCallback(
              ModelicaErrorCode.NESTED_WHEN.severity,
              ModelicaErrorCode.NESTED_WHEN.code,
              ModelicaErrorCode.NESTED_WHEN.message(),
              stmt,
            );
          } else if (insideControl) {
            // "A when-statement may not be used inside a function or a while, if, or for-clause"
            diagnosticsCallback(
              ModelicaErrorCode.NESTED_WHEN.severity,
              ModelicaErrorCode.NESTED_WHEN.code,
              "A when-statement may not be used inside a function or a while, if, or for-clause.",
              stmt,
            );
          }
          // Check inside the when's own body for further nesting
          checkStatementsForNestedWhen(stmt.statements ?? [], true, false);
          // Check elsewhen clauses for nested when statements too
          for (const elseWhen of stmt.elseWhenStatementClauses ?? []) {
            checkStatementsForNestedWhen(elseWhen.statements ?? [], true, false);
          }
        } else if (stmt instanceof IfStmt) {
          checkStatementsForNestedWhen(stmt.statements ?? [], insideWhen, true);
          checkStatementsForNestedWhen(stmt.elseStatements ?? [], insideWhen, true);
          for (const elseIf of stmt.elseIfStatementClauses ?? []) {
            checkStatementsForNestedWhen(elseIf.statements ?? [], insideWhen, true);
          }
        } else if (stmt instanceof ForStmt) {
          checkStatementsForNestedWhen(stmt.statements ?? [], insideWhen, true);
        } else if (stmt instanceof WhileStmt) {
          checkStatementsForNestedWhen(stmt.statements ?? [], insideWhen, true);
        }
      }
    }

    function checkEquationsForNestedWhen(eqs: any[], insideWhen: boolean): void {
      for (const eq of eqs) {
        if (eq instanceof WhenEq) {
          if (insideWhen) {
            diagnosticsCallback(
              ModelicaErrorCode.NESTED_WHEN.severity,
              ModelicaErrorCode.NESTED_WHEN.code,
              ModelicaErrorCode.NESTED_WHEN.message(),
              eq,
            );
          }
          checkEquationsForNestedWhen(eq.equations ?? [], true);
        }
      }
    }

    for (const section of astNode.sections ?? []) {
      if (section instanceof AlgoSection) {
        checkStatementsForNestedWhen(section.statements ?? [], false, false);
      } else if (section instanceof ModelicaEquationSectionSyntaxNode) {
        checkEquationsForNestedWhen(section.equations ?? [], false);
      }
    }

    // Also check: when inside functions is forbidden
    if (node.classKind === ModelicaClassKind.FUNCTION) {
      for (const section of astNode.sections ?? []) {
        if (section instanceof AlgoSection) {
          for (const stmt of section.statements ?? []) {
            if (stmt instanceof WhenStmt) {
              diagnosticsCallback(
                ModelicaErrorCode.NESTED_WHEN.severity,
                ModelicaErrorCode.NESTED_WHEN.code,
                "A when-statement may not be used inside a function or a while, if, or for-clause.",
                stmt,
              );
            }
          }
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Function structure checks: protected I/O, public non-I/O, invalid var types
// ---------------------------------------------------------------------------

ModelicaLinter.register(
  [
    ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE,
    ModelicaErrorCode.FUNCTION_PROTECTED_IO,
    ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE,
    ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM,
    ModelicaErrorCode.DUPLICATE_ELEMENT,
  ],
  {
    visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
      // Check for duplicate elements in the same scope (declared locally)
      const declaredElements = node.declaredElements;
      const seenNames = new Set<string>();
      for (const element of declaredElements) {
        // Only check components, classes, and enum literals. Ignore equations or other nameless elements.
        const isComponentOrClass = element.isComponentInstance || element.isClassInstance;
        const isEnumLiteral = element.kind === "enumeration_literal" || element.classKind === "enumeration_literal";
        if (!isComponentOrClass && !isEnumLiteral) continue;

        if (!element.name) continue;
        if (seenNames.has(element.name)) {
          diagnosticsCallback(
            ModelicaErrorCode.DUPLICATE_ELEMENT.severity,
            ModelicaErrorCode.DUPLICATE_ELEMENT.code,
            ModelicaErrorCode.DUPLICATE_ELEMENT.message(element.name),
            element.abstractSyntaxNode ?? null,
          );
        } else {
          seenNames.add(element.name);
        }
      }

      if (node.classKind !== ModelicaClassKind.FUNCTION) return;

      // Check for protected input/output and public non-I/O variables
      for (const element of node.elements) {
        if (!(element instanceof ModelicaComponentInstance)) continue;

        const isIO = element.causality === "input" || element.causality === "output";
        const isProtected = element.isProtected;

        // Protected input/output is invalid
        if (isIO && isProtected) {
          diagnosticsCallback(
            ModelicaErrorCode.FUNCTION_PROTECTED_IO.severity,
            ModelicaErrorCode.FUNCTION_PROTECTED_IO.code,
            ModelicaErrorCode.FUNCTION_PROTECTED_IO.message(element.name ?? "?"),
            element.abstractSyntaxNode ?? null,
          );
        }

        // Public non-I/O is a warning (should be protected)
        if (!isIO && !isProtected && element.variability !== "constant") {
          diagnosticsCallback(
            ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.severity,
            ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.code,
            ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.message(element.name ?? "?"),
            element.abstractSyntaxNode ?? null,
          );
        }

        // Invalid type for function component (models, blocks, etc.)
        if (element.classInstance) {
          const cls =
            element.classInstance instanceof ModelicaArrayClassInstance
              ? (element.classInstance as any).elementClassInstance
              : element.classInstance;
          if (
            cls &&
            (cls.classKind === ModelicaClassKind.MODEL ||
              cls.classKind === ModelicaClassKind.CONNECTOR ||
              cls.classKind === ModelicaClassKind.BLOCK)
          ) {
            diagnosticsCallback(
              ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.severity,
              ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code,
              ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.message(cls.name ?? "?", element.name ?? "?"),
              element.abstractSyntaxNode ?? null,
            );
          }
        }
      }

      // Check for external + algorithm coexistence
      let hasExternal = false;
      let algorithmCount = 0;
      let algoNode: any = null;

      function checkClassForAlgorithmsAndExternal(cls: ModelicaClassInstance) {
        const clsAst = (cls as any).abstractSyntaxNode;
        if (!clsAst) return;

        for (const section of clsAst.sections ?? []) {
          if (section instanceof AlgoSection) {
            algorithmCount++;
            algoNode = algoNode || section; // Keep first found
          }
          if (section["@type"] === "external_clause" || section["@type"] === "ExternalClause") {
            hasExternal = true;
          }
        }
        if (
          clsAst.classSpecifier?.externalFunctionClause ||
          clsAst.externalFunctionClause ||
          (clsAst.sections &&
            Array.from(clsAst.sections).some(
              (s: any) => s["@type"] === "external_clause" || s["@type"] === "ExternalClause",
            ))
        ) {
          hasExternal = true;
        }

        if (cls.extendsClassInstances) {
          for (const ext of cls.extendsClassInstances) {
            if (ext.classInstance) {
              checkClassForAlgorithmsAndExternal(ext.classInstance);
            }
          }
        }
      }

      checkClassForAlgorithmsAndExternal(node);

      // OMC error: "Function f has more than one algorithm section or external declaration."
      // This covers: multiple algorithm sections, or algorithm + external
      if (algorithmCount > 1 || (hasExternal && algorithmCount > 0)) {
        diagnosticsCallback(
          ModelicaErrorCode.FUNCTION_MULTIPLE_ALGORITHM.severity,
          ModelicaErrorCode.FUNCTION_MULTIPLE_ALGORITHM.code,
          ModelicaErrorCode.FUNCTION_MULTIPLE_ALGORITHM.message(node.name ?? "?"),
          (node as any).abstractSyntaxNode ?? null,
        );
      }
    },
  },
);

// ---------------------------------------------------------------------------
// Class restriction violations: connector, record, type
// Per Modelica Spec §4.6:
//   - connector: no equations, algorithms, or protected sections
//   - record: no equations, algorithms, or protected sections
//   - type: no equations or algorithms
// ---------------------------------------------------------------------------

import { ModelicaElementSectionSyntaxNode as ElementSection } from "@modelscript/modelica/ast";

ModelicaLinter.register([ModelicaErrorCode.RESTRICTION_VIOLATION], {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const classKind = node.classKind;

    // Define which restrictions apply to which class kinds
    const noEquations = new Set([
      ModelicaClassKind.CONNECTOR,
      ModelicaClassKind.EXPANDABLE_CONNECTOR,
      ModelicaClassKind.RECORD,
      ModelicaClassKind.OPERATOR_RECORD,
      ModelicaClassKind.TYPE,
      ModelicaClassKind.PACKAGE,
      ModelicaClassKind.FUNCTION,
    ]);
    const noAlgorithms = new Set([
      ModelicaClassKind.CONNECTOR,
      ModelicaClassKind.EXPANDABLE_CONNECTOR,
      ModelicaClassKind.RECORD,
      ModelicaClassKind.OPERATOR_RECORD,
      ModelicaClassKind.TYPE,
      ModelicaClassKind.PACKAGE,
    ]);
    const noProtected = new Set([
      ModelicaClassKind.CONNECTOR,
      ModelicaClassKind.EXPANDABLE_CONNECTOR,
      ModelicaClassKind.RECORD,
      ModelicaClassKind.OPERATOR_RECORD,
      ModelicaClassKind.TYPE,
    ]);
    // Functions may not have initial equation/algorithm sections
    const noInitialSections = new Set([ModelicaClassKind.FUNCTION]);

    if (
      !noEquations.has(classKind as ModelicaClassKind) &&
      !noAlgorithms.has(classKind as ModelicaClassKind) &&
      !noProtected.has(classKind as ModelicaClassKind) &&
      !noInitialSections.has(classKind as ModelicaClassKind)
    ) {
      return;
    }

    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    // Get the human-readable class kind name for the error message
    const kindName = classKind as string;

    for (const section of astNode.sections ?? []) {
      if (section instanceof ModelicaEquationSectionSyntaxNode) {
        if (noEquations.has(classKind as ModelicaClassKind)) {
          // Check if this is a constraint section (allowed in optimization)
          if ((section as any).inConstraintSection) continue;
          // For classes that ban ALL equations (connector, type, etc.), use just "Equations"
          const sectionType = "Equations";
          diagnosticsCallback(
            ModelicaErrorCode.RESTRICTION_VIOLATION.severity,
            ModelicaErrorCode.RESTRICTION_VIOLATION.code,
            ModelicaErrorCode.RESTRICTION_VIOLATION.message(sectionType, kindName),
            section,
          );
        }
      }
      if (section instanceof AlgoSection) {
        if (noAlgorithms.has(classKind as ModelicaClassKind)) {
          // Find the first statement node for better error location
          const firstStmt = (section as any).statements?.[0];
          const sectionType = "Algorithm sections";
          diagnosticsCallback(
            ModelicaErrorCode.RESTRICTION_VIOLATION.severity,
            ModelicaErrorCode.RESTRICTION_VIOLATION.code,
            ModelicaErrorCode.RESTRICTION_VIOLATION.message(sectionType, kindName),
            firstStmt ?? section,
          );
        } else if (noInitialSections.has(classKind as ModelicaClassKind) && section.initial) {
          // Functions may not have initial algorithm sections
          const firstStmt = (section as any).statements?.[0];
          diagnosticsCallback(
            ModelicaErrorCode.RESTRICTION_VIOLATION.severity,
            ModelicaErrorCode.RESTRICTION_VIOLATION.code,
            ModelicaErrorCode.RESTRICTION_VIOLATION.message("Initial algorithm sections", kindName),
            firstStmt ?? section,
          );
        }
      }
      // Protected sections (for connector, record, and type)
      if (
        section instanceof ElementSection &&
        (section as any).visibility === "protected" &&
        noProtected.has(classKind as ModelicaClassKind)
      ) {
        // Point to the first element in the protected section for error location
        const elements = (section as any).elements;
        const firstEl = elements?.[0];
        diagnosticsCallback(
          ModelicaErrorCode.RESTRICTION_VIOLATION.severity,
          ModelicaErrorCode.RESTRICTION_VIOLATION.code,
          ModelicaErrorCode.RESTRICTION_VIOLATION.message("Protected sections", kindName),
          firstEl ?? section,
        );
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Package variable must be constant
// Per Modelica Spec §4.6: All public components of a package must be constant.
// ---------------------------------------------------------------------------

ModelicaLinter.register([ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT], {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.PACKAGE) return;

    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      if (element.variability === "constant") continue;
      // Non-constant variable in package
      diagnosticsCallback(
        ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.severity,
        ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
        ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.message(element.name ?? "?", node.name ?? "?"),
        element.abstractSyntaxNode ?? null,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Invalid variability on connector component
// Per Modelica Spec §4.7: connector components may not have constant/parameter variability
// ---------------------------------------------------------------------------

ModelicaLinter.register([ModelicaErrorCode.CONNECTOR_VARIABILITY], {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const classInst = node.classInstance;
    if (!classInst) return;
    // Check if the component's type is a connector
    const isConnector =
      classInst.classKind === ModelicaClassKind.CONNECTOR ||
      classInst.classKind === ModelicaClassKind.EXPANDABLE_CONNECTOR;
    if (!isConnector) return;
    // Check if component variability is constant or parameter
    if (node.variability === "constant" || node.variability === "parameter") {
      diagnosticsCallback(
        ModelicaErrorCode.CONNECTOR_VARIABILITY.severity,
        ModelicaErrorCode.CONNECTOR_VARIABILITY.code,
        ModelicaErrorCode.CONNECTOR_VARIABILITY.message(
          node.variability === "constant" ? "constant" : "parameter",
          node.name ?? "?",
        ),
        node.abstractSyntaxNode ?? null,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Prefix 'flow'/'stream' outside connector declaration
// ---------------------------------------------------------------------------

ModelicaLinter.register([ModelicaErrorCode.FLOW_OUTSIDE_CONNECTOR], {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    // Check if component has flow prefix
    const isFlow = (node as any).flowPrefix === "flow" || (node as any).flowPrefix === 1;
    if (!isFlow) return;

    // Check if the parent class is a connector
    const classInst = node.parent;
    if (!classInst || !(classInst instanceof ModelicaClassInstance)) return;

    const isParentConnector =
      classInst.classKind === ModelicaClassKind.CONNECTOR ||
      classInst.classKind === ModelicaClassKind.EXPANDABLE_CONNECTOR;

    if (!isParentConnector) {
      diagnosticsCallback(
        ModelicaErrorCode.FLOW_OUTSIDE_CONNECTOR.severity,
        ModelicaErrorCode.FLOW_OUTSIDE_CONNECTOR.code,
        ModelicaErrorCode.FLOW_OUTSIDE_CONNECTOR.message(),
        node.abstractSyntaxNode ?? null,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Partial class instantiation check
// Per Modelica Spec §4.4.2: partial classes may not be instantiated
// ---------------------------------------------------------------------------

ModelicaLinter.register([ModelicaErrorCode.PARTIAL_INSTANTIATION], {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const classInst = node.classInstance;
    if (!classInst) return;

    // Check if the type class is partial
    const isPartial = (classInst as any).isPartial;
    if (!isPartial) return;

    // Skip if the component itself is a replaceable placeholder
    if ((node as any).isReplaceable) return;

    // Skip outer components: they are resolved to the inner component
    if ((node as any).isOuter) return;

    // Skip extends class instances (partial classes are valid base classes)
    if (node instanceof ModelicaExtendsClassInstance) return;

    const className = classInst.name ?? node.name ?? "?";
    diagnosticsCallback(
      ModelicaErrorCode.PARTIAL_INSTANTIATION.severity,
      ModelicaErrorCode.PARTIAL_INSTANTIATION.code,
      ModelicaErrorCode.PARTIAL_INSTANTIATION.message(className),
      (classInst as any).abstractSyntaxNode ?? node.abstractSyntaxNode ?? null,
    );
  },
});

// ---------------------------------------------------------------------------
// Redeclare of non-replaceable element
// Per Modelica Spec §7.3: only replaceable elements may be redeclared
// ---------------------------------------------------------------------------

ModelicaLinter.register([ModelicaErrorCode.REDECLARE_NON_REPLACEABLE], {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Check extends clauses for redeclarations targeting non-replaceable elements
    if (!node.extendsClassInstances) return;

    // Per Modelica Spec §7.1.3: the base class name must be transitively non-replaceable.
    for (const ext of node.extendsClassInstances) {
      if (!ext.classInstance) continue;

      // If the target class instance is replaceable, it's illegal.
      if ((ext.classInstance as any).isReplaceable) {
        const className = ext.classInstance.name ?? "?";
        const extAst = (ext as any).abstractSyntaxNode;
        // Try to get the original text like "A.<B>" or "M"
        const extendsText = extAst?.typeSpecifier?.name?.parts?.map((p: any) => p.text).join(".") ?? className;

        diagnosticsCallback(
          ModelicaErrorCode.REPLACEABLE_BASE_CLASS.severity,
          ModelicaErrorCode.REPLACEABLE_BASE_CLASS.code,
          ModelicaErrorCode.REPLACEABLE_BASE_CLASS.message(className, extendsText),
          extAst ?? null,
        );
      }
    }

    for (const ext of node.extendsClassInstances) {
      const mod = ext.modification;
      if (!mod) continue;
      const args = mod.modificationArguments;
      if (!args) continue;

      for (const arg of args) {
        const anyArg = arg as any;
        // Identify redeclare arguments
        const isRedeclare = anyArg.isRedeclare || anyArg.ast?.redeclare || anyArg.arg?.redeclare;
        if (!isRedeclare) continue;

        // Get the name of the redeclared element
        let redeclName: string | undefined;
        if (anyArg.componentDeclaration1?.declaration?.identifier?.text) {
          redeclName = anyArg.componentDeclaration1.declaration.identifier.text;
        } else if (anyArg.componentClause?.componentDeclaration?.declaration?.identifier?.text) {
          redeclName = anyArg.componentClause.componentDeclaration.declaration.identifier.text;
        } else if (anyArg.shortClassDefinition?.name?.text) {
          redeclName = anyArg.shortClassDefinition.name.text;
        } else if (anyArg.classDefinition?.name?.text) {
          redeclName = anyArg.classDefinition.name.text;
        } else if (anyArg.name) {
          redeclName = typeof anyArg.name === "string" ? anyArg.name : anyArg.name.text;
        }

        if (!redeclName) continue;

        // Check if the element in the base class is replaceable
        const baseClass = ext.classInstance;
        if (!baseClass) continue;

        let found: any = null;
        for (const el of baseClass.elements) {
          if (el.name === redeclName) {
            found = el;
            break;
          }
        }

        if (found && !(found as any).isReplaceable) {
          diagnosticsCallback(
            ModelicaErrorCode.REDECLARE_NON_REPLACEABLE.severity,
            ModelicaErrorCode.REDECLARE_NON_REPLACEABLE.code,
            ModelicaErrorCode.REDECLARE_NON_REPLACEABLE.message(redeclName),
            anyArg.ast ?? anyArg,
          );
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Unresolved references in equations
// ---------------------------------------------------------------------------
import { ModelicaComponentReferenceSyntaxNode as CompRef } from "@modelscript/modelica/ast";

ModelicaLinter.register(ModelicaErrorCode.VARIABLE_NOT_FOUND, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    for (const section of astNode.sections ?? []) {
      if (!(section instanceof ModelicaEquationSectionSyntaxNode) && !(section instanceof AlgoSection)) continue;

      for (const eq of (section as any).equations ?? []) {
        if (eq instanceof ModelicaSimpleEquationSyntaxNode) {
          const refs = [eq.expression1, eq.expression2];
          for (const expr of refs) {
            if (expr instanceof CompRef) {
              const parts = expr.parts;
              if (parts && parts.length > 0) {
                const nameParts = parts.map((p) => p.identifier?.text ?? "");
                if (nameParts[0] && nameParts[0] !== "time") {
                  // built-in 'time' is always allowed in equations
                  const resolved = node.resolveName(nameParts);
                  if (!resolved) {
                    // Check if any intermediate component has a redeclare modifier
                    let hasRedeclareModifier = false;
                    for (let i = 1; i <= nameParts.length; i++) {
                      const partialResolved = node.resolveName(nameParts.slice(0, i));
                      if (partialResolved && partialResolved.isComponentInstance) {
                        const comp = partialResolved as any; // ModelicaComponentInstance
                        const args = comp.modification?.modificationArguments || [];
                        for (const arg of args) {
                          if (
                            arg.isRedeclare ||
                            arg.ast?.redeclare ||
                            arg.arg?.redeclare ||
                            arg.componentClause?.componentDeclaration?.declaration?.identifier?.text
                          ) {
                            hasRedeclareModifier = true;
                            break;
                          }
                        }
                      }
                    }

                    if (!hasRedeclareModifier) {
                      let failedPrefix = nameParts;
                      for (let i = 1; i <= nameParts.length; i++) {
                        if (!node.resolveName(nameParts.slice(0, i))) {
                          failedPrefix = nameParts.slice(0, i);
                          break;
                        }
                      }
                      const fullName = failedPrefix.join(".");
                      const scopeName =
                        node.name || (typeof (node as any).id === "string" ? (node as any).id.split(".").pop() : "?");
                      diagnosticsCallback(
                        ModelicaErrorCode.VARIABLE_NOT_FOUND.severity,
                        ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                        ModelicaErrorCode.VARIABLE_NOT_FOUND.message(fullName, scopeName),
                        expr,
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Regular modifications
    checkModifications(node, node.modification?.modificationArguments, node.name ?? "class", diagnosticsCallback);
    if (node.extendsClassInstances) {
      for (const ext of node.extendsClassInstances) {
        checkModifications(ext, ext.modification?.modificationArguments, ext.name ?? "class", diagnosticsCallback);
      }
    }
    // Short class definition modifications (which aren't stored on the semantic model extends properly)
    if (node.abstractSyntaxNode?.classSpecifier?.classModification?.modificationArguments) {
      const baseClass = (node as any).shortClassTarget;
      if (baseClass) {
        checkModifications(
          baseClass,
          node.abstractSyntaxNode.classSpecifier.classModification.modificationArguments,
          baseClass.name ?? "class",
          diagnosticsCallback,
        );
      }
    }
  },
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const modArgs = node.modification?.modificationArguments;
    // If a component has db-level modifications (ModelicaModification), it means
    // the semantic model merged modifications from extends/redeclare chains. Some of
    // these modifiers may target elements of a previous (pre-redeclaration) type.
    // Suppress M2007 for such components since we can't distinguish old-type modifiers
    // from new-type modifiers at this level.
    const mod = node.modification;
    const isDbMod = mod && mod.constructor?.name === "ModelicaModification";
    if (isDbMod) {
      return;
    }

    checkModifications(node, modArgs, node.declaredType?.name ?? node.name, diagnosticsCallback);
  },
});

function checkModifications(
  node: ModelicaClassInstance,
  args: any[] | undefined,
  className: string,
  diagnosticsCallback: DiagnosticsCallbackWithoutResource,
) {
  if (!args) return;
  for (const mod of args) {
    let isRedeclare = false;
    let modText = "";
    let nameStr: string | undefined;

    // Semantic node (ModelicaElementModification)
    if (typeof mod.name === "string") {
      nameStr = mod.name;
      modText = mod.arg?.value?.text ? `${nameStr} = ${mod.arg.value.text}` : (nameStr ?? "");
    }
    // AST node (ModelicaElementModificationSyntaxNode)
    else if (mod.name && mod.name.parts) {
      nameStr = mod.name.parts.map((p: any) => p.text).join(".");
      modText = mod.modificationExpression?.expression?.text
        ? `${nameStr} = ${mod.modificationExpression.expression.text}`
        : nameStr || "";
    }
    // Redeclare AST node
    else if (mod.componentDeclaration1?.declaration?.identifier?.text) {
      nameStr = mod.componentDeclaration1.declaration.identifier.text;
      isRedeclare = true;
    } else if (mod.componentClause?.componentDeclaration?.declaration?.identifier?.text) {
      nameStr = mod.componentClause.componentDeclaration.declaration.identifier.text;
      isRedeclare = true;
    } else if (mod.componentClause?.componentList?.components?.[0]?.declaration?.identifier?.text) {
      nameStr = mod.componentClause.componentList.components[0].declaration.identifier.text;
      isRedeclare = true;
    } else if (mod.shortClassDefinition?.name?.text) {
      nameStr = mod.shortClassDefinition.name.text;
      isRedeclare = true;
    } else if (mod.classDefinition?.name?.text) {
      nameStr = mod.classDefinition.name.text;
      isRedeclare = true;
    }

    if (nameStr) {
      const parts = nameStr.split(".");

      // We must check if the modification name is an EXACT member of `node` or its inherited classes.
      // We CANNOT use `node.resolveName(parts)` because that performs lexical lookup outward!
      function resolveMember(curr: ModelicaClassInstance, path: string[]): any {
        if (path.length === 0) return curr;
        const name = path[0] as string;

        // If `curr` is a component, modifications apply to its TYPE, not itself.
        if (curr.isComponentInstance) {
          const classInst = (curr as ModelicaComponentInstance).classInstance;
          if (classInst) return resolveMember(classInst, path);
          return null;
        }

        // Predefined types have implicit attributes
        if ((curr as any).entry?.metadata?.isPredefined) {
          const typeName = curr.name;
          const common = ["value", "quantity", "start", "fixed"];
          const realInt = ["min", "max"];
          const realOnly = ["nominal", "unbounded", "stateSelect", "unit", "displayUnit"];
          const allowed = [...common];
          if (typeName === "Real" || typeName === "Integer" || typeName === "Enumeration") allowed.push(...realInt);
          if (typeName === "Real") allowed.push(...realOnly);
          if (allowed.includes(name)) {
            if (path.length === 1) return true; // resolved
            return null; // primitive attributes don't have nested members
          }
        }

        // User-defined enumeration types have the same built-in attributes as predefined Enumeration
        if (curr.constructor?.name === "ModelicaEnumerationClassInstance") {
          const enumAttrs = ["value", "quantity", "min", "max", "start", "fixed"];
          if (enumAttrs.includes(name)) {
            if (path.length === 1) return true;
            return null;
          }
        }

        let found: any = null;
        for (const el of curr.elements) {
          if (el.name === name) {
            found = el;
            break;
          }
        }
        if (!found && curr.extendsClassInstances) {
          for (const ext of curr.extendsClassInstances) {
            if (ext.classInstance) {
              found = resolveMember(ext.classInstance, [name]);
              if (found) break;
            }
          }
        }
        // Short class definitions extends logic (flattener uses shortClassTarget)
        if (!found && (curr as any).shortClassTarget) {
          found = resolveMember((curr as any).shortClassTarget, [name]);
        }
        if (!found) return null;
        if (path.length === 1) return found;

        if (found.isComponentInstance) {
          const classInst = found.classInstance;
          if (classInst) return resolveMember(classInst, path.slice(1));
        } else if (found.classKind) {
          return resolveMember(found, path.slice(1));
        }
        return null;
      }

      const resolved = resolveMember(node, parts);
      if (!resolved) {
        if (isRedeclare) {
          diagnosticsCallback(
            ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.severity,
            ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
            ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(nameStr, className),
            mod.ast ?? mod,
          );
        } else {
          // Modelica Spec 3.4, section 7.3.2.1: Modifiers for components that are
          // not present in the new type are dropped during redeclaration.
          // Suppress M2007 when the component was redeclared (isRedeclare flag) or
          // when the modification args list contains redeclare entries.
          let suppressDiagnostic = false;
          if (node.isComponentInstance && (node as ModelicaComponentInstance).isRedeclare) {
            suppressDiagnostic = true;
          }
          if (!suppressDiagnostic && args) {
            for (const arg of args) {
              if (arg.ast?.redeclare || arg.arg?.redeclare || arg.isRedeclare) {
                suppressDiagnostic = true;
                break;
              }
            }
          }
          if (!suppressDiagnostic) {
            diagnosticsCallback(
              ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.severity,
              ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.code,
              ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.message(modText, nameStr, className),
              mod.ast ?? mod,
            );
          }
        }
      } else {
        const classInst = (node as any).classInstance ?? node;
        const isProtected =
          (resolved as any).isProtected ||
          (classInst?.isProtectedElement &&
            typeof classInst.isProtectedElement === "function" &&
            classInst.isProtectedElement(parts[0]));

        if (isProtected) {
          diagnosticsCallback(
            ModelicaErrorCode.PROTECTED_ELEMENT_MODIFICATION.severity,
            ModelicaErrorCode.PROTECTED_ELEMENT_MODIFICATION.code,
            ModelicaErrorCode.PROTECTED_ELEMENT_MODIFICATION.message(
              parts[parts.length - 1] ?? nameStr ?? "?",
              modText || nameStr || "?",
            ),
            mod.ast ?? mod,
          );
        }

        let subMods: any[] | undefined;
        try {
          subMods =
            mod.modification?.modificationArguments ?? mod.modification?.classModification?.modificationArguments;
        } catch {
          // Guard: modificationArguments getter may throw if underlying semantic model data is malformed
        }
        if (subMods) {
          checkModifications(resolved, subMods, resolved.name ?? nameStr, diagnosticsCallback);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Builtin time usage
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Connect restrictions: connect may not be used in when, initial, or non-parametric if
// Per Modelica Spec §9.1 and §8.3.5
// ---------------------------------------------------------------------------
import {
  ModelicaConnectEquationSyntaxNode as ConnectEq,
  ModelicaIfEquationSyntaxNode as IfEq,
} from "@modelscript/modelica/ast";

/** Recursively scan equations for connect inside when equations */
function findConnectInWhen(eqs: any[], diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
  for (const eq of eqs) {
    if (eq instanceof WhenEq) {
      // Any connect inside this when is illegal
      scanForConnects(eq.equations ?? [], diagnosticsCallback, "when");
      for (const elseWhen of (eq as any).elseWhenEquationClauses ?? []) {
        scanForConnects(elseWhen.equations ?? [], diagnosticsCallback, "when");
      }
    }
    // Recurse into for equations, if equations, etc.
    if (eq instanceof ForEq) {
      findConnectInWhen(eq.equations ?? [], diagnosticsCallback);
    }
    if (eq instanceof IfEq) {
      findConnectInWhen(eq.equations ?? [], diagnosticsCallback);
      findConnectInWhen(eq.elseEquations ?? [], diagnosticsCallback);
      for (const elseIf of eq.elseIfEquationClauses ?? []) {
        findConnectInWhen(elseIf.equations ?? [], diagnosticsCallback);
      }
    }
  }
}

function scanForConnects(
  eqs: any[],
  diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  context: "when" | "initial",
): void {
  for (const eq of eqs) {
    if (eq instanceof ConnectEq) {
      const ref1 = eq.componentReference1?.parts?.map((p: any) => p.identifier?.text ?? "?").join(".") ?? "?";
      const ref2 = eq.componentReference2?.parts?.map((p: any) => p.identifier?.text ?? "?").join(".") ?? "?";
      const connectExpr = `connect(${ref1}, ${ref2})`;
      if (context === "when") {
        diagnosticsCallback(
          ModelicaErrorCode.CONNECT_IN_WHEN.severity,
          ModelicaErrorCode.CONNECT_IN_WHEN.code,
          ModelicaErrorCode.CONNECT_IN_WHEN.message(connectExpr),
          eq,
        );
      } else {
        diagnosticsCallback(
          ModelicaErrorCode.CONNECT_IN_INITIAL.severity,
          ModelicaErrorCode.CONNECT_IN_INITIAL.code,
          ModelicaErrorCode.CONNECT_IN_INITIAL.message(),
          eq,
        );
      }
    }
    // Recurse
    if (eq instanceof ForEq) scanForConnects(eq.equations ?? [], diagnosticsCallback, context);
    if (eq instanceof IfEq) {
      scanForConnects(eq.equations ?? [], diagnosticsCallback, context);
      scanForConnects(eq.elseEquations ?? [], diagnosticsCallback, context);
      for (const elseIf of eq.elseIfEquationClauses ?? []) {
        scanForConnects(elseIf.equations ?? [], diagnosticsCallback, context);
      }
    }
    if (eq instanceof WhenEq) {
      scanForConnects(eq.equations ?? [], diagnosticsCallback, context);
    }
  }
}

ModelicaLinter.register([ModelicaErrorCode.CONNECT_IN_WHEN, ModelicaErrorCode.CONNECT_IN_INITIAL], {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    for (const section of astNode.sections ?? []) {
      if (!(section instanceof ModelicaEquationSectionSyntaxNode)) continue;

      // Check for connect in initial equation sections
      if (section.initial) {
        scanForConnects(section.equations ?? [], diagnosticsCallback, "initial");
      }

      // Check for connect in when equations
      findConnectInWhen(section.equations ?? [], diagnosticsCallback);
    }
  },
});

// ---------------------------------------------------------------------------
// Final override check
// Per Modelica Spec §7.2.6: final elements may not be modified
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.FINAL_OVERRIDE, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Check component modifications that override final elements
    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      if (!element.modification?.modificationArguments) continue;
      if (!element.classInstance) continue;

      for (const modArg of element.modification.modificationArguments) {
        const modName = (modArg as any).name?.text ?? (modArg as any).name;
        if (!modName) continue;

        // Check if the target element in the component's type is final
        try {
          for (const subEl of element.classInstance.elements) {
            if (subEl.name === modName && (subEl as any).isFinal) {
              const modText = (modArg as any).modificationExpression?.expression?.text ?? modName;
              diagnosticsCallback(
                ModelicaErrorCode.FINAL_OVERRIDE.severity,
                ModelicaErrorCode.FINAL_OVERRIDE.code,
                ModelicaErrorCode.FINAL_OVERRIDE.message(modName, modText),
                (modArg as any).ast ?? modArg,
              );
              break;
            }
          }
        } catch {
          // classInstance.elements may throw for unresolved types
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Outer modifier check
// Per Modelica Spec §5.4: outer components may not have modifiers
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.OUTER_MODIFIER, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!(node as any).isOuter) return;
    if ((node as any).isInner) return; // inner outer is okay

    const mod = node.modification;
    if (!mod) return;

    const modArgs = mod.modificationArguments;
    if (modArgs && modArgs.length > 0) {
      const modText = modArgs.map((a: any) => a.name?.text ?? a.name ?? "?").join(", ");
      diagnosticsCallback(
        ModelicaErrorCode.OUTER_MODIFIER.severity,
        ModelicaErrorCode.OUTER_MODIFIER.code,
        ModelicaErrorCode.OUTER_MODIFIER.message(modText, node.name ?? "?"),
        node.abstractSyntaxNode ?? null,
      );
    }

    // Also check the modification expression (direct binding)
    const modExpr = mod.modificationExpression;
    if (modExpr) {
      const exprText = (modExpr as any).expression?.text ?? "...";
      diagnosticsCallback(
        ModelicaErrorCode.OUTER_MODIFIER.severity,
        ModelicaErrorCode.OUTER_MODIFIER.code,
        ModelicaErrorCode.OUTER_MODIFIER.message(exprText, node.name ?? "?"),
        node.abstractSyntaxNode ?? null,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Component binding restriction
// Per Modelica Spec §4.6: models, blocks, and packages may not have binding
// equations on components of certain class kinds
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.COMPONENT_BINDING_RESTRICTION, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const classInst = node.classInstance;
    if (!classInst) return;

    // Check if component's type is a model, block, or package — those cannot have bindings
    const classKind = classInst.classKind;
    if (
      classKind !== ModelicaClassKind.MODEL &&
      classKind !== ModelicaClassKind.BLOCK &&
      classKind !== ModelicaClassKind.PACKAGE
    )
      return;

    // Check if there is a binding expression
    const mod = node.modification;
    if (!mod) return;
    const modExpr = mod.modificationExpression;
    if (!modExpr) return;

    diagnosticsCallback(
      ModelicaErrorCode.COMPONENT_BINDING_RESTRICTION.severity,
      ModelicaErrorCode.COMPONENT_BINDING_RESTRICTION.code,
      ModelicaErrorCode.COMPONENT_BINDING_RESTRICTION.message(node.name ?? "?", classKind as string),
      node.abstractSyntaxNode ?? null,
    );
  },
});

// ---------------------------------------------------------------------------
// Elsewhen variable mismatch
// Per Modelica Spec §8.3.5.3: when/elsewhen must solve the same variables
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    function getAssignedVars(eqs: any[]): Set<string> {
      const vars = new Set<string>();
      for (const eq of eqs) {
        if (eq instanceof ModelicaSimpleEquationSyntaxNode) {
          const lhs = eq.expression1;
          if (lhs && (lhs as any).parts) {
            const name = (lhs as any).parts.map((p: any) => p.identifier?.text ?? "?").join(".");
            vars.add(name);
          }
        }
      }
      return vars;
    }

    function checkWhenEquations(eqs: any[]): void {
      for (const eq of eqs) {
        if (eq instanceof WhenEq) {
          const whenVars = getAssignedVars(eq.equations ?? []);
          for (const elseWhen of (eq as any).elseWhenEquationClauses ?? []) {
            const elseVars = getAssignedVars(elseWhen.equations ?? []);
            // Check that they solve the same set of variables
            let mismatch = false;
            for (const v of whenVars) {
              if (!elseVars.has(v)) {
                mismatch = true;
                break;
              }
            }
            if (!mismatch) {
              for (const v of elseVars) {
                if (!whenVars.has(v)) {
                  mismatch = true;
                  break;
                }
              }
            }
            if (mismatch) {
              diagnosticsCallback(
                ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.severity,
                ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.code,
                ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.message(),
                elseWhen,
              );
            }
          }
        }
        // Recurse
        if (eq instanceof ForEq) checkWhenEquations(eq.equations ?? []);
        if (eq instanceof IfEq) {
          checkWhenEquations(eq.equations ?? []);
          checkWhenEquations(eq.elseEquations ?? []);
        }
      }
    }

    for (const section of astNode.sections ?? []) {
      if (section instanceof ModelicaEquationSectionSyntaxNode) {
        checkWhenEquations(section.equations ?? []);
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Cyclic dependency in function default arguments
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION) return;

    function collectReferences(expr: any): string[] {
      if (!expr) return [];
      const refs: string[] = [];
      const typeStr = expr["@type"];
      if (typeStr === "ComponentReference" || typeStr === "component_reference" || (expr.parts && !expr.operand1)) {
        const parts = expr.parts;
        if (parts && parts.length > 0) {
          const name = parts[0]?.identifier?.text;
          if (name) refs.push(name);
        }
      } else if (expr.operand1 && expr.operand2) {
        refs.push(...collectReferences(expr.operand1));
        refs.push(...collectReferences(expr.operand2));
      } else if (expr.operand && !expr.operand1) {
        refs.push(...collectReferences(expr.operand));
      } else if (expr.functionReference || expr.functionReferenceName) {
        if (expr.functionArguments && expr.functionArguments.expressions) {
          for (const arg of expr.functionArguments.expressions) {
            refs.push(...collectReferences(arg));
          }
        }
      } else if (typeStr === "ArrayConstructor" && expr.expressionList) {
        for (const sub of expr.expressionList.expressions ?? []) {
          refs.push(...collectReferences(sub));
        }
      } else if (expr.expressionList) {
        for (const sub of expr.expressionList.expressions ?? []) {
          refs.push(...collectReferences(sub));
        }
      }
      return refs;
    }

    const deps = new Map<string, string[]>();
    const compMap = new Map<string, ModelicaComponentInstance>();

    for (const el of node.elements) {
      if (
        el instanceof ModelicaComponentInstance &&
        (el.causality === "input" || el.causality === "output") &&
        el.name
      ) {
        const mod = el.modification?.modificationExpression?.expression;
        deps.set(el.name, mod ? collectReferences(mod) : []);
        compMap.set(el.name, el);
      }
    }

    function hasCycleFrom(start: string): boolean {
      const visited = new Set<string>();
      const stack = [start];

      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) break;
        const neighbors = deps.get(current) ?? [];
        for (const next of neighbors) {
          if (next === start) return true; // Cycle back to start
          if (!visited.has(next) && deps.has(next)) {
            visited.add(next);
            stack.push(next);
          }
        }
      }
      return false;
    }

    for (const [name, el] of compMap.entries()) {
      if (deps.has(name) && hasCycleFrom(name)) {
        diagnosticsCallback(
          ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.severity,
          ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.code,
          ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.message(name),
          el.abstractSyntaxNode ?? null,
        );
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Invalid prefix (inner/outer) on function formal parameters
// Per Modelica Spec §12.2: inner/outer prefixes are not allowed in functions
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.FUNCTION_INVALID_PREFIX, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION) return;

    for (const el of node.elements) {
      if (!(el instanceof ModelicaComponentInstance)) continue;
      if ((el as any).isInner) {
        diagnosticsCallback(
          ModelicaErrorCode.FUNCTION_INVALID_PREFIX.severity,
          ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code,
          ModelicaErrorCode.FUNCTION_INVALID_PREFIX.message("inner", el.name),
          el.abstractSyntaxNode ?? null,
        );
      }
      if ((el as any).isOuter) {
        diagnosticsCallback(
          ModelicaErrorCode.FUNCTION_INVALID_PREFIX.severity,
          ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code,
          ModelicaErrorCode.FUNCTION_INVALID_PREFIX.message("outer", el.name),
          el.abstractSyntaxNode ?? null,
        );
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Builtin 'time' is not allowed in functions
// Per Modelica Spec §3.7.3: time is only available in models and blocks
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.BUILTIN_TIME_INVALID, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION) return;

    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    function scanForTimeRefs(stmts: any[]): void {
      for (const stmt of stmts) {
        scanExprForTime(stmt);
      }
    }

    function scanExprForTime(expr: any): void {
      if (!expr) return;
      const typeStr = expr["@type"];
      // Check for component reference "time"
      if (typeStr === "ComponentReference" || typeStr === "component_reference") {
        const parts = expr.parts;
        if (parts && parts.length === 1) {
          const name = parts[0]?.identifier?.text;
          if (name === "time") {
            diagnosticsCallback(
              ModelicaErrorCode.BUILTIN_TIME_INVALID.severity,
              ModelicaErrorCode.BUILTIN_TIME_INVALID.code,
              "time is not allowed in a function.",
              expr,
            );
            return;
          }
        }
      }
      // Recurse into sub-expressions
      if (expr.operand1) scanExprForTime(expr.operand1);
      if (expr.operand2) scanExprForTime(expr.operand2);
      if (expr.operand && !expr.operand1) scanExprForTime(expr.operand);
      if (expr.expression) scanExprForTime(expr.expression);
      if (expr.target) scanExprForTime(expr.target);
      if (expr.value) scanExprForTime(expr.value);
      // Statements
      if (expr.statements) scanForTimeRefs(expr.statements);
      if (expr.elseStatements) scanForTimeRefs(expr.elseStatements);
      if (expr.elseIfStatementClauses) {
        for (const c of expr.elseIfStatementClauses) scanExprForTime(c);
      }
      if (expr.elseWhenStatementClauses) {
        for (const c of expr.elseWhenStatementClauses) scanExprForTime(c);
      }
      // Function call arguments
      if (expr.functionCallArguments?.arguments) {
        for (const arg of expr.functionCallArguments.arguments) {
          scanExprForTime(arg.expression ?? arg);
        }
      }
    }

    for (const section of astNode.sections ?? []) {
      if (section instanceof AlgoSection) {
        scanForTimeRefs(section.statements ?? []);
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Stream variable operator check
// Per Modelica Spec §15.2: inStream() and actualStream() arguments must be stream variables.
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.NOT_A_STREAM_VARIABLE, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    function scanForStreamCalls(stmtsOrEqs: any[]): void {
      for (const item of stmtsOrEqs) {
        scanExprForStream(item);
      }
    }

    function scanExprForStream(expr: any): void {
      if (!expr) return;
      const typeStr = expr["@type"];

      // Check for function calls
      if (typeStr === "FunctionCall" || typeStr === "function_call") {
        const funcName = expr.functionName?.text ?? expr.name?.text ?? expr.functionName ?? expr.functionReferenceName;
        if (funcName === "inStream" || funcName === "actualStream") {
          const args = expr.functionCallArguments?.arguments ?? expr.arguments ?? [];
          if (args.length > 0) {
            const arg = args[0].expression ?? args[0];
            let isValid = false;
            let argName = "Expression";

            if (arg["@type"] === "ComponentReference" || arg["@type"] === "component_reference") {
              const parts = arg.parts?.map((p: any) => p.identifier?.text ?? p.text) ?? [];
              argName = parts.join(".");
              if (parts.length > 0) {
                const resolved = node.resolveComponentReference(parts);
                // resolved should be a ModelicaComponentInstance
                if (resolved && (resolved as any).isComponentInstance) {
                  // Check if it's a stream variable
                  const isStream = (resolved as any).flowPrefix === "stream" || (resolved as any).flowPrefix === 2; // ModelicaFlow.STREAM
                  if (isStream) {
                    isValid = true;
                  }
                }
              }
            } else if (arg["@type"]) {
              // Extract a name for literals if possible
              if (arg.value !== undefined) argName = String(arg.value);
              else argName = arg.text ?? "Expression";
            }

            if (!isValid) {
              diagnosticsCallback(
                ModelicaErrorCode.NOT_A_STREAM_VARIABLE.severity,
                ModelicaErrorCode.NOT_A_STREAM_VARIABLE.code,
                ModelicaErrorCode.NOT_A_STREAM_VARIABLE.message(argName, funcName),
                arg,
              );
            }
          }
        }
      }

      // Recurse into sub-expressions
      if (expr.operand1) scanExprForStream(expr.operand1);
      if (expr.operand2) scanExprForStream(expr.operand2);
      if (expr.operand && !expr.operand1) scanExprForStream(expr.operand);
      if (expr.expression) scanExprForStream(expr.expression);
      if (expr.expression1) scanExprForStream(expr.expression1);
      if (expr.expression2) scanExprForStream(expr.expression2);
      if (expr.condition) scanExprForStream(expr.condition);
      if (expr.target) scanExprForStream(expr.target);
      if (expr.value) scanExprForStream(expr.value);

      // Statements / Equations
      if (expr.statements) scanForStreamCalls(expr.statements);
      if (expr.elseStatements) scanForStreamCalls(expr.elseStatements);
      if (expr.elseIfStatementClauses) {
        for (const c of expr.elseIfStatementClauses) scanExprForStream(c);
      }
      if (expr.elseWhenStatementClauses) {
        for (const c of expr.elseWhenStatementClauses) scanExprForStream(c);
      }
      if (expr.equations) scanForStreamCalls(expr.equations);
      if (expr.elseEquations) scanForStreamCalls(expr.elseEquations);
      if (expr.elseIfEquationClauses) {
        for (const c of expr.elseIfEquationClauses) scanExprForStream(c);
      }
      if (expr.elseWhenEquationClauses) {
        for (const c of expr.elseWhenEquationClauses) scanExprForStream(c);
      }

      // Function call arguments
      if (expr.functionCallArguments?.arguments) {
        for (const arg of expr.functionCallArguments.arguments) {
          scanExprForStream(arg.expression ?? arg);
        }
      }
    }

    for (const section of astNode.sections ?? []) {
      if (section.statements) {
        scanForStreamCalls(section.statements);
      }
      if (section.equations) {
        scanForStreamCalls(section.equations);
      }
    }

    // Also scan component bindings
    for (const element of astNode.elements ?? []) {
      const clauses =
        element["@type"] === "ComponentClause" ? [element] : element.componentClause ? [element.componentClause] : [];
      for (const clause of clauses) {
        for (const comp of clause.componentDeclarations ?? []) {
          if (comp.declaration?.modification?.modificationExpression) {
            scanExprForStream(comp.declaration.modification.modificationExpression);
          }
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Variability binding mismatch
// Per Modelica Spec §3.8.1: a constant/parameter may not have a binding
// expression with higher variability (e.g., continuous).
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Only check in models/blocks where continuous variables exist
    if (
      node.classKind !== ModelicaClassKind.MODEL &&
      node.classKind !== ModelicaClassKind.BLOCK &&
      node.classKind !== ModelicaClassKind.CLASS
    ) {
      return;
    }

    const VARIABILITY_ORDER: Record<string, number> = {
      constant: 0,
      parameter: 1,
      discrete: 2,
      continuous: 3,
    };

    for (const el of node.elements) {
      if (!(el instanceof ModelicaComponentInstance)) continue;
      const compVariability = (el as any).variability as string | undefined;
      if (!compVariability || compVariability === "continuous" || compVariability === "discrete") continue;

      // Check the binding expression for references to higher-variability components
      const mod = el.modification;
      const bindingExpr = mod?.modificationExpression?.expression ?? mod?.expression;
      if (!bindingExpr) continue;

      // Walk the binding expression to find component references
      const referencedNames = collectComponentRefs(bindingExpr);
      for (const refName of referencedNames) {
        // Look up the referenced component in the same class
        const referenced = node.resolveSimpleName(refName);
        if (!referenced || !(referenced instanceof ModelicaComponentInstance)) continue;
        const refVariability = (referenced as any).variability as string | undefined;
        // Default variability for components without explicit prefix is "continuous"
        const effectiveRefVariability = refVariability ?? "continuous";

        const compLevel = VARIABILITY_ORDER[compVariability] ?? 3;
        const refLevel = VARIABILITY_ORDER[effectiveRefVariability] ?? 3;
        if (refLevel > compLevel) {
          // Get a text representation of the binding
          const exprText = bindingExpr?.text ?? getExpressionText(bindingExpr);
          diagnosticsCallback(
            ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.severity,
            ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
            ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.message(
              el.name,
              compVariability,
              exprText,
              effectiveRefVariability,
            ),
            el.abstractSyntaxNode ?? null,
          );
          break; // One diagnostic per component is enough
        }
      }
    }
  },
});

/** Recursively collect top-level component reference names from an AST expression. */
function collectComponentRefs(expr: any): string[] {
  if (!expr) return [];
  const refs: string[] = [];
  const typeStr = expr["@type"];
  if (typeStr === "ComponentReference" || typeStr === "component_reference" || (expr.parts && !expr.operand1)) {
    const parts = expr.parts;
    if (parts && parts.length > 0) {
      const name = parts[0]?.identifier?.text;
      if (name) refs.push(name);
    }
  } else if (expr.operand1 && expr.operand2) {
    refs.push(...collectComponentRefs(expr.operand1));
    refs.push(...collectComponentRefs(expr.operand2));
  } else if (expr.operand && !expr.operand1) {
    refs.push(...collectComponentRefs(expr.operand));
  } else if (expr.functionReference || expr.functionReferenceName) {
    // cardinality() is a compile-time function that returns a parameter-variability constant.
    // Skip collecting component refs from its arguments to avoid false variability mismatches.
    const funcName =
      expr.functionReference?.parts?.[0]?.identifier?.text ??
      expr.functionReferenceName?.parts?.[0]?.identifier?.text ??
      "";
    if (funcName === "cardinality") return refs;
    for (const arg of expr.functionCallArguments?.arguments ?? []) {
      refs.push(...collectComponentRefs(arg.expression));
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Tuple expressions in invalid context: (a, b) only valid on LHS of := or =
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT, {
  visitOutputExpressionList(
    node: ModelicaOutputExpressionListSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    // Single-element output expressions are just parenthesized expressions, not tuples
    if (node.outputs.length <= 1) return;

    // Tuples are valid on the LHS of:
    // - ComplexAssignmentStatement: (x, y) := f()
    // - SimpleEquation: (x, y) = f()  (less common)
    const parentType = (node as any).parent?.["@type"];
    if (parentType === "ComplexAssignmentStatement" || parentType === "SimpleEquation") {
      return; // Valid context
    }

    // Build a text representation of the tuple for the error message
    const tupleElements = node.outputs.map((o) => (o as any)?.sourceText ?? (o as any)?.text ?? "_").join(", ");
    diagnosticsCallback(
      ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT.severity,
      ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT.code,
      ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT.message(`(${tupleElements})`),
      node,
    );
  },
});
