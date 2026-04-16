// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaAlgorithmSectionSyntaxNode,
  ModelicaArrayConcatenationSyntaxNode,
  ModelicaArrayConstructorSyntaxNode,
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBinaryOperator,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaCausality,
  ModelicaClassKind,
  ModelicaClassModificationSyntaxNode,
  ModelicaClassOrInheritanceModificationSyntaxNode,
  ModelicaComplexAssignmentStatementSyntaxNode,
  ModelicaComponentReferencePartSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaCompoundImportClauseSyntaxNode,
  ModelicaConnectEquationSyntaxNode,
  ModelicaDescriptionSyntaxNode,
  ModelicaElementModificationSyntaxNode,
  ModelicaEquationSectionSyntaxNode,
  ModelicaEquationSyntaxNode,
  ModelicaExtendsClauseSyntaxNode,
  ModelicaFlow,
  ModelicaForEquationSyntaxNode,
  ModelicaForStatementSyntaxNode,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIfEquationSyntaxNode,
  ModelicaIfStatementSyntaxNode,
  ModelicaInheritanceModificationSyntaxNode,
  ModelicaModificationExpressionSyntaxNode,
  ModelicaModificationSyntaxNode,
  ModelicaOutputExpressionListSyntaxNode,
  ModelicaProcedureCallStatementSyntaxNode,
  ModelicaSimpleAssignmentStatementSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
  ModelicaSimpleImportClauseSyntaxNode,
  ModelicaSpecialEquationSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxNode,
  ModelicaSyntaxPrinter,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnqualifiedImportClauseSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
  ModelicaVariability,
  ModelicaWhenEquationSyntaxNode,
  ModelicaWhenStatementSyntaxNode,
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
} from "@modelscript/modelica-polyglot/ast";
import { ModelicaArray } from "@modelscript/symbolics";
import type { Range, Tree } from "@modelscript/utils";
import { StringWriter } from "@modelscript/utils";
import { Scope } from "../scope.js";
import { ModelicaErrorCode, type ErrorCodeDef } from "./errors.js";
import {
  ENUMERATION_ATTRIBUTE_TYPES,
  ModelicaArrayClassInstance,
  ModelicaBooleanClassInstance,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaElementModification,
  ModelicaEntity,
  ModelicaEnumerationClassInstance,
  ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance,
  ModelicaLibrary,
  ModelicaModelVisitor,
  ModelicaModificationArgument,
  ModelicaNamedElement,
  ModelicaNode,
  ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance,
  ModelicaStringClassInstance,
  PREDEFINED_ATTRIBUTE_TYPES,
  type IModelicaModelVisitor,
} from "./model.js";

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
    this.#modelicaModelLinter = new ModelicaModelLinter(diagnosticsCallback, this.#modelicaSyntaxLinter);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  #modelicaSyntaxLinter: ModelicaSyntaxLinter;
  #visited = new Set<string>();
  /** Set of component names that have been declared as `inner` during traversal. */
  #knownInners = new Set<string>();

  /**
   * Initializes a new ModelicaModelLinter.
   *
   * @param diagnosticsCallback - The diagnostic reporting callback.
   * @param modelicaSyntaxLinter - A reference to the syntax linter for delegating deeper AST checks.
   */
  constructor(diagnosticsCallback: DiagnosticsCallback, modelicaSyntaxLinter: ModelicaSyntaxLinter) {
    super();
    this.#diagnosticsCallback = diagnosticsCallback;
    this.#modelicaSyntaxLinter = modelicaSyntaxLinter;
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
    node.storedDefinitionSyntaxNode?.accept(this.#modelicaSyntaxLinter, node.path);
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

ModelicaLinter.register(ModelicaErrorCode.DUPLICATE_ELEMENT, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const names = new Set();
    for (const element of node.elements) {
      if (element instanceof ModelicaNamedElement) {
        // Skip built-in type names (Real, Integer, Boolean, String, etc.)
        // Array class instances include the element type class as a named element
        if (element.name && BUILTIN_MODELICA_NAMES.has(element.name)) continue;
        if (names.has(element.name)) {
          let range: Range | null = null;
          if (element instanceof ModelicaClassInstance) {
            range = element.abstractSyntaxNode?.identifier ?? null;
          } else if (element instanceof ModelicaComponentInstance) {
            range = element.abstractSyntaxNode?.declaration?.identifier ?? null;
          }
          diagnosticsCallback(
            ModelicaErrorCode.DUPLICATE_ELEMENT.severity,
            ModelicaErrorCode.DUPLICATE_ELEMENT.code,
            ModelicaErrorCode.DUPLICATE_ELEMENT.message(element.name ?? ""),
            range,
          );
        } else {
          names.add(element.name);
        }
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.IDENTIFIER_MISMATCH, {
  visitLongClassSpecifier(
    node: ModelicaLongClassSpecifierSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (node.identifier?.text !== node.endIdentifier?.text) {
      diagnosticsCallback(
        ModelicaErrorCode.IDENTIFIER_MISMATCH.severity,
        ModelicaErrorCode.IDENTIFIER_MISMATCH.code,
        ModelicaErrorCode.IDENTIFIER_MISMATCH.message(),
        node.identifier,
      );
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.CLASS_NOT_FOUND, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.instantiated) node.instantiate();
    if (node.classInstance == null) {
      const typeSpecifier = node.abstractSyntaxNode?.parent?.typeSpecifier;
      diagnosticsCallback(
        ModelicaErrorCode.CLASS_NOT_FOUND.severity,
        ModelicaErrorCode.CLASS_NOT_FOUND.code,
        ModelicaErrorCode.CLASS_NOT_FOUND.message(typeSpecifier?.text ?? "", node.parent?.name ?? ""),
        typeSpecifier,
      );
    }
  },
});

/**
 * Built-in Modelica names that are always in scope.
 * These include:
 *  - time: the independent simulation variable
 *  - der, pre, edge, change, reinit, initial, terminal, sample, noEvent, smooth, delay, cardinality,
 *    inStream, actualStream: built-in operators
 *  - assert, print, terminate: built-in assertions/utilities
 *  - abs, sign, sqrt, exp, log, log10, sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh,
 *    floor, ceil, integer, mod, rem, div, max, min, sum, product, ndims, size, zeros, ones, fill,
 *    identity, diagonal, transpose, cat, scalar, vector, matrix, cross, skew, outerProduct, symmetric,
 *    String, Integer, Boolean, Real, Modelica: built-in functions and types
 */
const BUILTIN_MODELICA_NAMES = new Set([
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
]);

class ModelicaExpressionNameResolutionVisitor extends ModelicaSyntaxVisitor<void, DiagnosticsCallbackWithoutResource> {
  #scope: Scope;
  #localNames = new Set<string>();
  #brokenComponents: Set<string>;

  constructor(scope: Scope, brokenComponents?: Set<string>) {
    super();
    this.#scope = scope;
    this.#brokenComponents = brokenComponents ?? new Set();
  }

  override visitComponentReference(
    node: ModelicaComponentReferenceSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const fullPath = node.parts.map((p) => p.identifier?.text).join(".");
    const firstName = fullPath.split(".")[0] ?? fullPath;

    // Skip built-in names and for-loop iterator variables
    if (BUILTIN_MODELICA_NAMES.has(firstName) || this.#localNames.has(firstName)) {
      return;
    }

    // Skip references through components whose types have broken equations
    if (this.#brokenComponents.has(firstName)) {
      return;
    }

    const resolved = this.#scope.resolveName(fullPath.split("."));
    if (!resolved) {
      diagnosticsCallback(
        ModelicaErrorCode.NAME_NOT_FOUND.severity,
        ModelicaErrorCode.NAME_NOT_FOUND.code,
        ModelicaErrorCode.NAME_NOT_FOUND.message(fullPath),
        node,
      );
    }
  }

  override visitForStatement(
    node: ModelicaForStatementSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    // Add for-loop iterator names to local scope
    const iteratorNames: string[] = [];
    for (const forIndex of node.forIndexes) {
      const name = forIndex.identifier?.text;
      if (name) {
        iteratorNames.push(name);
        this.#localNames.add(name);
      }
    }
    // Visit body with iterators in scope
    super.visitForStatement(node, diagnosticsCallback);
    // Remove iterator names after leaving the for-loop
    for (const name of iteratorNames) {
      this.#localNames.delete(name);
    }
  }

  override visitForEquation(
    node: ModelicaForEquationSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    // Add for-loop iterator names to local scope
    const iteratorNames: string[] = [];
    for (const forIndex of node.forIndexes) {
      const name = forIndex.identifier?.text;
      if (name) {
        iteratorNames.push(name);
        this.#localNames.add(name);
      }
    }
    // Visit body with iterators in scope
    super.visitForEquation(node, diagnosticsCallback);
    // Remove iterator names after leaving the for-loop
    for (const name of iteratorNames) {
      this.#localNames.delete(name);
    }
  }
}

ModelicaLinter.register(ModelicaErrorCode.NAME_NOT_FOUND, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // First pass: check component types' equations for unresolved names.
    // When a component's type has broken equations (e.g. Capacitor references `i` but
    // doesn't extend TwoPin), report the error and mark the component as broken so that
    // references through it (e.g. `comp1.p`) are skipped in the parent class.
    const brokenComponents = new Set<string>();
    for (const comp of node.components) {
      if (!comp.name) continue;
      const classInstance = comp.classInstance;
      if (!classInstance) continue;
      // Only check compound types (models, blocks, etc.) that have their own equations
      if (classInstance instanceof ModelicaPredefinedClassInstance) continue;
      if (classInstance instanceof ModelicaEnumerationClassInstance) continue;
      if (classInstance instanceof ModelicaArrayClassInstance) continue;

      const compVisitor = new ModelicaExpressionNameResolutionVisitor(classInstance);
      let hasError = false;
      const checkCallback: DiagnosticsCallbackWithoutResource = (
        type: string,
        code: number,
        message: string,
        range: Range | null | undefined,
      ) => {
        if (hasError) return; // Stop after first error per component (matches OMC behavior)
        hasError = true;
        // Report with OMC format: "Variable X not found in scope TypeName$CompName."
        const varName = message.match(/Name '(.+)' not found/)?.[1] ?? "";
        diagnosticsCallback(
          type,
          code,
          `Variable ${varName} not found in scope ${classInstance.name ?? ""}$${comp.name}.`,
          range,
        );
      };
      for (const equationSection of classInstance.equationSections) {
        if (hasError) break;
        equationSection.accept(compVisitor, checkCallback);
      }
      for (const algorithmSection of classInstance.algorithmSections) {
        if (hasError) break;
        algorithmSection.accept(compVisitor, checkCallback);
      }
      if (hasError) {
        brokenComponents.add(comp.name);
      }
    }

    // Second pass: visit own equations, skipping references through broken components
    const visitor = new ModelicaExpressionNameResolutionVisitor(node, brokenComponents);
    for (const equationSection of node.equationSections) {
      equationSection.accept(visitor, diagnosticsCallback);
    }
    for (const algorithmSection of node.algorithmSections) {
      algorithmSection.accept(visitor, diagnosticsCallback);
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.UNBALANCED_MODEL, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Balanced model check only applies to models and blocks
    if (node.classKind !== ModelicaClassKind.MODEL && node.classKind !== ModelicaClassKind.BLOCK) return;

    // Count unknowns: only primitive-type (Real, Integer, Boolean, String) components
    // that are not parameters or constants.
    // Compound component instances (models, blocks, connectors) are internally balanced
    // and contribute 0 net unknowns at the parent level.
    let nVariables = 0;
    for (const component of node.components) {
      if (
        component.variability !== ModelicaVariability.PARAMETER &&
        component.variability !== ModelicaVariability.CONSTANT
      ) {
        const classKind = component.classInstance?.classKind;
        // Only count primitive-type variables; skip compound types (MODEL, BLOCK, CONNECTOR, etc.)
        if (classKind == null || classKind === ModelicaClassKind.TYPE || classKind === ModelicaClassKind.CLASS) {
          nVariables++;
        }
      }
    }

    // Count equations from equation sections, excluding connect() equations.
    // Connect equations expand into topology-based equations (potential equality + flow balance)
    // and cannot be counted 1:1.
    function getEquationCount(eqs: Iterable<ModelicaEquationSyntaxNode>): number {
      let count = 0;
      for (const eq of eqs) {
        if (eq instanceof ModelicaConnectEquationSyntaxNode) {
          continue; // Topology, skip
        } else if (eq instanceof ModelicaWhenEquationSyntaxNode) {
          // when-equations contribute the sum of their inner equations
          count += getEquationCount(eq.equations);
          for (const elseWhen of eq.elseWhenEquationClauses) {
            count += getEquationCount(elseWhen.equations);
          }
        } else if (eq instanceof ModelicaIfEquationSyntaxNode) {
          // Assume branches are meant to be balanced; count the 'then' block
          count += getEquationCount(eq.equations);
        } else if (eq instanceof ModelicaForEquationSyntaxNode) {
          // Static counting of for-loops is an approximation
          count += getEquationCount(eq.equations);
        } else if (eq instanceof ModelicaSpecialEquationSyntaxNode) {
          // Standard function calls count as 0 (procedural side effects) or returned components
          // reinit() is explicitly defined to NOT count as an equation.
          const name = eq.functionReference?.parts?.[0]?.identifier?.text;
          if (name !== "reinit") {
            // OMC ignores assert/print as well.
          }
        } else {
          // Simple equations and other constructs count as 1
          count++;
        }
      }
      return count;
    }

    let nEquations = getEquationCount(node.equations);

    // Each algorithm section contributes as many equations as assigned variables.
    // As a simplification, count each statement as one equation.
    nEquations += Array.from(node.algorithms).length;

    if (nEquations !== nVariables) {
      diagnosticsCallback(
        ModelicaErrorCode.UNBALANCED_MODEL.severity,
        ModelicaErrorCode.UNBALANCED_MODEL.code,
        ModelicaErrorCode.UNBALANCED_MODEL.message(
          String(node.classKind),
          node.name ?? "",
          String(nEquations),
          String(nVariables),
        ),
        node.abstractSyntaxNode?.identifier,
      );
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.MODIFIER_NOT_FOUND, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.instantiated) node.instantiate();
    const classInstance = node.classInstance;
    if (!classInstance || !classInstance.abstractSyntaxNode) return;

    // For predefined types (Real, Integer, Boolean, String) and enumerations,
    // modifiers target built-in type attributes (§4.9) which don't appear in
    // the elements iterator. Validate names and types against the known attribute maps.
    if (
      classInstance instanceof ModelicaPredefinedClassInstance ||
      classInstance instanceof ModelicaEnumerationClassInstance
    ) {
      const modification = node.modification;
      if (!modification) return;
      const attrMap =
        classInstance instanceof ModelicaPredefinedClassInstance
          ? (PREDEFINED_ATTRIBUTE_TYPES[classInstance.name ?? ""] ?? ENUMERATION_ATTRIBUTE_TYPES)
          : ENUMERATION_ATTRIBUTE_TYPES;
      for (const modArg of modification.modificationArguments) {
        const name = modArg.name;
        if (!name || name === "annotation") continue;
        const expectedType = attrMap[name];
        if (!expectedType) {
          // Unknown attribute name
          diagnosticsCallback(
            ModelicaErrorCode.MODIFIER_NOT_FOUND.severity,
            ModelicaErrorCode.MODIFIER_NOT_FOUND.code,
            ModelicaErrorCode.MODIFIER_NOT_FOUND.message(name, node.name ?? "", classInstance.name ?? ""),
            node.abstractSyntaxNode?.declaration?.identifier,
          );
          continue;
        }
        // Type-check the modifier value
        if (modArg instanceof ModelicaElementModification) {
          const exprSyntax = modArg.modificationExpression?.expression;
          // Check literals (Integer, Real, Boolean, String)
          const literalType = getLiteralTypeName(exprSyntax);
          if (literalType && literalType !== expectedType && !isImplicitlyConvertible(literalType, expectedType)) {
            diagnosticsCallback(
              ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.severity,
              ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
              ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.message(name, expectedType, literalType),
              modArg.modificationExpression,
            );
          }
          // Check component references (enum literals like enum.a, StateSelect.default)
          if (!literalType && exprSyntax instanceof ModelicaComponentReferenceSyntaxNode) {
            const scope = modArg.scope ?? node.parent;
            if (scope) {
              const resolvedComp = resolveToComponent(scope as Scope, exprSyntax);
              if (resolvedComp) {
                if (!resolvedComp.instantiated) resolvedComp.instantiate();
                const exprType = resolvedComp.classInstance;
                // For enumeration attributes, the value must belong to the same enum type
                if (expectedType === "enumeration" && classInstance instanceof ModelicaEnumerationClassInstance) {
                  if (
                    exprType &&
                    !(exprType instanceof ModelicaEnumerationClassInstance) &&
                    !classInstance.isTypeCompatibleWith(exprType)
                  ) {
                    diagnosticsCallback(
                      ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.severity,
                      ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
                      ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.message(
                        name,
                        classInstance.name ?? "enumeration",
                        exprType.name ?? "",
                      ),
                      modArg.modificationExpression,
                    );
                  }
                } else if (expectedType === "StateSelect") {
                  // StateSelect values must reference the StateSelect enumeration
                  const refName = exprSyntax.parts.map((p) => p.identifier?.text ?? "").join(".");
                  if (!refName.startsWith("StateSelect.")) {
                    diagnosticsCallback(
                      ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.severity,
                      ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
                      ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.message(name, "StateSelect", refName),
                      modArg.modificationExpression,
                    );
                  }
                }
              }
            }
          }
        }
      }
      return;
    }

    const modification = node.modification;
    if (!modification) return;

    // Collect declared element names in the component's type
    const declaredNames = new Set<string>();
    for (const element of classInstance.elements) {
      if (element instanceof ModelicaNamedElement && element.name) {
        declaredNames.add(element.name);
      }
    }

    for (const modArg of modification.modificationArguments) {
      const name = modArg.name;
      if (name && name !== "annotation" && !declaredNames.has(name)) {
        diagnosticsCallback(
          ModelicaErrorCode.MODIFIER_NOT_FOUND.severity,
          ModelicaErrorCode.MODIFIER_NOT_FOUND.code,
          ModelicaErrorCode.MODIFIER_NOT_FOUND.message(name, node.name ?? "", classInstance.name ?? ""),
          node.abstractSyntaxNode?.declaration?.identifier,
        );
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.DUPLICATE_MODIFICATION, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const modSyntaxNode = node.abstractSyntaxNode?.declaration?.modification;
    const classModArgs = modSyntaxNode?.classModification?.modificationArguments ?? [];
    if (classModArgs.length < 2) return;

    // Build element modifications grouped by top-level name
    const byName = new Map<string, ModelicaElementModificationSyntaxNode[]>();
    for (const arg of classModArgs) {
      if (arg instanceof ModelicaElementModificationSyntaxNode) {
        const name = arg.name?.parts?.[0]?.text;
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)?.push(arg);
      }
    }

    for (const [name, mods] of byName) {
      if (mods.length <= 1) continue;
      // Collect full dot-paths that set a value (have a modification expression)
      const paths: { path: string; syntaxNode: ModelicaElementModificationSyntaxNode }[] = [];
      for (const mod of mods) {
        const fullPath = mod.name?.parts?.map((c) => c.text ?? "").join(".") ?? name;
        if (mod.modification?.modificationExpression) {
          paths.push({ path: fullPath, syntaxNode: mod });
        }
        // Also check sub-arguments for nested paths
        for (const subArg of mod.modification?.classModification?.modificationArguments ?? []) {
          if (subArg instanceof ModelicaElementModificationSyntaxNode && subArg.modification?.modificationExpression) {
            const subPath = fullPath + "." + (subArg.name?.parts?.map((c) => c.text ?? "").join(".") ?? "");
            paths.push({ path: subPath, syntaxNode: subArg });
          }
        }
      }
      // Check for duplicate paths
      const seen = new Map<string, ModelicaElementModificationSyntaxNode>();
      for (const { path, syntaxNode } of paths) {
        if (seen.has(path)) {
          diagnosticsCallback(
            ModelicaErrorCode.DUPLICATE_MODIFICATION.severity,
            ModelicaErrorCode.DUPLICATE_MODIFICATION.code,
            ModelicaErrorCode.DUPLICATE_MODIFICATION.message(path, node.name ?? ""),
            syntaxNode,
          );
        } else {
          seen.set(path, syntaxNode);
        }
      }
    }
  },
});

/**
 * Recursively checks array dimensional matches between an array type declaration
 * and its modifying expressions or substructure modifications.
 *
 * @param classInstance - The array class instance describing the element type and expected shape.
 * @param modArgs - A list of modification arguments applied to the array.
 * @param diagnosticsCallback - The diagnostic reporting callback.
 * @param range - The syntax trace range to associate with any produced errors.
 */
function checkArrayModDimensions(
  classInstance: ModelicaClassInstance,
  modArgs: ModelicaModificationArgument[],
  diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  range: Range | null | undefined,
): void {
  for (const modArg of modArgs) {
    const name = modArg.name;
    if (!name || name === "annotation") continue;

    // Resolve the target element in the component's type
    const target = classInstance.resolveSimpleName(name, false, true);
    if (!(target instanceof ModelicaComponentInstance)) continue;

    if (!target.instantiated) target.instantiate();
    const targetClass = target.classInstance;

    if (targetClass instanceof ModelicaArrayClassInstance) {
      const shape = targetClass.shape;
      if (shape.length === 0) continue;

      // Check the modification's own expression (e.g. y = {{...}})
      const argExpr = modArg.expression;
      if (
        argExpr instanceof ModelicaArray &&
        !(argExpr.flatShape.includes(0) && argExpr.flatShape.some((d: number) => d > 0)) &&
        !argExpr.assignable(shape)
      ) {
        diagnosticsCallback(
          ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
          ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
          ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message(`'${name}'`, String(argExpr.flatShape), String(shape)),
          range,
        );
      }

      // Check sub-modification argument expressions (e.g. y(start = {{...}}))
      if (modArg instanceof ModelicaElementModification) {
        for (const subArg of modArg.modificationArguments) {
          const subExpr = subArg.expression;
          if (
            subExpr instanceof ModelicaArray &&
            !(subExpr.flatShape.includes(0) && subExpr.flatShape.some((d: number) => d > 0)) &&
            !subExpr.assignable(shape)
          ) {
            diagnosticsCallback(
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message(
                `'${subArg.name}' of '${name}'`,
                String(subExpr.flatShape),
                String(shape),
              ),
              range,
            );
          }
        }
      }
    }

    // Recurse into nested modifications (e.g. arr(y(start = ...)) where arr contains y)
    if (targetClass && modArg instanceof ModelicaElementModification && modArg.modificationArguments.length > 0) {
      checkArrayModDimensions(targetClass, modArg.modificationArguments, diagnosticsCallback, range);
    }
  }
}

ModelicaLinter.register(ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.instantiated) node.instantiate();
    const classInstance = node.classInstance;
    if (!classInstance) return;

    const modification = node.modification;
    if (!modification) return;

    const range = node.abstractSyntaxNode?.declaration?.modification ?? null;

    // Direct array component: check top-level and attribute expressions
    if (classInstance instanceof ModelicaArrayClassInstance) {
      const shape = classInstance.shape;
      if (shape.length > 0) {
        const expr = modification.expression;
        if (
          expr instanceof ModelicaArray &&
          !expr.flatShape.includes(0) &&
          !shape.includes(0) &&
          !expr.assignable(shape)
        ) {
          diagnosticsCallback(
            ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
            ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
            ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message("expression", String(expr.flatShape), String(shape)),
            range,
          );
        }
        for (const modArg of modification.modificationArguments) {
          const argExpr = modArg.expression;
          if (
            argExpr instanceof ModelicaArray &&
            !argExpr.flatShape.includes(0) &&
            !shape.includes(0) &&
            !argExpr.assignable(shape)
          ) {
            diagnosticsCallback(
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message(
                `'${modArg.name}'`,
                String(argExpr.flatShape),
                String(shape),
              ),
              range,
            );
          }
        }
      }
    }

    // Recursively check nested modifications against resolved sub-components
    checkArrayModDimensions(classInstance, modification.modificationArguments, diagnosticsCallback, range);
  },
});

/**
 * Resolve a component reference to the final ModelicaComponentInstance in the path.
 * For `a.b.c`, resolves a → follows to a's type → resolves b → follows to b's type → resolves c.
 * Returns the LAST component instance (c), or null if resolution fails.
 */
function resolveToComponent(
  scope: Scope,
  componentRef: ModelicaComponentReferenceSyntaxNode | null,
): ModelicaComponentInstance | null {
  if (!componentRef) return null;
  const parts = componentRef.parts;
  if (parts.length === 0) return null;

  // Resolve first part in the given scope
  let element: ModelicaNamedElement | null = scope.resolveSimpleName(parts[0]?.identifier, componentRef.global);
  if (!(element instanceof ModelicaComponentInstance)) return null;

  // Follow through remaining parts
  for (let i = 1; i < parts.length; i++) {
    if (!element.instantiated && !element.instantiating) (element as ModelicaComponentInstance).instantiate();
    const classInst: ModelicaClassInstance | null = (element as ModelicaComponentInstance).classInstance;
    if (!classInst) return null;
    element = classInst.resolveSimpleName(parts[i]?.identifier, false, true);
    if (!(element instanceof ModelicaComponentInstance)) return null;
  }

  return element as ModelicaComponentInstance;
}

/** Get human-readable text for a component reference like "a.b.c" */
function componentRefText(ref: ModelicaComponentReferenceSyntaxNode | null): string {
  if (!ref) return "?";
  return ref.parts.map((p) => p.identifier?.text ?? "?").join(".");
}

/**
 * Custom syntax visitor to traverse expression ASTs inside a class instance
 * and validate array subscript dimensionalities and valid types.
 */
class ArraySubscriptChecker extends ModelicaSyntaxVisitor<null, null> {
  #diagnosticsCallback: DiagnosticsCallbackWithoutResource;
  #scope: ModelicaClassInstance;

  constructor(diagnosticsCallback: DiagnosticsCallbackWithoutResource, scope: ModelicaClassInstance) {
    super();
    this.#diagnosticsCallback = diagnosticsCallback;
    this.#scope = scope;
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, context: null): null {
    if (!node.parts || node.parts.length === 0) return super.visitComponentReference(node, context);

    let currentElement: ModelicaComponentInstance | null;
    const firstResolved = this.#scope.resolveSimpleName(node.parts[0]?.identifier, node.global);
    if (firstResolved instanceof ModelicaComponentInstance) {
      currentElement = firstResolved;
    } else {
      return super.visitComponentReference(node, context);
    }

    for (let i = 0; i < node.parts.length; i++) {
      const part = node.parts[i];
      if (!part || !currentElement) break;

      const subscripts = part.arraySubscripts?.subscripts;
      if (subscripts && subscripts.length > 0) {
        if (!currentElement.instantiated && !currentElement.instantiating) currentElement.instantiate();
        const classInst = currentElement.classInstance;

        let expectedCount = 0;
        if (classInst instanceof ModelicaArrayClassInstance) {
          expectedCount = classInst.shape.length;
        }

        if (expectedCount > 0 && expectedCount !== subscripts.length) {
          this.#diagnosticsCallback(
            ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.severity,
            ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.code,
            ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH.message(
              currentElement.name ?? "?",
              String(subscripts.length),
              String(expectedCount),
            ),
            part.arraySubscripts,
          );
        }

        // Validate index Types: Reject Real / String values
        for (const sub of subscripts) {
          if (
            sub.expression instanceof ModelicaUnsignedRealLiteralSyntaxNode ||
            (sub.expression instanceof ModelicaUnaryExpressionSyntaxNode &&
              sub.expression.operand instanceof ModelicaUnsignedRealLiteralSyntaxNode)
          ) {
            this.#diagnosticsCallback(
              ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.severity,
              ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.code,
              ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.message("Real"),
              sub.expression,
            );
          } else if (sub.expression instanceof ModelicaStringLiteralSyntaxNode) {
            this.#diagnosticsCallback(
              ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.severity,
              ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.code,
              ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.message("String"),
              sub.expression,
            );
          } else if (sub.expression instanceof ModelicaComponentReferenceSyntaxNode) {
            const indexComp = resolveToComponent(this.#scope, sub.expression);
            if (indexComp) {
              if (!indexComp.instantiated && !indexComp.instantiating) indexComp.instantiate();
              const indexClass = indexComp.classInstance;
              if (indexClass instanceof ModelicaRealClassInstance) {
                this.#diagnosticsCallback(
                  ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.severity,
                  ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.code,
                  ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.message("Real"),
                  sub.expression,
                );
              } else if (indexClass instanceof ModelicaStringClassInstance) {
                this.#diagnosticsCallback(
                  ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.severity,
                  ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.code,
                  ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH.message("String"),
                  sub.expression,
                );
              }
            }
          }
        }
      }

      // Advance to the next part in the reference chain (e.g. `a[1].b`)
      if (i < node.parts.length - 1) {
        if (!currentElement.instantiated && !currentElement.instantiating) currentElement.instantiate();
        const classInst: ModelicaClassInstance | null = currentElement.classInstance;
        let nextScope: ModelicaClassInstance | null = classInst;
        // "unwrap" the array if we are probing into the shape of its elements
        if (classInst instanceof ModelicaArrayClassInstance) {
          nextScope = classInst.elementClassInstance;
        }
        if (!nextScope) break;

        const nextElement = nextScope.resolveSimpleName(node.parts[i + 1]?.identifier, false, true);
        if (!(nextElement instanceof ModelicaComponentInstance)) break;
        currentElement = nextElement;
      }
    }

    return super.visitComponentReference(node, context);
  }
}

// Rule: Array Subscript Count && Type mismatched indexing
ModelicaLinter.register(
  [ModelicaErrorCode.ARRAY_SUBSCRIPT_COUNT_MISMATCH, ModelicaErrorCode.ARRAY_INDEX_TYPE_MISMATCH],
  {
    visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
      const checker = new ArraySubscriptChecker(diagnosticsCallback, node);

      // Run checker on all equations (equations are syntax nodes)
      for (const eq of node.equations) {
        eq.accept(checker, null);
      }
      // Run checker on all algorithms (algorithms are syntax nodes)
      for (const alg of node.algorithms) {
        alg.accept(checker, null);
      }
      // Run checker on component syntax nodes to capture modifications
      for (const element of node.elements) {
        if (element instanceof ModelicaComponentInstance) {
          element.abstractSyntaxNode?.accept(checker, null);
        }
      }
    },
  },
);

// Rule: Connect equation — both sides must be connectors and plug-compatible
ModelicaLinter.register([ModelicaErrorCode.NOT_A_CONNECTOR, ModelicaErrorCode.NOT_PLUG_COMPATIBLE], {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const equation of node.equations) {
      if (!(equation instanceof ModelicaConnectEquationSyntaxNode)) continue;

      const comp1 = resolveToComponent(node, equation.componentReference1);
      const comp2 = resolveToComponent(node, equation.componentReference2);

      if (!comp1 || !comp2) continue; // unresolved — name resolution rule already reports

      if (!comp1.instantiated) comp1.instantiate();
      if (!comp2.instantiated) comp2.instantiate();

      const type1 = comp1.classInstance;
      const type2 = comp2.classInstance;

      if (!type1 || !type2) continue;

      const ref1Text = componentRefText(equation.componentReference1);
      const ref2Text = componentRefText(equation.componentReference2);

      // Check both sides are connectors (or variables with input/output causality)
      const isConnector1 =
        type1.isExpandable ||
        type1.classKind === ModelicaClassKind.CONNECTOR ||
        comp1.causality === ModelicaCausality.INPUT ||
        comp1.causality === ModelicaCausality.OUTPUT;

      if (!isConnector1) {
        diagnosticsCallback(
          ModelicaErrorCode.NOT_A_CONNECTOR.severity,
          ModelicaErrorCode.NOT_A_CONNECTOR.code,
          ModelicaErrorCode.NOT_A_CONNECTOR.message(ref1Text, ref2Text, ref1Text),
          equation.componentReference1,
        );
      }

      const isConnector2 =
        type2.isExpandable ||
        type2.classKind === ModelicaClassKind.CONNECTOR ||
        comp2.causality === ModelicaCausality.INPUT ||
        comp2.causality === ModelicaCausality.OUTPUT;

      if (!isConnector2) {
        diagnosticsCallback(
          ModelicaErrorCode.NOT_A_CONNECTOR.severity,
          ModelicaErrorCode.NOT_A_CONNECTOR.code,
          ModelicaErrorCode.NOT_A_CONNECTOR.message(ref1Text, ref2Text, ref2Text),
          equation.componentReference2,
        );
      }

      // Check plug compatibility
      if (!type1.isPlugCompatibleWith(type2)) {
        diagnosticsCallback(
          ModelicaErrorCode.NOT_PLUG_COMPATIBLE.severity,
          ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
          ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(ref1Text, ref2Text),
          equation,
        );
      }
    }
  },
});

// Rule: Modification argument type checking — modifier targets must have compatible types
ModelicaLinter.register(ModelicaErrorCode.TYPE_MISMATCH_MODIFIER, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.instantiated) node.instantiate();
    const classInstance = node.classInstance;
    if (!classInstance || !classInstance.abstractSyntaxNode) return;

    const modification = node.modification;
    if (!modification) return;

    for (const modArg of modification.modificationArguments) {
      if (!(modArg instanceof ModelicaElementModification)) continue;
      const name = modArg.name;
      if (!name || name === "annotation") continue;

      // Resolve the target element in the component's type
      const target = classInstance.resolveSimpleName(name, false, true);
      if (!(target instanceof ModelicaComponentInstance)) continue;

      if (!target.instantiated) target.instantiate();
      const targetType = target.classInstance;
      if (!targetType) continue;

      // If the modifier has a value expression, check its type against the target
      const expr = modArg.expression;
      if (!expr) continue;

      // Get the expression's type — we can only check when we have concrete type info
      // For now, check predefined type mismatches via the expression's resolved type
      const exprScope = modArg.scope;
      if (!exprScope) continue;

      // Check if expression is a component reference that resolves to a typed component
      const modSyntax = modArg.modificationExpression?.expression;
      if (modSyntax instanceof ModelicaComponentReferenceSyntaxNode) {
        const resolvedComp = resolveToComponent(exprScope as Scope, modSyntax);
        if (resolvedComp) {
          if (!resolvedComp.instantiated) resolvedComp.instantiate();
          const exprType = resolvedComp.classInstance;
          if (exprType && targetType && !targetType.isTypeCompatibleWith(exprType)) {
            diagnosticsCallback(
              ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.severity,
              ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
              ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.message(name, targetType.name ?? "", exprType.name ?? ""),
              modArg.modificationExpression,
            );
          }
        }
      }
    }
  },
});

/** Get the Modelica type name for a literal syntax node, or null if not a literal. */
function getLiteralTypeName(
  node: import("@modelscript/modelica-polyglot/ast").ModelicaExpressionSyntaxNode | null | undefined,
): string | null {
  if (node instanceof ModelicaBooleanLiteralSyntaxNode) return "Boolean";
  if (node instanceof ModelicaStringLiteralSyntaxNode) return "String";
  if (node instanceof ModelicaUnsignedIntegerLiteralSyntaxNode) return "Integer";
  if (node instanceof ModelicaUnsignedRealLiteralSyntaxNode) return "Real";
  // Negated literals (e.g. -1)
  if (node instanceof ModelicaUnaryExpressionSyntaxNode) {
    if (node.operand instanceof ModelicaUnsignedIntegerLiteralSyntaxNode) return "Integer";
    if (node.operand instanceof ModelicaUnsignedRealLiteralSyntaxNode) return "Real";
  }
  return null;
}

/** Check if a Modelica type can be implicitly converted to another (Integer → Real). */
function isImplicitlyConvertible(fromType: string, toType: string): boolean {
  return fromType === "Integer" && toType === "Real";
}

// Rule: Binding equation type checking — component = expr must have compatible types
ModelicaLinter.register(ModelicaErrorCode.TYPE_MISMATCH_BINDING, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.instantiated) node.instantiate();
    const classInstance = node.classInstance;
    if (!classInstance) return;

    // Check the binding expression's type against the component's declared type
    const modification = node.modification;
    if (!modification) return;

    const bindingExpr = modification.expression;
    if (!bindingExpr) return;

    // Get the modification syntax node to find the binding expression's AST
    const modSyntax = node.abstractSyntaxNode?.declaration?.modification;
    const exprSyntax = modSyntax?.modificationExpression?.expression;

    // Check component reference bindings
    if (exprSyntax instanceof ModelicaComponentReferenceSyntaxNode) {
      const resolvedComp = resolveToComponent(node.parent ?? node, exprSyntax);
      if (resolvedComp) {
        if (!resolvedComp.instantiated) resolvedComp.instantiate();
        const exprType = resolvedComp.classInstance;
        if (exprType && !classInstance.isTypeCompatibleWith(exprType)) {
          diagnosticsCallback(
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.severity,
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
              node.name ?? "",
              classInstance.name ?? "",
              componentRefText(exprSyntax),
              exprType.name ?? "",
            ),
            modSyntax?.modificationExpression,
          );
        }
      }
    }

    // Check literal bindings against declared types (e.g. `Real z = true` is invalid)
    const literalType = getLiteralTypeName(exprSyntax);
    if (literalType) {
      const declaredType =
        classInstance instanceof ModelicaArrayClassInstance
          ? classInstance.elementClassInstance?.name
          : classInstance.name;
      if (
        declaredType &&
        declaredType !== "Expression" &&
        literalType !== declaredType &&
        !isImplicitlyConvertible(literalType, declaredType)
      ) {
        diagnosticsCallback(
          ModelicaErrorCode.TYPE_MISMATCH_BINDING.severity,
          ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
          ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
            node.name ?? "",
            declaredType,
            String((bindingExpr as { value?: unknown }).value ?? "?"),
            literalType,
          ),
          modSyntax?.modificationExpression,
        );
      }
    }
  },
});

// Rule: Redeclare type compatibility — redeclared type must be compatible with constraining type
ModelicaLinter.register(ModelicaErrorCode.REDECLARE_TYPE_MISMATCH, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.instantiated) node.instantiate();
    const classInstance = node.classInstance;
    if (!classInstance) return;

    // Check if this component has a constraining clause
    const constrainingArgs = node.constrainingModificationArgs;
    if (!constrainingArgs || constrainingArgs.length === 0) return;

    // Resolve the constraining type from the constraining clause
    const ccSyntax = (
      node.abstractSyntaxNode?.parent as { constrainingClause?: { typeSpecifier?: { text?: string } } | null }
    )?.constrainingClause;
    if (!ccSyntax) return;

    const constrainingTypeSpec = (ccSyntax as { typeSpecifier?: ModelicaTypeSpecifierSyntaxNode | null })
      ?.typeSpecifier;
    if (!constrainingTypeSpec) return;

    const constrainingElement = node.parent?.resolveTypeSpecifier(constrainingTypeSpec);
    if (!(constrainingElement instanceof ModelicaClassInstance)) return;

    // Check that the actual type is compatible with the constraining type
    if (!classInstance.isTypeCompatibleWith(constrainingElement)) {
      diagnosticsCallback(
        ModelicaErrorCode.REDECLARE_TYPE_MISMATCH.severity,
        ModelicaErrorCode.REDECLARE_TYPE_MISMATCH.code,
        ModelicaErrorCode.REDECLARE_TYPE_MISMATCH.message(
          node.name ?? "",
          classInstance.name ?? "",
          constrainingElement.name ?? "",
        ),
        node.abstractSyntaxNode?.declaration?.identifier,
      );
    }
  },
});

// Rule: Equation LHS/RHS type checking — both sides of an equation must have compatible types
ModelicaLinter.register(ModelicaErrorCode.EQUATION_TYPE_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const equation of node.equations) {
      if (!(equation instanceof ModelicaSimpleEquationSyntaxNode)) continue;

      const expr1 = equation.expression1;
      const expr2 = equation.expression2;

      // Only check component reference = component reference equations
      if (
        !(expr1 instanceof ModelicaComponentReferenceSyntaxNode) ||
        !(expr2 instanceof ModelicaComponentReferenceSyntaxNode)
      ) {
        continue;
      }

      // Skip type checking for equations with array subscripts, as static
      // dimension deduction from slices is complex. The flattener will catch shape mismatches.
      const hasSubscripts = (expr: ModelicaComponentReferenceSyntaxNode) =>
        expr.parts.some((p) => p.arraySubscripts && p.arraySubscripts.subscripts.length > 0);

      if (hasSubscripts(expr1) || hasSubscripts(expr2)) {
        continue;
      }

      const comp1 = resolveToComponent(node, expr1);
      const comp2 = resolveToComponent(node, expr2);
      if (!comp1 || !comp2) continue;

      if (!comp1.instantiated) comp1.instantiate();
      if (!comp2.instantiated) comp2.instantiate();

      const type1 = comp1.classInstance;
      const type2 = comp2.classInstance;
      if (!type1 || !type2) continue;

      if (!type1.isTypeCompatibleWith(type2)) {
        // Build expanded array representation for the error message, e.g.:
        // {{x[1,1], x[1,2], x[1,3]}, {x[2,1], x[2,2], x[2,3]}}
        const expandArray = (name: string, type: ModelicaClassInstance): string => {
          if (!(type instanceof ModelicaArrayClassInstance) || type.shape.length === 0) return name;
          const shape = type.shape;
          const buildNested = (dims: number[], indices: number[]): string => {
            if (dims.length === 0) return `${name}[${indices.join(",")}]`;
            const dim = dims[0] ?? 0;
            const rest = dims.slice(1);
            const elements: string[] = [];
            for (let i = 1; i <= dim; i++) {
              elements.push(buildNested(rest, [...indices, i]));
            }
            return `{${elements.join(", ")}}`;
          };
          return buildNested(shape, []);
        };
        const lhsExpanded = expandArray(componentRefText(expr1), type1);
        const rhsExpanded = expandArray(componentRefText(expr2), type2);
        const typeName = (t: ModelicaClassInstance): string => {
          if (t instanceof ModelicaArrayClassInstance) {
            const elemName = t.elementClassInstance?.name ?? "Real";
            return `${elemName}[${t.shape.join(", ")}]`;
          }
          return t.name ?? "";
        };
        diagnosticsCallback(
          ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
          ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code,
          ModelicaErrorCode.EQUATION_TYPE_MISMATCH.message(lhsExpanded, rhsExpanded, typeName(type1), typeName(type2)),
          equation,
        );
      }
    }
  },
});

// Rule: Replaceable constrainedby validation — default type must be compatible with constraining type
ModelicaLinter.register(ModelicaErrorCode.CONSTRAINEDBY_TYPE_MISMATCH, {
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    // Only applies to replaceable components
    const parentSyntax = node.abstractSyntaxNode?.parent as { replaceable?: boolean } | null;
    if (!parentSyntax?.replaceable) return;
    if (!node.instantiated) node.instantiate();
    const classInstance = node.classInstance;
    if (!classInstance) return;

    // Check if this component has a constraining clause
    const ccSyntax = (
      node.abstractSyntaxNode?.parent as { constrainingClause?: { typeSpecifier?: { text?: string } } | null }
    )?.constrainingClause;
    if (!ccSyntax) return;

    const constrainingTypeSpec = (ccSyntax as { typeSpecifier?: ModelicaTypeSpecifierSyntaxNode | null })
      ?.typeSpecifier;
    if (!constrainingTypeSpec) return;

    const constrainingElement = node.parent?.resolveTypeSpecifier(constrainingTypeSpec);
    if (!(constrainingElement instanceof ModelicaClassInstance)) return;

    // Default type must be compatible with constraining type
    if (!classInstance.isTypeCompatibleWith(constrainingElement)) {
      diagnosticsCallback(
        ModelicaErrorCode.CONSTRAINEDBY_TYPE_MISMATCH.severity,
        ModelicaErrorCode.CONSTRAINEDBY_TYPE_MISMATCH.code,
        ModelicaErrorCode.CONSTRAINEDBY_TYPE_MISMATCH.message(
          node.name ?? "",
          classInstance.name ?? "",
          constrainingElement.name ?? "",
        ),
        node.abstractSyntaxNode?.declaration?.identifier,
      );
    }
  },
});

/**
 * Build an OpenModelica-style function type signature string.
 * E.g.: `.M.wrongType<function>(#Integer i, #Integer i2 := 1) => #NORETCALL#`
 */
function formatFuncTypeSignature(cls: ModelicaClassInstance): string {
  const name = "." + (cls.compositeName ?? cls.name ?? "");
  const builtinTypes = new Set(["Integer", "Real", "Boolean", "String"]);
  const params: string[] = [];
  for (const el of cls.elements) {
    if (!(el instanceof ModelicaComponentInstance)) continue;
    if (el.causality !== "input") continue;
    let typeName = el.classInstance?.name ?? "Unknown";
    if (builtinTypes.has(typeName)) typeName = `#${typeName}`;
    let paramStr = `${typeName} ${el.name ?? "?"}`;
    // Check for default value in the component declaration
    // Path: ComponentDeclaration -> declaration -> modification -> modificationExpression -> expression
    const declNode = el.abstractSyntaxNode as unknown as
      | { declaration?: { modification?: { modificationExpression?: { expression?: { text?: string } } } } }
      | null
      | undefined;
    const modText = declNode?.declaration?.modification?.modificationExpression?.expression?.text;
    if (modText) {
      paramStr += ` := ${modText}`;
    }
    params.push(paramStr);
  }
  // Check for output (return type)
  let returnType = "#NORETCALL#";
  for (const el of cls.elements) {
    if (!(el instanceof ModelicaComponentInstance)) continue;
    if (el.causality !== "output") continue;
    returnType = el.classInstance?.name ?? "Unknown";
    break;
  }
  return `${name}<function>(${params.join(", ")}) => ${returnType}`;
}

// Rule: Function call type checking — argument types and return type must match
ModelicaLinter.register(
  [ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH, ModelicaErrorCode.FUNCTION_RETURN_TYPE_MISMATCH],
  {
    visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
      // Walk equations and algorithm sections to find function calls
      const checkFunctionCalls = (equations: Iterable<ModelicaEquationSyntaxNode>) => {
        for (const equation of equations) {
          if (!(equation instanceof ModelicaSimpleEquationSyntaxNode)) continue;

          const expr2 = equation.expression2;
          if (!expr2) continue;

          // Function calls show up as ModelicaFunctionCallSyntaxNode
          if (expr2 instanceof ModelicaFunctionCallSyntaxNode) {
            const funcRef = expr2.functionReference;
            if (!funcRef) continue;

            // Resolve the function
            const funcElement = node.resolveName(funcRef.parts.map((p) => p.identifier?.text ?? ""));
            if (!(funcElement instanceof ModelicaClassInstance)) continue;
            if (funcElement.classKind !== ModelicaClassKind.FUNCTION && funcElement.classKind !== "operator function")
              continue;

            // Check positional argument types against input parameter types
            const inputParams = [...funcElement.inputParameters];
            const args = expr2.functionCallArguments?.arguments ?? [];
            for (let i = 0; i < Math.min(args.length, inputParams.length); i++) {
              const argExpr = args[i]?.expression;
              const param = inputParams[i];
              if (!argExpr || !param) continue;

              if (argExpr instanceof ModelicaComponentReferenceSyntaxNode) {
                const argComp = resolveToComponent(node, argExpr);
                if (!argComp) continue;
                if (!argComp.instantiated) argComp.instantiate();
                const argType = argComp.classInstance;

                if (!param.instantiated) param.instantiate();
                const paramType = param.classInstance;

                // Skip flexible-size array params (e.g. Real[:]) — any matching base type is accepted
                if (
                  paramType instanceof ModelicaArrayClassInstance &&
                  paramType.arraySubscripts.some((s) => s.flexible)
                ) {
                  continue;
                }

                if (argType && paramType && !paramType.isTypeCompatibleWith(argType)) {
                  // Auto-vectorization (§12.4.6): array arg with scalar param is valid
                  // if the array's element type matches the param type
                  const isVectorizable =
                    argType instanceof ModelicaArrayClassInstance &&
                    !(paramType instanceof ModelicaArrayClassInstance) &&
                    argType.elementClassInstance != null &&
                    paramType.isTypeCompatibleWith(argType.elementClassInstance);
                  if (!isVectorizable) {
                    const isArgFunc =
                      argType instanceof ModelicaClassInstance &&
                      (argType.classKind === ModelicaClassKind.FUNCTION || argType.classKind === "operator function");
                    const isParamFunc =
                      paramType instanceof ModelicaClassInstance &&
                      (paramType.classKind === ModelicaClassKind.FUNCTION ||
                        paramType.classKind === "operator function");
                    const argDisplayName =
                      isArgFunc && argType instanceof ModelicaClassInstance
                        ? (argType.compositeName ?? argType.name ?? "")
                        : (argComp?.name ?? "");
                    const callExpr = `${funcElement.compositeName ?? funcElement.name ?? ""}(${param.name ?? ""}=${argDisplayName})`;
                    const argSig =
                      isArgFunc && argType instanceof ModelicaClassInstance
                        ? formatFuncTypeSignature(argType)
                        : (argType.name ?? "");
                    const expSig =
                      isParamFunc && paramType instanceof ModelicaClassInstance
                        ? formatFuncTypeSignature(paramType)
                        : (paramType.name ?? "");
                    diagnosticsCallback(
                      ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.severity,
                      ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                      ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callExpr, String(i + 1), argSig, expSig),
                      argExpr,
                    );
                  }
                }
              }
            }

            // Check named argument types
            for (const namedArg of expr2.functionCallArguments?.namedArguments ?? []) {
              const argName = namedArg.identifier?.text;
              if (!argName) continue;
              const argExpr = namedArg.argument?.expression;
              if (!argExpr || !(argExpr instanceof ModelicaComponentReferenceSyntaxNode)) continue;

              // Find the matching input parameter
              const matchedParam = inputParams.find((p) => p.name === argName);
              if (!matchedParam) continue;

              const argComp = resolveToComponent(node, argExpr);
              if (!argComp) continue;
              if (!argComp.instantiated) argComp.instantiate();
              const argType = argComp.classInstance;

              if (!matchedParam.instantiated) matchedParam.instantiate();
              const paramType = matchedParam.classInstance;

              if (argType && paramType && !paramType.isTypeCompatibleWith(argType)) {
                const argCompName = argType.compositeName ?? argType.name ?? "";
                const callExpr = `${funcElement.compositeName ?? funcElement.name ?? ""}(${argName}=${argCompName})`;
                const argSig = formatFuncTypeSignature(argType);
                const expSig = formatFuncTypeSignature(paramType);
                const paramIndex = inputParams.findIndex((p) => p.name === argName);
                diagnosticsCallback(
                  ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.severity,
                  ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                  ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(
                    callExpr,
                    String(paramIndex + 1),
                    argSig,
                    expSig,
                  ),
                  argExpr,
                );
              }
            }

            // Check return type
            const expr1 = equation.expression1;
            if (expr1 instanceof ModelicaComponentReferenceSyntaxNode) {
              const lhsComp = resolveToComponent(node, expr1);
              if (lhsComp) {
                if (!lhsComp.instantiated) lhsComp.instantiate();
                const lhsType = lhsComp.classInstance;
                const outputParams = [...funcElement.outputParameters];
                if (lhsType && outputParams.length > 0) {
                  const firstOutput = outputParams[0];
                  if (firstOutput) {
                    if (!firstOutput.instantiated) firstOutput.instantiate();
                    const outputType = firstOutput.classInstance;

                    // Skip flexible/unresolved array return types (e.g. Real[:] or Real[size(x,1)])
                    if (
                      outputType instanceof ModelicaArrayClassInstance &&
                      (outputType.arraySubscripts.some((s) => s.flexible) || outputType.shape.some((d) => d === 0))
                    ) {
                      // Flexible/unresolved return type — skip check
                    } else if (outputType && !lhsType.isTypeCompatibleWith(outputType)) {
                      // Auto-vectorization (§12.4.6): scalar return assigned to array LHS is valid
                      const isVectorizable =
                        lhsType instanceof ModelicaArrayClassInstance &&
                        !(outputType instanceof ModelicaArrayClassInstance) &&
                        lhsType.elementClassInstance != null &&
                        outputType.isTypeCompatibleWith(lhsType.elementClassInstance);
                      if (!isVectorizable) {
                        diagnosticsCallback(
                          ModelicaErrorCode.FUNCTION_RETURN_TYPE_MISMATCH.severity,
                          ModelicaErrorCode.FUNCTION_RETURN_TYPE_MISMATCH.code,
                          ModelicaErrorCode.FUNCTION_RETURN_TYPE_MISMATCH.message(
                            funcElement.name ?? "",
                            lhsType.name ?? "",
                            outputType.name ?? "",
                          ),
                          expr1,
                        );
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };
      checkFunctionCalls(node.equations);

      // Walk algorithm sections for procedure calls with function partial application args
      for (const section of node.algorithmSections) {
        for (const stmt of section.statements) {
          if (!(stmt instanceof ModelicaProcedureCallStatementSyntaxNode)) continue;
          const funcRef = stmt.functionReference;
          if (!funcRef) continue;

          const funcElement = node.resolveName(funcRef.parts.map((p) => p.identifier?.text ?? ""));
          if (!(funcElement instanceof ModelicaClassInstance)) continue;
          if (funcElement.classKind !== ModelicaClassKind.FUNCTION && funcElement.classKind !== "operator function")
            continue;

          const inputParams = [...funcElement.inputParameters];
          const args = stmt.functionCallArguments?.arguments ?? [];
          for (let i = 0; i < Math.min(args.length, inputParams.length); i++) {
            const arg = args[i];
            const param = inputParams[i];
            if (!arg || !param) continue;

            // Check function partial application argument type compatibility
            if (arg.functionPartialApplication) {
              const fpa = arg.functionPartialApplication;
              const fpaName = fpa.typeSpecifier?.text ?? "";
              if (!fpaName) continue;

              // Resolve the referenced function
              const fpaFunc = node.resolveName(fpaName.split("."));
              if (!(fpaFunc instanceof ModelicaClassInstance)) continue;
              if (fpaFunc.classKind !== ModelicaClassKind.FUNCTION) continue;

              // Resolve the expected parameter type (should be a partial function class)
              if (!param.instantiated) param.instantiate();
              const paramType = param.classInstance;
              if (!paramType || paramType.classKind !== ModelicaClassKind.FUNCTION) continue;

              // Compare input parameter types
              const fpaInputs = [...fpaFunc.inputParameters];
              const expectedInputs = [...paramType.inputParameters];

              // Exclude bound named arguments from fpaInputs comparison
              const boundNames = new Set(fpa.namedArguments.map((na) => na.identifier?.text ?? ""));
              const unboundFpaInputs = fpaInputs.filter((p) => !boundNames.has(p.name ?? ""));

              let mismatch = false;
              if (unboundFpaInputs.length !== expectedInputs.length) {
                mismatch = true;
              } else {
                for (let j = 0; j < expectedInputs.length; j++) {
                  const expParam = expectedInputs[j];
                  const actParam = unboundFpaInputs[j];
                  if (!expParam || !actParam) continue;
                  if (!expParam.instantiated) expParam.instantiate();
                  if (!actParam.instantiated) actParam.instantiate();
                  const expType = expParam.classInstance;
                  const actType = actParam.classInstance;
                  if (expType && actType && !expType.isTypeCompatibleWith(actType)) {
                    mismatch = true;
                    break;
                  }
                }
              }

              if (mismatch) {
                const callExpr = `${funcElement.compositeName ?? funcElement.name ?? ""}(${param.name ?? ""}=${fpaFunc.compositeName ?? fpaFunc.name ?? ""})`;
                const argSig = formatFuncTypeSignature(fpaFunc);
                const expSig = formatFuncTypeSignature(paramType);
                diagnosticsCallback(
                  ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.severity,
                  ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                  ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.message(callExpr, String(i + 1), argSig, expSig),
                  fpa,
                );
              }
            }
          }
        }
      }
    },
  },
);

// Rule: Extends compatibility — redeclared elements in extends must be type-compatible
ModelicaLinter.register(ModelicaErrorCode.EXTENDS_TYPE_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const element of node.declaredElements) {
      if (!(element instanceof ModelicaExtendsClassInstance)) continue;
      const baseClass = element.classInstance;
      if (!baseClass) continue;

      // Check each component in the base class that has been redeclared in the derived class
      for (const baseElement of baseClass.elements) {
        if (!(baseElement instanceof ModelicaComponentInstance)) continue;

        // Look for a component with the same name in the derived class
        const derivedElement = node.resolveSimpleName(baseElement.name ?? "", false, true);
        if (!(derivedElement instanceof ModelicaComponentInstance)) continue;
        if (derivedElement === baseElement) continue; // Same element, not redeclared

        if (!baseElement.instantiated) baseElement.instantiate();
        if (!derivedElement.instantiated) derivedElement.instantiate();

        const baseType = baseElement.classInstance;
        const derivedType = derivedElement.classInstance;
        if (!baseType || !derivedType) continue;

        if (!derivedType.isTypeCompatibleWith(baseType)) {
          diagnosticsCallback(
            ModelicaErrorCode.EXTENDS_TYPE_MISMATCH.severity,
            ModelicaErrorCode.EXTENDS_TYPE_MISMATCH.code,
            ModelicaErrorCode.EXTENDS_TYPE_MISMATCH.message(
              node.name ?? "",
              baseElement.name ?? "",
              derivedType.name ?? "",
              baseType.name ?? "",
            ),
            derivedElement.abstractSyntaxNode?.declaration?.identifier,
          );
        }
      }
    }
  },
});

// Rule: If-equation branch consistency — all branches should assign type-compatible values
ModelicaLinter.register(ModelicaErrorCode.IF_BRANCH_TYPE_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const equation of node.equations) {
      if (!(equation instanceof ModelicaIfEquationSyntaxNode)) continue;

      // Collect assignments from each branch
      const collectAssignments = (eqs: ModelicaEquationSyntaxNode[]): Map<string, ModelicaClassInstance> => {
        const assignments = new Map<string, ModelicaClassInstance>();
        for (const eq of eqs) {
          if (!(eq instanceof ModelicaSimpleEquationSyntaxNode)) continue;
          const lhs = eq.expression1;
          const rhs = eq.expression2;
          if (!(lhs instanceof ModelicaComponentReferenceSyntaxNode)) continue;
          if (!(rhs instanceof ModelicaComponentReferenceSyntaxNode)) continue;

          const rhsComp = resolveToComponent(node, rhs);
          if (!rhsComp) continue;
          if (!rhsComp.instantiated) rhsComp.instantiate();
          const rhsType = rhsComp.classInstance;
          if (!rhsType) continue;

          assignments.set(componentRefText(lhs), rhsType);
        }
        return assignments;
      };

      // Get the "then" branch assignments as reference types
      const thenAssignments = collectAssignments(equation.equations);
      if (thenAssignments.size === 0) continue;

      // Check elseif branches
      for (const elseIfClause of equation.elseIfEquationClauses) {
        const branchAssignments = collectAssignments(elseIfClause.equations);
        for (const [varName, thenType] of thenAssignments) {
          const branchType = branchAssignments.get(varName);
          if (branchType && !thenType.isTypeCompatibleWith(branchType)) {
            diagnosticsCallback(
              ModelicaErrorCode.IF_BRANCH_TYPE_MISMATCH.severity,
              ModelicaErrorCode.IF_BRANCH_TYPE_MISMATCH.code,
              ModelicaErrorCode.IF_BRANCH_TYPE_MISMATCH.message(varName, branchType.name ?? "", thenType.name ?? ""),
              elseIfClause,
            );
          }
        }
      }

      // Check else branch
      if (equation.elseEquations.length > 0) {
        const elseAssignments = collectAssignments(equation.elseEquations);
        for (const [varName, thenType] of thenAssignments) {
          const elseType = elseAssignments.get(varName);
          if (elseType && !thenType.isTypeCompatibleWith(elseType)) {
            diagnosticsCallback(
              ModelicaErrorCode.IF_BRANCH_TYPE_MISMATCH.severity,
              ModelicaErrorCode.IF_BRANCH_TYPE_MISMATCH.code,
              ModelicaErrorCode.IF_BRANCH_TYPE_MISMATCH.message(varName, elseType.name ?? "", thenType.name ?? ""),
              equation,
            );
          }
        }
      }
    }
  },
});

// Rule: Connect flow variable matching — connectors in connect() should have matching flow variables
ModelicaLinter.register(ModelicaErrorCode.CONNECT_FLOW_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const equation of node.equations) {
      if (!(equation instanceof ModelicaConnectEquationSyntaxNode)) continue;

      const comp1 = resolveToComponent(node, equation.componentReference1);
      const comp2 = resolveToComponent(node, equation.componentReference2);
      if (!comp1 || !comp2) continue;

      if (!comp1.instantiated) comp1.instantiate();
      if (!comp2.instantiated) comp2.instantiate();

      const type1 = comp1.classInstance;
      const type2 = comp2.classInstance;
      if (!type1 || !type2) continue;

      // Both must be connectors (already checked by NOT_A_CONNECTOR rule)
      if (type1.classKind !== ModelicaClassKind.CONNECTOR && type1.classKind !== ModelicaClassKind.EXPANDABLE_CONNECTOR)
        continue;
      if (type2.classKind !== ModelicaClassKind.CONNECTOR && type2.classKind !== ModelicaClassKind.EXPANDABLE_CONNECTOR)
        continue;

      // Collect flow variable names from each connector
      const flowVars1 = new Set<string>();
      for (const c of type1.components) {
        if (c.flowPrefix === ModelicaFlow.FLOW && c.name) flowVars1.add(c.name);
      }
      const flowVars2 = new Set<string>();
      for (const c of type2.components) {
        if (c.flowPrefix === ModelicaFlow.FLOW && c.name) flowVars2.add(c.name);
      }

      // Check that flow variable sets are identical
      let mismatch = flowVars1.size !== flowVars2.size;
      if (!mismatch) {
        for (const v of flowVars1) {
          if (!flowVars2.has(v)) {
            mismatch = true;
            break;
          }
        }
      }

      if (mismatch) {
        const ref1Text = componentRefText(equation.componentReference1);
        const ref2Text = componentRefText(equation.componentReference2);
        diagnosticsCallback(
          ModelicaErrorCode.CONNECT_FLOW_MISMATCH.severity,
          ModelicaErrorCode.CONNECT_FLOW_MISMATCH.code,
          ModelicaErrorCode.CONNECT_FLOW_MISMATCH.message(ref1Text, ref2Text),
          equation,
        );
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.DIVISION_BY_ZERO, {
  visitBinaryExpression(
    node: ModelicaBinaryExpressionSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (node.operator === "/" || node.operator === "./") {
      if (
        (node.operand2 instanceof ModelicaUnsignedIntegerLiteralSyntaxNode ||
          node.operand2 instanceof ModelicaUnsignedRealLiteralSyntaxNode) &&
        node.operand2.value === 0
      ) {
        // We only have the text of the LHS for the message
        const lhsText = (node.operand1 as { text?: string })?.text ?? "<expression>";
        diagnosticsCallback(
          ModelicaErrorCode.DIVISION_BY_ZERO.severity,
          ModelicaErrorCode.DIVISION_BY_ZERO.code,
          ModelicaErrorCode.DIVISION_BY_ZERO.message(lhsText),
          node,
        );
      }
    }
  },
});

// Rule: Algorithm assignment type checking — target := source must have compatible types
ModelicaLinter.register(ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const statement of node.algorithms) {
      if (statement instanceof ModelicaComplexAssignmentStatementSyntaxNode) {
        const functionRef = statement.functionReference;
        if (!functionRef) continue;

        const funcElement = node.resolveName(functionRef.parts.map((p) => p.identifier?.text ?? ""));
        if (!(funcElement instanceof ModelicaClassInstance)) continue;

        const outputParams = [...funcElement.outputParameters];
        const actualOutputs = statement.outputExpressionList?.outputs ?? [];

        if (actualOutputs.length !== outputParams.length) {
          const lhsText = `(${actualOutputs
            .map((o) => (o instanceof ModelicaComponentReferenceSyntaxNode ? componentRefText(o) : "_"))
            .join(", ")})`;
          const rhsText = `${componentRefText(functionRef)}()`;

          const lhsTypes = actualOutputs
            .map((o) => {
              if (o instanceof ModelicaComponentReferenceSyntaxNode) {
                const oc = resolveToComponent(node, o);
                return oc?.classInstance?.name ?? "Real";
              }
              return "Real";
            })
            .join(", ");

          const rhsTypes = outputParams.map((c) => c.classInstance?.name ?? "Real").join(", ");

          diagnosticsCallback(
            ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.severity,
            ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
            ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.message(lhsText, `(${lhsTypes})`, rhsText, `(${rhsTypes})`),
            statement,
          );
        }
        continue;
      }

      if (!(statement instanceof ModelicaSimpleAssignmentStatementSyntaxNode)) continue;

      const targetRef = statement.target;
      const sourceRef = statement.source;

      if (
        !(targetRef instanceof ModelicaComponentReferenceSyntaxNode) ||
        !(sourceRef instanceof ModelicaComponentReferenceSyntaxNode)
      ) {
        continue;
      }

      const targetComp = resolveToComponent(node, targetRef);
      const sourceComp = resolveToComponent(node, sourceRef);
      if (!targetComp || !sourceComp) continue;

      if (!targetComp.instantiated) targetComp.instantiate();
      if (!sourceComp.instantiated) sourceComp.instantiate();

      let targetType = targetComp.classInstance;
      let sourceType = sourceComp.classInstance;

      // If resolving an array subscript, unwrap the element type for comparison
      const targetSubscripts = targetRef.parts[targetRef.parts.length - 1]?.arraySubscripts?.subscripts;
      if (targetSubscripts && targetSubscripts.length > 0 && targetType instanceof ModelicaArrayClassInstance) {
        // Assume all subscripts have been provided since partial indexing is complex statically
        targetType = targetType.elementClassInstance;
      }

      const sourceSubscripts = sourceRef.parts[sourceRef.parts.length - 1]?.arraySubscripts?.subscripts;
      if (sourceSubscripts && sourceSubscripts.length > 0 && sourceType instanceof ModelicaArrayClassInstance) {
        // Assume all subscripts have been provided
        sourceType = sourceType.elementClassInstance;
      }

      if (!targetType || !sourceType) continue;

      if (!targetType.isTypeCompatibleWith(sourceType)) {
        diagnosticsCallback(
          ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.severity,
          ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
          ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.message(
            componentRefText(targetRef),
            targetType.name ?? "",
            componentRefText(sourceRef),
            sourceType.name ?? "",
          ),
          statement,
        );
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const statement of node.algorithms) {
      if (!(statement instanceof ModelicaSimpleAssignmentStatementSyntaxNode)) continue;
      const targetRef = statement.target;
      if (!(targetRef instanceof ModelicaComponentReferenceSyntaxNode)) continue;
      const targetComp = resolveToComponent(node, targetRef);
      if (!targetComp) continue;
      if (targetComp.variability === ModelicaVariability.CONSTANT) {
        diagnosticsCallback(
          ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.severity,
          ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.code,
          ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.message(componentRefText(targetRef)),
          statement,
        );
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.FOR_ITERATOR_NOT_1D, {
  visitForStatement(
    node: ModelicaForStatementSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    for (const forIndex of node.forIndexes) {
      const expr = forIndex.expression;
      if (!(expr instanceof ModelicaArrayConstructorSyntaxNode)) continue;
      const elements = expr.expressionList?.expressions ?? [];
      // If any element is itself an array constructor, the iterator is multi-dimensional
      if (elements.some((e) => e instanceof ModelicaArrayConstructorSyntaxNode)) {
        const outerLen = elements.length;
        const innerLen =
          (
            elements.find((e) => e instanceof ModelicaArrayConstructorSyntaxNode) as
              | ModelicaArrayConstructorSyntaxNode
              | undefined
          )?.expressionList?.expressions?.length ?? 0;
        const shape = `Integer[${outerLen}, ${innerLen}]`;
        const iteratorName = forIndex.identifier?.text ?? "?";
        diagnosticsCallback(
          ModelicaErrorCode.FOR_ITERATOR_NOT_1D.severity,
          ModelicaErrorCode.FOR_ITERATOR_NOT_1D.code,
          ModelicaErrorCode.FOR_ITERATOR_NOT_1D.message(iteratorName, shape),
          forIndex.expression,
        );
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION && node.classKind !== ModelicaClassKind.OPERATOR_FUNCTION) return;
    const classSpecifier = node.abstractSyntaxNode?.classSpecifier;
    if (!classSpecifier) return;
    if (!("externalFunctionClause" in classSpecifier) || !classSpecifier.externalFunctionClause) return;
    // Check for algorithm sections (directly declared or inherited via extends)
    const hasAlgorithm = [...node.algorithmSections].length > 0;
    if (hasAlgorithm) {
      diagnosticsCallback(
        ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.severity,
        ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.code,
        ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.message(),
        node.abstractSyntaxNode?.identifier,
      );

      // Also emit CLASS_NOT_FOUND for call sites in the parent model that reference
      // this broken function (matching OMC behavior)
      const funcName = node.name;
      const parentClass = node.parent instanceof ModelicaClassInstance ? node.parent : null;
      if (funcName && parentClass?.abstractSyntaxNode) {
        const parentSpecifier = parentClass.abstractSyntaxNode.classSpecifier;
        if (parentSpecifier && "sections" in parentSpecifier) {
          for (const section of parentSpecifier.sections ?? []) {
            if (!("statements" in section)) continue;
            const algSection = section as ModelicaAlgorithmSectionSyntaxNode;
            for (const stmt of algSection.statements ?? []) {
              if (stmt instanceof ModelicaProcedureCallStatementSyntaxNode) {
                const refName = stmt.functionReference?.parts?.[0]?.identifier?.text;
                if (refName === funcName) {
                  diagnosticsCallback(
                    ModelicaErrorCode.CLASS_NOT_FOUND.severity,
                    ModelicaErrorCode.CLASS_NOT_FOUND.code,
                    `Class ${funcName} not found in scope ${parentClass.name ?? ""} (looking for a function or record).`,
                    stmt,
                  );
                }
              }
            }
          }
        }
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION && node.classKind !== ModelicaClassKind.OPERATOR_FUNCTION) return;
    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      // Public variables that are not input or output are invalid in functions
      if (!element.causality && !element.isProtected) {
        diagnosticsCallback(
          ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.severity,
          ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.code,
          ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.message(element.name ?? ""),
          element.abstractSyntaxNode?.declaration?.identifier,
        );
      }
    }
  },
});

// ── Function default argument cyclic dependency ─────────────────────────
// Detects when function input parameters' default values form a cycle
// (e.g. y = 2*x + z, z = x / y → y ↔ z).
ModelicaLinter.register(ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION && node.classKind !== ModelicaClassKind.OPERATOR_FUNCTION) return;

    // Collect input parameters
    const inputElements: ModelicaComponentInstance[] = [];
    for (const e of node.elements) {
      if (e instanceof ModelicaComponentInstance && e.causality === "input") {
        inputElements.push(e);
      }
    }
    if (inputElements.length < 2) return;

    const inputNames = new Set(inputElements.map((e) => e.name ?? ""));

    // Build dependency graph: paramName → set of other input params referenced in its default
    const deps = new Map<string, Set<string>>();

    /** Recursively collect component-reference identifier names from an AST node */
    const collectRefs = (expr: unknown, refs: Set<string>) => {
      if (!expr || typeof expr !== "object") return;
      const exprObj = expr as Record<string, unknown>;
      if (Array.isArray(exprObj["parts"])) {
        for (const part of exprObj["parts"] as Record<string, unknown>[]) {
          const id = (part["identifier"] as Record<string, unknown> | null)?.["text"];
          if (typeof id === "string" && inputNames.has(id)) refs.add(id);
        }
      }
      for (const key of Object.keys(exprObj)) {
        const child = exprObj[key];
        if (child && typeof child === "object") {
          if (Array.isArray(child)) {
            for (const item of child) collectRefs(item, refs);
          } else {
            collectRefs(child, refs);
          }
        }
      }
    };

    for (const el of inputElements) {
      const paramName = el.name ?? "";
      const defaultExpr = el.modification?.modificationExpression?.expression;
      if (!defaultExpr) continue;
      const refs = new Set<string>();
      collectRefs(defaultExpr, refs);
      refs.delete(paramName);
      if (refs.size > 0) deps.set(paramName, refs);
    }
    if (deps.size === 0) return;

    // DFS cycle detection
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const hasCycle = (n: string): boolean => {
      if (inStack.has(n)) return true;
      if (visited.has(n)) return false;
      visited.add(n);
      inStack.add(n);
      for (const dep of deps.get(n) ?? []) {
        if (hasCycle(dep)) return true;
      }
      inStack.delete(n);
      return false;
    };

    for (const paramName of deps.keys()) {
      if (hasCycle(paramName)) {
        // Find the element for source location
        const el = inputElements.find((e) => e.name === paramName);
        diagnosticsCallback(
          ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.severity,
          ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.code,
          ModelicaErrorCode.FUNCTION_DEFAULT_ARG_CYCLE.message(paramName),
          el?.abstractSyntaxNode?.declaration?.identifier,
        );
        return; // Report only the first cycle
      }
    }
  },
});

// ── Invalid function variable types ─────────────────────────────────────
// Function inputs/outputs must be of valid types: predefined (Real, Integer, etc.),
// record, type, or enumeration — not model, block, or connector.
ModelicaLinter.register(ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION && node.classKind !== ModelicaClassKind.OPERATOR_FUNCTION) return;
    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      if (!element.causality) continue; // only check input/output
      if (!element.instantiated) element.instantiate();
      const classKind = element.classInstance?.classKind;
      if (
        classKind === ModelicaClassKind.MODEL ||
        classKind === ModelicaClassKind.BLOCK ||
        classKind === ModelicaClassKind.CONNECTOR ||
        classKind === ModelicaClassKind.EXPANDABLE_CONNECTOR
      ) {
        const typeName = element.classInstance?.name ?? "";
        diagnosticsCallback(
          ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.severity,
          ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code,
          ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.message(typeName, element.name ?? ""),
          element.abstractSyntaxNode?.declaration?.identifier,
        );
      }
    }
  },
});

// ── Protected input/output in functions ─────────────────────────────────
// Input and output variables in functions must be public, not protected.
ModelicaLinter.register(ModelicaErrorCode.FUNCTION_PROTECTED_IO, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION && node.classKind !== ModelicaClassKind.OPERATOR_FUNCTION) return;
    for (const element of node.elements) {
      if (!(element instanceof ModelicaComponentInstance)) continue;
      if (element.causality && element.isProtected) {
        diagnosticsCallback(
          ModelicaErrorCode.FUNCTION_PROTECTED_IO.severity,
          ModelicaErrorCode.FUNCTION_PROTECTED_IO.code,
          ModelicaErrorCode.FUNCTION_PROTECTED_IO.message(element.name ?? ""),
          element.abstractSyntaxNode?.declaration?.identifier,
        );
      }
    }
  },
});

// ── Function argument variability mismatch ──────────────────────────────
// When a function parameter has `constant` variability, the actual argument
// at each call site must also be a constant expression.
ModelicaLinter.register(ModelicaErrorCode.FUNCTION_ARG_VARIABILITY, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Only check models/blocks (the callers)
    if (node.classKind === ModelicaClassKind.FUNCTION || node.classKind === ModelicaClassKind.OPERATOR_FUNCTION) return;

    // Walk equation and algorithm sections looking for function calls
    const checkFunctionCall = (callNode: ModelicaFunctionCallSyntaxNode) => {
      const funcRef = callNode.functionReference;
      if (!funcRef) return;
      // Resolve the function name to a class instance
      const funcParts = funcRef.parts.map((p) => p.identifier?.text ?? "");
      const resolved = node.resolveName(funcParts);
      if (!(resolved instanceof ModelicaClassInstance)) return;
      if (resolved.classKind !== ModelicaClassKind.FUNCTION) return;

      const inputParams = Array.from(resolved.inputParameters);
      const args = callNode.functionCallArguments?.arguments ?? [];
      for (let i = 0; i < Math.min(inputParams.length, args.length); i++) {
        const param = inputParams[i];
        if (!param || param.variability !== ModelicaVariability.CONSTANT) continue;
        // Check if the argument is a component reference to a non-constant
        const argExpr = args[i]?.expression;
        if (argExpr instanceof ModelicaComponentReferenceSyntaxNode) {
          const argName = argExpr.parts.map((p) => p.identifier?.text ?? "").join(".");
          const argParts = argExpr.parts.map((p) => p.identifier?.text ?? "");
          const argResolved = node.resolveName(argParts);
          if (argResolved instanceof ModelicaComponentInstance) {
            if (argResolved.variability !== ModelicaVariability.CONSTANT) {
              diagnosticsCallback(
                ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.severity,
                ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.code,
                ModelicaErrorCode.FUNCTION_ARG_VARIABILITY.message(
                  param.name ?? "",
                  argName,
                  resolved.name ?? "",
                  "constant",
                ),
                argExpr,
              );
            }
          }
        }
      }
    };

    // Scan equation sections
    const scanForCalls = (syntaxNode: unknown) => {
      if (!syntaxNode || typeof syntaxNode !== "object") return;
      if (syntaxNode instanceof ModelicaFunctionCallSyntaxNode) {
        checkFunctionCall(syntaxNode);
      }
      const obj = syntaxNode as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (key === "parent") continue;
        const child = obj[key];
        if (child && typeof child === "object") {
          if (Array.isArray(child)) {
            for (const item of child) scanForCalls(item);
          } else {
            scanForCalls(child);
          }
        }
      }
    };

    for (const section of node.equationSections) scanForCalls(section);
    for (const section of node.algorithmSections) scanForCalls(section);
    // Also scan component bindings (e.g., `Real b = f(a)`)
    for (const element of node.elements) {
      if (element instanceof ModelicaComponentInstance) {
        const bindingExpr = element.abstractSyntaxNode?.declaration?.modification?.modificationExpression?.expression;
        if (bindingExpr) scanForCalls(bindingExpr);
      }
    }
  },
});

// Rule: Nested when-statements are not allowed in Modelica
ModelicaLinter.register(ModelicaErrorCode.NESTED_WHEN, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Walk algorithm sections looking for nested when statements
    for (const section of node.algorithmSections) {
      for (const stmt of section.statements) {
        if (stmt instanceof ModelicaWhenStatementSyntaxNode) {
          // Check all statements inside this when (and elsewhen) for nested when
          const checkForNestedWhen = (stmts: readonly ModelicaSyntaxNode[]): void => {
            for (const s of stmts) {
              if (s instanceof ModelicaWhenStatementSyntaxNode) {
                diagnosticsCallback(
                  ModelicaErrorCode.NESTED_WHEN.severity,
                  ModelicaErrorCode.NESTED_WHEN.code,
                  ModelicaErrorCode.NESTED_WHEN.message(),
                  stmt, // report on the outer when
                );
                return;
              }
              // Walk into if-else branches
              if (s instanceof ModelicaIfStatementSyntaxNode) {
                checkForNestedWhen(s.statements);
                for (const clause of s.elseIfStatementClauses) checkForNestedWhen(clause.statements);
                checkForNestedWhen(s.elseStatements);
              }
            }
          };
          checkForNestedWhen(stmt.statements);
          for (const clause of stmt.elseWhenStatementClauses) checkForNestedWhen(clause.statements);
        }
      }
    }
  },
});

// Rule: Tuple expressions validation
const tupleDiagReportedParents = new WeakSet<ModelicaSyntaxNode>();
ModelicaLinter.register(ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT, {
  visitOutputExpressionList(
    node: ModelicaOutputExpressionListSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    // Only flag actual tuples (multiple elements) - single element output lists are just parenthesized expressions
    if (node.outputs.length <= 1) return;

    let isValid = false;
    let current: ModelicaSyntaxNode | null = node.parent;
    let enclosingStatement: ModelicaSyntaxNode | null = null;

    while (current) {
      if (current instanceof ModelicaComplexAssignmentStatementSyntaxNode) {
        if (current.outputExpressionList === node) {
          isValid = true;
          break;
        }
        if (!enclosingStatement) enclosingStatement = current;
      } else if (current instanceof ModelicaSimpleEquationSyntaxNode) {
        if (current.expression1 === node) {
          if (current.expression2 instanceof ModelicaFunctionCallSyntaxNode) {
            isValid = true;
            break;
          }
        }
        if (!enclosingStatement) enclosingStatement = current;
      } else if (!enclosingStatement) {
        enclosingStatement = current;
      }
      current = current.parent;
    }

    if (!isValid) {
      // Deduplicate: only report once per enclosing statement/equation
      if (enclosingStatement && tupleDiagReportedParents.has(enclosingStatement)) return;
      if (enclosingStatement) tupleDiagReportedParents.add(enclosingStatement);

      // Reconstruct expression text via the printer visitor
      const writer = new StringWriter();
      const printer = new ModelicaSyntaxPrinter(writer);
      node.accept(printer, 0);
      const exprText = writer.toString();

      diagnosticsCallback(
        ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT.severity,
        ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT.code,
        ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT.message(exprText),
        node,
      );
    }
  },
});

// Rule: Unused input variables in external functions
ModelicaLinter.register(ModelicaErrorCode.UNUSED_INPUT_VARIABLE, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    if (node.classKind !== ModelicaClassKind.FUNCTION) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const specifier = node.abstractSyntaxNode?.classSpecifier as any;
    if (!specifier || !("externalFunctionClause" in specifier) || !specifier.externalFunctionClause) return;

    const ext = specifier.externalFunctionClause;
    const call = ext.externalFunctionCall;
    if (call) {
      const usedArgs: string[] = [];
      const printer = new ModelicaSyntaxPrinter(new StringWriter());
      for (const expr of call.arguments?.expressions ?? []) {
        const writer = new StringWriter();
        printer.out = writer;
        expr.accept(printer, 0);
        usedArgs.push(writer.toString());
      }
      for (const inputInst of node.declaredElements) {
        if (inputInst instanceof ModelicaComponentInstance && inputInst.causality === "input") {
          const name = inputInst.name;
          if (name && !usedArgs.some((arg) => new RegExp("\\b" + name + "\\b").test(arg))) {
            const syntaxNode = inputInst.abstractSyntaxNode;
            diagnosticsCallback(
              ModelicaErrorCode.UNUSED_INPUT_VARIABLE.severity,
              ModelicaErrorCode.UNUSED_INPUT_VARIABLE.code,
              ModelicaErrorCode.UNUSED_INPUT_VARIABLE.message(name, "." + (node.compositeName || "unnamed")),
              syntaxNode,
            );
          }
        }
      }
    }
  },
});

ModelicaLinter.register(ModelicaErrorCode.MISSING_INNER, {
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    // Traverse the composition hierarchy of the entity to find all outer components
    // and checking if they have corresponding inner components in their instance chain.
    const inPath = new Set<ModelicaClassInstance>();

    const traverse = (currentClass: ModelicaClassInstance, stack: ModelicaClassInstance[]) => {
      if (inPath.has(currentClass)) return; // Prevent infinite recursion on cyclic types
      inPath.add(currentClass);
      stack.push(currentClass);

      for (const el of currentClass.elements) {
        if (el instanceof ModelicaComponentInstance) {
          // Check outer condition
          if (el.isOuter && !el.isInner && el.name) {
            let hasInner = false;
            for (let i = stack.length - 1; i >= 0; i--) {
              const ancestorClass = stack[i];
              if (!ancestorClass) continue;
              for (const ancestorEl of ancestorClass.elements) {
                if (
                  ancestorEl instanceof ModelicaComponentInstance &&
                  ancestorEl.isInner &&
                  ancestorEl.name === el.name
                ) {
                  hasInner = true;
                  break;
                }
              }
              if (hasInner) break;
            }

            if (!hasInner) {
              // Fallback: check lexical scope hierarchy for inner declarations.
              // This prevents false positives when linting nested reusable type definitions
              // whose outer components will be satisfied by their lexical parents when instantiated.
              let lexicalParent = node.parent;
              let foundLexicalInner = false;
              while (lexicalParent instanceof ModelicaClassInstance) {
                const innerMatch = Array.from(lexicalParent.elements).find(
                  (e) => e instanceof ModelicaComponentInstance && e.isInner && e.name === el.name,
                );
                if (innerMatch) {
                  foundLexicalInner = true;
                  break;
                }
                lexicalParent = lexicalParent.parent;
              }

              if (!foundLexicalInner) {
                const typeName = el.abstractSyntaxNode?.parent?.typeSpecifier?.text ?? "Unknown";
                const scopeName =
                  el.parent instanceof ModelicaClassInstance ? (el.parent.compositeName ?? el.parent.name ?? "") : "";

                const existingInners: string[] = [];
                for (let i = stack.length - 1; i >= 0; i--) {
                  const ancestorClass = stack[i];
                  if (!ancestorClass) continue;
                  for (const ancestorEl of ancestorClass.elements) {
                    if (ancestorEl instanceof ModelicaComponentInstance && ancestorEl.isInner && ancestorEl.name) {
                      existingInners.push(`'${ancestorEl.name}' in '${ancestorClass.name}'`);
                    }
                  }
                }
                const innersStr = existingInners.length > 0 ? existingInners.join(", ") : "none";

                diagnosticsCallback(
                  ModelicaErrorCode.MISSING_INNER.severity,
                  ModelicaErrorCode.MISSING_INNER.code,
                  ModelicaErrorCode.MISSING_INNER.message(typeName, el.name, scopeName, innersStr),
                  el.abstractSyntaxNode?.parent ?? el.abstractSyntaxNode,
                );
              }
            }
          }

          // Recurse into the component's type definition
          if (el.classInstance) {
            traverse(el.classInstance, stack);
          }
        }
      }

      stack.pop();
      inPath.delete(currentClass); // Allow visiting via different composition paths
    };

    traverse(node, []);
  },
});

ModelicaLinter.register(ModelicaErrorCode.BINARY_OP_TYPE_MISMATCH, {
  visitBinaryExpression(
    node: ModelicaBinaryExpressionSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const op = node.operator;
    // Only check non-element-wise + and -
    if (op !== ModelicaBinaryOperator.ADDITION && op !== ModelicaBinaryOperator.SUBTRACTION) return;

    const op1 = node.operand1;
    const op2 = node.operand2;
    if (!op1 || !op2) return;

    const isArrayExpr = (n: ModelicaSyntaxNode): boolean =>
      n instanceof ModelicaArrayConcatenationSyntaxNode || n instanceof ModelicaArrayConstructorSyntaxNode;

    const op1IsArray = isArrayExpr(op1);
    const op2IsArray = isArrayExpr(op2);

    // Array op scalar or scalar op array
    if (op1IsArray !== op2IsArray) {
      const writer1 = new StringWriter();
      const p1 = new ModelicaSyntaxPrinter(writer1);
      op1.accept(p1, 0);
      const writer2 = new StringWriter();
      const p2 = new ModelicaSyntaxPrinter(writer2);
      op2.accept(p2, 0);
      const exprText = `${writer1.toString().trim()} ${op} ${writer2.toString().trim()}`;

      // Infer operand type descriptions
      const arrayNode = op1IsArray ? op1 : op2;
      let arrayLen = 0;
      if (arrayNode instanceof ModelicaArrayConcatenationSyntaxNode) {
        const firstRow = arrayNode.expressionLists[0];
        arrayLen = firstRow?.expressions?.length ?? 0;
      } else if (arrayNode instanceof ModelicaArrayConstructorSyntaxNode) {
        arrayLen = arrayNode.expressionList?.expressions?.length ?? 0;
      }
      const arrayType = `Integer[${arrayLen}]`;
      const scalarType = "Integer";

      diagnosticsCallback(
        ModelicaErrorCode.BINARY_OP_TYPE_MISMATCH.severity,
        ModelicaErrorCode.BINARY_OP_TYPE_MISMATCH.code,
        ModelicaErrorCode.BINARY_OP_TYPE_MISMATCH.message(
          exprText,
          op1IsArray ? arrayType : scalarType,
          op2IsArray ? arrayType : scalarType,
        ),
        node,
      );
    }
  },
});
ModelicaLinter.register([ModelicaErrorCode.WITHIN_IN_SCRIPT, ModelicaErrorCode.STATEMENT_IN_STANDARD_MODE], {
  visitStoredDefinition(
    node: ModelicaStoredDefinitionSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resource = (diagnosticsCallback as any).resource as string | null | undefined;
    const isScriptMode = resource ? resource.endsWith(".mos") || resource.includes(".monb") : false;

    if (isScriptMode && node.withinDirective) {
      diagnosticsCallback(
        ModelicaErrorCode.WITHIN_IN_SCRIPT.severity,
        ModelicaErrorCode.WITHIN_IN_SCRIPT.code,
        ModelicaErrorCode.WITHIN_IN_SCRIPT.message(),
        node.withinDirective,
      );
    }

    if (!isScriptMode && node.statements && node.statements.length > 0) {
      diagnosticsCallback(
        ModelicaErrorCode.STATEMENT_IN_STANDARD_MODE.severity,
        ModelicaErrorCode.STATEMENT_IN_STANDARD_MODE.code,
        ModelicaErrorCode.STATEMENT_IN_STANDARD_MODE.message(),
        node.statements[0],
      );
    }
  },
});
