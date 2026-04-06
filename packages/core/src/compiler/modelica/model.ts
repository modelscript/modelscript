// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/class-literal-property-style */

import { createHash } from "@modelscript/utils";

import {
  ModelicaAlgorithmSectionSyntaxNode,
  ModelicaAnnotationClauseSyntaxNode,
  ModelicaCausality,
  ModelicaClassDefinitionSyntaxNode,
  ModelicaClassKind,
  ModelicaClassModificationSyntaxNode,
  ModelicaComponentClauseSyntaxNode,
  ModelicaComponentDeclaration1SyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaCompoundImportClauseSyntaxNode,
  ModelicaConnectEquationSyntaxNode,
  ModelicaConstrainingClauseSyntaxNode,
  ModelicaElementModificationSyntaxNode,
  ModelicaElementRedeclarationSyntaxNode,
  ModelicaElementSyntaxNode,
  ModelicaEquationSectionSyntaxNode,
  ModelicaEquationSyntaxNode,
  ModelicaExpressionSyntaxNode,
  ModelicaExtendsClauseSyntaxNode,
  ModelicaFlow,
  ModelicaFunctionCallSyntaxNode,
  ModelicaIdentifierSyntaxNode,
  ModelicaImportClauseSyntaxNode,
  ModelicaInheritanceModificationSyntaxNode,
  ModelicaLongClassSpecifierSyntaxNode,
  ModelicaModificationArgumentSyntaxNode,
  ModelicaModificationExpressionSyntaxNode,
  ModelicaModificationSyntaxNode,
  ModelicaShortClassDefinitionSyntaxNode,
  ModelicaShortClassSpecifierSyntaxNode,
  ModelicaSimpleImportClauseSyntaxNode,
  ModelicaStatementSyntaxNode,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaSubscriptSyntaxNode,
  ModelicaUnqualifiedImportClauseSyntaxNode,
  ModelicaVariability,
  ModelicaVisibility,
  type ModelicaComponentDeclarationSyntaxNode,
} from "@modelscript/modelica-ast";
import type { JSONValue, Triple, Writer } from "@modelscript/utils";
import { logger, makeWeakRef, makeWeakRefArray } from "@modelscript/utils";
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
import { ModelicaErrorCode, makeDiagnostic, type ModelicaDiagnostic } from "./errors.js";
import { ModelicaInterpreter } from "./interpreter.js";
import { SCRIPTING } from "./scripting.js";

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

  get toJSON(): JSONValue {
    const json: Record<string, JSONValue> = { "@type": this["@type"] };
    for (const key of Object.getOwnPropertyNames(this)) {
      if (key === "@type" || key.startsWith("_") || key === "parent") continue;
      const value = (this as Record<string, unknown>)[key];
      if (value instanceof ModelicaNode) {
        json[key] = value.toJSON;
      } else if (Array.isArray(value)) {
        json[key] = value.map((v) => (v instanceof ModelicaNode ? v.toJSON : (v as JSONValue)));
      } else if (value instanceof Map) {
        json[key] = Object.fromEntries(
          Array.from(value.entries()).map(([k, v]) => [k, v instanceof ModelicaNode ? v.toJSON : (v as JSONValue)]),
        );
      } else if (!(value instanceof WeakRef)) {
        json[key] = value as JSONValue;
      }
    }
    return json;
  }

  get toRDF(): Triple[] {
    const id = `_:node_${this.hash.substring(0, 8)}`;
    const triples: Triple[] = [{ s: id, p: "rdf:type", o: `modelica:${this["@type"]}` }];
    for (const key of Object.getOwnPropertyNames(this)) {
      if (key === "@type" || key.startsWith("_") || key === "parent") continue;
      const value = (this as Record<string, unknown>)[key];
      if (value instanceof ModelicaNode) {
        const valueId = `_:node_${value.hash.substring(0, 8)}`;
        triples.push({ s: id, p: `modelica:${key}`, o: valueId });
        triples.push(...value.toRDF);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          if (v instanceof ModelicaNode) {
            const vId = `_:node_${v.hash.substring(0, 8)}`;
            triples.push({ s: id, p: `modelica:${key}`, o: vId });
            triples.push(...v.toRDF);
          } else {
            triples.push({ s: id, p: `modelica:${key}`, o: v as string | number | boolean | null });
          }
        }
      } else if (value instanceof Map) {
        for (const [k, v] of value.entries()) {
          if (v instanceof ModelicaNode) {
            const vId = `_:node_${v.hash.substring(0, 8)}`;
            triples.push({ s: id, p: `modelica:${k}`, o: vId });
            triples.push(...v.toRDF);
          } else {
            triples.push({ s: id, p: `modelica:${k}`, o: v as string | number | boolean | null });
          }
        }
      } else if (!(value instanceof WeakRef)) {
        triples.push({ s: id, p: `modelica:${key}`, o: value as string | number | boolean | null });
      }
    }
    return triples;
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

  get hash(): string {
    const hash = createHash("sha256");
    hash.update(this.path);
    return hash.digest("hex");
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
          return (ModelicaExpression.fromClassInstance(annotation)?.toJSON ?? null) as T | null;
        } else if (annotation instanceof ModelicaComponentInstance) {
          return (ModelicaExpression.fromClassInstance(annotation.classInstance)?.toJSON ?? null) as T | null;
        }
      }
    }
    return null;
  }

  static get annotationClassInstance(): ModelicaClassInstance | null {
    return ModelicaElement.#annotationClassInstance;
  }

  static #scriptingClassInstance: ModelicaClassInstance | null = null;

  static get scriptingClassInstance(): ModelicaClassInstance | null {
    return ModelicaElement.#scriptingClassInstance;
  }

  abstract get hash(): string;

  static initializeAnnotationClass(context: Context): void {
    if (ModelicaElement.#annotationClassInstance) return;
    const tree = context.getParser(".mo").parse(ANNOTATION);
    const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree?.rootNode)?.classDefinitions?.[0] ?? null;
    if (node) {
      ModelicaElement.#annotationClassInstance = ModelicaClassInstance.new(null, node);
      ModelicaElement.#annotationClassInstance.instantiate();
    }
  }

  static initializeScriptingClass(context: Context): void {
    if (ModelicaElement.#scriptingClassInstance) return;
    const tree = context.getParser(".mo").parse(SCRIPTING);
    const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree?.rootNode)?.classDefinitions?.[0] ?? null;
    if (node) {
      ModelicaElement.#scriptingClassInstance = ModelicaClassInstance.new(null, node);
      ModelicaElement.#scriptingClassInstance.instantiate();
    }
  }

  static instantiateAnnotations(
    classInstance: ModelicaClassInstance | null,
    annotationClause?: ModelicaAnnotationClauseSyntaxNode | null,
    modificationAnnotations?: ModelicaModification | null,
  ): ModelicaNamedElement[] {
    const clauseModification = annotationClause ? ModelicaModification.new(classInstance, annotationClause) : null;
    const modification = ModelicaModification.merge(clauseModification, modificationAnnotations);
    return ModelicaElement.instantiateAnnotationsFromModification(classInstance, modification);
  }

  /**
   * Instantiate annotations from a pre-merged modification.  This is the
   * core implementation used by both `instantiateAnnotations` (single clause)
   * and the class-level annotation merging path.
   */
  static instantiateAnnotationsFromModification(
    classInstance: ModelicaClassInstance | null,
    modification: ModelicaModification | null | undefined,
  ): ModelicaNamedElement[] {
    if (!ModelicaElement.#annotationClassInstance && classInstance?.context) {
      ModelicaElement.initializeAnnotationClass(classInstance.context);
    }
    if (!classInstance || !modification) return [];
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

  #translateObject(obj: unknown) {
    if (!obj || typeof obj !== "object") return;
    const record = obj as Record<string, unknown>;
    for (const key in record) {
      const val = record[key];
      if (typeof val === "string") {
        record[key] = this.translate(val);
      } else if (typeof val === "object") {
        this.#translateObject(val);
      }
    }
    return;
  }
}

export class ModelicaExtendsClassInstance extends ModelicaElement {
  #abstractSyntaxNode: ModelicaExtendsClauseSyntaxNode | null;
  #modification: ModelicaModification;
  classInstance: ModelicaClassInstance | null = null;

  /** Visibility of the element section containing this extends clause (public/protected). */
  visibility: ModelicaVisibility | null;

  constructor(parent: ModelicaClassInstance | null, abstractSyntaxNode?: ModelicaExtendsClauseSyntaxNode | null) {
    super(parent);
    this.#abstractSyntaxNode = abstractSyntaxNode ?? null;
    this.#modification = this.mergeModifications();
    this.visibility =
      (this.#abstractSyntaxNode?.parent as { visibility?: ModelicaVisibility | null })?.visibility ?? null;
  }

  get abstractSyntaxNode(): ModelicaExtendsClauseSyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  set abstractSyntaxNode(abstractSyntaxNode: ModelicaExtendsClauseSyntaxNode | null) {
    this.#abstractSyntaxNode = abstractSyntaxNode;
    this.instantiated = false;
  }

  get modification(): ModelicaModification {
    return this.#modification;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitExtendsClassInstance(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.classInstance?.elements ?? [][Symbol.iterator]();
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const element = super.resolveSimpleName(identifier, global, encapsulated);
    if (element) return element;
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.classInstance?.resolveSimpleName(identifier, false, true) ?? null;
  }

  get hash(): string {
    const hash = createHash("sha256");
    hash.update("extends");
    hash.update(this.abstractSyntaxNode?.typeSpecifier?.text ?? "");
    hash.update(this.modification?.hash ?? "");
    return hash.digest("hex");
  }

  // Global tracking of extends chains to detect cycles (A extends B extends A)
  static #extendsChain = new Set<string>();

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: class is already being instantiated");
    this.instantiating = true;
    const element = this.parent?.resolveTypeSpecifier(this.abstractSyntaxNode?.typeSpecifier);
    if (element instanceof ModelicaClassInstance) {
      // Detect extends cycles using compositeName (unique per class in the scope tree)
      const baseName = element.compositeName ?? element.name ?? "";
      if (baseName && ModelicaExtendsClassInstance.#extendsChain.has(baseName)) {
        this.parent?.diagnostics.push(
          makeDiagnostic(
            ModelicaErrorCode.EXTENDS_CYCLE,
            this.abstractSyntaxNode?.typeSpecifier,
            this.parent?.name ?? "",
            element.name ?? "",
          ),
        );
      } else {
        if (baseName) ModelicaExtendsClassInstance.#extendsChain.add(baseName);
        try {
          this.classInstance = element.clone(this.#modification);
          // Validate that modification targets exist in the base class.
          // This catches e.g. `extends B(m(x=1))` when `m` was broken in `B`.
          if (this.classInstance && this.#modification) {
            const elementNames = new Set<string>();
            for (const el of this.classInstance.elements) {
              if (el instanceof ModelicaNamedElement && el.name) elementNames.add(el.name);
            }

            const localArgNames = new Set<string>();
            if (this.abstractSyntaxNode?.classOrInheritanceModification != null) {
              for (const arg of this.abstractSyntaxNode.classOrInheritanceModification
                .modificationArgumentOrInheritanceModifications ?? []) {
                if (arg instanceof ModelicaElementModificationSyntaxNode) {
                  if (arg.identifier?.text) localArgNames.add(arg.identifier.text);
                } else if (arg instanceof ModelicaElementRedeclarationSyntaxNode) {
                  const redeclName =
                    arg.componentClause?.componentDeclaration?.declaration?.identifier?.text ??
                    arg.shortClassDefinition?.identifier?.text;
                  if (redeclName) localArgNames.add(redeclName);
                }
              }
            }

            for (const modArg of this.#modification.modificationArguments) {
              if (
                modArg.name &&
                localArgNames.has(modArg.name) &&
                modArg.name !== "annotation" &&
                !elementNames.has(modArg.name)
              ) {
                this.parent?.diagnostics.push(
                  makeDiagnostic(
                    ModelicaErrorCode.MODIFIER_NOT_FOUND,
                    null,
                    modArg.name,
                    this.parent?.name ?? "",
                    element.name ?? "",
                  ),
                );
              }
            }
          }
        } finally {
          if (baseName) ModelicaExtendsClassInstance.#extendsChain.delete(baseName);
        }
      }
    }
    this.annotations = ModelicaElement.instantiateAnnotations(this.parent, this.abstractSyntaxNode?.annotationClause);
    this.instantiated = true;
  }

  mergeModifications(): ModelicaModification {
    const mergedModificationArguments: ModelicaModificationArgument[] = [
      ...(this.parent?.modification?.modificationArguments ?? []),
    ];
    // Collect names from outer (parent) modification so extends args don't override them
    const outerNames = new Set(mergedModificationArguments.map((a) => a.name));
    if (this.abstractSyntaxNode?.classOrInheritanceModification != null) {
      const modificationArguments: ModelicaModificationArgument[] = [];
      for (const modificationArgumentOrInheritanceModification of this.abstractSyntaxNode
        ?.classOrInheritanceModification?.modificationArgumentOrInheritanceModifications ?? []) {
        if (modificationArgumentOrInheritanceModification instanceof ModelicaModificationArgumentSyntaxNode) {
          if (modificationArgumentOrInheritanceModification instanceof ModelicaElementModificationSyntaxNode) {
            const argName = modificationArgumentOrInheritanceModification.identifier?.text;
            if (modificationArguments.filter((m) => m.name === argName).length > 0) continue;
            // Skip extends clause args that conflict with outer (parent) args — outer has priority
            if (argName && outerNames.has(argName)) continue;
            modificationArguments.push(
              ModelicaElementModification.new(this.parent, modificationArgumentOrInheritanceModification),
            );
          } else if (modificationArgumentOrInheritanceModification instanceof ModelicaElementRedeclarationSyntaxNode) {
            // Also skip extends-clause redeclares when they conflict with outer redeclares
            const redeclName =
              modificationArgumentOrInheritanceModification.componentClause?.componentDeclaration?.declaration
                ?.identifier?.text ??
              modificationArgumentOrInheritanceModification.shortClassDefinition?.identifier?.text;
            if (redeclName && outerNames.has(redeclName)) continue;
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
  static #hashing = new Set<ModelicaClassInstance>();
  #hash: string | null = null;
  #abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | ModelicaShortClassDefinitionSyntaxNode | null;
  #importClauses: ModelicaImportClauseSyntaxNode[] = [];
  #modification: ModelicaModification | null = null;
  #qualifiedImports = new Map<string, ModelicaNamedElement>();
  #unqualifiedImports: ModelicaClassInstance[] = [];
  #elementsByName: Map<string, ModelicaNamedElement> | null = null;
  classKind: ModelicaClassKind;
  cloneCache = new Map<string, ModelicaClassInstance>();
  declaredElements: ModelicaElement[] = [];
  diagnostics: ModelicaDiagnostic[] = [];
  /** Virtual components added by connect equations to expandable connectors. */
  virtualComponents = new Map<string, ModelicaComponentInstance>();

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
    if (abstractSyntaxNode?.classSpecifier instanceof ModelicaShortClassSpecifierSyntaxNode) {
      const localMod = ModelicaModification.new(parent, abstractSyntaxNode.classSpecifier?.classModification ?? null);
      this.#modification = ModelicaModification.merge(localMod, modification);
    } else {
      this.#modification = modification ?? null;
    }
    this.classKind = abstractSyntaxNode?.classPrefixes?.classKind ?? ModelicaClassKind.CLASS;
  }

  /** True if this class instance is an expandable connector. */
  get isExpandable(): boolean {
    return this.classKind === ModelicaClassKind.EXPANDABLE_CONNECTOR;
  }

  get algorithmSections(): IterableIterator<ModelicaAlgorithmSectionSyntaxNode> {
    const extendsClassInstances = this.extendsClassInstances;
    const abstractSyntaxNode = this.abstractSyntaxNode;
    return (function* () {
      for (const extendsClassInstance of extendsClassInstances) {
        for (const section of extendsClassInstance.classInstance?.abstractSyntaxNode?.sections ?? [])
          if (section instanceof ModelicaAlgorithmSectionSyntaxNode) yield section;
      }
      for (const section of abstractSyntaxNode?.sections ?? []) {
        if (section instanceof ModelicaAlgorithmSectionSyntaxNode) yield section;
      }
    })();
  }

  get algorithms(): IterableIterator<ModelicaStatementSyntaxNode> {
    const algorithmSections = this.algorithmSections;
    return (function* () {
      for (const algorithmSection of algorithmSections) {
        yield* algorithmSection.statements;
      }
    })();
  }

  get abstractSyntaxNode(): ModelicaClassDefinitionSyntaxNode | ModelicaShortClassDefinitionSyntaxNode | null {
    return this.#abstractSyntaxNode;
  }

  set abstractSyntaxNode(abstractSyntaxNode: ModelicaClassDefinitionSyntaxNode | null) {
    this.#abstractSyntaxNode = abstractSyntaxNode;
    this.name = this.abstractSyntaxNode?.identifier?.text ?? null;
    this.description =
      this.abstractSyntaxNode?.classSpecifier?.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;
    this.classKind = abstractSyntaxNode?.classPrefixes?.classKind ?? ModelicaClassKind.CLASS;
    this.instantiated = false;
    this.cloneCache.clear();
    this.#hash = null;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  clone(modification?: ModelicaModification | null): ModelicaClassInstance {
    if (!this.abstractSyntaxNode) {
      if (!modification) return this;
      throw new Error(`Cannot clone class instance ${this.name} without abstract syntax node`);
    }
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
        if (element instanceof ModelicaComponentInstance) {
          yield element;
        }
      }
    })();
  }

  get compositeName(): string {
    if (this.parent instanceof ModelicaClassInstance) {
      return `${this.parent.compositeName}.${this.name}`;
    }
    const storedDefinition = this.abstractSyntaxNode?.parent;
    if (storedDefinition instanceof ModelicaStoredDefinitionSyntaxNode) {
      const within = storedDefinition.withinDirective?.packageName;
      if (within) {
        return `${within.parts.map((p) => p.text).join(".")}.${this.name}`;
      }
    }
    return this.name ?? "";
  }

  get connectEquations(): IterableIterator<ModelicaConnectEquationSyntaxNode> {
    const equations = this.equations;
    return (function* () {
      for (const equation of equations) {
        if (equation instanceof ModelicaConnectEquationSyntaxNode) yield equation;
      }
    })();
  }

  override getNamedElement(name: string): ModelicaNamedElement | null {
    if (!this.instantiated && !this.instantiating) this.instantiate();

    // If we're still instantiating, fallback to linear scan because the list is changing
    if (this.instantiating && !this.instantiated) {
      for (const element of this.elements) {
        if (element instanceof ModelicaNamedElement && element.name === name) return element;
      }
      return null;
    }

    if (!this.#elementsByName) {
      this.#elementsByName = new Map();
      for (const element of this.elements) {
        if (element instanceof ModelicaNamedElement && element.name) {
          if (!this.#elementsByName.has(element.name)) {
            this.#elementsByName.set(element.name, element);
          }
        }
      }
    }
    return this.#elementsByName.get(name) ?? null;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (function* () {
      const visited = new Set<ModelicaClassInstance>([self]);

      // Collect names of body-level redeclare elements.
      // These replace inherited components from extends and should be filtered.
      const redeclaredNames = new Set<string>();
      for (const element of self.declaredElements) {
        if (element instanceof ModelicaComponentInstance) {
          const componentClause = element.abstractSyntaxNode?.parent as { redeclare?: boolean } | null;
          if (componentClause?.redeclare && element.name) {
            redeclaredNames.add(element.name);
          }
        } else if (element instanceof ModelicaClassInstance) {
          const astNode = element.abstractSyntaxNode;
          if (astNode instanceof ModelicaClassDefinitionSyntaxNode && astNode.redeclare && element.name) {
            redeclaredNames.add(element.name);
          }
        }
      }

      // Collect names of components removed via `break` in extends clauses.
      const brokenNames = new Set<string>();
      for (const element of self.declaredElements) {
        if (element instanceof ModelicaExtendsClassInstance) {
          const modEntries =
            element.abstractSyntaxNode?.classOrInheritanceModification
              ?.modificationArgumentOrInheritanceModifications ?? [];
          for (const entry of modEntries) {
            if (entry instanceof ModelicaInheritanceModificationSyntaxNode && entry.identifier?.text) {
              brokenNames.add(entry.identifier.text);
            }
          }
        }
      }

      // First pass through extends: collect inherited properties for redeclared names
      const inheritedProps = new Map<
        string,
        {
          variability: ModelicaVariability | null;
          causality: ModelicaCausality | null;
          conditionAttribute: { condition?: ModelicaExpressionSyntaxNode | null } | null;
          conditionScope: Scope | null;
          constrainingClause: ModelicaConstrainingClauseSyntaxNode | null;
        }
      >();
      if (redeclaredNames.size > 0) {
        for (const element of self.declaredElements) {
          if (element instanceof ModelicaExtendsClassInstance) {
            if (!element.instantiated && !element.instantiating) element.instantiate();
            const baseClass = element.classInstance;
            if (baseClass) {
              for (const inheritedElement of baseClass.elements) {
                if (
                  inheritedElement instanceof ModelicaComponentInstance &&
                  inheritedElement.name &&
                  redeclaredNames.has(inheritedElement.name)
                ) {
                  const condAttr =
                    (
                      inheritedElement.abstractSyntaxNode as {
                        conditionAttribute?: { condition?: ModelicaExpressionSyntaxNode | null } | null;
                      } | null
                    )?.conditionAttribute ?? null;
                  // Capture constraining clause from the original replaceable component
                  const ccClause =
                    (
                      inheritedElement.abstractSyntaxNode?.parent as {
                        constrainingClause?: ModelicaConstrainingClauseSyntaxNode | null;
                      }
                    )?.constrainingClause ?? null;
                  inheritedProps.set(inheritedElement.name, {
                    variability: inheritedElement.variability,
                    causality: inheritedElement.causality,
                    conditionAttribute: condAttr,
                    conditionScope: inheritedElement.parent,
                    constrainingClause: ccClause,
                  });
                }
              }
            }
          }
        }
      }

      // Yield elements in declaration order, inlining extends at their position
      for (const element of self.declaredElements) {
        if (element instanceof ModelicaExtendsClassInstance) {
          // Don't lazily instantiate extends clauses here — they are eagerly
          // instantiated in ModelicaClassInstance.instantiate() (line ~1261).
          // Triggering instantiation here causes re-entrant resolveSimpleName
          // calls that hit the scope resolution guard and silently fail,
          // dropping inherited elements (e.g., ConditionalHeatPort.T_heatPort).
          const baseClass = element.classInstance;
          if (baseClass && !visited.has(baseClass)) {
            visited.add(baseClass);
            // Filter out elements that have been redeclared in the body
            for (const inheritedElement of baseClass.elements) {
              if (
                inheritedElement instanceof ModelicaNamedElement &&
                inheritedElement.name &&
                (redeclaredNames.has(inheritedElement.name) || brokenNames.has(inheritedElement.name))
              ) {
                continue; // Skip — redeclared in the body or removed via `break`
              }
              yield inheritedElement;
            }
          }
        } else {
          // For body-level redeclare elements, inherit variability/causality from the replaced component
          if (element instanceof ModelicaComponentInstance && element.name && redeclaredNames.has(element.name)) {
            const inherited = inheritedProps.get(element.name);
            if (inherited) {
              if (!element.variability && inherited.variability) {
                element.variability = inherited.variability;
              }
              if (!element.causality && inherited.causality) {
                element.causality = inherited.causality;
              }
              // Carry constraining clause from original replaceable to redeclared component
              // If the redeclare has its own constrainedby, use that instead
              if (inherited.constrainingClause && !element.constrainingModificationArgs) {
                element.constrainingModificationArgs = ModelicaComponentInstance.extractConstrainingArgs(
                  inherited.constrainingClause,
                  element.parent,
                );
              }
              // Carry over 'if false' condition: if the inherited component had a conditional
              // that evaluates to false, skip the redeclared component too
              if (inherited.conditionAttribute?.condition) {
                const interp = new ModelicaInterpreter();
                // Evaluate condition in the inherited component's scope, not the body-level redeclare's scope
                const condValue = inherited.conditionAttribute.condition.accept(
                  interp,
                  inherited.conditionScope ?? element.parent ?? undefined,
                );
                if (
                  condValue != null &&
                  typeof (condValue as unknown as { value?: unknown }).value === "boolean" &&
                  !(condValue as unknown as { value: boolean }).value
                ) {
                  continue; // Skip — conditional is false
                }
              }
            }
          }
          yield element;
        }
      }

      // For `redeclare function extends <name>`, yield inherited elements from the
      // base class in the parent's extends chain. This handles implicit inheritance
      // of parameters like input/output from the original replaceable function.
      const hasExtends =
        self.abstractSyntaxNode?.classSpecifier instanceof ModelicaLongClassSpecifierSyntaxNode &&
        self.abstractSyntaxNode.classSpecifier.extends;
      if (hasExtends && self.name && self.parent instanceof ModelicaClassInstance) {
        // Collect names of elements already declared locally
        const localNames = new Set<string>();
        for (const element of self.declaredElements) {
          if (element instanceof ModelicaNamedElement && element.name) {
            localNames.add(element.name);
          }
        }
        // Find the original base function from the parent's extends chain.
        // We re-resolve the extends type specifier to get the ORIGINAL (unmodified)
        // base class, because ext.classInstance is a clone with body-level
        // redeclare modifications applied (which replace the original function).
        for (const ext of self.parent.extendsClassInstances) {
          // Re-resolve to get the unmodified base class
          const originalBase = self.parent.resolveTypeSpecifier(ext.abstractSyntaxNode?.typeSpecifier);
          if (!(originalBase instanceof ModelicaClassInstance)) continue;
          if (!originalBase.instantiated && !originalBase.instantiating) originalBase.instantiate();
          for (const baseElement of originalBase.declaredElements) {
            if (
              baseElement instanceof ModelicaClassInstance &&
              baseElement.name === self.name &&
              !visited.has(baseElement)
            ) {
              visited.add(baseElement);
              for (const inheritedElement of baseElement.elements) {
                if (
                  inheritedElement instanceof ModelicaNamedElement &&
                  inheritedElement.name &&
                  localNames.has(inheritedElement.name)
                ) {
                  continue;
                }
                yield inheritedElement;
              }
              break;
            }
          }
        }
      }

      // Yield virtual components added to expandable connectors by connect equations
      for (const [, vComp] of self.virtualComponents) {
        yield vComp;
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

  get initialEquationSections(): IterableIterator<ModelicaEquationSectionSyntaxNode> {
    const extendsClassInstances = this.extendsClassInstances;
    const abstractSyntaxNode = this.abstractSyntaxNode;
    return (function* () {
      for (const extendsClassInstance of extendsClassInstances) {
        for (const section of extendsClassInstance.classInstance?.abstractSyntaxNode?.sections ?? [])
          if (section instanceof ModelicaEquationSectionSyntaxNode && section.initial) yield section;
      }
      for (const section of abstractSyntaxNode?.sections ?? []) {
        if (section instanceof ModelicaEquationSectionSyntaxNode && section.initial) yield section;
      }
    })();
  }

  get initialEquations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const initialEquationSections = this.initialEquationSections;
    return (function* () {
      for (const equationSection of initialEquationSections) {
        yield* equationSection.equations;
      }
    })();
  }

  get initialAlgorithmSections(): IterableIterator<ModelicaAlgorithmSectionSyntaxNode> {
    const extendsClassInstances = this.extendsClassInstances;
    const abstractSyntaxNode = this.abstractSyntaxNode;
    return (function* () {
      for (const extendsClassInstance of extendsClassInstances) {
        for (const section of extendsClassInstance.classInstance?.abstractSyntaxNode?.sections ?? [])
          if (section instanceof ModelicaAlgorithmSectionSyntaxNode && section.initial) yield section;
      }
      for (const section of abstractSyntaxNode?.sections ?? []) {
        if (section instanceof ModelicaAlgorithmSectionSyntaxNode && section.initial) yield section;
      }
    })();
  }

  get initialAlgorithms(): IterableIterator<ModelicaStatementSyntaxNode> {
    const initialAlgorithmSections = this.initialAlgorithmSections;
    return (function* () {
      for (const algorithmSection of initialAlgorithmSections) {
        yield* algorithmSection.statements;
      }
    })();
  }

  get extendsClassInstances(): IterableIterator<ModelicaExtendsClassInstance> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
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
        outerModificationArgument.scope ?? this,
        modificationArguments,
        outerModificationArgument.modificationExpression,
        outerModificationArgument.description,
        outerModificationArgument.expression,
      );
    } else if (outerModificationArgument instanceof ModelicaParameterModification) {
      return new ModelicaModification(
        outerModificationArgument.scope ?? this,
        modificationArguments,
        null,
        null,
        outerModificationArgument.expression,
      );
    }
    return new ModelicaModification(this, modificationArguments);
  }

  get hash(): string {
    if (this.#hash) return this.#hash;
    if (ModelicaClassInstance.#hashing.has(this)) return "";
    ModelicaClassInstance.#hashing.add(this);
    try {
      const hash = createHash("sha256");
      hash.update(this.name ?? "");
      hash.update(this.classKind.toString());
      hash.update(this.modification?.hash ?? "");
      for (const declaredElement of this.declaredElements) {
        hash.update(declaredElement.hash);
      }
      const digest = hash.digest("hex");
      this.#hash = digest;
      return digest;
    } finally {
      ModelicaClassInstance.#hashing.delete(this);
    }
  }

  get inputParameters(): IterableIterator<ModelicaComponentInstance> {
    const classKind = this.classKind;
    const components = this.components;
    return (function* () {
      for (const component of components) {
        if (component.causality === ModelicaCausality.INPUT || classKind === ModelicaClassKind.RECORD) yield component;
      }
    })();
  }

  override instantiate(): void {
    logger.debug("Instantiating class: " + this.name);
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: class is already being instantiated");
    this.instantiating = true;
    this.declaredElements = [];
    this.#elementsByName = null;
    this.#importClauses = [];
    this.#qualifiedImports = new Map<string, ModelicaNamedElement>();
    this.#unqualifiedImports = [];

    // Pre-scan AST body for element-level redeclare class/component definitions.
    // Augment this.modification so ExtendsClassInstance.mergeModifications() includes them,
    // allowing inherited components to resolve redeclared types and components.
    const bodyRedeclareArgs: ModelicaModificationArgument[] = [];
    for (const elementSyntaxNode of this.abstractSyntaxNode?.elements ?? []) {
      if (elementSyntaxNode instanceof ModelicaClassDefinitionSyntaxNode && elementSyntaxNode.redeclare) {
        const className = elementSyntaxNode.identifier?.text;
        if (className) {
          // Create a synthetic class redeclare modification argument
          const classInstance = ModelicaClassInstance.new(this, elementSyntaxNode, null);
          bodyRedeclareArgs.push({
            name: className,
            scope: this,
            each: false,
            final: false,
            get expression(): ModelicaExpression | null {
              return null;
            },
            get hash(): string {
              return `body-redeclare-class-${className}`;
            },
            get abstractSyntaxNode(): ModelicaElementRedeclarationSyntaxNode {
              return null as unknown as ModelicaElementRedeclarationSyntaxNode;
            },
            classInstance,
            split: () => [],
          } as unknown as ModelicaClassRedeclaration);
        }
      } else if (elementSyntaxNode instanceof ModelicaComponentClauseSyntaxNode && elementSyntaxNode.redeclare) {
        for (const componentDecl of elementSyntaxNode.componentDeclarations) {
          const compName = componentDecl.declaration?.identifier?.text;
          if (compName) {
            const compInstance = new ModelicaComponentInstance(this, componentDecl);
            bodyRedeclareArgs.push({
              name: compName,
              scope: this,
              each: false,
              final: false,
              get expression(): ModelicaExpression | null {
                return null;
              },
              get hash(): string {
                return `body-redeclare-comp-${compName}`;
              },
              get abstractSyntaxNode(): ModelicaElementRedeclarationSyntaxNode {
                return null as unknown as ModelicaElementRedeclarationSyntaxNode;
              },
              componentInstance: compInstance,
              split: () => [],
            } as unknown as ModelicaComponentRedeclaration);
          }
        }
      }
    }
    if (bodyRedeclareArgs.length > 0) {
      const existingArgs = this.modification?.modificationArguments ?? [];
      const existingNames = new Set(existingArgs.map((a) => a.name));
      // Only add body-level redeclares that aren't already in an outer modification
      const newArgs = bodyRedeclareArgs.filter((a) => !existingNames.has(a.name));
      if (newArgs.length > 0) {
        this.#modification = new ModelicaModification(
          this,
          [...existingArgs, ...newArgs],
          this.#modification?.modificationExpression ?? null,
          this.#modification?.description ?? null,
          this.#modification?.expression ?? null,
        );
      }
    }

    for (const elementSyntaxNode of this.abstractSyntaxNode?.elements ?? []) {
      if (elementSyntaxNode instanceof ModelicaClassDefinitionSyntaxNode) {
        const redeclaration = this.modification?.getModificationArgument(elementSyntaxNode.identifier?.text);
        const redeclareClassInstance = (redeclaration as { classInstance?: ModelicaClassInstance | null } | null)
          ?.classInstance;
        if (redeclareClassInstance) {
          this.declaredElements.push(redeclareClassInstance);
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
            // Merge original declaration's modifiers onto the redeclared component
            const originalModSyntax = componentDeclarationSyntaxNode.declaration?.modification;
            if (originalModSyntax?.classModification || originalModSyntax?.modificationExpression) {
              // Extract modification arguments from the original replaceable declaration
              const originalArgs: ModelicaModificationArgument[] = [];
              for (const arg of originalModSyntax.classModification?.modificationArguments ?? []) {
                if (arg instanceof ModelicaElementModificationSyntaxNode) {
                  originalArgs.push(ModelicaElementModification.new(this, arg));
                } else if (arg instanceof ModelicaElementRedeclarationSyntaxNode) {
                  originalArgs.push(ModelicaElementRedeclaration.new(this, arg));
                }
              }
              // Get existing modification from redeclared component, then merge
              const redeclaredMod = redeclaration.componentInstance.modification;
              const mergedArgs = [...(redeclaredMod?.modificationArguments ?? [])];
              // Resolve the redeclared type to filter incompatible modifiers
              // When a component is redeclared with a different type (e.g., Resistor → Capacitor),
              // modifiers from the original type (e.g., R=100) should not be merged if the new type
              // doesn't have those elements.
              const redeclaredTypeSpecifier = redeclaration.componentInstance.abstractSyntaxNode?.parent?.typeSpecifier;
              const redeclaredType = redeclaredTypeSpecifier
                ? this.resolveTypeSpecifier(redeclaredTypeSpecifier)
                : null;
              const redeclaredTypeElementNames = new Set<string>();
              if (redeclaredType instanceof ModelicaClassInstance) {
                for (const el of redeclaredType.elements) {
                  if (el instanceof ModelicaNamedElement && el.name) {
                    redeclaredTypeElementNames.add(el.name);
                  }
                }
              }
              // Add original args that don't conflict with redeclare's own args
              // and that exist in the redeclared type (when the type could be resolved)
              const redeclaredNames = new Set(mergedArgs.map((a) => a.name));
              for (const origArg of originalArgs) {
                if (
                  !redeclaredNames.has(origArg.name) &&
                  (redeclaredTypeElementNames.size === 0 || redeclaredTypeElementNames.has(origArg.name ?? ""))
                ) {
                  mergedArgs.push(origArg);
                }
              }
              // Merge constraining clause modifiers as lowest-priority defaults (recursive)
              if (elementSyntaxNode.constrainingClause) {
                const ccArgs = ModelicaComponentInstance.extractConstrainingArgs(
                  elementSyntaxNode.constrainingClause,
                  this,
                );
                ModelicaComponentInstance.mergeArgsRecursively(mergedArgs, ccArgs);
              }
              // Determine binding expression: redeclare's wins, else original's
              const bindingExpr =
                redeclaredMod?.expression ??
                originalModSyntax?.modificationExpression?.expression?.accept(new ModelicaInterpreter(), this) ??
                null;
              const mergedMod = new ModelicaModification(this, mergedArgs, null, null, bindingExpr);
              // Create a new component instance with the merged modification
              const mergedComponent = new ModelicaComponentInstance(
                this,
                redeclaration.componentInstance.abstractSyntaxNode,
                mergedMod,
              );
              // Propagate final from redeclaration and variability from original
              if (redeclaration.final) mergedComponent.isFinal = true;
              if (!mergedComponent.variability && elementSyntaxNode.variability) {
                mergedComponent.variability = elementSyntaxNode.variability;
              }
              this.declaredElements.push(mergedComponent);
            } else {
              const comp = redeclaration.componentInstance;
              // Propagate final from redeclaration and variability from original
              if (redeclaration.final) comp.isFinal = true;
              if (!comp.variability && elementSyntaxNode.variability) {
                comp.variability = elementSyntaxNode.variability;
              }
              // Carry constraining clause from original replaceable to redeclared component
              // Merge recursively into existing modification since mergeModifications() already ran
              if (elementSyntaxNode.constrainingClause) {
                const ccArgs = ModelicaComponentInstance.extractConstrainingArgs(
                  elementSyntaxNode.constrainingClause,
                  this,
                );
                const mod = comp.modification;
                if (mod) {
                  ModelicaComponentInstance.mergeArgsRecursively(mod.modificationArguments, ccArgs);
                }
              }
              this.declaredElements.push(comp);
            }
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
      if (!(packageInstance instanceof ModelicaClassInstance || packageInstance instanceof ModelicaComponentInstance))
        continue;
      if (importClause instanceof ModelicaUnqualifiedImportClauseSyntaxNode) {
        if (packageInstance instanceof ModelicaClassInstance) {
          this.#unqualifiedImports.push(packageInstance);
        }
      } else if (importClause instanceof ModelicaSimpleImportClauseSyntaxNode) {
        const shortName = importClause.shortName?.text;
        const name = shortName == null ? packageInstance.name : shortName;
        if (name) this.#qualifiedImports.set(name, packageInstance);
      } else if (importClause instanceof ModelicaCompoundImportClauseSyntaxNode) {
        for (const importName of importClause.importNames) {
          const qualifiedImport = packageInstance.resolveSimpleName(importName);
          if (
            qualifiedImport instanceof ModelicaClassInstance ||
            qualifiedImport instanceof ModelicaComponentInstance
          ) {
            if (qualifiedImport.name) this.#qualifiedImports.set(qualifiedImport.name, qualifiedImport);
          }
        }
      }
    }
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaExtendsClassInstance) element.instantiate();
    }
    // Collect and merge all class-level annotation clauses.
    // The LongClassSpecifier's classAnnotationClauses getter dynamically
    // yields annotations from ElementAnnotation entries, section-level
    // annotationClauses, and the specifier's own annotationClause.
    const specifier = this.abstractSyntaxNode?.classSpecifier;
    let mergedAnnotationMod: ModelicaModification | null = null;
    if (specifier instanceof ModelicaLongClassSpecifierSyntaxNode) {
      for (const clause of specifier.classAnnotationClauses) {
        mergedAnnotationMod = ModelicaModification.merge(mergedAnnotationMod, ModelicaModification.new(this, clause));
      }
    } else if (this.abstractSyntaxNode?.annotationClause) {
      mergedAnnotationMod = ModelicaModification.new(this, this.abstractSyntaxNode.annotationClause);
    }
    mergedAnnotationMod = ModelicaModification.merge(mergedAnnotationMod, this.modification?.annotations ?? null);
    this.annotations = ModelicaElement.instantiateAnnotationsFromModification(this, mergedAnnotationMod);
    this.description =
      this.abstractSyntaxNode?.classSpecifier?.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;
    this.instantiated = true;
  }

  override get modification(): ModelicaModification | null {
    return this.#modification;
  }

  set modification(modification: ModelicaModification) {
    this.#modification = modification;
    this.#hash = null;
  }

  get isEnumeration(): boolean {
    const classSpecifier = this.abstractSyntaxNode?.classSpecifier;
    return classSpecifier instanceof ModelicaShortClassSpecifierSyntaxNode && classSpecifier.enumeration;
  }

  /**
   * Check if `this` class is type-compatible with `other` per Modelica §6.4.
   *
   * A is type-compatible with B if:
   * - Both are the same predefined type (Real, Integer, Boolean, String)
   *   - Special: Integer is type-compatible with Real (implicit coercion §10.6.13)
   * - Both are the same enumeration type (by qualified name)
   * - Both are arrays with compatible element types and matching shape
   * - For compound types: every public component of `other` exists in `this`
   *   with a recursively type-compatible type, matching variability, causality, and flow prefix.
   *
   * @param other - The class instance to check compatibility against.
   * @param visited - Internal set to guard against infinite recursion.
   * @returns true if `this` is type-compatible with `other`.
   */
  isTypeCompatibleWith(other: ModelicaClassInstance, visited = new Set<string>()): boolean {
    // Same instance — trivially compatible
    if (this === other) return true;

    // Guard against infinite recursion
    const key = `${this.compositeName}:${other.compositeName}`;
    if (visited.has(key)) return true; // assume compatible for recursive types
    visited.add(key);

    // Predefined type checks
    if (this instanceof ModelicaPredefinedClassInstance || other instanceof ModelicaPredefinedClassInstance) {
      // Expression predefined type accepts any source expression
      if (this.name === "Expression") return true;
      // Same predefined type
      if (this.name === other.name) return true;
      // Integer → Real coercion (§10.6.13)
      if (this.name === "Real" && other.name === "Integer") return true;
      return false;
    }

    // Enumeration checks — must be same enumeration (by qualified name)
    if (this instanceof ModelicaEnumerationClassInstance || other instanceof ModelicaEnumerationClassInstance) {
      if (!(this instanceof ModelicaEnumerationClassInstance) || !(other instanceof ModelicaEnumerationClassInstance)) {
        return false;
      }
      return this.compositeName === other.compositeName;
    }

    // Array checks — element types must be compatible, same shape
    if (this instanceof ModelicaArrayClassInstance || other instanceof ModelicaArrayClassInstance) {
      if (!(this instanceof ModelicaArrayClassInstance) || !(other instanceof ModelicaArrayClassInstance)) {
        return false;
      }
      // Shape must match
      if (this.shape.length !== other.shape.length) return false;
      for (let i = 0; i < this.shape.length; i++) {
        if (this.shape[i] !== other.shape[i]) return false;
      }
      // Element types must be compatible
      const thisElem = this.elementClassInstance;
      const otherElem = other.elementClassInstance;
      if (!thisElem || !otherElem) return thisElem === otherElem;
      return thisElem.isTypeCompatibleWith(otherElem, visited);
    }

    // Compound type: every public component in `other` must exist in `this`
    // with matching name, compatible type, and matching prefixes
    if (!this.instantiated && !this.instantiating) this.instantiate();
    if (!other.instantiated && !other.instantiating) other.instantiate();

    const thisComponents = new Map<string, ModelicaComponentInstance>();
    for (const comp of this.components) {
      if (comp.name) thisComponents.set(comp.name, comp);
    }

    for (const otherComp of other.components) {
      if (!otherComp.name) continue;
      // Skip protected components — type compatibility only applies to public interface
      if (otherComp.isProtected) continue;

      const thisComp = thisComponents.get(otherComp.name);
      if (!thisComp) return false; // missing component

      // Variability must match
      if (thisComp.variability !== otherComp.variability) return false;

      // Causality must match
      if (thisComp.causality !== otherComp.causality) return false;

      // Flow prefix must match
      if (thisComp.flowPrefix !== otherComp.flowPrefix) return false;

      // Recursively check component types
      if (!thisComp.instantiated) thisComp.instantiate();
      if (!otherComp.instantiated) otherComp.instantiate();
      const thisType = thisComp.classInstance;
      const otherType = otherComp.classInstance;
      if (thisType && otherType) {
        if (!thisType.isTypeCompatibleWith(otherType, visited)) return false;
      } else if (thisType !== otherType) {
        // One is null, the other isn't
        return false;
      }
    }

    return true;
  }

  /**
   * Check if `this` class is plug-compatible with `other` per Modelica §6.5.
   *
   * Plug compatibility is stricter than type compatibility:
   * - `this` must be type-compatible with `other`
   * - `this` must have no extra public components that `other` doesn't have
   *   (exact public component set match)
   *
   * Used for connect() equations where connectors must be plug-compatible.
   *
   * @param other - The class instance to check compatibility against.
   * @returns true if `this` is plug-compatible with `other`.
   */
  isPlugCompatibleWith(other: ModelicaClassInstance): boolean {
    const visited = new Set<string>();
    // Expandable connectors are plug-compatible with any connector
    if (this.isExpandable || other.isExpandable) return true;

    // Must be type-compatible first
    if (!this.isTypeCompatibleWith(other, visited)) return false;

    // For predefined types, enumerations, and arrays: type compatibility is sufficient
    if (
      this instanceof ModelicaPredefinedClassInstance ||
      this instanceof ModelicaEnumerationClassInstance ||
      this instanceof ModelicaArrayClassInstance
    ) {
      return true;
    }

    // Plug compatibility: `this` must have no extra public components
    if (!this.instantiated && !this.instantiating) this.instantiate();
    if (!other.instantiated && !other.instantiating) other.instantiate();

    const otherComponentNames = new Set<string>();
    for (const comp of other.components) {
      if (comp.name && !comp.isProtected) otherComponentNames.add(comp.name);
    }

    for (const comp of this.components) {
      if (comp.name && !comp.isProtected && !otherComponentNames.has(comp.name)) {
        return false; // extra component in `this`
      }
    }

    return true;
  }

  get outputParameters(): IterableIterator<ModelicaComponentInstance> {
    const components = this.components;
    return (function* () {
      for (const component of components) {
        if (component.causality === ModelicaCausality.OUTPUT) yield component;
      }
    })();
  }

  /** Check if a named element originates from a `protected extends` clause. */
  isProtectedElement(name: string | null): boolean {
    if (!name) return false;
    if (!this.instantiated && !this.instantiating) this.instantiate();
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaExtendsClassInstance) {
        if (element.visibility === ModelicaVisibility.PROTECTED && element.classInstance) {
          for (const el of element.classInstance.elements) {
            if (el instanceof ModelicaComponentInstance && el.name === name) return true;
          }
        }
      }
    }
    return false;
  }

  /** Check if a named element has been removed via the `break` modifier in an extends clause. */
  isBrokenElement(name: string | null): boolean {
    if (!name) return false;
    if (!this.instantiated && !this.instantiating) this.instantiate();
    for (const element of this.declaredElements) {
      if (element instanceof ModelicaExtendsClassInstance) {
        const modEntries =
          element.abstractSyntaxNode?.classOrInheritanceModification?.modificationArgumentOrInheritanceModifications ??
          [];
        for (const entry of modEntries) {
          if (entry instanceof ModelicaInheritanceModificationSyntaxNode && entry.identifier?.text === name) {
            return true;
          }
        }
      }
    }
    return false;
  }

  get qualifiedImports(): Map<string, ModelicaNamedElement> {
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
    classInstance.name = this.name;
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

    const modValue = this.modification?.expression;
    if (modValue instanceof ModelicaEnumerationLiteral) this.value = modValue;

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
          const description = enumerationLiteral.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;
          this.enumerationLiterals.push(
            new ModelicaEnumerationLiteral(i, enumerationLiteral.identifier.text, description, this.name),
          );
          i++;
        }
      }
    }
    this.instantiated = true;
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = identifier instanceof ModelicaIdentifierSyntaxNode ? identifier.text : identifier;
    if (!simpleName) return null;
    if (!this.instantiated && !this.instantiating) this.instantiate();
    for (const enumerationLiteral of this.enumerationLiterals ?? []) {
      if (enumerationLiteral.stringValue === simpleName) {
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
    const cloned = this.classInstance.clone(mergedModification);
    // Preserve the classKind from the short class declaration's own prefix.
    // e.g., `connector DigitalInput = input Logic;` — the clone should have classKind CONNECTOR,
    // not the classKind of the aliased type Logic (which is TYPE).
    const declaredClassKind = this.abstractSyntaxNode?.classPrefixes?.classKind;
    if (declaredClassKind) cloned.classKind = declaredClassKind;
    // Propagate annotations from the short class declaration's own annotation clause.
    const shortClassAnnotations = ModelicaElement.instantiateAnnotations(
      cloned,
      this.abstractSyntaxNode?.annotationClause,
    );
    if (shortClassAnnotations.length > 0) {
      cloned.annotations = [...shortClassAnnotations, ...cloned.annotations];
    }
    return cloned;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.classInstance?.elements ?? [][Symbol.iterator]();
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const element = super.resolveSimpleName(identifier, global, encapsulated);
    if (element) return element;
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.classInstance?.resolveSimpleName(identifier, false, true) ?? null;
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
    // Preserve the classKind from the short class declaration's own prefix.
    // e.g., `connector DigitalInput = input Logic;` — the classKind should be CONNECTOR,
    // not the classKind of the aliased type Logic (which is TYPE).
    const declaredClassKind = this.abstractSyntaxNode?.classPrefixes?.classKind;
    if (classInstance instanceof ModelicaClassInstance) {
      if (arraySubscripts.length === 0) {
        this.classInstance = classInstance.clone(this.modification);
        this.classInstance.name = this.name; // Keep the declared name
        if (declaredClassKind) this.classInstance.classKind = declaredClassKind;
      } else {
        this.classInstance = new ModelicaArrayClassInstance(
          this.parent,
          classInstance,
          arraySubscripts,
          this.modification,
        );
        this.classInstance.name = this.name; // Keep the declared name
        if (declaredClassKind) this.classInstance.classKind = declaredClassKind;
        this.classInstance.instantiate();
      }
      // Propagate annotations from the short class declaration's own annotation clause.
      // e.g., `connector DigitalInput = input Logic annotation(Icon(graphics={...}));`
      // The Icon annotation defines port graphics (purple rectangles) and must be carried
      // to the cloned instance, which otherwise only has annotations from the aliased type.
      const shortClassAnnotations = ModelicaElement.instantiateAnnotations(
        this.classInstance,
        this.abstractSyntaxNode?.annotationClause,
      );
      if (shortClassAnnotations.length > 0) {
        this.classInstance.annotations = [...shortClassAnnotations, ...this.classInstance.annotations];
      }
    } else {
      console.warn(`Failed to resolve class '${this.name}' target.`);
    }
    this.instantiated = true;
  }
}

export class ModelicaEntity extends ModelicaClassInstance {
  #storedDefinitionSyntaxNode: ModelicaStoredDefinitionSyntaxNode | null = null;
  #loaded = false;
  path: string;
  subEntities: ModelicaEntity[] = [];
  unstructured = false;
  #entityHash: string | null = null;
  #subEntitiesByName: Map<string, ModelicaEntity> | null = null;

  constructor(parent: Scope, path: string) {
    super(parent);
    this.path = this.context?.fs.resolve(path) ?? path;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitEntity(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaClassInstance {
    if (!this.#loaded) this.load();
    return super.clone(modification);
  }

  override getNamedElement(name: string): ModelicaNamedElement | null {
    if (!this.instantiated && !this.instantiating) this.instantiate();

    // If we're still instantiating, fallback to linear scan because the list is changing
    if (this.instantiating && !this.instantiated) {
      for (const sub of this.subEntities) {
        if (sub.name === name) return sub;
      }
      return super.getNamedElement(name);
    }

    if (!this.#subEntitiesByName) {
      this.#subEntitiesByName = new Map();
      for (const sub of this.subEntities) {
        if (sub.name && !this.#subEntitiesByName.has(sub.name)) {
          this.#subEntitiesByName.set(sub.name, sub);
        }
      }
    }
    const sub = this.#subEntitiesByName.get(name);
    if (sub) return sub;
    return super.getNamedElement(name);
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
    if (this.#entityHash) return this.#entityHash;
    const hash = createHash("sha256");
    hash.update(super.hash);
    hash.update(this.path);
    for (const subEntity of this.subEntities) {
      hash.update(subEntity.hash);
    }
    const digest = hash.digest("hex");
    this.#entityHash = digest;
    return digest;
  }

  override instantiate(): void {
    if (!this.#loaded) this.load();
    super.instantiate();
  }

  load(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    this.subEntities = [];
    this.#subEntitiesByName = null;
    const context = this.context;
    if (!context) throw new Error(`ModelicaEntity.load: no context for path '${this.path}'`);
    const stats = context.fs.stat(this.path);
    if (!stats) throw new Error(`ModelicaEntity.load: path not found '${this.path}'`);
    let filePath: string | null;
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
          const ext = context.fs.extname(dirent.name);
          if (dirent.name === "package.mo") continue;
          // Check for FMI model description XML files
          if (ext === ".xml") {
            const xmlPath = context.fs.join(this.path, dirent.name);
            try {
              const xmlContent = context.fs.read(xmlPath);
              if (xmlContent.includes("fmiModelDescription")) {
                // Lazy import to avoid circular dependency (fmu.ts imports from model.ts)
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { ModelicaFmuEntity } = require("./fmu.js") as typeof import("./fmu.js");
                const fmuEntity = new ModelicaFmuEntity(this, xmlPath);
                fmuEntity.name = dirent.name.replace(/\.xml$/, "");
                this.subEntities.push(fmuEntity as unknown as ModelicaEntity);
              }
            } catch {
              // Skip unreadable XML files
            }
            continue;
          }
          // Check for SSP archives
          if (ext === ".ssp") {
            const sspPath = context.fs.join(this.path, dirent.name);
            try {
              // Lazy import to avoid circular dependency
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { ModelicaSspEntity } = require("./ssp-archive.js") as typeof import("./ssp-archive.js");
              const sspEntity = new ModelicaSspEntity(this, sspPath);
              sspEntity.name = dirent.name.replace(/\.ssp$/, "");
              this.subEntities.push(sspEntity as unknown as ModelicaEntity);
            } catch {
              // Skip unreadable SSP files
            }
            continue;
          }
          // Check for JS/TS files
          if (ext === ".js" || ext === ".ts") {
            const jsPath = context.fs.join(this.path, dirent.name);
            try {
              /* eslint-disable @typescript-eslint/no-require-imports */
              const { ModelicaJavascriptEntity } =
                require("./javascript-entity.js") as typeof import("./javascript-entity.js");
              /* eslint-enable @typescript-eslint/no-require-imports */
              const jsEntity = new ModelicaJavascriptEntity(this, jsPath);
              jsEntity.name = dirent.name.replace(/\.[tj]s$/, "");
              this.subEntities.push(jsEntity as unknown as ModelicaEntity);
            } catch {
              // Skip
            }
            continue;
          }
          if (ext !== ".mo") continue;
        }
        const subEntity = new ModelicaEntity(this, context.fs.join(this.path, dirent.name));
        // Set name from filesystem path without parsing — enables lazy loading
        subEntity.name = dirent.isFile() ? dirent.name.replace(/\.mo$/, "") : dirent.name;
        subEntity.unstructured = dirent.isFile();
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
  static #hashing = new Set<ModelicaComponentInstance>();
  #hash: string | null = null;
  #abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | ModelicaComponentDeclaration1SyntaxNode | null;
  #modification: ModelicaModification | null = null;
  #classInstance: ModelicaClassInstance | null = null;
  #declaredType: ModelicaClassInstance | null = null;

  /** Causality prefix (input/output) from the component clause or declared type. */
  causality: ModelicaCausality | null;
  /** Variability prefix (parameter/constant/discrete) from the component clause. */
  variability: ModelicaVariability | null;
  /** Whether this component is declared `final`. */
  isFinal: boolean;
  /** Whether this component is in a `protected` section or from a `protected extends`. */
  isProtected: boolean;
  /** Whether this component is declared `inner`. */
  isInner: boolean;
  /** Whether this component is declared `outer`. */
  isOuter: boolean;
  /** Flow prefix (flow/stream) from the component clause. */
  flowPrefix: ModelicaFlow | null;
  /** Constraining clause modifiers from the original replaceable declaration.
   *  These are applied as lowest-priority defaults during mergeModifications(). */
  constrainingModificationArgs: ModelicaModificationArgument[] | null = null;

  constructor(
    parent: ModelicaClassInstance | null,
    abstractSyntaxNode: ModelicaComponentDeclarationSyntaxNode | ModelicaComponentDeclaration1SyntaxNode | null,
    modification?: ModelicaModification | null,
  ) {
    super(parent);
    this.#abstractSyntaxNode = abstractSyntaxNode;
    this.name = this.abstractSyntaxNode?.declaration?.identifier?.text ?? null;
    this.description = this.abstractSyntaxNode?.description?.strings?.map((d) => d.text ?? "")?.join(" ") ?? null;

    // Extract constraining clause from the component's own declaration BEFORE mergeModifications
    const ownCC =
      (this.abstractSyntaxNode?.parent as { constrainingClause?: ModelicaConstrainingClauseSyntaxNode | null })
        ?.constrainingClause ?? null;
    if (ownCC) {
      this.constrainingModificationArgs = ModelicaComponentInstance.extractConstrainingArgs(ownCC, parent);
    }

    this.#modification = modification ?? this.mergeModifications();

    // Compute prefixes from AST during construction
    this.causality = this.abstractSyntaxNode?.parent?.causality ?? null;
    this.variability = this.abstractSyntaxNode?.parent?.variability ?? null;
    this.isFinal = (this.abstractSyntaxNode?.parent as { final?: boolean })?.final ?? false;
    // Also check if the outer modification carries a `final` flag (e.g., extends Base(final x = 2))
    if (!this.isFinal) {
      const outerMod = this.parent?.modification?.getModificationArgument(this.name);
      if (outerMod instanceof ModelicaElementModification && outerMod.final) {
        this.isFinal = true;
      }
    }
    this.isProtected = (this.abstractSyntaxNode?.parent?.parent as { visibility?: string })?.visibility === "protected";
    this.isInner = (this.abstractSyntaxNode?.parent as { inner?: boolean })?.inner ?? false;
    this.isOuter = (this.abstractSyntaxNode?.parent as { outer?: boolean })?.outer ?? false;
    this.flowPrefix = (this.abstractSyntaxNode?.parent as { flow?: ModelicaFlow | null })?.flow ?? null;
  }

  get classInstance(): ModelicaClassInstance | null {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.#classInstance;
  }

  set classInstance(value: ModelicaClassInstance | null) {
    this.#classInstance = value;
  }

  get declaredType(): ModelicaClassInstance | null {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.#declaredType;
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

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const element = super.resolveSimpleName(identifier, global, encapsulated);
    if (element) return element;
    if (!this.instantiated && !this.instantiating) this.instantiate();
    return this.classInstance?.resolveSimpleName(identifier, false, true) ?? null;
  }

  get hash(): string {
    if (this.#hash) return this.#hash;
    if (ModelicaComponentInstance.#hashing.has(this)) return "";
    ModelicaComponentInstance.#hashing.add(this);
    try {
      const hash = createHash("sha256");
      hash.update(this.name ?? "");
      hash.update(this.classInstance?.compositeName ?? "");
      hash.update(this.modification?.hash ?? "");
      const digest = hash.digest("hex");
      this.#hash = digest;
      return digest;
    } finally {
      ModelicaComponentInstance.#hashing.delete(this);
    }
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) throw Error("reentrant error: component is already being instantiated");
    this.instantiating = true;
    try {
      const element = this.parent?.resolveTypeSpecifier(this.abstractSyntaxNode?.parent?.typeSpecifier);
      if (element instanceof ModelicaClassInstance) {
        this.#declaredType = element;
        // Validate modification arguments against the resolved type's elements.
        // Skip predefined types (Real, Integer, etc.) and enumeration types,
        // which use built-in attributes (start/min/max/quantity/fixed) rather than named sub-components.
        const isPredefined = ModelicaComponentInstance.#isPredefinedType(element);
        const isEnumeration = element instanceof ModelicaEnumerationClassInstance;
        if (this.modification && !isPredefined && !isEnumeration) {
          const typeElementNames = new Set<string>();
          const protectedElementNames = new Set<string>();
          for (const el of element.elements) {
            if (el instanceof ModelicaNamedElement && el.name) {
              typeElementNames.add(el.name);
              if (el instanceof ModelicaComponentInstance && el.isProtected) {
                protectedElementNames.add(el.name);
              }
            }
          }
          // Also check elements from protected extends clauses
          for (const declEl of element.declaredElements) {
            if (declEl instanceof ModelicaExtendsClassInstance) {
              if (declEl.visibility === ModelicaVisibility.PROTECTED && declEl.classInstance) {
                for (const exEl of declEl.classInstance.elements) {
                  if (exEl instanceof ModelicaComponentInstance && exEl.name) {
                    protectedElementNames.add(exEl.name);
                  }
                }
              }
            }
          }
          for (const modArg of this.modification.modificationArguments) {
            const name = modArg.name;
            if (name && name !== "annotation" && !typeElementNames.has(name)) {
              if (this.parent) {
                this.parent.diagnostics.push(
                  makeDiagnostic(ModelicaErrorCode.MODIFIER_NOT_FOUND, null, name, this.name ?? "", element.name ?? ""),
                );
              }
            }
            // Check if modification targets a protected element
            if (name && protectedElementNames.has(name)) {
              throw new Error(`Protected element '${name}' may not be modified, got '${name} = ...'.`);
            }
          }
        }
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
      // Refine prefixes after instantiation:
      // Fall back to declared type's class specifier for causality (handles type aliases like 'type InputReal = input Real;')
      if (!this.causality && this.#declaredType) {
        this.causality =
          (this.#declaredType.abstractSyntaxNode?.classSpecifier as { causality?: ModelicaCausality | null })
            ?.causality ?? null;
      }
      // Check if this component comes from a protected extends clause
      if (
        !this.isProtected &&
        this.parent instanceof ModelicaClassInstance &&
        this.parent.isProtectedElement(this.name)
      ) {
        this.isProtected = true;
      }
      this.instantiated = true;
    } finally {
      this.instantiating = false;
    }
  }

  /** Check if a class instance ultimately resolves to a predefined type (Real, Integer, etc.). */
  static #isPredefinedType(instance: ModelicaClassInstance): boolean {
    if (instance instanceof ModelicaPredefinedClassInstance) return true;
    if (instance instanceof ModelicaShortClassInstance) {
      if (!instance.instantiated && !instance.instantiating) instance.instantiate();
      if (instance.classInstance) return ModelicaComponentInstance.#isPredefinedType(instance.classInstance);
    }
    if (instance instanceof ModelicaArrayClassInstance) {
      const elementInstance = instance.elementClassInstance;
      if (elementInstance) return ModelicaComponentInstance.#isPredefinedType(elementInstance);
    }
    return false;
  }

  #checkDuplicateModifications(args: ModelicaModificationArgument[]): void {
    // Group element modifications by name to detect duplicates
    const byName = new Map<string, ModelicaElementModification[]>();
    for (const arg of args) {
      if (arg instanceof ModelicaElementModification && arg.name) {
        if (!byName.has(arg.name)) byName.set(arg.name, []);
        byName.get(arg.name)?.push(arg);
      }
    }
    for (const [name, mods] of byName) {
      if (mods.length <= 1) continue;
      // Check if multiple mods set a value expression at the same leaf level
      const withExpr = mods.filter((m) => m.nameComponents.length === 1 && m.modificationExpression);
      if (withExpr.length > 1 && this.parent) {
        this.parent.diagnostics.push(
          makeDiagnostic(ModelicaErrorCode.DUPLICATE_MODIFICATION, null, name, this.name ?? ""),
        );
        continue;
      }
      // Recurse into sub-arguments to check for nested duplicates
      const subArgs: ModelicaModificationArgument[] = [];
      for (const m of mods) subArgs.push(...m.extract());
      this.#checkDuplicateModifications(subArgs);
    }
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
    // Check for duplicate modifications within the declaration's own args.
    // e.g. b(a.x = 1.0, a(x = 2.0)) — both modify a.x from the same declaration.
    this.#checkDuplicateModifications(modificationArguments);
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
        outerModificationArgument.scope ?? this,
        filteredArgs,
        outerModificationArgument.modificationExpression ?? modificationSyntaxNode?.modificationExpression,
        outerModificationArgument.description,
        outerModificationArgument.expression,
      );
      mod.annotations = ModelicaModification.merge(
        this.abstractSyntaxNode?.annotationClause
          ? ModelicaModification.new(this.parent, this.abstractSyntaxNode.annotationClause)
          : null,
        ModelicaModification.merge(outerModificationArgument.annotations, annotationFromArg),
      );
      this.#mergeConstrainingArgs(mod);
      return mod;
    } else if (outerModificationArgument instanceof ModelicaParameterModification) {
      const mod = new ModelicaModification(
        outerModificationArgument.scope ?? this,
        filteredArgs,
        null,
        null,
        outerModificationArgument.expression,
      );
      mod.annotations = annotationFromArg;
      this.#mergeConstrainingArgs(mod);
      return mod;
    }
    const mod = new ModelicaModification(this.parent, filteredArgs, modificationSyntaxNode?.modificationExpression);
    mod.annotations = ModelicaModification.merge(
      annotationFromArg,
      this.abstractSyntaxNode?.annotationClause
        ? ModelicaModification.new(this.parent, this.abstractSyntaxNode.annotationClause)
        : null,
    );
    this.#mergeConstrainingArgs(mod);
    return mod;
  }

  /**
   * Merge constraining clause modifiers as lowest-priority defaults into a modification.
   * Uses recursive merge: when both sides have an arg with the same name, sub-arguments
   * from the constraining clause are recursively merged into the existing arg rather than
   * being skipped entirely. Existing expressions always take priority.
   */
  #mergeConstrainingArgs(mod: ModelicaModification): void {
    if (this.constrainingModificationArgs && this.constrainingModificationArgs.length > 0) {
      ModelicaComponentInstance.mergeArgsRecursively(mod.modificationArguments, this.constrainingModificationArgs);
    }
  }

  /**
   * Recursively merge `source` modification arguments into `target` as lowest-priority defaults.
   *
   * For each source arg:
   * - If no target arg has the same name → append the source arg
   * - If a target arg has the same name AND both are `ModelicaElementModification`:
   *   - Recursively merge source's sub-arguments into target's sub-arguments
   *   - Only set the target's expression from source if target has no expression
   * - Otherwise (name collision with non-element-modification) → skip (target wins)
   */
  static mergeArgsRecursively(target: ModelicaModificationArgument[], source: ModelicaModificationArgument[]): void {
    const targetByName = new Map<string, ModelicaModificationArgument>();
    for (const t of target) {
      if (t.name) targetByName.set(t.name, t);
    }
    for (const srcArg of source) {
      if (!srcArg.name) continue;
      const existing = targetByName.get(srcArg.name);
      if (!existing) {
        // New name — add directly
        target.push(srcArg);
        targetByName.set(srcArg.name, srcArg);
      } else if (existing instanceof ModelicaElementModification && srcArg instanceof ModelicaElementModification) {
        // Same name, both are element modifications — recurse into sub-args
        if (srcArg.modificationArguments.length > 0) {
          ModelicaComponentInstance.mergeArgsRecursively(existing.modificationArguments, srcArg.modificationArguments);
        }
        // Only set expression from source if target has none
        // (We don't override — existing expression wins)
      }
      // else: name collision with different types — skip (existing wins)
    }
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

  /**
   * Extract modification arguments from a constraining clause.
   * Converts the constraining clause's classModification into ModelicaModificationArgument[],
   * which can be merged as lowest-priority defaults.
   */
  static extractConstrainingArgs(
    constrainingClause: ModelicaConstrainingClauseSyntaxNode,
    scope: ModelicaClassInstance | null,
  ): ModelicaModificationArgument[] {
    const args: ModelicaModificationArgument[] = [];
    for (const modArg of constrainingClause.classModification?.modificationArguments ?? []) {
      if (modArg instanceof ModelicaElementModificationSyntaxNode) {
        args.push(ModelicaElementModification.new(scope, modArg));
      } else if (modArg instanceof ModelicaElementRedeclarationSyntaxNode) {
        args.push(ModelicaElementRedeclaration.new(scope, modArg));
      }
    }
    return args;
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

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = identifier instanceof ModelicaIdentifierSyntaxNode ? identifier.text : identifier;
    if (simpleName && PREDEFINED_ATTRIBUTES[this.name ?? ""]?.[simpleName]) {
      const element = new ModelicaComponentInstance(this, null);
      element.name = simpleName;
      element.description = PREDEFINED_ATTRIBUTES[this.name ?? ""]?.[simpleName] ?? null;
      const typeName = PREDEFINED_ATTRIBUTE_TYPES[this.name ?? ""]?.[simpleName];
      if (typeName) {
        element.classInstance = this.root.resolveSimpleName(typeName) as ModelicaClassInstance;
      }
      return element;
    }
    return super.resolveSimpleName(identifier, global, encapsulated);
  }
}

export const PREDEFINED_ATTRIBUTES: Record<string, Record<string, string>> = {
  Real: {
    value: "The value of the variable.",
    quantity: "The quantity name of the variable.",
    unit: "The unit of the variable.",
    displayUnit: "The display unit of the variable.",
    min: "The minimum value of the variable.",
    max: "The maximum value of the variable.",
    start: "The initial value of the variable.",
    fixed: "Whether the initial value is fixed.",
    nominal: "The nominal value of the variable.",
    unbounded: "Whether the variable is unbounded.",
    stateSelect: "The state selection of the variable.",
  },
  Integer: {
    value: "The value of the variable.",
    quantity: "The quantity name of the variable.",
    min: "The minimum value of the variable.",
    max: "The maximum value of the variable.",
    start: "The initial value of the variable.",
    fixed: "Whether the initial value is fixed.",
  },
  Boolean: {
    value: "The value of the variable.",
    quantity: "The quantity name of the variable.",
    start: "The initial value of the variable.",
    fixed: "Whether the initial value is fixed.",
  },
  String: {
    value: "The value of the variable.",
    quantity: "The quantity name of the variable.",
    start: "The initial value of the variable.",
    fixed: "Whether the initial value is fixed.",
  },
  Expression: {
    value: "The unevaluated AST expression of the variable.",
  },
};

export const PREDEFINED_ATTRIBUTE_TYPES: Record<string, Record<string, string>> = {
  Real: {
    value: "Real",
    quantity: "String",
    unit: "String",
    displayUnit: "String",
    min: "Real",
    max: "Real",
    start: "Real",
    fixed: "Boolean",
    nominal: "Real",
    unbounded: "Boolean",
    stateSelect: "StateSelect",
  },
  Integer: {
    value: "Integer",
    quantity: "String",
    min: "Integer",
    max: "Integer",
    start: "Integer",
    fixed: "Boolean",
  },
  Boolean: {
    value: "Boolean",
    quantity: "String",
    start: "Boolean",
    fixed: "Boolean",
  },
  String: {
    value: "String",
    quantity: "String",
    start: "String",
    fixed: "Boolean",
  },
  Expression: {
    value: "Expression",
  },
};

export const ENUMERATION_ATTRIBUTE_TYPES: Record<string, string> = {
  value: "enumeration",
  quantity: "String",
  min: "enumeration",
  max: "enumeration",
  start: "enumeration",
  fixed: "Boolean",
};

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

export class ModelicaExpressionClassInstance extends ModelicaPredefinedClassInstance {
  constructor(parent: Scope | null, modification?: ModelicaModification | null) {
    super(parent, "Expression", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitExpressionClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaExpressionClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaExpressionClassInstance(this.parent, mergedModification);
    classInstance.instantiate();
    return classInstance;
  }
}

export class ModelicaClockClassInstance extends ModelicaPredefinedClassInstance {
  constructor(parent: Scope | null, modification?: ModelicaModification | null) {
    super(parent, "Clock", modification);
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitClockClassInstance(this, argument);
  }

  override clone(modification?: ModelicaModification | null): ModelicaClockClassInstance {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const mergedModification = ModelicaModification.merge(this.modification, modification);
    const classInstance = new ModelicaClockClassInstance(this.parent, mergedModification);
    classInstance.instantiate();
    return classInstance;
  }
}

export class ModelicaArrayClassInstance extends ModelicaClassInstance {
  #arraySubscripts: ModelicaSubscriptSyntaxNode[];
  #elementClassInstance: ModelicaClassInstance | null;
  shape: number[] = [];
  /** Maps dimension index → enum literal info for enum-dimensioned arrays */
  enumDimensions = new Map<number, { typeName: string; literals: string[] }>();

  constructor(
    parent: Scope | null,
    elementClassInstance: ModelicaClassInstance | null,
    arraySubscripts: ModelicaSubscriptSyntaxNode[],
    modification?: ModelicaModification | null,
  ) {
    // Pass null for abstractSyntaxNode to avoid inheriting the element type's
    // short class modifications (e.g. start={1,0,0}) at the outer array level.
    // The element type's modifications flow through the element clone instead.
    super(parent, null, modification);
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

  get arraySubscripts(): ModelicaSubscriptSyntaxNode[] {
    return this.#arraySubscripts;
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
        if (expression instanceof ModelicaArray) {
          this.shape.push(expression.flatShape[i] ?? 0);
        } else {
          // Try evaluatedExpression for component reference bindings like a[1].x
          const evalExpr = this.modification?.evaluatedExpression;
          if (evalExpr instanceof ModelicaArray) {
            this.shape.push(evalExpr.flatShape[i] ?? 0);
          } else {
            // Try to infer size from the modification expression's syntax node
            const modExprNode = this.modification?.modificationExpression?.expression;
            if (modExprNode) {
              // Navigate up to the enclosing class scope where sibling components are visible
              let evalScope: Scope | null = this.parent;
              while (evalScope && !(evalScope instanceof ModelicaClassInstance)) {
                evalScope = evalScope.parent;
              }
              if (evalScope) {
                const result = modExprNode.accept(new ModelicaInterpreter(), evalScope);
                if (result instanceof ModelicaArray) {
                  this.shape.push(result.flatShape[i] ?? 0);
                  i++;
                  continue;
                }
              }
            }
            this.shape.push(0);
          }
        }
        i++;
        continue;
      }
      // Navigate up to the enclosing class scope to avoid re-entrant instantiation
      // when evaluating expressions like size(E, 1) where E is a sibling type
      let evalScope: Scope | null = this.parent;
      while (evalScope && !(evalScope instanceof ModelicaClassInstance)) {
        evalScope = evalScope.parent;
      }
      const length = arraySubscript.expression?.accept(new ModelicaInterpreter(), evalScope ?? this);
      if (length instanceof ModelicaIntegerLiteral) {
        if (length.value < 0) {
          // Negative dimensions are invalid (e.g., Real errArr[-2])
          const componentName = this.parent instanceof ModelicaComponentInstance ? (this.parent.name ?? "?") : "?";
          throw new Error(`Negative dimension index (${length.value}) for component ${componentName}.`);
        }
        this.shape.push(length.value);
      } else {
        // Try to resolve as an enum type for enum-dimensioned arrays like Real A[E]
        let resolved = false;
        const subExpr = arraySubscript.expression;
        if (subExpr && "parts" in subExpr) {
          const namedElement = (evalScope ?? this).resolveComponentReference(
            subExpr as ModelicaComponentReferenceSyntaxNode,
          );
          let enumClass: ModelicaEnumerationClassInstance | null = null;
          if (namedElement instanceof ModelicaEnumerationClassInstance) {
            enumClass = namedElement;
          } else if (namedElement instanceof ModelicaComponentInstance) {
            if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
            let ci = namedElement.classInstance;
            while (ci instanceof ModelicaShortClassInstance) ci = ci.classInstance;
            if (ci instanceof ModelicaEnumerationClassInstance) enumClass = ci;
          }
          if (enumClass?.enumerationLiterals) {
            const literals = enumClass.enumerationLiterals;
            this.shape.push(literals.length);
            const typeName = enumClass.compositeName ?? "";
            this.enumDimensions.set(i, {
              typeName,
              literals: literals.map((l) => l.stringValue),
            });
            resolved = true;
          }
        }
        // Handle size(EnumType, dim) calls — resolve the first argument as an enum type
        if (!resolved && subExpr && "functionReferenceName" in subExpr) {
          const funcName = (subExpr as ModelicaFunctionCallSyntaxNode).functionReferenceName ?? "";
          if (funcName === "size") {
            const sizeArgs = (subExpr as ModelicaFunctionCallSyntaxNode).functionCallArguments?.arguments ?? [];
            const firstArg = sizeArgs[0]?.expression;
            if (firstArg && "parts" in firstArg) {
              const namedElement = (evalScope ?? this).resolveComponentReference(
                firstArg as ModelicaComponentReferenceSyntaxNode,
              );
              let enumClass: ModelicaEnumerationClassInstance | null = null;
              if (namedElement instanceof ModelicaEnumerationClassInstance) {
                enumClass = namedElement;
              } else if (namedElement instanceof ModelicaComponentInstance) {
                if (!namedElement.instantiated && !namedElement.instantiating) namedElement.instantiate();
                let ci = namedElement.classInstance;
                while (ci instanceof ModelicaShortClassInstance) ci = ci.classInstance;
                if (ci instanceof ModelicaEnumerationClassInstance) enumClass = ci;
              }
              if (enumClass?.enumerationLiterals) {
                this.shape.push(enumClass.enumerationLiterals.length);
                resolved = true;
              }
            }
          }
        }
        if (!resolved) this.shape.push(0);
      }
      i++;
    }

    const declaredElementClassInstance = this.#elementClassInstance;
    declaredElementClassInstance?.instantiate();
    let elementClassInstance = declaredElementClassInstance;
    while (elementClassInstance instanceof ModelicaShortClassInstance) {
      elementClassInstance = elementClassInstance.classInstance;
    }
    // Save the directly-declared shape before appending inner type dimensions.
    // Modification arguments (e.g. start={1,0,0}) belong to the element type's
    // shape, not the full combined shape.
    const declaredShape = [...this.shape];
    let effectiveModification = this.modification;
    if (elementClassInstance instanceof ModelicaArrayClassInstance) {
      this.shape.push(...elementClassInstance.shape);
      // Merge the inner array class's modification so it can be properly split
      // across the combined flat elements. E.g. T2=T1[2] where T1=Real[3](start={1,0,0}):
      // the inner mod start={1,0,0} is replicated for each outer element.
      if (elementClassInstance.modification) {
        effectiveModification = ModelicaModification.merge(effectiveModification, elementClassInstance.modification);
      }
      elementClassInstance = elementClassInstance.elementClassInstance;
    }
    this.name = (declaredElementClassInstance?.name ?? "?") + "[" + this.shape.join(", ") + "]";
    if (!elementClassInstance || this.#arraySubscripts.length == 0) {
      this.instantiated = true;
      return;
    }
    // Validate array modification dimensions (skip when expression has unknown dims — 0 means unevaluated)
    if (
      expression instanceof ModelicaArray &&
      !expression.flatShape.includes(0) &&
      !expression.assignable(this.shape)
    ) {
      this.diagnostics.push(
        makeDiagnostic(
          ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH,
          null,
          "modification",
          String(expression.flatShape),
          String(this.shape),
        ),
      );
      this.instantiated = true;
      return;
    }
    // Only validate modification arguments if the shape is entirely from declared subscripts.
    // When inner dimensions were appended from the element type, the modification arguments
    // belong to the element type which validates them itself.
    if (declaredShape.length === 0 || declaredShape.length >= this.shape.length) {
      for (const modArg of effectiveModification?.modificationArguments ?? []) {
        const argExpr = modArg.expression;
        if (argExpr instanceof ModelicaArray && !argExpr.assignable(this.shape)) {
          this.diagnostics.push(
            makeDiagnostic(
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH,
              null,
              `modification of '${modArg.name}'`,
              String(argExpr.flatShape),
              String(this.shape),
            ),
          );
          this.instantiated = true;
          return;
        }
      }
    }
    const size = this.shape.reduce((acc, cur) => acc * cur);
    const modifications = effectiveModification?.split(size);
    for (let i = 0; i < size; i++) {
      this.declaredElements.push(elementClassInstance.clone(modifications?.[i]));
    }
    this.instantiated = true;
  }
}

export class ModelicaModification {
  static #hashing = new Set<ModelicaModification>();
  #hash: string | null = null;
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

  #evaluated = false;
  #evaluating = false;
  #evaluatedExpression: ModelicaExpression | null = null;
  #evaluatedWithAlgorithms = false;
  #evaluatingWithAlgorithms = false;

  get expression(): ModelicaExpression | null {
    if (this.#expression) return this.#expression;
    if (this.#evaluated || this.#evaluating) return this.#expression;
    this.#evaluating = true;
    try {
      this.#expression = this.modificationExpression?.expression?.accept(new ModelicaInterpreter(), this.scope) ?? null;
    } finally {
      this.#evaluating = false;
      this.#evaluated = true;
    }
    return this.#expression;
  }

  /** Returns the already-evaluated expression without triggering lazy evaluation. */
  get cachedExpression(): ModelicaExpression | null {
    return this.#expression;
  }

  /** Evaluates the expression with function algorithm execution enabled. */
  get evaluatedExpression(): ModelicaExpression | null {
    if (this.#evaluatedExpression) return this.#evaluatedExpression;
    if (this.#evaluatedWithAlgorithms || this.#evaluatingWithAlgorithms) {
      return this.#evaluatedExpression ?? this.#expression;
    }
    // If a pre-set expression exists (e.g. from split()), use it instead of
    // re-evaluating the syntax node which may still reference the unsplit value.
    if (this.#expression) return this.#expression;
    this.#evaluatingWithAlgorithms = true;
    try {
      this.#evaluatedExpression =
        this.modificationExpression?.expression?.accept(new ModelicaInterpreter(true), this.scope) ?? null;
    } finally {
      this.#evaluatingWithAlgorithms = false;
      this.#evaluatedWithAlgorithms = true;
    }
    return this.#evaluatedExpression ?? this.#expression;
  }

  getModificationArgument(name: string | null | undefined): ModelicaModificationArgument | null {
    if (!name) return null;
    for (const modificationArgument of this.modificationArguments) {
      if (modificationArgument.name === name) return modificationArgument;
    }
    return null;
  }

  get hash(): string {
    if (this.#hash) return this.#hash;
    if (ModelicaModification.#hashing.has(this)) return "";
    ModelicaModification.#hashing.add(this);
    try {
      const hash = createHash("sha256");
      if (this.scope && (this.scope as { modification?: unknown }).modification !== this) {
        hash.update(this.scope.hash);
      }
      for (const modificationArgument of this.modificationArguments) {
        hash.update(modificationArgument.hash);
      }
      if (this.cachedExpression) {
        hash.update(this.cachedExpression.hash);
      }
      if (this.annotations) {
        hash.update(this.annotations.hash);
      }
      const digest = hash.digest("hex");
      this.#hash = digest;
      return digest;
    } finally {
      ModelicaModification.#hashing.delete(this);
    }
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
    const mergedExpression = overridingModification.cachedExpression ?? modification.cachedExpression;
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
  final: boolean;

  constructor(
    scope: Scope | null,
    nameComponents: ModelicaIdentifierSyntaxNode[],
    modificationArguments: ModelicaModificationArgument[],
    modificationExpression?: ModelicaModificationExpressionSyntaxNode | null,
    description?: string | null,
    expression?: ModelicaExpression | null,
    final?: boolean,
  ) {
    super(scope);
    this.#nameComponents = makeWeakRefArray(nameComponents);
    this.modificationArguments = modificationArguments;
    this.#modificationExpression = makeWeakRef(modificationExpression);
    this.description = description ?? null;
    this.#expression = expression ?? null;
    this.final = final ?? false;
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
      abstractSyntaxNode.final,
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
  classInstance: ModelicaClassInstance | null;

  constructor(scope: Scope | null, abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode) {
    super(scope, abstractSyntaxNode);
    if (abstractSyntaxNode.shortClassDefinition) {
      this.classInstance = ModelicaClassInstance.new(scope, abstractSyntaxNode.shortClassDefinition);
    } else {
      this.classInstance = null;
    }
  }

  get expression(): ModelicaExpression | null {
    return null;
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
  split(count: unknown, index?: unknown): ModelicaModificationArgument | ModelicaModificationArgument[] {
    if (index !== undefined) {
      return this;
    } else {
      return Array(count as number).fill(this);
    }
  }
}

export class ModelicaComponentRedeclaration extends ModelicaElementRedeclaration {
  componentInstance: ModelicaComponentInstance | null;

  constructor(scope: Scope | null, abstractSyntaxNode: ModelicaElementRedeclarationSyntaxNode) {
    super(scope, abstractSyntaxNode);
    this.componentInstance = new ModelicaComponentInstance(
      scope as ModelicaClassInstance,
      abstractSyntaxNode.componentClause?.componentDeclaration ?? null,
    );
  }

  get expression(): ModelicaExpression | null {
    return null;
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

  visitClockClassInstance(node: ModelicaClockClassInstance, argument?: A): R;

  visitClassInstance(node: ModelicaClassInstance, argument?: A): R;

  visitComponentInstance(node: ModelicaComponentInstance, argument?: A): R;

  visitEntity(node: ModelicaEntity, argument?: A): R;

  visitExtendsClassInstance(node: ModelicaExtendsClassInstance, argument?: A): R;

  visitIntegerClassInstance(node: ModelicaIntegerClassInstance, argument?: A): R;

  visitLibrary(node: ModelicaLibrary, argument?: A): R;

  visitRealClassInstance(node: ModelicaRealClassInstance, argument?: A): R;

  visitStringClassInstance(node: ModelicaStringClassInstance, argument?: A): R;

  visitExpressionClassInstance(node: ModelicaExpressionClassInstance, argument?: A): R;
}

export abstract class ModelicaModelVisitor<A> implements IModelicaModelVisitor<void, A> {
  visitArrayClassInstance(node: ModelicaArrayClassInstance, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitBooleanClassInstance(node: ModelicaBooleanClassInstance, argument?: A): void {
    /* no-op */
  }

  visitClockClassInstance(node: ModelicaClockClassInstance, argument?: A): void {
    /* no-op */
  }

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

  visitIntegerClassInstance(node: ModelicaIntegerClassInstance, argument?: A): void {
    /* no-op */
  }

  visitLibrary(node: ModelicaLibrary, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitRealClassInstance(node: ModelicaRealClassInstance, argument?: A): void {
    /* no-op */
  }

  visitStringClassInstance(node: ModelicaStringClassInstance, argument?: A): void {
    /* no-op */
  }

  visitExpressionClassInstance(node: ModelicaExpressionClassInstance, argument?: A): void {
    /* no-op */
  }
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

  visitExpressionClassInstance(node: ModelicaExpressionClassInstance, indent = 0): void {
    this.indent(indent);
    this.out.write("type Expression\n");
    this.indent(indent + 1);
    this.out.write("ExpressionType ⟨value⟩ = ");
    node.expression?.accept(new ModelicaDAEPrinter(this.out));
    this.out.write(";\n");
    this.indent(indent);
    this.out.write("end Expression;\n");
  }
}
