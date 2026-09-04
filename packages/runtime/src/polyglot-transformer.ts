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

  /**
   * Transforms a generic polyglot node graph into source code for the specified target language.
   *
   * @param node - The polyglot AST or graph node to transform.
   * @param targetLanguage - The target language identifier (e.g., `"sysml2"`, `"modelica"`).
   * @returns The generated code string formatted for the target language.
   * @throws Error if no emitter is registered for `targetLanguage`.
   */
  transform(node: PolyglotNode, targetLanguage: string): string {
    const emitter = this.emitters.get(targetLanguage.toLowerCase());
    if (!emitter) {
      throw new Error(`No polyglot emitter registered for target language '${targetLanguage}'`);
    }
    return emitter(node, this);
  }
}
