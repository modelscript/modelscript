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
 * const classInstance = new ModelicaClassInstance(symbolId, db);
 * // No explicit instantiate() needed — queries are lazy.
 * ```
 */

import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/polyglot";
import { type ModelicaModArgs, type ModificationArg, modelicaMod } from "./modification-args.js";

export function polyfillAccept(expr: any): any {
  if (expr == null) return null;
  if (typeof expr === "number") {
    return {
      value: expr,
      accept: (visitor: any, args: any) => {
        if (Number.isInteger(expr) && typeof visitor.visitUnsignedIntegerLiteral === "function") {
          return visitor.visitUnsignedIntegerLiteral({ value: expr }, args);
        }
        if (typeof visitor.visitUnsignedRealLiteral === "function") {
          return visitor.visitUnsignedRealLiteral({ value: expr }, args);
        }
        return null;
      },
    };
  }
  if (typeof expr === "boolean") {
    return {
      value: expr,
      accept: (visitor: any, args: any) => {
        if (typeof visitor.visitBooleanLiteral === "function") {
          return visitor.visitBooleanLiteral({ value: expr }, args);
        }
        return null;
      },
    };
  }
  if (typeof expr === "string") {
    return {
      value: expr,
      accept: (visitor: any, args: any) => {
        if (typeof visitor.visitStringLiteral === "function") {
          return visitor.visitStringLiteral({ value: expr }, args);
        }
        return null;
      },
    };
  }
  if (typeof expr === "object" && !expr.accept) {
    if (expr.text) {
      return {
        ...expr,
        accept: (visitor: any, args: any) => {
          const text = expr.text.trim();
          if (text === "true" || text === "false") {
            if (typeof visitor.visitBooleanLiteral === "function") {
              return visitor.visitBooleanLiteral({ value: text === "true" }, args);
            }
          }
          if (/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(text)) {
            console.log(`[DEBUG] polyfillAccept regex matched for text: '${text}'`);
            if (typeof visitor.visitNameExpression === "function") {
              console.log(`[DEBUG] calling visitNameExpression`);
              return visitor.visitNameExpression({ name: text }, args);
            }
            if (typeof visitor.visitComponentReference === "function") {
              console.log(`[DEBUG] calling visitComponentReference`);
              const parts = text.split(".").map((p: string) => ({ identifier: { text: p } }));
              return visitor.visitComponentReference({ parts, global: false }, args);
            }
            console.log(`[DEBUG] no visitor method found!`);
          } else {
            console.log(`[DEBUG] polyfillAccept regex FAILED for text: '${text}'`);
          }
          const num = Number(text);
          if (!isNaN(num)) {
            if (Number.isInteger(num) && typeof visitor.visitUnsignedIntegerLiteral === "function") {
              return visitor.visitUnsignedIntegerLiteral({ value: num }, args);
            }
            if (typeof visitor.visitUnsignedRealLiteral === "function") {
              return visitor.visitUnsignedRealLiteral({ value: num }, args);
            }
          }
          if (text.startsWith('"') && text.endsWith('"')) {
            if (typeof visitor.visitStringLiteral === "function") {
              return visitor.visitStringLiteral({ value: text.substring(1, text.length - 1) }, args);
            }
          }
          return null;
        },
      };
    } else {
      const type = expr.type || expr["@type"];
      if (type) {
        return {
          ...expr,
          accept: (visitor: any, args: any) => {
            if (type === "IntegerLiteral" && typeof visitor.visitUnsignedIntegerLiteral === "function")
              return visitor.visitUnsignedIntegerLiteral(expr, args);
            if (type === "RealLiteral" && typeof visitor.visitUnsignedRealLiteral === "function")
              return visitor.visitUnsignedRealLiteral(expr, args);
            if (type === "BooleanLiteral" && typeof visitor.visitBooleanLiteral === "function")
              return visitor.visitBooleanLiteral(expr, args);
            if (type === "StringLiteral" && typeof visitor.visitStringLiteral === "function")
              return visitor.visitStringLiteral(expr, args);
            if (type === "NameExpression") {
              if (typeof visitor.visitNameExpression === "function") return visitor.visitNameExpression(expr, args);
              if (typeof visitor.visitComponentReference === "function") {
                const parts = (expr.name || expr.text || "")
                  .split(".")
                  .map((p: string) => ({ identifier: { text: p } }));
                return visitor.visitComponentReference({ parts, global: false }, args);
              }
            }
            if (type === "UnaryExpression" && typeof visitor.visitUnaryExpression === "function")
              return visitor.visitUnaryExpression(expr, args);
            if (type === "BinaryExpression" && typeof visitor.visitBinaryExpression === "function")
              return visitor.visitBinaryExpression(expr, args);
            if (type === "Array" && typeof visitor.visitArrayConstructor === "function")
              return visitor.visitArrayConstructor(expr, args);
            return null;
          },
        };
      } else if (expr.kind === "literal" && "value" in expr) {
        // Handle ModificationValue { kind: "literal", value: ... }
        return polyfillAccept(expr.value);
      } else if (expr.kind === "expression" && expr.text) {
        // Handle ModificationValue { kind: "expression", text: ... }
        return polyfillAccept({ ...expr, text: expr.text });
      }
    }
  }
  return expr;
}

const globalAstCache = new WeakMap<SymbolEntry, any>();
const virtualComponentsCache = new WeakMap<SymbolEntry, Map<string, any>>();
const diagnosticsCache = new WeakMap<SymbolEntry, any[]>();
const inputParametersCache = new WeakMap<SymbolEntry, any[]>();
const outputParametersCache = new WeakMap<SymbolEntry, any[]>();

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
export type AnnotationEvaluator = (ast: any, name: string, evalScope?: any, overrideModification?: any) => any;

let annotationEvaluator: AnnotationEvaluator = () => null;

/**
 * Register an evaluator for `annotation(name)` calls on ModelicaClassInstance.
 */
export function registerAnnotationEvaluator(evaluator: AnnotationEvaluator): void {
  annotationEvaluator = evaluator;
}

// ---------------------------------------------------------------------------
// ModelicaElement (generic base)
// ---------------------------------------------------------------------------

/**
 * Generic element wrapper for non-class, non-component elements
 * (extends, imports, equations, etc.).
 */
export class ModelicaElement {
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
    const entry = this.entry;
    if (entry && globalAstCache.has(entry)) {
      return globalAstCache.get(entry);
    }
    const cst = this.db.cstNode(this.id);
    const ast = cst ? abstractSyntaxNodeFactory(cst) : null;
    if (entry) {
      globalAstCache.set(entry, ast);
    }
    return ast;
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

  annotation<T>(name: string, overrideContext?: any): T | null {
    if (typeof annotationEvaluator !== "function") return null;

    const clauses = this.annotations;
    if (!clauses) return null;

    let evalScope: any = null;
    if ("classKind" in this && typeof (this as any).resolveSimpleName === "function") {
      evalScope = this;
    } else if ("classInstance" in this && "parent" in this) {
      evalScope = (this as any).parent;
    } else {
      evalScope = (this as any).parent ?? this;
    }

    let overrideModification: any = null;
    if (overrideContext && "modification" in overrideContext) {
      overrideModification = overrideContext.modification;
    }

    for (const clause of clauses) {
      const result = annotationEvaluator(clause, name, evalScope, overrideModification);
      if (result != null) return result as T;
    }

    return null;
  }

  resolveSimpleName(name: string, ...args: any[]): any {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ModelicaClassInstance
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
export class ModelicaClassInstance extends ModelicaElement {
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
  get shortClassTarget(): ModelicaClassInstance | null {
    // Predefined types (Real, Integer, etc.) are not short class specifiers
    const meta = this.entry?.metadata as Record<string, unknown>;
    if (meta?.isPredefined) return null;
    const cst = this.db.cstNode(this.id) as any;
    if (!cst) return null;
    // Navigate to the ShortClassSpecifier's typeSpecifier
    const classSpecifier = cst.childForFieldName?.("classSpecifier");
    if (classSpecifier?.type !== "ShortClassSpecifier") return null;
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
          return this.wrapElement(resolved.id) as ModelicaClassInstance | null;
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
      return this.wrapElement(current.id) as ModelicaClassInstance | null;
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

  private wrapElement(eid: SymbolId): ModelicaElement | null {
    const entry = this.db.symbol(eid);
    if (!entry) return null;
    if (entry.kind === "Component") {
      return new ModelicaComponentInstance(eid, this.db);
    }
    if (entry.kind === "Extends") {
      return new ModelicaExtendsClassInstance(eid, this.db);
    }
    if (entry.kind === "Class") {
      let arrayDims = null;
      try {
        arrayDims = this.db.query("arrayDimensions", eid);
      } catch {
        // Ignored
      }
      if (arrayDims && (arrayDims as any[]).length > 0)
        return new ModelicaArrayClassInstance(eid, this.db, arrayDims as any[]);

      const meta = entry.metadata as Record<string, unknown>;
      if (meta?.isPredefined) {
        if (entry.name === "Integer") return new ModelicaIntegerClassInstance(eid, this.db);
        if (entry.name === "Boolean") return new ModelicaBooleanClassInstance(eid, this.db);
        if (entry.name === "String") return new ModelicaStringClassInstance(eid, this.db);
        if (entry.name === "Real") return new ModelicaRealClassInstance(eid, this.db);
      }
      if (meta?.isEnumeration) return new ModelicaEnumerationClassInstance(eid, this.db);
      return new ModelicaClassInstance(eid, this.db);
    }
    return new ModelicaElement(eid, this.db);
  }

  #elementsCache?: ModelicaElement[];
  /**
   * All instantiated elements (components, nested classes, imports).
   * Replaces the mutable `elements` array.
   */
  get elements(): ModelicaElement[] {
    if (this.#elementsCache !== undefined) return this.#elementsCache;
    let ids: SymbolId[] | null = null;
    try {
      ids = this.db.query<SymbolId[]>("instantiate", this.id);
    } catch {
      // Ignored — may fail for predefined types or unresolvable classes
    }
    if (!ids) {
      this.#elementsCache = [];
      return this.#elementsCache;
    }
    this.#elementsCache = ids.map((eid) => this.wrapElement(eid)).filter((e): e is ModelicaElement => e !== null);
    return this.#elementsCache;
  }

  #declaredElementsCache?: ModelicaElement[];
  /**
   * Only the elements that are directly declared inside this class instance.
   * This retrieves direct children from the symbol index avoiding inherited elements.
   */
  get declaredElements(): ModelicaElement[] {
    if (this.#declaredElementsCache !== undefined) return this.#declaredElementsCache;
    const children = this.db.childrenOf(this.id);
    // Component elements and nested classes declared within this scope
    this.#declaredElementsCache = children
      .map((entry) => this.wrapElement(entry.id))
      .filter((e): e is ModelicaElement => e !== null);
    return this.#declaredElementsCache;
  }

  /** Component elements within this class instance. */
  get components(): any[] {
    return this.elements.filter((e) => e.isComponentInstance);
  }

  get originalClassInstance(): ModelicaClassInstance | this {
    if (typeof (this.db as any).baseOf === "function") {
      const baseId = (this.db as any).baseOf(this.id);
      if (baseId !== null && baseId !== undefined) {
        return new ModelicaClassInstance(baseId, this.db);
      }
    }
    return this;
  }

  /**
   * Virtual components added by connect equations to expandable connectors.
   * Required by ModelicaFlattener.
   */
  get virtualComponents(): Map<string, any> {
    const entry = this.entry;
    if (!entry) return new Map();
    let map = virtualComponentsCache.get(entry);
    if (!map) {
      map = new Map<string, any>();
      virtualComponentsCache.set(entry, map);
    }
    return map;
  }

  /**
   * Diagnostics for this class instance.
   * Required by ModelicaFlattener.
   */
  get diagnostics(): any[] {
    const entry = this.entry;
    if (!entry) return [];
    let arr = diagnosticsCache.get(entry);
    if (!arr) {
      arr = [];
      diagnosticsCache.set(entry, arr);
    }
    return arr;
  }

  /**
   * Input parameters of this class (if it's a function).
   */
  get inputParameters(): any[] {
    const entry = this.entry;
    if (!entry) return [];
    let arr = inputParametersCache.get(entry);
    if (!arr) {
      arr = [];
      inputParametersCache.set(entry, arr);
    }
    return arr;
  }

  /**
   * Output parameters of this class (if it's a function).
   */
  get outputParameters(): any[] {
    const entry = this.entry;
    if (!entry) return [];
    let arr = outputParametersCache.get(entry);
    if (!arr) {
      arr = [];
      outputParametersCache.set(entry, arr);
    }
    return arr;
  }

  #abstractSyntaxNodeCache?: any;
  /**
   * The abstract syntax node for this class instance.
   * Backed by the Polyglot CST node, potentially wrapped via the AST factory.
   */
  get abstractSyntaxNode(): any {
    const entry = this.entry;
    if (entry && globalAstCache.has(entry)) {
      this.#abstractSyntaxNodeCache = globalAstCache.get(entry);
      return this.#abstractSyntaxNodeCache;
    }
    let cst: any = this.db.cstNode(this.id);
    if (!cst) {
      this.#abstractSyntaxNodeCache = null;
      return null;
    }

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
    this.#abstractSyntaxNodeCache = abstractSyntaxNodeFactory(cst);
    if (entry) {
      globalAstCache.set(entry, this.#abstractSyntaxNodeCache);
    }
    return this.#abstractSyntaxNodeCache;
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
  override annotation<T>(name: string, context?: any): T | null {
    return super.annotation<T>(name, context);
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
  resolveName(name: { parts: string[] } | string[] | null | undefined, global = false): ModelicaElement | null {
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
  resolveComponentReference(componentReference: any): ModelicaElement | null {
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
  resolveSimpleName(name: string): ModelicaElement | null {
    const resolver = this.db.query<(n: string, enc?: boolean) => SymbolEntry | null>("resolveSimpleName", this.id);
    const resolved = resolver?.(name);
    if (!resolved) return null;

    if (resolved.kind === "Component") {
      return new ModelicaComponentInstance(resolved.id, this.db);
    }
    if (resolved.kind === "Class") {
      let arrayDims = null;
      try {
        arrayDims = this.db.query("arrayDimensions", resolved.id);
      } catch {
        // Ignored
      }
      if (arrayDims && (arrayDims as any[]).length > 0)
        return new ModelicaArrayClassInstance(resolved.id, this.db, arrayDims as any[]);

      const meta = resolved.metadata as Record<string, unknown>;
      if (meta?.isPredefined) {
        if (resolved.name === "Integer") return new ModelicaIntegerClassInstance(resolved.id, this.db);
        if (resolved.name === "Boolean") return new ModelicaBooleanClassInstance(resolved.id, this.db);
        if (resolved.name === "String") return new ModelicaStringClassInstance(resolved.id, this.db);
        if (resolved.name === "Real") return new ModelicaRealClassInstance(resolved.id, this.db);
      }
      if (meta?.isEnumeration) return new ModelicaEnumerationClassInstance(resolved.id, this.db);

      return new ModelicaClassInstance(resolved.id, this.db);
    }
    return new ModelicaElement(resolved.id, this.db);
  }

  /**
   * Clone this class with a different modification.
   * Replaces `ModelicaClassInstance.clone()`.
   */
  clone(modification: ModelicaModArgs): ModelicaClassInstance {
    const newId = this.db.specialize(this.id, modelicaMod(modification));
    return new ModelicaClassInstance(newId, this.db);
  }

  /**
   * Get the active modification for this instance.
   * Returns null for non-specialized (base) instances.
   */
  get modification(): ModelicaModification | null {
    const modArgs = this.db.argsOf<ModelicaModArgs>(this.id)?.data;
    if (!modArgs) return null;
    return new ModelicaModification(modArgs, this.db);
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
  isTypeCompatibleWith(other: ModelicaClassInstance): boolean {
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
  get extendsClassInstances(): { classInstance: ModelicaClassInstance | null }[] {
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
      return { classInstance: baseEntry?.id ? (this.wrapElement(baseEntry.id) as ModelicaClassInstance) : null };
    });
  }

  /** Components with variability=parameter. */
  get parameters(): ModelicaComponentInstance[] {
    return this.elements.filter(
      (e): e is ModelicaComponentInstance => e instanceof ModelicaComponentInstance && e.variability === "parameter",
    );
  }

  /** Components with variability=constant. */
  get constants(): ModelicaComponentInstance[] {
    return this.elements.filter(
      (e): e is ModelicaComponentInstance => e instanceof ModelicaComponentInstance && e.variability === "constant",
    );
  }

  /** Components with causality=input. */
  get inputComponents(): ModelicaComponentInstance[] {
    return this.elements.filter(
      (e): e is ModelicaComponentInstance => e instanceof ModelicaComponentInstance && e.causality === "input",
    );
  }

  /** Components with causality=output. */
  get outputComponents(): ModelicaComponentInstance[] {
    return this.elements.filter(
      (e): e is ModelicaComponentInstance => e instanceof ModelicaComponentInstance && e.causality === "output",
    );
  }

  /** Check if this class is a connector. */
  get isConnector(): boolean {
    return this.db.query<boolean>("isConnector", this.id) ?? false;
  }

  #protectedElementsCache?: Set<string>;

  /** Check if a named element is protected. */
  isProtectedElement(name: string): boolean {
    if (this.#protectedElementsCache !== undefined) {
      return this.#protectedElementsCache.has(name);
    }
    const protectedSet = new Set<string>();
    const ids = this.db.query<SymbolId[]>("elements", this.id) ?? [];
    for (const id of ids) {
      const entry = this.db.symbol(id);
      if (entry && (entry.metadata as any)?.visibility === "protected") {
        protectedSet.add(entry.name);
      }
    }
    this.#protectedElementsCache = protectedSet;
    return protectedSet.has(name);
  }
}

// ---------------------------------------------------------------------------
// ModelicaComponentInstance
// ---------------------------------------------------------------------------

/**
 * Adapts the ModelicaComponentInstance API to the QueryEngine.
 */
export class ModelicaComponentInstance extends ModelicaClassInstance {
  get isComponentInstance(): boolean {
    return true;
  }

  /** The enclosing class instance that contains this component. */
  get parent(): ModelicaClassInstance | null {
    const parentId = this.entry?.parentId;
    if (parentId === null || parentId === undefined) return null;
    return new ModelicaClassInstance(parentId, this.db);
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
  override resolveSimpleName(name: string): ModelicaElement | null {
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
   * Returns a ModelicaClassInstance wrapping the (possibly specialized) class.
   */
  get classInstance(): ModelicaClassInstance | null {
    const classId = this.db.query<SymbolId | null>("classInstance", this.id);
    if (classId === null) return null;

    const classEntry = this.db.symbol(classId);
    if (classEntry) {
      const meta = classEntry.metadata as Record<string, unknown>;
      const arrayDims = this.db.query("arrayDimensions", this.id);
      if (arrayDims && (arrayDims as any[]).length > 0)
        return new ModelicaArrayClassInstance(classId, this.db, arrayDims as any[]);

      if (meta?.isPredefined) {
        if (classEntry.name === "Integer") return new ModelicaIntegerClassInstance(classId, this.db);
        if (classEntry.name === "Boolean") return new ModelicaBooleanClassInstance(classId, this.db);
        if (classEntry.name === "String") return new ModelicaStringClassInstance(classId, this.db);
        if (classEntry.name === "Real") return new ModelicaRealClassInstance(classId, this.db);
      }
      if (meta?.isEnumeration) return new ModelicaEnumerationClassInstance(classId, this.db);
    }
    return new ModelicaClassInstance(classId, this.db);
  }

  /** Alias for classInstance, for legacy compatibility. */
  get declaredType(): ModelicaClassInstance | null {
    return this.classInstance;
  }

  /**
   * Get the active modification for this instance.
   * Returns a merged modification combining specialized model arguments and inline AST bindings.
   */
  override get modification(): any /* MergedModification | ModelicaModification | AstBackedModification | null */ {
    // 1. Specialized arguments via polyglot db (e.g. from a cloned instance path)
    const modArgs = this.db.argsOf<ModelicaModArgs>(this.id)?.data;
    const dbMod = modArgs ? new ModelicaModification(modArgs, this.db) : null;

    // 2. Inline bindings from the AST (e.g., `start=1` or `= 9.81`)
    const ast = this.abstractSyntaxNode;
    const rawAstMod =
      ast?.modification ??
      ast?.declaration?.modification ??
      ast?.componentDeclarations?.[0]?.modification ??
      ast?.declarations?.[0]?.modification;
    const astMod = rawAstMod ? new AstBackedModification(rawAstMod, this.parent) : null;

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

export class ModelicaExtendsClassInstance extends ModelicaClassInstance {
  override accept<R, A>(visitor: any, argument?: A): R {
    return visitor.visitExtendsClassInstance(this, argument);
  }

  // Override getters that would issue ClassDefinition-specific queries
  // against an ExtendsClause id, causing a crash.
  get isPartial(): boolean {
    return false;
  }
  get extendsClassInstances(): { classInstance: ModelicaClassInstance | null }[] {
    return [];
  }
  get nestedClasses(): ModelicaClassInstance[] {
    return [];
  }
  get connectEquations(): any[] {
    return [];
  }
  get parameters(): any[] {
    return [];
  }
  get elements(): ModelicaElement[] {
    return [];
  }

  /** Resolve the base class referenced by this extends clause. */
  get classInstance(): ModelicaClassInstance | null {
    const baseEntry = this.db.query<{ id: SymbolId } | null>("resolvedBaseClass", this.id);
    if (!baseEntry?.id) return null;
    const entry = this.db.symbol(baseEntry.id);
    if (!entry) return null;
    const meta = entry.metadata as Record<string, unknown>;
    if (meta?.isPredefined) {
      if (entry.name === "Integer") return new ModelicaIntegerClassInstance(baseEntry.id, this.db);
      if (entry.name === "Boolean") return new ModelicaBooleanClassInstance(baseEntry.id, this.db);
      if (entry.name === "String") return new ModelicaStringClassInstance(baseEntry.id, this.db);
      if (entry.name === "Real") return new ModelicaRealClassInstance(baseEntry.id, this.db);
    }
    if (meta?.isEnumeration) return new ModelicaEnumerationClassInstance(baseEntry.id, this.db);
    return new ModelicaClassInstance(baseEntry.id, this.db);
  }
}

export class ModelicaElementModification {
  constructor(public readonly arg: ModificationArg) {}

  get name() {
    return this.arg.name;
  }

  get modification() {
    return new ModelicaModification(this.arg.nestedArgs as any, undefined);
  }

  get modificationExpression() {
    if (!this.arg.value) return null;
    return { expression: this.expression };
  }

  get expression() {
    return polyfillAccept(this.arg.value);
  }
}

export class AstBackedElementModification {
  constructor(
    public readonly ast: any,
    public readonly scope: any = null,
  ) {}

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
    return new AstBackedModification(this.ast.modification, this.scope);
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
  description: string | null = null;

  constructor(
    public readonly ast: any,
    public readonly scope: any = null,
  ) {}

  get modificationArguments() {
    const classMod =
      this.ast.classModification ??
      this.ast.modification?.classModification ??
      this.ast.annotationClause?.classModification;
    if (!classMod) return [];
    const args = classMod.modificationArguments ?? [];
    return args.map((a: any) => new AstBackedElementModification(a, this.scope));
  }

  get modificationExpression() {
    const modExpr = this.ast.modificationExpression ?? this.ast.modification?.modificationExpression;
    if (!modExpr) return null;
    return { expression: modExpr.expression };
  }

  get expression() {
    return polyfillAccept(this.modificationExpression?.expression);
  }

  get evaluatedExpression() {
    if (!this.expression) return null;

    // Return the syntax node/polyfilled expression itself, NOT the primitive value!
    // The flattener expects ModelicaExpression AST nodes, not raw primitives.
    if ("value" in this.expression) {
      return this.expression;
    }

    const t = this.expression.text;
    if (!t) return null;

    const tType = this.expression.type ?? this.expression["@type"];
    if (
      tType === "BOOLEAN" ||
      tType === "boolean_literal" ||
      tType === "STRING" ||
      tType === "string_literal" ||
      tType === "UNSIGNED_INTEGER" ||
      tType === "UNSIGNED_REAL" ||
      tType === "unsigned_integer_literal" ||
      tType === "unsigned_real_literal"
    ) {
      return this.expression;
    }

    // Fallback for strings which use .text instead of .value
    if (t.startsWith('"') && t.endsWith('"')) {
      return this.expression;
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

  get scope() {
    return this.dbMod?.scope ?? this.astMod?.scope;
  }

  getModificationArgument(name: string) {
    const arg = this.dbMod.getModificationArgument(name);
    if (arg) return arg;
    return this.astMod.getModificationArgument(name);
  }
}

export class ModelicaModification {
  description: string | null = null;

  constructor(
    public readonly modArgs: ModelicaModArgs | null,
    public db?: QueryDB,
  ) {}

  get modificationArguments() {
    return this.modArgs?.args.map((a) => new ModelicaElementModification(a)) ?? [];
  }

  get modificationExpression() {
    if (!this.modArgs?.bindingExpression) return null;
    return { expression: this.expression };
  }

  get expression() {
    return polyfillAccept(this.modArgs?.bindingExpression);
  }

  get scope(): ModelicaClassInstance | null {
    if (this.modArgs?.evaluationScopeId !== undefined && this.modArgs.evaluationScopeId !== null) {
      return new ModelicaClassInstance(this.modArgs.evaluationScopeId, this.db!);
    }
    return null;
  }

  get evaluatedExpression() {
    // Return the polyfilled syntax node, not the primitive value, as the
    // ModelicaFlattener expects ModelicaExpression AST nodes.
    if (this.expression?.kind === "literal" || this.expression?.type) return this.expression;
    return null;
  }

  getModificationArgument(name: string): ModelicaElementModification | undefined {
    return this.modificationArguments.find((a: any) => a.arg.name === name);
  }
}

export class ModelicaPredefinedClassInstance extends ModelicaClassInstance {}
export class ModelicaIntegerClassInstance extends ModelicaPredefinedClassInstance {}
export class ModelicaBooleanClassInstance extends ModelicaPredefinedClassInstance {}
export class ModelicaStringClassInstance extends ModelicaPredefinedClassInstance {}
export class ModelicaEnumerationClassInstance extends ModelicaPredefinedClassInstance {}

export class ModelicaRealClassInstance extends ModelicaPredefinedClassInstance {
  override accept<R, A>(visitor: any, argument?: A): R {
    if (visitor.visitRealClassInstance) {
      return visitor.visitRealClassInstance(this, argument);
    }
  }

  get unit(): any {
    return this.modification?.getModificationArgument("unit")?.expression ?? null;
  }
}
export class ModelicaArrayClassInstance extends ModelicaClassInstance {
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
    const dims = this._arrayDims ?? this.db.query<any[]>("arrayDimensions", this.id) ?? [];
    return dims.map((dim: any) => {
      if (dim && dim.expression) {
        return { ...dim, expression: polyfillAccept(dim.expression) };
      }
      return { expression: polyfillAccept(dim) };
    });
  }

  get enumDimensions(): any[] {
    return [];
  }

  get elementClassInstance(): ModelicaClassInstance {
    const classEntry = this.db.symbol(this.id);
    if (classEntry) {
      const meta = classEntry.metadata as Record<string, unknown>;
      if (meta?.isPredefined) {
        if (classEntry.name === "Integer") return new ModelicaIntegerClassInstance(this.id, this.db);
        if (classEntry.name === "Boolean") return new ModelicaBooleanClassInstance(this.id, this.db);
        if (classEntry.name === "String") return new ModelicaStringClassInstance(this.id, this.db);
        if (classEntry.name === "Real") return new ModelicaRealClassInstance(this.id, this.db);
      }
      if (meta?.isEnumeration) return new ModelicaEnumerationClassInstance(this.id, this.db);
    }
    return new ModelicaClassInstance(this.id, this.db);
  }
}

export class ModelicaShortClassInstance extends ModelicaClassInstance {}
export class ModelicaClockClassInstance extends ModelicaClassInstance {}
export class ModelicaExpressionClassInstance extends ModelicaClassInstance {
  override accept<R, A>(visitor: any, argument?: A): R {
    return visitor.visitExpressionClassInstance(this, argument);
  }
}
