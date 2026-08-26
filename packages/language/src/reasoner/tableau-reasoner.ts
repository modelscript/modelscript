// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tableau Reasoner — Pure-TypeScript OWL2 EL/RL Profile Reasoner
 *
 * Implements a subset of OWL2 DL reasoning sufficient for ModelScript's
 * engineering use cases:
 *
 * - **Subsumption** (SubClassOf entailment via transitive closure & equivalence)
 * - **Consistency** (disjointness constraint checking across classes and instances)
 * - **Instance classification** (ClassAssertion reasoning with direct and transitive types)
 * - **Transitive property closure** (fault propagation, connection tracing with paths)
 * - **Justification** (shortest axiom path explanation)
 */

import type {
  BgpQuery,
  BgpQueryResult,
  ClassificationResult,
  ConsistencyResult,
  DLQuery,
  DLQueryResult,
  IOWLReasoner,
  OWL2Axiom,
  OWL2AxiomDelta,
  PropertyChainResult,
  PropertyPathOp,
  ReasonerStatus,
  SubsumptionResult,
  TaxonomyNode,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal Structures
// ---------------------------------------------------------------------------

/** Adjacency list for the class hierarchy graph. */
interface ClassNode {
  /** Direct named superclasses. */
  superClasses: Set<string>;
  /** Direct named subclasses (inverse of superClasses). */
  subClasses: Set<string>;
  /** Equivalent class IRIs. */
  equivalents: Set<string>;
  /** All transitive superclasses (computed by classify()). */
  allSuperClasses: Set<string> | null;
  /** All transitive subclasses (computed by classify()). */
  allSubClasses: Set<string> | null;
}

/** Property assertion (subject → object via property). */
interface PropertyEdge {
  subjectIri: string;
  objectIri: string;
}

// ---------------------------------------------------------------------------
// Tableau Reasoner
// ---------------------------------------------------------------------------

export class TableauReasoner implements IOWLReasoner {
  private _status: ReasonerStatus = "idle";
  private _axioms: OWL2Axiom[] = [];

  // TBox
  private classes = new Map<string, ClassNode>();
  private disjointPairs = new Set<string>(); // "iriA|iriB" sorted

  // Property declarations
  private objectProperties = new Set<string>();
  private dataProperties = new Set<string>();
  private transitiveProperties = new Set<string>();
  private functionalObjectProperties = new Set<string>();
  private sameIndividualGroups = new Map<string, Set<string>>();

  // ABox
  private individualTypes = new Map<string, Set<string>>(); // individual → class IRIs
  private objectPropertyAssertions = new Map<string, PropertyEdge[]>(); // property → edges
  private dataPropertyAssertions = new Map<string, { subjectIri: string; value: string }[]>();

  // Classification state
  private _classified = false;

  // -------------------------------------------------------------------------
  // IOWLReasoner — Properties
  // -------------------------------------------------------------------------

  get status(): ReasonerStatus {
    return this._status;
  }

  get axiomCount(): number {
    return this._axioms.length;
  }

  // -------------------------------------------------------------------------
  // IOWLReasoner — Lifecycle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    this._status = "ready";
  }

  loadOntology(axioms: readonly OWL2Axiom[]): void {
    this._status = "loading";
    this.clear();
    this._axioms = [...axioms];

    for (const axiom of axioms) {
      this.indexAxiom(axiom);
    }

    this._classified = false;
    this._status = "ready";
  }

  applyDelta(delta: OWL2AxiomDelta): void {
    // Remove retracted axioms
    for (const axiom of delta.retractions) {
      this.removeAxiom(axiom);
    }

    // Add new axioms
    for (const axiom of delta.assertions) {
      this._axioms.push(axiom);
      this.indexAxiom(axiom);
    }

    // Invalidate classification
    this._classified = false;
  }

  classify(): void {
    this._status = "classifying";

    // Reset transitive closures
    for (const node of this.classes.values()) {
      node.allSuperClasses = null;
      node.allSubClasses = null;
    }

    // Compute transitive closure of superClasses for all classes
    for (const iri of this.classes.keys()) {
      this.computeAllSuperClasses(iri);
    }

    // Compute inverse (allSubClasses) from the completed superclass sets
    for (const [iri, node] of this.classes) {
      if (!node.allSuperClasses) continue;
      for (const superIri of node.allSuperClasses) {
        const superNode = this.ensureClass(superIri);
        if (!superNode.allSubClasses) superNode.allSubClasses = new Set();
        superNode.allSubClasses.add(iri);
      }
    }

    // ELF Functional property merging & SameIndividual propagation
    for (const propIri of this.functionalObjectProperties) {
      const edges = this.objectPropertyAssertions.get(propIri) ?? [];
      const bySubject = new Map<string, string[]>();
      for (const e of edges) {
        const list = bySubject.get(e.subjectIri) ?? [];
        list.push(e.objectIri);
        bySubject.set(e.subjectIri, list);
      }
      for (const [, objs] of bySubject) {
        if (objs.length > 1) {
          for (let i = 0; i < objs.length; i++) {
            for (let j = i + 1; j < objs.length; j++) {
              const o1 = objs[i]!;
              const o2 = objs[j]!;
              this.unifyIndividuals(o1, o2);
            }
          }
        }
      }
    }

    // Propagate individual types through hierarchy
    for (const [indIri, types] of this.individualTypes) {
      const inferredTypes = new Set(types);
      for (const typeIri of types) {
        const node = this.classes.get(typeIri);
        if (node?.allSuperClasses) {
          for (const superIri of node.allSuperClasses) {
            inferredTypes.add(superIri);
          }
        }
      }
      this.individualTypes.set(indIri, inferredTypes);
    }

    // Check for inconsistency (disjointness violations)
    const consistency = this.checkConsistencyInternal();
    this._status = consistency.isConsistent ? "ready" : "inconsistent";
    this._classified = true;
  }

  private unifyIndividuals(ind1: string, ind2: string): void {
    if (ind1 === ind2) return;
    const group = this.sameIndividualGroups.get(ind1) ?? new Set([ind1]);
    group.add(ind2);
    this.sameIndividualGroups.set(ind1, group);
    this.sameIndividualGroups.set(ind2, group);

    const types1 = this.individualTypes.get(ind1) ?? new Set();
    const types2 = this.individualTypes.get(ind2) ?? new Set();
    for (const t of types1) types2.add(t);
    for (const t of types2) types1.add(t);
    this.individualTypes.set(ind1, types1);
    this.individualTypes.set(ind2, types2);
  }

  dispose(): void {
    this.clear();
    this._status = "idle";
  }

  // -------------------------------------------------------------------------
  // IOWLReasoner — Queries
  // -------------------------------------------------------------------------

  isSubClassOf(subClassIri: string, superClassIri: string): SubsumptionResult {
    if (!this._classified) this.classify();

    if (subClassIri === superClassIri) {
      return { subClassIri, superClassIri, holds: true };
    }

    const node = this.classes.get(subClassIri);
    const holds = node?.allSuperClasses?.has(superClassIri) ?? false;

    return {
      subClassIri,
      superClassIri,
      holds,
      justification: holds ? this.buildJustification(subClassIri, superClassIri) : undefined,
    };
  }

  checkConsistency(): ConsistencyResult {
    if (!this._classified) this.classify();
    const res = this.checkConsistencyInternal();
    if (!res.isConsistent) {
      const allCores = this.allMus();
      const core = allCores.length > 0 ? allCores[0]! : this.quickXplain() || res.conflictingAxioms;
      return {
        ...res,
        minimalConflictCore: core,
        allMinimalConflictCores: allCores,
      };
    }
    return res;
  }

  /**
   * Fast conflict pinpointing via Junker's QuickXplain algorithm.
   * Finds the minimal conflict core in O(k log (N/k)) tests.
   */
  quickXplain(backgroundAxioms?: readonly OWL2Axiom[]): readonly OWL2Axiom[] {
    const bg = backgroundAxioms ? [...backgroundAxioms] : [];
    const bgSet = new Set(bg.map((a) => JSON.stringify(a)));
    const delta = this._axioms.filter((a) => !bgSet.has(JSON.stringify(a)));

    if (this.testConsistencySubset([...bg, ...delta])) {
      return []; // Consistent, no conflict
    }

    return this.qxRecursive(bg, delta);
  }

  /**
   * Enumerates All Minimal Unsatisfiable Subsets (All-MUS) via Reiter's Hitting Set Tree (HST).
   */
  allMus(maxCores: number = 16): readonly (readonly OWL2Axiom[])[] {
    const root = this.quickXplain();
    if (root.length === 0) return [];

    const discovered: (readonly OWL2Axiom[])[] = [root];
    const queue: OWL2Axiom[][] = root.map((ax) => [ax]);

    const serializeAxiom = (a: OWL2Axiom) => JSON.stringify(a);
    const areCoresEqual = (c1: readonly OWL2Axiom[], c2: readonly OWL2Axiom[]) => {
      if (c1.length !== c2.length) return false;
      const s1 = new Set(c1.map(serializeAxiom));
      return c2.every((a) => s1.has(serializeAxiom(a)));
    };

    while (queue.length > 0 && discovered.length < maxCores) {
      const excludedPath = queue.shift()!;
      const excludedSet = new Set(excludedPath.map(serializeAxiom));
      const delta = this._axioms.filter((a) => !excludedSet.has(serializeAxiom(a)));

      const temp = new TableauReasoner();
      temp.loadOntology(delta);
      if (!temp.checkConsistencyInternal().isConsistent) {
        const newCore = temp.quickXplain();
        if (newCore.length > 0) {
          const alreadyFound = discovered.some((d) => areCoresEqual(d, newCore));
          if (!alreadyFound) {
            discovered.push(newCore);
            if (discovered.length < maxCores) {
              for (const ax of newCore) {
                if (!excludedSet.has(serializeAxiom(ax))) {
                  queue.push([...excludedPath, ax]);
                }
              }
            }
          }
        }
      }
    }

    return discovered;
  }

  private testConsistencySubset(axioms: OWL2Axiom[]): boolean {
    const temp = new TableauReasoner();
    temp.loadOntology(axioms);
    temp.classify();
    return temp.checkConsistencyInternal().isConsistent;
  }

  private qxRecursive(b: OWL2Axiom[], delta: OWL2Axiom[]): OWL2Axiom[] {
    if (b.length > 0 && !this.testConsistencySubset(b)) {
      return [];
    }
    if (delta.length === 0) return [];
    if (delta.length === 1) return delta;

    const mid = Math.floor(delta.length / 2);
    const d1 = delta.slice(0, mid);
    const d2 = delta.slice(mid);

    // If B + D1 is inconsistent, search within D1
    if (!this.testConsistencySubset([...b, ...d1])) {
      return this.qxRecursive(b, d1);
    }

    // Otherwise find conflict in D2 given B + D1
    const d2Core = this.qxRecursive([...b, ...d1], d2);
    // Find conflict in D1 given B + d2Core
    const d1Core = this.qxRecursive([...b, ...d2Core], d1);

    const merged = [...d1Core, ...d2Core];
    const unique = new Map<string, OWL2Axiom>();
    for (const a of merged) unique.set(JSON.stringify(a), a);
    return Array.from(unique.values());
  }

  getTaxonomy(): TaxonomyNode[] {
    if (!this._classified) this.classify();

    const nodes: TaxonomyNode[] = [];
    for (const [iri, node] of this.classes) {
      nodes.push({
        iri,
        directSuperClasses: [...node.superClasses],
        directSubClasses: [...node.subClasses],
        equivalentClasses: [...node.equivalents],
      });
    }
    return nodes;
  }

  classifyIndividual(individualIri: string): ClassificationResult {
    if (!this._classified) this.classify();

    const allTypes = this.individualTypes.get(individualIri) ?? new Set<string>();

    // Direct types = types that are not superclasses of any other type in allTypes
    const directTypes = new Set(allTypes);
    for (const typeIri of allTypes) {
      const node = this.classes.get(typeIri);
      if (node?.allSubClasses) {
        for (const subIri of node.allSubClasses) {
          if (allTypes.has(subIri) && subIri !== typeIri) {
            directTypes.delete(typeIri); // Remove non-direct types
            break;
          }
        }
      }
    }

    return {
      individualIri,
      directTypes: [...directTypes],
      allTypes: [...allTypes],
    };
  }

  getTransitiveClosure(propertyIri: string, fromIri: string): PropertyChainResult {
    const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
    const visited = new Set<string>();
    const reachable: string[] = [];
    const path: { subjectIri: string; objectIri: string }[] = [];

    // BFS for transitive closure
    const queue = [fromIri];
    visited.add(fromIri);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;

      for (const edge of edges) {
        if (edge.subjectIri === current && !visited.has(edge.objectIri)) {
          visited.add(edge.objectIri);
          reachable.push(edge.objectIri);
          path.push({ subjectIri: edge.subjectIri, objectIri: edge.objectIri });
          queue.push(edge.objectIri);
        }
      }
    }

    return { propertyIri, sourceIri: fromIri, reachable, path };
  }

  query(q: DLQuery): DLQueryResult {
    if (!this._classified) this.classify();
    const start = performance.now();
    let bindings: string[] = [];
    let pairs: { subject: string; object: string }[] | undefined;

    switch (q.type) {
      case "instances": {
        for (const [indIri, types] of this.individualTypes) {
          if (types.has(q.iri)) bindings.push(indIri);
        }
        break;
      }

      case "subclasses": {
        const node = this.classes.get(q.iri);
        if (node?.allSubClasses) bindings = [...node.allSubClasses];
        break;
      }

      case "superclasses": {
        const node = this.classes.get(q.iri);
        if (node?.allSuperClasses) bindings = [...node.allSuperClasses];
        break;
      }

      case "equivalents": {
        const node = this.classes.get(q.iri);
        if (node?.equivalents) bindings = [...node.equivalents];
        break;
      }

      case "disjoint": {
        for (const pairKey of this.disjointPairs) {
          const [a, b] = pairKey.split("|");
          if (a === q.iri && b) bindings.push(b);
          else if (b === q.iri && a) bindings.push(a);
        }
        break;
      }

      case "property-values": {
        const edges = this.objectPropertyAssertions.get(q.iri) ?? [];
        pairs = edges.map((e) => ({ subject: e.subjectIri, object: e.objectIri }));
        bindings = [...new Set(edges.map((e) => e.objectIri))];
        break;
      }

      case "reachable": {
        if (q.fromIri) {
          const result = this.getTransitiveClosure(q.iri, q.fromIri);
          bindings = [...result.reachable];
        }
        break;
      }

      case "path": {
        if (q.fromIri) {
          const op = q.pathOp ?? "direct";
          bindings = [...this.evaluatePropertyPath(q.iri, op, q.fromIri, q.stepPropertyIri2)];
        }
        break;
      }
    }

    return {
      query: q,
      bindings,
      pairs,
      executionTimeMs: performance.now() - start,
    };
  }

  evaluatePropertyPath(
    propertyIri: string,
    pathOp: PropertyPathOp,
    fromIri: string,
    stepPropertyIri2?: string,
  ): readonly string[] {
    const reachable = new Set<string>();

    switch (pathOp) {
      case "direct": {
        const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges) {
          if (e.subjectIri === fromIri) reachable.add(e.objectIri);
        }
        break;
      }

      case "inverse": {
        const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges) {
          if (e.objectIri === fromIri) reachable.add(e.subjectIri);
        }
        break;
      }

      case "star": {
        reachable.add(fromIri);
        // fall through to plus
      }
      case "plus": {
        const queue = [fromIri];
        const visited = new Set<string>([fromIri]);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
          for (const e of edges) {
            if (e.subjectIri === curr && !visited.has(e.objectIri)) {
              visited.add(e.objectIri);
              reachable.add(e.objectIri);
              queue.push(e.objectIri);
            }
          }
        }
        break;
      }

      case "inverse-plus": {
        const queue = [fromIri];
        const visited = new Set<string>([fromIri]);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          const edges = this.objectPropertyAssertions.get(propertyIri) ?? [];
          for (const e of edges) {
            if (e.objectIri === curr && !visited.has(e.subjectIri)) {
              visited.add(e.subjectIri);
              reachable.add(e.subjectIri);
              queue.push(e.subjectIri);
            }
          }
        }
        break;
      }

      case "sequence": {
        const step1Targets = new Set<string>();
        const edges1 = this.objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges1) {
          if (e.subjectIri === fromIri) step1Targets.add(e.objectIri);
        }
        if (stepPropertyIri2) {
          const edges2 = this.objectPropertyAssertions.get(stepPropertyIri2) ?? [];
          for (const s of step1Targets) {
            for (const e of edges2) {
              if (e.subjectIri === s) reachable.add(e.objectIri);
            }
          }
        }
        break;
      }

      case "alternation": {
        const edges1 = this.objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges1) {
          if (e.subjectIri === fromIri) reachable.add(e.objectIri);
        }
        if (stepPropertyIri2) {
          const edges2 = this.objectPropertyAssertions.get(stepPropertyIri2) ?? [];
          for (const e of edges2) {
            if (e.subjectIri === fromIri) reachable.add(e.objectIri);
          }
        }
        break;
      }
    }

    return Array.from(reachable);
  }

  queryBgp(query: BgpQuery): BgpQueryResult {
    if (!this._classified) this.classify();
    const start = performance.now();

    const varSet = new Set<string>();
    for (const pat of query.patterns) {
      if (pat.subject.startsWith("?")) varSet.add(pat.subject);
      if (pat.predicate.startsWith("?")) varSet.add(pat.predicate);
      if (pat.object.startsWith("?")) varSet.add(pat.object);
    }
    const variables = Array.from(varSet);

    if (query.patterns.length === 0) {
      return { variables, bindings: [], executionTimeMs: performance.now() - start };
    }

    const allFacts: { s: string; p: string; o: string }[] = [];
    for (const ax of this._axioms) {
      if (ax.type === "ObjectPropertyAssertion") {
        allFacts.push({ s: ax.subjectIri, p: ax.propertyIri, o: ax.objectIri });
      } else if (ax.type === "SubClassOf") {
        allFacts.push({ s: ax.subClassIri, p: "rdfs:subClassOf", o: ax.superClassIri });
      } else if (ax.type === "ClassAssertion") {
        allFacts.push({ s: ax.individualIri, p: "rdf:type", o: ax.classIri });
      }
    }

    let currentBindings: Record<string, string>[] = [{}];

    for (const pat of query.patterns) {
      const nextBindings: Record<string, string>[] = [];

      for (const env of currentBindings) {
        for (const fact of allFacts) {
          let match = true;
          const newEnv = { ...env };

          if (pat.subject.startsWith("?")) {
            if (env[pat.subject] !== undefined) {
              if (env[pat.subject] !== fact.s) match = false;
            } else {
              newEnv[pat.subject] = fact.s;
            }
          } else if (pat.subject !== fact.s) {
            match = false;
          }

          if (!match) continue;

          if (pat.predicate.startsWith("?")) {
            if (env[pat.predicate] !== undefined) {
              if (env[pat.predicate] !== fact.p) match = false;
            } else {
              newEnv[pat.predicate] = fact.p;
            }
          } else if (pat.predicate !== fact.p) {
            match = false;
          }

          if (!match) continue;

          if (pat.object.startsWith("?")) {
            if (env[pat.object] !== undefined) {
              if (env[pat.object] !== fact.o) match = false;
            } else {
              newEnv[pat.object] = fact.o;
            }
          } else if (pat.object !== fact.o) {
            match = false;
          }

          if (match) {
            nextBindings.push(newEnv);
          }
        }
      }

      currentBindings = nextBindings;
    }

    const uniqueMap = new Map<string, Record<string, string>>();
    for (const b of currentBindings) {
      uniqueMap.set(JSON.stringify(b), b);
    }

    return {
      variables,
      bindings: Array.from(uniqueMap.values()),
      executionTimeMs: performance.now() - start,
    };
  }

  explain(subClassIri: string, superClassIri: string): readonly OWL2Axiom[] {
    if (!this._classified) this.classify();
    return this.buildJustification(subClassIri, superClassIri);
  }

  // -------------------------------------------------------------------------
  // Internal — Axiom Indexing
  // -------------------------------------------------------------------------

  private indexAxiom(axiom: OWL2Axiom): void {
    switch (axiom.type) {
      case "ClassDeclaration": {
        this.ensureClass(axiom.iri);
        break;
      }

      case "SubClassOf": {
        const sub = this.ensureClass(axiom.subClassIri);
        const sup = this.ensureClass(axiom.superClassIri);
        sub.superClasses.add(axiom.superClassIri);
        sup.subClasses.add(axiom.subClassIri);
        break;
      }

      case "EquivalentClasses": {
        for (let i = 0; i < axiom.classIris.length; i++) {
          const aIri = axiom.classIris[i];
          if (!aIri) continue;
          const a = this.ensureClass(aIri);
          for (let j = 0; j < axiom.classIris.length; j++) {
            if (i === j) continue;
            const bIri = axiom.classIris[j];
            if (!bIri) continue;
            a.equivalents.add(bIri);
            a.superClasses.add(bIri);
            const b = this.ensureClass(bIri);
            b.subClasses.add(aIri);
          }
        }
        break;
      }

      case "DisjointClasses": {
        for (let i = 0; i < axiom.classIris.length; i++) {
          const classIri = axiom.classIris[i];
          if (!classIri) continue;
          this.ensureClass(classIri);
          for (let j = i + 1; j < axiom.classIris.length; j++) {
            const a = classIri;
            const b = axiom.classIris[j];
            if (!b) continue;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            this.disjointPairs.add(key);
          }
        }
        break;
      }

      case "ObjectPropertyDeclaration": {
        this.objectProperties.add(axiom.iri);
        if (axiom.characteristics?.includes("Transitive")) {
          this.transitiveProperties.add(axiom.iri);
        }
        break;
      }

      case "DataPropertyDeclaration": {
        this.dataProperties.add(axiom.iri);
        break;
      }

      case "TransitiveObjectProperty": {
        this.transitiveProperties.add(axiom.propertyIri);
        break;
      }

      case "ObjectPropertyAssertion": {
        const edges = this.objectPropertyAssertions.get(axiom.propertyIri);
        const edge = { subjectIri: axiom.subjectIri, objectIri: axiom.objectIri };
        if (edges) {
          edges.push(edge);
        } else {
          this.objectPropertyAssertions.set(axiom.propertyIri, [edge]);
        }
        break;
      }

      case "DataPropertyAssertion": {
        const assertions = this.dataPropertyAssertions.get(axiom.propertyIri);
        const assertion = { subjectIri: axiom.subjectIri, value: axiom.value };
        if (assertions) {
          assertions.push(assertion);
        } else {
          this.dataPropertyAssertions.set(axiom.propertyIri, [assertion]);
        }
        break;
      }

      case "IndividualDeclaration": {
        if (!this.individualTypes.has(axiom.iri)) {
          this.individualTypes.set(axiom.iri, new Set());
        }
        break;
      }

      case "ClassAssertion": {
        const types = this.individualTypes.get(axiom.individualIri);
        if (types) {
          types.add(axiom.classIri);
        } else {
          this.individualTypes.set(axiom.individualIri, new Set([axiom.classIri]));
        }
        break;
      }

      case "FunctionalObjectProperty": {
        this.functionalObjectProperties.add(axiom.propertyIri);
        break;
      }

      case "FunctionalDataProperty": {
        this.dataProperties.add(axiom.propertyIri);
        break;
      }

      case "SameIndividual": {
        for (let i = 0; i < axiom.individualIris.length; i++) {
          for (let j = i + 1; j < axiom.individualIris.length; j++) {
            const a = axiom.individualIris[i]!;
            const b = axiom.individualIris[j]!;
            this.unifyIndividuals(a, b);
          }
        }
        break;
      }

      case "ObjectSomeValuesFrom":
      case "DataSomeValuesFrom":
        break;
    }
  }

  private removeAxiom(axiom: OWL2Axiom): void {
    const idx = this._axioms.findIndex((a) => axiomEqual(a, axiom));
    if (idx !== -1) this._axioms.splice(idx, 1);

    switch (axiom.type) {
      case "SubClassOf": {
        const sub = this.classes.get(axiom.subClassIri);
        const sup = this.classes.get(axiom.superClassIri);
        sub?.superClasses.delete(axiom.superClassIri);
        sup?.subClasses.delete(axiom.subClassIri);
        break;
      }

      case "EquivalentClasses": {
        for (const iri of axiom.classIris) {
          const node = this.classes.get(iri);
          if (node) {
            for (const other of axiom.classIris) {
              if (other !== iri) {
                node.equivalents.delete(other);
                node.superClasses.delete(other);
              }
            }
          }
        }
        break;
      }

      case "DisjointClasses": {
        for (let i = 0; i < axiom.classIris.length; i++) {
          for (let j = i + 1; j < axiom.classIris.length; j++) {
            const a = axiom.classIris[i];
            const b = axiom.classIris[j];
            if (!a || !b) continue;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            this.disjointPairs.delete(key);
          }
        }
        break;
      }

      case "ObjectPropertyAssertion": {
        const edges = this.objectPropertyAssertions.get(axiom.propertyIri);
        if (edges) {
          const idx = edges.findIndex((e) => e.subjectIri === axiom.subjectIri && e.objectIri === axiom.objectIri);
          if (idx !== -1) edges.splice(idx, 1);
        }
        break;
      }

      case "ClassAssertion": {
        const types = this.individualTypes.get(axiom.individualIri);
        types?.delete(axiom.classIri);
        break;
      }

      case "FunctionalObjectProperty": {
        this.functionalObjectProperties.delete(axiom.propertyIri);
        break;
      }

      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Internal — Transitive Closure
  // -------------------------------------------------------------------------

  private computeAllSuperClasses(iri: string): Set<string> {
    const node = this.classes.get(iri);
    if (!node) return new Set();
    if (node.allSuperClasses) return node.allSuperClasses;

    node.allSuperClasses = new Set();

    for (const superIri of node.superClasses) {
      node.allSuperClasses.add(superIri);
      const transitive = this.computeAllSuperClasses(superIri);
      for (const t of transitive) {
        node.allSuperClasses.add(t);
      }
    }

    for (const eqIri of node.equivalents) {
      node.allSuperClasses.add(eqIri);
    }

    return node.allSuperClasses;
  }

  // -------------------------------------------------------------------------
  // Internal — Consistency Check
  // -------------------------------------------------------------------------

  private checkConsistencyInternal(): ConsistencyResult {
    const conflicts: OWL2Axiom[] = [];

    for (const pairKey of this.disjointPairs) {
      const [aIri, bIri] = pairKey.split("|");
      if (!aIri || !bIri) continue;

      const aNode = this.classes.get(aIri);
      const bNode = this.classes.get(bIri);

      let hasClassConflict = aNode?.allSuperClasses?.has(bIri) || bNode?.allSuperClasses?.has(aIri);
      if (!hasClassConflict) {
        for (const [, candNode] of this.classes) {
          if (candNode.allSuperClasses?.has(aIri) && candNode.allSuperClasses?.has(bIri)) {
            hasClassConflict = true;
            break;
          }
        }
      }

      if (hasClassConflict) {
        conflicts.push({
          type: "DisjointClasses",
          classIris: [aIri, bIri],
          sourceLang: "inferred",
        });
      }

      for (const [indIri, types] of this.individualTypes) {
        if (types.has(aIri) && types.has(bIri)) {
          conflicts.push({
            type: "ClassAssertion",
            classIri: aIri,
            individualIri: indIri,
            sourceLang: "inferred",
          });
        }
      }
    }

    if (conflicts.length > 0) {
      return {
        isConsistent: false,
        conflictingAxioms: conflicts,
        explanation: `Found ${conflicts.length} disjointness violation(s) in the ontology.`,
      };
    }

    return { isConsistent: true };
  }

  // -------------------------------------------------------------------------
  // Internal — Justification
  // -------------------------------------------------------------------------

  private buildJustification(subIri: string, superIri: string): OWL2Axiom[] {
    const visited = new Set<string>();
    const queue: { iri: string; trail: OWL2Axiom[] }[] = [{ iri: subIri, trail: [] }];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { iri, trail } = item;
      if (iri === superIri) return trail;
      if (visited.has(iri)) continue;
      visited.add(iri);

      const node = this.classes.get(iri);
      if (!node) continue;

      for (const supIri of node.superClasses) {
        const axiom: OWL2Axiom = {
          type: "SubClassOf",
          subClassIri: iri,
          superClassIri: supIri,
          sourceLang: "asserted",
        };
        queue.push({ iri: supIri, trail: [...trail, axiom] });
      }

      for (const eqIri of node.equivalents) {
        const axiom: OWL2Axiom = {
          type: "EquivalentClasses",
          classIris: [iri, eqIri],
          sourceLang: "asserted",
        };
        queue.push({ iri: eqIri, trail: [...trail, axiom] });
      }
    }

    return [];
  }

  // -------------------------------------------------------------------------
  // Internal — Helpers
  // -------------------------------------------------------------------------

  private ensureClass(iri: string): ClassNode {
    let node = this.classes.get(iri);
    if (!node) {
      node = {
        superClasses: new Set(),
        subClasses: new Set(),
        equivalents: new Set(),
        allSuperClasses: null,
        allSubClasses: null,
      };
      this.classes.set(iri, node);
    }
    return node;
  }

  private clear(): void {
    this._axioms = [];
    this.classes.clear();
    this.disjointPairs.clear();
    this.objectProperties.clear();
    this.dataProperties.clear();
    this.transitiveProperties.clear();
    this.individualTypes.clear();
    this.objectPropertyAssertions.clear();
    this.dataPropertyAssertions.clear();
    this._classified = false;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function axiomEqual(a: OWL2Axiom, b: OWL2Axiom): boolean {
  if (a.type !== b.type) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
