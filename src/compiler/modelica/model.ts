// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from "crypto";

import type { Writer } from "../../util/io.js";
import logger from "../../util/logger.js";
import { makeWeakRef, makeWeakRefArray } from "../../util/weak.js";
import { Context } from "../context.js";
import { Scope } from "../scope.js";
import { ANNOTATION } from "./annotation.js";
import {
  ModelicaArray,
  ModelicaDAEPrinter,
  ModelicaEnumerationLiteral,
  ModelicaExpression,
  ModelicaIntegerLiteral,
} from "./dae.js";
import { ModelicaInterpreter } from "./interpreter.js";
import {
  ModelicaAnnotationClauseSyntaxNode,
  ModelicaCausality,
  ModelicaClassDefinitionSyntaxNode,
  ModelicaClassKind,
  ModelicaClassModificationSyntaxNode,
  ModelicaComponentClauseSyntaxNode,
  ModelicaComponentDeclaration1SyntaxNode,
  ModelicaCompoundImportClauseSyntaxNode,
  ModelicaConnectEquationSyntaxNode,
  ModelicaElementModificationSyntaxNode,
  ModelicaElementRedeclarationSyntaxNode,
  ModelicaElementSyntaxNode,
  ModelicaEquationSectionSyntaxNode,
  ModelicaEquationSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaExtendsClauseSyntaxNode,
  ModelicaIdentifierSyntaxNode,
  ModelicaImportClauseSyntaxNode,
  ModelicaLongClassSpecifierSyntaxNode,
  ModelicaModificationArgumentSyntaxNode,
  ModelicaModificationExpressionSyntaxNode,
  ModelicaModificationSyntaxNode,
  ModelicaShortClassDefinitionSyntaxNode,
  ModelicaShortClassSpecifierSyntaxNode,
  ModelicaSimpleImportClauseSyntaxNode,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaSubscriptSyntaxNode,
  ModelicaUnqualifiedImportClauseSyntaxNode,
  ModelicaVariability,
  type ModelicaComponentDeclarationSyntaxNode,
} from "./syntax.js";

export abstract class ModelicaNode extends Scope {
  #instantiated = false;
  #instantiating = false;
  "@type": string;

  constructor(parent: Scope | null) {
    super(parent);
    this["@type"] = this.constructor.name.substring(8);
  }

  abstract accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R;

  get context(): Context | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let context: Scope | null = this;
    while (context) {
      if (context instanceof Context) return context;
      context = context.parent;
    }
    return null;
  }

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
}

export class ModelicaLibrary extends ModelicaNode {
  entity: ModelicaEntity;
  path: string;

  constructor(context: Context, path: string) {
    super(context);
    this.path = context.fs.resolve(path);
    this.entity = new ModelicaEntity(this, this.path);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitLibrary(this, argument);
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

  get name(): string | null {
    return this.entity.name;
  }

  get library(): ModelicaLibrary {
    return this;
  }
}

export abstract class ModelicaElement extends ModelicaNode {
  static #annotationClassInstance: ModelicaClassInstance | null = null;
  annotations: ModelicaNamedElement[] = [];

  abstract get abstractSyntaxNode(): ModelicaElementSyntaxNode | null;

  annotation<T>(name: string, annotations?: ModelicaNamedElement[] | null): T | null {
    annotations = annotations ?? this.annotations;
    for (const annotation of annotations) {
      if (annotation.name === name) {
        if (annotation instanceof ModelicaClassInstance) {
          return (ModelicaExpression.fromClassInstance(annotation)?.toJSON() ?? null) as T | null;
        } else if (annotation instanceof ModelicaComponentInstance) {
          return (ModelicaExpression.fromClassInstance(annotation.classInstance)?.toJSON() ?? null) as T | null;
        }
      }
    }
    return null;
  }

  static get annotationClassInstance(): ModelicaClassInstance | null {
    return ModelicaElement.#annotationClassInstance;
  }

  abstract get hash(): string;

  static instantiateAnnotations(
    classInstance: ModelicaClassInstance | null,
    annotationClause?: ModelicaAnnotationClauseSyntaxNode | null,
    modificationAnnotations?: ModelicaModification | null,
  ): ModelicaNamedElement[] {
    const clauseModification = annotationClause ? ModelicaModification.new(classInstance, annotationClause) : null;
    const modification = ModelicaModification.merge(clauseModification, modificationAnnotations);
    if (!classInstance || !modification) return [];
    if (!ModelicaElement.#annotationClassInstance) {
      const tree = classInstance.context?.getParser(".mo").parse(ANNOTATION);
      const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree?.rootNode)?.classDefinitions?.[0] ?? null;
      if (node) {
        ModelicaElement.#annotationClassInstance = ModelicaClassInstance.new(null, node);
        ModelicaElement.#annotationClassInstance.instantiate();
      }
    }
    const annotations: ModelicaNamedElement[] = [];
    for (const modificationArgument of modification.modificationArguments) {
      const name = modificationArgument.name;
      const annotation = ModelicaElement.#annotationClassInstance?.resolveSimpleName(name);
      if (annotation instanceof ModelicaClassInstance) {
        if (modificationArgument instanceof ModelicaElementModification) {
          annotations.push(
            annotation.clone(
              new ModelicaModification(
                classInstance,
                [...modificationArgument.extract(), ...modificationArgument.modificationArguments],
                modificationArgument.modificationExpression,
              ),
            ),
          );
        }
      } else if (annotation instanceof ModelicaComponentInstance) {
        if (modificationArgument instanceof ModelicaElementModification) {
          annotations.push(
            annotation.clone(
              new ModelicaModification(
                classInstance,
                [...modificationArgument.extract(), ...modificationArgument.modificationArguments],
                modificationArgument.modificationExpression,
              ),
            ),
          );
        }
      } else if (!annotation && modificationArgument instanceof ModelicaElementModification) {
        const dummy = new ModelicaClassInstance(
          classInstance,
          null,
          new ModelicaModification(
            classInstance,
            modificationArgument.modificationArguments,
            modificationArgument.modificationExpression,
            modificationArgument.description,
            modificationArgument.expression,
          ),
        );
        dummy.name = modificationArgument.name;
        annotations.push(dummy);
      }
    }
    return annotations;
  }

  get library(): ModelicaLibrary | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let library: Scope | null = this;
    while (library) {
      if (library instanceof ModelicaLibrary) return library;
      library = library.parent;
    }
    return null;
  }

  translate(id: string): string {
    const context = this.context as Context;
    if (!context) return id;

    let msgctxt = "";
    // find nearest class instance to use as context
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Scope | null = this;
    while (current) {
      if (current instanceof ModelicaClassInstance) {
        msgctxt = current.compositeName;
        break;
      }
      current = current.parent;
    }

    return context.translate(id, msgctxt);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #translateObject(obj: any) {
    if (!obj || typeof obj !== "object") return;
    for (const key in obj) {
      const val = obj[key];
      if (typeof val === "string") {
        obj[key] = this.translate(val);
      } else if (typeof val === "object") {
        this.#translateObject(val);
      }
    }
  }
}

export class ModelicaExtendsClassInstance extends ModelicaElement {
  #abstractSyntaxNode: ModelicaExtendsClauseSyntaxNode | null;
  #modification: ModelicaModification;
  classInstance: ModelicaClassInstance | null = null;

  constructor(parent: ModelicaClassInstance | null, abstractSyntaxNode?: ModelicaExtendsClauseSyntaxNode | null) {
    super(parent);
    this.#abstractSyntaxNode = abstractSyntaxNode ?? null;
    this.#modification = this.mergeModifications();
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
    return this.classInstance?.elements ?? [][Symbol.iterator]();
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update("extends");
    hash.update(this.abstractSyntaxNode?.typeSpecifier?.concreteSyntaxNode?.text ?? "");
    hash.update(this.mergeModifications().hash);
    return hash.digest("hex");
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: class is already being instantiated");
    this.instantiating = true;
    const element = this.parent?.resolveTypeSpecifier(this.abstractSyntaxNode?.typeSpecifier);
    if (element instanceof ModelicaClassInstance) {
      this.classInstance = element.clone(this.#modification);
    }
    this.annotations = ModelicaElement.instantiateAnnotations(this.parent, this.abstractSyntaxNode?.annotationClause);
    this.instantiated = true;
  }

  mergeModifications(): ModelicaModification {
    const mergedModificationArguments: ModelicaModificationArgument[] = [
      ...(this.parent?.modification?.modificationArguments ?? []),
    ];
    if (this.abstractSyntaxNode?.classOrInheritanceModification != null) {
      const modificationArguments: ModelicaModificationArgument[] = [];
      for (const modificationArgumentOrInheritanceModification of this.abstractSyntaxNode
        ?.classOrInheritanceModification?.modificationArgumentOrInheritanceModifications ?? []) {
        if (modificationArgumentOrInheritanceModification instanceof ModelicaModificationArgumentSyntaxNode) {
          if (modificationArgumentOrInheritanceModification instanceof ModelicaElementModificationSyntaxNode) {
            if (
              modificationArguments.filter(
                (m) => m.name === modificationArgumentOrInheritanceModification.identifier?.text,
              ).length > 0
            )
              continue;
            modificationArguments.push(
              ModelicaElementModification.new(this.parent, modificationArgumentOrInheritanceModification),
            );
          } else if (modificationArgumentOrInheritanceModification instanceof ModelicaElementRedeclarationSyntaxNode) {
            modificationArguments.push(
              ModelicaElementRedeclaration.new(this.parent, modificationArgumentOrInheritanceModification),
            );
          }
        }
      }
      mergedModificationArguments.push(...modificationArguments);
    }
    return new ModelicaModification(this, mergedModificationArguments);
  }

  override get parent(): ModelicaClassInstance | null {
    return super.parent as ModelicaClassInstance | null;
  }
}

export abstract class ModelicaNamedElement extends ModelicaElement {
  description: string | null = null;
  name: string | null = null;

  abstract get modification(): ModelicaModification | null;

  get compositeName(): string {
    let compositeName = this.name ?? "";
    let parent = this.parent;
    while (parent) {
      if (parent instanceof ModelicaNamedElement && parent.name) {
        compositeName = `${parent.name}.${compositeName}`;
      }
      parent = parent.parent;
    }
    return compositeName;
  }

  get localizedDescription(): string | null {
    if (!this.description) return null;
    return this.translate(this.description);
  }

  get localizedName(): string {
    return this.translate(this.name ?? "");
  }

  get localizedCompositeName(): string {
    let compositeName = this.localizedName;
    let parent = this.parent;
    while (parent) {
      if (parent instanceof ModelicaNamedElement && parent.name) {
        compositeName = `${parent.localizedName}.${compositeName}`;
      }
      parent = parent.parent;
    }
    return compositeName;
  }
}

export class ModelicaClassInstance extends ModelicaNamedElement {
  #abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | ModelicaShortClassDefinitionSyntaxNode | null;
  #importClauses: ModelicaImportClauseSyntaxNode[] = [];
  #modification: ModelicaModification | null = null;
  #qualifiedImports = new Map<string, ModelicaClassInstance>();
  #unqualifiedImports: ModelicaClassInstance[] = [];
  classKind: ModelicaClassKind;
  cloneCache = new Map<string, ModelicaClassInstance>();
  declaredElements: ModelicaElement[] = [];

  constructor(
    parent: Scope | null,
    abstractSyntaxNode?: ModelicaClassDefinitionSyntaxNode | ModelicaShortClassDefinitionSyntaxNode | null,
    modification?: ModelicaModification | null,
  ) {
    super(parent);
    this.#abstractSyntaxNode = abstractSyntaxNode ?? null;
    this.name = this.abstractSyntaxNode?.identifier?.text ?? null;
    this.description =
      this.abstractSyntaxNode?.classSpecifier?.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;
    if (abstractSyntaxNode instanceof ModelicaShortClassDefinitionSyntaxNode) {
      this.#modification =
        modification ?? ModelicaModification.new(parent, abstractSyntaxNode.classSpecifier?.classModification ?? null);
    } else {
      this.#modification = modification ?? null;
    }
    this.classKind = abstractSyntaxNode?.classPrefixes?.classKind ?? ModelicaClassKind.CLASS;
  }

  get abstractSyntaxNode(): ModelicaClassDefinitionSyntaxNode | ModelicaShortClassDefinitionSyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  set abstractSyntaxNode(abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | null) {
    this.#abstractSyntaxNode = abstractSyntaxNode;
    this.name = this.abstractSyntaxNode?.identifier?.text ?? null;
    this.description =
      this.abstractSyntaxNode?.classSpecifier?.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;
    this.instantiated = false;
    this.cloneCache.clear();
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  clone(modification?: ModelicaModification | null): ModelicaClassInstance {
    if (!this.abstractSyntaxNode) throw new Error();
    const mergedModification = ModelicaModification.merge(this.#modification, modification);
    const hash = mergedModification?.hash ?? "";
    const cachedInstance = this.cloneCache.get(hash);
    if (cachedInstance) {
      cachedInstance.instantiate();
      return cachedInstance;
    }
    const classInstance = ModelicaClassInstance.new(this.parent, this.abstractSyntaxNode, mergedModification);
    classInstance.instantiate();
    this.cloneCache.set(hash, classInstance);
    return classInstance;
  }

  get components(): IterableIterator<ModelicaComponentInstance> {
    const elements = this.elements;
    return (function* () {
      for (const element of elements) {
        if (element instanceof ModelicaComponentInstance) yield element;
      }
    })();
  }

  get compositeName(): string {
    return this.parent instanceof ModelicaClassInstance
      ? `${this.parent.compositeName}.${this.name}`
      : (this.name ?? "");
  }

  get connectEquations(): IterableIterator<ModelicaConnectEquationSyntaxNode> {
    const equations = this.equations;
    return (function* () {
      for (const equation of equations) {
        if (equation instanceof ModelicaConnectEquationSyntaxNode) yield equation;
      }
    })();
  }

  // TODO: fix this method
  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (function* () {
      const stack: { iterator: Iterator<ModelicaElement>; visited: Set<ModelicaClassInstance> }[] = [
        { iterator: self.declaredElements[Symbol.iterator](), visited: new Set([self]) },
      ];

      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (!top) {
          stack.pop();
          continue;
        }
        const next = top.iterator.next();

        if (next.done) {
          stack.pop();
          continue;
        }

        const element = next.value;
        if (element instanceof ModelicaExtendsClassInstance) {
          if (!element.instantiated && !element.instantiating) element.instantiate();
          const baseClass = element.classInstance;
          if (baseClass && !top.visited.has(baseClass)) {
            const visited = new Set(top.visited);
            visited.add(baseClass);
            stack.push({ iterator: baseClass.declaredElements[Symbol.iterator](), visited });
          }
        } else {
          yield element;
        }
      }
    })();
  }

  get equationSections(): IterableIterator<ModelicaEquationSectionSyntaxNode> {
    const extendsClassInstances = this.extendsClassInstances;
    const abstractSyntaxNode = this.abstractSyntaxNode;
    return (function* () {
      for (const extendsClassInstance of extendsClassInstances) {
        for (const section of extendsClassInstance.classInstance?.abstractSyntaxNode?.sections ?? [])
          if (section instanceof ModelicaEquationSectionSyntaxNode) yield section;
      }
      for (const section of abstractSyntaxNode?.sections ?? []) {
        if (section instanceof ModelicaEquationSectionSyntaxNode) yield section;
      }
    })();
  }

  get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const equationSections = this.equationSections;
    return (function* () {
      for (const equationSection of equationSections) {
        yield* equationSection.equations;
      }
    })();
  }

  get extendsClassInstances(): IterableIterator<ModelicaExtendsClassInstance> {
    const declaredElements = this.declaredElements;
    return (function* () {
      for (const declaredElement of declaredElements) {
        if (declaredElement instanceof ModelicaExtendsClassInstance) yield declaredElement;
      }
    })();
  }

  extractModification(name: string | null | undefined): ModelicaModification {
    if (!name) return new ModelicaModification(this, []);
    const outerModificationArgument = this.modification?.getModificationArgument(name) ?? null;
    const modificationArguments: ModelicaModificationArgument[] = [];
    if (outerModificationArgument instanceof ModelicaElementModification) {
      modificationArguments.push(...outerModificationArgument.extract());
    }
    if (outerModificationArgument instanceof ModelicaElementModification) {
      return new ModelicaModification(
        this,
        modificationArguments,
        outerModificationArgument.modificationExpression,
        outerModificationArgument.description,
      );
    } else if (outerModificationArgument instanceof ModelicaParameterModification) {
      return new ModelicaModification(this, modificationArguments, null, null, outerModificationArgument.expression);
    }
    return new ModelicaModification(this, modificationArguments);
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.name ?? "");
    hash.update(this.classKind.toString());
    hash.update(this.modification?.hash ?? "");
    for (const declaredElement of this.declaredElements) {
      hash.update(declaredElement.hash);
    }
    return hash.digest("hex");
  }

  get inputParameters(): IterableIterator<ModelicaComponentInstance> {
    const classKind = this.abstractSyntaxNode?.classPrefixes?.classKind;
    const components = this.components;
    return (function* () {
      for (const component of components) {
        if (
          component.abstractSyntaxNode?.parent?.causality === ModelicaCausality.INPUT ||
          classKind === ModelicaClassKind.RECORD
        )
          yield component;
      }
    })();
  }

  override instantiate(): void {
    logger.debug("Instantiating class: " + this.name);
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: class is already being instantiated");
    this.instantiating = true;
    this.declaredElements = [];
    this.#importClauses = [];
    this.#qualifiedImports = new Map<string, ModelicaClassInstance>();
    this.#unqualifiedImports = [];
    for (const elementSyntaxNode of this.abstractSyntaxNode?.elements ?? []) {
      if (elementSyntaxNode instanceof ModelicaClassDefinitionSyntaxNode) {
        const redeclaration = this.modification?.getModificationArgument(elementSyntaxNode.identifier?.text);
        if (redeclaration instanceof ModelicaClassRedeclaration && redeclaration.classInstance) {
          this.declaredElements.push(redeclaration.classInstance);
        } else {
          this.declaredElements.push(
            ModelicaClassInstance.new(
              this,
              elementSyntaxNode,
              this.extractModification(elementSyntaxNode.identifier?.text),
            ),
          );
        }
      } else if (elementSyntaxNode instanceof ModelicaComponentClauseSyntaxNode) {
        for (const componentDeclarationSyntaxNode of elementSyntaxNode.componentDeclarations) {
          const redeclaration = this.modification?.getModificationArgument(
            componentDeclarationSyntaxNode.declaration?.identifier?.text,
          );
          if (redeclaration instanceof ModelicaComponentRedeclaration && redeclaration.componentInstance) {
            this.declaredElements.push(redeclaration.componentInstance);
          } else {
            this.declaredElements.push(new ModelicaComponentInstance(this, componentDeclarationSyntaxNode));
          }
        }
      } else if (elementSyntaxNode instanceof ModelicaExtendsClauseSyntaxNode) {
        this.declaredElements.push(new ModelicaExtendsClassInstance(this, elementSyntaxNode));
      } else if (elementSyntaxNode instanceof ModelicaImportClauseSyntaxNode) {
        this.#importClauses.push(elementSyntaxNode);
      }
    }
    for (const importClause of this.#importClauses) {
      const packageInstance = this.resolveName(importClause.packageName, true);
      if (!(packageInstance instanceof ModelicaClassInstance)) continue;
      if (importClause instanceof ModelicaUnqualifiedImportClauseSyntaxNode) {
        this.#unqualifiedImports.push(packageInstance);
      } else if (importClause instanceof ModelicaSimpleImportClauseSyntaxNode) {
        const shortName = importClause.shortName?.text;
        const name = shortName == null ? packageInstance.name : shortName;
        if (name) this.#qualifiedImports.set(name, packageInstance);
      } else if (importClause instanceof ModelicaCompoundImportClauseSyntaxNode) {
        for (const importName of importClause.importNames) {
          const qualifiedImport = packageInstance.resolveSimpleName(importName);
          if (qualifiedImport instanceof ModelicaClassInstance) {
            if (qualifiedImport.name) this.#qualifiedImports.set(qualifiedImport.name, qualifiedImport);
          }
        }
      }
    }
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaExtendsClassInstance) element.instantiate();
    }
    this.annotations = ModelicaElement.instantiateAnnotations(
      this,
      this.abstractSyntaxNode?.annotationClause,
      this.modification?.annotations,
    );
    this.description =
      this.abstractSyntaxNode?.classSpecifier?.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;
    this.instantiated = true;
  }

  override get modification(): ModelicaModification | null {
    return this.#modification;
  }

  set modification(modification: ModelicaModification) {
    this.#modification = modification;
  }

  get isEnumeration(): boolean {
    const classSpecifier = this.abstractSyntaxNode?.classSpecifier;
    return classSpecifier instanceof ModelicaShortClassSpecifierSyntaxNode && classSpecifier.enumeration;
  }

  get outputParameters(): IterableIterator<ModelicaComponentInstance> {
    const components = this.components;
    return (function* () {
      for (const component of components) {
        if (component.abstractSyntaxNode?.parent?.causality === ModelicaCausality.OUTPUT) yield component;
      }
    })();
  }

  get qualifiedImports(): Map<string, ModelicaClassInstance> {
    return this.#qualifiedImports;
  }

  get unqualifiedImports(): ModelicaClassInstance[] {
    return this.#unqualifiedImports;
  }

  static new(
    parent: Scope | null,
    abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | ModelicaShortClassDefinitionSyntaxNode,
    modification?: ModelicaModification | null,
  ): ModelicaClassInstance {
    if (abstractSyntaxNode?.classSpecifier instanceof ModelicaShortClassSpecifierSyntaxNode) {
      if (abstractSyntaxNode.classSpecifier.enumeration) {
        return new ModelicaEnumerationClassInstance(parent, abstractSyntaxNode, modification);
      } else {
        return new ModelicaShortClassInstance(parent, abstractSyntaxNode, modification);
      }
    } else if (abstractSyntaxNode?.classSpecifier instanceof ModelicaLongClassSpecifierSyntaxNode) {
      return new ModelicaClassInstance(parent, abstractSyntaxNode, modification);
    } else {
      throw new Error();
    }
  }
}

export class ModelicaEnumerationClassInstance extends ModelicaClassInstance {
  enumerationLiterals: ModelicaEnumerationLiteral[] | null;
  value: ModelicaEnumerationLiteral | null;

  constructor(
    parent: Scope | null,
    abstractSyntaxNode?: ModelicaClassDefinitionSyntaxNode | ModelicaShortClassDefinitionSyntaxNode | null,
    modification?: ModelicaModification | null,
    enumerationLiterals?: ModelicaEnumerationLiteral[] | null,
    value?: ModelicaEnumerationLiteral | null,
  ) {
    super(parent, abstractSyntaxNode, modification);
    this.enumerationLiterals = enumerationLiterals ?? null;
    this.value = value ?? null;
  }

  override clone(modification?: ModelicaModification | null): ModelicaClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification ?? null);
    const hash = mergedModification?.hash ?? "";
    const cachedInstance = this.cloneCache.get(hash);
    if (cachedInstance) {
      cachedInstance.instantiate();
      return cachedInstance;
    }
    const classInstance = new ModelicaEnumerationClassInstance(
      this.parent,
      this.abstractSyntaxNode,
      mergedModification,
      this.enumerationLiterals,
      this.value,
    );
    classInstance.instantiate();
    this.cloneCache.set(hash, classInstance);
    return classInstance;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return (function* () {})();
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating)
      throw Error("reentrant error: enumeration class '" + this.name + "' is already being instantiated");
    this.instantiating = true;
    this.declaredElements = [];
    const classSpecifier = this.abstractSyntaxNode?.classSpecifier;
    if (!(classSpecifier instanceof ModelicaShortClassSpecifierSyntaxNode) || !classSpecifier.enumeration) {
      this.instantiated = true;
      return;
    }
    if (!this.enumerationLiterals) {
      let i = 1;
      this.enumerationLiterals = [];
      for (const enumerationLiteral of classSpecifier.enumerationLiterals) {
        if (enumerationLiteral.identifier?.text) {
          this.enumerationLiterals.push(new ModelicaEnumerationLiteral(i, enumerationLiteral.identifier.text));
          i++;
        }
      }
    }
    const value = this.modification?.expression;
    if (value instanceof ModelicaEnumerationLiteral) this.value = value;
    this.instantiated = true;
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = identifier?.text;
    if (!simpleName) return null;
    if (!this.instantiated && !this.instantiating) this.instantiate();
    for (const enumerationLiteral of this.enumerationLiterals ?? []) {
      if (enumerationLiteral.stringValue === identifier.text) {
        return this.clone(new ModelicaModification(this, [], null, null, enumerationLiteral));
      }
    }
    return super.resolveSimpleName(identifier, global, encapsulated);
  }
}

export class ModelicaShortClassInstance extends ModelicaClassInstance {
  classInstance: ModelicaClassInstance | null = null;

  override clone(modification?: ModelicaModification | null): ModelicaClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    if (!this.classInstance) {
      return new ModelicaClassInstance(this.parent, this.abstractSyntaxNode, modification);
    }
    const mergedModification = ModelicaModification.merge(this.modification, modification ?? null);
    return this.classInstance.clone(mergedModification);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.classInstance?.elements ?? [][Symbol.iterator]();
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating)
      throw Error("reentrant error: short class '" + this.name + "' is already being instantiated");
    this.instantiating = true;
    this.declaredElements = [];
    const classSpecifier = this.abstractSyntaxNode?.classSpecifier as ModelicaShortClassSpecifierSyntaxNode;
    const arraySubscripts = [...(classSpecifier?.arraySubscripts?.subscripts ?? [])];
    const classInstance = this.resolveTypeSpecifier(classSpecifier.typeSpecifier);
    if (classInstance instanceof ModelicaClassInstance) {
      if (arraySubscripts.length === 0) this.classInstance = classInstance.clone(this.modification);
      else
        this.classInstance = new ModelicaArrayClassInstance(
          this.parent,
          classInstance,
          arraySubscripts,
          this.modification,
        );
      this.classInstance.instantiate();
    } else {
      // Resolution failed.
      console.warn(`Failed to resolve class '${this.name}' target.`);
    }
    this.instantiated = true;
  }
}

export class ModelicaEntity extends ModelicaClassInstance {
  #storedDefinitionSyntaxNode: ModelicaStoredDefinitionSyntaxNode | null = null;
  path: string;
  subEntities: ModelicaEntity[] = [];
  unstructured = false;

  constructor(parent: Scope, path: string) {
    super(parent);
    this.path = this.context?.fs.resolve(path) ?? path;
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

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(super.hash);
    hash.update(this.path);
    for (const subEntity of this.subEntities) {
      hash.update(subEntity.hash);
    }
    return hash.digest("hex");
  }

  override instantiate(): void {
    super.instantiate();
    for (const subEntity of this.subEntities) {
      if (!subEntity.instantiated && !subEntity.instantiating) subEntity.instantiate();
    }
  }

  load(): void {
    this.subEntities = [];
    const context = this.context;
    if (!context) throw new Error();
    const stats = context.fs.stat(this.path);
    if (!stats) throw new Error();
    let filePath: string | null = null;
    if (stats.isFile()) {
      this.unstructured = true;
      filePath = this.path;
    } else if (stats.isDirectory()) {
      this.unstructured = false;
      filePath = context.fs.join(this.path, "package.mo");
      if (!context.fs.stat(filePath)?.isFile()) {
        filePath = null;
      }
      for (const dirent of context.fs.readdir(this.path)) {
        if (dirent.isDirectory()) {
          const pkgPath = context.fs.join(this.path, dirent.name, "package.mo");
          if (!context.fs.stat(pkgPath)?.isFile()) continue;
        } else if (dirent.isFile()) {
          if (dirent.name === "package.mo" || context.fs.extname(dirent.name) !== ".mo") continue;
        }
        const subEntity = new ModelicaEntity(this, context.fs.join(this.path, dirent.name));
        subEntity.load();
        this.subEntities.push(subEntity);
      }
      const packageOrderPath = context.fs.join(this.path, "package.order");
      if (context.fs.stat(packageOrderPath)?.isFile()) {
        const packageOrder = context.fs
          .read(packageOrderPath)
          .split("\n")
          .map((s) => s.trim());
        this.subEntities.sort((a, b) => {
          const aName = a.name ?? "";
          const bName = b.name ?? "";
          const aIndex = packageOrder.indexOf(aName);
          const bIndex = packageOrder.indexOf(bName);
          if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
          if (aIndex !== -1) return -1;
          if (bIndex !== -1) return 1;
          return aName.localeCompare(bName);
        });
      } else {
        this.subEntities.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      }
    } else {
      throw new Error();
    }
    if (filePath) {
      const parser = context.getParser(context.fs.extname(filePath));
      const text = context.fs.read(filePath);
      const tree = parser.parse(text, undefined, { bufferSize: text.length * 2 });
      this.#storedDefinitionSyntaxNode = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
      this.abstractSyntaxNode = this.storedDefinitionSyntaxNode?.classDefinitions?.[0] ?? null;
    }
  }

  get storedDefinitionSyntaxNode(): ModelicaStoredDefinitionSyntaxNode | null {
    return this.#storedDefinitionSyntaxNode;
  }
}

export class ModelicaComponentInstance extends ModelicaNamedElement {
  #abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | ModelicaComponentDeclaration1SyntaxNode | null;
  #modification: ModelicaModification | null = null;
  #classInstance: ModelicaClassInstance | null = null;

  constructor(
    parent: ModelicaClassInstance | null,
    abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | ModelicaComponentDeclaration1SyntaxNode | null,
    modification?: ModelicaModification | null,
  ) {
    super(parent);
    this.#abstractSyntaxNode = abstractSyntaxNode;
    this.name = this.abstractSyntaxNode?.declaration?.identifier?.text ?? null;
    this.description = this.abstractSyntaxNode?.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;
    this.#modification = modification ?? this.mergeModifications();
  }

  get classInstance(): ModelicaClassInstance | null {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.#classInstance;
  }

  set classInstance(value: ModelicaClassInstance | null) {
    this.#classInstance = value;
  }

  get abstractSyntaxNode(): ModelicaComponentDeclarationSyntaxNode | ModelicaComponentDeclaration1SyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentInstance(this, argument);
  }

  clone(modification?: ModelicaModification | null): ModelicaComponentInstance {
    const componentInstance = new ModelicaComponentInstance(this.parent, this.abstractSyntaxNode, modification);
    componentInstance.instantiate();
    return componentInstance;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.classInstance?.elements ?? [][Symbol.iterator]();
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.name ?? "");
    hash.update(this.classInstance?.compositeName ?? "");
    hash.update(this.modification?.hash ?? "");
    return hash.digest("hex");
  }

  override instantiate(): void {
    logger.debug("Instantiating element: " + this.name);
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: component is already being instantiated");
    this.instantiating = true;
    const element = this.parent?.resolveTypeSpecifier(this.abstractSyntaxNode?.parent?.typeSpecifier);
    if (element instanceof ModelicaClassInstance) {
      const arraySubscripts = [...(this.abstractSyntaxNode?.arraySubscripts ?? [])];
      if (arraySubscripts.length === 0) {
        this.classInstance = element.clone(this.modification);
      } else {
        this.classInstance = new ModelicaArrayClassInstance(this, element, arraySubscripts, this.modification);
        this.classInstance.instantiate();
      }
    }
    this.annotations = ModelicaElement.instantiateAnnotations(
      this.parent,
      this.abstractSyntaxNode?.annotationClause,
      this.modification?.annotations,
    );
    this.instantiated = true;
  }

  mergeModifications(): ModelicaModification {
    const outerModificationArgument = this.parent?.modification?.getModificationArgument(this.name) ?? null;
    const modificationArguments: ModelicaModificationArgument[] = [];
    const modificationSyntaxNode = this.abstractSyntaxNode?.declaration?.modification;
    for (const modificationArgumentSyntaxNode of modificationSyntaxNode?.classModification?.modificationArguments ??
      []) {
      if (modificationArgumentSyntaxNode instanceof ModelicaElementModificationSyntaxNode) {
        modificationArguments.push(ModelicaElementModification.new(this.parent, modificationArgumentSyntaxNode));
      } else if (modificationArgumentSyntaxNode instanceof ModelicaElementRedeclarationSyntaxNode) {
        modificationArguments.push(ModelicaElementRedeclaration.new(this.parent, modificationArgumentSyntaxNode));
      }
    }
    if (outerModificationArgument instanceof ModelicaElementModification) {
      modificationArguments.push(...outerModificationArgument.extract());
    }

    // Filter out "annotation" arguments and convert them to .annotations
    const annotationArg = modificationArguments.find((a) => a.name === "annotation");
    const filteredArgs = modificationArguments.filter((a) => a.name !== "annotation");
    let annotationFromArg: ModelicaModification | null = null;
    if (annotationArg instanceof ModelicaElementModification) {
      annotationFromArg = new ModelicaModification(
        this,
        annotationArg.modificationArguments,
        annotationArg.modificationExpression,
        annotationArg.description,
        annotationArg.expression,
      );
    }

    if (outerModificationArgument instanceof ModelicaElementModification) {
      const mod = new ModelicaModification(
        this,
        filteredArgs,
        outerModificationArgument.modificationExpression ?? modificationSyntaxNode?.modificationExpression,
        outerModificationArgument.description,
      );
      mod.annotations = ModelicaModification.merge(
        this.abstractSyntaxNode?.annotationClause
          ? ModelicaModification.new(this.parent, this.abstractSyntaxNode.annotationClause)
          : null,
        ModelicaModification.merge(outerModificationArgument.annotations, annotationFromArg),
      );
      return mod;
    } else if (outerModificationArgument instanceof ModelicaParameterModification) {
      const mod = new ModelicaModification(this, filteredArgs, null, null, outerModificationArgument.expression);
      mod.annotations = annotationFromArg;
      return mod;
    }
    const mod = new ModelicaModification(this, filteredArgs, modificationSyntaxNode?.modificationExpression);
    mod.annotations = ModelicaModification.merge(
      annotationFromArg,
      this.abstractSyntaxNode?.annotationClause
        ? ModelicaModification.new(this.parent, this.abstractSyntaxNode.annotationClause)
        : null,
    );
    return mod;
  }

  override get modification(): ModelicaModification | null {
    return this.#modification;
  }

  get isEnumeration(): boolean {
    return this.classInstance?.isEnumeration ?? false;
  }

  override get parent(): ModelicaClassInstance | null {
    return super.parent as ModelicaClassInstance | null;
  }

  get variability(): ModelicaVariability | null {
    return this.abstractSyntaxNode?.parent?.variability ?? null;
  }
}

export abstract class ModelicaPredefinedClassInstance extends ModelicaClassInstance {
  constructor(parent: Scope | null, name: string, modification?: ModelicaModification | null) {
    super(parent, null, modification);
    this["@type"] = name + "ClassInstance";
    this.name = name;
  }

  abstract override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R;

  abstract override clone(modification?: ModelicaModification | null): ModelicaClassInstance;

  get expression(): ModelicaExpression | null {
    return this.modification?.expression ?? null;
  }
}

export class ModelicaBooleanClassInstance extends ModelicaPredefinedClassInstance {
  constructor(parent: Scope | null, modification?: ModelicaModification | null) {
    super(parent, "Boolean", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaBooleanClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaBooleanClassInstance(this.parent, mergedModification);
    classInstance.instantiate();
    return classInstance;
  }

  get fixed(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("fixed")?.expression ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("quantity")?.expression ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("start")?.expression ?? null;
  }
}

export class ModelicaIntegerClassInstance extends ModelicaPredefinedClassInstance {
  constructor(parent: Scope | null, modification?: ModelicaModification | null) {
    super(parent, "Integer", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitIntegerClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaIntegerClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaIntegerClassInstance(this.parent, mergedModification);
    classInstance.instantiate();
    return classInstance;
  }

  get fixed(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("fixed")?.expression ?? null;
  }

  get max(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("max")?.expression ?? null;
  }

  get min(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("min")?.expression ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("quantity")?.expression ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("start")?.expression ?? null;
  }
}

export class ModelicaRealClassInstance extends ModelicaPredefinedClassInstance {
  constructor(parent: Scope | null, modification?: ModelicaModification | null) {
    super(parent, "Real", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitRealClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaRealClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaRealClassInstance(this.parent, mergedModification);
    classInstance.instantiate();
    return classInstance;
  }

  get displayUnit(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("displayUnit")?.expression ?? null;
  }

  get fixed(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("fixed")?.expression ?? null;
  }

  get max(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("max")?.expression ?? null;
  }

  get min(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("min")?.expression ?? null;
  }

  get nominal(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("nominal")?.expression ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("quantity")?.expression ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("start")?.expression ?? null;
  }

  get stateSelect(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("stateSelect")?.expression ?? null;
  }

  get unbounded(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("unbounded")?.expression ?? null;
  }

  get unit(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("unit")?.expression ?? null;
  }
}

export class ModelicaStringClassInstance extends ModelicaPredefinedClassInstance {
  constructor(parent: Scope | null, modification?: ModelicaModification | null) {
    super(parent, "String", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitStringClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaStringClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaStringClassInstance(this.parent, mergedModification);
    classInstance.instantiate();
    return classInstance;
  }

  get fixed(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("fixed")?.expression ?? null;
  }

  get quantity(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("quantity")?.expression ?? null;
  }

  get start(): ModelicaExpression | null {
    return this.modification?.getModificationArgument("start")?.expression ?? null;
  }
}

export class ModelicaArrayClassInstance extends ModelicaClassInstance {
  #arraySubscripts: ModelicaSubscriptSyntaxNode[];
  #elementClassInstance: ModelicaClassInstance | null;
  shape: number[] = [];

  constructor(
    parent: Scope | null,
    elementClassInstance: ModelicaClassInstance | null,
    arraySubscripts: ModelicaSubscriptSyntaxNode[],
    modification?: ModelicaModification | null,
  ) {
    super(parent, elementClassInstance?.abstractSyntaxNode, modification);
    this.#elementClassInstance = elementClassInstance;
    this.#arraySubscripts = arraySubscripts;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitArrayClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaArrayClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaArrayClassInstance(
      this.parent,
      this.#elementClassInstance,
      this.#arraySubscripts,
      mergedModification,
    );
    classInstance.instantiate();
    return classInstance;
  }

  get elementClassInstance(): ModelicaClassInstance | null {
    this.instantiate();
    return this.#elementClassInstance;
  }

  override get hash(): string {
    const hash = createHash("sha256");
    hash.update(super.hash);
    for (const shape of this.shape) {
      hash.update(shape.toString());
    }
    return hash.digest("hex");
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: array class is already being instantiated");
    this.instantiating = true;
    this.declaredElements = [];
    this.shape = [];
    const expression = this.modification?.expression;
    let i = 0;
    for (const arraySubscript of this.#arraySubscripts) {
      if (arraySubscript.flexible) {
        if (expression instanceof ModelicaArray) this.shape.push(expression.shape[i] ?? 0);
        else this.shape.push(0);
        continue;
      }
      const length = arraySubscript.expression?.accept(new ModelicaInterpreter(), this);
      if (length instanceof ModelicaIntegerLiteral) this.shape.push(length.value);
      else this.shape.push(0);
      i++;
    }

    let elementClassInstance = this.#elementClassInstance;
    elementClassInstance?.instantiate();
    while (elementClassInstance instanceof ModelicaShortClassInstance) {
      elementClassInstance = elementClassInstance.classInstance;
    }
    if (elementClassInstance instanceof ModelicaArrayClassInstance) {
      this.shape.push(...elementClassInstance.shape);
      elementClassInstance = elementClassInstance.elementClassInstance;
    }
    this.name = (elementClassInstance?.name ?? "?") + "[" + this.shape.join(", ") + "]";
    if (!elementClassInstance || this.#arraySubscripts.length == 0) {
      this.instantiated = true;
      return;
    }
    const size = this.shape.reduce((acc, cur) => acc * cur);
    const modifications = this.modification?.split(size);
    for (let i = 0; i < size; i++) {
      this.declaredElements.push(elementClassInstance.clone(modifications?.[i]));
    }
    this.instantiated = true;
  }
}

export class ModelicaModification {
  #expression: ModelicaExpression | null;
  scope: Scope | null;
  description: string | null;
  modificationExpression: ModelicaModificationExpressionSyntaxNode | null;
  modificationArguments: ModelicaModificationArgument[];
  annotations: ModelicaModification | null = null;

  constructor(
    scope: Scope | null,
    modificationArguments: ModelicaModificationArgument[],
    modificationExpression?: ModelicaModificationExpressionSyntaxNode | null,
    description?: string | null,
    expression?: ModelicaExpression | null,
  ) {
    this.scope = scope;
    this.modificationArguments = ModelicaModification.mergeModificationArguments(scope, modificationArguments);
    this.modificationExpression = modificationExpression ?? null;
    this.description = description ?? null;
    this.#expression = expression ?? null;
  }

  #evaluating = false;

  get expression(): ModelicaExpression | null {
    if (this.#expression) return this.#expression;
    if (this.#evaluating) {
      return null;
    }
    this.#evaluating = true;
    try {
      this.#expression = this.modificationExpression?.expression?.accept(new ModelicaInterpreter(), this.scope) ?? null;
    } finally {
      this.#evaluating = false;
    }
    return this.#expression;
  }

  getModificationArgument(name: string | null | undefined): ModelicaModificationArgument | null {
    if (!name) return null;
    for (const modificationArgument of this.modificationArguments) {
      if (modificationArgument.name === name) return modificationArgument;
    }
    return null;
  }

  get hash(): string {
    const hash = createHash("sha256");
    for (const modificationArgument of this.modificationArguments) {
      hash.update(modificationArgument.hash);
    }
    if (this.expression) {
      hash.update(this.expression.hash);
    }
    if (this.annotations) {
      hash.update(this.annotations.hash);
    }
    const digest = hash.digest("hex");
    return digest;
  }

  static merge(
    modification: ModelicaModification | null | undefined,
    overridingModification: ModelicaModification | null | undefined,
  ): ModelicaModification | null {
    if (modification == null) return overridingModification ?? null;
    else if (overridingModification == null) return modification;
    const mergedModificationArguments = ModelicaModification.mergeModificationArguments(overridingModification.scope, [
      ...modification.modificationArguments,
      ...overridingModification.modificationArguments,
    ]);
    const mergedExpression = overridingModification.expression ?? modification.expression;
    const mergedModificationExpression = mergedExpression
      ? null
      : (overridingModification.modificationExpression ?? modification.modificationExpression);
    const mergedModification = new ModelicaModification(
      overridingModification.scope,
      mergedModificationArguments,
      mergedModificationExpression,
      overridingModification.description ?? modification.description,
      mergedExpression,
    );
    mergedModification.annotations = ModelicaModification.merge(
      modification.annotations,
      overridingModification.annotations,
    );
    return mergedModification;
  }

  static new(
    scope: Scope | null,
    abstractSyntaxNode:
      | ModelicaModificationSyntaxNode
      | ModelicaAnnotationClauseSyntaxNode
      | ModelicaClassModificationSyntaxNode
      | null,
  ): ModelicaModification {
    const classModification =
      abstractSyntaxNode instanceof ModelicaClassModificationSyntaxNode
        ? abstractSyntaxNode
        : abstractSyntaxNode?.classModification;

    const modificationArguments: ModelicaModificationArgument[] = [];
    for (const modificationArgumentSyntaxNode of classModification?.modificationArguments ?? []) {
      if (modificationArgumentSyntaxNode instanceof ModelicaElementModificationSyntaxNode) {
        modificationArguments.push(ModelicaElementModification.new(scope, modificationArgumentSyntaxNode));
      } else if (modificationArgumentSyntaxNode instanceof ModelicaElementRedeclarationSyntaxNode) {
        modificationArguments.push(ModelicaElementRedeclaration.new(scope, modificationArgumentSyntaxNode));
      }
    }

    if (
      abstractSyntaxNode instanceof ModelicaAnnotationClauseSyntaxNode ||
      abstractSyntaxNode instanceof ModelicaClassModificationSyntaxNode
    ) {
      return new ModelicaModification(scope, modificationArguments);
    }

    const annotationArgument = modificationArguments.find((a) => a.name === "annotation");
    const mod = new ModelicaModification(
      scope,
      modificationArguments.filter((a) => a.name !== "annotation"),
      abstractSyntaxNode?.modificationExpression,
    );
    mod.annotations = ModelicaModification.merge(
      abstractSyntaxNode?.annotationClause
        ? ModelicaModification.new(scope, abstractSyntaxNode.annotationClause)
        : null,
      annotationArgument instanceof ModelicaElementModification
        ? new ModelicaModification(
            scope,
            annotationArgument.modificationArguments,
            annotationArgument.modificationExpression,
            annotationArgument.description,
            annotationArgument.expression,
          )
        : null,
    );
    return mod;
  }

  static mergeModificationArguments(
    scope: Scope | null,
    modificationArguments: ModelicaModificationArgument[],
  ): ModelicaModificationArgument[] {
    const modificationArgumentMap = new Map<string, ModelicaModificationArgument[]>();
    for (const modificationArgument of modificationArguments) {
      const name = modificationArgument.name;
      if (!name) continue;
      if (!modificationArgumentMap.has(name)) modificationArgumentMap.set(name, []);
      modificationArgumentMap.get(name)?.push(modificationArgument);
    }
    const mergedModificationArguments: ModelicaModificationArgument[] = [];
    for (const [, duplicates] of modificationArgumentMap) {
      if (duplicates.length === 1) {
        const single = duplicates[0];
        if (single) mergedModificationArguments.push(single);
      } else {
        const allElementMods = duplicates.every((d) => d instanceof ModelicaElementModification);
        if (allElementMods) {
          const elemMods = duplicates as ModelicaElementModification[];
          const mergedNextLevelArgs: ModelicaModificationArgument[] = [];
          for (const m of elemMods) {
            mergedNextLevelArgs.push(...m.extract());
          }
          const mergedNextLevel = ModelicaModification.mergeModificationArguments(scope, mergedNextLevelArgs);
          let modificationExpression: ModelicaModificationExpressionSyntaxNode | null | undefined = null;
          let expression: ModelicaExpression | null = null;
          for (let i = duplicates.length - 1; i >= 0; i--) {
            const d = duplicates[i] as ModelicaElementModification;
            if (d.nameComponents.length === 1 && d.modificationExpression) {
              modificationExpression = d.modificationExpression;
              expression = d.expression;
              break;
            }
          }
          let mergedAnnotations: ModelicaModification | null = null;
          for (const m of elemMods) {
            mergedAnnotations = ModelicaModification.merge(mergedAnnotations, m.annotations);
          }
          const first = duplicates[0] as ModelicaElementModification;
          const firstNameComponent = first.nameComponents[0];
          if (firstNameComponent) {
            const mod = new ModelicaElementModification(
              scope ?? first.scope,
              [firstNameComponent],
              mergedNextLevel,
              modificationExpression,
              first.description,
              expression,
            );
            mod.annotations = mergedAnnotations;
            mergedModificationArguments.push(mod);
          }
        } else {
          const last = duplicates[duplicates.length - 1];
          if (last) mergedModificationArguments.push(last);
        }
      }
    }
    return mergedModificationArguments;
  }

  split(count: number): ModelicaModification[];
  split(count: number, index: number): ModelicaModification;
  split(count: number, index?: number): ModelicaModification | ModelicaModification[] {
    if (index) {
      const mod = new ModelicaModification(
        this.scope,
        this.modificationArguments.map((m) => m.split(count, index)),
        this.modificationExpression,
        this.description,
        this.expression?.split(count, index),
      );
      mod.annotations = this.annotations;
      return mod;
    } else {
      const modificationArguments = this.modificationArguments.map((m) => m.split(count));
      const expressions = this.expression?.split(count);
      const modifications: ModelicaModification[] = [];
      for (let i = 0; i < count; i++) {
        const mod = new ModelicaModification(
          this.scope,
          modificationArguments.map((m) => m[i]).flatMap((m) => m ?? []),
          this.modificationExpression,
          this.description,
          expressions?.[i],
        );
        mod.annotations = this.annotations;
        modifications.push(mod);
      }
      return modifications;
    }
  }
}

export abstract class ModelicaModificationArgument {
  #scope: Scope | null;

  constructor(scope: Scope | null) {
    this.#scope = scope;
  }

  abstract get expression(): ModelicaExpression | null;

  abstract get hash(): string;

  abstract get name(): string | null;

  get scope(): Scope | null {
    return this.#scope;
  }

  abstract split(count: number): ModelicaModificationArgument[];
  abstract split(count: number, index: number): ModelicaModificationArgument;
  abstract split(count: number, index?: number): ModelicaModificationArgument | ModelicaModificationArgument[];
}

export class ModelicaElementModification extends ModelicaModificationArgument {
  #expression: ModelicaExpression | null = null;
  #modificationExpression: WeakRef<ModelicaModificationExpressionSyntaxNode> | null;
  #nameComponents: WeakRef<ModelicaIdentifierSyntaxNode>[];
  description: string | null;
  modificationArguments: ModelicaModificationArgument[] = [];
  annotations: ModelicaModification | null = null;

  constructor(
    scope: Scope | null,
    nameComponents: ModelicaIdentifierSyntaxNode[],
    modificationArguments: ModelicaModificationArgument[],
    modificationExpression?: ModelicaModificationExpressionSyntaxNode | null,
    description?: string | null,
    expression?: ModelicaExpression | null,
  ) {
    super(scope);
    this.#nameComponents = makeWeakRefArray(nameComponents);
    this.modificationArguments = modificationArguments;
    this.#modificationExpression = makeWeakRef(modificationExpression);
    this.description = description ?? null;
    this.#expression = expression ?? null;
  }

  #evaluating = false;

  override get expression(): ModelicaExpression | null {
    if (this.#expression) return this.#expression;
    if (this.#evaluating) {
      return null;
    }
    this.#evaluating = true;
    try {
      this.#expression = this.modificationExpression?.expression?.accept(new ModelicaInterpreter(), this.scope) ?? null;
    } finally {
      this.#evaluating = false;
    }
    return this.#expression;
  }

  extract(): ModelicaModificationArgument[] {
    if (this.nameComponents.length > 1) {
      const mod = new ModelicaElementModification(
        this.scope,
        this.nameComponents.slice(1),
        this.modificationArguments,
        this.modificationExpression,
        this.description,
        this.expression,
      );
      mod.annotations = this.annotations;
      return [mod];
    } else return this.modificationArguments;
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.nameComponents.map((n) => n.text).join("."));
    for (const arg of this.modificationArguments) {
      hash.update(arg.hash);
    }
    if (this.expression) {
      hash.update(this.expression.hash);
    }
    if (this.annotations) {
      hash.update(this.annotations.hash);
    }
    return hash.digest("hex");
  }

  get modificationExpression(): ModelicaModificationExpressionSyntaxNode | null {
    return this.#modificationExpression?.deref() ?? null;
  }

  override get name(): string | null {
    return this.nameComponents[0]?.text ?? null;
  }

  get nameComponents(): ModelicaIdentifierSyntaxNode[] {
    return this.#nameComponents.map((nameComponentRef) => {
      const nameComponent = nameComponentRef.deref();
      if (!nameComponent) throw new Error();
      return nameComponent;
    });
  }

  static new(
    scope: Scope | null,
    abstractSyntaxNode: ModelicaElementModificationSyntaxNode,
  ): ModelicaElementModification {
    const modificationArguments: ModelicaModificationArgument[] = [];
    for (const modificationArgumentSyntaxNode of abstractSyntaxNode.modification?.classModification
      ?.modificationArguments ?? []) {
      if (modificationArgumentSyntaxNode instanceof ModelicaElementModificationSyntaxNode) {
        modificationArguments.push(ModelicaElementModification.new(scope, modificationArgumentSyntaxNode));
      } else if (modificationArgumentSyntaxNode instanceof ModelicaElementRedeclarationSyntaxNode) {
        modificationArguments.push(ModelicaElementRedeclaration.new(scope, modificationArgumentSyntaxNode));
      }
    }
    const mod = new ModelicaElementModification(
      scope,
      abstractSyntaxNode.name?.parts ?? [],
      modificationArguments,
      abstractSyntaxNode.modification?.modificationExpression,
      abstractSyntaxNode.description?.strings?.map((d) => d.text ?? "")?.join(" "),
      null,
    );
    mod.annotations = abstractSyntaxNode.annotationClause
      ? ModelicaModification.new(scope, abstractSyntaxNode.annotationClause)
      : null;
    return mod;
  }

  override split(count: number): ModelicaElementModification[];
  override split(count: number, index: number): ModelicaElementModification;
  override split(count: number, index?: number): ModelicaElementModification | ModelicaElementModification[] {
    const expressions = this.expression?.split(count, index as number);
    if (index) {
      const mod = new ModelicaElementModification(
        this.scope,
        this.nameComponents,
        this.modificationArguments.map((m) => m.split(count, index)),
        this.modificationExpression,
        this.description,
        expressions as ModelicaExpression | undefined,
      );
      mod.annotations = this.annotations;
      return mod;
    } else {
      const modificationArguments = this.modificationArguments.map((m) => m.split(count));
      const modifications = [];
      const exprs = expressions as ModelicaExpression[] | undefined;
      for (let i = 0; i < count; i++) {
        const mod = new ModelicaElementModification(
          this.scope,
          this.nameComponents,
          modificationArguments.map((m) => m[i]).flatMap((m) => (m ? [m] : [])),
          this.modificationExpression,
          this.description,
          exprs?.[i],
        );
        mod.annotations = this.annotations;
        modifications.push(mod);
      }
      return modifications;
    }
  }
}

export class ModelicaParameterModification extends ModelicaModificationArgument {
  #expression: ModelicaExpression | null = null;
  #expressionSyntaxNode: WeakRef<ModelicaExpressionSyntaxNode> | null;
  #name: string;

  constructor(
    scope: Scope | null,
    name: string,
    expressionSyntaxNode?: ModelicaExpressionSyntaxNode | null,
    expression?: ModelicaExpression | null,
  ) {
    super(scope);
    this.#name = name;
    this.#expressionSyntaxNode = makeWeakRef(expressionSyntaxNode);
    this.#expression = expression ?? null;
  }

  #evaluating = false;

  override get expression(): ModelicaExpression | null {
    if (this.#expression) return this.#expression;
    if (this.#evaluating) {
      return null;
    }
    this.#evaluating = true;
    try {
      this.#expression = this.#expressionSyntaxNode?.deref()?.accept(new ModelicaInterpreter(), this.scope) ?? null;
    } finally {
      this.#evaluating = false;
    }
    return this.#expression;
  }

  get expressionSyntaxNode(): ModelicaExpressionSyntaxNode | null {
    return this.#expressionSyntaxNode?.deref() ?? null;
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.name);
    if (this.expression) {
      hash.update(this.expression.hash);
    }
    return hash.digest("hex");
  }

  get name(): string {
    return this.#name;
  }

  override split(count: number): ModelicaParameterModification[];
  override split(count: number, index: number): ModelicaParameterModification;
  override split(count: number, index?: number): ModelicaParameterModification | ModelicaParameterModification[] {
    if (!this.expression) throw new Error();
    if (index) {
      return new ModelicaParameterModification(
        this.scope,
        this.name,
        this.expressionSyntaxNode,
        this.expression.split(count, index),
      );
    } else {
      const expressions = this.expression.split(count);
      const modifications = [];
      for (const expression of expressions) {
        modifications.push(
          new ModelicaParameterModification(this.scope, this.name, this.expressionSyntaxNode, expression),
        );
      }
      return modifications;
    }
  }
}

export abstract class ModelicaElementRedeclaration extends ModelicaModificationArgument {
  abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode;

  constructor(scope: Scope | null, abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode) {
    super(scope);
    this.abstractSyntaxNode = abstractSyntaxNode;
  }

  get each(): boolean {
    return this.abstractSyntaxNode.each;
  }

  get final(): boolean {
    return this.abstractSyntaxNode.final;
  }

  static new(
    scope: Scope | null,
    abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode,
  ): ModelicaElementRedeclaration {
    if (abstractSyntaxNode.shortClassDefinition) {
      return ModelicaClassRedeclaration.new(scope, abstractSyntaxNode);
    } else if (abstractSyntaxNode.componentClause) {
      return ModelicaComponentRedeclaration.new(scope, abstractSyntaxNode);
    } else {
      throw new Error();
    }
  }

  get replaceable(): boolean {
    return this.abstractSyntaxNode.replaceable;
  }
}

export class ModelicaClassRedeclaration extends ModelicaElementRedeclaration {
  classInstance: ModelicaShortClassInstance | null;

  constructor(scope: Scope | null, abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode) {
    super(scope, abstractSyntaxNode);
    this.classInstance = new ModelicaShortClassInstance(scope, abstractSyntaxNode.shortClassDefinition);
  }

  get expression(): ModelicaExpression | null {
    throw new Error("Method not implemented.");
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.name ?? "");
    hash.update(this.classInstance?.hash ?? "");
    return hash.digest("hex");
  }

  get name(): string | null {
    return this.abstractSyntaxNode.shortClassDefinition?.identifier?.text ?? null;
  }

  static new(
    scope: Scope | null,
    abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode,
  ): ModelicaClassRedeclaration {
    return new ModelicaClassRedeclaration(scope, abstractSyntaxNode);
  }

  split(count: number): ModelicaModificationArgument[];
  split(count: number, index: number): ModelicaModificationArgument;
  split(count: number, index?: number): ModelicaModificationArgument | ModelicaModificationArgument[];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  split(count: unknown, index?: unknown): ModelicaModificationArgument | ModelicaModificationArgument[] {
    throw new Error("Method not implemented.");
  }
}

export class ModelicaComponentRedeclaration extends ModelicaElementRedeclaration {
  componentInstance: ModelicaComponentInstance | null;

  constructor(scope: Scope | null, abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode) {
    super(scope, abstractSyntaxNode);
    this.componentInstance = new ModelicaComponentInstance(
      scope?.parent as ModelicaClassInstance,
      abstractSyntaxNode.componentClause?.componentDeclaration ?? null,
    );
  }

  get expression(): ModelicaExpression | null {
    throw new Error("Method not implemented.");
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.name ?? "");
    hash.update(this.componentInstance?.hash ?? "");
    return hash.digest("hex");
  }

  get name(): string | null {
    return this.componentInstance?.name ?? null;
  }

  static new(
    scope: Scope | null,
    abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode,
  ): ModelicaComponentRedeclaration {
    return new ModelicaComponentRedeclaration(scope, abstractSyntaxNode);
  }

  override split(count: number): ModelicaComponentRedeclaration[];
  override split(count: number, index: number): ModelicaComponentRedeclaration;
  override split(count: number, index?: number): ModelicaComponentRedeclaration | ModelicaComponentRedeclaration[] {
    if (index !== undefined) {
      return this;
    } else {
      return Array(count).fill(this);
    }
  }
}

export interface IModelicaModelVisitor<R, A> {
  visitArrayClassInstance(node: ModelicaArrayClassInstance, argument?: A): R;

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
  visitArrayClassInstance(node: ModelicaArrayClassInstance, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

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

export class ModelicaModelPrinter extends ModelicaModelVisitor<number> {
  out: Writer;

  constructor(out: Writer) {
    super();
    this.out = out;
  }

  private indent(indent: number): void {
    this.out.write("  ".repeat(indent));
  }

  visitArrayClassInstance(node: ModelicaArrayClassInstance, indent = 0): void {
    for (const declaredElement of node.declaredElements) {
      declaredElement.accept(this, indent + 1);
    }
  }

  visitBooleanClassInstance(node: ModelicaBooleanClassInstance, indent = 0): void {
    this.indent(indent);
    this.out.write("type Boolean\n");
    this.indent(indent + 1);
    this.out.write("BooleanType ⟨value⟩ = ");
    node.expression?.accept(new ModelicaDAEPrinter(this.out));
    this.out.write(";\n");
    if (node.quantity) {
      this.indent(indent + 1);
      this.out.write('parameter StringType quantity = "');
      node.quantity.accept(new ModelicaDAEPrinter(this.out));
      this.out.write('";\n');
    }
    if (node.start) {
      this.indent(indent + 1);
      this.out.write("parameter BooleanType start = ");
      node.start.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.fixed) {
      this.indent(indent + 1);
      this.out.write("parameter BooleanType fixed = ");
      node.fixed.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    this.indent(indent);
    this.out.write("end Boolean;\n");
  }

  visitClassInstance(node: ModelicaClassInstance, indent = 0): void {
    this.indent(indent);
    this.out.write("class " + node.name + "\n");
    for (const element of node.elements) element.accept(this, indent + 1);
    this.indent(indent);
    this.out.write("end " + node.name + ";\n");
  }

  visitComponentInstance(node: ModelicaComponentInstance, indent = 0): void {
    this.indent(indent);
    this.out.write(node.classInstance?.name ?? "?");
    this.out.write(" " + (node.name ?? "?") + " {\n");
    node.classInstance?.accept(this, indent + 1);
    this.indent(indent);
    this.out.write("};\n");
  }

  visitIntegerClassInstance(node: ModelicaIntegerClassInstance, indent = 0): void {
    this.indent(indent);
    this.out.write("type Integer\n");
    this.indent(indent + 1);
    this.out.write("IntegerType ⟨value⟩ = ");
    node.expression?.accept(new ModelicaDAEPrinter(this.out));
    this.out.write(";\n");
    if (node.quantity) {
      this.indent(indent + 1);
      this.out.write('parameter StringType quantity = "');
      node.quantity.accept(new ModelicaDAEPrinter(this.out));
      this.out.write('";\n');
    }
    if (node.min) {
      this.indent(indent + 1);
      this.out.write("parameter IntegerType min = ");
      node.min.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.max) {
      this.indent(indent + 1);
      this.out.write("parameter IntegerType max = ");
      node.max.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.start) {
      this.indent(indent + 1);
      this.out.write("parameter IntegerType start = ");
      node.start.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.fixed) {
      this.indent(indent + 1);
      this.out.write("parameter BooleanType fixed = ");
      node.fixed.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }

    this.indent(indent);
    this.out.write("end Integer;\n");
  }

  visitRealClassInstance(node: ModelicaRealClassInstance, indent = 0): void {
    this.indent(indent);
    this.out.write("type Real\n");
    this.indent(indent + 1);
    this.out.write("RealType ⟨value⟩ = ");
    node.expression?.accept(new ModelicaDAEPrinter(this.out));
    this.out.write(";\n");
    if (node.quantity) {
      this.indent(indent + 1);
      this.out.write('parameter StringType quantity = "');
      node.quantity.accept(new ModelicaDAEPrinter(this.out));
      this.out.write('";\n');
    }
    if (node.unit) {
      this.indent(indent + 1);
      this.out.write('parameter StringType unit = "');
      node.unit.accept(new ModelicaDAEPrinter(this.out));
      this.out.write('";\n');
    }
    if (node.displayUnit) {
      this.indent(indent + 1);
      this.out.write('parameter StringType displayUnit = "');
      node.displayUnit.accept(new ModelicaDAEPrinter(this.out));
      this.out.write('";\n');
    }
    if (node.min) {
      this.indent(indent + 1);
      this.out.write("parameter RealType min = ");
      node.min.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.max) {
      this.indent(indent + 1);
      this.out.write("parameter RealType max = ");
      node.max.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.start) {
      this.indent(indent + 1);
      this.out.write("parameter RealType start = ");
      node.start.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.fixed) {
      this.indent(indent + 1);
      this.out.write("parameter BooleanType fixed = ");
      node.fixed.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.nominal) {
      this.indent(indent + 1);
      this.out.write("parameter RealType nominal = ");
      node.nominal.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.unbounded) {
      this.indent(indent + 1);
      this.out.write("parameter BooleanType unbounded = ");
      node.unbounded.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.stateSelect) {
      this.indent(indent + 1);
      this.out.write("parameter StateSelect stateSelect = ");
      node.stateSelect.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    this.indent(indent);
    this.out.write("end Real;\n");
  }

  visitStringClassInstance(node: ModelicaStringClassInstance, indent = 0): void {
    this.indent(indent);
    this.out.write("type String\n");
    this.indent(indent + 1);
    this.out.write("StringType ⟨value⟩ = ");
    node.expression?.accept(new ModelicaDAEPrinter(this.out));
    this.out.write(";\n");
    if (node.quantity) {
      this.indent(indent + 1);
      this.out.write('parameter StringType quantity = "');
      node.quantity.accept(new ModelicaDAEPrinter(this.out));
      this.out.write('";\n');
    }
    if (node.start) {
      this.indent(indent + 1);
      this.out.write("parameter StringType start = ");
      node.start.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    if (node.fixed) {
      this.indent(indent + 1);
      this.out.write("parameter BooleanType fixed = ");
      node.fixed.accept(new ModelicaDAEPrinter(this.out));
      this.out.write(";\n");
    }
    this.indent(indent);
    this.out.write("end String;\n");
  }
}
