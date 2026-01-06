// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */

import { stat } from "fs";
import { toEnum } from "../../util/enum.js";
import type { Writer } from "../../util/io.js";
import type { SyntaxNode } from "../../util/tree-sitter.js";

export interface IModelicaSyntaxNode {
  "@type": string;
}

export abstract class ModelicaSyntaxNode implements IModelicaSyntaxNode {
  #concreteSyntaxNode: WeakRef<SyntaxNode> | null;
  #parent: WeakRef<ModelicaSyntaxNode> | null;
  "@type": string;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSyntaxNode | null,
    type?: string | null,
  ) {
    if (parent) this.#parent = new WeakRef(parent);
    else this.#parent = null;
    if (concreteSyntaxNode) this.#concreteSyntaxNode = new WeakRef(concreteSyntaxNode);
    else this.#concreteSyntaxNode = null;
    this["@type"] = type ?? this.constructor.name.substring(8, this.constructor.name.length - 10);
    if (concreteSyntaxNode && concreteSyntaxNode.type != this["@type"])
      throw new Error(`Expected concrete syntax node of type "${this["@type"]}", got "${concreteSyntaxNode.type}"`);
    if (abstractSyntaxNode && abstractSyntaxNode["@type"] != this["@type"])
      throw new Error(`Expected abstract syntax node of type "${this["@type"]}", got "${abstractSyntaxNode["@type"]}"`);
  }

  abstract accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R;

  get concreteSyntaxNode(): SyntaxNode | null {
    return this.#concreteSyntaxNode?.deref() ?? null;
  }

  get parent(): ModelicaSyntaxNode | null {
    return this.#parent?.deref() ?? null;
  }

  static new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSyntaxNode | null,
  ): ModelicaSyntaxNode | null {
    const type = concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"];
    switch (type) {
      case ModelicaStoredDefinitionSyntaxNode.type:
        return new ModelicaStoredDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStoredDefinitionSyntaxNode,
        );
      case ModelicaWithinDirectiveSyntaxNode.type:
        return new ModelicaWithinDirectiveSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWithinDirectiveSyntaxNode,
        );
      case ModelicaClassDefinitionSyntaxNode.type:
        return new ModelicaClassDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassDefinitionSyntaxNode,
        );
      case ModelicaClassPrefixesSyntaxNode.type:
        return new ModelicaClassPrefixesSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassPrefixesSyntaxNode,
        );
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLongClassSpecifierSyntaxNode,
        );
      case ModelicaShortClassSpecifierSyntaxNode.type:
        return new ModelicaShortClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaShortClassSpecifierSyntaxNode,
        );
      case ModelicaDerClassSpecifierSyntaxNode.type:
        return new ModelicaDerClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDerClassSpecifierSyntaxNode,
        );
      case ModelicaEnumerationLiteralSyntaxNode.type:
        return new ModelicaEnumerationLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEnumerationLiteralSyntaxNode,
        );
      case ModelicaExternalFunctionClauseSyntaxNode.type:
        return new ModelicaExternalFunctionClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExternalFunctionClauseSyntaxNode,
        );
      case ModelicaLanguageSpecificationSyntaxNode.type:
        return new ModelicaLanguageSpecificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLanguageSpecificationSyntaxNode,
        );
      case ModelicaExternalFunctionCallSyntaxNode.type:
        return new ModelicaExternalFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExternalFunctionCallSyntaxNode,
        );
      case ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
        );
      case "Initial" + ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
          "Initial" + ModelicaElementSectionSyntaxNode.type,
          ModelicaVisibility.PUBLIC,
        );
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleImportClauseSyntaxNode,
        );
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaCompoundImportClauseSyntaxNode,
        );
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnqualifiedImportClauseSyntaxNode,
        );
      case ModelicaExtendsClauseSyntaxNode.type:
        return new ModelicaExtendsClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExtendsClauseSyntaxNode,
        );
      case ModelicaConstrainingClauseSyntaxNode.type:
        return new ModelicaConstrainingClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaConstrainingClauseSyntaxNode,
        );
      case ModelicaClassOrInheritanceModificationSyntaxNode.type:
        return new ModelicaClassOrInheritanceModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassOrInheritanceModificationSyntaxNode,
        );
      case ModelicaInheritanceModificationSyntaxNode.type:
        return new ModelicaInheritanceModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaInheritanceModificationSyntaxNode,
        );
      case ModelicaComponentClauseSyntaxNode.type:
        return new ModelicaComponentClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentClauseSyntaxNode,
        );
      case ModelicaComponentDeclarationSyntaxNode.type:
        return new ModelicaComponentDeclarationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentDeclarationSyntaxNode,
        );
      case ModelicaConditionAttributeSyntaxNode.type:
        return new ModelicaConditionAttributeSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaConditionAttributeSyntaxNode,
        );
      case ModelicaDeclarationSyntaxNode.type:
        return new ModelicaDeclarationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDeclarationSyntaxNode,
        );
      case ModelicaModificationSyntaxNode.type:
        return new ModelicaModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaModificationSyntaxNode,
        );
      case ModelicaModificationExpressionSyntaxNode.type:
        return new ModelicaModificationExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaModificationExpressionSyntaxNode,
        );
      case ModelicaClassModificationSyntaxNode.type:
        return new ModelicaClassModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassModificationSyntaxNode,
        );
      case ModelicaElementModificationSyntaxNode.type:
        return new ModelicaElementModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementModificationSyntaxNode,
        );
      case ModelicaElementRedeclarationSyntaxNode.type:
        return new ModelicaElementRedeclarationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementRedeclarationSyntaxNode,
        );
      case ModelicaComponentClause1SyntaxNode.type:
        return new ModelicaComponentClause1SyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentClause1SyntaxNode,
        );
      case ModelicaComponentDeclaration1SyntaxNode.type:
        return new ModelicaComponentDeclaration1SyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentDeclaration1SyntaxNode,
        );
      case ModelicaShortClassDefinitionSyntaxNode.type:
        return new ModelicaShortClassDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaShortClassDefinitionSyntaxNode,
        );
      case ModelicaEquationSectionSyntaxNode.type:
        return new ModelicaEquationSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEquationSectionSyntaxNode,
        );
      case ModelicaAlgorithmSectionSyntaxNode.type:
        return new ModelicaAlgorithmSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaAlgorithmSectionSyntaxNode,
        );
      case ModelicaSimpleAssignmentStatementSyntaxNode.type:
        return new ModelicaSimpleAssignmentStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleAssignmentStatementSyntaxNode,
        );
      case ModelicaProcedureCallStatementSyntaxNode.type:
        return new ModelicaProcedureCallStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaProcedureCallStatementSyntaxNode,
        );
      case ModelicaComplexAssignmentStatementSyntaxNode.type:
        return new ModelicaComplexAssignmentStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComplexAssignmentStatementSyntaxNode,
        );
      case ModelicaSimpleEquationSyntaxNode.type:
        return new ModelicaSimpleEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleEquationSyntaxNode,
        );
      case ModelicaSpecialEquationSyntaxNode.type:
        return new ModelicaSpecialEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSpecialEquationSyntaxNode,
        );
      case ModelicaIfEquationSyntaxNode.type:
        return new ModelicaIfEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfEquationSyntaxNode,
        );
      case ModelicaElseIfEquationClauseSyntaxNode.type:
        return new ModelicaElseIfEquationClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseIfEquationClauseSyntaxNode,
        );
      case ModelicaIfStatementSyntaxNode.type:
        return new ModelicaIfStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfStatementSyntaxNode,
        );
      case ModelicaElseIfStatementClauseSyntaxNode.type:
        return new ModelicaElseIfStatementClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseIfStatementClauseSyntaxNode,
        );
      case ModelicaForEquationSyntaxNode.type:
        return new ModelicaForEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForEquationSyntaxNode,
        );
      case ModelicaForStatementSyntaxNode.type:
        return new ModelicaForStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForStatementSyntaxNode,
        );
      case ModelicaForIndexSyntaxNode.type:
        return new ModelicaForIndexSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForIndexSyntaxNode,
        );
      case ModelicaWhileStatementSyntaxNode.type:
        return new ModelicaWhileStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhileStatementSyntaxNode,
        );
      case ModelicaWhenEquationSyntaxNode.type:
        return new ModelicaWhenEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhenEquationSyntaxNode,
        );
      case ModelicaElseWhenEquationClauseSyntaxNode.type:
        return new ModelicaElseWhenEquationClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseWhenEquationClauseSyntaxNode,
        );
      case ModelicaWhenStatementSyntaxNode.type:
        return new ModelicaWhenStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhenStatementSyntaxNode,
        );
      case ModelicaElseWhenStatementClauseSyntaxNode.type:
        return new ModelicaElseWhenStatementClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseWhenStatementClauseSyntaxNode,
        );
      case ModelicaConnectEquationSyntaxNode.type:
        return new ModelicaConnectEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaConnectEquationSyntaxNode,
        );
      case ModelicaBreakStatementSyntaxNode.type:
        return new ModelicaBreakStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBreakStatementSyntaxNode,
        );
      case ModelicaReturnStatementSyntaxNode.type:
        return new ModelicaReturnStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaReturnStatementSyntaxNode,
        );
      case ModelicaIfElseExpressionSyntaxNode.type:
        return new ModelicaIfElseExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfElseExpressionSyntaxNode,
        );
      case ModelicaElseIfExpressionClauseSyntaxNode.type:
        return new ModelicaElseIfExpressionClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseIfExpressionClauseSyntaxNode,
        );
      case ModelicaRangeExpressionSyntaxNode.type:
        return new ModelicaRangeExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaRangeExpressionSyntaxNode,
        );
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
        );
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEndExpressionSyntaxNode,
        );
      case ModelicaTypeSpecifierSyntaxNode.type:
        return new ModelicaTypeSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaTypeSpecifierSyntaxNode,
        );
      case ModelicaNameSyntaxNode.type:
        return new ModelicaNameSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode as IModelicaNameSyntaxNode);
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaComponentReferencePartSyntaxNode.type:
        return new ModelicaComponentReferencePartSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferencePartSyntaxNode,
        );
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallSyntaxNode,
        );
      case ModelicaFunctionCallArgumentsSyntaxNode.type:
        return new ModelicaFunctionCallArgumentsSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallArgumentsSyntaxNode,
        );
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConcatenationSyntaxNode,
        );
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConstructorSyntaxNode,
        );
      case ModelicaComprehensionClauseSyntaxNode.type:
        return new ModelicaComprehensionClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComprehensionClauseSyntaxNode,
        );
      case ModelicaNamedArgumentSyntaxNode.type:
        return new ModelicaNamedArgumentSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaNamedArgumentSyntaxNode,
        );
      case ModelicaFunctionArgumentSyntaxNode.type:
        return new ModelicaFunctionArgumentSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionArgumentSyntaxNode,
        );
      case ModelicaFunctionPartialApplicationSyntaxNode.type:
        return new ModelicaFunctionPartialApplicationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionPartialApplicationSyntaxNode,
        );
      case ModelicaMemberAccessExpressionSyntaxNode.type:
        return new ModelicaMemberAccessExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaMemberAccessExpressionSyntaxNode,
        );
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaOutputExpressionListSyntaxNode,
        );
      case ModelicaExpressionListSyntaxNode.type:
        return new ModelicaExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExpressionListSyntaxNode,
        );
      case ModelicaArraySubscriptsSyntaxNode.type:
        return new ModelicaArraySubscriptsSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArraySubscriptsSyntaxNode,
        );
      case ModelicaSubscriptSyntaxNode.type:
        return new ModelicaSubscriptSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSubscriptSyntaxNode,
        );
      case ModelicaDescriptionSyntaxNode.type:
        return new ModelicaDescriptionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDescriptionSyntaxNode,
        );
      case ModelicaAnnotationClauseSyntaxNode.type:
        return new ModelicaAnnotationClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaAnnotationClauseSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaIdentifierSyntaxNode.type:
        return new ModelicaIdentifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIdentifierSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }

  static newArray<T extends ModelicaSyntaxNode>(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNodeArray?: SyntaxNode[],
    abstractSyntaxNodeArray?: IModelicaSyntaxNode[],
  ): T[] {
    const nodes: T[] = [];
    const length = Math.max(concreteSyntaxNodeArray?.length ?? 0, abstractSyntaxNodeArray?.length ?? 0);
    for (let i = 0; i < length; i++) {
      const node = this.new(parent, concreteSyntaxNodeArray?.[i] ?? null, abstractSyntaxNodeArray?.[i] ?? null) as T;
      if (node) nodes.push(node);
    }
    return nodes;
  }

  static get type(): string {
    return this.name.substring(8, this.name.length - 10);
  }
}

export interface IModelicaStoredDefinitionSyntaxNode extends IModelicaSyntaxNode {
  classDefinitions: IModelicaClassDefinitionSyntaxNode[];
  withinDirective: IModelicaWithinDirectiveSyntaxNode | null;
}

export class ModelicaStoredDefinitionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaStoredDefinitionSyntaxNode
{
  classDefinitions: ModelicaClassDefinitionSyntaxNode[];
  withinDirective: ModelicaWithinDirectiveSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStoredDefinitionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.withinDirective = ModelicaWithinDirectiveSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("withinDirective"),
      abstractSyntaxNode?.withinDirective,
    );
    this.classDefinitions = ModelicaClassDefinitionSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("classDefinition"),
      abstractSyntaxNode?.classDefinitions,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitStoredDefinition(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStoredDefinitionSyntaxNode | null,
  ): ModelicaStoredDefinitionSyntaxNode | null {
    const type = concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"];
    switch (type) {
      case ModelicaStoredDefinitionSyntaxNode.type:
        return new ModelicaStoredDefinitionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaWithinDirectiveSyntaxNode extends IModelicaSyntaxNode {
  packageName: IModelicaNameSyntaxNode | null;
}

export class ModelicaWithinDirectiveSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaWithinDirectiveSyntaxNode
{
  packageName: ModelicaNameSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWithinDirectiveSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.packageName = ModelicaNameSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("packageName"),
      abstractSyntaxNode?.packageName,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWithinDirective(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWithinDirectiveSyntaxNode | null,
  ): ModelicaWithinDirectiveSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaWithinDirectiveSyntaxNode.type:
        return new ModelicaWithinDirectiveSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaElementSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaElementSyntaxNode extends ModelicaSyntaxNode {
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementSyntaxNode | null,
  ): ModelicaElementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassDefinitionSyntaxNode.type:
        return new ModelicaClassDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassDefinitionSyntaxNode,
        );
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleImportClauseSyntaxNode,
        );
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaCompoundImportClauseSyntaxNode,
        );
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnqualifiedImportClauseSyntaxNode,
        );
      case ModelicaExtendsClauseSyntaxNode.type:
        return new ModelicaExtendsClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExtendsClauseSyntaxNode,
        );
      case ModelicaComponentClauseSyntaxNode.type:
        return new ModelicaComponentClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentClauseSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaClassDefinitionSyntaxNode extends IModelicaElementSyntaxNode {
  classPrefixes: IModelicaClassPrefixesSyntaxNode | null;
  classSpecifier: IModelicaClassSpecifierSyntaxNode | null;
  constrainingClause: IModelicaConstrainingClauseSyntaxNode | null;
  encapsulated: boolean;
  final: boolean;
  inner: boolean;
  outer: boolean;
  redeclare: boolean;
  replaceable: boolean;
}

export class ModelicaClassDefinitionSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaClassDefinitionSyntaxNode
{
  classPrefixes: ModelicaClassPrefixesSyntaxNode | null;
  classSpecifier: ModelicaClassSpecifierSyntaxNode | null;
  constrainingClause: ModelicaConstrainingClauseSyntaxNode | null;
  encapsulated: boolean;
  final: boolean;
  inner: boolean;
  outer: boolean;
  redeclare: boolean;
  replaceable: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassDefinitionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.encapsulated =
      abstractSyntaxNode?.encapsulated ?? concreteSyntaxNode?.childForFieldName("encapsulated") != null;
    this.final = abstractSyntaxNode?.final ?? concreteSyntaxNode?.childForFieldName("final") != null;
    this.inner = abstractSyntaxNode?.inner ?? concreteSyntaxNode?.childForFieldName("inner") != null;
    this.outer = abstractSyntaxNode?.outer ?? concreteSyntaxNode?.childForFieldName("outer") != null;
    this.redeclare = abstractSyntaxNode?.redeclare ?? concreteSyntaxNode?.childForFieldName("redeclare") != null;
    this.replaceable = abstractSyntaxNode?.replaceable ?? concreteSyntaxNode?.childForFieldName("replaceable") != null;
    this.classPrefixes = ModelicaClassPrefixesSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classPrefixes"),
      abstractSyntaxNode?.classPrefixes,
    );
    this.classSpecifier = ModelicaClassSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classSpecifier"),
      abstractSyntaxNode?.classSpecifier,
    );
    this.constrainingClause = ModelicaConstrainingClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("constrainingClause"),
      abstractSyntaxNode?.constrainingClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassDefinition(this, argument);
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return this.classSpecifier?.annotationClause ?? null;
  }

  get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    const elements = this.classSpecifier?.elements ?? [];
    return (function* () {
      yield* elements;
    })();
  }

  get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const equations = this.classSpecifier?.equations ?? [];
    return (function* () {
      yield* equations;
    })();
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return this.classSpecifier?.identifier ?? null;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassDefinitionSyntaxNode | null,
  ): ModelicaClassDefinitionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassDefinitionSyntaxNode.type:
        return new ModelicaClassDefinitionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get sections(): IterableIterator<ModelicaSectionSyntaxNode> {
    const sections = this.classSpecifier?.sections ?? [];
    return (function* () {
      yield* sections;
    })();
  }
}

export interface IModelicaClassPrefixesSyntaxNode extends IModelicaSyntaxNode {
  classKind: ModelicaClassKind | null;
  partial: boolean;
  purity: ModelicaPurity | null;
}

export class ModelicaClassPrefixesSyntaxNode extends ModelicaSyntaxNode implements IModelicaClassPrefixesSyntaxNode {
  classKind: ModelicaClassKind | null;
  partial: boolean;
  purity: ModelicaPurity | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassPrefixesSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.partial = abstractSyntaxNode?.partial ?? concreteSyntaxNode?.childForFieldName("partial") != null;
    this.purity =
      abstractSyntaxNode?.purity ??
      toEnum(ModelicaPurity, concreteSyntaxNode?.childForFieldName("purity")?.text) ??
      null;
    if (abstractSyntaxNode?.classKind) {
      this.classKind = abstractSyntaxNode.classKind;
    } else if (!concreteSyntaxNode || concreteSyntaxNode.childForFieldName("class")) {
      this.classKind = ModelicaClassKind.CLASS;
    } else if (concreteSyntaxNode.childForFieldName("model")) {
      this.classKind = ModelicaClassKind.MODEL;
    } else if (concreteSyntaxNode.childForFieldName("record")) {
      this.classKind = concreteSyntaxNode.childForFieldName("operator")
        ? ModelicaClassKind.OPERATOR_RECORD
        : ModelicaClassKind.RECORD;
    } else if (concreteSyntaxNode.childForFieldName("block")) {
      this.classKind = ModelicaClassKind.BLOCK;
    } else if (concreteSyntaxNode.childForFieldName("connector")) {
      this.classKind = ModelicaClassKind.CONNECTOR;
    } else if (concreteSyntaxNode.childForFieldName("type")) {
      this.classKind = ModelicaClassKind.TYPE;
    } else if (concreteSyntaxNode.childForFieldName("package")) {
      this.classKind = ModelicaClassKind.PACKAGE;
    } else if (concreteSyntaxNode.childForFieldName("function")) {
      this.classKind = concreteSyntaxNode.childForFieldName("operator")
        ? ModelicaClassKind.OPERATOR_FUNCTION
        : ModelicaClassKind.FUNCTION;
    } else if (concreteSyntaxNode.childForFieldName("operator")) {
      this.classKind = ModelicaClassKind.OPERATOR;
    } else {
      this.classKind = ModelicaClassKind.CLASS;
    }
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassPrefixes(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassPrefixesSyntaxNode | null,
  ): ModelicaClassPrefixesSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassPrefixesSyntaxNode.type:
        return new ModelicaClassPrefixesSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaClassSpecifierSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export abstract class ModelicaClassSpecifierSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaClassSpecifierSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    return (function* () {})();
  }

  get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    return (function* () {})();
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassSpecifierSyntaxNode | null,
  ): ModelicaClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaDerClassSpecifierSyntaxNode.type:
        return new ModelicaDerClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDerClassSpecifierSyntaxNode,
        );
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLongClassSpecifierSyntaxNode,
        );
      case ModelicaShortClassSpecifierSyntaxNode.type:
        return new ModelicaShortClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaShortClassSpecifierSyntaxNode,
        );
      default:
        return null;
    }
  }

  abstract get sections(): ModelicaSectionSyntaxNode[];
}

export interface IModelicaLongClassSpecifierSyntaxNode extends IModelicaClassSpecifierSyntaxNode {
  classModification: IModelicaClassModificationSyntaxNode | null;
  endIdentifier: IModelicaIdentifierSyntaxNode | null;
  extends: boolean;
  externalFunctionClause: IModelicaExternalFunctionClauseSyntaxNode | null;
  sections: IModelicaSectionSyntaxNode[];
}

export class ModelicaLongClassSpecifierSyntaxNode
  extends ModelicaClassSpecifierSyntaxNode
  implements IModelicaLongClassSpecifierSyntaxNode
{
  classModification: ModelicaClassModificationSyntaxNode | null;
  endIdentifier: ModelicaIdentifierSyntaxNode | null;
  extends: boolean;
  externalFunctionClause: ModelicaExternalFunctionClauseSyntaxNode | null;
  sections: ModelicaSectionSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLongClassSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.extends = abstractSyntaxNode?.extends ?? concreteSyntaxNode?.childForFieldName("extends") != null;
    this.classModification = ModelicaClassModificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classModification"),
      abstractSyntaxNode?.classModification,
    );
    this.sections = ModelicaSectionSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("section"),
      abstractSyntaxNode?.sections,
    );
    this.externalFunctionClause = ModelicaExternalFunctionClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("externalFunctionClause"),
      abstractSyntaxNode?.externalFunctionClause,
    );
    this.endIdentifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("endIdentifier"),
      abstractSyntaxNode?.endIdentifier,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitLongClassSpecifier(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    const sections = this.sections;
    return (function* () {
      for (const section of sections) {
        if (section instanceof ModelicaElementSectionSyntaxNode) yield* section.elements;
      }
    })();
  }

  override get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const sections = this.sections;
    return (function* () {
      for (const section of sections) {
        if (section instanceof ModelicaEquationSectionSyntaxNode) yield* section.equations;
      }
    })();
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLongClassSpecifierSyntaxNode | null,
  ): ModelicaLongClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaShortClassSpecifierSyntaxNode extends IModelicaClassSpecifierSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  causality: ModelicaCausality | null;
  classModification: IModelicaClassModificationSyntaxNode | null;
  enumeration: boolean;
  enumerationLiterals: IModelicaEnumerationLiteralSyntaxNode[];
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
  unspecifiedEnumeration: boolean;
}

export class ModelicaShortClassSpecifierSyntaxNode
  extends ModelicaClassSpecifierSyntaxNode
  implements IModelicaShortClassSpecifierSyntaxNode
{
  arraySubscripts: ModelicaArraySubscriptsSyntaxNode | null;
  causality: ModelicaCausality | null;
  classModification: ModelicaClassModificationSyntaxNode | null;
  enumeration: boolean;
  enumerationLiterals: ModelicaEnumerationLiteralSyntaxNode[];
  typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null;
  unspecifiedEnumeration: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaShortClassSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.causality =
      abstractSyntaxNode?.causality ??
      toEnum(ModelicaCausality, concreteSyntaxNode?.childForFieldName("causality")?.text) ??
      null;
    this.typeSpecifier = ModelicaTypeSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("typeSpecifier"),
      abstractSyntaxNode?.typeSpecifier,
    );
    this.arraySubscripts = ModelicaArraySubscriptsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("arraySubscripts"),
      abstractSyntaxNode?.arraySubscripts,
    );
    this.classModification = ModelicaClassModificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classModification"),
      abstractSyntaxNode?.classModification,
    );
    this.enumeration = abstractSyntaxNode?.enumeration ?? concreteSyntaxNode?.childForFieldName("enumeration") != null;
    this.enumerationLiterals = ModelicaEnumerationLiteralSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("enumerationLiteral"),
      abstractSyntaxNode?.enumerationLiterals,
    );
    this.unspecifiedEnumeration =
      abstractSyntaxNode?.unspecifiedEnumeration ??
      concreteSyntaxNode?.childForFieldName("unspecifiedEnumeration") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitShortClassSpecifier(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaShortClassSpecifierSyntaxNode | null,
  ): ModelicaShortClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaShortClassSpecifierSyntaxNode.type:
        return new ModelicaShortClassSpecifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  override get sections(): ModelicaSectionSyntaxNode[] {
    return [];
  }
}

export interface IModelicaDerClassSpecifierSyntaxNode extends IModelicaClassSpecifierSyntaxNode {
  inputs: IModelicaIdentifierSyntaxNode[];
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaDerClassSpecifierSyntaxNode
  extends ModelicaClassSpecifierSyntaxNode
  implements IModelicaDerClassSpecifierSyntaxNode
{
  inputs: ModelicaIdentifierSyntaxNode[];
  typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDerClassSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.typeSpecifier = ModelicaTypeSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("typeSpecifier"),
      abstractSyntaxNode?.typeSpecifier,
    );
    this.inputs = ModelicaDescriptionSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("input"),
      abstractSyntaxNode?.inputs,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDerClassSpecifier(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDerClassSpecifierSyntaxNode | null,
  ): ModelicaDerClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaDerClassSpecifierSyntaxNode.type:
        return new ModelicaDerClassSpecifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get sections(): ModelicaSectionSyntaxNode[] {
    return [];
  }
}

export interface IModelicaEnumerationLiteralSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaEnumerationLiteralSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaEnumerationLiteralSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEnumerationLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEnumerationLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEnumerationLiteralSyntaxNode | null,
  ): ModelicaEnumerationLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaEnumerationLiteralSyntaxNode.type:
        return new ModelicaEnumerationLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaExternalFunctionClauseSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  externalFunctionCall: IModelicaExternalFunctionCallSyntaxNode | null;
  languageSpecification: IModelicaLanguageSpecificationSyntaxNode | null;
}

export class ModelicaExternalFunctionClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaExternalFunctionClauseSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  externalFunctionCall: ModelicaExternalFunctionCallSyntaxNode | null;
  languageSpecification: ModelicaLanguageSpecificationSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExternalFunctionClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.languageSpecification = ModelicaLanguageSpecificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("languageSpecification"),
      abstractSyntaxNode?.languageSpecification,
    );
    this.externalFunctionCall = ModelicaExternalFunctionCallSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("externalFunctionCall"),
      abstractSyntaxNode?.externalFunctionCall,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExternalFunctionClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExternalFunctionClauseSyntaxNode | null,
  ): ModelicaExternalFunctionClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaExternalFunctionClauseSyntaxNode.type:
        return new ModelicaExternalFunctionClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaLanguageSpecificationSyntaxNode extends IModelicaSyntaxNode {
  language: IModelicaStringLiteralSyntaxNode | null;
}

export class ModelicaLanguageSpecificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaLanguageSpecificationSyntaxNode
{
  language: ModelicaStringLiteralSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLanguageSpecificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.language = ModelicaStringLiteralSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("language"),
      abstractSyntaxNode?.language,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitLanguageSpecification(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLanguageSpecificationSyntaxNode | null,
  ): ModelicaLanguageSpecificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaLanguageSpecificationSyntaxNode.type:
        return new ModelicaLanguageSpecificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaExternalFunctionCallSyntaxNode extends IModelicaSyntaxNode {
  arguments: IModelicaExpressionListSyntaxNode | null;
  functionName: IModelicaIdentifierSyntaxNode | null;
  output: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaExternalFunctionCallSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaExternalFunctionCallSyntaxNode
{
  arguments: ModelicaExpressionListSyntaxNode | null;
  functionName: ModelicaIdentifierSyntaxNode | null;
  output: ModelicaComponentReferenceSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExternalFunctionCallSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.output = ModelicaComponentReferenceSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("output"),
      abstractSyntaxNode?.output,
    );
    this.functionName = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionName"),
      abstractSyntaxNode?.functionName,
    );
    this.arguments = ModelicaExpressionListSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("arguments"),
      abstractSyntaxNode?.arguments,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExternalFunctionCall(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExternalFunctionCallSyntaxNode | null,
  ): ModelicaExternalFunctionCallSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaExternalFunctionCallSyntaxNode.type:
        return new ModelicaExternalFunctionCallSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaSectionSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaSectionSyntaxNode extends ModelicaSyntaxNode {
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSectionSyntaxNode | null,
  ): ModelicaSectionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
        );
      case "Initial" + ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
          "Initial" + ModelicaElementSectionSyntaxNode.type,
          ModelicaVisibility.PUBLIC,
        );
      case ModelicaEquationSectionSyntaxNode.type:
        return new ModelicaEquationSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEquationSectionSyntaxNode,
        );
      case ModelicaAlgorithmSectionSyntaxNode.type:
        return new ModelicaAlgorithmSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaAlgorithmSectionSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaElementSectionSyntaxNode extends IModelicaSectionSyntaxNode {
  elements: IModelicaElementSyntaxNode[];
  visibility: ModelicaVisibility | null;
}

export class ModelicaElementSectionSyntaxNode
  extends ModelicaSectionSyntaxNode
  implements IModelicaElementSectionSyntaxNode
{
  elements: ModelicaElementSyntaxNode[];
  visibility: ModelicaVisibility | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementSectionSyntaxNode | null,
    type?: string | null,
    visibility?: ModelicaVisibility | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, type);
    this.visibility =
      visibility ??
      abstractSyntaxNode?.visibility ??
      toEnum(ModelicaVisibility, concreteSyntaxNode?.childForFieldName("visibility")?.text) ??
      null;
    this.elements = ModelicaElementSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("element"),
      abstractSyntaxNode?.elements,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementSection(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementSectionSyntaxNode | null,
  ): ModelicaElementSectionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      case "Initial" + ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode,
          "Initial" + ModelicaElementSectionSyntaxNode.type,
          ModelicaVisibility.PUBLIC,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaImportClauseSyntaxNode extends IModelicaElementSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
  packageName: IModelicaNameSyntaxNode | null;
}

export abstract class ModelicaImportClauseSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaImportClauseSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;
  packageName: ModelicaNameSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaImportClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.packageName = ModelicaNameSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("packageName"),
      abstractSyntaxNode?.packageName,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaImportClauseSyntaxNode | null,
  ): ModelicaImportClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleImportClauseSyntaxNode,
        );
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaCompoundImportClauseSyntaxNode,
        );
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnqualifiedImportClauseSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaSimpleImportClauseSyntaxNode extends IModelicaImportClauseSyntaxNode {
  shortName: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaSimpleImportClauseSyntaxNode
  extends ModelicaImportClauseSyntaxNode
  implements IModelicaSimpleImportClauseSyntaxNode
{
  shortName: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleImportClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.shortName = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("shortName"),
      abstractSyntaxNode?.shortName,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleImportClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleImportClauseSyntaxNode | null,
  ): ModelicaSimpleImportClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaCompoundImportClauseSyntaxNode extends IModelicaImportClauseSyntaxNode {
  importNames: IModelicaIdentifierSyntaxNode[];
}

export class ModelicaCompoundImportClauseSyntaxNode
  extends ModelicaImportClauseSyntaxNode
  implements IModelicaCompoundImportClauseSyntaxNode
{
  importNames: ModelicaIdentifierSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaCompoundImportClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.importNames = ModelicaIdentifierSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("importName"),
      abstractSyntaxNode?.importNames,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitCompoundImportClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaCompoundImportClauseSyntaxNode | null,
  ): ModelicaCompoundImportClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaUnqualifiedImportClauseSyntaxNode = IModelicaImportClauseSyntaxNode;

export class ModelicaUnqualifiedImportClauseSyntaxNode
  extends ModelicaImportClauseSyntaxNode
  implements IModelicaUnqualifiedImportClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnqualifiedImportClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnqualifiedImportClauseSyntaxNode | null,
  ): ModelicaUnqualifiedImportClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaExtendsClauseSyntaxNode extends IModelicaElementSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  classOrInheritanceModification: IModelicaClassOrInheritanceModificationSyntaxNode | null;
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaExtendsClauseSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaExtendsClauseSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  classOrInheritanceModification: ModelicaClassOrInheritanceModificationSyntaxNode | null;
  typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExtendsClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.typeSpecifier = ModelicaTypeSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("typeSpecifier"),
      abstractSyntaxNode?.typeSpecifier,
    );
    this.classOrInheritanceModification = ModelicaClassOrInheritanceModificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classOrInheritanceModification"),
      abstractSyntaxNode?.classOrInheritanceModification,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExtendsClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExtendsClauseSyntaxNode | null,
  ): ModelicaExtendsClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaExtendsClauseSyntaxNode.type:
        return new ModelicaExtendsClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaConstrainingClauseSyntaxNode extends IModelicaSyntaxNode {
  classModification: IModelicaClassModificationSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaConstrainingClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaConstrainingClauseSyntaxNode
{
  classModification: ModelicaClassModificationSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;
  typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConstrainingClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.typeSpecifier = ModelicaTypeSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("typeSpecifier"),
      abstractSyntaxNode?.typeSpecifier,
    );
    this.classModification = ModelicaClassModificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classModification"),
      abstractSyntaxNode?.classModification,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConstrainingClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConstrainingClauseSyntaxNode | null,
  ): ModelicaConstrainingClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaConstrainingClauseSyntaxNode.type:
        return new ModelicaConstrainingClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaClassOrInheritanceModificationSyntaxNode extends IModelicaSyntaxNode {
  modificationArgumentOrInheritanceModifications: (
    | IModelicaModificationArgumentSyntaxNode
    | IModelicaInheritanceModificationSyntaxNode
  )[];
}

export class ModelicaClassOrInheritanceModificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaClassOrInheritanceModificationSyntaxNode
{
  modificationArgumentOrInheritanceModifications: (
    | ModelicaModificationArgumentSyntaxNode
    | ModelicaInheritanceModificationSyntaxNode
  )[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassOrInheritanceModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.modificationArgumentOrInheritanceModifications = [];
    const concreteSyntaxNodeArray =
      concreteSyntaxNode?.childrenForFieldName("modificationArgumentOrInheritanceModification") ?? [];
    const abstractSyntaxNodeArray = abstractSyntaxNode?.modificationArgumentOrInheritanceModifications ?? [];
    const length = Math.max(concreteSyntaxNodeArray?.length ?? 0, abstractSyntaxNodeArray?.length ?? 0);
    for (let i = 0; i < length; i++) {
      const node = ModelicaSyntaxNode.new(
        parent,
        concreteSyntaxNodeArray?.[i] ?? null,
        abstractSyntaxNodeArray?.[i] ?? null,
      );
      if (
        node instanceof ModelicaModificationArgumentSyntaxNode ||
        node instanceof ModelicaInheritanceModificationSyntaxNode
      )
        this.modificationArgumentOrInheritanceModifications.push(node);
    }
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassOrInheritanceModification(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassOrInheritanceModificationSyntaxNode | null,
  ): ModelicaClassOrInheritanceModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassOrInheritanceModificationSyntaxNode.type:
        return new ModelicaClassOrInheritanceModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaInheritanceModificationSyntaxNode extends IModelicaSyntaxNode {
  connectEquation: IModelicaConnectEquationSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaInheritanceModificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaInheritanceModificationSyntaxNode
{
  connectEquation: ModelicaConnectEquationSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaInheritanceModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.connectEquation = ModelicaConnectEquationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("connectEquation"),
      abstractSyntaxNode?.connectEquation,
    );
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitInheritanceModification(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaInheritanceModificationSyntaxNode | null,
  ): ModelicaInheritanceModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaInheritanceModificationSyntaxNode.type:
        return new ModelicaInheritanceModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaComponentClauseSyntaxNode extends IModelicaElementSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  componentDeclarations: IModelicaComponentDeclarationSyntaxNode[];
  constrainingClause: IModelicaConstrainingClauseSyntaxNode | null;
  causality: ModelicaCausality | null;
  final: boolean;
  flow: ModelicaFlow | null;
  inner: boolean;
  outer: boolean;
  redeclare: boolean;
  replaceable: boolean;
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
  variability: ModelicaVariability | null;
}

export class ModelicaComponentClauseSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaComponentClauseSyntaxNode
{
  arraySubscripts: ModelicaArraySubscriptsSyntaxNode | null;
  componentDeclarations: ModelicaComponentDeclarationSyntaxNode[];
  constrainingClause: ModelicaConstrainingClauseSyntaxNode | null;
  causality: ModelicaCausality | null;
  final: boolean;
  flow: ModelicaFlow | null;
  inner: boolean;
  outer: boolean;
  redeclare: boolean;
  replaceable: boolean;
  typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null;
  variability: ModelicaVariability | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.final = abstractSyntaxNode?.final ?? concreteSyntaxNode?.childForFieldName("final") != null;
    this.inner = abstractSyntaxNode?.inner ?? concreteSyntaxNode?.childForFieldName("inner") != null;
    this.outer = abstractSyntaxNode?.outer ?? concreteSyntaxNode?.childForFieldName("outer") != null;
    this.redeclare = abstractSyntaxNode?.redeclare ?? concreteSyntaxNode?.childForFieldName("redeclare") != null;
    this.replaceable = abstractSyntaxNode?.replaceable ?? concreteSyntaxNode?.childForFieldName("replaceable") != null;
    this.flow =
      abstractSyntaxNode?.flow ?? toEnum(ModelicaFlow, concreteSyntaxNode?.childForFieldName("flow")?.text) ?? null;
    this.variability =
      abstractSyntaxNode?.variability ??
      toEnum(ModelicaVariability, concreteSyntaxNode?.childForFieldName("variability")?.text) ??
      null;
    this.causality =
      abstractSyntaxNode?.causality ??
      toEnum(ModelicaCausality, concreteSyntaxNode?.childForFieldName("causality")?.text) ??
      null;
    this.typeSpecifier = ModelicaTypeSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("typeSpecifier"),
      abstractSyntaxNode?.typeSpecifier,
    );
    this.arraySubscripts = ModelicaArraySubscriptsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("arraySubscripts"),
      abstractSyntaxNode?.arraySubscripts,
    );
    this.componentDeclarations = ModelicaComponentDeclarationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("componentDeclaration"),
      abstractSyntaxNode?.componentDeclarations,
    );
    this.constrainingClause = ModelicaConstrainingClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("constrainingClause"),
      abstractSyntaxNode?.constrainingClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClauseSyntaxNode | null,
  ): ModelicaComponentClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentClauseSyntaxNode.type:
        return new ModelicaComponentClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaComponentDeclarationSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  conditionAttribute: IModelicaConditionAttributeSyntaxNode | null;
  declaration: IModelicaDeclarationSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export class ModelicaComponentDeclarationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentDeclarationSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  conditionAttribute: ModelicaConditionAttributeSyntaxNode | null;
  declaration: ModelicaDeclarationSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentDeclarationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.declaration = ModelicaDeclarationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("declaration"),
      abstractSyntaxNode?.declaration,
    );
    this.conditionAttribute = ModelicaConditionAttributeSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("conditionAttribute"),
      abstractSyntaxNode?.conditionAttribute,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentDeclaration(this, argument);
  }

  get arraySubscripts(): IterableIterator<ModelicaSubscriptSyntaxNode> {
    const declaration = this.declaration ?? null;
    const componentClause = this.parent ?? null;
    return (function* () {
      yield* declaration?.arraySubscripts?.subscripts ?? [];
      yield* componentClause?.arraySubscripts?.subscripts ?? [];
    })();
  }

  override get parent(): ModelicaComponentClauseSyntaxNode | null {
    return super.parent as ModelicaComponentClauseSyntaxNode | null;
  }

  static override new(
    parent: ModelicaComponentClauseSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentDeclarationSyntaxNode | null,
  ): ModelicaComponentDeclarationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentDeclarationSyntaxNode.type:
        return new ModelicaComponentDeclarationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaConditionAttributeSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaConditionAttributeSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaConditionAttributeSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConditionAttributeSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConditionAttribute(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConditionAttributeSyntaxNode | null,
  ): ModelicaConditionAttributeSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaConditionAttributeSyntaxNode.type:
        return new ModelicaConditionAttributeSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaDeclarationSyntaxNode extends IModelicaSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
  modification: IModelicaModificationSyntaxNode | null;
}

export class ModelicaDeclarationSyntaxNode extends ModelicaSyntaxNode implements IModelicaDeclarationSyntaxNode {
  arraySubscripts: ModelicaArraySubscriptsSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;
  modification: ModelicaModificationSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDeclarationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
    this.arraySubscripts = ModelicaArraySubscriptsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("arraySubscripts"),
      abstractSyntaxNode?.arraySubscripts,
    );
    this.modification = ModelicaModificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("modification"),
      abstractSyntaxNode?.modification,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDeclaration(this, argument);
  }

  static override new(
    parent: ModelicaComponentDeclarationSyntaxNode | ModelicaComponentDeclaration1SyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDeclarationSyntaxNode | null,
  ): ModelicaDeclarationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaDeclarationSyntaxNode.type:
        return new ModelicaDeclarationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaModificationSyntaxNode extends IModelicaSyntaxNode {
  classModification: IModelicaClassModificationSyntaxNode | null;
  modificationExpression: IModelicaModificationExpressionSyntaxNode | null;
}

export class ModelicaModificationSyntaxNode extends ModelicaSyntaxNode implements IModelicaModificationSyntaxNode {
  classModification: ModelicaClassModificationSyntaxNode | null;
  modificationExpression: ModelicaModificationExpressionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.classModification = ModelicaClassModificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classModification"),
      abstractSyntaxNode?.classModification,
    );
    this.modificationExpression = ModelicaModificationExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("modificationExpression"),
      abstractSyntaxNode?.modificationExpression,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitModification(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationSyntaxNode | null,
  ): ModelicaModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaModificationSyntaxNode.type:
        return new ModelicaModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaModificationExpressionSyntaxNode extends IModelicaSyntaxNode {
  break: boolean;
  expression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaModificationExpressionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaModificationExpressionSyntaxNode
{
  break: boolean;
  expression: ModelicaExpressionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.expression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression"),
      abstractSyntaxNode?.expression,
    );
    this.break = abstractSyntaxNode?.break ?? concreteSyntaxNode?.childForFieldName("break") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitModificationExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationExpressionSyntaxNode | null,
  ): ModelicaModificationExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaModificationExpressionSyntaxNode.type:
        return new ModelicaModificationExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaClassModificationSyntaxNode extends IModelicaSyntaxNode {
  modificationArguments: IModelicaModificationArgumentSyntaxNode[];
}

export class ModelicaClassModificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaClassModificationSyntaxNode
{
  modificationArguments: ModelicaModificationArgumentSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.modificationArguments = ModelicaModificationArgumentSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("modificationArgument"),
      abstractSyntaxNode?.modificationArguments,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassModification(this, argument);
  }

  hasModificationArgument(name: string): boolean {
    const nameComponents = name.split(".");
    if (nameComponents.length === 0) return false;
    for (const modificationArgument of this.modificationArguments) {
      if (modificationArgument instanceof ModelicaElementModificationSyntaxNode) {
        const length = modificationArgument.name?.parts?.length ?? 0;
        if (length === 0 || length > nameComponents.length) continue;
        let match = true;
        for (let i = 0; i < length; i++) {
          if (modificationArgument.name?.parts?.[i]?.text !== nameComponents[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          if (nameComponents.length === length) {
            return true;
          } else if (nameComponents.length > length) {
            name = nameComponents.slice(length).join(".");
            if (modificationArgument.modification?.classModification?.hasModificationArgument(name)) return true;
          }
        }
      }
    }
    return false;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassModificationSyntaxNode | null,
  ): ModelicaClassModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassModificationSyntaxNode.type:
        return new ModelicaClassModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaModificationArgumentSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaModificationArgumentSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaModificationArgumentSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationArgumentSyntaxNode | null,
  ): ModelicaModificationArgumentSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementModificationSyntaxNode.type:
        return new ModelicaElementModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementModificationSyntaxNode,
        );
      case ModelicaElementRedeclarationSyntaxNode.type:
        return new ModelicaElementRedeclarationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementRedeclarationSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaElementModificationSyntaxNode extends IModelicaModificationArgumentSyntaxNode {
  description: IModelicaDescriptionSyntaxNode | null;
  each: boolean;
  final: boolean;
  modification: IModelicaModificationSyntaxNode | null;
  name: IModelicaNameSyntaxNode | null;
}

export class ModelicaElementModificationSyntaxNode
  extends ModelicaModificationArgumentSyntaxNode
  implements IModelicaElementModificationSyntaxNode
{
  description: ModelicaDescriptionSyntaxNode | null;
  each: boolean;
  final: boolean;
  modification: ModelicaModificationSyntaxNode | null;
  name: ModelicaNameSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.each = abstractSyntaxNode?.each ?? concreteSyntaxNode?.childForFieldName("each") != null;
    this.final = abstractSyntaxNode?.final ?? concreteSyntaxNode?.childForFieldName("final") != null;
    this.name = ModelicaNameSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("name"),
      abstractSyntaxNode?.name,
    );
    this.modification = ModelicaModificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("modification"),
      abstractSyntaxNode?.modification,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementModification(this, argument);
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return this.name?.parts?.[0] ?? null;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementModificationSyntaxNode | null,
  ): ModelicaElementModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementModificationSyntaxNode.type:
        return new ModelicaElementModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaElementRedeclarationSyntaxNode extends IModelicaModificationArgumentSyntaxNode {
  componentClause: IModelicaComponentClause1SyntaxNode | null;
  each: boolean;
  final: boolean;
  redeclare: boolean;
  replaceable: boolean;
  shortClassDefinition: IModelicaShortClassDefinitionSyntaxNode | null;
}

export class ModelicaElementRedeclarationSyntaxNode
  extends ModelicaModificationArgumentSyntaxNode
  implements IModelicaElementRedeclarationSyntaxNode
{
  componentClause: ModelicaComponentClause1SyntaxNode | null;
  each: boolean;
  final: boolean;
  redeclare: boolean;
  replaceable: boolean;
  shortClassDefinition: ModelicaShortClassDefinitionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementRedeclarationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.redeclare = abstractSyntaxNode?.redeclare ?? concreteSyntaxNode?.childForFieldName("redeclare") != null;
    this.each = abstractSyntaxNode?.each ?? concreteSyntaxNode?.childForFieldName("each") != null;
    this.final = abstractSyntaxNode?.final ?? concreteSyntaxNode?.childForFieldName("final") != null;
    this.replaceable = abstractSyntaxNode?.replaceable ?? concreteSyntaxNode?.childForFieldName("replaceable") != null;
    this.shortClassDefinition = ModelicaShortClassDefinitionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classDefinition"),
      abstractSyntaxNode?.shortClassDefinition,
    );
    this.componentClause = ModelicaComponentClause1SyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("componentClause"),
      abstractSyntaxNode?.componentClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementRedeclaration(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementRedeclarationSyntaxNode | null,
  ): ModelicaElementRedeclarationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementRedeclarationSyntaxNode.type:
        return new ModelicaElementRedeclarationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaComponentClause1SyntaxNode extends IModelicaSyntaxNode {
  causality: ModelicaCausality | null;
  componentDeclaration: IModelicaComponentDeclaration1SyntaxNode | null;
  constrainingClause: IModelicaConstrainingClauseSyntaxNode | null;
  flow: ModelicaFlow | null;
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
  variability: ModelicaVariability | null;
}

export class ModelicaComponentClause1SyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentClause1SyntaxNode
{
  causality: ModelicaCausality | null;
  componentDeclaration: ModelicaComponentDeclaration1SyntaxNode | null;
  constrainingClause: ModelicaConstrainingClauseSyntaxNode | null;
  flow: ModelicaFlow | null;
  typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null;
  variability: ModelicaVariability | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClause1SyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.flow =
      abstractSyntaxNode?.flow ?? toEnum(ModelicaFlow, concreteSyntaxNode?.childForFieldName("flow")?.text) ?? null;
    this.variability =
      abstractSyntaxNode?.variability ??
      toEnum(ModelicaVariability, concreteSyntaxNode?.childForFieldName("variability")?.text) ??
      null;
    this.causality =
      abstractSyntaxNode?.causality ??
      toEnum(ModelicaCausality, concreteSyntaxNode?.childForFieldName("causality")?.text) ??
      null;
    this.typeSpecifier = ModelicaTypeSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("typeSpecifier"),
      abstractSyntaxNode?.typeSpecifier,
    );
    this.componentDeclaration = ModelicaComponentDeclaration1SyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("componentDeclaration"),
      abstractSyntaxNode?.componentDeclaration,
    );
    this.constrainingClause = ModelicaConstrainingClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("constrainingClause"),
      abstractSyntaxNode?.constrainingClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentClause1(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClause1SyntaxNode | null,
  ): ModelicaComponentClause1SyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentClause1SyntaxNode.type:
        return new ModelicaComponentClause1SyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaComponentDeclaration1SyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  declaration: IModelicaDeclarationSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export class ModelicaComponentDeclaration1SyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentDeclaration1SyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  declaration: ModelicaDeclarationSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentDeclaration1SyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.declaration = ModelicaDeclarationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("declaration"),
      abstractSyntaxNode?.declaration,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentDeclaration1(this, argument);
  }

  get arraySubscripts(): IterableIterator<ModelicaSubscriptSyntaxNode> {
    return (function* () {})();
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentDeclaration1SyntaxNode | null,
  ): ModelicaComponentDeclaration1SyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentDeclaration1SyntaxNode.type:
        return new ModelicaComponentDeclaration1SyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  override get parent(): ModelicaComponentClause1SyntaxNode | null {
    return super.parent as ModelicaComponentClause1SyntaxNode | null;
  }
}

export interface IModelicaShortClassDefinitionSyntaxNode extends IModelicaSyntaxNode {
  classPrefixes: IModelicaClassPrefixesSyntaxNode | null;
  classSpecifier: IModelicaShortClassSpecifierSyntaxNode | null;
  constrainingClause: IModelicaConstrainingClauseSyntaxNode | null;
}

export class ModelicaShortClassDefinitionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaShortClassDefinitionSyntaxNode
{
  classPrefixes: ModelicaClassPrefixesSyntaxNode | null;
  classSpecifier: ModelicaShortClassSpecifierSyntaxNode | null;
  constrainingClause: ModelicaConstrainingClauseSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaShortClassDefinitionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.classPrefixes = ModelicaClassPrefixesSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classPrefixes"),
      abstractSyntaxNode?.classPrefixes,
    );
    this.classSpecifier = ModelicaShortClassSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classSpecifier"),
      abstractSyntaxNode?.classSpecifier,
    );
    this.constrainingClause = ModelicaConstrainingClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("constrainingClause"),
      abstractSyntaxNode?.classSpecifier,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitShortClassDefinition(this, argument);
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return this.classSpecifier?.annotationClause ?? null;
  }

  get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    const classSpecifier = this.classSpecifier;
    return (function* () {
      if (classSpecifier) yield* classSpecifier.elements;
    })();
  }

  get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const classSpecifier = this.classSpecifier;
    return (function* () {
      if (classSpecifier) yield* classSpecifier.equations;
    })();
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return this.classSpecifier?.identifier ?? null;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaShortClassDefinitionSyntaxNode | null,
  ): ModelicaShortClassDefinitionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaShortClassDefinitionSyntaxNode.type:
        return new ModelicaShortClassDefinitionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get sections(): ModelicaSectionSyntaxNode[] {
    return this.classSpecifier?.sections ?? [];
  }
}

export interface IModelicaEquationSectionSyntaxNode extends IModelicaSyntaxNode {
  equations: IModelicaEquationSyntaxNode[];
  initial: boolean;
}

export class ModelicaEquationSectionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaEquationSectionSyntaxNode
{
  equations: ModelicaEquationSyntaxNode[];
  initial: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSectionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.initial = abstractSyntaxNode?.initial ?? concreteSyntaxNode?.childForFieldName("initial") != null;
    this.equations = ModelicaEquationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("equation"),
      abstractSyntaxNode?.equations,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEquationSection(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSectionSyntaxNode | null,
  ): ModelicaEquationSectionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaEquationSectionSyntaxNode.type:
        return new ModelicaEquationSectionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaAlgorithmSectionSyntaxNode extends IModelicaSyntaxNode {
  initial: boolean;
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaAlgorithmSectionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaAlgorithmSectionSyntaxNode
{
  initial: boolean;
  statements: ModelicaStatementSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaAlgorithmSectionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.initial = abstractSyntaxNode?.initial ?? concreteSyntaxNode?.childForFieldName("initial") != null;
    this.statements = ModelicaStatementSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("statement"),
      abstractSyntaxNode?.statements,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitAlgorithmSection(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaAlgorithmSectionSyntaxNode | null,
  ): ModelicaAlgorithmSectionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaAlgorithmSectionSyntaxNode.type:
        return new ModelicaAlgorithmSectionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaEquationSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export abstract class ModelicaEquationSyntaxNode extends ModelicaSyntaxNode implements IModelicaEquationSyntaxNode {
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSyntaxNode | null,
  ): ModelicaEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleEquationSyntaxNode.type:
        return new ModelicaSimpleEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleEquationSyntaxNode,
        );
      case ModelicaSpecialEquationSyntaxNode.type:
        return new ModelicaSpecialEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSpecialEquationSyntaxNode,
        );
      case ModelicaIfEquationSyntaxNode.type:
        return new ModelicaIfEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfEquationSyntaxNode,
        );
      case ModelicaForEquationSyntaxNode.type:
        return new ModelicaForEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForEquationSyntaxNode,
        );
      case ModelicaConnectEquationSyntaxNode.type:
        return new ModelicaConnectEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaConnectEquationSyntaxNode,
        );
      case ModelicaWhenEquationSyntaxNode.type:
        return new ModelicaWhenEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhenEquationSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaStatementSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export abstract class ModelicaStatementSyntaxNode extends ModelicaSyntaxNode implements IModelicaStatementSyntaxNode {
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStatementSyntaxNode | null,
  ): ModelicaStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleAssignmentStatementSyntaxNode.type:
        return new ModelicaSimpleAssignmentStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleAssignmentStatementSyntaxNode,
        );
      case ModelicaProcedureCallStatementSyntaxNode.type:
        return new ModelicaProcedureCallStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaProcedureCallStatementSyntaxNode,
        );
      case ModelicaComplexAssignmentStatementSyntaxNode.type:
        return new ModelicaComplexAssignmentStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComplexAssignmentStatementSyntaxNode,
        );
      case ModelicaBreakStatementSyntaxNode.type:
        return new ModelicaBreakStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBreakStatementSyntaxNode,
        );
      case ModelicaReturnStatementSyntaxNode.type:
        return new ModelicaReturnStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaReturnStatementSyntaxNode,
        );
      case ModelicaIfStatementSyntaxNode.type:
        return new ModelicaIfStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfStatementSyntaxNode,
        );
      case ModelicaForStatementSyntaxNode.type:
        return new ModelicaForStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForStatementSyntaxNode,
        );
      case ModelicaWhileStatementSyntaxNode.type:
        return new ModelicaWhileStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhileStatementSyntaxNode,
        );
      case ModelicaWhenStatementSyntaxNode.type:
        return new ModelicaWhenStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhenStatementSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaSimpleAssignmentStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  source: IModelicaExpressionSyntaxNode | null;
  target: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaSimpleAssignmentStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaSimpleAssignmentStatementSyntaxNode
{
  source: ModelicaExpressionSyntaxNode | null;
  target: ModelicaComponentReferenceSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleAssignmentStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.target = ModelicaComponentReferenceSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("target"),
      abstractSyntaxNode?.target,
    );
    this.source = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("source"),
      abstractSyntaxNode?.source,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleAssignmentStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleAssignmentStatementSyntaxNode | null,
  ): ModelicaSimpleAssignmentStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleAssignmentStatementSyntaxNode.type:
        return new ModelicaSimpleAssignmentStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaProcedureCallStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  functionCallArguments: IModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaProcedureCallStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaProcedureCallStatementSyntaxNode
{
  functionCallArguments: ModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: ModelicaComponentReferenceSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaProcedureCallStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.functionReference = ModelicaComponentReferenceSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionReference"),
      abstractSyntaxNode?.functionReference,
    );
    this.functionCallArguments = ModelicaFunctionCallArgumentsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionCallArguments"),
      abstractSyntaxNode?.functionCallArguments,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitProcedureCallStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaProcedureCallStatementSyntaxNode | null,
  ): ModelicaProcedureCallStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaProcedureCallStatementSyntaxNode.type:
        return new ModelicaProcedureCallStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaComplexAssignmentStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  functionCallArguments: IModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: IModelicaComponentReferenceSyntaxNode | null;
  outputExpressionList: IModelicaOutputExpressionListSyntaxNode | null;
}

export class ModelicaComplexAssignmentStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaComplexAssignmentStatementSyntaxNode
{
  functionCallArguments: ModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: ModelicaComponentReferenceSyntaxNode | null;
  outputExpressionList: ModelicaOutputExpressionListSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComplexAssignmentStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.outputExpressionList = ModelicaOutputExpressionListSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("outputExpressionList"),
      abstractSyntaxNode?.outputExpressionList,
    );
    this.functionReference = ModelicaComponentReferenceSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionReference"),
      abstractSyntaxNode?.functionReference,
    );
    this.functionCallArguments = ModelicaFunctionCallArgumentsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionCallArguments"),
      abstractSyntaxNode?.functionCallArguments,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComplexAssignmentStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComplexAssignmentStatementSyntaxNode | null,
  ): ModelicaComplexAssignmentStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComplexAssignmentStatementSyntaxNode.type:
        return new ModelicaComplexAssignmentStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaSimpleEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  expression1: IModelicaSimpleExpressionSyntaxNode | null;
  expression2: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaSimpleEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaSimpleEquationSyntaxNode
{
  expression1: ModelicaSimpleExpressionSyntaxNode | null;
  expression2: ModelicaExpressionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.expression1 = ModelicaSimpleExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression1"),
      abstractSyntaxNode?.expression1,
    );
    this.expression2 = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression2"),
      abstractSyntaxNode?.expression2,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleEquationSyntaxNode | null,
  ): ModelicaSimpleEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleEquationSyntaxNode.type:
        return new ModelicaSimpleEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaSpecialEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  functionCallArguments: IModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaSpecialEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaSpecialEquationSyntaxNode
{
  functionCallArguments: ModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: ModelicaComponentReferenceSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSpecialEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.functionReference = ModelicaComponentReferenceSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionReference"),
      abstractSyntaxNode?.functionReference,
    );
    this.functionCallArguments = ModelicaFunctionCallArgumentsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionCallArguments"),
      abstractSyntaxNode?.functionCallArguments,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSpecialEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSpecialEquationSyntaxNode | null,
  ): ModelicaSpecialEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSpecialEquationSyntaxNode.type:
        return new ModelicaSpecialEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaIfEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseEquations: IModelicaEquationSyntaxNode[];
  elseIfEquationClauses: IModelicaElseIfEquationClauseSyntaxNode[];
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaIfEquationSyntaxNode extends ModelicaEquationSyntaxNode implements IModelicaIfEquationSyntaxNode {
  condition: ModelicaExpressionSyntaxNode | null;
  elseEquations: ModelicaEquationSyntaxNode[];
  elseIfEquationClauses: ModelicaElseIfEquationClauseSyntaxNode[];
  equations: ModelicaEquationSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.equations = ModelicaEquationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("equation"),
      abstractSyntaxNode?.equations,
    );
    this.elseIfEquationClauses = ModelicaElseIfEquationClauseSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("elseIfEquationClause"),
      abstractSyntaxNode?.elseIfEquationClauses,
    );
    this.elseEquations = ModelicaEquationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("elseEquation"),
      abstractSyntaxNode?.elseEquations,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfEquationSyntaxNode | null,
  ): ModelicaIfEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIfEquationSyntaxNode.type:
        return new ModelicaIfEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaElseIfEquationClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaElseIfEquationClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseIfEquationClauseSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  equations: ModelicaEquationSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfEquationClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.equations = ModelicaEquationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("equation"),
      abstractSyntaxNode?.equations,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfEquationClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfEquationClauseSyntaxNode | null,
  ): ModelicaElseIfEquationClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseIfEquationClauseSyntaxNode.type:
        return new ModelicaElseIfEquationClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaIfStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseStatements: IModelicaStatementSyntaxNode[];
  elseIfStatementClauses: IModelicaElseIfStatementClauseSyntaxNode[];
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaIfStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaIfStatementSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  elseStatements: ModelicaStatementSyntaxNode[];
  elseIfStatementClauses: ModelicaElseIfStatementClauseSyntaxNode[];
  statements: ModelicaStatementSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.statements = ModelicaStatementSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("statement"),
      abstractSyntaxNode?.statements,
    );
    this.elseIfStatementClauses = ModelicaElseIfStatementClauseSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("elseIfStatementClause"),
      abstractSyntaxNode?.elseIfStatementClauses,
    );
    this.elseStatements = ModelicaStatementSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("elseStatement"),
      abstractSyntaxNode?.elseStatements,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfStatementSyntaxNode | null,
  ): ModelicaIfStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIfStatementSyntaxNode.type:
        return new ModelicaIfStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaElseIfStatementClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaElseIfStatementClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseIfStatementClauseSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  statements: ModelicaStatementSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfStatementClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.statements = ModelicaStatementSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("statement"),
      abstractSyntaxNode?.statements,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfStatementClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfStatementClauseSyntaxNode | null,
  ): ModelicaElseIfStatementClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseIfStatementClauseSyntaxNode.type:
        return new ModelicaElseIfStatementClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaForEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  equations: IModelicaEquationSyntaxNode[];
  forIndexes: IModelicaForIndexSyntaxNode[];
}

export class ModelicaForEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaForEquationSyntaxNode
{
  equations: ModelicaEquationSyntaxNode[];
  forIndexes: ModelicaForIndexSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.forIndexes = ModelicaForIndexSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("forIndex"),
      abstractSyntaxNode?.forIndexes,
    );
    this.equations = ModelicaEquationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("equation"),
      abstractSyntaxNode?.equations,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForEquationSyntaxNode | null,
  ): ModelicaForEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaForEquationSyntaxNode.type:
        return new ModelicaForEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaForStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  forIndexes: IModelicaForIndexSyntaxNode[];
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaForStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaForStatementSyntaxNode
{
  forIndexes: ModelicaForIndexSyntaxNode[];
  statements: ModelicaStatementSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.forIndexes = ModelicaForIndexSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("forIndex"),
      abstractSyntaxNode?.forIndexes,
    );
    this.statements = ModelicaStatementSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("statement"),
      abstractSyntaxNode?.statements,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForStatementSyntaxNode | null,
  ): ModelicaForStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaForStatementSyntaxNode.type:
        return new ModelicaForStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaForIndexSyntaxNode extends IModelicaSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaForIndexSyntaxNode extends ModelicaSyntaxNode implements IModelicaForIndexSyntaxNode {
  expression: ModelicaExpressionSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForIndexSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.expression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression"),
      abstractSyntaxNode?.expression,
    );
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForIndex(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForIndexSyntaxNode | null,
  ): ModelicaForIndexSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaForIndexSyntaxNode.type:
        return new ModelicaForIndexSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaWhileStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaWhileStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaWhileStatementSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  statements: ModelicaStatementSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhileStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.statements = ModelicaStatementSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("statement"),
      abstractSyntaxNode?.statements,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhileStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhileStatementSyntaxNode | null,
  ): ModelicaWhileStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaWhileStatementSyntaxNode.type:
        return new ModelicaWhileStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaWhenEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseWhenEquationClauses: IModelicaElseWhenEquationClauseSyntaxNode[];
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaWhenEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaWhenEquationSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  elseWhenEquationClauses: ModelicaElseWhenEquationClauseSyntaxNode[];
  equations: ModelicaEquationSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhenEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.equations = ModelicaEquationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("equation"),
      abstractSyntaxNode?.equations,
    );
    this.elseWhenEquationClauses = ModelicaElseWhenEquationClauseSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("elseWhenEquationClause"),
      abstractSyntaxNode?.elseWhenEquationClauses,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhenEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhenEquationSyntaxNode | null,
  ): ModelicaWhenEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaWhenEquationSyntaxNode.type:
        return new ModelicaWhenEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaElseWhenEquationClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaElseWhenEquationClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseWhenEquationClauseSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  equations: ModelicaEquationSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseWhenEquationClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.equations = ModelicaEquationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("equation"),
      abstractSyntaxNode?.equations,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseWhenEquationClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseWhenEquationClauseSyntaxNode | null,
  ): ModelicaElseWhenEquationClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseWhenEquationClauseSyntaxNode.type:
        return new ModelicaElseWhenEquationClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaWhenStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseWhenStatementClauses: IModelicaElseWhenStatementClauseSyntaxNode[];
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaWhenStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaWhenStatementSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  elseWhenStatementClauses: ModelicaElseWhenStatementClauseSyntaxNode[];
  statements: ModelicaStatementSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhenStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.statements = ModelicaComponentReferenceSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("statement"),
      abstractSyntaxNode?.statements,
    );
    this.elseWhenStatementClauses = ModelicaElseWhenStatementClauseSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("elseWhenStatementClause"),
      abstractSyntaxNode?.elseWhenStatementClauses,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhenStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhenStatementSyntaxNode | null,
  ): ModelicaWhenStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaWhenStatementSyntaxNode.type:
        return new ModelicaWhenStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaElseWhenStatementClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaElseWhenStatementClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseWhenStatementClauseSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  statements: ModelicaStatementSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseWhenStatementClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.statements = ModelicaComponentReferenceSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("statement"),
      abstractSyntaxNode?.statements,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseWhenStatementClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseWhenStatementClauseSyntaxNode | null,
  ): ModelicaElseWhenStatementClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseWhenStatementClauseSyntaxNode.type:
        return new ModelicaElseWhenStatementClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaConnectEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  componentReference1: IModelicaComponentReferenceSyntaxNode | null;
  componentReference2: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaConnectEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaConnectEquationSyntaxNode
{
  componentReference1: ModelicaComponentReferenceSyntaxNode | null;
  componentReference2: ModelicaComponentReferenceSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConnectEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.componentReference1 = ModelicaComponentReferenceSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("componentReference1"),
      abstractSyntaxNode?.componentReference1,
    );
    this.componentReference2 = ModelicaComponentReferenceSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("componentReference2"),
      abstractSyntaxNode?.componentReference2,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConnectEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConnectEquationSyntaxNode | null,
  ): ModelicaConnectEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaConnectEquationSyntaxNode.type:
        return new ModelicaConnectEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaBreakStatementSyntaxNode = IModelicaStatementSyntaxNode;

export class ModelicaBreakStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaBreakStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBreakStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBreakStatementSyntaxNode | null,
  ): ModelicaBreakStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBreakStatementSyntaxNode.type:
        return new ModelicaBreakStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaReturnStatementSyntaxNode = IModelicaStatementSyntaxNode;

export class ModelicaReturnStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaReturnStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitReturnStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaReturnStatementSyntaxNode | null,
  ): ModelicaReturnStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaReturnStatementSyntaxNode.type:
        return new ModelicaReturnStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaExpressionSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaExpressionSyntaxNode extends ModelicaSyntaxNode implements IModelicaExpressionSyntaxNode {
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExpressionSyntaxNode | null,
  ): ModelicaExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIfElseExpressionSyntaxNode.type:
        return new ModelicaIfElseExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfElseExpressionSyntaxNode,
        );
      case ModelicaRangeExpressionSyntaxNode.type:
        return new ModelicaRangeExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaRangeExpressionSyntaxNode,
        );
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
        );
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaMemberAccessExpressionSyntaxNode.type:
        return new ModelicaMemberAccessExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaMemberAccessExpressionSyntaxNode,
        );
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaOutputExpressionListSyntaxNode,
        );
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConcatenationSyntaxNode,
        );
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConstructorSyntaxNode,
        );
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEndExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaIfElseExpressionSyntaxNode extends IModelicaExpressionSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseIfExpressionClauses: IModelicaElseIfExpressionClauseSyntaxNode[];
  elseExpression: IModelicaExpressionSyntaxNode | null;
  expression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaIfElseExpressionSyntaxNode
  extends ModelicaExpressionSyntaxNode
  implements IModelicaIfElseExpressionSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  elseIfExpressionClauses: ModelicaElseIfExpressionClauseSyntaxNode[];
  elseExpression: ModelicaExpressionSyntaxNode | null;
  expression: ModelicaExpressionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfElseExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.expression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression"),
      abstractSyntaxNode?.expression,
    );
    this.elseIfExpressionClauses = ModelicaElseIfExpressionClauseSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("elseIfExpressionClause"),
      abstractSyntaxNode?.elseIfExpressionClauses,
    );
    this.elseExpression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("elseExpression"),
      abstractSyntaxNode?.elseExpression,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfElseExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfElseExpressionSyntaxNode | null,
  ): ModelicaIfElseExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIfElseExpressionSyntaxNode.type:
        return new ModelicaIfElseExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaElseIfExpressionClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  expression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaElseIfExpressionClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseIfExpressionClauseSyntaxNode
{
  condition: ModelicaExpressionSyntaxNode | null;
  expression: ModelicaExpressionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfExpressionClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.condition = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("condition"),
      abstractSyntaxNode?.condition,
    );
    this.expression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression"),
      abstractSyntaxNode?.expression,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfExpressionClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfExpressionClauseSyntaxNode | null,
  ): ModelicaElseIfExpressionClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseIfExpressionClauseSyntaxNode.type:
        return new ModelicaElseIfExpressionClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaRangeExpressionSyntaxNode extends IModelicaExpressionSyntaxNode {
  startExpression: IModelicaExpressionSyntaxNode | null;
  stepExpression: IModelicaExpressionSyntaxNode | null;
  stopExpression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaRangeExpressionSyntaxNode
  extends ModelicaExpressionSyntaxNode
  implements IModelicaRangeExpressionSyntaxNode
{
  startExpression: ModelicaExpressionSyntaxNode | null;
  stepExpression: ModelicaExpressionSyntaxNode | null;
  stopExpression: ModelicaExpressionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaRangeExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.startExpression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("startExpression"),
      abstractSyntaxNode?.startExpression,
    );
    this.stepExpression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("stepExpression"),
      abstractSyntaxNode?.stepExpression,
    );
    this.stopExpression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("stopExpression"),
      abstractSyntaxNode?.stopExpression,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitRangeExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaRangeExpressionSyntaxNode | null,
  ): ModelicaRangeExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaRangeExpressionSyntaxNode.type:
        return new ModelicaRangeExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaSimpleExpressionSyntaxNode = IModelicaExpressionSyntaxNode;

export abstract class ModelicaSimpleExpressionSyntaxNode
  extends ModelicaExpressionSyntaxNode
  implements IModelicaSimpleExpressionSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleExpressionSyntaxNode | null,
  ): ModelicaSimpleExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
        );
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaMemberAccessExpressionSyntaxNode.type:
        return new ModelicaMemberAccessExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaMemberAccessExpressionSyntaxNode,
        );
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaOutputExpressionListSyntaxNode,
        );
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConcatenationSyntaxNode,
        );
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConstructorSyntaxNode,
        );
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEndExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaUnaryExpressionSyntaxNode extends IModelicaSimpleExpressionSyntaxNode {
  operand: IModelicaSimpleExpressionSyntaxNode | null;
  operator: ModelicaUnaryOperator | null;
}

export class ModelicaUnaryExpressionSyntaxNode
  extends ModelicaSimpleExpressionSyntaxNode
  implements IModelicaUnaryExpressionSyntaxNode
{
  operand: ModelicaSimpleExpressionSyntaxNode | null;
  operator: ModelicaUnaryOperator | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnaryExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.operator =
      abstractSyntaxNode?.operator ??
      toEnum(ModelicaUnaryOperator, concreteSyntaxNode?.childForFieldName("operator")?.text) ??
      null;
    this.operand = ModelicaSimpleExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("operand"),
      abstractSyntaxNode?.operand,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnaryExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnaryExpressionSyntaxNode | null,
  ): ModelicaUnaryExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaBinaryExpressionSyntaxNode extends IModelicaSimpleExpressionSyntaxNode {
  operand1: IModelicaSimpleExpressionSyntaxNode | null;
  operand2: IModelicaSimpleExpressionSyntaxNode | null;
  operator: ModelicaBinaryOperator | null;
}

export class ModelicaBinaryExpressionSyntaxNode
  extends ModelicaSimpleExpressionSyntaxNode
  implements IModelicaBinaryExpressionSyntaxNode
{
  operand1: ModelicaSimpleExpressionSyntaxNode | null;
  operand2: ModelicaSimpleExpressionSyntaxNode | null;
  operator: ModelicaBinaryOperator | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBinaryExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.operand1 = ModelicaSimpleExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("operand1"),
      abstractSyntaxNode?.operand1,
    );
    this.operator =
      abstractSyntaxNode?.operator ??
      toEnum(ModelicaBinaryOperator, concreteSyntaxNode?.childForFieldName("operator")?.text) ??
      null;
    this.operand2 = ModelicaSimpleExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("operand2"),
      abstractSyntaxNode?.operand2,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBinaryExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBinaryExpressionSyntaxNode | null,
  ): ModelicaBinaryExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaPrimaryExpressionSyntaxNode = IModelicaSimpleExpressionSyntaxNode;

export abstract class ModelicaPrimaryExpressionSyntaxNode
  extends ModelicaSimpleExpressionSyntaxNode
  implements IModelicaPrimaryExpressionSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaPrimaryExpressionSyntaxNode | null,
  ): ModelicaPrimaryExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaMemberAccessExpressionSyntaxNode.type:
        return new ModelicaMemberAccessExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaMemberAccessExpressionSyntaxNode,
        );
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaOutputExpressionListSyntaxNode,
        );
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConcatenationSyntaxNode,
        );
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConstructorSyntaxNode,
        );
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEndExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export type IModelicaEndExpressionSyntaxNode = IModelicaPrimaryExpressionSyntaxNode;

export class ModelicaEndExpressionSyntaxNode extends ModelicaSyntaxNode implements IModelicaEndExpressionSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEndExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEndExpressionSyntaxNode | null,
  ): ModelicaEndExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaLiteralSyntaxNode = IModelicaPrimaryExpressionSyntaxNode;

export abstract class ModelicaLiteralSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaLiteralSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLiteralSyntaxNode | null,
  ): ModelicaLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaTypeSpecifierSyntaxNode extends IModelicaSyntaxNode {
  global: boolean;
  name: IModelicaNameSyntaxNode | null;
}

export class ModelicaTypeSpecifierSyntaxNode extends ModelicaSyntaxNode implements IModelicaTypeSpecifierSyntaxNode {
  global: boolean;
  name: ModelicaNameSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaTypeSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.global = abstractSyntaxNode?.global ?? concreteSyntaxNode?.childForFieldName("global") != null;
    this.name = ModelicaNameSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("name"),
      abstractSyntaxNode?.name,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitTypeSpecifier(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaTypeSpecifierSyntaxNode | null,
  ): ModelicaTypeSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaTypeSpecifierSyntaxNode.type:
        return new ModelicaTypeSpecifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaNameSyntaxNode extends IModelicaSyntaxNode {
  parts: IModelicaIdentifierSyntaxNode[];
}

export class ModelicaNameSyntaxNode extends ModelicaSyntaxNode implements IModelicaNameSyntaxNode {
  parts: ModelicaIdentifierSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaNameSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.parts = ModelicaIdentifierSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("part"),
      abstractSyntaxNode?.parts,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitName(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaNameSyntaxNode | null,
  ): ModelicaNameSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaNameSyntaxNode.type:
        return new ModelicaNameSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaComponentReferenceSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  global: boolean;
  parts: IModelicaComponentReferencePartSyntaxNode[];
}

export class ModelicaComponentReferenceSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaComponentReferenceSyntaxNode
{
  global: boolean;
  parts: ModelicaComponentReferencePartSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferenceSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.global = abstractSyntaxNode?.global ?? concreteSyntaxNode?.childForFieldName("global") != null;
    this.parts = ModelicaComponentReferencePartSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("part"),
      abstractSyntaxNode?.parts,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentReference(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferenceSyntaxNode | null,
  ): ModelicaComponentReferenceSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        console.log("ERROR", concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]);
        return null;
    }
  }
}

export interface IModelicaComponentReferencePartSyntaxNode extends IModelicaSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaComponentReferencePartSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentReferencePartSyntaxNode
{
  arraySubscripts: ModelicaArraySubscriptsSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferencePartSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
    this.arraySubscripts = ModelicaArraySubscriptsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("arraySubscripts"),
      abstractSyntaxNode?.arraySubscripts,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentReferencePart(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferencePartSyntaxNode | null,
  ): ModelicaComponentReferencePartSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentReferencePartSyntaxNode.type:
        return new ModelicaComponentReferencePartSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaFunctionCallSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  functionCallArguments: IModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaFunctionCallSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaFunctionCallSyntaxNode
{
  functionCallArguments: ModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: ModelicaComponentReferenceSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionCallSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.functionReference = ModelicaComponentReferenceSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionReference"),
      abstractSyntaxNode?.functionReference,
    );
    this.functionCallArguments = ModelicaFunctionCallArgumentsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionCallArguments"),
      abstractSyntaxNode?.functionCallArguments,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionCall(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionCallSyntaxNode | null,
  ): ModelicaFunctionCallSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaFunctionCallArgumentsSyntaxNode extends IModelicaSyntaxNode {
  arguments: IModelicaFunctionArgumentSyntaxNode[];
  comprehensionClause: IModelicaComprehensionClauseSyntaxNode | null;
  namedArguments: IModelicaNamedArgumentSyntaxNode[];
}

export class ModelicaFunctionCallArgumentsSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaFunctionCallArgumentsSyntaxNode
{
  arguments: ModelicaFunctionArgumentSyntaxNode[];
  comprehensionClause: ModelicaComprehensionClauseSyntaxNode | null;
  namedArguments: ModelicaNamedArgumentSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionCallArgumentsSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.comprehensionClause = ModelicaComprehensionClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("comprehensionClause"),
      abstractSyntaxNode?.comprehensionClause,
    );
    this.arguments = ModelicaFunctionArgumentSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("argument"),
      abstractSyntaxNode?.arguments,
    );
    this.namedArguments = ModelicaNamedArgumentSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("namedArgument"),
      abstractSyntaxNode?.namedArguments,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionCallArguments(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionCallArgumentsSyntaxNode | null,
  ): ModelicaFunctionCallArgumentsSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionCallArgumentsSyntaxNode.type:
        return new ModelicaFunctionCallArgumentsSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaArrayConcatenationSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  expressionLists: IModelicaExpressionListSyntaxNode[];
}

export class ModelicaArrayConcatenationSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaArrayConcatenationSyntaxNode
{
  expressionLists: ModelicaExpressionListSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArrayConcatenationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.expressionLists = ModelicaExpressionListSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("expressionList"),
      abstractSyntaxNode?.expressionLists,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArrayConcatenation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArrayConcatenationSyntaxNode | null,
  ): ModelicaArrayConcatenationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaArrayConstructorSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  comprehensionClause: IModelicaComprehensionClauseSyntaxNode | null;
  expressionList: IModelicaExpressionListSyntaxNode | null;
}

export class ModelicaArrayConstructorSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaArrayConstructorSyntaxNode
{
  comprehensionClause: ModelicaComprehensionClauseSyntaxNode | null;
  expressionList: ModelicaExpressionListSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArrayConstructorSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.comprehensionClause = ModelicaComprehensionClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("comprehensionClause"),
      abstractSyntaxNode?.comprehensionClause,
    );
    this.expressionList = ModelicaExpressionListSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expressionList"),
      abstractSyntaxNode?.expressionList,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArrayConstructor(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArrayConstructorSyntaxNode | null,
  ): ModelicaArrayConstructorSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaComprehensionClauseSyntaxNode extends IModelicaSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
  forIndexes: IModelicaForIndexSyntaxNode[];
}

export class ModelicaComprehensionClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComprehensionClauseSyntaxNode
{
  expression: ModelicaExpressionSyntaxNode | null;
  forIndexes: ModelicaForIndexSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComprehensionClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.expression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression"),
      abstractSyntaxNode?.expression,
    );
    this.forIndexes = ModelicaForIndexSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("forIndex"),
      abstractSyntaxNode?.forIndexes,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComprehensionClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComprehensionClauseSyntaxNode | null,
  ): ModelicaComprehensionClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComprehensionClauseSyntaxNode.type:
        return new ModelicaComprehensionClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaNamedArgumentSyntaxNode extends IModelicaSyntaxNode {
  argument: IModelicaFunctionArgumentSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaNamedArgumentSyntaxNode extends ModelicaSyntaxNode implements IModelicaNamedArgumentSyntaxNode {
  argument: ModelicaFunctionArgumentSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaNamedArgumentSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
    this.argument = ModelicaFunctionArgumentSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("argument"),
      abstractSyntaxNode?.argument,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitNamedArgument(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaNamedArgumentSyntaxNode | null,
  ): ModelicaNamedArgumentSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaNamedArgumentSyntaxNode.type:
        return new ModelicaNamedArgumentSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaFunctionArgumentSyntaxNode extends IModelicaSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
  functionPartialApplication: IModelicaFunctionPartialApplicationSyntaxNode | null;
}

export class ModelicaFunctionArgumentSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaFunctionArgumentSyntaxNode
{
  expression: ModelicaExpressionSyntaxNode | null;
  functionPartialApplication: ModelicaFunctionPartialApplicationSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionArgumentSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.expression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression"),
      abstractSyntaxNode?.expression,
    );
    this.functionPartialApplication = ModelicaFunctionPartialApplicationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("functionPartialApplication"),
      abstractSyntaxNode?.functionPartialApplication,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionArgument(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionArgumentSyntaxNode | null,
  ): ModelicaFunctionArgumentSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionArgumentSyntaxNode.type:
        return new ModelicaFunctionArgumentSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaFunctionPartialApplicationSyntaxNode extends IModelicaSyntaxNode {
  namedArguments: IModelicaNamedArgumentSyntaxNode[];
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaFunctionPartialApplicationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaFunctionPartialApplicationSyntaxNode
{
  namedArguments: ModelicaNamedArgumentSyntaxNode[];
  typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionPartialApplicationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.typeSpecifier = ModelicaTypeSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("typeSpecifier"),
      abstractSyntaxNode?.typeSpecifier,
    );
    this.namedArguments = ModelicaNamedArgumentSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("namedArgument"),
      abstractSyntaxNode?.namedArguments,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionPartialApplication(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionPartialApplicationSyntaxNode | null,
  ): ModelicaFunctionPartialApplicationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionPartialApplicationSyntaxNode.type:
        return new ModelicaFunctionPartialApplicationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaMemberAccessExpressionSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
  outputExpressionList: IModelicaOutputExpressionListSyntaxNode | null;
}

export class ModelicaMemberAccessExpressionSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaMemberAccessExpressionSyntaxNode
{
  arraySubscripts: ModelicaArraySubscriptsSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;
  outputExpressionList: ModelicaOutputExpressionListSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaMemberAccessExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.outputExpressionList = ModelicaOutputExpressionListSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("outputExpressionList"),
      abstractSyntaxNode?.outputExpressionList,
    );
    this.arraySubscripts = ModelicaArraySubscriptsSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("arraySubscripts"),
      abstractSyntaxNode?.arraySubscripts,
    );
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitMemberAccessExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionPartialApplicationSyntaxNode | null,
  ): ModelicaFunctionPartialApplicationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionPartialApplicationSyntaxNode.type:
        return new ModelicaFunctionPartialApplicationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaOutputExpressionListSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  outputs: (IModelicaExpressionSyntaxNode | null)[];
}

export class ModelicaOutputExpressionListSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaOutputExpressionListSyntaxNode
{
  outputs: (ModelicaExpressionSyntaxNode | null)[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaOutputExpressionListSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.outputs = [];
    if (abstractSyntaxNode?.outputs) {
      for (const output of abstractSyntaxNode.outputs) {
        this.outputs.push(output as ModelicaExpressionSyntaxNode | null);
      }
    } else {
      const cursor = concreteSyntaxNode?.walk();
      let blank = true;
      if (cursor != null) {
        if (cursor.gotoFirstChild()) {
          do {
            if (cursor.currentFieldName === "output") {
              this.outputs.push(ModelicaExpressionSyntaxNode.new(this, cursor.currentNode));
              blank = false;
            } else if (cursor.nodeType === ",") {
              if (blank) this.outputs.push(null);
              blank = true;
            }
          } while (cursor.gotoNextSibling());
          if (blank && this.outputs.length > 0) this.outputs.push(null);
        }
      }
    }
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitOutputExpressionList(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaOutputExpressionListSyntaxNode | null,
  ): ModelicaOutputExpressionListSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaExpressionListSyntaxNode extends IModelicaSyntaxNode {
  expressions: IModelicaExpressionSyntaxNode[];
}

export class ModelicaExpressionListSyntaxNode extends ModelicaSyntaxNode implements IModelicaExpressionListSyntaxNode {
  expressions: ModelicaExpressionSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExpressionListSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.expressions = ModelicaExpressionSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("expression"),
      abstractSyntaxNode?.expressions,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExpressionList(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExpressionListSyntaxNode | null,
  ): ModelicaExpressionListSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaExpressionListSyntaxNode.type:
        return new ModelicaExpressionListSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaArraySubscriptsSyntaxNode extends IModelicaSyntaxNode {
  subscripts: IModelicaSubscriptSyntaxNode[];
}

export class ModelicaArraySubscriptsSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaArraySubscriptsSyntaxNode
{
  subscripts: ModelicaSubscriptSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArraySubscriptsSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.subscripts = ModelicaSubscriptSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("subscript"),
      abstractSyntaxNode?.subscripts,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArraySubscripts(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArraySubscriptsSyntaxNode | null,
  ): ModelicaArraySubscriptsSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaArraySubscriptsSyntaxNode.type:
        return new ModelicaArraySubscriptsSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaSubscriptSyntaxNode extends IModelicaSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
  flexible: boolean;
}

export class ModelicaSubscriptSyntaxNode extends ModelicaSyntaxNode implements IModelicaSubscriptSyntaxNode {
  expression: ModelicaExpressionSyntaxNode | null;
  flexible: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSubscriptSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.flexible = abstractSyntaxNode?.flexible ?? concreteSyntaxNode?.childForFieldName("flexible") != null;
    this.expression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression"),
      abstractSyntaxNode?.expression,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSubscript(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSubscriptSyntaxNode | null,
  ): ModelicaSubscriptSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSubscriptSyntaxNode.type:
        return new ModelicaSubscriptSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaDescriptionSyntaxNode extends IModelicaSyntaxNode {
  strings: IModelicaStringLiteralSyntaxNode[];
}

export class ModelicaDescriptionSyntaxNode extends ModelicaSyntaxNode implements IModelicaDescriptionSyntaxNode {
  strings: ModelicaStringLiteralSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDescriptionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.strings = ModelicaStringLiteralSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("string"),
      abstractSyntaxNode?.strings,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDescription(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDescriptionSyntaxNode | null,
  ): ModelicaDescriptionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaDescriptionSyntaxNode.type:
        return new ModelicaDescriptionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaAnnotationClauseSyntaxNode extends IModelicaSyntaxNode {
  classModification: IModelicaClassModificationSyntaxNode | null;
}

export class ModelicaAnnotationClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaAnnotationClauseSyntaxNode
{
  classModification: ModelicaClassModificationSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaAnnotationClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.classModification = ModelicaClassModificationSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classModification"),
      abstractSyntaxNode?.classModification,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitAnnotationClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaAnnotationClauseSyntaxNode | null,
  ): ModelicaAnnotationClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaAnnotationClauseSyntaxNode.type:
        return new ModelicaAnnotationClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaBooleanLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  text: string | null;
}

export class ModelicaBooleanLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaBooleanLiteralSyntaxNode
{
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBooleanLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaBooleanLiteralSyntaxNode.type);
    this.text = abstractSyntaxNode?.text ?? concreteSyntaxNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBooleanLiteralSyntaxNode | null,
  ): ModelicaBooleanLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "BOOLEAN";
  }

  get value(): boolean {
    return this.text === "true";
  }
}

export interface IModelicaIdentifierSyntaxNode extends IModelicaSyntaxNode {
  text: string | null;
}

export class ModelicaIdentifierSyntaxNode extends ModelicaSyntaxNode implements IModelicaIdentifierSyntaxNode {
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIdentifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaIdentifierSyntaxNode.type);
    this.text = abstractSyntaxNode?.text ?? concreteSyntaxNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIdentifier(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIdentifierSyntaxNode | null,
  ): ModelicaIdentifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIdentifierSyntaxNode.type:
        return new ModelicaIdentifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "IDENT";
  }
}

export interface IModelicaStringLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  text: string | null;
}

export class ModelicaStringLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaStringLiteralSyntaxNode
{
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStringLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaStringLiteralSyntaxNode.type);
    this.text =
      abstractSyntaxNode?.text ?? concreteSyntaxNode?.text?.substring(1, concreteSyntaxNode?.text?.length - 1) ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitStringLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStringLiteralSyntaxNode | null,
  ): ModelicaStringLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "STRING";
  }
}

export interface IModelicaUnsignedIntegerLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  text: string | null;
}

export class ModelicaUnsignedIntegerLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaUnsignedIntegerLiteralSyntaxNode
{
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedIntegerLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaUnsignedIntegerLiteralSyntaxNode.type);
    this.text = abstractSyntaxNode?.text ?? concreteSyntaxNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnsignedIntegerLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedIntegerLiteralSyntaxNode | null,
  ): ModelicaUnsignedIntegerLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "UNSIGNED_INTEGER";
  }

  get value(): number {
    if (!this.text) return Number.NaN;
    return parseFloat(this.text);
  }
}

export interface IModelicaUnsignedRealLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  text: string | null;
}

export class ModelicaUnsignedRealLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaUnsignedRealLiteralSyntaxNode
{
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedRealLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaUnsignedRealLiteralSyntaxNode.type);
    this.text = abstractSyntaxNode?.text ?? concreteSyntaxNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnsignedRealLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedRealLiteralSyntaxNode | null,
  ): ModelicaUnsignedRealLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "UNSIGNED_REAL";
  }

  get value(): number {
    if (!this.text) return Number.NaN;
    return parseFloat(this.text);
  }
}

export enum ModelicaBinaryOperator {
  LOGICAL_OR = "or",
  LOGICAL_AND = "and",
  LESS_THAN = "<",
  LESS_THAN_OR_EQUAL = "<=",
  GREATER_THAN = ">",
  GREATER_THAN_OR_EQUAL = ">=",
  EQUALITY = "==",
  INEQUALITY = "<>",
  ADDITION = "+",
  SUBTRACTION = "-",
  ELEMENTWISE_ADDITION = ".+",
  ELEMENTWISE_SUBTRACTION = ".-",
  MULTIPLICATION = "*",
  DIVISION = "/",
  ELEMENTWISE_MULTIPLICATION = ".*",
  ELEMENTWISE_DIVISION = "./",
  EXPONENTIATION = "^",
  ELEMENTWISE_EXPONENTIATION = ".^",
}

export enum ModelicaCausality {
  INPUT = "input",
  OUTPUT = "output ",
}

export enum ModelicaClassKind {
  BLOCK = "block",
  CLASS = "class",
  CONNECTOR = "connector",
  EXPANDABLE_CONNECTOR = "expandable connector",
  FUNCTION = "function",
  MODEL = "model",
  OPERATOR = "operator",
  OPERATOR_FUNCTION = "operator function",
  OPERATOR_RECORD = "operator record",
  PACKAGE = "package",
  RECORD = "record",
  TYPE = "type",
}

export enum ModelicaFlow {
  FLOW = "flow",
  STREAM = "stream",
}

export enum ModelicaPurity {
  PURE = "pure",
  IMPURE = "impure",
}

export enum ModelicaUnaryOperator {
  ELEMENTWISE_UNARY_MINUS = ".-",
  ELEMENTWISE_UNARY_PLUS = ".+",
  LOGICAL_NEGATION = "not",
  UNARY_MINUS = "-",
  UNARY_PLUS = "+",
}

export enum ModelicaVariability {
  CONSTANT = "constant",
  DISCRETE = "discrete",
  PARAMETER = "parameter",
}

export enum ModelicaVisibility {
  PUBLIC = "public",
  PROTECTED = "protected",
}

export interface IModelicaSyntaxVisitor<R, A> {
  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): R;
  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): R;
  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, argument?: A): R;
  visitClassPrefixes(node: ModelicaClassPrefixesSyntaxNode, argument?: A): R;
  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, argument?: A): R;
  visitShortClassSpecifier(node: ModelicaShortClassSpecifierSyntaxNode, argument?: A): R;
  visitDerClassSpecifier(node: ModelicaDerClassSpecifierSyntaxNode, argument?: A): R;
  visitEnumerationLiteral(node: ModelicaEnumerationLiteralSyntaxNode, argument?: A): R;
  visitExternalFunctionClause(node: ModelicaExternalFunctionClauseSyntaxNode, argument?: A): R;
  visitLanguageSpecification(node: ModelicaLanguageSpecificationSyntaxNode, argument?: A): R;
  visitExternalFunctionCall(node: ModelicaExternalFunctionCallSyntaxNode, argument?: A): R;
  visitElementSection(node: ModelicaElementSectionSyntaxNode, argument?: A): R;
  visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, argument?: A): R;
  visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, argument?: A): R;
  visitUnqualifiedImportClause(node: ModelicaUnqualifiedImportClauseSyntaxNode, argument?: A): R;
  visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, argument?: A): R;
  visitConstrainingClause(node: ModelicaConstrainingClauseSyntaxNode, argument?: A): R;
  visitClassOrInheritanceModification(node: ModelicaClassOrInheritanceModificationSyntaxNode, argument?: A): R;
  visitInheritanceModification(node: ModelicaInheritanceModificationSyntaxNode, argument?: A): R;
  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, argument?: A): R;
  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, argument?: A): R;
  visitConditionAttribute(node: ModelicaConditionAttributeSyntaxNode, argument?: A): R;
  visitDeclaration(node: ModelicaDeclarationSyntaxNode, argument?: A): R;
  visitModification(node: ModelicaModificationSyntaxNode, argument?: A): R;
  visitModificationExpression(node: ModelicaModificationExpressionSyntaxNode, argument?: A): R;
  visitClassModification(node: ModelicaClassModificationSyntaxNode, argument?: A): R;
  visitElementModification(node: ModelicaElementModificationSyntaxNode, argument?: A): R;
  visitElementRedeclaration(node: ModelicaElementRedeclarationSyntaxNode, argument?: A): R;
  visitComponentClause1(node: ModelicaComponentClause1SyntaxNode, argument?: A): R;
  visitComponentDeclaration1(node: ModelicaComponentDeclaration1SyntaxNode, argument?: A): R;
  visitShortClassDefinition(node: ModelicaShortClassDefinitionSyntaxNode, argument?: A): R;
  visitEquationSection(node: ModelicaEquationSectionSyntaxNode, argument?: A): R;
  visitAlgorithmSection(node: ModelicaAlgorithmSectionSyntaxNode, argument?: A): R;
  visitSimpleAssignmentStatement(node: ModelicaSimpleAssignmentStatementSyntaxNode, argument?: A): R;
  visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, argument?: A): R;
  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatementSyntaxNode, argument?: A): R;
  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, argument?: A): R;
  visitSpecialEquation(node: ModelicaSpecialEquationSyntaxNode, argument?: A): R;
  visitIfEquation(node: ModelicaIfEquationSyntaxNode, argument?: A): R;
  visitElseIfEquationClause(node: ModelicaElseIfEquationClauseSyntaxNode, argument?: A): R;
  visitIfStatement(node: ModelicaIfStatementSyntaxNode, argument?: A): R;
  visitElseIfStatementClause(node: ModelicaElseIfStatementClauseSyntaxNode, argument?: A): R;
  visitForEquation(node: ModelicaForEquationSyntaxNode, argument?: A): R;
  visitForStatement(node: ModelicaForStatementSyntaxNode, argument?: A): R;
  visitForIndex(node: ModelicaForIndexSyntaxNode, argument?: A): R;
  visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, argument?: A): R;
  visitWhenEquation(node: ModelicaWhenEquationSyntaxNode, argument?: A): R;
  visitElseWhenEquationClause(node: ModelicaElseWhenEquationClauseSyntaxNode, argument?: A): R;
  visitWhenStatement(node: ModelicaWhenStatementSyntaxNode, argument?: A): R;
  visitElseWhenStatementClause(node: ModelicaElseWhenStatementClauseSyntaxNode, argument?: A): R;
  visitConnectEquation(node: ModelicaConnectEquationSyntaxNode, argument?: A): R;
  visitBreakStatement(node: ModelicaBreakStatementSyntaxNode, argument?: A): R;
  visitReturnStatement(node: ModelicaReturnStatementSyntaxNode, argument?: A): R;
  visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode, argument?: A): R;
  visitElseIfExpressionClause(node: ModelicaElseIfExpressionClauseSyntaxNode, argument?: A): R;
  visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode, argument?: A): R;
  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, argument?: A): R;
  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, argument?: A): R;
  visitEndExpression(node: ModelicaEndExpressionSyntaxNode, argument?: A): R;
  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, argument?: A): R;
  visitName(node: ModelicaNameSyntaxNode, argument?: A): R;
  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, argument?: A): R;
  visitComponentReferencePart(node: ModelicaComponentReferencePartSyntaxNode, argument?: A): R;
  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, argument?: A): R;
  visitFunctionCallArguments(node: ModelicaFunctionCallArgumentsSyntaxNode, argument?: A): R;
  visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, argument?: A): R;
  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, argument?: A): R;
  visitComprehensionClause(node: ModelicaComprehensionClauseSyntaxNode, argument?: A): R;
  visitNamedArgument(node: ModelicaNamedArgumentSyntaxNode, argument?: A): R;
  visitFunctionArgument(node: ModelicaFunctionArgumentSyntaxNode, argument?: A): R;
  visitFunctionPartialApplication(node: ModelicaFunctionPartialApplicationSyntaxNode, argument?: A): R;
  visitMemberAccessExpression(node: ModelicaMemberAccessExpressionSyntaxNode, argument?: A): R;
  visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode, argument?: A): R;
  visitExpressionList(node: ModelicaExpressionListSyntaxNode, argument?: A): R;
  visitArraySubscripts(node: ModelicaArraySubscriptsSyntaxNode, argument?: A): R;
  visitSubscript(node: ModelicaSubscriptSyntaxNode, argument?: A): R;
  visitDescription(node: ModelicaDescriptionSyntaxNode, argument?: A): R;
  visitAnnotationClause(node: ModelicaAnnotationClauseSyntaxNode, argument?: A): R;
  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, argument?: A): R;
  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): R;
  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, argument?: A): R;
  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode, argument?: A): R;
  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, argument?: A): R;
}

export abstract class ModelicaSyntaxVisitor<R, A> implements IModelicaSyntaxVisitor<R | null, A> {
  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): R | null {
    node.withinDirective?.accept(this, argument);
    for (const classDefinition of node.classDefinitions) classDefinition.accept(this, argument);
    return null;
  }

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    return null;
  }

  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, argument?: A): R | null {
    node.classPrefixes?.accept(this, argument);
    node.classSpecifier?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitClassPrefixes(node: ModelicaClassPrefixesSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.classModification?.accept(this, argument);
    node.description?.accept(this, argument);
    for (const section of node.sections) section.accept(this, argument);
    node.externalFunctionClause?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    node.endIdentifier?.accept(this, argument);
    return null;
  }

  visitShortClassSpecifier(node: ModelicaShortClassSpecifierSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.typeSpecifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.classModification?.accept(this, argument);
    for (const enumerationLiteral of node.enumerationLiterals) enumerationLiteral.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitDerClassSpecifier(node: ModelicaDerClassSpecifierSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.typeSpecifier?.accept(this, argument);
    for (const input of node.inputs) input.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitEnumerationLiteral(node: ModelicaEnumerationLiteralSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitExternalFunctionClause(node: ModelicaExternalFunctionClauseSyntaxNode, argument?: A): R | null {
    node.languageSpecification?.accept(this, argument);
    node.externalFunctionCall?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitLanguageSpecification(node: ModelicaLanguageSpecificationSyntaxNode, argument?: A): R | null {
    node.language?.accept(this, argument);
    return null;
  }

  visitExternalFunctionCall(node: ModelicaExternalFunctionCallSyntaxNode, argument?: A): R | null {
    node.output?.accept(this, argument);
    node.functionName?.accept(this, argument);
    node.arguments?.accept(this, argument);
    return null;
  }

  visitElementSection(node: ModelicaElementSectionSyntaxNode, argument?: A): R | null {
    for (const element of node.elements) element.accept(this, argument);
    return null;
  }

  visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, argument?: A): R | null {
    node.shortName?.accept(this, argument);
    node.packageName?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    for (const importName of node.importNames) importName.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitUnqualifiedImportClause(node: ModelicaUnqualifiedImportClauseSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.classOrInheritanceModification?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitConstrainingClause(node: ModelicaConstrainingClauseSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.classModification?.accept(this, argument);
    node.description?.accept(this, argument);
    return null;
  }

  visitClassOrInheritanceModification(node: ModelicaClassOrInheritanceModificationSyntaxNode, argument?: A): R | null {
    for (const modificationArgumentOrInheritanceModification of node.modificationArgumentOrInheritanceModifications)
      modificationArgumentOrInheritanceModification.accept(this, argument);
    return null;
  }

  visitInheritanceModification(node: ModelicaInheritanceModificationSyntaxNode, argument?: A): R | null {
    node.connectEquation?.accept(this, argument);
    node.identifier?.accept(this, argument);
    return null;
  }

  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    for (const componentDeclaration of node.componentDeclarations) componentDeclaration?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, argument?: A): R | null {
    node.declaration?.accept(this, argument);
    node.conditionAttribute?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitConditionAttribute(node: ModelicaConditionAttributeSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    return null;
  }

  visitDeclaration(node: ModelicaDeclarationSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.modification?.accept(this, argument);
    return null;
  }

  visitModification(node: ModelicaModificationSyntaxNode, argument?: A): R | null {
    node.classModification?.accept(this, argument);
    node.modificationExpression?.accept(this, argument);
    return null;
  }

  visitModificationExpression(node: ModelicaModificationExpressionSyntaxNode, argument?: A): R | null {
    node.expression?.accept(this, argument);
    return null;
  }

  visitClassModification(node: ModelicaClassModificationSyntaxNode, argument?: A): R | null {
    for (const modificationArgument of node.modificationArguments) modificationArgument.accept(this, argument);
    return null;
  }

  visitElementModification(node: ModelicaElementModificationSyntaxNode, argument?: A): R | null {
    node.name?.accept(this, argument);
    node.modification?.accept(this, argument);
    node.description?.accept(this, argument);
    return null;
  }

  visitElementRedeclaration(node: ModelicaElementRedeclarationSyntaxNode, argument?: A): R | null {
    node.shortClassDefinition?.accept(this, argument);
    node.componentClause?.accept(this, argument);
    return null;
  }

  visitComponentClause1(node: ModelicaComponentClause1SyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.componentDeclaration?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitComponentDeclaration1(node: ModelicaComponentDeclaration1SyntaxNode, argument?: A): R | null {
    node.declaration?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitShortClassDefinition(node: ModelicaShortClassDefinitionSyntaxNode, argument?: A): R | null {
    node.classPrefixes?.accept(this, argument);
    node.classSpecifier?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitEquationSection(node: ModelicaEquationSectionSyntaxNode, argument?: A): R | null {
    for (const equation of node.equations) equation.accept(this, argument);
    return null;
  }

  visitAlgorithmSection(node: ModelicaAlgorithmSectionSyntaxNode, argument?: A): R | null {
    for (const statement of node.statements) statement.accept(this, argument);
    return null;
  }

  visitSimpleAssignmentStatement(node: ModelicaSimpleAssignmentStatementSyntaxNode, argument?: A): R | null {
    node.target?.accept(this, argument);
    node.source?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatementSyntaxNode, argument?: A): R | null {
    node.outputExpressionList?.accept(this, argument);
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, argument?: A): R | null {
    node.expression1?.accept(this, argument);
    node.expression2?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSpecialEquation(node: ModelicaSpecialEquationSyntaxNode, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitIfEquation(node: ModelicaIfEquationSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    for (const elseIfEquationClause of node.elseIfEquationClauses) elseIfEquationClause.accept(this, argument);
    for (const elseEquation of node.elseEquations) elseEquation.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseIfEquationClause(node: ModelicaElseIfEquationClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    return null;
  }

  visitIfStatement(node: ModelicaIfStatementSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    for (const elseIfStatementClause of node.elseIfStatementClauses) elseIfStatementClause.accept(this, argument);
    for (const elseStatement of node.elseStatements) elseStatement.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseIfStatementClause(node: ModelicaElseIfStatementClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement?.accept(this, argument);
    return null;
  }

  visitForEquation(node: ModelicaForEquationSyntaxNode, argument?: A): R | null {
    for (const forIndex of node.forIndexes) forIndex.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitForStatement(node: ModelicaForStatementSyntaxNode, argument?: A): R | null {
    for (const forIndex of node.forIndexes) forIndex.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitForIndex(node: ModelicaForIndexSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.expression?.accept(this, argument);
    return null;
  }

  visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitWhenEquation(node: ModelicaWhenEquationSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    for (const elseWhenEquationClause of node.elseWhenEquationClauses) elseWhenEquationClause.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseWhenEquationClause(node: ModelicaElseWhenEquationClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    return null;
  }

  visitWhenStatement(node: ModelicaWhenStatementSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    for (const elseWhenStatementClause of node.elseWhenStatementClauses) elseWhenStatementClause.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseWhenStatementClause(node: ModelicaElseWhenStatementClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    return null;
  }

  visitConnectEquation(node: ModelicaConnectEquationSyntaxNode, argument?: A): R | null {
    node.componentReference1?.accept(this, argument);
    node.componentReference2?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitBreakStatement(node: ModelicaBreakStatementSyntaxNode, argument?: A): R | null {
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitReturnStatement(node: ModelicaReturnStatementSyntaxNode, argument?: A): R | null {
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    node.expression?.accept(this, argument);
    for (const elseIfExpressionClause of node.elseIfExpressionClauses) elseIfExpressionClause.accept(this, argument);
    node.elseExpression?.accept(this, argument);
    return null;
  }

  visitElseIfExpressionClause(node: ModelicaElseIfExpressionClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    node.expression?.accept(this, argument);
    return null;
  }

  visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode, argument?: A): R | null {
    node.startExpression?.accept(this, argument);
    node.stepExpression?.accept(this, argument);
    node.stopExpression?.accept(this, argument);
    return null;
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, argument?: A): R | null {
    node.operand?.accept(this, argument);
    return null;
  }

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, argument?: A): R | null {
    node.operand1?.accept(this, argument);
    node.operand2?.accept(this, argument);
    return null;
  }

  visitEndExpression(node: ModelicaEndExpressionSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, argument?: A): R | null {
    node.name?.accept(this, argument);
    return null;
  }

  visitName(node: ModelicaNameSyntaxNode, argument?: A): R | null {
    for (const part of node.parts) part.accept(this, argument);
    return null;
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, argument?: A): R | null {
    for (const part of node.parts) part.accept(this, argument);
    return null;
  }

  visitComponentReferencePart(node: ModelicaComponentReferencePartSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    return null;
  }

  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    return null;
  }

  visitFunctionCallArguments(node: ModelicaFunctionCallArgumentsSyntaxNode, argument?: A): R | null {
    node.comprehensionClause?.accept(this, argument);
    for (const arg of node.arguments) arg.accept(this, argument);
    for (const namedArgument of node.namedArguments) namedArgument.accept(this, argument);
    return null;
  }

  visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, argument?: A): R | null {
    for (const expressionList of node.expressionLists) expressionList.accept(this, argument);
    return null;
  }

  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, argument?: A): R | null {
    node.comprehensionClause?.accept(this, argument);
    node.expressionList?.accept(this, argument);
    return null;
  }

  visitComprehensionClause(node: ModelicaComprehensionClauseSyntaxNode, argument?: A): R | null {
    node.expression?.accept(this, argument);
    for (const forIndex of node.forIndexes) forIndex.accept(this, argument);
    return null;
  }

  visitNamedArgument(node: ModelicaNamedArgumentSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.argument?.accept(this, argument);
    return null;
  }

  visitFunctionArgument(node: ModelicaFunctionArgumentSyntaxNode, argument?: A): R | null {
    node.expression?.accept(this, argument);
    node.functionPartialApplication?.accept(this, argument);
    return null;
  }

  visitFunctionPartialApplication(node: ModelicaFunctionPartialApplicationSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    for (const namedArgument of node.namedArguments) namedArgument.accept(this, argument);
    return null;
  }

  visitMemberAccessExpression(node: ModelicaMemberAccessExpressionSyntaxNode, argument?: A): R | null {
    node.outputExpressionList?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.identifier?.accept(this, argument);
    return null;
  }

  visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode, argument?: A): R | null {
    for (const output of node.outputs) output?.accept(this, argument);
    return null;
  }

  visitExpressionList(node: ModelicaExpressionListSyntaxNode, argument?: A): R | null {
    for (const expression of node.expressions) expression.accept(this, argument);
    return null;
  }

  visitArraySubscripts(node: ModelicaArraySubscriptsSyntaxNode, argument?: A): R | null {
    for (const subscript of node.subscripts) subscript.accept(this, argument);
    return null;
  }

  visitSubscript(node: ModelicaSubscriptSyntaxNode, argument?: A): R | null {
    node.expression?.accept(this, argument);
    return null;
  }

  visitDescription(node: ModelicaDescriptionSyntaxNode, argument?: A): R | null {
    for (const string of node.strings) string.accept(this, argument);
    return null;
  }

  visitAnnotationClause(node: ModelicaAnnotationClauseSyntaxNode, argument?: A): R | null {
    node.classModification?.accept(this, argument);
    return null;
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }
}

export class ModelicaSyntaxPrinter extends ModelicaSyntaxVisitor<void, number> {
  out: Writer;

  constructor(out: Writer) {
    super();
    this.out = out;
  }

  private indent(indent: number): void {
    this.out.write("  ".repeat(indent));
  }

  override visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, indent = 0): void {
    node.withinDirective?.accept(this, indent);
    for (const classDefinition of node.classDefinitions) {
      classDefinition.accept(this, indent);
    }
  }

  override visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, indent = 0): void {
    this.indent(indent);
    this.out.write("within ");
    node.packageName?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, indent = 0): void {
    if (node.redeclare) this.out.write("redeclare");
    if (node.final) this.out.write("final");
    if (node.inner) this.out.write("inner");
    if (node.outer) this.out.write("outer");
    if (node.replaceable) this.out.write("replaceable");
    if (node.encapsulated) this.out.write("encapsulated");
    node.classPrefixes?.accept(this, indent);
    this.out.write(" ");
    node.identifier?.accept(this, indent);
    node.classSpecifier?.accept(this, indent);
    node.constrainingClause?.accept(this, indent);
  }

  override visitClassPrefixes(node: ModelicaClassPrefixesSyntaxNode, indent = 0): void {
    if (node.partial) this.out.write("partial");
    if (node.purity) this.out.write(node.purity);
    this.out.write(node.classKind ?? "class");
  }

  override visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, indent = 0): void {
    if (node.extends) this.out.write("extends ");
    node.identifier?.accept(this, indent);
    node.classModification?.accept(this, indent);
    node.description?.accept(this, indent);
    for (const section of node.sections) {
      section.accept(this, indent + 1);
    }
    node.externalFunctionClause?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write("end ");
    node.endIdentifier?.accept(this, indent);
  }

  override visitShortClassSpecifier(node: ModelicaShortClassSpecifierSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    this.out.write(" = ");
    if (node.enumeration) {
      this.out.write("enumeration (");
      if (node.unspecifiedEnumeration) {
        this.out.write(":");
      } else {
        let i = 0;
        for (const enumerationLiteral of node.enumerationLiterals) {
          enumerationLiteral.accept(this, indent);
          if (++i < node.enumerationLiterals.length) {
            this.out.write(", ");
          }
        }
      }
      this.out.write(")");
    } else {
      if (node.causality) {
        this.out.write(node.causality);
      }
      node.typeSpecifier?.accept(this, indent);
      node.arraySubscripts?.accept(this, indent);
      node.classModification?.accept(this, indent);
    }
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitDerClassSpecifier(node: ModelicaDerClassSpecifierSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    this.out.write(" = der(");
    node.typeSpecifier?.accept(this, indent);
    for (const input of node.inputs) {
      this.out.write(", ");
      input.accept(this, indent);
    }
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitEnumerationLiteral(node: ModelicaEnumerationLiteralSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitExternalFunctionClause(node: ModelicaExternalFunctionClauseSyntaxNode, indent = 0): void {
    this.out.write("external ");
    node.languageSpecification?.accept(this, indent);
    node.externalFunctionCall?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitLanguageSpecification(node: ModelicaLanguageSpecificationSyntaxNode, indent = 0): void {
    if (node.language?.text) this.out.write(node.language.text);
  }

  override visitExternalFunctionCall(node: ModelicaExternalFunctionCallSyntaxNode, indent = 0): void {
    if (node.output) {
      node.output.accept(this, indent);
      this.out.write(" = ");
    }
    node.functionName?.accept(this, indent);
    this.out.write("(");
    node.arguments?.accept(this, indent);
    this.out.write(")");
  }

  override visitElementSection(node: ModelicaElementSectionSyntaxNode, indent = 0): void {
    if (node.visibility) {
      this.indent(indent);
      this.out.write(node.visibility + "\n");
    }
    for (const element of node.elements) {
      element.accept(this, indent + 1);
    }
  }

  override visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, indent = 0): void {
    this.indent(indent);
    this.out.write("import ");
    if (node.shortName != null) {
      node.shortName?.accept(this, indent);
      this.out.write(" = ");
    }
    node.packageName?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, indent = 0): void {
    this.indent(indent);
    this.out.write("import ");
    node.packageName?.accept(this, indent);
    this.out.write("{");
    let i = 0;
    for (const importName of node.importNames) {
      importName.accept(this, indent);
      if (++i < node.importNames.length) {
        this.out.write(", ");
      }
    }
    this.out.write("}");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitUnqualifiedImportClause(node: ModelicaUnqualifiedImportClauseSyntaxNode, indent = 0): void {
    this.indent(indent);
    this.out.write("import ");
    node.packageName?.accept(this, indent);
    this.out.write(".*");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, indent = 0): void {
    this.indent(indent);
    this.out.write("extends ");
    node.typeSpecifier?.accept(this, indent);
    node.classOrInheritanceModification?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitConstrainingClause(node: ModelicaConstrainingClauseSyntaxNode, indent = 0): void {
    this.out.write("constrainedby ");
    node.typeSpecifier?.accept(this, indent);
    node.classModification?.accept(this, indent);
    node.description?.accept(this, indent);
  }

  override visitClassOrInheritanceModification(
    node: ModelicaClassOrInheritanceModificationSyntaxNode,
    indent = 0,
  ): void {
    this.out.write("(");
    let i = 0;
    for (const modificationArgumentOrInheritanceModification of node.modificationArgumentOrInheritanceModifications) {
      modificationArgumentOrInheritanceModification.accept(this, indent);
      if (++i < node.modificationArgumentOrInheritanceModifications.length) {
        this.out.write(", ");
      }
    }
    this.out.write(")");
  }

  override visitInheritanceModification(node: ModelicaInheritanceModificationSyntaxNode, indent = 0): void {
    this.out.write("break ");
    if (node.connectEquation) {
      node.connectEquation.accept(this, indent);
    } else {
      node.identifier?.accept(this, indent);
    }
  }

  override visitComponentClause(node: ModelicaComponentClauseSyntaxNode, indent = 0): void {
    if (node.redeclare) this.out.write("redeclare");
    if (node.final) this.out.write("final");
    if (node.inner) this.out.write("inner");
    if (node.outer) this.out.write("outer");
    if (node.replaceable) this.out.write("replaceable");
    if (node.flow) this.out.write(node.flow);
    if (node.variability) this.out.write(node.variability);
    if (node.causality) this.out.write(node.causality);
    node.typeSpecifier?.accept(this, indent);
    node.arraySubscripts?.accept(this, indent);
    let i = 0;
    for (const componentDeclaration of node.componentDeclarations) {
      componentDeclaration.accept(this, indent);
      if (++i < node.componentDeclarations.length) {
        this.out.write(", ");
      }
    }
    node.constrainingClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, indent = 0): void {
    node.declaration?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitConditionAttribute(node: ModelicaConditionAttributeSyntaxNode, indent = 0): void {
    this.out.write(" if ");
    node.condition?.accept(this, indent);
  }

  override visitDeclaration(node: ModelicaDeclarationSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    node.arraySubscripts?.accept(this, indent);
    node.modification?.accept(this, indent);
  }

  override visitModification(node: ModelicaModificationSyntaxNode, indent = 0): void {
    if (node.modificationExpression) {
      node.modificationExpression.accept(this, indent);
    }
    if (node.classModification) {
      node.classModification.accept(this, indent);
    }
  }

  override visitModificationExpression(node: ModelicaModificationExpressionSyntaxNode, indent = 0): void {
    if (node.break) this.out.write("break");
    else node.expression?.accept(this, indent);
  }

  override visitClassModification(node: ModelicaClassModificationSyntaxNode, indent = 0): void {
    if (node.modificationArguments.length > 0) {
      this.out.write("(");
      let i = 0;
      for (const modificationArgument of node.modificationArguments) {
        modificationArgument.accept(this, indent);
        if (++i < node.modificationArguments.length) {
          this.out.write(", ");
        }
      }
      this.out.write(")");
    }
  }

  override visitElementModification(node: ModelicaElementModificationSyntaxNode, indent = 0): void {
    if (node.each) this.out.write("each");
    if (node.final) this.out.write("final");
    node.modification?.accept(this, indent);
    node.name?.accept(this, indent);
    node.description?.accept(this, indent);
  }

  override visitElementRedeclaration(node: ModelicaElementRedeclarationSyntaxNode, indent = 0): void {
    if (node.redeclare) this.out.write("redeclare");
    if (node.each) this.out.write("each");
    if (node.final) this.out.write("final");
    if (node.replaceable) this.out.write("replaceable");
    node.shortClassDefinition?.accept(this, indent);
    node.componentClause?.accept(this, indent);
  }

  override visitComponentClause1(node: ModelicaComponentClause1SyntaxNode, indent = 0): void {
    if (node.flow) this.out.write(node.flow);
    if (node.variability) this.out.write(node.variability);
    if (node.causality) this.out.write(node.causality);
    node.typeSpecifier?.accept(this, indent);
    node.componentDeclaration?.accept(this, indent);
    node.constrainingClause?.accept(this, indent);
  }

  override visitComponentDeclaration1(node: ModelicaComponentDeclaration1SyntaxNode, indent = 0): void {
    node.declaration?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitShortClassDefinition(node: ModelicaShortClassDefinitionSyntaxNode, indent = 0): void {
    node.classPrefixes?.accept(this, indent);
    node.classSpecifier?.accept(this, indent);
    node.constrainingClause?.accept(this, indent);
  }

  override visitEquationSection(node: ModelicaEquationSectionSyntaxNode, indent = 0): void {
    if (node.equations.length > 0) {
      this.indent(indent);
      this.out.write("equation\n");
      for (const equation of node.equations) {
        equation.accept(this, indent + 1);
      }
    }
  }

  override visitAlgorithmSection(node: ModelicaAlgorithmSectionSyntaxNode, indent = 0): void {
    if (node.statements.length > 0) {
      this.indent(indent);
      this.out.write("algorithm\n");
      for (const statement of node.statements) {
        statement.accept(this, indent + 1);
      }
    }
  }

  override visitSimpleAssignmentStatement(node: ModelicaSimpleAssignmentStatementSyntaxNode, indent = 0): void {
    node.target?.accept(this, indent);
    this.out.write(" := ");
    node.source?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, indent = 0): void {
    node.functionCallArguments?.accept(this, indent);
    node.functionCallArguments?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatementSyntaxNode, indent = 0): void {
    node.outputExpressionList?.accept(this, indent);
    this.out.write(" := ");
    node.functionReference?.accept(this, indent);
    node.functionCallArguments?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, indent = 0): void {
    node.expression1?.accept(this, indent);
    this.out.write(" = ");
    node.expression2?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitSpecialEquation(node: ModelicaSpecialEquationSyntaxNode, indent = 0): void {
    node.functionReference?.accept(this, indent);
    node.functionCallArguments?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitIfEquation(node: ModelicaIfEquationSyntaxNode, indent = 0): void {
    this.out.write("if ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const equation of node.equations) equation.accept(this, indent);
    for (const elseIfEquationClause of node.elseIfEquationClauses) elseIfEquationClause.accept(this, indent);
    if (node.elseEquations.length > 0) {
      this.out.write("else ");
      for (const elseEquation of node.elseEquations) elseEquation.accept(this, indent);
    }
    this.out.write("end if");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitElseIfEquationClause(node: ModelicaElseIfEquationClauseSyntaxNode, indent = 0): void {
    this.out.write("elseif ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const equation of node.equations) equation.accept(this, indent);
  }

  override visitIfStatement(node: ModelicaIfStatementSyntaxNode, indent = 0): void {
    this.out.write("if ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const statement of node.statements) statement.accept(this, indent);
    for (const elseIfStatementClause of node.elseIfStatementClauses) elseIfStatementClause.accept(this, indent);
    if (node.elseStatements.length > 0) {
      this.out.write("else ");
      for (const elseStatement of node.elseStatements) elseStatement.accept(this, indent);
    }
    this.out.write("end if");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitElseIfStatementClause(node: ModelicaElseIfStatementClauseSyntaxNode, indent = 0): void {
    this.out.write("elseif ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const statement of node.statements) statement.accept(this, indent);
  }

  override visitForEquation(node: ModelicaForEquationSyntaxNode, indent = 0): void {
    this.out.write("for ");
    let i = 0;
    for (const forIndex of node.forIndexes) {
      forIndex.accept(this, indent);
      if (++i < node.forIndexes.length) this.out.write(", ");
    }
    this.out.write(" loop ");
    for (const equation of node.equations) equation.accept(this, indent);
    this.out.write("end for");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitForStatement(node: ModelicaForStatementSyntaxNode, indent = 0): void {
    this.out.write("for ");
    let i = 0;
    for (const forIndex of node.forIndexes) {
      forIndex.accept(this, indent);
      if (++i < node.forIndexes.length) this.out.write(", ");
    }
    this.out.write(" loop ");
    for (const statement of node.statements) statement.accept(this, indent);
    this.out.write("end for");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitForIndex(node: ModelicaForIndexSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    if (node.expression) {
      this.out.write(" in ");
      node.expression.accept(this, indent);
    }
  }

  override visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, indent = 0): void {
    this.out.write("while ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const statement of node.statements) statement.accept(this, indent);
    this.out.write("end while");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitWhenEquation(node: ModelicaWhenEquationSyntaxNode, indent = 0): void {
    this.out.write("when ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const equation of node.equations) equation.accept(this, indent);
    for (const elseWhenStatementClause of node.elseWhenEquationClauses) elseWhenStatementClause.accept(this, indent);
    this.out.write("end when");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitElseWhenEquationClause(node: ModelicaElseWhenEquationClauseSyntaxNode, indent = 0): void {
    this.out.write("elsewhen ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const equation of node.equations) equation.accept(this, indent);
  }

  override visitWhenStatement(node: ModelicaWhenStatementSyntaxNode, indent = 0): void {
    this.out.write("when ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const statement of node.statements) statement.accept(this, indent);
    for (const elseWhenStatementClause of node.elseWhenStatementClauses) elseWhenStatementClause.accept(this, indent);
    this.out.write("end when");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitElseWhenStatementClause(node: ModelicaElseWhenStatementClauseSyntaxNode, indent = 0): void {
    this.out.write("elsewhen ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    for (const statement of node.statements) statement.accept(this, indent);
  }

  override visitConnectEquation(node: ModelicaConnectEquationSyntaxNode, indent = 0): void {
    this.indent(indent);
    this.out.write("connect(");
    node.componentReference1?.accept(this, indent);
    node.componentReference2?.accept(this, indent);
    this.out.write(")");
    node.annotationClause?.accept(this, indent);
    node.description?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitBreakStatement(node: ModelicaBreakStatementSyntaxNode, indent = 0): void {
    this.out.write("break");
    node.annotationClause?.accept(this, indent);
    node.description?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitReturnStatement(node: ModelicaReturnStatementSyntaxNode, indent = 0): void {
    this.out.write("return");
    node.annotationClause?.accept(this, indent);
    node.description?.accept(this, indent);
    this.out.write(";\n");
  }

  override visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode, indent = 0): void {
    this.out.write("if ");
    node.condition?.accept(this, indent);
    this.out.write(" then ");
    node.expression?.accept(this, indent);
    for (const elseIfExpressionClause of node.elseIfExpressionClauses) elseIfExpressionClause.accept(this, indent);
    this.out.write(" else ");
    node.elseExpression?.accept(this, indent);
  }

  override visitElseIfExpressionClause(node: ModelicaElseIfExpressionClauseSyntaxNode, indent = 0): void {
    this.out.write("elseif ");
    node.condition?.accept(this, indent);
    this.out.write("then ");
    node.expression?.accept(this, indent);
  }

  override visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode, indent = 0): void {
    node.startExpression?.accept(this, indent);
    if (node.stepExpression) {
      this.out.write(":");
      node.stepExpression.accept(this, indent);
    }
    if (node.stopExpression) {
      this.out.write(":");
      node.stopExpression.accept(this, indent);
    }
  }

  override visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, indent = 0): void {
    this.out.write(node.operator ?? "?");
    node.operand?.accept(this, indent);
  }

  override visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, indent = 0): void {
    node.operand1?.accept(this, indent);
    this.out.write(" " + node.operator + " ");
    node.operand2?.accept(this, indent);
  }

  override visitEndExpression(node: ModelicaEndExpressionSyntaxNode, indent = 0): void {
    this.out.write("end");
  }

  override visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, indent = 0): void {
    if (node.global) this.out.write(".");
    node.name?.accept(this, indent);
  }

  override visitName(node: ModelicaNameSyntaxNode, indent = 0): void {
    let i = 0;
    for (const part of node.parts) {
      part.accept(this, indent);
      if (++i < node.parts.length) this.out.write(".");
    }
  }

  override visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, indent = 0): void {
    if (node.global) this.out.write(".");
    let i = 0;
    for (const part of node.parts) {
      part.accept(this, indent);
      if (++i < node.parts.length) this.out.write(".");
    }
  }

  override visitComponentReferencePart(node: ModelicaComponentReferencePartSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    node.arraySubscripts?.accept(this, indent);
  }

  override visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, indent = 0): void {
    node.functionReference?.accept(this, indent);
    node.functionCallArguments?.accept(this, indent);
  }

  override visitFunctionCallArguments(node: ModelicaFunctionCallArgumentsSyntaxNode, indent = 0): void {
    this.out.write("(");
    let i = 0;
    for (const positionalArgument of node.arguments) {
      positionalArgument.accept(this, indent);
      if (++i < node.arguments.length) this.out.write(", ");
    }
    if (node.arguments.length > 0 && node.namedArguments.length > 0) {
      this.out.write(", ");
    }
    i = 0;
    for (const namedArgument of node.namedArguments) {
      namedArgument.accept(this, indent);
      if (++i < node.namedArguments.length) this.out.write(", ");
    }
    this.out.write(")");
  }

  override visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, indent = 0): void {
    this.out.write("(");
    let i = 0;
    for (const expressionList of node.expressionLists) {
      expressionList.accept(this, indent);
      if (++i < node.expressionLists.length) this.out.write("; ");
    }
    this.out.write(")");
  }

  override visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, indent = 0): void {
    this.out.write("{");
    node.expressionList?.accept(this, indent);
    this.out.write("}");
  }

  override visitComprehensionClause(node: ModelicaComprehensionClauseSyntaxNode, indent = 0): void {
    node.expression?.accept(this, indent);
    this.out.write(" for ");
    let i = 0;
    for (const forIndex of node.forIndexes) {
      forIndex.accept(this, indent);
      if (++i < node.forIndexes.length) {
        this.out.write(", ");
      }
    }
  }

  override visitNamedArgument(node: ModelicaNamedArgumentSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    this.out.write(" = ");
    node.argument?.accept(this, indent);
  }

  override visitFunctionArgument(node: ModelicaFunctionArgumentSyntaxNode, indent = 0): void {
    node.expression?.accept(this, indent);
    node.functionPartialApplication?.accept(this, indent);
  }

  override visitFunctionPartialApplication(node: ModelicaFunctionPartialApplicationSyntaxNode, indent = 0): void {
    this.out.write("function ");
    node.typeSpecifier?.accept(this, indent);
    this.out.write("(");
    let i = 0;
    for (const namedArgument of node.namedArguments) {
      namedArgument.accept(this, indent);
      if (++i < node.namedArguments.length) {
        this.out.write(", ");
      }
    }
    this.out.write(")");
  }

  override visitMemberAccessExpression(node: ModelicaMemberAccessExpressionSyntaxNode, indent = 0): void {
    node.outputExpressionList?.accept(this, indent);
    if (node.arraySubscripts) {
      node.arraySubscripts.accept(this, indent);
    } else if (node.identifier) {
      this.out.write(".");
      node.identifier.accept(this, indent);
    }
  }

  override visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode, indent = 0): void {
    this.out.write("(");
    let i = 0;
    for (const output of node.outputs) {
      output?.accept(this, indent);
      if (++i < node.outputs.length) {
        this.out.write(", ");
      }
    }
    this.out.write(")");
  }

  override visitExpressionList(node: ModelicaExpressionListSyntaxNode, indent = 0): void {
    let i = 0;
    for (const expression of node.expressions) {
      expression.accept(this, indent);
      if (++i < node.expressions.length) {
        this.out.write(", ");
      }
    }
  }

  override visitArraySubscripts(node: ModelicaArraySubscriptsSyntaxNode, indent = 0): void {
    this.out.write("[");
    let i = 0;
    for (const subscript of node.subscripts) {
      subscript.accept(this, indent);
      if (++i < node.subscripts.length) this.out.write(", ");
    }
    this.out.write("]");
  }

  override visitSubscript(node: ModelicaSubscriptSyntaxNode, indent = 0): void {
    if (node.flexible) this.out.write(":");
    else node.expression?.accept(this, indent);
  }

  override visitDescription(node: ModelicaDescriptionSyntaxNode, indent = 0): void {
    let i = 0;
    for (const string of node.strings) {
      string.accept(this, indent);
      if (++i < node.strings.length) {
        this.out.write(" + ");
      }
    }
  }

  override visitAnnotationClause(node: ModelicaAnnotationClauseSyntaxNode, indent = 0): void {
    this.out.write("annotation");
    node.classModification?.accept(this, indent);
  }

  override visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, indent = 0): void {
    this.out.write(node.text ?? "");
  }

  override visitIdentifier(node: ModelicaIdentifierSyntaxNode, indent = 0): void {
    this.out.write(node.text ?? "?");
  }

  override visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, indent = 0): void {
    this.out.write(node.text ?? "?");
  }

  override visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode, indent = 0): void {
    this.out.write(node.text ?? "?");
  }

  override visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, indent = 0): void {
    this.out.write(node.text ?? "?");
  }
}
