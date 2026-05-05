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
    // Do NOT call super.visitComponentInstance - that would recurse into the component's
    // type definition elements (via classInstance.elements), causing infinite recursion
    // for models with cyclic type references. The type itself is linted when visited as a class.
    ModelicaLinter.applyRules("visitComponentInstance", node, this.#diagnosticsCallback, resource);
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
// Type mismatch in bindings: Real → Integer is not allowed (§4.7)
// ---------------------------------------------------------------------------

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

/** Get the array shape of a class instance (empty array for scalars). */
function getArrayShape(cls: ModelicaClassInstance | null): number[] {
  if (cls instanceof ModelicaArrayClassInstance) {
    return (cls as any).shape ?? [];
  }
  return [];
}

ModelicaLinter.register(ModelicaErrorCode.TYPE_MISMATCH_BINDING, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Only check model/class/block contexts
    if (node.classKind === ModelicaClassKind.FUNCTION || node.classKind === ModelicaClassKind.PACKAGE) return;

    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      if (!element.classInstance) continue;

      const compTypeName = getBaseTypeName(element.classInstance);
      if (compTypeName !== "Integer") continue;

      // Check if the binding expression is Real-typed
      const mod = element.modification;
      if (!mod) continue;

      const bindingExpr = mod.modificationExpression?.expression;
      if (!bindingExpr) continue;

      // Check if the binding references a Real-typed component
      const refParts = (bindingExpr as any).parts;
      if (refParts && refParts.length === 1) {
        const refName = refParts[0]?.identifier?.text;
        if (refName) {
          const refElement = node.resolveSimpleName(refName, false, true);
          if (refElement instanceof ModelicaComponentInstance && refElement.classInstance) {
            const refTypeName = getBaseTypeName(refElement.classInstance);
            if (refTypeName === "Real") {
              const astNode = element.abstractSyntaxNode;
              diagnosticsCallback(
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.severity,
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(element.name ?? "", "Integer", refName, "Real"),
                astNode,
              );
            }
          }
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Type mismatch in arrays
// ---------------------------------------------------------------------------

ModelicaLinter.register(ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind === ModelicaClassKind.FUNCTION || node.classKind === ModelicaClassKind.PACKAGE) return;

    function checkExprShape(expr: any, expectedShape: number[]): boolean {
      if (!expr || expectedShape.length === 0) return true;
      if (node.name === "Array_builtin") {
        console.log("checkExprShape:", expr["@type"], expectedShape, "exprText:", expr.text);
      }
      if (expr["@type"] === "ArrayConstructor" && expr.expressionList) {
        const exprs = expr.expressionList.expressions ?? [];
        if (node.name === "Array_builtin") {
          console.log("exprs.length:", exprs.length);
        }
        if (exprs.length !== expectedShape[0]) {
          const exprText = "{...}";
          diagnosticsCallback(
            ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
            ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
            ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message(
              exprText,
              `Integer[${exprs.length}]`, // Simplified type string for error matching
              `${expectedShape[0]}`,
            ),
            expr,
          );
          return false;
        } else if (expectedShape.length > 1) {
          for (const child of exprs) {
            if (!checkExprShape(child, expectedShape.slice(1))) return false;
          }
        }
      }
      return true;
    }

    function getComponentArrayShape(comp: ModelicaComponentInstance): number[] {
      const dims = (comp as any).arrayDimensions;
      if (Array.isArray(dims)) {
        const shape = dims.map((d: any) => d.value);
        if (shape.some((v) => typeof v !== "number")) return [];
        return shape;
      }
      return [];
    }

    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      const expectedShape = getComponentArrayShape(element);
      if (expectedShape.length === 0) continue;

      if (node.name === "Array_builtin") {
        console.log("Checking element:", element.name, "modification:", element.modification);
      }

      // Check the element's modifications (bindings and attributes)
      for (const mod of element.modification?.modificationArguments ?? []) {
        const expr = (mod as any).expression;
        if (expr) {
          checkExprShape(expr, expectedShape);
        }
      }
      // Also check if the modification itself has an expression (for direct assignments)
      const directExpr = (element.modification as any)?.modificationExpression?.expression;
      if (directExpr) {
        checkExprShape(directExpr, expectedShape);
      }
    }
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
        const rhsRef = (eq.expression2 as any)?.parts;
        if (!lhsRef || !rhsRef) continue;
        if (lhsRef.length !== 1 || rhsRef.length !== 1) continue;

        const lhsName = lhsRef[0]?.identifier?.text;
        const rhsName = rhsRef[0]?.identifier?.text;
        if (!lhsName || !rhsName) continue;

        const lhsComp = node.resolveSimpleName(lhsName, false, true);
        const rhsComp = node.resolveSimpleName(rhsName, false, true);
        if (!(lhsComp instanceof ModelicaComponentInstance)) continue;
        if (!(rhsComp instanceof ModelicaComponentInstance)) continue;
        if (!lhsComp.classInstance || !rhsComp.classInstance) continue;

        const lhsShape = getArrayShape(lhsComp.classInstance);
        const rhsShape = getArrayShape(rhsComp.classInstance);

        // If both are arrays but shapes differ, report an error
        if (
          lhsShape.length > 0 &&
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
  ModelicaBinaryExpressionSyntaxNode as BinExpr,
  ModelicaBinaryOperator as BinOp,
  ModelicaSimpleAssignmentStatementSyntaxNode as SimpleAssign,
} from "@modelscript/modelica/ast";

/** Recursively check if an expression involves division, producing a Real result. */
function exprInvolvesDivision(expr: unknown): boolean {
  if (!expr) return false;
  if (expr instanceof BinExpr) {
    if (expr.operator === BinOp.DIVISION) return true;
    return exprInvolvesDivision(expr.operand1) || exprInvolvesDivision(expr.operand2);
  }
  return false;
}

ModelicaLinter.register(ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    for (const section of astNode.sections ?? []) {
      if (!(section instanceof AlgoSection)) continue;
      for (const stmt of section.statements ?? []) {
        if (!(stmt instanceof SimpleAssign)) continue;

        const targetParts = stmt.target?.parts;
        if (!targetParts || targetParts.length !== 1) continue;
        const targetName = targetParts[0]?.identifier?.text;
        if (!targetName) continue;

        const targetComp = node.resolveSimpleName(targetName, false, true);
        if (!(targetComp instanceof ModelicaComponentInstance)) continue;
        if (!targetComp.classInstance) continue;

        const targetType = getBaseTypeName(targetComp.classInstance);
        if (targetType !== "Integer") continue;

        // n1 / 2 always produces Real in Modelica (Integer division is `div()`)
        if (exprInvolvesDivision(stmt.source)) {
          diagnosticsCallback(
            ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.severity,
            ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
            ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.message(
              targetName,
              "Integer",
              (stmt.source as any).sourceText ?? "...",
              "Real",
            ),
            stmt,
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

ModelicaLinter.register(ModelicaErrorCode.NAME_NOT_FOUND, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const astNode = (node as any).abstractSyntaxNode;
    if (!astNode) return;

    for (const section of astNode.sections ?? []) {
      if (!(section instanceof ModelicaEquationSectionSyntaxNode) && !(section instanceof AlgoSection)) continue;

      // This is a simplified check. A full check requires walking the expression tree.
      // We will look for simple component references that fail to resolve.
      // But actually, `Capacitor` fails when its equations are instantiated into `comp1`.
      // So this check is best done in the DAE printer or flattener.
      // Let's add a quick check for simple unresolved names.
      for (const eq of (section as any).equations ?? []) {
        if (eq instanceof ModelicaSimpleEquationSyntaxNode) {
          const refs = [eq.expression1, eq.expression2];
          for (const expr of refs) {
            if (expr instanceof CompRef) {
              const parts = expr.parts;
              if (parts && parts.length > 0) {
                const firstName = parts[0]?.identifier?.text;
                if (firstName) {
                  const resolved = node.resolveSimpleName(firstName, false, true);
                  if (!resolved) {
                    diagnosticsCallback(
                      ModelicaErrorCode.NAME_NOT_FOUND.severity,
                      ModelicaErrorCode.NAME_NOT_FOUND.code,
                      ModelicaErrorCode.NAME_NOT_FOUND.message(firstName),
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
    checkModifications(
      node,
      node.modification?.modificationArguments,
      node.declaredType?.name ?? node.name,
      diagnosticsCallback,
    );
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
      modText = mod.arg?.value?.text ?? nameStr;
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
          const realOnly = ["nominal", "unconstrained", "stateSelect", "unit", "displayUnit"];
          const allowed = [...common];
          if (typeName === "Real" || typeName === "Integer" || typeName === "Enumeration") allowed.push(...realInt);
          if (typeName === "Real") allowed.push(...realOnly);
          if (allowed.includes(name)) {
            if (path.length === 1) return true; // resolved
            return null; // primitive attributes don't have nested members
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
          // For non-redeclares, use MODIFIER_CLASS_NOT_FOUND
          // OpenModelica sometimes uses the base class, sometimes the outer class, we use className.
          diagnosticsCallback(
            ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.severity,
            ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.code,
            ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.message(modText, nameStr, className),
            mod.ast ?? mod,
          );
        }
      } else {
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
