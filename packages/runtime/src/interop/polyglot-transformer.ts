/**
 * Generic Polyglot Transformer: Language-agnostic graph transformation and semantic reasoner engine.
 *
 * Supports Triple Graph Grammar (TGG) rule registration, dynamic target language code emitters,
 * and DL-Lite/OWL2 semantic reasoner feature inference across multi-language model graphs.
 */

import type { PolyglotConfig, TGGDpoRuleOptions, TGGRuleOptions } from "@modelscript/dsl/dsl/language.js";
import {
  AbstractDomainOracle,
  ConstraintTheoryOracle,
  DimensionalTheoryOracle,
  FlowAlgebraOracle,
  OntologyTheoryOracle,
} from "../formal/oracles/index.js";
import {
  SemanticTheoryCoordinator,
  type CoordinatorSatResult,
  type TheoryLiteral,
} from "../formal/theory_coordinator.js";
import { WorkspaceTypeRegistry } from "../util/type_registry.js";
import { DigitalThreadHypergraph } from "./thread_hypergraph.js";
import { DOMAIN_NAME_TO_INDEX } from "./thread_serializer.js";

/**
 * Generic, schema-agnostic node model for polyglot cross-language graph transformation.
 * Unifies AST and symbol representations across multiple source and target modeling languages.
 */
export interface PolyglotNode {
  /** The primary unqualified identifier or name of the model element. */
  name: string;
  /** Optional syntactic or semantic kind (e.g., `"model"`, `"block"`, `"class"`, `"part def"`). */
  kind?: string;
  /** Whether the model definition represents an abstract or uninstantiable type. */
  isAbstract?: boolean;
  /** Whether the model is declared as a partial class. */
  isPartial?: boolean;
  /** Superclass or base type names inherited by this model. */
  superclasses?: string[];
  /** Base class or inheritance clauses. */
  extends?: string[];
  /** Primitive or structured attribute fields defined on the node. */
  attributes?: {
    name: string;
    type: string;
    value?: string;
    isInherited?: boolean;
  }[];
  /** Interaction points, flow ports, or physical connectors. */
  ports?: {
    name: string;
    type: string;
    isInherited?: boolean;
  }[];
  /** Sub-components, inner declarations, or child instances. */
  components?: {
    name: string;
    typeSpecifier: string;
    variability?: string;
    causality?: string;
    defaultValue?: string;
    isInherited?: boolean;
  }[];
  /** Topological bindings or connector equations between sub-elements. */
  connections?: {
    source: string;
    target: string;
  }[];
  /** Dynamic extension properties for custom language schemas. */
  [key: string]: any;
}

/**
 * Function signature for language-specific AST/graph code emitters.
 *
 * @param node - The polyglot AST node to transform.
 * @param transformer - The active `PolyglotTransformer` instance providing query and reasoner contexts.
 * @returns The synthesized target language source code string.
 */
export type PolyglotEmitter = (node: PolyglotNode, transformer: PolyglotTransformer) => string;

/**
 * Polyglot Transformation Engine that evaluates TGG rules over model graphs,
 * supporting transitive inheritance and synthetic reasoner-inferred elements.
 */
export class PolyglotTransformer {
  /** Registered Triple Graph Grammar (TGG) transformation rules. */
  private rules: TGGRuleOptions[] = [];
  /** Cross-language type mapping dictionaries. */
  private typeMaps: Record<string, Record<string, string>> = {};
  /** Ontological fact store storing predicate triples (e.g., `hasFeature: subject -> object`). */
  private reasonerFacts = new Map<string, { subject: string; object: string }[]>();
  /** Dynamic registry of target language code emitters. */
  private emitters = new Map<string, PolyglotEmitter>();
  /** Dynamic workspace type mapping registry. */
  public typeRegistry: WorkspaceTypeRegistry;
  /** Formal Theory Coordinator orchestrating incremental satisfiability over TGG invariants */
  public coordinator: SemanticTheoryCoordinator;
  /** Tracked literal IDs per thread slot for incremental retraction */
  private threadSlotToLiteralIds = new Map<number, number[]>();

  /**
   * Initializes a new PolyglotTransformer instance.
   *
   * @param config - Optional configuration declaring TGG rules, type mappings, and reasoner bindings.
   * @param typeRegistry - Optional custom WorkspaceTypeRegistry instance.
   * @param coordinator - Optional custom SemanticTheoryCoordinator instance.
   */
  constructor(config?: PolyglotConfig, typeRegistry?: WorkspaceTypeRegistry, coordinator?: SemanticTheoryCoordinator) {
    this.typeRegistry = typeRegistry || new WorkspaceTypeRegistry();
    this.coordinator = coordinator || new SemanticTheoryCoordinator();
    if (!coordinator) {
      this.coordinator.registerOracle(new OntologyTheoryOracle());
      this.coordinator.registerOracle(new ConstraintTheoryOracle());
      this.coordinator.registerOracle(new AbstractDomainOracle());
      this.coordinator.registerOracle(new DimensionalTheoryOracle());
      this.coordinator.registerOracle(new FlowAlgebraOracle());
    }
    if (config) {
      this.rules = config.rules || [];
      this.typeMaps = config.typeMaps || {};
      if (config.typeMaps) {
        for (const [targetLang, mappings] of Object.entries(config.typeMaps)) {
          for (const [srcType, tgtType] of Object.entries(mappings)) {
            this.typeRegistry.registerTypeMapping("", targetLang, srcType, tgtType);
          }
        }
      }
    }
  }

  /**
   * Dynamically resolves a type name between domains using static type maps and the workspace type registry.
   */
  resolveType(sourceLang: string, targetLang: string, typeName: string, workspace?: any): string {
    const localTargetMap = this.typeMaps[targetLang.toLowerCase()];
    if (localTargetMap && localTargetMap[typeName]) {
      return localTargetMap[typeName];
    }
    return this.typeRegistry.resolveTypeMapping(sourceLang, targetLang, typeName, workspace);
  }

  /**
   * Registers a declarative TGG rule into the transformation engine.
   *
   * @param rule - The TGG rule options specifying source pattern, target pattern, and where constraints.
   */
  registerRule(rule: TGGRuleOptions): void {
    this.rules.push(rule);
  }

  /**
   * Registers a language-specific code generator / emitter for a target language identifier.
   *
   * @param targetLanguage - Target language name (case-insensitive, e.g., `"sysml2"`, `"modelica"`, `"json-schema"`).
   * @param emitter - The callback function that serializes a {@link PolyglotNode} into source code.
   */
  registerEmitter(targetLanguage: string, emitter: PolyglotEmitter): void {
    this.emitters.set(targetLanguage.toLowerCase(), emitter);
  }

  /**
   * Checks if an emitter is registered for the specified target language.
   *
   * @param targetLanguage - Target language identifier to verify.
   * @returns `true` if an emitter is registered; otherwise `false`.
   */
  hasEmitter(targetLanguage: string): boolean {
    return this.emitters.has(targetLanguage.toLowerCase());
  }

  /**
   * Adds an ontological reasoner fact (e.g. `hasFeature: "ElectricVehicle" -> "batteryCapacity:Real"`).
   *
   * @param predicate - The semantic relationship predicate (e.g., `"hasFeature"`, `"subClassOf"`).
   * @param subject - The subject class or concept identifier.
   * @param object - The target object property, feature specifier, or parent class identifier.
   */
  addReasonerFact(predicate: string, subject: string, object: string): void {
    if (!this.reasonerFacts.has(predicate)) {
      this.reasonerFacts.set(predicate, []);
    }
    this.reasonerFacts.get(predicate)!.push({ subject, object });
  }

  /**
   * Queries reasoner facts for synthetic/inferred features associated with a given class name.
   *
   * @param className - The class name to query for inferred features.
   * @returns An array of name and type pairs inferred from ontological knowledge graphs.
   */
  getInferredFeatures(className: string): { name: string; type: string }[] {
    const facts = this.reasonerFacts.get("hasFeature") || [];
    return facts
      .filter((f) => f.subject === className)
      .map((f) => {
        const parts = f.object.split(":");
        return {
          name: parts[0],
          type: parts[1] || "Real",
        };
      });
  }

  /** Registered multi-master conflicts waiting for reconciliation */
  private conflicts = new Map<
    string,
    {
      id: string;
      sourceVal: any;
      targetVal: any;
      ruleName?: string;
      resolved?: any;
      isResolved: boolean;
    }
  >();

  /**
   * Records a concurrent modification conflict between source and target models.
   */
  recordConflict(id: string, sourceVal: any, targetVal: any, ruleName?: string): void {
    this.conflicts.set(id, {
      id,
      sourceVal,
      targetVal,
      ruleName,
      isResolved: false,
    });
  }

  /**
   * Retrieves all recorded conflict items.
   */
  getConflicts(): { id: string; sourceVal: any; targetVal: any; isResolved: boolean; resolved?: any }[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Manually or programmatically reconciles a recorded conflict.
   */
  resolveConflict(id: string, resolution: "source" | "target" | any): void {
    const item = this.conflicts.get(id);
    if (!item) return;
    if (resolution === "source") {
      item.resolved = item.sourceVal;
    } else if (resolution === "target") {
      item.resolved = item.targetVal;
    } else {
      item.resolved = resolution;
    }
    item.isResolved = true;
  }

  /**
   * Evaluates Negative Application Conditions (NACs) for a given rule against a node.
   * Returns false if any forbidden subgraph / attribute pattern is present.
   */
  checkNAC(rule: TGGRuleOptions, node: PolyglotNode): boolean {
    const vProxy = (name: string) => `__var_${name}`;
    const constraints = typeof rule.where === "function" ? rule.where(vProxy) : rule.where || [];
    const nacConstraints = constraints.filter((c) => c.kind === "not");

    for (const nac of nacConstraints) {
      const [forbiddenPattern] = nac.args;
      const forbiddenName = typeof forbiddenPattern === "object" ? forbiddenPattern.nodeType : String(forbiddenPattern);

      // Check if node has a child, attribute, or port matching the forbidden pattern
      const hasMatchingAttribute = (node.attributes || []).some(
        (a) => a.name === forbiddenName || a.type === forbiddenName,
      );
      const hasMatchingPort = (node.ports || []).some((p) => p.name === forbiddenName || p.type === forbiddenName);
      const hasMatchingComponent = (node.components || []).some(
        (c) => c.name === forbiddenName || c.typeSpecifier === forbiddenName,
      );

      if (hasMatchingAttribute || hasMatchingPort || hasMatchingComponent) {
        return false; // Forbidden pattern present, rule must not apply
      }
    }
    return true;
  }

  /**
   * Resolves a multi-hop property path on a polyglot graph node (e.g. "ports/connection/target").
   */
  resolvePath(node: PolyglotNode, pathString: string): any {
    const segments = pathString.split("/");
    let current: any = node;
    for (const seg of segments) {
      if (!current || typeof current !== "object") return null;
      if (Array.isArray(current)) {
        current = current.find(
          (item) => item.name === seg || item.type === seg || item.source === seg || item.target === seg,
        );
      } else {
        current = current[seg];
      }
    }
    return current;
  }

  /** Shadow complement store preserving unmapped fields during asymmetric projection */
  private shadowComplements = new Map<string, Record<string, any>>();

  /** Set of retracted node identifiers (DBSP negative deltas) */
  private retractedNodes = new Set<string>();

  /** N-Ary digital thread alignments: threadId -> domain projections */
  private threads = new Map<string, Record<string, PolyglotNode>>();

  /** In-memory linear memory compatible Digital Thread Hypergraph */
  private hypergraph: DigitalThreadHypergraph = new DigitalThreadHypergraph();

  /** CST source ranges for live bi-directional IDE spans */
  private cstSpans = new Map<string, { startByte: number; endByte: number; line: number; column: number }>();

  /**
   * Stores unmapped shadow complement data for an asymmetric transformation.
   */
  storeComplement(id: string, data: Record<string, any>): void {
    this.shadowComplements.set(id, data);
  }

  /**
   * Retrieves shadow complement data for an asymmetric transformation.
   */
  getComplement(id: string): Record<string, any> | undefined {
    return this.shadowComplements.get(id);
  }

  /**
   * Marks a node as retracted (DBSP negative delta / deletion).
   */
  retract(id: string): boolean {
    this.retractedNodes.add(id);
    return true;
  }

  /**
   * Checks if a node has been retracted.
   */
  isRetracted(id: string): boolean {
    return this.retractedNodes.has(id);
  }

  /**
   * Registers an N-ary digital thread alignment linking multiple domain nodes.
   */
  registerThread(threadId: string, domainNodes: Record<string, PolyglotNode>): void {
    this.threads.set(threadId, domainNodes);

    // Sync with linear-memory Struct-of-Arrays hypergraph
    const numericId = parseInt(threadId.replace(/\D/g, "") || "1", 10);
    const slot = this.hypergraph.createThread(numericId);

    let pseudoNodeId = 100;
    for (const [domName, node] of Object.entries(domainNodes)) {
      const domIdx = DOMAIN_NAME_TO_INDEX[domName.toLowerCase()];
      if (domIdx !== undefined) {
        const nodeId = (node as any).id || pseudoNodeId++;
        this.hypergraph.bindDomainNode(slot, domIdx, nodeId);
      }
    }
  }

  /**
   * Retrieves the underlying DigitalThreadHypergraph instance.
   */
  getHypergraph(): DigitalThreadHypergraph {
    return this.hypergraph;
  }

  /**
   * Retrieves an N-ary digital thread alignment.
   */
  getThread(threadId: string): Record<string, PolyglotNode> | undefined {
    return this.threads.get(threadId);
  }

  /**
   * Transforms an N-ary digital thread into source code for the specified target domain.
   */
  transformThread(threadId: string, targetLanguage: string): string {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Digital thread '${threadId}' not found`);
    }
    const node = thread[targetLanguage.toLowerCase()];
    if (!node) {
      throw new Error(`No projection for domain '${targetLanguage}' in thread '${threadId}'`);
    }
    return this.transform(node, targetLanguage);
  }

  /**
   * Associates an AST element with its concrete source byte spans.
   */
  setCstSpan(id: string, span: { startByte: number; endByte: number; line: number; column: number }): void {
    this.cstSpans.set(id, span);
  }

  /**
   * Retrieves the source byte span for an element.
   */
  getCstSpan(id: string): { startByte: number; endByte: number; line: number; column: number } | undefined {
    return this.cstSpans.get(id);
  }

  /**
   * Resolves a multi-master conflict using physical boundary constraints.
   */
  resolveConflictPhysics(id: string, physMin: number, physMax: number): void {
    const item = this.conflicts.get(id);
    if (!item) return;
    const midpoint = (Number(item.sourceVal) + Number(item.targetVal)) * 0.5;
    let candidate = midpoint;
    if (candidate < physMin) candidate = physMin;
    if (candidate > physMax) candidate = physMax;
    item.resolved = candidate;
    item.isResolved = true;
  }

  /**
   * Asserts a TGG correspondence constraint into the Theory Coordinator for a thread slot.
   */
  assertTggConstraint(threadSlot: number, constraint: any, ruleName?: string): number {
    const srcCtx = { ruleName, threadSlot, constraint };
    let lit: TheoryLiteral | null = null;

    if (constraint.kind === "eq") {
      lit = {
        id: 0,
        predicate: "eq",
        args: [constraint.args?.[0] ?? constraint.varA, constraint.args?.[1] ?? constraint.varB],
        domain: "constraint",
        sourceContext: srcCtx,
      };
    } else if (constraint.kind === "interval") {
      lit = {
        id: 0,
        predicate: "interval",
        args: [
          constraint.varName ?? constraint.args?.[0],
          constraint.min ?? constraint.args?.[1],
          constraint.max ?? constraint.args?.[2],
        ],
        domain: "abstract_domain",
        sourceContext: srcCtx,
      };
    } else if (constraint.kind === "diff") {
      lit = {
        id: 0,
        predicate: "diff",
        args: [
          constraint.varA ?? constraint.args?.[0],
          constraint.varB ?? constraint.args?.[1],
          constraint.bound ?? constraint.args?.[2],
        ],
        domain: "abstract_domain",
        sourceContext: srcCtx,
      };
    } else if (constraint.kind === "unit" || constraint.kind === "dimension") {
      lit = {
        id: 0,
        predicate: "unit",
        args: [constraint.varName ?? constraint.args?.[0], constraint.dimensionVector ?? constraint.args?.[1]],
        domain: "constraint",
        sourceContext: srcCtx,
      };
    } else if (constraint.kind === "flow" || constraint.kind === "conjugate") {
      lit = {
        id: 0,
        predicate: "flow_dir",
        args: [constraint.portName ?? constraint.args?.[0], constraint.direction ?? constraint.args?.[1]],
        domain: "constraint",
        sourceContext: srcCtx,
      };
    } else if (constraint.kind === "subsumes" || constraint.kind === "isa") {
      lit = {
        id: 0,
        predicate: "subsumes",
        args: [constraint.subClass ?? constraint.args?.[0], constraint.superClass ?? constraint.args?.[1]],
        domain: "ontology",
        sourceContext: srcCtx,
      };
    } else {
      lit = {
        id: 0,
        predicate: constraint.kind || "constraint",
        args: constraint.args || [],
        domain: "constraint",
        sourceContext: srcCtx,
      };
    }

    const litId = this.coordinator.assertLiteral(lit);
    const existing = this.threadSlotToLiteralIds.get(threadSlot) || [];
    existing.push(litId);
    this.threadSlotToLiteralIds.set(threadSlot, existing);
    return litId;
  }

  /**
   * Retracts all previously asserted theory literals for the given thread slot.
   */
  retractThreadConstraints(threadSlot: number): void {
    const ids = this.threadSlotToLiteralIds.get(threadSlot) || [];
    for (const id of ids) {
      this.coordinator.retractLiteral(id);
    }
    this.threadSlotToLiteralIds.delete(threadSlot);
  }

  /**
   * Synchronizes TGG constraints with formal theory coordination for a specific thread slot.
   * Retracts old literals (if any), asserts new constraints, and updates DigitalThreadHypergraph status.
   */
  syncThreadTheory(threadSlot: number, constraints: any[], ruleName?: string): CoordinatorSatResult {
    this.retractThreadConstraints(threadSlot);
    for (const c of constraints) {
      this.assertTggConstraint(threadSlot, c, ruleName);
    }

    const satRes = this.coordinator.checkSat();
    if (satRes.isSat) {
      this.hypergraph.recordTheorySat(threadSlot, satRes.sharedEqualities);
      this.hypergraph.clearTheoryConflict(threadSlot);
    } else if (satRes.conflict) {
      this.hypergraph.recordTheoryConflict(threadSlot, satRes.conflict);
      this.recordConflict(
        satRes.conflict.explanation,
        satRes.conflict.culpritEntities[0] || "source",
        satRes.conflict.culpritEntities[1] || "target",
        ruleName,
      );
    }

    return satRes;
  }

  /**
   * Transforms a generic polyglot node graph into source code for the specified target language.
   *
   * @param node - The polyglot AST or graph node to transform.
   * @param targetLanguage - The target language identifier (e.g., `"sysml2"`, `"modelica"`).
   * @returns The generated code string formatted for the target language.
   * @throws Error if no emitter is registered for `targetLanguage`.
   */
  transform(node: PolyglotNode, targetLanguage: string): string {
    if (this.isRetracted(node.name)) {
      return `/* Node '${node.name}' retracted */`;
    }
    const emitter = this.emitters.get(targetLanguage.toLowerCase());
    if (!emitter) {
      throw new Error(`No polyglot emitter registered for target language '${targetLanguage}'`);
    }
    return emitter(node, this);
  }

  /**
   * Executes an algebraic In-Place DPO (Double Pushout) rewrite on a container node/graph.
   * Enforces the Gluing Condition (dangling edges and identification condition)
   * and emits DBSP multiset differential streams (negative retractions and positive additions).
   */
  applyInPlaceDPO(
    rule: TGGDpoRuleOptions,
    containerNode: PolyglotNode,
    matchBindings: Record<string, string>,
  ): DpoExecutionResult {
    const deleteSpecs = rule.elements.filter((e) => e.action === "delete");
    const preserveSpecs = rule.elements.filter((e) => e.action === "preserve");
    const createSpecs = rule.elements.filter((e) => e.action === "create");

    // 1. Check Identification Condition
    const matchedNames = new Set<string>();
    for (const spec of [...deleteSpecs, ...preserveSpecs]) {
      const boundName = matchBindings[spec.nodeType] || spec.bindings?.name;
      if (boundName) {
        if (matchedNames.has(boundName) && spec.action === "delete") {
          return {
            success: false,
            ruleName: rule.name,
            status: "IDENTIFICATION_VIOLATION",
          };
        }
        matchedNames.add(boundName);
      }
    }

    // 2. Check Dangling Edge Condition
    if (rule.danglingEdgePolicy === "strict" || !rule.danglingEdgePolicy) {
      const knownNodeNames = new Set<string>();
      for (const spec of [...deleteSpecs, ...preserveSpecs]) {
        const boundName = matchBindings[spec.nodeType] || spec.bindings?.name;
        if (boundName) knownNodeNames.add(boundName);
      }

      for (const delSpec of deleteSpecs) {
        const targetName = matchBindings[delSpec.nodeType] || delSpec.bindings?.name;
        if (!targetName) continue;

        const connections = (containerNode as any).connections || [];
        const incidentConns = connections.filter(
          (conn: any) =>
            conn.from?.startsWith(`${targetName}.`) ||
            conn.to?.startsWith(`${targetName}.`) ||
            conn.from === targetName ||
            conn.to === targetName,
        );

        for (const conn of incidentConns) {
          const otherEndpoint = (
            conn.from?.startsWith(`${targetName}.`) || conn.from === targetName ? conn.to : conn.from
          )?.split(".")[0];

          // If otherEndpoint is an external node not matched by the rule, it is an illegal dangling edge
          if (otherEndpoint && !knownNodeNames.has(otherEndpoint)) {
            return {
              success: false,
              ruleName: rule.name,
              status: "DANGLING_EDGE_VIOLATION",
            };
          }
        }
      }
    }

    // 3. Pushout Complement (D = G \ (L \ K)): Delete elements and retract via DBSP
    const negativeDelta: string[] = [];
    const recycledNodes: string[] = [];

    for (const delSpec of deleteSpecs) {
      const targetName = matchBindings[delSpec.nodeType] || delSpec.bindings?.name;
      if (!targetName) continue;

      if (containerNode.components) {
        const idx = containerNode.components.findIndex((c) => c.name === targetName);
        if (idx !== -1) {
          containerNode.components.splice(idx, 1);
          this.retract(targetName);
          negativeDelta.push(targetName);
          recycledNodes.push(targetName);
        }
      }

      if ((containerNode as any).connections) {
        const conns = (containerNode as any).connections;
        const remaining = conns.filter(
          (conn: any) =>
            !conn.from?.startsWith(`${targetName}.`) &&
            !conn.to?.startsWith(`${targetName}.`) &&
            conn.from !== targetName &&
            conn.to !== targetName,
        );
        (containerNode as any).connections = remaining;
      }
    }

    // 4. Pushout (H = D +_K R): Create new elements and rewire to preserved interface K
    const positiveDelta: PolyglotNode[] = [];
    const createdNodes: PolyglotNode[] = [];

    for (const createSpec of createSpecs) {
      if (createSpec.nodeType.toLowerCase().includes("connect")) {
        const connObj = {
          from: createSpec.bindings?.from,
          to: createSpec.bindings?.to,
        };
        (containerNode as any).connections = (containerNode as any).connections || [];
        (containerNode as any).connections.push(connObj);
      } else {
        const newComp: any = {
          name: createSpec.bindings?.name || `created_${createSpec.nodeType}`,
          typeSpecifier: createSpec.nodeType,
          attributes: createSpec.bindings?.attributes || [],
          value: createSpec.bindings?.value,
        };
        containerNode.components = containerNode.components || [];
        containerNode.components.push(newComp);
        createdNodes.push(newComp);
        positiveDelta.push(newComp);
      }
    }

    // 5. Coupled Target Synchronization
    let targetSyncResult: any = undefined;
    if (rule.targetSyncHandler) {
      targetSyncResult = rule.targetSyncHandler(createdNodes[0], undefined);
    }

    return {
      success: true,
      ruleName: rule.name,
      status: "SUCCESS",
      recycledNodes,
      createdNodes,
      preservedNodes: preserveSpecs.map((s) => matchBindings[s.nodeType] || s.bindings?.name || s.nodeType),
      negativeDelta,
      positiveDelta,
      targetSyncResult,
    };
  }
}

export interface DpoExecutionResult {
  success: boolean;
  ruleName: string;
  status: "SUCCESS" | "DANGLING_EDGE_VIOLATION" | "IDENTIFICATION_VIOLATION" | "MATCH_FAILED";
  recycledNodes?: string[];
  createdNodes?: PolyglotNode[];
  preservedNodes?: string[];
  negativeDelta?: string[];
  positiveDelta?: PolyglotNode[];
  targetSyncResult?: any;
}
