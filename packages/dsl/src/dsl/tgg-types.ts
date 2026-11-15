// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Triple Graph Grammar (TGG) & DPO Graph Rewriting Declarative DSL.
 */

export type TGGExprPattern =
  | { kind: "binary"; op: string; left: unknown; right: unknown }
  | { kind: "unary"; op: string; arg: unknown }
  | { kind: "der"; stateVar: unknown; order?: number | undefined }
  | { kind: "call"; func: string; args: unknown[] }
  | { kind: "ident"; name: unknown }
  | { kind: "literal"; val: unknown };

export type TGGPatternBuilderProxy = Record<string, (...args: unknown[]) => TGGPattern>;

export interface TGGPattern {
  /** The syntax node type or fact predicate to match/create */
  nodeType: string;
  /** Named variable bindings or literal values */
  bindings: Record<string, unknown>;
  /** Optional inner/nested patterns for child elements or body */
  children?: TGGPattern[] | undefined;
  /** Optional recursive AST expression for mathematical equations / constraints */
  expr?: TGGExprPattern | undefined;
}

export type TGGConstraintKind =
  | "eq"
  | "typeMap"
  | "defaultVal"
  | "formatUri"
  | "mapList"
  | "compute"
  | "not"
  | "path"
  | "forEach"
  | "reconcile"
  | "reconcilePhysics"
  | "complement"
  | "invertible"
  | "exprMap"
  | "physicalPort";

export interface TGGConstraint {
  kind: TGGConstraintKind;
  args: unknown[];
}

export interface TGGRuleOptions<
  _RuleName extends string = string,
  _FieldName extends string = string,
  _QueryName extends string = string,
  _ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
> {
  name: string;
  /** Existing structural prerequisites in source, target, and correspondence */
  context?:
    | ((
        $: TGGPatternBuilderProxy,
        v: (name: string) => string,
      ) => {
        source?: TGGPattern | unknown;
        target?: TGGPattern | unknown;
        corr?: TGGPattern | unknown;
      })
    | undefined;
  /** Source language pattern (matched in forward, created in backward) */
  source: ($: TGGPatternBuilderProxy, v: (name: string) => string) => TGGPattern | unknown;
  /** Target language pattern (created in forward, matched in backward) */
  target: ($: TGGPatternBuilderProxy, v: (name: string) => string) => TGGPattern | unknown;
  /** Bidirectional attribute constraints and value mapping equations */
  where?: ((v: (name: string) => string) => TGGConstraint[]) | undefined;
  /** Priority override (default: 0, higher wins in dispatch) */
  priority?: number | undefined;
  /** Target language identifier for multi-target polyglot dispatch */
  targetLang?: string | undefined;
  /** Source language identifier */
  sourceLang?: string | undefined;
}

export interface PolyglotConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
> {
  /** Target language identifiers this language can project to/from */
  languages?: string[] | undefined;
  /** Declarative TGG rules */
  rules?: TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs>[] | undefined;
  /** Type mapping tables between source and target primitive types */
  typeMaps?: Record<string, Record<string, string>> | undefined;
  /** Reasoner predicates that supply inferred facts for TGG matching (e.g. ['subClassOf', 'hasFeature']) */
  reasonerBindings?: string[] | undefined;
}

/**
 * Declares a Triple Graph Grammar (TGG) transformation rule.
 */
export function tggRule<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  options: TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs>,
): TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs> {
  return options;
}

export function tggEq(a: unknown, b: unknown): TGGConstraint {
  return { kind: "eq", args: [a, b] };
}

export function tggTypeMap(
  sourceVar: unknown,
  targetVar: unknown,
  mapOrLangName: string | Record<string, string>,
): TGGConstraint {
  return { kind: "typeMap", args: [sourceVar, targetVar, mapOrLangName] };
}

export function tggDefaultVal(targetVar: unknown, value: unknown): TGGConstraint {
  return { kind: "defaultVal", args: [targetVar, value] };
}

export function tggFormatUri(idVar: unknown, prefix: string, targetVar: unknown): TGGConstraint {
  return { kind: "formatUri", args: [idVar, prefix, targetVar] };
}

export function tggMapList(
  sourceListVar: unknown,
  targetListVar: unknown,
  mapper: { bivarianceHack(item: unknown): unknown }["bivarianceHack"],
): TGGConstraint {
  return { kind: "mapList", args: [sourceListVar, targetListVar, mapper] };
}

export function tggCompute(targetVar: unknown, queryName: string, sourceVar: unknown): TGGConstraint {
  return { kind: "compute", args: [targetVar, queryName, sourceVar] };
}

/**
 * Negative Application Condition (NAC) — ensures forbidden subgraph is absent.
 */
export function tggNot(pattern: unknown): TGGConstraint {
  return { kind: "not", args: [pattern] };
}

/**
 * Property path expression traversing multi-edge non-tree relations.
 */
export function tggPath(sourceVar: unknown, pathString: string, targetVar: unknown): TGGConstraint {
  return { kind: "path", args: [sourceVar, pathString, targetVar] };
}

/**
 * Multi-amalgamated 1-to-N rule expansion over collections.
 */
export function tggForEach(collectionVar: unknown, itemVar: unknown, bodyConstraints: TGGConstraint[]): TGGConstraint {
  return { kind: "forEach", args: [collectionVar, itemVar, bodyConstraints] };
}

/**
 * Declarative conflict reconciliation strategy for concurrent multi-master edits.
 */
export function tggReconcile(
  sourceVar: unknown,
  targetVar: unknown,
  strategy: "smt-simplex" | "source-wins" | "target-wins" | "prefer-narrower-range" | "physics-simplex" = "smt-simplex",
): TGGConstraint {
  return { kind: "reconcile", args: [sourceVar, targetVar, strategy] };
}

/**
 * Physics-constrained reconciliation with boundary envelopes and conservation tolerance.
 */
export function tggReconcilePhysics(
  sourceVar: unknown,
  targetVar: unknown,
  bounds: { min: number; max: number; tolerance?: number | undefined },
): TGGConstraint {
  return { kind: "reconcilePhysics", args: [sourceVar, targetVar, bounds] };
}

/**
 * Shadow complement constraint preserving unmapped fields during asymmetric round-trips.
 */
export function tggComplement(fields: string[]): TGGConstraint {
  return { kind: "complement", args: [fields] };
}

/**
 * Bidirectional invertible affine or string constraint.
 */
export function tggInvertible(forwardExpr: string, backwardExpr?: string): TGGConstraint {
  return { kind: "invertible", args: [forwardExpr, backwardExpr] };
}

/**
 * Cross-language mathematical expression mapping.
 */
export function tggExprMap(
  sourceExprVar: unknown,
  targetExprVar: unknown,
  dialect: "modelica-sysml2" | "sysml2-modelica" | string = "modelica-sysml2",
): TGGConstraint {
  return { kind: "exprMap", args: [sourceExprVar, targetExprVar, dialect] };
}

/**
 * Constitutive physical port balance constraint matching across (potential) and through (flow) variables.
 */
export function tggPhysicalPort(
  acrossVar: unknown,
  flowVar: unknown,
  domain: "electrical" | "fluid" | "rotational" | "translational" | "thermal" | string = "electrical",
): TGGConstraint {
  return { kind: "physicalPort", args: [acrossVar, flowVar, domain] };
}

/**
 * Infix binary operation expression pattern.
 */
export function tggBinary(op: string, left: unknown, right: unknown): TGGExprPattern {
  return { kind: "binary", op, left, right };
}

/**
 * State variable time derivative expression pattern.
 */
export function tggDer(stateVar: unknown, order: number = 1): TGGExprPattern {
  return { kind: "der", stateVar, order };
}

/**
 * Elementary math function call expression pattern.
 */
export function tggCall(func: string, args: unknown[]): TGGExprPattern {
  return { kind: "call", func, args };
}

export interface TGGThreadRuleOptions<DomainNames extends string = string> {
  name?: string | undefined;
  domains: Record<DomainNames, (patternBuilder: TGGPatternBuilderProxy, varProxy: (name: string) => string) => unknown>;
  where?: ((varProxy: (name: string) => string) => TGGConstraint[]) | undefined;
  priority?: number | undefined;
}

/**
 * Declares an N-Ary Digital Thread alignment rule across N >= 2 domain projections.
 */
export function tggThreadRule<DomainNames extends string = string>(
  options: TGGThreadRuleOptions<DomainNames>,
): TGGThreadRuleOptions<DomainNames> {
  return options;
}

// ---------------------------------------------------------------------------
// In-Place DPO (Double Pushout) Graph Rewriting Declarative DSL
// ---------------------------------------------------------------------------

export interface DpoElementSpec {
  action: "preserve" | "delete" | "create";
  nodeType: string;
  bindings?: Record<string, unknown> | undefined;
}

export interface DpoRuleBuilder {
  preserve(nodeType: string, bindings?: Record<string, unknown>): DpoElementSpec;
  delete(nodeType: string, bindings?: Record<string, unknown>): DpoElementSpec;
  create(nodeType: string, bindings?: Record<string, unknown>): DpoElementSpec;
  danglingEdgePolicy(policy: "strict" | "cascade"): void;
  where(constraintFn: (varProxy: (name: string) => string) => TGGConstraint[]): void;
}

export interface TGGDpoRuleOptions {
  name: string;
  domain: string;
  elements: DpoElementSpec[];
  danglingEdgePolicy?: "strict" | "cascade" | undefined;
  targetSyncDomain?: string | undefined;
  targetSyncHandler?: { bivarianceHack(srcReq: unknown, targetBlock: unknown): void }["bivarianceHack"] | undefined;
  where?: TGGConstraint[] | undefined;
}

export class TGGDpoRuleFluentBuilder {
  private _name: string;
  private _domain: string = "";
  private _elements: DpoElementSpec[] = [];
  private _danglingEdgePolicy: "strict" | "cascade" = "strict";
  private _targetSyncDomain?: string | undefined;
  private _targetSyncHandler?:
    | { bivarianceHack(srcReq: unknown, targetBlock: unknown): void }["bivarianceHack"]
    | undefined;
  private _constraints: TGGConstraint[] = [];

  constructor(name: string) {
    this._name = name;
  }

  inPlace(domain: string, builder: (rule: DpoRuleBuilder) => void): this {
    this._domain = domain;
    const ruleHelper: DpoRuleBuilder = {
      preserve: (nodeType, bindings) => {
        const spec: DpoElementSpec = { action: "preserve", nodeType, bindings };
        this._elements.push(spec);
        return { nodeType, bindings, action: "preserve" };
      },
      delete: (nodeType, bindings) => {
        const spec: DpoElementSpec = { action: "delete", nodeType, bindings };
        this._elements.push(spec);
        return { nodeType, bindings, action: "delete" };
      },
      create: (nodeType, bindings) => {
        const spec: DpoElementSpec = { action: "create", nodeType, bindings };
        this._elements.push(spec);
        return { nodeType, bindings, action: "create" };
      },
      danglingEdgePolicy: (policy) => {
        this._danglingEdgePolicy = policy;
      },
      where: (fn) => {
        this._constraints.push(...fn((name: string) => `__var_${name}`));
      },
    };
    builder(ruleHelper);
    return this;
  }

  synchronizeTarget(
    domain: string,
    handler?: { bivarianceHack(srcReq: unknown, targetBlock: unknown): void }["bivarianceHack"],
  ): this {
    this._targetSyncDomain = domain;
    this._targetSyncHandler = handler;
    return this;
  }

  build(): TGGDpoRuleOptions {
    return {
      name: this._name,
      domain: this._domain,
      elements: this._elements,
      danglingEdgePolicy: this._danglingEdgePolicy,
      targetSyncDomain: this._targetSyncDomain,
      targetSyncHandler: this._targetSyncHandler,
      where: this._constraints,
    };
  }
}

/**
 * Declares an in-place DPO (Double Pushout) algebraic graph rewriting rule.
 */
export function tggRewriteRule(name: string): TGGDpoRuleFluentBuilder {
  return new TGGDpoRuleFluentBuilder(name);
}
