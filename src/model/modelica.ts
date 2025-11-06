// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ModelicaClassDefinitionSyntaxNode,
  ModelicaComponentClauseSyntaxNode,
  type ModelicaComponentDeclarationSyntaxNode,
  type ModelicaIdentifierSyntaxNode,
  type ModelicaNameSyntaxNode,
  type ModelicaTypeSpecifierSyntaxNode,
} from "../syntax/modelica.js";

export abstract class ModelicaNode {
  #instantiated = false;
  #instantiating = false;
  #parent: WeakRef<ModelicaNode> | null;
  "@type": string;

  constructor(parent: ModelicaNode | null) {
    if (parent) this.#parent = new WeakRef(parent);
    else this.#parent = null;
    this["@type"] = this.constructor.name.substring(8);
  }

  abstract accept<R, A>(visitor: IModelicaNodeVisitor<R, A>, argument?: A): R;

  abstract get elements(): IterableIterator<ModelicaElement>;

  abstract instantiate(): void;

  get instantiated(): boolean {
    return this.#instantiated;
  }

  set instantiated(instantiated: boolean) {
    this.#instantiated = instantiated;
  }

  get instantiating(): boolean {
    return this.#instantiating;
  }

  set instantiating(instantiating: boolean) {
    this.#instantiating = instantiating;
  }

  get parent(): ModelicaNode | null {
    return this.#parent?.deref() ?? null;
  }

  resolveName(name: ModelicaNameSyntaxNode | null | undefined, global = false): ModelicaNamedElement | null {
    const components = name?.components;
    if (!components || components.length === 0) return null;
    let namedElement = this.resolveSimpleName(components[0], global);
    if (!namedElement) return null;
    for (let i = 1; i < components.length; i++) {
      namedElement = namedElement.resolveSimpleName(components[i], false, true);
      if (!namedElement) return null;
    }
    return namedElement;
  }

  resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = identifier?.value;
    if (!simpleName) return null;
    let scope: ModelicaNode | null = global ? this.root : this;
    while (scope) {
      for (const element of scope.elements) {
        if (element instanceof ModelicaNamedElement && element.name === simpleName) return element;
      }
      if (!encapsulated) scope = scope.parent;
    }
    switch (simpleName) {
      case "Boolean":
        return new ModelicaBooleanClassInstance(null, null);
      case "Integer":
        return new ModelicaIntegerClassInstance(null, null);
      case "Real":
        return new ModelicaRealClassInstance(null, null);
      case "String":
        return new ModelicaStringClassInstance(null, null);
    }
    return null;
  }

  resolveTypeSpecifier(typeSpecifier: ModelicaTypeSpecifierSyntaxNode | null | undefined): ModelicaNamedElement | null {
    if (!typeSpecifier || !typeSpecifier.name) return null;
    return this.resolveName(typeSpecifier.name, typeSpecifier.global);
  }

  get root(): ModelicaNode {
    let root = this.parent;
    if (!root) return this;
    while (root.parent) root = root.parent;
    return root;
  }
}

export abstract class ModelicaElement extends ModelicaNode {}

export abstract class ModelicaNamedElement extends ModelicaElement {
  name: string | null;

  constructor(parent: ModelicaNode | null, name: string | null) {
    super(parent);
    this.name = name;
  }
}

export class ModelicaClassInstance extends ModelicaNamedElement {
  #abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | null;
  declaredElements: ModelicaElement[] = [];

  constructor(parent: ModelicaNode | null, abstractSyntaxNode?: ModelicaClassDefinitionSyntaxNode | null) {
    super(parent, abstractSyntaxNode?.identifier?.value ?? null);
    this.#abstractSyntaxNode = abstractSyntaxNode ?? null;
  }

  get abstractSyntaxNode(): ModelicaClassDefinitionSyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  override accept<R, A>(visitor: IModelicaNodeVisitor<R, A>, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const declaredElements = this.declaredElements;
    return (function* () {
      yield* declaredElements;
    })();
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error();
    this.instantiating = true;
    this.declaredElements = [];
    for (const elementSyntaxNode of this.abstractSyntaxNode?.elements ?? []) {
      if (elementSyntaxNode instanceof ModelicaClassDefinitionSyntaxNode) {
        this.declaredElements.push(new ModelicaClassInstance(this, elementSyntaxNode));
      } else if (elementSyntaxNode instanceof ModelicaComponentClauseSyntaxNode) {
        for (const componentDeclarationSyntaxNode of elementSyntaxNode.componentDeclarations) {
          this.declaredElements.push(new ModelicaComponentInstance(this, componentDeclarationSyntaxNode));
        }
      }
    }
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaClassInstance) element.instantiate();
    }
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaComponentInstance) element.instantiate();
    }
    this.instantiated = true;
  }
}

export class ModelicaComponentInstance extends ModelicaNamedElement {
  #abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | null;
  typeClassInstance: ModelicaClassInstance | null = null;

  constructor(parent: ModelicaNode | null, abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | null) {
    super(parent, abstractSyntaxNode?.declaration?.identifier?.value ?? null);
    this.#abstractSyntaxNode = abstractSyntaxNode;
  }

  get abstractSyntaxNode(): ModelicaComponentDeclarationSyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  override accept<R, A>(visitor: IModelicaNodeVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentInstance(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const elements = this.typeClassInstance?.elements;
    return (function* () {
      if (elements) yield* elements;
    })();
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error();
    this.instantiating = true;
    const element = this.parent?.resolveTypeSpecifier(this.abstractSyntaxNode?.parent?.typeSpecifier);
    if (element instanceof ModelicaClassInstance) {
      this.typeClassInstance = element;
    }
    this.instantiated = true;
  }
}

export abstract class ModelicaPredefinedClassInstance extends ModelicaClassInstance {
  constructor(parent: ModelicaNode | null, name: string) {
    super(parent, null);
    this["@type"] = name + "ClassInstance";
    this.name = name;
  }

  abstract override accept<R, A>(visitor: IModelicaNodeVisitor<R, A>, argument?: A): R;
}

export class ModelicaBooleanClassInstance extends ModelicaPredefinedClassInstance {
  value: boolean | null;

  constructor(parent: ModelicaNode | null, value?: boolean | null) {
    super(parent, "Boolean");
    this.value = value ?? null;
  }

  override accept<R, A>(visitor: IModelicaNodeVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanClassInstance(this, argument);
  }
}

export class ModelicaIntegerClassInstance extends ModelicaPredefinedClassInstance {
  value: number | null;

  constructor(parent: ModelicaNode | null, value?: number | null) {
    super(parent, "Integer");
    this.value = value ?? null;
  }

  override accept<R, A>(visitor: IModelicaNodeVisitor<R, A>, argument?: A): R {
    return visitor.visitIntegerClassInstance(this, argument);
  }
}

export class ModelicaRealClassInstance extends ModelicaPredefinedClassInstance {
  value: number | null;

  constructor(parent: ModelicaNode | null, value?: number | null) {
    super(parent, "Real");
    this.value = value ?? null;
  }

  override accept<R, A>(visitor: IModelicaNodeVisitor<R, A>, argument?: A): R {
    return visitor.visitRealClassInstance(this, argument);
  }
}

export class ModelicaStringClassInstance extends ModelicaPredefinedClassInstance {
  value: string | null;

  constructor(parent: ModelicaNode | null, value?: string | null) {
    super(parent, "String");
    this.value = value ?? null;
  }

  override accept<R, A>(visitor: IModelicaNodeVisitor<R, A>, argument?: A): R {
    return visitor.visitStringClassInstance(this, argument);
  }
}

export interface IModelicaNodeVisitor<R, A> {
  visitBooleanClassInstance(node: ModelicaBooleanClassInstance, argument?: A): R;

  visitClassInstance(node: ModelicaClassInstance, argument?: A): R;

  visitComponentInstance(node: ModelicaComponentInstance, argument?: A): R;

  visitIntegerClassInstance(node: ModelicaIntegerClassInstance, argument?: A): R;

  visitRealClassInstance(node: ModelicaRealClassInstance, argument?: A): R;

  visitStringClassInstance(node: ModelicaStringClassInstance, argument?: A): R;
}

export abstract class ModelicaNodeVisitor<A> implements IModelicaNodeVisitor<void, A> {
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitBooleanClassInstance(node: ModelicaBooleanClassInstance, argument?: A): void {}

  visitClassInstance(node: ModelicaClassInstance, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitComponentInstance(node: ModelicaComponentInstance, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitIntegerClassInstance(node: ModelicaIntegerClassInstance, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitRealClassInstance(node: ModelicaRealClassInstance, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitStringClassInstance(node: ModelicaStringClassInstance, argument?: A): void {}
}
