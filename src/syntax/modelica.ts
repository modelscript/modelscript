// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "tree-sitter";

export enum ModelicaClassKind {
  CLASS = "class",
  PACKAGE = "package",
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
      case ModelicaComponentDeclarationSyntaxNode.type:
        return new ModelicaComponentDeclarationSyntaxNode(
          parent as ModelicaComponentClauseSyntaxNode | null,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentDeclarationSyntaxNode,
        );
      case ModelicaDeclarationSyntaxNode.type:
        return new ModelicaDeclarationSyntaxNode(
          parent as ModelicaComponentDeclarationSyntaxNode | null,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDeclarationSyntaxNode,
        );
      case ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
        );
      case ModelicaIdentifierSyntaxNode.type:
        return new ModelicaIdentifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIdentifierSyntaxNode,
        );
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLongClassSpecifierSyntaxNode,
        );
      case ModelicaNameSyntaxNode.type:
        return new ModelicaNameSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode as IModelicaNameSyntaxNode);
      case ModelicaStoredDefinitionSyntaxNode.type:
        return new ModelicaStoredDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStoredDefinitionSyntaxNode,
        );
      case ModelicaTypeSpecifierSyntaxNode.type:
        return new ModelicaTypeSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaTypeSpecifierSyntaxNode,
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
          abstractSyntaxNode as ModelicaComponentClauseSyntaxNode,
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

  get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    const classSpecifier = this.classSpecifier;
    return (function* () {
      if (classSpecifier != null) yield* classSpecifier.elements;
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
}

export interface IModelicaClassSpecifierSyntaxNode extends IModelicaSyntaxNode {
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export abstract class ModelicaClassSpecifierSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaClassSpecifierSyntaxNode
{
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
  }

  abstract get elements(): IterableIterator<ModelicaElementSyntaxNode>;

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
      default:
        return null;
    }
  }
}

export interface IModelicaElementSectionSyntaxNode extends IModelicaSectionSyntaxNode {
  elements: IModelicaElementSyntaxNode[];
}

export class ModelicaElementSectionSyntaxNode
  extends ModelicaSectionSyntaxNode
  implements IModelicaElementSectionSyntaxNode
{
  elements: ModelicaElementSyntaxNode[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementSectionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
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
  declaration: IModelicaDeclarationSyntaxNode | null;
}

export class ModelicaComponentDeclarationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentDeclarationSyntaxNode
{
  declaration: ModelicaDeclarationSyntaxNode | null;

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
}

export class ModelicaDeclarationSyntaxNode extends ModelicaSyntaxNode implements IModelicaDeclarationSyntaxNode {
  identifier: ModelicaIdentifierSyntaxNode | null;

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
  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, argument?: A): R;

  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, argument?: A): R;

  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, argument?: A): R;

  visitDeclaration(node: ModelicaDeclarationSyntaxNode, argument?: A): R;

  visitElementSection(node: ModelicaElementSectionSyntaxNode, argument?: A): R;

  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): R;

  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, argument?: A): R;

  visitName(node: ModelicaNameSyntaxNode, argument?: A): R;

  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): R;

  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, argument?: A): R;

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): R;
}

export abstract class ModelicaSyntaxVisitor<A> implements IModelicaSyntaxVisitor<void, A> {
  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, argument?: A): void {
    node.classSpecifier?.accept(this, argument);
  }

  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, argument?: A): void {
    for (const componentDeclaration of node.componentDeclarations) componentDeclaration.accept(this, argument);
    node.typeSpecifier?.accept(this);
  }

  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, argument?: A): void {
    node.declaration?.accept(this, argument);
  }

  visitDeclaration(node: ModelicaDeclarationSyntaxNode, argument?: A): void {
    node.identifier?.accept(this, argument);
  }

  visitElementSection(node: ModelicaElementSectionSyntaxNode, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): void {}

  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, argument?: A): void {
    node.identifier?.accept(this);
    for (const section of node.sections) section.accept(this, argument);
    node.endIdentifier?.accept(this);
  }

  visitName(node: ModelicaNameSyntaxNode, argument?: A): void {
    for (const component of node.components) component.accept(this, argument);
  }

  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): void {
    node.withinDirective?.accept(this, argument);
  }

  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, argument?: A): void {
    node.name?.accept(this, argument);
  }

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): void {
    node.packageName?.accept(this, argument);
  }
}

function toEnum<T extends Record<number, string | number>>(
  enumType: T,
  value: string | null | undefined,
): T[keyof T] | null {
  return enumType[value?.replaceAll(" ", "_").toUpperCase() as keyof T] ?? null;
}
