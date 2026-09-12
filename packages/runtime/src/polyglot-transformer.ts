/**
 * Generic Polyglot Transformer: Language-agnostic graph transformation and semantic reasoner engine.
 *
 * Supports Triple Graph Grammar (TGG) rule registration, dynamic target language code emitters,
 * and DL-Lite/OWL2 semantic reasoner feature inference across multi-language model graphs.
 */

import type { PolyglotConfig, TGGRuleOptions } from "@modelscript/dsl/dsl/language.js";

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

  /**
   * Initializes a new PolyglotTransformer instance.
   *
   * @param config - Optional configuration declaring TGG rules, type mappings, and reasoner bindings.
   */
  constructor(config?: PolyglotConfig) {
    if (config) {
      this.rules = config.rules || [];
      this.typeMaps = config.typeMaps || {};
    }
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
}
