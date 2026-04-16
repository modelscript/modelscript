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

// ---------------------------------------------------------------------------
// QueryBackedElement (generic base)
// ---------------------------------------------------------------------------

/**
 * Generic element wrapper for non-class, non-component elements
 * (extends, imports, equations, etc.).
 */
export class QueryBackedElement {
  constructor(
    readonly id: SymbolId,
    readonly db: QueryDB,
  ) {}

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

  /** The class kind (model, block, connector, etc.). */
  get classKind(): string {
    const meta = this.entry?.metadata as Record<string, unknown>;
    return (meta?.classPrefixes as string) ?? "class";
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
    if (entry.kind === "Class") {
      const meta = entry.metadata as Record<string, unknown>;
      if (meta?.isPredefined) {
        if (entry.name === "Integer") return new QueryBackedIntegerClassInstance(eid, this.db);
        if (entry.name === "Boolean") return new QueryBackedBooleanClassInstance(eid, this.db);
        if (entry.name === "String") return new QueryBackedStringClassInstance(eid, this.db);
        if (entry.name === "Real") return new QueryBackedRealClassInstance(eid, this.db);
      }
      if (meta?.isEnumeration) return new QueryBackedEnumerationClassInstance(eid, this.db);
      const arrayDims = this.db.query("arrayDimensions", eid);
      if (arrayDims && (arrayDims as number[]).length > 0) return new QueryBackedArrayClassInstance(eid, this.db);
      return new QueryBackedClassInstance(eid, this.db);
    }
    return new QueryBackedElement(eid, this.db);
  }

  /**
   * All instantiated elements (components, nested classes, imports).
   * Replaces the mutable `elements` array.
   */
  get elements(): QueryBackedElement[] {
    const ids = this.db.query<SymbolId[]>("instantiate", this.id);
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
    const cst = this.db.cstNode(this.id);
    if (!cst) return null;
    return abstractSyntaxNodeFactory(cst);
  }

  /**
   * All annotations for this class instance.
   */
  get annotations(): any[] {
    const ast = this.abstractSyntaxNode;
    // Walk the AST annotation clause if it exists
    return ast?.annotationClause ? [ast.annotationClause] : [];
  }

  /**
   * Get a specific annotation by name.
   */
  annotation(name: string): any {
    return null;
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
    // Fallback for raw CST or mocks
    return this.sections.filter((s) => (s as any).type === "EquationSection");
  }

  /** Algorithm sections. */
  get algorithmSections(): any[] {
    const ast = this.abstractSyntaxNode;
    if (!ast) return [];
    if (ast.algorithmSections) return [...ast.algorithmSections];
    // Fallback for raw CST or mocks
    return this.sections.filter((s) => (s as any).type === "AlgorithmSection");
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
      const meta = resolved.metadata as Record<string, unknown>;
      if (meta?.isPredefined) {
        if (resolved.name === "Integer") return new QueryBackedIntegerClassInstance(resolved.id, this.db);
        if (resolved.name === "Boolean") return new QueryBackedBooleanClassInstance(resolved.id, this.db);
        if (resolved.name === "String") return new QueryBackedStringClassInstance(resolved.id, this.db);
        if (resolved.name === "Real") return new QueryBackedRealClassInstance(resolved.id, this.db);
      }
      if (meta?.isEnumeration) return new QueryBackedEnumerationClassInstance(resolved.id, this.db);
      const arrayDims = this.db.query("arrayDimensions", resolved.id);
      if (arrayDims && (arrayDims as number[]).length > 0)
        return new QueryBackedArrayClassInstance(resolved.id, this.db);
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
}

// ---------------------------------------------------------------------------
// QueryBackedComponentInstance
// ---------------------------------------------------------------------------

/**
 * Adapts the ModelicaComponentInstance API to the QueryEngine.
 */
export class QueryBackedComponentInstance extends QueryBackedClassInstance {
  /** The component's type specifier (e.g., "Real", "Modelica.Electrical.Pin"). */
  get typeSpecifier(): string {
    return ((this.entry?.metadata as Record<string, unknown>)?.typeSpecifier as string) ?? "";
  }

  /** The component's variability (discrete, parameter, constant, or null/continuous). */
  get variability(): string | null {
    return ((this.entry?.metadata as Record<string, unknown>)?.variability as string) ?? null;
  }

  /** The component's causality (input, output, or null/internal). */
  get causality(): string | null {
    return ((this.entry?.metadata as Record<string, unknown>)?.causality as string) ?? null;
  }

  /** The component's flow prefix (flow, stream, or null). */
  get flowPrefix(): string | null {
    return ((this.entry?.metadata as Record<string, unknown>)?.flow as string) ?? null;
  }

  /** Whether this component is final. */
  get isFinal(): boolean {
    return !!(this.entry?.metadata as Record<string, unknown>)?.final;
  }

  /** Whether this component is a redeclaration. */
  get isRedeclare(): boolean {
    return !!(this.entry?.metadata as Record<string, unknown>)?.redeclare;
  }

  /** Whether this component has inner prefix. */
  get isInner(): boolean {
    return !!(this.entry?.metadata as Record<string, unknown>)?.inner;
  }

  /** Whether this component has outer prefix. */
  get isOuter(): boolean {
    return !!(this.entry?.metadata as Record<string, unknown>)?.outer;
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
      if (meta?.isPredefined) {
        if (classEntry.name === "Integer") return new QueryBackedIntegerClassInstance(classId, this.db);
        if (classEntry.name === "Boolean") return new QueryBackedBooleanClassInstance(classId, this.db);
        if (classEntry.name === "String") return new QueryBackedStringClassInstance(classId, this.db);
        if (classEntry.name === "Real") return new QueryBackedRealClassInstance(classId, this.db);
      }
      if (meta?.isEnumeration) return new QueryBackedEnumerationClassInstance(classId, this.db);
      const arrayDims = this.db.query("arrayDimensions", this.id);
      if (arrayDims && (arrayDims as number[]).length > 0) return new QueryBackedArrayClassInstance(classId, this.db);
    }
    return new QueryBackedClassInstance(classId, this.db);
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
}

export class QueryBackedIntegerClassInstance extends QueryBackedClassInstance {}
export class QueryBackedBooleanClassInstance extends QueryBackedClassInstance {}
export class QueryBackedStringClassInstance extends QueryBackedClassInstance {}
export class QueryBackedRealClassInstance extends QueryBackedClassInstance {}
export class QueryBackedEnumerationClassInstance extends QueryBackedClassInstance {}
export class QueryBackedArrayClassInstance extends QueryBackedClassInstance {
  get shape(): number[] {
    // Note: The array instance in compat-shim is bound to the component type's class ID,
    // but the component itself is where the `arrayDimensions` are evaluated unless it's a type alias.
    // However, the caller usually accesses `shape` or evaluating `arrayDimensions`.
    // In legacy, `arraySubscripts` and `enumDimensions` exist.
    return this.db.query("arrayDimensions", this.id) ?? [];
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

export class QueryBackedPredefinedClassInstance extends QueryBackedClassInstance {}
export class QueryBackedShortClassInstance extends QueryBackedClassInstance {}
export class QueryBackedClockClassInstance extends QueryBackedClassInstance {}
