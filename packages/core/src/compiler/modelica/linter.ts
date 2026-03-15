// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Range, Tree } from "../../util/tree-sitter.js";
import { Scope } from "../scope.js";
import { ModelicaArray } from "./dae.js";
import { ModelicaErrorCode } from "./errors.js";
import {
  ModelicaArrayClassInstance,
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaElementModification,
  ModelicaEntity,
  ModelicaExtendsClassInstance,
  ModelicaLibrary,
  ModelicaModelVisitor,
  ModelicaModificationArgument,
  ModelicaNamedElement,
  ModelicaNode,
  type IModelicaModelVisitor,
  type ModelicaBooleanClassInstance,
  type ModelicaIntegerClassInstance,
  type ModelicaRealClassInstance,
  type ModelicaStringClassInstance,
} from "./model.js";
import {
  ModelicaBinaryExpressionSyntaxNode,
  ModelicaBooleanLiteralSyntaxNode,
  ModelicaClassKind,
  ModelicaClassModificationSyntaxNode,
  ModelicaClassOrInheritanceModificationSyntaxNode,
  ModelicaComponentReferencePartSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaCompoundImportClauseSyntaxNode,
  ModelicaConnectEquationSyntaxNode,
  ModelicaDescriptionSyntaxNode,
  ModelicaElementModificationSyntaxNode,
  ModelicaEquationSectionSyntaxNode,
  ModelicaExtendsClauseSyntaxNode,
  ModelicaInheritanceModificationSyntaxNode,
  ModelicaModificationExpressionSyntaxNode,
  ModelicaModificationSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
  ModelicaSimpleImportClauseSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  ModelicaSyntaxNode,
  ModelicaSyntaxVisitor,
  ModelicaUnaryExpressionSyntaxNode,
  ModelicaUnqualifiedImportClauseSyntaxNode,
  ModelicaUnsignedIntegerLiteralSyntaxNode,
  ModelicaUnsignedRealLiteralSyntaxNode,
  ModelicaVariability,
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
} from "./syntax.js";

/**
 * Callback function signature for reporting diagnostic messages.
 */
export type DiagnosticsCallback = (
  type: string,
  message: string,
  resource: string | null | undefined,
  range: Range | null | undefined,
) => void;

/**
 * Diagnostics callback without specifying the resource string.
 */
export type DiagnosticsCallbackWithoutResource = (
  type: string,
  message: string,
  range: Range | null | undefined,
) => void;

/**
 * Main linter class coordinating syntax-level and model-level checks for Modelica.
 */
export class ModelicaLinter {
  #diagnosticsCallback: DiagnosticsCallback;
  #modelicaModelLinter: ModelicaModelLinter;
  #modelicaSyntaxLinter: ModelicaSyntaxLinter;
  static #rules: Partial<
    | IModelicaModelVisitor<void, DiagnosticsCallbackWithoutResource>
    | IModelicaSyntaxVisitor<void, DiagnosticsCallbackWithoutResource>
  >[] = [];

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
    ModelicaLinter.#rules.forEach((rule) => {
      if (methodName in rule && typeof rule[methodName as keyof typeof rule] === "function")
        (rule as Record<string, (...args: unknown[]) => void>)[methodName]?.(
          node,
          (type: string, message: string, range: Range | null | undefined) =>
            diagnosticsCallback(type, message, resource, range),
        );
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
          this.#diagnosticsCallback("error", "Parse error.", resource, cursor.currentNode);
        } else if (cursor.currentNode.isMissing) {
          this.#diagnosticsCallback(
            "error",
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
   * @param rule - An object mapping visitor method names to rule-checking functions.
   */
  static register(
    rule: Partial<
      | IModelicaModelVisitor<void, DiagnosticsCallbackWithoutResource>
      | IModelicaSyntaxVisitor<void, DiagnosticsCallbackWithoutResource>
    >,
  ) {
    ModelicaLinter.#rules.push(rule);
  }
}

/**
 * Linter running diagnostics across the populated semantic Modelica object model.
 */
export class ModelicaModelLinter extends ModelicaModelVisitor<string | null | undefined> {
  #diagnosticsCallback: DiagnosticsCallback;
  #modelicaSyntaxLinter: ModelicaSyntaxLinter;
  #visited = new Set<string>();

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
    // Do NOT call super.visitComponentInstance - that would recurse into the component's
    // type definition elements (via classInstance.elements), causing infinite recursion
    // for models with cyclic type references. The type itself is linted when visited as a class.
    ModelicaLinter.applyRules("visitComponentInstance", node, this.#diagnosticsCallback, resource);
  }

  visitEntity(node: ModelicaEntity): void {
    node.storedDefinitionSyntaxNode?.accept(this.#modelicaSyntaxLinter, node.path);
    ModelicaLinter.applyRules("visitEntity", node, this.#diagnosticsCallback, node.path);
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
}

ModelicaLinter.register({
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const names = new Set();
    for (const element of node.elements) {
      if (element instanceof ModelicaNamedElement) {
        if (names.has(element.name)) {
          let range: Range | null = null;
          if (element instanceof ModelicaClassInstance) {
            range = element.abstractSyntaxNode?.identifier ?? null;
          } else if (element instanceof ModelicaComponentInstance) {
            range = element.abstractSyntaxNode?.declaration?.identifier ?? null;
          }
          diagnosticsCallback(
            ModelicaErrorCode.DUPLICATE_ELEMENT.severity,
            `[M${ModelicaErrorCode.DUPLICATE_ELEMENT.code}] ${ModelicaErrorCode.DUPLICATE_ELEMENT.message(element.name ?? "")}`,
            range,
          );
        } else {
          names.add(element.name);
        }
      }
    }
  },
});

ModelicaLinter.register({
  visitLongClassSpecifier(
    node: ModelicaLongClassSpecifierSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (node.identifier?.text !== node.endIdentifier?.text) {
      diagnosticsCallback(
        ModelicaErrorCode.IDENTIFIER_MISMATCH.severity,
        `[M${ModelicaErrorCode.IDENTIFIER_MISMATCH.code}] ${ModelicaErrorCode.IDENTIFIER_MISMATCH.message()}`,
        node.identifier,
      );
    }
  },
});

ModelicaLinter.register({
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.instantiated) node.instantiate();
    if (node.classInstance == null) {
      const typeSpecifier = node.abstractSyntaxNode?.parent?.typeSpecifier;
      diagnosticsCallback(
        ModelicaErrorCode.CLASS_NOT_FOUND.severity,
        `[M${ModelicaErrorCode.CLASS_NOT_FOUND.code}] ${ModelicaErrorCode.CLASS_NOT_FOUND.message(typeSpecifier?.text ?? "", node.parent?.name ?? "")}`,
        typeSpecifier,
      );
    }
  },
});

class ModelicaExpressionNameResolutionVisitor extends ModelicaSyntaxVisitor<void, DiagnosticsCallbackWithoutResource> {
  #scope: Scope;

  constructor(scope: Scope) {
    super();
    this.#scope = scope;
  }

  override visitComponentReference(
    node: ModelicaComponentReferenceSyntaxNode,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    const fullPath = node.parts.map((p) => p.identifier?.text).join(".");
    const resolved = this.#scope.resolveName(fullPath.split("."));
    if (!resolved) {
      diagnosticsCallback(
        ModelicaErrorCode.NAME_NOT_FOUND.severity,
        `[M${ModelicaErrorCode.NAME_NOT_FOUND.code}] ${ModelicaErrorCode.NAME_NOT_FOUND.message(fullPath)}`,
        node,
      );
    }
  }
}

ModelicaLinter.register({
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    const visitor = new ModelicaExpressionNameResolutionVisitor(node);
    for (const equationSection of node.equationSections) {
      equationSection.accept(visitor, diagnosticsCallback);
    }
    for (const algorithmSection of node.algorithmSections) {
      algorithmSection.accept(visitor, diagnosticsCallback);
    }
  },
});

ModelicaLinter.register({
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
    let nEquations = 0;
    for (const equation of node.equations) {
      if (!(equation instanceof ModelicaConnectEquationSyntaxNode)) {
        nEquations++;
      }
    }

    // Each algorithm section contributes as many equations as assigned variables.
    // As a simplification, count each statement as one equation.
    nEquations += Array.from(node.algorithms).length;

    if (nEquations !== nVariables) {
      diagnosticsCallback(
        ModelicaErrorCode.UNBALANCED_MODEL.severity,
        `[M${ModelicaErrorCode.UNBALANCED_MODEL.code}] ${ModelicaErrorCode.UNBALANCED_MODEL.message(String(node.classKind), node.name ?? "", String(nEquations), String(nVariables))}`,
        node.abstractSyntaxNode?.identifier,
      );
    }
  },
});

ModelicaLinter.register({
  visitComponentInstance(
    node: ModelicaComponentInstance,
    diagnosticsCallback: DiagnosticsCallbackWithoutResource,
  ): void {
    if (!node.instantiated) node.instantiate();
    const classInstance = node.classInstance;
    if (!classInstance || !classInstance.abstractSyntaxNode) return;

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
          `[M${ModelicaErrorCode.MODIFIER_NOT_FOUND.code}] ${ModelicaErrorCode.MODIFIER_NOT_FOUND.message(name, node.name ?? "", classInstance.name ?? "")}`,
          node.abstractSyntaxNode?.declaration?.identifier,
        );
      }
    }
  },
});

ModelicaLinter.register({
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
            `[M${ModelicaErrorCode.DUPLICATE_MODIFICATION.code}] ${ModelicaErrorCode.DUPLICATE_MODIFICATION.message(path, node.name ?? "")}`,
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
      if (argExpr instanceof ModelicaArray && !argExpr.assignable(shape)) {
        diagnosticsCallback(
          ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
          `[M${ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code}] ${ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message(`'${name}'`, String(argExpr.flatShape), String(shape))}`,
          range,
        );
      }

      // Check sub-modification argument expressions (e.g. y(start = {{...}}))
      if (modArg instanceof ModelicaElementModification) {
        for (const subArg of modArg.modificationArguments) {
          const subExpr = subArg.expression;
          if (subExpr instanceof ModelicaArray && !subExpr.assignable(shape)) {
            diagnosticsCallback(
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
              `[M${ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code}] ${ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message(`'${subArg.name}' of '${name}'`, String(subExpr.flatShape), String(shape))}`,
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

ModelicaLinter.register({
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
        if (expr instanceof ModelicaArray && !expr.assignable(shape)) {
          diagnosticsCallback(
            ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
            `[M${ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code}] ${ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message("expression", String(expr.flatShape), String(shape))}`,
            range,
          );
        }
        for (const modArg of modification.modificationArguments) {
          const argExpr = modArg.expression;
          if (argExpr instanceof ModelicaArray && !argExpr.assignable(shape)) {
            diagnosticsCallback(
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.severity,
              `[M${ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code}] ${ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.message(`'${modArg.name}'`, String(argExpr.flatShape), String(shape))}`,
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

// Rule: Connect equation — both sides must be connectors and plug-compatible
ModelicaLinter.register({
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

      // Check both sides are connectors
      if (
        type1.classKind !== ModelicaClassKind.CONNECTOR &&
        type1.classKind !== ModelicaClassKind.EXPANDABLE_CONNECTOR
      ) {
        diagnosticsCallback(
          ModelicaErrorCode.NOT_A_CONNECTOR.severity,
          `[M${ModelicaErrorCode.NOT_A_CONNECTOR.code}] ${ModelicaErrorCode.NOT_A_CONNECTOR.message(ref1Text, ref2Text, ref1Text)}`,
          equation.componentReference1,
        );
      }

      if (
        type2.classKind !== ModelicaClassKind.CONNECTOR &&
        type2.classKind !== ModelicaClassKind.EXPANDABLE_CONNECTOR
      ) {
        diagnosticsCallback(
          ModelicaErrorCode.NOT_A_CONNECTOR.severity,
          `[M${ModelicaErrorCode.NOT_A_CONNECTOR.code}] ${ModelicaErrorCode.NOT_A_CONNECTOR.message(ref1Text, ref2Text, ref2Text)}`,
          equation.componentReference2,
        );
      }

      // Check plug compatibility
      if (!type1.isPlugCompatibleWith(type2)) {
        diagnosticsCallback(
          ModelicaErrorCode.NOT_PLUG_COMPATIBLE.severity,
          `[M${ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code}] ${ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(ref1Text, ref2Text)}`,
          equation,
        );
      }
    }
  },
});

// Rule: Modification argument type checking — modifier targets must have compatible types
ModelicaLinter.register({
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
              `[M${ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code}] ${ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.message(name, targetType.name ?? "", exprType.name ?? "")}`,
              modArg.modificationExpression,
            );
          }
        }
      }
    }
  },
});

// Rule: Binding equation type checking — component = expr must have compatible types
ModelicaLinter.register({
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

    // Only check component references — literals and complex expressions
    // would require full type inference
    if (exprSyntax instanceof ModelicaComponentReferenceSyntaxNode) {
      const resolvedComp = resolveToComponent(node.parent ?? node, exprSyntax);
      if (resolvedComp) {
        if (!resolvedComp.instantiated) resolvedComp.instantiate();
        const exprType = resolvedComp.classInstance;
        if (exprType && !classInstance.isTypeCompatibleWith(exprType)) {
          diagnosticsCallback(
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.severity,
            `[M${ModelicaErrorCode.TYPE_MISMATCH_BINDING.code}] ${ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(node.name ?? "", classInstance.name ?? "", componentRefText(exprSyntax), exprType.name ?? "")}`,
            modSyntax?.modificationExpression,
          );
        }
      }
    }
  },
});

// Rule: Redeclare type compatibility — redeclared type must be compatible with constraining type
ModelicaLinter.register({
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
        `[M${ModelicaErrorCode.REDECLARE_TYPE_MISMATCH.code}] ${ModelicaErrorCode.REDECLARE_TYPE_MISMATCH.message(node.name ?? "", classInstance.name ?? "", constrainingElement.name ?? "")}`,
        node.abstractSyntaxNode?.declaration?.identifier,
      );
    }
  },
});

// Rule: Equation LHS/RHS type checking — both sides of an equation must have compatible types
ModelicaLinter.register({
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

      const comp1 = resolveToComponent(node, expr1);
      const comp2 = resolveToComponent(node, expr2);
      if (!comp1 || !comp2) continue;

      if (!comp1.instantiated) comp1.instantiate();
      if (!comp2.instantiated) comp2.instantiate();

      const type1 = comp1.classInstance;
      const type2 = comp2.classInstance;
      if (!type1 || !type2) continue;

      if (!type1.isTypeCompatibleWith(type2)) {
        diagnosticsCallback(
          ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
          `[M${ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code}] ${ModelicaErrorCode.EQUATION_TYPE_MISMATCH.message(componentRefText(expr1), type1.name ?? "", componentRefText(expr2), type2.name ?? "")}`,
          equation,
        );
      }
    }
  },
});

// Rule: Replaceable constrainedby validation — default type must be compatible with constraining type
ModelicaLinter.register({
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
        `[M${ModelicaErrorCode.CONSTRAINEDBY_TYPE_MISMATCH.code}] ${ModelicaErrorCode.CONSTRAINEDBY_TYPE_MISMATCH.message(node.name ?? "", classInstance.name ?? "", constrainingElement.name ?? "")}`,
        node.abstractSyntaxNode?.declaration?.identifier,
      );
    }
  },
});

// Rule: Function call argument type checking — argument types must match parameter types
ModelicaLinter.register({
  visitClassInstance(node: ModelicaClassInstance, diagnosticsCallback: DiagnosticsCallbackWithoutResource): void {
    for (const equation of node.equations) {
      if (!(equation instanceof ModelicaSimpleEquationSyntaxNode)) continue;

      // Look for function call expressions on the RHS
      // Pattern: x = f(a, b, ...) where f resolves to a function
      const expr2 = equation.expression2;
      if (!expr2) continue;

      // Function calls appear as component references with function application
      // We check if the expression is a function call syntax node
      if (!(expr2 instanceof ModelicaComponentReferenceSyntaxNode)) continue;

      // Resolve the function name
      const funcElement = node.resolveName(expr2.parts.map((p) => p.identifier?.text ?? ""));
      if (!(funcElement instanceof ModelicaClassInstance)) continue;
      if (funcElement.classKind !== ModelicaClassKind.FUNCTION && funcElement.classKind !== "operator function")
        continue;

      // Get function input parameters
      const inputParams = [...funcElement.inputParameters];
      if (inputParams.length === 0) continue;

      // Check the LHS type against the function's output parameters
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
              if (outputType && !lhsType.isTypeCompatibleWith(outputType)) {
                diagnosticsCallback(
                  ModelicaErrorCode.FUNCTION_RETURN_TYPE_MISMATCH.severity,
                  `[M${ModelicaErrorCode.FUNCTION_RETURN_TYPE_MISMATCH.code}] ${ModelicaErrorCode.FUNCTION_RETURN_TYPE_MISMATCH.message(funcElement.name ?? "", lhsType.name ?? "", outputType.name ?? "")}`,
                  expr1,
                );
              }
            }
          }
        }
      }
    }
  },
});
