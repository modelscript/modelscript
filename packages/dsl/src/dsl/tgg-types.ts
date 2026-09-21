/**
 * Triple Graph Grammar (TGG) & DPO Graph Rewriting Declarative DSL.
 */

export interface TGGPattern {
  /** The syntax node type or fact predicate to match/create */
  nodeType: string;
  /** Named variable bindings or literal values */
  bindings: Record<string, any>;
  /** Optional inner/nested patterns for child elements or body */
  children?: TGGPattern[];
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
  | "invertible";

export interface TGGConstraint {
  kind: TGGConstraintKind;
  args: any[];
}

export interface TGGRuleOptions<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  name: string;
  /** Existing structural prerequisites in source, target, and correspondence */
  context?: (
    $: any,
    v: (name: string) => any,
  ) => {
    source?: TGGPattern | any;
    target?: TGGPattern | any;
    corr?: TGGPattern | any;
  };
  /** Source language pattern (matched in forward, created in backward) */
  source: ($: any, v: (name: string) => any) => TGGPattern | any;
  /** Target language pattern (created in forward, matched in backward) */
  target: ($: any, v: (name: string) => any) => TGGPattern | any;
  /** Bidirectional attribute constraints and value mapping equations */
  where?: (v: (name: string) => any) => TGGConstraint[];
  /** Priority override (default: 0, higher wins in dispatch) */
  priority?: number;
}

export interface PolyglotConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** Target language identifiers this language can project to/from */
  languages?: string[];
  /** Declarative TGG rules */
  rules?: TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs>[];
  /** Type mapping tables between source and target primitive types */
  typeMaps?: Record<string, Record<string, string>>;
  /** Reasoner predicates that supply inferred facts for TGG matching (e.g. ['subClassOf', 'hasFeature']) */
  reasonerBindings?: string[];
}

/**
 * Declares a Triple Graph Grammar (TGG) transformation rule.
 */
export function tggRule<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
>(
  options: TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs>,
): TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs> {
  return options;
}

export function tggEq(a: any, b: any): TGGConstraint {
  return { kind: "eq", args: [a, b] };
}

export function tggTypeMap(
  sourceVar: any,
  targetVar: any,
  mapOrLangName: string | Record<string, string>,
): TGGConstraint {
  return { kind: "typeMap", args: [sourceVar, targetVar, mapOrLangName] };
}

export function tggDefaultVal(targetVar: any, value: any): TGGConstraint {
  return { kind: "defaultVal", args: [targetVar, value] };
}

export function tggFormatUri(idVar: any, prefix: string, targetVar: any): TGGConstraint {
  return { kind: "formatUri", args: [idVar, prefix, targetVar] };
}

export function tggMapList(sourceListVar: any, targetListVar: any, mapper: (item: any) => any): TGGConstraint {
  return { kind: "mapList", args: [sourceListVar, targetListVar, mapper] };
}

export function tggCompute(targetVar: any, queryName: string, sourceVar: any): TGGConstraint {
  return { kind: "compute", args: [targetVar, queryName, sourceVar] };
}

/**
 * Negative Application Condition (NAC) — ensures forbidden subgraph is absent.
 */
export function tggNot(pattern: any): TGGConstraint {
  return { kind: "not", args: [pattern] };
}

/**
 * Property path expression traversing multi-edge non-tree relations.
 */
export function tggPath(sourceVar: any, pathString: string, targetVar: any): TGGConstraint {
  return { kind: "path", args: [sourceVar, pathString, targetVar] };
}

/**
 * Multi-amalgamated 1-to-N rule expansion over collections.
 */
export function tggForEach(collectionVar: any, itemVar: any, bodyConstraints: TGGConstraint[]): TGGConstraint {
  return { kind: "forEach", args: [collectionVar, itemVar, bodyConstraints] };
}

/**
 * Declarative conflict reconciliation strategy for concurrent multi-master edits.
 */
export function tggReconcile(
  sourceVar: any,
  targetVar: any,
  strategy: "smt-simplex" | "source-wins" | "target-wins" | "prefer-narrower-range" | "physics-simplex" = "smt-simplex",
): TGGConstraint {
  return { kind: "reconcile", args: [sourceVar, targetVar, strategy] };
}

/**
 * Physics-constrained reconciliation with boundary envelopes and conservation tolerance.
 */
export function tggReconcilePhysics(
  sourceVar: any,
  targetVar: any,
  bounds: { min: number; max: number; tolerance?: number },
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

export interface TGGThreadRuleOptions<DomainNames extends string = string> {
  name?: string;
  domains: Record<DomainNames, (patternBuilder: any, varProxy: (name: string) => string) => any>;
  where?: (varProxy: (name: string) => string) => TGGConstraint[];
  priority?: number;
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
  bindings?: Record<string, any>;
}

export interface DpoRuleBuilder {
  preserve(nodeType: string, bindings?: Record<string, any>): any;
  delete(nodeType: string, bindings?: Record<string, any>): any;
  create(nodeType: string, bindings?: Record<string, any>): any;
  danglingEdgePolicy(policy: "strict" | "cascade"): void;
  where(constraintFn: (varProxy: (name: string) => string) => TGGConstraint[]): void;
}

export interface TGGDpoRuleOptions {
  name: string;
  domain: string;
  elements: DpoElementSpec[];
  danglingEdgePolicy?: "strict" | "cascade";
  targetSyncDomain?: string;
  targetSyncHandler?: (srcReq: any, targetBlock: any) => void;
  where?: TGGConstraint[];
}

export class TGGDpoRuleFluentBuilder {
  private _name: string;
  private _domain: string = "";
  private _elements: DpoElementSpec[] = [];
  private _danglingEdgePolicy: "strict" | "cascade" = "strict";
  private _targetSyncDomain?: string;
  private _targetSyncHandler?: (srcReq: any, targetBlock: any) => void;
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

  synchronizeTarget(domain: string, handler?: (srcReq: any, targetBlock: any) => void): this {
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
