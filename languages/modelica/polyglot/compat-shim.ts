/* eslint-disable */
/**
 * examples/modelica/compat-shim.ts
 *
 * Compatibility shim: ModelicaClassInstance API backed by QueryEngine.
 *
 * This module provides adapter classes that implement the same public
 * API surface as model.ts's ModelicaClassInstance and ModelicaComponentInstance,
 * but delegate to the metascript QueryEngine underneath.
 *
 * This enables existing downstream consumers (flattener, interpreter,
 * simulator, FMU export, etc.) to work during the incremental migration
 * without rewriting their internal logic.
 *
 * Usage:
 * ```typescript
 * // Instead of:
 * const classInstance = ModelicaClassInstance.new(parent, syntaxNode);
 * classInstance.instantiate();
 *
 * // Use:
 * const classInstance = new QueryBackedClassInstance(symbolId, db);
 * // No explicit instantiate() needed — queries are lazy.
 * ```
 */

import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/polyglot";
import { type ModelicaModArgs, type ModificationArg, modelicaMod } from "./modification-args.js";

// ---------------------------------------------------------------------------
// AST Factory Registry
// ---------------------------------------------------------------------------

/**
 * Factory type for wrapping raw CST nodes into legacy AST nodes.
 * This allows the polyglot package to remain decoupled from modelica-ast.
 */
export type AbstractSyntaxNodeFactory = (cst: any) => any;

/** Default factory: returns the raw CST node unwrapped. */
let abstractSyntaxNodeFactory: AbstractSyntaxNodeFactory = (cst) => cst;

/**
 * Register a factory function to automatically wrap CST nodes.
 * Used by @modelscript/core to inject ModelicaSyntaxNode.new().
 */
export function registerAbstractSyntaxNodeFactory(factory: AbstractSyntaxNodeFactory): void {
  abstractSyntaxNodeFactory = factory;
}

/**
 * Evaluator for dynamically parsing CST annotation nodes into JSON objects matching IIcon / IPlacement
 */
export type AnnotationEvaluator = (ast: any, name: string) => any;

let annotationEvaluator: AnnotationEvaluator = () => null;

/**
 * Register an evaluator for `annotation(name)` calls on QueryBackedClassInstance.
 */
export function registerAnnotationEvaluator(evaluator: AnnotationEvaluator): void {
  annotationEvaluator = evaluator;
}

// ---------------------------------------------------------------------------
// QueryBackedElement (generic base)
// ---------------------------------------------------------------------------

/**
 * Generic element wrapper for non-class, non-component elements
 * (extends, imports, equations, etc.).
 */
export class QueryBackedElement {
  get isClassInstance(): boolean {
    return false;
  }
  get isComponentInstance(): boolean {
    return false;
  }

  constructor(
    public readonly id: SymbolId,
    public readonly db: QueryDB,
  ) {}

  /** The raw AST node from the CST. */
  get ast(): any {
    const cst = this.db.cstNode(this.id);
    return cst ? abstractSyntaxNodeFactory(cst) : null;
  }

  /** Gets whether the component is protected */
  get isProtected(): boolean {
    return !!(this.entry?.metadata as Record<string, unknown>)?.protected;
  }

  get entry(): SymbolEntry | undefined {
    return this.db.symbol(this.id);
  }

  get name(): string {
    return this.entry?.name ?? "";
  }

  get kind(): string {
    return this.entry?.kind ?? "";
  }

  get compositeName(): string {
    const parts: string[] = [];
    let current: SymbolEntry | undefined = this.entry;
    while (current) {
      if (current.name) parts.unshift(current.name);
      current = current.parentId !== null ? this.db.symbol(current.parentId) : undefined;
    }
    return parts.join(".");
  }

  get localizedName(): string {
    return this.name ?? "";
  }

  get localizedCompositeName(): string {
    return this.compositeName ?? "";
  }

  get description(): string | null {
    const meta = this.entry?.metadata as Record<string, unknown>;
    return (meta?.description as string) ?? null;
  }

  get annotations(): any[] {
    const ast = this.ast;
    return ast?.annotationClause ? [ast.annotationClause] : [];
  }

  annotation<T>(name: string, _annotations?: any): T | null {
    if (typeof annotationEvaluator !== "function") return null;

    const clauses = this.annotations;
    if (!clauses) return null;

    for (const clause of clauses) {
      const result = annotationEvaluator(clause, name);
      if (result != null) return result as T;
    }

    return null;
  }

  resolveSimpleName(name: string, ...args: any[]): any {
    return null;
  }
}

// ---------------------------------------------------------------------------
// QueryBackedClassInstance
// ---------------------------------------------------------------------------

/**
 * Adapts the ModelicaClassInstance API to the QueryEngine.
 *
 * Key differences from the original:
 * - No mutable state: all data is queried on demand
 * - No explicit `instantiate()`: queries are lazy/memoized
 * - `clone(modification)` → `db.specialize(id, modelicaMod(mod))`
 * - Elements are SymbolIds, not ModelicaNode instances
 */
export class QueryBackedClassInstance extends QueryBackedElement {
  get isClassInstance(): boolean {
    return true;
  }
  constructor(id: SymbolId, db: QueryDB) {
    super(id, db);
  }

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /** The fully-qualified composite name (dot-separated). */
  override get compositeName(): string {
    const parts: string[] = [];
    let current: SymbolEntry | undefined = this.entry;
    while (current) {
      if (current.name) parts.unshift(current.name);
      current = current.parentId !== null ? this.db.symbol(current.parentId) : undefined;
    }
    return parts.join(".");
  }

  /** Get the underlying SymbolEntry. */
  override get entry(): SymbolEntry | undefined {
    return this.db.symbol(this.id);
  }

  get classKind(): string {
    const meta = this.entry?.metadata as Record<string, unknown>;
    if (typeof meta?.classKind === "string") return meta.classKind;

    const prefixes = ((meta?.classPrefixes as string) || "class").trim().toLowerCase();

    if (prefixes.includes("expandable connector")) return "expandable connector";
    if (prefixes.includes("connector")) return "connector";
    if (prefixes.includes("operator record")) return "operator record";
    if (prefixes.includes("record")) return "record";
    if (prefixes.includes("operator function")) return "operator function";
    if (prefixes.includes("function")) return "function";
    if (prefixes.includes("block")) return "block";
    if (prefixes.includes("model")) return "model";
    if (prefixes.includes("package")) return "package";
    if (prefixes.includes("type")) return "type";
    if (prefixes.includes("optimization")) return "optimization";
    if (prefixes.includes("operator")) return "operator";

    return "class";
  }

  /** Whether this class is a partial definition. */
  get isPartial(): boolean {
    const meta = this.entry?.metadata as Record<string, unknown>;
    return !!(meta?.classPrefixes as string)?.includes("partial");
  }

  /** Whether this class is encapsulated. */
  get isEncapsulated(): boolean {
    return !!(this.entry?.metadata as Record<string, unknown>)?.encapsulated;
  }

  // -------------------------------------------------------------------------
  // Instantiation (Lazy — delegated to queries)
  // -------------------------------------------------------------------------

  /**
   * No-op for compatibility. In the query engine, instantiation is lazy.
   * Calling this is harmless but unnecessary.
   */
  instantiate(): void {
    // Intentionally empty — queries compute on demand
  }

  /** Whether this class has been instantiated. Always true for query-backed. */
  get instantiated(): boolean {
    return true;
  }

  get instantiating(): boolean {
    return false;
  }

  /**
   * For short class specifiers (e.g., `type Voltage = Real(unit="V")`),
   * resolve and return the target type class instance.
   * Returns null if this is not a short class specifier or the type cannot be resolved.
   */
  get shortClassTarget(): QueryBackedClassInstance | null {
    if (this.classKind !== "type") return null;
    // Predefined types (Real, Integer, etc.) are not short class specifiers
    const meta = this.entry?.metadata as Record<string, unknown>;
    if (meta?.isPredefined) return null;
    const cst = this.db.cstNode(this.id) as any;
    if (!cst) return null;
    // Navigate to the ShortClassSpecifier's typeSpecifier
    const classSpecifier = cst.childForFieldName?.("classSpecifier");
    const typeSpec = classSpecifier?.childForFieldName?.("typeSpecifier");
    const typeName = typeSpec?.text;
    if (!typeName) return null;
    // Resolve using the enclosing scope via full name resolution
    const parentId = this.entry?.parentId;
    if (parentId !== null && parentId !== undefined) {
      const resolver = this.db.query<(n: string) => { id: SymbolId } | null>("resolveName", parentId);
      if (resolver) {
        const resolved = resolver(typeName);
        if (resolved?.id) {
          return this.wrapElement(resolved.id) as QueryBackedClassInstance | null;
        }
      }
    }
    // Fallback: global lookup with dotted path traversal
    const parts = typeName.split(".");
    let currentEntries = this.db.byName(parts[0]!);
    let current =
      currentEntries?.find((e: any) => (e.metadata as Record<string, unknown>)?.isPredefined) ??
      currentEntries?.find((e: any) => e.kind === "Class" || e.kind === "Package") ??
      currentEntries?.[0];

    if (current) {
      for (let i = 1; i < parts.length; i++) {
        const childName = parts[i];
        const children = this.db.childrenOf(current.id);
        const child = children.find((c: any) => c.name === childName && c.kind !== "Reference");
        if (!child) {
          current = undefined;
          break;
        }
        current = child;
      }
    }

    if (current && current.kind === "Class") {
      return this.wrapElement(current.id) as QueryBackedClassInstance | null;
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Elements
  // -------------------------------------------------------------------------

  /**
   * The abstract syntax node for this class instance.
   * Backed by the Polyglot CST node.
   * This is implemented below with a Proxy to provide legacy properties.
   */

  private wrapElement(eid: SymbolId): QueryBackedElement | null {
    const entry = this.db.symbol(eid);
    if (!entry) return null;
    if (entry.kind === "Component") {
      return new QueryBackedComponentInstance(eid, this.db);
    }
    if (entry.kind === "Extends") {
      return new QueryBackedExtendsClassInstance(eid, this.db);
    }
    if (entry.kind === "Class") {
      let arrayDims = null;
      try {
        arrayDims = this.db.query("arrayDimensions", eid);
      } catch {
        // Ignored
      }
      if (arrayDims && (arrayDims as any[]).length > 0)
        return new QueryBackedArrayClassInstance(eid, this.db, arrayDims as any[]);

      const meta = entry.metadata as Record<string, unknown>;
      if (meta?.isPredefined) {
        if (entry.name === "Integer") return new QueryBackedIntegerClassInstance(eid, this.db);
        if (entry.name === "Boolean") return new QueryBackedBooleanClassInstance(eid, this.db);
        if (entry.name === "String") return new QueryBackedStringClassInstance(eid, this.db);
        if (entry.name === "Real") return new QueryBackedRealClassInstance(eid, this.db);
      }
      if (meta?.isEnumeration) return new QueryBackedEnumerationClassInstance(eid, this.db);
      return new QueryBackedClassInstance(eid, this.db);
    }
    return new QueryBackedElement(eid, this.db);
  }

  /**
   * All instantiated elements (components, nested classes, imports).
   * Replaces the mutable `elements` array.
   */
  get elements(): QueryBackedElement[] {
    let ids: SymbolId[] | null = null;
    try {
      ids = this.db.query<SymbolId[]>("instantiate", this.id);
    } catch {
      // Ignored — may fail for predefined types or unresolvable classes
    }
    if (!ids) return [];
    return ids.map((eid) => this.wrapElement(eid)).filter((e): e is QueryBackedElement => e !== null);
  }

  /**
   * Only the elements that are directly declared inside this class instance.
   * This retrieves direct children from the symbol index avoiding inherited elements.
   */
  get declaredElements(): QueryBackedElement[] {
    const children = this.db.childrenOf(this.id);
    // Component elements and nested classes declared within this scope
    return children.map((entry) => this.wrapElement(entry.id)).filter((e): e is QueryBackedElement => e !== null);
  }

  /** Component elements within this class instance. */
  get components(): any[] {
    return this.elements.filter((e) => e.isComponentInstance);
  }

  /**
   * Virtual components added by connect equations to expandable connectors.
   * Required by ModelicaFlattener.
   */
  virtualComponents = new Map<string, any>();

  /**
   * Diagnostics for this class instance.
   * Required by ModelicaFlattener.
   */
  diagnostics: any[] = [];

  /**
   * Input parameters of this class (if it's a function).
   */
  inputParameters: any[] = [];

  /**
   * Output parameters of this class (if it's a function).
   */
  outputParameters: any[] = [];

  /**
   * The abstract syntax node for this class instance.
   * Backed by the Polyglot CST node, potentially wrapped via the AST factory.
   */
  get abstractSyntaxNode(): any {
    let cst: any = this.db.cstNode(this.id);
    if (!cst) return null;

    // Workaround for misaligned symbol index ranges: if cstNode returned the 'Declaration'
    // or 'IDENT' child, walk up to the containing 'ComponentDeclaration' so that
    // we can access the peer 'annotationClause' node.
    if (cst && (cst.type === "Declaration" || cst.type === "IDENT")) {
      while (
        cst &&
        cst.type !== "ComponentDeclaration" &&
        cst.type !== "ComponentClause" &&
        cst.type !== "ShortClassDefinition" &&
        cst.type !== "ClassDefinition"
      ) {
        cst = cst.parent;
      }
    }

    return abstractSyntaxNodeFactory(cst);
  }

  /**
   * All annotations for this class instance.
   */
  get annotations(): any[] {
    const ast = this.abstractSyntaxNode;
    if (!ast) return [];
    const result: any[] = [];

    // Most class annotations are standalone elements, e.g. `annotation(Icon(...));`
    // These are aggregated in `classAnnotationClauses` on the long class specifier.
    if (ast.classSpecifier?.classAnnotationClauses) {
      result.push(...Array.from(ast.classSpecifier.classAnnotationClauses));
    }

    // Fallback to inline annotationClause if it exists
    if (ast.annotationClause) {
      if (!result.includes(ast.annotationClause)) {
        result.push(ast.annotationClause);
      }
    }

    return result;
  }

  /**
   * Get a specific annotation by name.
   */
  override annotation<T>(name: string): T | null {
    return super.annotation<T>(name);
  }

  /** All sections in the class definition. */
  get sections(): any[] {
    const ast = this.abstractSyntaxNode;
    if (!ast) return [];
    // If it's a legacy AST node, it has a .sections getter.
    // If it's a raw CST node, it might have .sections if we used a Proxy, or we return empty.
    return ast.sections ? [...ast.sections] : [];
  }

  /** Equation sections. */
  get equationSections(): any[] {
    const ast = this.abstractSyntaxNode;
    if (!ast) return [];
    if (ast.equationSections) return [...ast.equationSections];
    return this.sections.filter(
      (s) => s && s.constructor && s.constructor.name === "ModelicaEquationSectionSyntaxNode",
    );
  }

  /** Algorithm sections. */
  get algorithmSections(): any[] {
    const ast = this.abstractSyntaxNode;
    if (!ast) return [];
    if (ast.algorithmSections) return [...ast.algorithmSections];
    return this.sections.filter(
      (s) => s && s.constructor && s.constructor.name === "ModelicaAlgorithmSectionSyntaxNode",
    );
  }

  /** Equations. */
  get equations(): any[] {
    const ast = this.abstractSyntaxNode;
    if (ast?.equations) return [...ast.equations];
    return this.equationSections.flatMap((s: any) => (Array.isArray(s.equations) ? s.equations : []));
  }

  /** Connect equations. */
  get connectEquations(): any[] {
    // Primary: use QueryDB connect equations (kind="ConnectEquation" children)
    // These have metadata.ref1 and metadata.ref2 as text strings like "L.p" or "ground.p"
    const dbConnects = this.db.childrenOf(this.id).filter((c) => c.kind === "ConnectEquation");
    if (dbConnects.length > 0) {
      return dbConnects.map((entry) => {
        const meta = (entry.metadata ?? {}) as Record<string, unknown>;
        const ref1 = typeof meta.ref1 === "string" ? meta.ref1 : "";
        const ref2 = typeof meta.ref2 === "string" ? meta.ref2 : "";
        // Split "L.p" into ["L", "p"]; strip subscripts like "L[1]" → "L"
        const parts1 = ref1.split(".").map((s) => s.replace(/\[.*$/, ""));
        const parts2 = ref2.split(".").map((s) => s.replace(/\[.*$/, ""));
        // Return a compat object that diagramData.ts can consume
        return {
          componentReference1: {
            parts: parts1.map((s) => ({ identifier: { text: s } })),
          },
          componentReference2: {
            parts: parts2.map((s) => ({ identifier: { text: s } })),
          },
          annotation: (name: string) => {
            const cst = this.db.cstNode(entry.id);
            if (!cst || typeof annotationEvaluator !== "function") return null;
            const annotClause = (cst as any)?.childForFieldName?.("annotationClause");
            if (!annotClause) return null;
            const ast = abstractSyntaxNodeFactory(cst);
            const annotAst = ast?.annotationClause;
            if (!annotAst) return null;
            return annotationEvaluator(annotAst, name);
          },
        };
      });
    }
    // Fallback: old AST-based approach
    return this.equations.filter(
      (e) => e && e.constructor && e.constructor.name === "ModelicaConnectEquationSyntaxNode",
    );
  }

  /** Algorithms. */
  get algorithms(): any[] {
    const ast = this.abstractSyntaxNode;
    if (ast?.algorithms) return [...ast.algorithms];
    return this.algorithmSections.flatMap((s: any) => (Array.isArray(s.statements) ? s.statements : []));
  }

  /**
   * Resolve a name path in this class's scope.
   * Replaces `Scope.resolveName()`.
   */
  resolveName(name: { parts: string[] } | string[] | null | undefined, global = false): QueryBackedElement | null {
    const parts = Array.isArray(name) ? name : name?.parts;
    if (!parts || parts.length === 0) return null;
    let namedElement: any = this.resolveSimpleName(parts[0]);
    if (!namedElement) return null;
    for (let i = 1; i < parts.length; i++) {
      if (typeof namedElement.resolveSimpleName !== "function") return null;
      namedElement = namedElement.resolveSimpleName(parts[i]);
      if (!namedElement) return null;
    }
    return namedElement;
  }

  /**
   * Resolve a component reference SyntaxNode.
   */
  resolveComponentReference(componentReference: any): QueryBackedElement | null {
    if (!componentReference || !componentReference.parts) return null;
    const parts = componentReference.parts;
    if (parts.length === 0) return null;
    const firstId = parts[0]?.identifier;
    const firstName = typeof firstId === "string" ? firstId : (firstId?.text ?? "");
    let namedElement: any = this.resolveSimpleName(firstName);
    if (!namedElement) return null;
    for (let i = 1; i < parts.length; i++) {
      const partId = parts[i]?.identifier;
      const partName = typeof partId === "string" ? partId : (partId?.text ?? "");
      if (typeof namedElement.resolveSimpleName !== "function") return null;
      namedElement = namedElement.resolveSimpleName(partName);
      if (!namedElement) return null;
    }
    return namedElement;
  }

  /**
   * Resolve a simple name in this class's scope.
   * Replaces `Scope.resolveSimpleName()`.
   */
  resolveSimpleName(name: string): QueryBackedElement | null {
    const resolver = this.db.query<(n: string, enc?: boolean) => SymbolEntry | null>("resolveSimpleName", this.id);
    const resolved = resolver?.(name);
    if (!resolved) return null;

    if (resolved.kind === "Component") {
      return new QueryBackedComponentInstance(resolved.id, this.db);
    }
    if (resolved.kind === "Class") {
      let arrayDims = null;
      try {
        arrayDims = this.db.query("arrayDimensions", resolved.id);
      } catch {
        // Ignored
      }
      if (arrayDims && (arrayDims as any[]).length > 0)
        return new QueryBackedArrayClassInstance(resolved.id, this.db, arrayDims as any[]);

      const meta = resolved.metadata as Record<string, unknown>;
      if (meta?.isPredefined) {
        if (resolved.name === "Integer") return new QueryBackedIntegerClassInstance(resolved.id, this.db);
        if (resolved.name === "Boolean") return new QueryBackedBooleanClassInstance(resolved.id, this.db);
        if (resolved.name === "String") return new QueryBackedStringClassInstance(resolved.id, this.db);
        if (resolved.name === "Real") return new QueryBackedRealClassInstance(resolved.id, this.db);
      }
      if (meta?.isEnumeration) return new QueryBackedEnumerationClassInstance(resolved.id, this.db);

      return new QueryBackedClassInstance(resolved.id, this.db);
    }
    return new QueryBackedElement(resolved.id, this.db);
  }

  /**
   * Clone this class with a different modification.
   * Replaces `ModelicaClassInstance.clone()`.
   */
  clone(modification: ModelicaModArgs): QueryBackedClassInstance {
    const newId = this.db.specialize(this.id, modelicaMod(modification));
    return new QueryBackedClassInstance(newId, this.db);
  }

  /**
   * Get the active modification for this instance.
   * Returns null for non-specialized (base) instances.
   */
  get modification(): QueryBackedModification | null {
    const modArgs = this.db.argsOf<ModelicaModArgs>(this.id)?.data;
    if (!modArgs) return null;
    return new QueryBackedModification(modArgs, this.db);
  }

  /**
   * Get the unit for this type, walking the modification and extends chain.
   * This allows Real-derived types like SI.Capacitance to expose their unit.
   */
  get unit(): any {
    // Check own modification first (e.g. type Capacitance = Real(unit="F"))
    const unitFromMod = this.modification?.getModificationArgument("unit")?.expression;
    if (unitFromMod != null) return unitFromMod;

    // Check the AST-level modification (e.g. Short class specifier classModification)
    const ast = this.abstractSyntaxNode;
    if (ast?.classSpecifier?.classModification) {
      const modArgs = ast.classSpecifier.classModification.modificationArguments;
      if (modArgs) {
        for (const arg of modArgs) {
          const argName = arg.name?.text ?? arg.name?.parts?.map((p: any) => p.text).join(".");
          if (argName === "unit") {
            const expr = arg.modification?.modificationExpression?.expression;
            if (expr) return expr;
          }
        }
      }
    }

    // Walk extends chain
    for (const ext of this.extendsClassInstances) {
      const extUnit = ext.classInstance?.unit;
      if (extUnit != null) return extUnit;
    }

    return null;
  }

  /**
   * Check type compatibility with another class.
   * Implements Modelica §6.4 subtype compatibility.
   */
  isTypeCompatibleWith(other: QueryBackedClassInstance): boolean {
    // Basic structural subtyping: all elements of `other` must exist in `this`
    const myElements = this.db.query<SymbolId[]>("instantiate", this.id) ?? [];
    const otherElements = this.db.query<SymbolId[]>("instantiate", other.id) ?? [];

    const myByName = new Map<string, SymbolEntry>();
    for (const eid of myElements) {
      const e = this.db.symbol(eid);
      if (e) myByName.set(e.name, e);
    }

    for (const eid of otherElements) {
      const e = this.db.symbol(eid);
      if (!e) continue;
      if (e.kind !== "Component") continue; // Only components matter for subtyping
      if (!myByName.has(e.name)) return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Visitor Pattern
  // -------------------------------------------------------------------------

  accept<R, A>(visitor: any, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  // -------------------------------------------------------------------------
  // Convenience Accessors
  // -------------------------------------------------------------------------

  /** All abstract classes inherited by this class. */
  get extendsClassInstances(): { classInstance: QueryBackedClassInstance | null }[] {
    let extendsClauses: any[] = [];
    try {
      extendsClauses = this.db.query<any[]>("extendsClasses", this.id) ?? [];
    } catch {
      // Query not available for this rule (e.g., SysML2 Package) — no extends
      return [];
    }
    return extendsClauses.map((ext) => {
      // resolvedBaseClass returns a SymbolEntry (not a SymbolId), so extract .id
      const baseEntry = this.db.query<{ id: SymbolId } | null>("resolvedBaseClass", ext.id);
      return { classInstance: baseEntry?.id ? (this.wrapElement(baseEntry.id) as QueryBackedClassInstance) : null };
    });
  }

  /** Components with variability=parameter. */
  get parameters(): QueryBackedComponentInstance[] {
    return this.elements.filter(
      (e): e is QueryBackedComponentInstance =>
        e instanceof QueryBackedComponentInstance && e.variability === "parameter",
    );
  }

  /** Components with variability=constant. */
  get constants(): QueryBackedComponentInstance[] {
    return this.elements.filter(
      (e): e is QueryBackedComponentInstance =>
        e instanceof QueryBackedComponentInstance && e.variability === "constant",
    );
  }

  /** Components with causality=input. */
  get inputComponents(): QueryBackedComponentInstance[] {
    return this.elements.filter(
      (e): e is QueryBackedComponentInstance => e instanceof QueryBackedComponentInstance && e.causality === "input",
    );
  }

  /** Components with causality=output. */
  get outputComponents(): QueryBackedComponentInstance[] {
    return this.elements.filter(
      (e): e is QueryBackedComponentInstance => e instanceof QueryBackedComponentInstance && e.causality === "output",
    );
  }

  /** Check if this class is a connector. */
  get isConnector(): boolean {
    return this.db.query<boolean>("isConnector", this.id) ?? false;
  }

  /** Check if a named element is protected. */
  isProtectedElement(name: string): boolean {
    return this.elements.find((e) => e.name === name)?.isProtected ?? false;
  }
}

// ---------------------------------------------------------------------------
// QueryBackedComponentInstance
// ---------------------------------------------------------------------------

/**
 * Adapts the ModelicaComponentInstance API to the QueryEngine.
 */
export class QueryBackedComponentInstance extends QueryBackedClassInstance {
  get isComponentInstance(): boolean {
    return true;
  }

  /** The enclosing class instance that contains this component. */
  get parent(): QueryBackedClassInstance | null {
    const parentId = this.entry?.parentId;
    if (parentId === null || parentId === undefined) return null;
    return new QueryBackedClassInstance(parentId, this.db);
  }
  /** The component's type specifier (e.g., "Real", "Modelica.Electrical.Pin"). */
  get typeSpecifier(): string {
    return ((this.entry?.metadata as Record<string, unknown>)?.typeSpecifier as string) ?? "";
  }

  /** The component's variability (discrete, parameter, constant, or null/continuous). */
  get variability(): string | null {
    return this.db.query<string | null>("variability", this.id) ?? null;
  }

  /** The component's causality (input, output, or null/internal). */
  get causality(): string | null {
    return this.db.query<string | null>("causality", this.id) ?? null;
  }

  /** The component's flow prefix (flow, stream, or null). */
  get flowPrefix(): string | null {
    return this.db.query<string | null>("flowPrefix", this.id) ?? null;
  }

  /** Whether this component is final. */
  get isFinal(): boolean {
    return this.db.query<boolean>("isFinal", this.id) ?? false;
  }

  /** Resolve names by delegating to the component's class instance. */
  override resolveSimpleName(name: string): QueryBackedElement | null {
    return this.classInstance?.resolveSimpleName(name) ?? null;
  }

  /** Whether this component is a redeclaration. */
  get isRedeclare(): boolean {
    return this.db.query<boolean>("isRedeclare", this.id) ?? false;
  }

  /** Whether this component has inner prefix. */
  get isInner(): boolean {
    return this.db.query<boolean>("isInner", this.id) ?? false;
  }

  /** Whether this component has outer prefix. */
  get isOuter(): boolean {
    return this.db.query<boolean>("isOuter", this.id) ?? false;
  }

  /**
   * Get the resolved class instance for this component's type.
   * Returns a QueryBackedClassInstance wrapping the (possibly specialized) class.
   */
  get classInstance(): QueryBackedClassInstance | null {
    const classId = this.db.query<SymbolId | null>("classInstance", this.id);
    if (classId === null) return null;

    const classEntry = this.db.symbol(classId);
    if (classEntry) {
      const meta = classEntry.metadata as Record<string, unknown>;
      const arrayDims = this.db.query("arrayDimensions", this.id);
      if (arrayDims && (arrayDims as any[]).length > 0)
        return new QueryBackedArrayClassInstance(classId, this.db, arrayDims as any[]);

      if (meta?.isPredefined) {
        if (classEntry.name === "Integer") return new QueryBackedIntegerClassInstance(classId, this.db);
        if (classEntry.name === "Boolean") return new QueryBackedBooleanClassInstance(classId, this.db);
        if (classEntry.name === "String") return new QueryBackedStringClassInstance(classId, this.db);
        if (classEntry.name === "Real") return new QueryBackedRealClassInstance(classId, this.db);
      }
      if (meta?.isEnumeration) return new QueryBackedEnumerationClassInstance(classId, this.db);
    }
    return new QueryBackedClassInstance(classId, this.db);
  }

  /** Alias for classInstance, for legacy compatibility. */
  get declaredType(): QueryBackedClassInstance | null {
    return this.classInstance;
  }

  /**
   * Get the active modification for this instance.
   * Returns a merged modification combining specialized model arguments and inline AST bindings.
   */
  override get modification(): any /* MergedModification | QueryBackedModification | AstBackedModification | null */ {
    // 1. Specialized arguments via polyglot db (e.g. from a cloned instance path)
    const modArgs = this.db.argsOf<ModelicaModArgs>(this.id)?.data;
    const dbMod = modArgs ? new QueryBackedModification(modArgs, this.db) : null;

    // 2. Inline bindings from the AST (e.g., `start=1` or `= 9.81`)
    const ast = this.abstractSyntaxNode;
    const rawAstMod =
      ast?.modification ??
      ast?.declaration?.modification ??
      ast?.componentDeclarations?.[0]?.modification ??
      ast?.declarations?.[0]?.modification;
    const astMod = rawAstMod ? new AstBackedModification(rawAstMod) : null;

    if (dbMod && astMod) return new MergedModification(dbMod, astMod);
    return dbMod ?? astMod ?? null;
  }

  /**
   * Get the array dimensions for this component.
   * Returns null for scalar components.
   */
  get arrayDimensions(): number[] | null {
    return this.db.query<number[] | null>("arrayDimensions", this.id);
  }

  /** Check if this component's type is a connector. */
  get isConnectorType(): boolean {
    return this.db.query<boolean>("isConnectorType", this.id) ?? false;
  }

  override accept<R, A>(visitor: any, argument?: A): R {
    return visitor.visitComponentInstance(this, argument);
  }
}

// ---------------------------------------------------------------------------
// Modifications Adapter
// ---------------------------------------------------------------------------

export class QueryBackedExtendsClassInstance extends QueryBackedClassInstance {
  override accept<R, A>(visitor: any, argument?: A): R {
    return visitor.visitExtendsClassInstance(this, argument);
  }

  // Override getters that would issue ClassDefinition-specific queries
  // against an ExtendsClause id, causing a crash.
  get isPartial(): boolean {
    return false;
  }
  get extendsClassInstances(): { classInstance: QueryBackedClassInstance | null }[] {
    return [];
  }
  get nestedClasses(): QueryBackedClassInstance[] {
    return [];
  }
  get connectEquations(): any[] {
    return [];
  }
  get parameters(): any[] {
    return [];
  }
  get elements(): QueryBackedElement[] {
    return [];
  }

  /** Resolve the base class referenced by this extends clause. */
  get classInstance(): QueryBackedClassInstance | null {
    const baseEntry = this.db.query<{ id: SymbolId } | null>("resolvedBaseClass", this.id);
    if (!baseEntry?.id) return null;
    const entry = this.db.symbol(baseEntry.id);
    if (!entry) return null;
    const meta = entry.metadata as Record<string, unknown>;
    if (meta?.isPredefined) {
      if (entry.name === "Integer") return new QueryBackedIntegerClassInstance(baseEntry.id, this.db);
      if (entry.name === "Boolean") return new QueryBackedBooleanClassInstance(baseEntry.id, this.db);
      if (entry.name === "String") return new QueryBackedStringClassInstance(baseEntry.id, this.db);
      if (entry.name === "Real") return new QueryBackedRealClassInstance(baseEntry.id, this.db);
    }
    if (meta?.isEnumeration) return new QueryBackedEnumerationClassInstance(baseEntry.id, this.db);
    return new QueryBackedClassInstance(baseEntry.id, this.db);
  }
}

export class QueryBackedElementModification {
  constructor(public readonly arg: ModificationArg) {}

  get modification() {
    return new QueryBackedModification(this.arg.nestedArgs as any, undefined);
  }

  get modificationExpression() {
    if (!this.arg.value) return null;
    return { expression: this.arg.value };
  }

  get expression() {
    return this.modificationExpression?.expression ?? null;
  }
}

export class AstBackedElementModification {
  constructor(public readonly ast: any) {}

  get name() {
    return (
      this.ast.name?.parts?.map((p: any) => p.text).join(".") ??
      this.ast.identifier?.text ??
      this.ast.componentReference?.parts?.map((p: any) => p.text).join(".") ??
      null
    );
  }

  get modification() {
    if (!this.ast.modification) return null;
    return new AstBackedModification(this.ast.modification);
  }

  get modificationExpression() {
    if (!this.ast.modification?.modificationExpression) return null;
    return { expression: this.ast.modification.modificationExpression.expression };
  }

  get expression() {
    return this.modificationExpression?.expression ?? null;
  }
}

export class AstBackedModification {
  scope: any = null;
  description: string | null = null;

  constructor(public readonly ast: any) {}

  get modificationArguments() {
    const classMod = this.ast.classModification ?? this.ast.annotationClause?.classModification;
    if (!classMod) return [];
    const args = classMod.modificationArguments ?? [];
    return args.map((a: any) => new AstBackedElementModification(a));
  }

  get modificationExpression() {
    if (!this.ast.modificationExpression) return null;
    return { expression: this.ast.modificationExpression.expression };
  }

  get expression() {
    return this.modificationExpression?.expression ?? null;
  }

  get evaluatedExpression() {
    if (!this.expression) return null;

    // Proper non-hacky evaluation using the syntax nodes' robust literal values
    if ("value" in this.expression) {
      return (this.expression as any).value;
    }

    const t = this.expression.text;
    if (!t) return null;

    const tType = this.expression.type ?? this.expression["@type"];
    if (tType === "BOOLEAN" || tType === "boolean_literal") {
      return t === "true";
    }

    if (tType === "STRING" || tType === "string_literal") {
      return t.replace(/^"|"$/g, "");
    }

    if (
      tType === "UNSIGNED_INTEGER" ||
      tType === "UNSIGNED_REAL" ||
      tType === "unsigned_integer_literal" ||
      tType === "unsigned_real_literal"
    ) {
      return Number(t);
    }

    // Fallback for strings which use .text instead of .value
    if (t.startsWith('"') && t.endsWith('"')) {
      return t.substring(1, t.length - 1);
    }

    return null;
  }

  getModificationArgument(name: string): AstBackedElementModification | undefined {
    return this.modificationArguments.find((a: any) => a.name === name);
  }
}

export class MergedModification {
  constructor(
    private dbMod: any,
    private astMod: any,
  ) {}

  get modificationArguments() {
    const argsMap = new Map();
    for (const m of this.astMod.modificationArguments) argsMap.set(m.name, m);
    // dbMod arguments take precedence
    for (const m of this.dbMod.modificationArguments) argsMap.set(m.arg.name, m);
    return Array.from(argsMap.values());
  }

  get modificationExpression() {
    return this.dbMod.modificationExpression ?? this.astMod.modificationExpression;
  }

  get expression() {
    return this.dbMod.expression ?? this.astMod.expression;
  }

  get evaluatedExpression() {
    return this.dbMod.evaluatedExpression ?? this.astMod.evaluatedExpression;
  }

  getModificationArgument(name: string) {
    const arg = this.dbMod.getModificationArgument(name);
    if (arg) return arg;
    return this.astMod.getModificationArgument(name);
  }
}

export class QueryBackedModification {
  scope: any = null;
  description: string | null = null;

  constructor(
    public readonly modArgs: ModelicaModArgs | null,
    public db?: QueryDB,
  ) {}

  get modificationArguments() {
    return this.modArgs?.args.map((a) => new QueryBackedElementModification(a)) ?? [];
  }

  get modificationExpression() {
    if (!this.modArgs?.bindingExpression) return null;
    return { expression: this.modArgs.bindingExpression };
  }

  get expression() {
    return this.modificationExpression?.expression ?? null;
  }

  get evaluatedExpression() {
    // In actual implementation, we might try to evaluate this using QueryDB
    if (this.expression?.kind === "literal") return this.expression.value;
    return null;
  }

  getModificationArgument(name: string): QueryBackedElementModification | undefined {
    return this.modificationArguments.find((a: any) => a.arg.name?.parts?.map((p: any) => p.text).join(".") === name);
  }
}

export class QueryBackedPredefinedClassInstance extends QueryBackedClassInstance {}
export class QueryBackedIntegerClassInstance extends QueryBackedPredefinedClassInstance {}
export class QueryBackedBooleanClassInstance extends QueryBackedPredefinedClassInstance {}
export class QueryBackedStringClassInstance extends QueryBackedPredefinedClassInstance {}
export class QueryBackedEnumerationClassInstance extends QueryBackedPredefinedClassInstance {}

export class QueryBackedRealClassInstance extends QueryBackedPredefinedClassInstance {
  override accept<R, A>(visitor: any, argument?: A): R {
    if (visitor.visitRealClassInstance) {
      return visitor.visitRealClassInstance(this, argument);
    }
  }

  get unit(): any {
    return this.modification?.getModificationArgument("unit")?.expression ?? null;
  }
}
export class QueryBackedArrayClassInstance extends QueryBackedClassInstance {
  constructor(
    id: SymbolId,
    db: QueryDB,
    public readonly _arrayDims?: any[],
  ) {
    super(id, db);
  }

  get shape(): number[] {
    const dims = this._arrayDims ?? this.db.query<any[]>("arrayDimensions", this.id) ?? [];
    return dims.map((d: any) => d.value ?? 1);
  }

  get arraySubscripts(): any[] {
    return this._arrayDims ?? this.db.query<any[]>("arrayDimensions", this.id) ?? [];
  }

  get enumDimensions(): any[] {
    return [];
  }

  get elementClassInstance(): QueryBackedClassInstance {
    const classEntry = this.db.symbol(this.id);
    if (classEntry) {
      const meta = classEntry.metadata as Record<string, unknown>;
      if (meta?.isPredefined) {
        if (classEntry.name === "Integer") return new QueryBackedIntegerClassInstance(this.id, this.db);
        if (classEntry.name === "Boolean") return new QueryBackedBooleanClassInstance(this.id, this.db);
        if (classEntry.name === "String") return new QueryBackedStringClassInstance(this.id, this.db);
        if (classEntry.name === "Real") return new QueryBackedRealClassInstance(this.id, this.db);
      }
      if (meta?.isEnumeration) return new QueryBackedEnumerationClassInstance(this.id, this.db);
    }
    return new QueryBackedClassInstance(this.id, this.db);
  }
}

export class QueryBackedShortClassInstance extends QueryBackedClassInstance {}
export class QueryBackedClockClassInstance extends QueryBackedClassInstance {}
export class QueryBackedExpressionClassInstance extends QueryBackedClassInstance {
  override accept<R, A>(visitor: any, argument?: A): R {
    return visitor.visitExpressionClassInstance(this, argument);
  }
}
