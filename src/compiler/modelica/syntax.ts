// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "tree-sitter";

export enum ModelicaClassKind {
  CLASS = "class",
  PACKAGE = "package",
}

export enum ModelicaVisibility {
  PUBLIC = "public",
  PROTECTED = "protected",
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

export enum ModelicaUnaryOperator {
  ELEMENTWISE_UNARY_MINUS = ".-",
  ELEMENTWISE_UNARY_PLUS = ".+",
  LOGICAL_NEGATION = "not",
  UNARY_MINUS = "-",
  UNARY_PLUS = "+",
}

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
    if (parent != null) this.#parent = new WeakRef(parent);
    else this.#parent = null;
    if (concreteSyntaxNode != null) this.#concreteSyntaxNode = new WeakRef(concreteSyntaxNode);
    else this.#concreteSyntaxNode = null;
    this["@type"] = type ?? this.constructor.name.substring(8, this.constructor.name.length - 10);
    if (concreteSyntaxNode != null && concreteSyntaxNode.type != this["@type"])
      throw new Error(`Expected concrete syntax node of type "${this["@type"]}", got "${concreteSyntaxNode.type}"`);
    if (abstractSyntaxNode != null && abstractSyntaxNode["@type"] != this["@type"])
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
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaAnnotationClauseSyntaxNode.type:
        return new ModelicaAnnotationClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaAnnotationClauseSyntaxNode,
        );
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaClassDefinitionSyntaxNode.type:
        return new ModelicaClassDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassDefinitionSyntaxNode,
        );
      case ModelicaClassModificationSyntaxNode.type:
        return new ModelicaClassModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassModificationSyntaxNode,
        );
      case ModelicaClassOrInheritanceModificationSyntaxNode.type:
        return new ModelicaClassOrInheritanceModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassOrInheritanceModificationSyntaxNode,
        );
      case ModelicaComponentClauseSyntaxNode.type:
        return new ModelicaComponentClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentClauseSyntaxNode,
        );
      case ModelicaComponentDeclarationSyntaxNode.type:
        return new ModelicaComponentDeclarationSyntaxNode(
          parent as ModelicaComponentClauseSyntaxNode | null,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentDeclarationSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaComponentReferenceComponentSyntaxNode.type:
        return new ModelicaComponentReferenceComponentSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceComponentSyntaxNode,
        );
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaCompoundImportClauseSyntaxNode,
        );
      case ModelicaDeclarationSyntaxNode.type:
        return new ModelicaDeclarationSyntaxNode(
          parent as ModelicaComponentDeclarationSyntaxNode | null,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDeclarationSyntaxNode,
        );
      case ModelicaDescriptionSyntaxNode.type:
        return new ModelicaDescriptionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDescriptionSyntaxNode,
        );
      case ModelicaElementModificationSyntaxNode.type:
        return new ModelicaElementModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementModificationSyntaxNode,
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
      case ModelicaExtendsClauseSyntaxNode.type:
        return new ModelicaExtendsClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExtendsClauseSyntaxNode,
        );
      case ModelicaIdentifierSyntaxNode.type:
        return new ModelicaIdentifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIdentifierSyntaxNode,
        );
      case ModelicaInheritanceModificationSyntaxNode.type:
        return new ModelicaInheritanceModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaInheritanceModificationSyntaxNode,
        );
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLongClassSpecifierSyntaxNode,
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
      case ModelicaNameSyntaxNode.type:
        return new ModelicaNameSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode as IModelicaNameSyntaxNode);
      case ModelicaParenthesizedExpressionSyntaxNode.type:
        return new ModelicaParenthesizedExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaParenthesizedExpressionSyntaxNode,
        );
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleImportClauseSyntaxNode,
        );
      case ModelicaStoredDefinitionSyntaxNode.type:
        return new ModelicaStoredDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStoredDefinitionSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaTypeSpecifierSyntaxNode.type:
        return new ModelicaTypeSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaTypeSpecifierSyntaxNode,
        );
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
        );
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnqualifiedImportClauseSyntaxNode,
        );
      case ModelicaWithinDirectiveSyntaxNode.type:
        return new ModelicaWithinDirectiveSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWithinDirectiveSyntaxNode,
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
      if (node != null) nodes.push(node);
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
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
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
      case ModelicaComponentClauseSyntaxNode.type:
        return new ModelicaComponentClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentClauseSyntaxNode,
        );
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaCompoundImportClauseSyntaxNode,
        );
      case ModelicaExtendsClauseSyntaxNode.type:
        return new ModelicaExtendsClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExtendsClauseSyntaxNode,
        );
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleImportClauseSyntaxNode,
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

export interface IModelicaClassDefinitionSyntaxNode extends IModelicaElementSyntaxNode {
  classKind: ModelicaClassKind | null;
  classSpecifier: IModelicaClassSpecifierSyntaxNode | null;
}

export class ModelicaClassDefinitionSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaClassDefinitionSyntaxNode
{
  classKind: ModelicaClassKind | null;
  classSpecifier: ModelicaClassSpecifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassDefinitionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.classKind =
      toEnum(ModelicaClassKind, concreteSyntaxNode?.childForFieldName("classKind")?.text) ??
      abstractSyntaxNode?.classKind ??
      null;
    this.classSpecifier = ModelicaClassSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("classSpecifier"),
      abstractSyntaxNode?.classSpecifier,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassDefinition(this, argument);
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return this.classSpecifier?.annotationClause ?? null;
  }

  get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    const classSpecifier = this.classSpecifier;
    return (function* () {
      if (classSpecifier != null) yield* classSpecifier.elements;
    })();
  }

  get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const classSpecifier = this.classSpecifier;
    return (function* () {
      if (classSpecifier != null) yield* classSpecifier.equations;
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

  get sections(): IModelicaSectionSyntaxNode[] {
    return this.classSpecifier?.sections ?? [];
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

  abstract get elements(): IterableIterator<ModelicaElementSyntaxNode>;

  abstract get equations(): IterableIterator<ModelicaEquationSyntaxNode>;

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassSpecifierSyntaxNode | null,
  ): ModelicaClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLongClassSpecifierSyntaxNode,
        );
      default:
        return null;
    }
  }

  abstract get sections(): IModelicaSectionSyntaxNode[];
}

export interface IModelicaLongClassSpecifierSyntaxNode extends IModelicaClassSpecifierSyntaxNode {
  endIdentifier: IModelicaIdentifierSyntaxNode | null;
  sections: IModelicaSectionSyntaxNode[];
}

export class ModelicaLongClassSpecifierSyntaxNode
  extends ModelicaClassSpecifierSyntaxNode
  implements IModelicaLongClassSpecifierSyntaxNode
{
  endIdentifier: ModelicaIdentifierSyntaxNode | null;
  sections: ModelicaSectionSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLongClassSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.sections = ModelicaSectionSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("section"),
      abstractSyntaxNode?.sections,
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
      default:
        return null;
    }
  }
}

export interface IModelicaElementSectionSyntaxNode extends IModelicaSectionSyntaxNode {
  elements: IModelicaElementSyntaxNode[];
  visibility: ModelicaVisibility;
}

export class ModelicaElementSectionSyntaxNode
  extends ModelicaSectionSyntaxNode
  implements IModelicaElementSectionSyntaxNode
{
  elements: ModelicaElementSyntaxNode[];
  visibility: ModelicaVisibility;

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
      (concreteSyntaxNode?.childForFieldName("protected") != null
        ? ModelicaVisibility.PROTECTED
        : ModelicaVisibility.PUBLIC);
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
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaInheritanceModificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaInheritanceModificationSyntaxNode
{
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaInheritanceModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
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
  componentDeclarations: IModelicaComponentDeclarationSyntaxNode[];
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaComponentClauseSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaComponentClauseSyntaxNode
{
  componentDeclarations: ModelicaComponentDeclarationSyntaxNode[];
  typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.typeSpecifier = ModelicaTypeSpecifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("typeSpecifier"),
      abstractSyntaxNode?.typeSpecifier,
    );
    this.componentDeclarations = ModelicaComponentDeclarationSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("componentDeclaration"),
      abstractSyntaxNode?.componentDeclarations,
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
  declaration: IModelicaDeclarationSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export class ModelicaComponentDeclarationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentDeclarationSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  declaration: ModelicaDeclarationSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;

  constructor(
    parent: ModelicaComponentClauseSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentDeclarationSyntaxNode | null,
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
    return visitor.visitComponentDeclaration(this, argument);
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

export interface IModelicaDeclarationSyntaxNode extends IModelicaSyntaxNode {
  identifier: IModelicaIdentifierSyntaxNode | null;
  modification: IModelicaModificationSyntaxNode | null;
}

export class ModelicaDeclarationSyntaxNode extends ModelicaSyntaxNode implements IModelicaDeclarationSyntaxNode {
  identifier: ModelicaIdentifierSyntaxNode | null;
  modification: ModelicaModificationSyntaxNode | null;

  constructor(
    parent: ModelicaComponentDeclarationSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDeclarationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
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
    parent: ModelicaComponentDeclarationSyntaxNode | null,
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
  expression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaModificationExpressionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaModificationExpressionSyntaxNode
{
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
  abstract get identifier(): ModelicaIdentifierSyntaxNode | null;

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
      default:
        return null;
    }
  }
}

export interface IModelicaElementModificationSyntaxNode extends IModelicaModificationArgumentSyntaxNode {
  description: IModelicaDescriptionSyntaxNode | null;
  modification: IModelicaModificationSyntaxNode | null;
  name: IModelicaNameSyntaxNode | null;
}

export class ModelicaElementModificationSyntaxNode
  extends ModelicaModificationArgumentSyntaxNode
  implements IModelicaElementModificationSyntaxNode
{
  description: ModelicaDescriptionSyntaxNode | null;
  modification: ModelicaModificationSyntaxNode | null;
  name: ModelicaNameSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
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

  override get identifier(): ModelicaIdentifierSyntaxNode | null {
    return this.name?.components?.[0] ?? null;
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

export interface IModelicaEquationSectionSyntaxNode extends IModelicaSyntaxNode {
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaEquationSectionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaEquationSectionSyntaxNode
{
  equations: ModelicaEquationSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSectionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
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

export type IModelicaExpressionSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaExpressionSyntaxNode extends ModelicaSyntaxNode implements IModelicaExpressionSyntaxNode {
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExpressionSyntaxNode | null,
  ): ModelicaExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaParenthesizedExpressionSyntaxNode.type:
        return new ModelicaParenthesizedExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaParenthesizedExpressionSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
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
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaParenthesizedExpressionSyntaxNode.type:
        return new ModelicaParenthesizedExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaParenthesizedExpressionSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
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
      toEnum(ModelicaUnaryOperator, concreteSyntaxNode?.childForFieldName("operator")?.text) ??
      abstractSyntaxNode?.operator ??
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
      toEnum(ModelicaBinaryOperator, concreteSyntaxNode?.childForFieldName("operator")?.text) ??
      abstractSyntaxNode?.operator ??
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
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaParenthesizedExpressionSyntaxNode.type:
        return new ModelicaParenthesizedExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaParenthesizedExpressionSyntaxNode,
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

export type IModelicaUnsignedNumberLiteralSyntaxNode = IModelicaLiteralSyntaxNode;

export abstract class ModelicaUnsignedNumberLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaUnsignedNumberLiteralSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedNumberLiteralSyntaxNode | null,
  ): ModelicaUnsignedNumberLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
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

export interface IModelicaUnsignedIntegerLiteralSyntaxNode extends IModelicaUnsignedNumberLiteralSyntaxNode {
  value: string | null;
}

export class ModelicaUnsignedIntegerLiteralSyntaxNode
  extends ModelicaUnsignedNumberLiteralSyntaxNode
  implements IModelicaUnsignedIntegerLiteralSyntaxNode
{
  value: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedIntegerLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaUnsignedIntegerLiteralSyntaxNode.type);
    this.value = abstractSyntaxNode?.value ?? concreteSyntaxNode?.text ?? null;
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
}

export interface IModelicaUnsignedRealLiteralSyntaxNode extends IModelicaUnsignedNumberLiteralSyntaxNode {
  value: string | null;
}

export class ModelicaUnsignedRealLiteralSyntaxNode
  extends ModelicaUnsignedNumberLiteralSyntaxNode
  implements IModelicaUnsignedRealLiteralSyntaxNode
{
  value: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedRealLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaUnsignedRealLiteralSyntaxNode.type);
    this.value = abstractSyntaxNode?.value ?? concreteSyntaxNode?.text ?? null;
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
}

export interface IModelicaBooleanLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  value: string | null;
}

export class ModelicaBooleanLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaBooleanLiteralSyntaxNode
{
  value: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBooleanLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaBooleanLiteralSyntaxNode.type);
    this.value = abstractSyntaxNode?.value ?? concreteSyntaxNode?.text ?? null;
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
}

export interface IModelicaStringLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  value: string | null;
}

export class ModelicaStringLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaStringLiteralSyntaxNode
{
  value: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStringLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaStringLiteralSyntaxNode.type);
    this.value =
      abstractSyntaxNode?.value ?? concreteSyntaxNode?.text?.substring(1, concreteSyntaxNode?.text?.length - 1) ?? null;
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

export interface IModelicaParenthesizedExpressionSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaParenthesizedExpressionSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaParenthesizedExpressionSyntaxNode
{
  expression: ModelicaExpressionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaParenthesizedExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.expression = ModelicaExpressionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("expression"),
      abstractSyntaxNode?.expression,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitParenthesizedExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaParenthesizedExpressionSyntaxNode | null,
  ): ModelicaParenthesizedExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaParenthesizedExpressionSyntaxNode.type:
        return new ModelicaParenthesizedExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
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
  components: IModelicaIdentifierSyntaxNode[];
}

export class ModelicaNameSyntaxNode extends ModelicaSyntaxNode implements IModelicaNameSyntaxNode {
  components: ModelicaIdentifierSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaNameSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.components = ModelicaIdentifierSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("component"),
      abstractSyntaxNode?.components,
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
  components: IModelicaComponentReferenceComponentSyntaxNode[];
  global: boolean;
}

export class ModelicaComponentReferenceSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaComponentReferenceSyntaxNode
{
  components: ModelicaComponentReferenceComponentSyntaxNode[];
  global: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferenceSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.global = abstractSyntaxNode?.global ?? concreteSyntaxNode?.childForFieldName("global") != null;
    this.components = ModelicaComponentReferenceComponentSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("component"),
      abstractSyntaxNode?.components,
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
        return null;
    }
  }
}

export interface IModelicaComponentReferenceComponentSyntaxNode extends IModelicaSyntaxNode {
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaComponentReferenceComponentSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentReferenceComponentSyntaxNode
{
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferenceComponentSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentReferenceComponent(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferenceComponentSyntaxNode | null,
  ): ModelicaComponentReferenceComponentSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentReferenceComponentSyntaxNode.type:
        return new ModelicaComponentReferenceComponentSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaDescriptionSyntaxNode extends IModelicaSyntaxNode {
  descriptionStrings: IModelicaStringLiteralSyntaxNode[];
}

export class ModelicaDescriptionSyntaxNode extends ModelicaSyntaxNode implements IModelicaDescriptionSyntaxNode {
  descriptionStrings: ModelicaStringLiteralSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDescriptionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.descriptionStrings = ModelicaStringLiteralSyntaxNode.newArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("descriptionString"),
      abstractSyntaxNode?.descriptionStrings,
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

export interface IModelicaIdentifierSyntaxNode extends IModelicaSyntaxNode {
  value: string | null;
}

export class ModelicaIdentifierSyntaxNode extends ModelicaSyntaxNode implements IModelicaIdentifierSyntaxNode {
  value: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIdentifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaIdentifierSyntaxNode.type);
    this.value = abstractSyntaxNode?.value ?? concreteSyntaxNode?.text ?? null;
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

export interface IModelicaSyntaxVisitor<R, A> {
  visitAnnotationClause(node: ModelicaAnnotationClauseSyntaxNode, argument?: A): R;

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, argument?: A): R;

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, argument?: A): R;

  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, argument?: A): R;

  visitClassModification(node: ModelicaClassModificationSyntaxNode, argument?: A): R;

  visitClassOrInheritanceModification(node: ModelicaClassOrInheritanceModificationSyntaxNode, argument?: A): R;

  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, argument?: A): R;

  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, argument?: A): R;

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, argument?: A): R;

  visitComponentReferenceComponent(node: ModelicaComponentReferenceComponentSyntaxNode, argument?: A): R;

  visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, argument?: A): R;

  visitDeclaration(node: ModelicaDeclarationSyntaxNode, argument?: A): R;

  visitDescription(node: ModelicaDescriptionSyntaxNode, argument?: A): R;

  visitElementModification(node: ModelicaElementModificationSyntaxNode, argument?: A): R;

  visitElementSection(node: ModelicaElementSectionSyntaxNode, argument?: A): R;

  visitEquationSection(node: ModelicaEquationSectionSyntaxNode, argument?: A): R;

  visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, argument?: A): R;

  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): R;

  visitInheritanceModification(node: ModelicaInheritanceModificationSyntaxNode, argument?: A): R;

  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, argument?: A): R;

  visitModification(node: ModelicaModificationSyntaxNode, argument?: A): R;

  visitModificationExpression(node: ModelicaModificationExpressionSyntaxNode, argument?: A): R;

  visitName(node: ModelicaNameSyntaxNode, argument?: A): R;

  visitParenthesizedExpression(node: ModelicaParenthesizedExpressionSyntaxNode, argument?: A): R;

  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, argument?: A): R;

  visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, argument?: A): R;

  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): R;

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, argument?: A): R;

  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, argument?: A): R;

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, argument?: A): R;

  visitUnqualifiedImportClause(node: ModelicaUnqualifiedImportClauseSyntaxNode, argument?: A): R;

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode, argument?: A): R;

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, argument?: A): R;

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): R;
}

export abstract class ModelicaSyntaxVisitor<R, A> implements IModelicaSyntaxVisitor<R | null, A> {
  visitAnnotationClause(node: ModelicaAnnotationClauseSyntaxNode, argument?: A): R | null {
    node.classModification?.accept(this, argument);
    return null;
  }

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, argument?: A): R | null {
    node.operand1?.accept(this, argument);
    node.operand2?.accept(this, argument);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, argument?: A): R | null {
    node.classSpecifier?.accept(this, argument);
    return null;
  }

  visitClassModification(node: ModelicaClassModificationSyntaxNode, argument?: A): R | null {
    for (const modificationArgument of node.modificationArguments) modificationArgument.accept(this, argument);
    return null;
  }

  visitClassOrInheritanceModification(node: ModelicaClassOrInheritanceModificationSyntaxNode, argument?: A): R | null {
    for (const modificationArgumentOrInheritanceModification of node.modificationArgumentOrInheritanceModifications)
      modificationArgumentOrInheritanceModification.accept(this, argument);
    return null;
  }

  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this);
    for (const componentDeclaration of node.componentDeclarations) componentDeclaration.accept(this, argument);
    return null;
  }

  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, argument?: A): R | null {
    node.declaration?.accept(this, argument);
    return null;
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, argument?: A): R | null {
    for (const component of node.components) component.accept(this, argument);
    return null;
  }

  visitComponentReferenceComponent(node: ModelicaComponentReferenceComponentSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    return null;
  }

  visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    for (const importName of node.importNames) importName.accept(this, argument);
    return null;
  }

  visitDeclaration(node: ModelicaDeclarationSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    return null;
  }

  visitDescription(node: ModelicaDescriptionSyntaxNode, argument?: A): R | null {
    for (const descriptionString of node.descriptionStrings) descriptionString.accept(this, argument);
    return null;
  }

  visitElementModification(node: ModelicaElementModificationSyntaxNode, argument?: A): R | null {
    node.name?.accept(this, argument);
    node.modification?.accept(this, argument);
    return null;
  }

  visitElementSection(node: ModelicaElementSectionSyntaxNode, argument?: A): R | null {
    for (const element of node.elements) element.accept(this, argument);
    return null;
  }

  visitEquationSection(node: ModelicaEquationSectionSyntaxNode, argument?: A): R | null {
    for (const equation of node.equations) equation.accept(this, argument);
    return null;
  }

  visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitInheritanceModification(node: ModelicaInheritanceModificationSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    return null;
  }

  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    for (const section of node.sections) section.accept(this, argument);
    node.endIdentifier?.accept(this, argument);
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

  visitName(node: ModelicaNameSyntaxNode, argument?: A): R | null {
    for (const component of node.components) component.accept(this, argument);
    return null;
  }

  visitParenthesizedExpression(node: ModelicaParenthesizedExpressionSyntaxNode, argument?: A): R | null {
    node.accept(this, argument);
    return null;
  }

  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, argument?: A): R | null {
    node.expression1?.accept(this, argument);
    node.expression2?.accept(this, argument);
    return null;
  }

  visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, argument?: A): R | null {
    node.shortName?.accept(this, argument);
    node.packageName?.accept(this, argument);
    return null;
  }

  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): R | null {
    node.withinDirective?.accept(this, argument);
    for (const classDefinition of node.classDefinitions) classDefinition.accept(this, argument);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, argument?: A): R | null {
    node.name?.accept(this, argument);
    return null;
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, argument?: A): R | null {
    node.operand?.accept(this, argument);
    return null;
  }

  visitUnqualifiedImportClause(node: ModelicaUnqualifiedImportClauseSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    return null;
  }
}

function toEnum<T extends Record<number, string | number>>(
  enumType: T,
  value: string | null | undefined,
): T[keyof T] | null {
  for (const key of Object.keys(enumType)) {
    if (enumType[key as keyof T] === value) return enumType[key as keyof T];
  }
  return null;
}
