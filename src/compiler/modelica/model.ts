// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Writer } from "../../util/io.js";
import logger from "../../util/logger.js";
import { makeWeakRef, makeWeakRefArray } from "../../util/weak.js";
import type { Context } from "../context.js";
import { Scope } from "../scope.js";
import { ANNOTATION } from "./annotation.js";
import { ModelicaDAEPrinter, ModelicaEnumerationLiteral, ModelicaExpression, ModelicaIntegerLiteral } from "./dae.js";
import { ModelicaInterpreter } from "./interpreter.js";
import {
  ModelicaAnnotationClauseSyntaxNode,
  ModelicaClassDefinitionSyntaxNode,
  ModelicaClassKind,
  ModelicaComponentClauseSyntaxNode,
  ModelicaCompoundImportClauseSyntaxNode,
  ModelicaConnectEquationSyntaxNode,
  ModelicaElementModificationSyntaxNode,
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
}

export class ModelicaLibrary extends ModelicaNode {
  #context: WeakRef<Context>;
  entity: ModelicaEntity;
  path: string;

  constructor(context: Context, path: string) {
    super(context);
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
}

export abstract class ModelicaElement extends ModelicaNode {
  static #annotationClassInstance: ModelicaClassInstance | null = null;
  #library: WeakRef<ModelicaLibrary> | null;
  annotations: ModelicaNamedElement[] = [];

  constructor(library: ModelicaLibrary | null, parent: Scope | null) {
    super(parent);
    this.#library = makeWeakRef(library);
  }

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

  static instantiateAnnotations(
    classInstance: ModelicaClassInstance | null,
    annotationClause?: ModelicaAnnotationClauseSyntaxNode | null,
  ): ModelicaNamedElement[] {
    if (!classInstance || !annotationClause) return [];
    if (!ModelicaElement.#annotationClassInstance) {
      const tree = classInstance.library?.context?.getParser(".mo").parse(ANNOTATION);
      const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree?.rootNode)?.classDefinitions?.[0] ?? null;
      if (node) {
        ModelicaElement.#annotationClassInstance = ModelicaClassInstance.new(null, null, node);
        ModelicaElement.#annotationClassInstance.instantiate();
      }
    }
    const annotations: ModelicaNamedElement[] = [];
    const modification = ModelicaModification.new(classInstance, annotationClause);
    for (const modificationArgument of modification.modificationArguments) {
      const annotation = ModelicaElement.#annotationClassInstance?.resolveSimpleName(modificationArgument.name);
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
      }
    }
    return annotations;
  }

  get library(): ModelicaLibrary | null {
    return this.#library?.deref() ?? null;
  }
}

export class ModelicaExtendsClassInstance extends ModelicaElement {
  #abstractSyntaxNode: WeakRef<ModelicaExtendsClauseSyntaxNode> | null;
  #modification: ModelicaModification;
  classInstance: ModelicaClassInstance | null = null;

  constructor(
    library: ModelicaLibrary | null,
    parent: ModelicaClassInstance | null,
    abstractSyntaxNode?: ModelicaExtendsClauseSyntaxNode | null,
  ) {
    super(library, parent);
    this.#abstractSyntaxNode = makeWeakRef(abstractSyntaxNode);
    this.#modification = this.mergeModifications();
  }

  get abstractSyntaxNode(): ModelicaExtendsClauseSyntaxNode | null {
    return this.#abstractSyntaxNode?.deref() ?? null;
  }

  set abstractSyntaxNode(abstractSyntaxNode: ModelicaExtendsClauseSyntaxNode | null) {
    this.#abstractSyntaxNode = makeWeakRef(abstractSyntaxNode);
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
                (m) => m.name === modificationArgumentOrInheritanceModification.identifier?.value,
              ).length > 0
            )
              continue;
            modificationArguments.push(
              ModelicaElementModification.new(this.parent, modificationArgumentOrInheritanceModification),
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
}

export class ModelicaClassInstance extends ModelicaNamedElement {
  #abstractSyntaxNode: WeakRef<ModelicaClassDefinitionSyntaxNode> | null;
  #importClauses: ModelicaImportClauseSyntaxNode[] = [];
  #modification: ModelicaModification | null = null;
  #qualifiedImports = new Map<string, ModelicaClassInstance>();
  #unqualifiedImports: ModelicaClassInstance[] = [];
  classKind: ModelicaClassKind;
  declaredElements: ModelicaElement[] = [];

  constructor(
    library: ModelicaLibrary | null,
    parent: Scope | null,
    abstractSyntaxNode?: ModelicaClassDefinitionSyntaxNode | null,
    modification?: ModelicaModification | null,
  ) {
    super(library, parent);
    this.#abstractSyntaxNode = makeWeakRef(abstractSyntaxNode);
    this.name = this.abstractSyntaxNode?.identifier?.value ?? null;
    this.description =
      this.abstractSyntaxNode?.classSpecifier?.description?.descriptionStrings?.map((d) => d.value)?.join(" ") ?? null;
    this.#modification = modification ?? null;
    this.classKind = abstractSyntaxNode?.classPrefixes?.classKind ?? ModelicaClassKind.CLASS;
  }

  get abstractSyntaxNode(): ModelicaClassDefinitionSyntaxNode | null {
    return this.#abstractSyntaxNode?.deref() ?? null;
  }

  set abstractSyntaxNode(abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | null) {
    this.#abstractSyntaxNode = makeWeakRef(abstractSyntaxNode);
    this.name = this.abstractSyntaxNode?.identifier?.value ?? null;
    this.instantiated = false;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  clone(modification?: ModelicaModification | null): ModelicaClassInstance {
    if (!this.abstractSyntaxNode) throw new Error();
    const mergedModification = ModelicaModification.merge(this.#modification, modification);
    const classInstance = ModelicaClassInstance.new(
      this.library,
      this.parent,
      this.abstractSyntaxNode,
      mergedModification,
    );
    classInstance.instantiate();
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

  get connectEquations(): IterableIterator<ModelicaConnectEquationSyntaxNode> {
    const equations = this.equations;
    return (function* () {
      for (const equation of equations) {
        if (equation instanceof ModelicaConnectEquationSyntaxNode) yield equation;
      }
    })();
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
    let outerModificationArgument: ModelicaModificationArgument | null = null;
    for (const modificationArgument of this.modification?.modificationArguments ?? []) {
      if (modificationArgument.name !== name) continue;
      outerModificationArgument = modificationArgument;
      break;
    }
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
        this.declaredElements.push(
          ModelicaClassInstance.new(
            this.library,
            this,
            elementSyntaxNode,
            this.extractModification(elementSyntaxNode.identifier?.value),
          ),
        );
      } else if (elementSyntaxNode instanceof ModelicaComponentClauseSyntaxNode) {
        for (const componentDeclarationSyntaxNode of elementSyntaxNode.componentDeclarations) {
          this.declaredElements.push(new ModelicaComponentInstance(this.library, this, componentDeclarationSyntaxNode));
        }
      } else if (elementSyntaxNode instanceof ModelicaExtendsClauseSyntaxNode) {
        this.declaredElements.push(new ModelicaExtendsClassInstance(this.library, this, elementSyntaxNode));
      } else if (elementSyntaxNode instanceof ModelicaImportClauseSyntaxNode) {
        this.#importClauses.push(elementSyntaxNode);
      }
    }
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaExtendsClassInstance) element.instantiate();
    }
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaClassInstance) element.instantiate();
    }
    for (const importClause of this.#importClauses) {
      const packageInstance = this.resolveName(importClause.packageName, true);
      if (!(packageInstance instanceof ModelicaClassInstance)) continue;
      if (importClause instanceof ModelicaUnqualifiedImportClauseSyntaxNode) {
        this.#unqualifiedImports.push(packageInstance);
      } else if (importClause instanceof ModelicaSimpleImportClauseSyntaxNode) {
        const shortName = importClause.shortName?.value;
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
      if (element instanceof ModelicaComponentInstance) element.instantiate();
    }
    this.annotations = ModelicaElement.instantiateAnnotations(this, this.abstractSyntaxNode?.annotationClause);
    this.instantiated = true;
  }

  override get modification(): ModelicaModification | null {
    return this.#modification;
  }

  set modification(modification: ModelicaModification) {
    this.#modification = modification;
  }

  get qualifiedImports(): Map<string, ModelicaClassInstance> {
    return this.#qualifiedImports;
  }

  get unqualifiedImports(): ModelicaClassInstance[] {
    return this.#unqualifiedImports;
  }

  static new(
    library: ModelicaLibrary | null,
    parent: Scope | null,
    abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode,
    modification?: ModelicaModification | null,
  ): ModelicaClassInstance {
    if (abstractSyntaxNode?.classSpecifier instanceof ModelicaShortClassSpecifierSyntaxNode) {
      if (abstractSyntaxNode.classSpecifier.enumeration) {
        return new ModelicaEnumerationClassInstance(library, parent, abstractSyntaxNode, modification);
      } else {
        return new ModelicaShortClassInstance(library, parent, abstractSyntaxNode, modification);
      }
    } else if (abstractSyntaxNode?.classSpecifier instanceof ModelicaLongClassSpecifierSyntaxNode) {
      return new ModelicaClassInstance(library, parent, abstractSyntaxNode, modification);
    } else {
      throw new Error();
    }
  }
}

export class ModelicaEnumerationClassInstance extends ModelicaClassInstance {
  enumerationLiterals: ModelicaEnumerationLiteral[] | null;
  value: ModelicaEnumerationLiteral | null;

  constructor(
    library: ModelicaLibrary | null,
    parent: Scope | null,
    abstractSyntaxNode?: ModelicaClassDefinitionSyntaxNode | null,
    modification?: ModelicaModification | null,
    enumerationLiterals?: ModelicaEnumerationLiteral[] | null,
    value?: ModelicaEnumerationLiteral | null,
  ) {
    super(library, parent, abstractSyntaxNode, modification);
    this.enumerationLiterals = enumerationLiterals ?? null;
    this.value = value ?? null;
  }

  override clone(modification?: ModelicaModification | null): ModelicaClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification ?? null);
    const classInstance = new ModelicaEnumerationClassInstance(
      this.library,
      this.parent,
      this.abstractSyntaxNode,
      mergedModification,
      this.enumerationLiterals,
      this.value,
    );
    classInstance.instantiate();
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
        if (enumerationLiteral.identifier?.value) {
          this.enumerationLiterals.push(new ModelicaEnumerationLiteral(i, enumerationLiteral.identifier.value));
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
    const simpleName = identifier?.value;
    if (!simpleName) return null;
    if (!this.instantiated && !this.instantiating) this.instantiate();
    for (const enumerationLiteral of this.enumerationLiterals ?? []) {
      if (enumerationLiteral.stringValue === identifier.value) {
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
    if (!this.classInstance) throw new Error();
    const mergedModification = ModelicaModification.merge(this.modification, modification ?? null);
    return this.classInstance.clone(mergedModification);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const classInstance = this.classInstance;
    return (function* () {
      if (classInstance) {
        yield* classInstance.elements;
      }
    })();
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
          this.library,
          this.parent,
          classInstance,
          arraySubscripts,
          this.modification,
        );
      this.classInstance.instantiate();
    }
    this.instantiated = true;
  }
}

export class ModelicaEntity extends ModelicaClassInstance {
  #storedDefinitionSyntaxNode: WeakRef<ModelicaStoredDefinitionSyntaxNode> | null = null;
  path: string;
  subEntities: ModelicaEntity[] = [];
  unstructured = false;

  constructor(library: ModelicaLibrary, parent: Scope | null, path: string) {
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
      const tree = parser.parse(text, undefined, { bufferSize: text.length * 2 });
      this.#storedDefinitionSyntaxNode = makeWeakRef(ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode));
      this.abstractSyntaxNode = this.storedDefinitionSyntaxNode?.classDefinitions?.[0] ?? null;
    }
  }

  get storedDefinitionSyntaxNode(): ModelicaStoredDefinitionSyntaxNode | null {
    return this.#storedDefinitionSyntaxNode?.deref() ?? null;
  }
}

export class ModelicaComponentInstance extends ModelicaNamedElement {
  #abstractSyntaxNode: WeakRef<ModelicaComponentDeclarationSyntaxNode> | null;
  #modification: ModelicaModification | null = null;
  classInstance: ModelicaClassInstance | null = null;

  constructor(
    library: ModelicaLibrary | null,
    parent: ModelicaClassInstance | null,
    abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | null,
    modification?: ModelicaModification | null,
  ) {
    super(library, parent);
    this.#abstractSyntaxNode = makeWeakRef(abstractSyntaxNode);
    this.name = this.abstractSyntaxNode?.declaration?.identifier?.value ?? null;
    this.description = this.abstractSyntaxNode?.description?.descriptionStrings?.map((d) => d.value)?.join(" ") ?? null;
    this.#modification = modification ?? this.mergeModifications();
  }

  get abstractSyntaxNode(): ModelicaComponentDeclarationSyntaxNode | null {
    return this.#abstractSyntaxNode?.deref() ?? null;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentInstance(this, argument);
  }

  clone(modification?: ModelicaModification | null): ModelicaComponentInstance {
    const componentInstance = new ModelicaComponentInstance(
      this.library,
      this.parent,
      this.abstractSyntaxNode,
      modification,
    );
    componentInstance.instantiate();
    return componentInstance;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const elements = this.classInstance?.elements;
    return (function* () {
      if (elements) yield* elements;
    })();
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
        this.classInstance = new ModelicaArrayClassInstance(
          this.library,
          this,
          element,
          arraySubscripts,
          this.modification,
        );
        this.classInstance.instantiate();
      }
    }
    this.annotations = ModelicaElement.instantiateAnnotations(this.parent, this.abstractSyntaxNode?.annotationClause);
    this.instantiated = true;
  }

  mergeModifications(): ModelicaModification {
    let outerModificationArgument: ModelicaModificationArgument | null = null;
    for (const modificationArgument of this.parent?.modification?.modificationArguments ?? []) {
      if (modificationArgument.name !== this.name) continue;
      outerModificationArgument = modificationArgument;
      break;
    }
    const modificationArguments: ModelicaModificationArgument[] = [];
    if (outerModificationArgument instanceof ModelicaElementModification) {
      modificationArguments.push(...outerModificationArgument.extract());
    }
    const modificationSyntaxNode = this.abstractSyntaxNode?.declaration?.modification;
    for (const modificationArgumentSyntaxNode of modificationSyntaxNode?.classModification?.modificationArguments ??
      []) {
      if (modificationArgumentSyntaxNode instanceof ModelicaElementModificationSyntaxNode) {
        if (modificationArguments.filter((m) => m.name === modificationArgumentSyntaxNode.identifier?.value).length > 0)
          continue;
        modificationArguments.push(ModelicaElementModification.new(this.parent, modificationArgumentSyntaxNode));
      }
    }
    if (outerModificationArgument instanceof ModelicaElementModification) {
      return new ModelicaModification(
        this,
        modificationArguments,
        outerModificationArgument.modificationExpression ?? modificationSyntaxNode?.modificationExpression,
        outerModificationArgument.description,
        outerModificationArgument.expression,
      );
    } else if (outerModificationArgument instanceof ModelicaParameterModification) {
      return new ModelicaModification(this, modificationArguments, null, null, outerModificationArgument.expression);
    }
    return new ModelicaModification(this, modificationArguments, modificationSyntaxNode?.modificationExpression);
  }

  override get modification(): ModelicaModification | null {
    return this.#modification;
  }

  override get parent(): ModelicaClassInstance | null {
    return super.parent as ModelicaClassInstance | null;
  }

  get variability(): ModelicaVariability | null {
    return this.abstractSyntaxNode?.parent?.variability ?? null;
  }
}

export abstract class ModelicaPredefinedClassInstance extends ModelicaClassInstance {
  constructor(
    library: ModelicaLibrary | null,
    parent: Scope | null,
    name: string,
    modification?: ModelicaModification | null,
  ) {
    super(library, parent, null, modification);
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
  constructor(library: ModelicaLibrary | null, parent: Scope | null, modification?: ModelicaModification | null) {
    super(library, parent, "Boolean", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaBooleanClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaBooleanClassInstance(this.library, this.parent, mergedModification);
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
  constructor(library: ModelicaLibrary | null, parent: Scope | null, modification?: ModelicaModification | null) {
    super(library, parent, "Integer", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitIntegerClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaBooleanClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaIntegerClassInstance(this.library, this.parent, mergedModification);
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
  constructor(library: ModelicaLibrary | null, parent: Scope | null, modification?: ModelicaModification | null) {
    super(library, parent, "Real", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitRealClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaBooleanClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaRealClassInstance(this.library, this.parent, mergedModification);
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
  constructor(library: ModelicaLibrary | null, parent: Scope | null, modification?: ModelicaModification | null) {
    super(library, parent, "String", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitStringClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaStringClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaStringClassInstance(this.library, this.parent, mergedModification);
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
    library: ModelicaLibrary | null,
    parent: Scope | null,
    elementClassInstance: ModelicaClassInstance | null,
    arraySubscripts: ModelicaSubscriptSyntaxNode[],
    modification?: ModelicaModification | null,
  ) {
    super(library, parent, elementClassInstance?.abstractSyntaxNode, modification);
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
      this.library,
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

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: array class is already being instantiated");
    this.instantiating = true;
    this.declaredElements = [];
    this.shape = [];
    for (const arraySubscript of this.#arraySubscripts) {
      if (arraySubscript.flexible || !arraySubscript.expression) {
        this.shape.push(-1);
        continue;
      }
      const length = arraySubscript.expression.accept(new ModelicaInterpreter(), this);
      if (length instanceof ModelicaIntegerLiteral) this.shape.push(length.value);
      else this.shape.push(-1);
    }

    let elementClassInstance = this.#elementClassInstance;
    elementClassInstance?.instantiate();
    if (elementClassInstance instanceof ModelicaShortClassInstance) {
      elementClassInstance = elementClassInstance.classInstance;
    } else if (elementClassInstance instanceof ModelicaArrayClassInstance) {
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

    /*
    const expression = this.modification?.expression?.accept(new ModelicaInterpreter(), this);
    if (!expression) {
      this.instantiated = true;
      return;
    }
    if (expression instanceof ModelicaArray) {
      if (!expression.assignable(this.shape)) {
        this.instantiated = true;
        return;
      }
      this.shape = expression.flatShape;
      for (const element of expression.flatElements) {
        if (element instanceof ModelicaObject && element.classInstance) {
          this.declaredElements.push(element.classInstance);
        } else {
          this.declaredElements.push(
            elementClassInstance.clone(new ModelicaModification(this, [], null, null, element)),
          );
        }
      }
    }
    */
    this.instantiated = true;
  }
}

export class ModelicaModification {
  #expression: ModelicaExpression | null;
  scope: ModelicaNode | null;
  description: string | null;
  modificationExpression: ModelicaModificationExpressionSyntaxNode | null;
  modificationArguments: ModelicaModificationArgument[];

  constructor(
    scope: ModelicaNode | null,
    modificationArguments: ModelicaModificationArgument[],
    modificationExpression?: ModelicaModificationExpressionSyntaxNode | null,
    description?: string | null,
    expression?: ModelicaExpression | null,
  ) {
    this.scope = scope;
    this.modificationArguments = modificationArguments;
    this.modificationExpression = modificationExpression ?? null;
    this.description = description ?? null;
    this.#expression = expression ?? null;
  }

  get expression(): ModelicaExpression | null {
    if (this.#expression) return this.#expression;
    this.#expression = this.modificationExpression?.expression?.accept(new ModelicaInterpreter(), this.scope) ?? null;
    return this.#expression;
  }

  getModificationArgument(name: string): ModelicaModificationArgument | null {
    for (const modificationArgument of this.modificationArguments) {
      if (modificationArgument.name === name) return modificationArgument;
    }
    return null;
  }

  static merge(
    modification: ModelicaModification | null | undefined,
    overridingModification: ModelicaModification | null | undefined,
  ): ModelicaModification | null {
    if (modification == null) return overridingModification ?? null;
    else if (overridingModification == null) return modification;
    const mergedModificationArguments: ModelicaModificationArgument[] = [
      ...overridingModification.modificationArguments,
    ];
    for (const modificationArgument of modification.modificationArguments) {
      if (mergedModificationArguments.filter((m) => m.name === modificationArgument.name).length > 0) continue;
      mergedModificationArguments.unshift(modificationArgument);
    }
    return new ModelicaModification(
      overridingModification.scope,
      mergedModificationArguments,
      overridingModification.modificationExpression ?? modification.modificationExpression,
      overridingModification.description ?? modification.description,
      overridingModification.expression ?? modification.expression,
    );
  }

  static new(
    scope: ModelicaNode | null,
    abstractSyntaxNode: ModelicaModificationSyntaxNode | ModelicaAnnotationClauseSyntaxNode | null,
  ): ModelicaModification {
    const modificationArguments: ModelicaModificationArgument[] = [];
    for (const modificationArgumentSyntaxNode of abstractSyntaxNode?.classModification?.modificationArguments ?? []) {
      if (modificationArgumentSyntaxNode instanceof ModelicaElementModificationSyntaxNode) {
        modificationArguments.push(ModelicaElementModification.new(scope, modificationArgumentSyntaxNode));
      }
    }
    if (abstractSyntaxNode instanceof ModelicaAnnotationClauseSyntaxNode)
      return new ModelicaModification(scope, modificationArguments);
    return new ModelicaModification(scope, modificationArguments, abstractSyntaxNode?.modificationExpression);
  }

  split(count: number): ModelicaModification[];
  split(count: number, index: number): ModelicaModification;
  split(count: number, index?: number): ModelicaModification | ModelicaModification[] {
    if (!this.expression) throw new Error();
    if (index) {
      return new ModelicaModification(
        this.scope,
        this.modificationArguments.map((m) => m.split(count, index)),
        this.modificationExpression,
        this.description,
        this.expression.split(count, index),
      );
    } else {
      const modificationArguments = this.modificationArguments.map((m) => m.split(count));
      const expressions = this.expression.split(count);
      const modifications: ModelicaModification[] = [];
      for (let i = 0; i < count; i++) {
        modifications.push(
          new ModelicaModification(
            this.scope,
            modificationArguments.map((m) => m[i]).flatMap((m) => m ?? []),
            this.modificationExpression,
            this.description,
            expressions[i],
          ),
        );
      }
      return modifications;
    }
  }
}

export abstract class ModelicaModificationArgument {
  #scope: ModelicaNode | null;

  constructor(scope: ModelicaNode | null) {
    this.#scope = scope;
  }

  abstract get expression(): ModelicaExpression | null;

  abstract get name(): string | null;

  get scope(): ModelicaNode | null {
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

  constructor(
    scope: ModelicaNode | null,
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

  override get expression(): ModelicaExpression | null {
    if (this.#expression) return this.#expression;
    this.#expression = this.modificationExpression?.expression?.accept(new ModelicaInterpreter(), this.scope) ?? null;
    return this.#expression;
  }

  extract(): ModelicaModificationArgument[] {
    if (this.nameComponents.length > 1)
      return [
        new ModelicaElementModification(
          this.scope,
          this.nameComponents.slice(1),
          this.modificationArguments,
          this.modificationExpression,
          this.description,
        ),
      ];
    else return this.modificationArguments;
  }

  get modificationExpression(): ModelicaModificationExpressionSyntaxNode | null {
    return this.#modificationExpression?.deref() ?? null;
  }

  override get name(): string | null {
    return this.nameComponents[0]?.value ?? null;
  }

  get nameComponents(): ModelicaIdentifierSyntaxNode[] {
    return this.#nameComponents.map((nameComponentRef) => {
      const nameComponent = nameComponentRef.deref();
      if (!nameComponent) throw new Error();
      return nameComponent;
    });
  }

  static new(
    scope: ModelicaNode | null,
    abstractSyntaxNode: ModelicaElementModificationSyntaxNode,
  ): ModelicaElementModification {
    const modificationArguments: ModelicaModificationArgument[] = [];
    for (const modificationArgumentSyntaxNode of abstractSyntaxNode.modification?.classModification
      ?.modificationArguments ?? []) {
      if (modificationArgumentSyntaxNode instanceof ModelicaElementModificationSyntaxNode) {
        modificationArguments.push(ModelicaElementModification.new(scope, modificationArgumentSyntaxNode));
      }
    }
    return new ModelicaElementModification(
      scope,
      abstractSyntaxNode.name?.components ?? [],
      modificationArguments,
      abstractSyntaxNode.modification?.modificationExpression,
      abstractSyntaxNode.description?.descriptionStrings?.map((d) => d.value)?.join(" "),
    );
  }

  override split(count: number): ModelicaElementModification[];
  override split(count: number, index: number): ModelicaElementModification;
  override split(count: number, index?: number): ModelicaElementModification | ModelicaElementModification[] {
    if (!this.expression) throw new Error();
    if (index) {
      return new ModelicaElementModification(
        this.scope,
        this.nameComponents,
        this.modificationArguments.map((m) => m.split(count, index)),
        this.modificationExpression,
        this.description,
        this.expression.split(count, index),
      );
    } else {
      const modificationArguments = this.modificationArguments.map((m) => m.split(count));
      const expressions = this.expression.split(count);
      const modifications = [];
      for (let i = 0; i < count; i++) {
        modifications.push(
          new ModelicaElementModification(
            this.scope,
            this.nameComponents,
            modificationArguments?.[i] ?? [],
            this.modificationExpression,
            this.description,
            expressions[i],
          ),
        );
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
    scope: ModelicaNode | null,
    name: string,
    expressionSyntaxNode?: ModelicaExpressionSyntaxNode | null,
    expression?: ModelicaExpression | null,
  ) {
    super(scope);
    this.#name = name;
    this.#expressionSyntaxNode = makeWeakRef(expressionSyntaxNode);
    this.#expression = expression ?? null;
  }

  override get expression(): ModelicaExpression | null {
    if (this.#expression) return this.#expression;
    this.#expression = this.#expressionSyntaxNode?.deref()?.accept(new ModelicaInterpreter(), this.scope) ?? null;
    return this.#expression;
  }

  get expressionSyntaxNode(): ModelicaExpressionSyntaxNode | null {
    return this.#expressionSyntaxNode?.deref() ?? null;
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
