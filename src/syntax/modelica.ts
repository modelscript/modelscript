// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "tree-sitter";

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

  static make(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSyntaxNode | null,
  ): ModelicaSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIdentifierSyntaxNode.type:
        return new ModelicaIdentifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIdentifierSyntaxNode,
        );
      case ModelicaNameSyntaxNode.type:
        return new ModelicaNameSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode as IModelicaNameSyntaxNode);
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
      default:
        return null;
    }
  }

  static makeArray<T extends ModelicaSyntaxNode>(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNodeArray?: SyntaxNode[],
    abstractSyntaxNodeArray?: IModelicaSyntaxNode[],
  ): T[] {
    const nodes: T[] = [];
    const length = Math.max(concreteSyntaxNodeArray?.length ?? 0, abstractSyntaxNodeArray?.length ?? 0);
    for (let i = 0; i < length; i++) {
      const node = this.make(parent, concreteSyntaxNodeArray?.[i] ?? null, abstractSyntaxNodeArray?.[i] ?? null) as T;
      if (node != null) nodes.push(node);
    }
    return nodes;
  }

  static get type(): string {
    return this.name.substring(8, this.name.length - 10);
  }
}

export interface IModelicaStoredDefinitionSyntaxNode extends IModelicaSyntaxNode {
  withinDirective: IModelicaWithinDirectiveSyntaxNode | null;
}

export class ModelicaStoredDefinitionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaStoredDefinitionSyntaxNode
{
  withinDirective: ModelicaWithinDirectiveSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStoredDefinitionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.withinDirective = ModelicaWithinDirectiveSyntaxNode.make(
      this,
      concreteSyntaxNode?.childForFieldName("withinDirective"),
      abstractSyntaxNode?.withinDirective,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitStoredDefinition(this, argument);
  }

  static override make(
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
    this.packageName = ModelicaNameSyntaxNode.make(
      this,
      concreteSyntaxNode?.childForFieldName("packageName"),
      abstractSyntaxNode?.packageName,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWithinDirective(this, argument);
  }

  static override make(
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
    this.components = ModelicaIdentifierSyntaxNode.makeArray(
      this,
      concreteSyntaxNode?.childrenForFieldName("component"),
      abstractSyntaxNode?.components,
    );
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitName(this, argument);
  }

  static override make(
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

  static override make(
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
  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): R;

  visitName(node: ModelicaNameSyntaxNode, argument?: A): R;

  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): R;

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): R;
}

export abstract class ModelicaSyntaxVisitor<A> implements IModelicaSyntaxVisitor<void, A> {
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): void {}

  visitName(node: ModelicaNameSyntaxNode, argument?: A): void {
    for (const component of node.components) component.accept(this, argument);
  }

  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): void {
    node.withinDirective?.accept(this, argument);
  }

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): void {
    node.packageName?.accept(this, argument);
  }
}
