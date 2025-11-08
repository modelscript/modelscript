// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Context } from "../compiler/context.js";
import {
  ModelicaClassDefinitionSyntaxNode,
  ModelicaComponentClauseSyntaxNode,
  ModelicaElementSyntaxNode,
  ModelicaExtendsClauseSyntaxNode,
  ModelicaStoredDefinitionSyntaxNode,
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

  abstract accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R;

  abstract get elements(): IterableIterator<ModelicaElement>;

  abstract instantiate(): void;

  get instantiated(): boolean {
    return this.#instantiated;
  }

  set instantiated(instantiated: boolean) {
    this.#instantiated = instantiated;
    if (!this.#instantiated) this.#instantiating = false;
  }

  get instantiating(): boolean {
    return this.#instantiating;
  }

  set instantiating(instantiating: boolean) {
    this.#instantiating = instantiating;
  }

  abstract get library(): ModelicaLibrary | null;

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

export class ModelicaLibrary extends ModelicaNode {
  #context: WeakRef<Context>;
  entity: ModelicaEntity;
  path: string;

  constructor(context: Context, path: string) {
    super(null);
    this.#context = new WeakRef(context);
    this.path = context.fs.resolve(path);
    this.entity = new ModelicaEntity(this, this, this.path);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitLibrary(this, argument);
  }

  get context(): Context {
    const context = this.#context.deref();
    if (!context) throw new Error();
    return context;
  }

  get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const entity = this.entity;
    return (function* () {
      yield entity;
    })();
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: library is already being instantiated");
    this.instantiating = true;
    this.entity.load();
    this.entity.instantiate();
    this.instantiated = true;
  }

  get library(): ModelicaLibrary {
    return this;
  }

  query(name: string): ModelicaNamedElement | null {
    this.instantiate();
    const components = name.split(".");
    let instance: ModelicaNamedElement = this.entity;
    if (instance.name !== components?.[0]) return null;
    for (const component of components.slice(1)) {
      let found = false;
      for (const element of instance.elements) {
        if (element instanceof ModelicaNamedElement) {
          if (element.name === component) {
            instance = element;
            found = true;
          }
        }
      }
      if (!found) return null;
    }
    return instance;
  }
}

export abstract class ModelicaElement extends ModelicaNode {
  #library: WeakRef<ModelicaLibrary> | null;

  constructor(library: ModelicaLibrary | null, parent: ModelicaNode | null) {
    super(parent);
    if (library) this.#library = new WeakRef(library);
    else this.#library = null;
  }

  abstract get abstractSyntaxNode(): ModelicaElementSyntaxNode | null;

  get library(): ModelicaLibrary | null {
    return this.#library?.deref() ?? null;
  }
}

export class ModelicaExtendsClassInstance extends ModelicaElement {
  #abstractSyntaxNode: ModelicaExtendsClauseSyntaxNode | null;
  classInstance: ModelicaClassInstance | null = null;

  constructor(
    library: ModelicaLibrary | null,
    parent: ModelicaNode | null,
    abstractSyntaxNode?: ModelicaExtendsClauseSyntaxNode | null,
  ) {
    super(library, parent);
    this.#abstractSyntaxNode = abstractSyntaxNode ?? null;
  }

  get abstractSyntaxNode(): ModelicaExtendsClauseSyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  set abstractSyntaxNode(abstractSyntaxNode: ModelicaExtendsClauseSyntaxNode | null) {
    this.#abstractSyntaxNode = abstractSyntaxNode;
    this.instantiated = false;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitExtendsClassInstance(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const elements = this.classInstance?.elements;
    return (function* () {
      if (elements) yield* elements;
    })();
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: class is already being instantiated");
    this.instantiating = true;
    const element = this.parent?.resolveTypeSpecifier(this.abstractSyntaxNode?.typeSpecifier);
    if (element instanceof ModelicaClassInstance) {
      this.classInstance = element;
    }
    this.instantiated = true;
  }
}

export abstract class ModelicaNamedElement extends ModelicaElement {
  name: string | null = null;
}

export class ModelicaClassInstance extends ModelicaNamedElement {
  #abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | null;
  declaredElements: ModelicaElement[] = [];

  constructor(
    library: ModelicaLibrary | null,
    parent: ModelicaNode | null,
    abstractSyntaxNode?: ModelicaClassDefinitionSyntaxNode | null,
  ) {
    super(library, parent);
    this.#abstractSyntaxNode = abstractSyntaxNode ?? null;
    this.name = this.abstractSyntaxNode?.identifier?.value ?? null;
  }

  get abstractSyntaxNode(): ModelicaClassDefinitionSyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  set abstractSyntaxNode(abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | null) {
    this.#abstractSyntaxNode = abstractSyntaxNode;
    this.name = this.abstractSyntaxNode?.identifier?.value ?? null;
    this.instantiated = false;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const declaredElements = this.declaredElements;
    return (function* () {
      for (const declaredElement of declaredElements) {
        if (declaredElement instanceof ModelicaExtendsClassInstance) yield* declaredElement.elements;
        else yield declaredElement;
      }
    })();
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: class is already being instantiated");
    this.instantiating = true;
    this.declaredElements = [];
    for (const elementSyntaxNode of this.abstractSyntaxNode?.elements ?? []) {
      if (elementSyntaxNode instanceof ModelicaClassDefinitionSyntaxNode) {
        this.declaredElements.push(new ModelicaClassInstance(this.library, this, elementSyntaxNode));
      } else if (elementSyntaxNode instanceof ModelicaComponentClauseSyntaxNode) {
        for (const componentDeclarationSyntaxNode of elementSyntaxNode.componentDeclarations) {
          this.declaredElements.push(new ModelicaComponentInstance(this.library, this, componentDeclarationSyntaxNode));
        }
      } else if (elementSyntaxNode instanceof ModelicaExtendsClauseSyntaxNode) {
        this.declaredElements.push(new ModelicaExtendsClassInstance(this.library, this, elementSyntaxNode));
      }
    }
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaExtendsClassInstance) element.instantiate();
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

export class ModelicaEntity extends ModelicaClassInstance {
  #storedDefinitionSyntaxNode: ModelicaStoredDefinitionSyntaxNode | null = null;
  path: string;
  subEntities: ModelicaEntity[] = [];
  unstructured = false;

  constructor(library: ModelicaLibrary, parent: ModelicaNode | null, path: string) {
    super(library, parent);
    this.path = library.context.fs.resolve(path);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitEntity(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const elements = [...super.elements];
    const subEntities = this.subEntities;
    return (function* () {
      yield* subEntities;
      yield* elements;
    })();
  }

  override instantiate(): void {
    super.instantiate();
    for (const subEntity of this.subEntities) {
      if (!subEntity.instantiated && !subEntity.instantiating) subEntity.instantiate();
    }
  }

  load(): void {
    this.subEntities = [];
    const library = this.library;
    if (!library) throw new Error();
    const context = library.context;
    const stats = library.context.fs.stat(this.path);
    if (!stats) throw new Error();
    let filePath: string | null = null;
    if (stats.isFile()) {
      this.unstructured = true;
      filePath = this.path;
    } else if (stats.isDirectory()) {
      this.unstructured = false;
      filePath = library.context.fs.join(this.path, "package.mo");
      if (!library.context.fs.stat(filePath)?.isFile()) {
        filePath = null;
      }
      for (const dirent of context.fs.readdir(this.path)) {
        if (dirent.isFile()) {
          if (dirent.name === "package.mo" || context.fs.extname(dirent.name) !== ".mo") continue;
        }
        const subEntity = new ModelicaEntity(library, this, context.fs.join(this.path, dirent.name));
        subEntity.load();
        this.subEntities.push(subEntity);
      }
    } else {
      throw new Error();
    }
    if (filePath) {
      const parser = context.getParser(context.fs.extname(filePath));
      const text = context.fs.read(filePath);
      const tree = parser.parse(text);
      this.#storedDefinitionSyntaxNode = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
      this.abstractSyntaxNode = this.#storedDefinitionSyntaxNode?.classDefinitions?.[0] ?? null;
    }
  }

  get storedDefinitionSyntaxNode(): ModelicaStoredDefinitionSyntaxNode | null {
    return this.#storedDefinitionSyntaxNode;
  }
}

export class ModelicaComponentInstance extends ModelicaNamedElement {
  #abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | null;
  classInstance: ModelicaClassInstance | null = null;

  constructor(
    library: ModelicaLibrary | null,
    parent: ModelicaClassInstance | null,
    abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | null,
  ) {
    super(library, parent);
    this.#abstractSyntaxNode = abstractSyntaxNode;
  }

  get abstractSyntaxNode(): ModelicaComponentDeclarationSyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentInstance(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const elements = this.classInstance?.elements;
    return (function* () {
      if (elements) yield* elements;
    })();
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: component is already being instantiated");
    this.instantiating = true;
    this.name = this.abstractSyntaxNode?.declaration?.identifier?.value ?? null;
    const element = this.parent?.resolveTypeSpecifier(this.abstractSyntaxNode?.parent?.typeSpecifier);
    if (element instanceof ModelicaClassInstance) {
      this.classInstance = element;
    }
    this.instantiated = true;
  }

  override get parent(): ModelicaClassInstance | null {
    return super.parent as ModelicaClassInstance | null;
  }
}

export abstract class ModelicaPredefinedClassInstance extends ModelicaClassInstance {
  constructor(library: ModelicaLibrary | null, parent: ModelicaNode | null, name: string) {
    super(library, parent, null);
    this["@type"] = name + "ClassInstance";
    this.name = name;
  }

  abstract override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R;
}

export class ModelicaBooleanClassInstance extends ModelicaPredefinedClassInstance {
  value: boolean | null;

  constructor(library: ModelicaLibrary | null, parent: ModelicaNode | null, value?: boolean | null) {
    super(library, parent, "Boolean");
    this.value = value ?? null;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanClassInstance(this, argument);
  }
}

export class ModelicaIntegerClassInstance extends ModelicaPredefinedClassInstance {
  value: number | null;

  constructor(library: ModelicaLibrary | null, parent: ModelicaNode | null, value?: number | null) {
    super(library, parent, "Integer");
    this.value = value ?? null;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitIntegerClassInstance(this, argument);
  }
}

export class ModelicaRealClassInstance extends ModelicaPredefinedClassInstance {
  value: number | null;

  constructor(library: ModelicaLibrary | null, parent: ModelicaNode | null, value?: number | null) {
    super(library, parent, "Real");
    this.value = value ?? null;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitRealClassInstance(this, argument);
  }
}

export class ModelicaStringClassInstance extends ModelicaPredefinedClassInstance {
  value: string | null;

  constructor(library: ModelicaLibrary | null, parent: ModelicaNode | null, value?: string | null) {
    super(library, parent, "String");
    this.value = value ?? null;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitStringClassInstance(this, argument);
  }
}

export interface IModelicaModelVisitor<R, A> {
  visitBooleanClassInstance(node: ModelicaBooleanClassInstance, argument?: A): R;

  visitClassInstance(node: ModelicaClassInstance, argument?: A): R;

  visitComponentInstance(node: ModelicaComponentInstance, argument?: A): R;

  visitEntity(node: ModelicaEntity, argument?: A): R;

  visitExtendsClassInstance(node: ModelicaExtendsClassInstance, argument?: A): R;

  visitIntegerClassInstance(node: ModelicaIntegerClassInstance, argument?: A): R;

  visitLibrary(node: ModelicaLibrary, argument?: A): R;

  visitRealClassInstance(node: ModelicaRealClassInstance, argument?: A): R;

  visitStringClassInstance(node: ModelicaStringClassInstance, argument?: A): R;
}

export abstract class ModelicaModelVisitor<A> implements IModelicaModelVisitor<void, A> {
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitBooleanClassInstance(node: ModelicaBooleanClassInstance, argument?: A): void {}

  visitClassInstance(node: ModelicaClassInstance, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitComponentInstance(node: ModelicaComponentInstance, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitEntity(node: ModelicaEntity, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitExtendsClassInstance(node: ModelicaExtendsClassInstance, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitIntegerClassInstance(node: ModelicaIntegerClassInstance, argument?: A): void {}

  visitLibrary(node: ModelicaLibrary, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitRealClassInstance(node: ModelicaRealClassInstance, argument?: A): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  visitStringClassInstance(node: ModelicaStringClassInstance, argument?: A): void {}
}
