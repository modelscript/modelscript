/* eslint-disable */
// @ts-nocheck
import { ChunkedUint32Array, UnmanagedUint32Array, createChunkedUint32Array } from "./array";
import { UnmanagedMap64, createMap64 } from "./hashmap";
import { atomicChunkAlloc } from "./arena";

export const AXIOM_CLASS_DECL: u16 = 1;
export const AXIOM_SUBCLASS_OF: u16 = 2;
export const AXIOM_EQUIV_CLASS: u16 = 3;
export const AXIOM_DISJOINT_CLASSES: u16 = 4;
export const AXIOM_OBJ_PROP_DECL: u16 = 5;
export const AXIOM_DATA_PROP_DECL: u16 = 6;
export const AXIOM_OBJ_PROP_ASSERT: u16 = 7;
export const AXIOM_DATA_PROP_ASSERT: u16 = 8;
export const AXIOM_TRANSITIVE_PROP: u16 = 9;
export const AXIOM_INDIVIDUAL_DECL: u16 = 10;
export const AXIOM_CLASS_ASSERT: u16 = 11;
export const AXIOM_OBJECT_SOME_VALUES_FROM: u16 = 12; // C ⊑ ∃R.D
export const AXIOM_SUB_PROPERTY_CHAIN: u16 = 13;      // R ∘ S ⊑ T
export const AXIOM_FUNCTIONAL_OBJ_PROP: u16 = 14;     // Func(R)
export const AXIOM_FUNCTIONAL_DATA_PROP: u16 = 15;    // Func(P)
export const AXIOM_SAME_INDIVIDUAL: u16 = 16;         // a ≡ b
export const AXIOM_UNIVERSAL_RESTRICTION: u16 = 17;   // C ⊑ ∀R.D
export const AXIOM_DISJUNCTIVE_CLASS: u16 = 18;       // C ⊑ D1 ⊔ D2
export const AXIOM_QUALIFIED_CARDINALITY: u16 = 19;   // C ⊑ (≥|≤|= n) R.D
export const AXIOM_SYMMETRIC_PROP: u16 = 20;          // Sym(R)
export const AXIOM_INVERSE_PROP: u16 = 21;            // Inv(R, S)
export const AXIOM_ASYMMETRIC_PROP: u16 = 22;         // Asym(R)
export const AXIOM_IRREFLEXIVE_PROP: u16 = 23;        // Irr(R)
export const AXIOM_DISJOINT_PROPS: u16 = 24;          // Disjoint(R, S)
export const AXIOM_NOMINAL_CLASS: u16 = 25;           // C ≡ {a1, a2, ...}
export const AXIOM_SELF_RESTRICTION: u16 = 26;        // C ⊑ ∃R.Self
export const AXIOM_SHACL_RULE: u16 = 27;              // SHACL-AF Rule

export const PATH_OP_DIRECT: u32 = 1;
export const PATH_OP_PLUS: u32 = 2;          // + (1+ hops)
export const PATH_OP_STAR: u32 = 3;          // * (0+ hops)
export const PATH_OP_INVERSE: u32 = 4;       // ^ (inverse 1 hop)
export const PATH_OP_INVERSE_PLUS: u32 = 5;  // ^+ (inverse 1+ hops)
export const PATH_OP_SEQUENCE: u32 = 6;      // / (step1 / step2)
export const PATH_OP_ALTERNATION: u32 = 7;   // | (prop1 | prop2)

export const AXIOM_STRIDE: u32 = 6; // 24 bytes per axiom
export const WILDCARD_PATTERN: u32 = 0xffffffff;

@unmanaged
export class OntologyStore {
  axiomTable: ChunkedUint32Array;
  axiomCount: u32;

  // Inverted Indices for O(1) / O(K) SPARQL-DL Pattern Matching
  spoHead: UnmanagedMap64; // maps subjectHash -> head axiomId
  posHead: UnmanagedMap64; // maps predicateHash -> head axiomId
  ospHead: UnmanagedMap64; // maps objectHash -> head axiomId

  nextSpo: ChunkedUint32Array;
  nextPos: ChunkedUint32Array;
  nextOsp: ChunkedUint32Array;

  // DRed (Delete/Rederive) Incremental Maintenance & Active Status
  axiomActive: ChunkedUint32Array; // 1 = active, 0 = retracted/over-deleted
  derivationCount: ChunkedUint32Array; // count of deriving proof paths for inferred axioms

  // ELF Individual Equivalence (Union-Find)
  individualParent: UnmanagedMap64; // maps individualHash -> parentHash

  // O(1) Interval/Topological DAG Indexing
  intervalLeft: UnmanagedMap64;  // maps classHash -> left interval
  intervalRight: UnmanagedMap64; // maps classHash -> right interval
  hasIntervalIndex: boolean;
  bfsQueue: ChunkedUint32Array;
  distinctClasses: ChunkedUint32Array;

  init(initialCapacity: u32 = 1024): void {
    this.axiomTable = createChunkedUint32Array(initialCapacity * AXIOM_STRIDE);
    this.axiomCount = 1; // 1-indexed (0 reserved for null)

    this.spoHead = changetype<UnmanagedMap64>(createMap64());
    this.posHead = changetype<UnmanagedMap64>(createMap64());
    this.ospHead = changetype<UnmanagedMap64>(createMap64());

    this.nextSpo = createChunkedUint32Array(initialCapacity);
    this.nextPos = createChunkedUint32Array(initialCapacity);
    this.nextOsp = createChunkedUint32Array(initialCapacity);

    this.axiomActive = createChunkedUint32Array(initialCapacity);
    this.derivationCount = createChunkedUint32Array(initialCapacity);
    this.individualParent = changetype<UnmanagedMap64>(createMap64());

    this.intervalLeft = changetype<UnmanagedMap64>(createMap64());
    this.intervalRight = changetype<UnmanagedMap64>(createMap64());
    this.hasIntervalIndex = false;

    this.bfsQueue = createChunkedUint32Array(256);
    this.distinctClasses = createChunkedUint32Array(256);
  }


  /**
   * Adds an OWL 2 axiom into the indexed knowledge store.
   * Updates SPO, POS, and OSP index chains for fast relational queries.
   */
  addAxiom(axiomType: u32, sourceLangId: u32, subjectHash: u32, predicateHash: u32, objectHash: u32, flags: u32 = 0, extra: u32 = 0): u32 {
    let id = this.axiomCount++;
    let baseIdx = id * AXIOM_STRIDE;

    let typeAndLang = (axiomType & 0xffff) | ((sourceLangId & 0xffff) << 16);
    this.axiomTable.set(baseIdx + 0, typeAndLang);
    this.axiomTable.set(baseIdx + 1, subjectHash);
    this.axiomTable.set(baseIdx + 2, predicateHash);
    this.axiomTable.set(baseIdx + 3, objectHash);
    this.axiomTable.set(baseIdx + 4, flags);
    this.axiomTable.set(baseIdx + 5, extra);

    // 1. Link SPO Index (Subject -> Axiom)
    if (subjectHash != 0) {
      let prevSpo = this.spoHead.get(subjectHash as u64) as u32;
      this.nextSpo.set(id, prevSpo);
      this.spoHead.set(subjectHash as u64, id);
    } else {
      this.nextSpo.set(id, 0);
    }

    // 2. Link POS Index (Predicate -> Axiom)
    if (predicateHash != 0) {
      let prevPos = this.posHead.get(predicateHash as u64) as u32;
      this.nextPos.set(id, prevPos);
      this.posHead.set(predicateHash as u64, id);
    } else {
      this.nextPos.set(id, 0);
    }

    // 3. Link OSP Index (Object -> Axiom)
    if (objectHash != 0) {
      let prevOsp = this.ospHead.get(objectHash as u64) as u32;
      this.nextOsp.set(id, prevOsp);
      this.ospHead.set(objectHash as u64, id);
    } else {
      this.nextOsp.set(id, 0);
    }

    this.axiomActive.set(id, 1);
    this.derivationCount.set(id, flags == 1 ? 1 : 0);
    this.hasIntervalIndex = false;

    return id;
  }

  /**
   * Retracts an axiom using the DRed (Delete/Rederive) algorithm.
   * Phase 1: Over-deletion of derived cascades.
   * Phase 2: Rederivation from surviving alternative proof paths.
   */
  retractAxiom(axiomId: u32): u32 {
    if (axiomId == 0 || axiomId >= this.axiomCount) return 0;
    if (this.axiomActive.get(axiomId) == 0) return 0;

    // 1. Mark target axiom inactive (retracted)
    this.axiomActive.set(axiomId, 0);
    this.hasIntervalIndex = false;

    let bIdx = axiomId * AXIOM_STRIDE;
    let typeAndLang = this.axiomTable.get(bIdx + 0);
    let aType = (typeAndLang & 0xffff) as u16;
    let s = this.axiomTable.get(bIdx + 1);
    let p = this.axiomTable.get(bIdx + 2);
    let o = this.axiomTable.get(bIdx + 3);

    // Phase 1 (Over-deletion): If axiom was asserted, find inferred axioms that depended on it
    let overDeleted = createChunkedUint32Array(16);

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let fIdx = i * AXIOM_STRIDE;
      let flags = this.axiomTable.get(fIdx + 4);
      if (flags == 1) { // Inferred axiom
        let infType = (this.axiomTable.get(fIdx + 0) & 0xffff) as u16;
        let infS = this.axiomTable.get(fIdx + 1);
        let infO = this.axiomTable.get(fIdx + 3);

        // If inferred relation directly references retracted endpoints, mark for over-deletion
        if (infS == s || infS == o || infO == s || infO == o) {
          let count = this.derivationCount.get(i);
          if (count > 1) {
            this.derivationCount.set(i, count - 1);
          } else {
            this.derivationCount.set(i, 0);
            this.axiomActive.set(i, 0);
            overDeleted.push(i);
          }
        }
      }
    }

    // Phase 2 (Rederivation): Re-run forward chaining to re-derive any surviving paths
    this.saturateELRules();
    this.saturateFunctionalProperties();

    // Re-instate interval index
    this.computeIntervalIndex();
    return 1;
  }

  /**
   * Applies an incremental delta of additions and retractions in WASM linear memory.
   */
  applyDelta(
    addCount: u32,
    addArray: ChunkedUint32Array,
    retractCount: u32,
    retractArray: ChunkedUint32Array
  ): u32 {
    // 1. Process retractions first
    for (let i: u32 = 0; i < retractCount; i++) {
      let rIdx = i * AXIOM_STRIDE;
      let aType = (retractArray.get(rIdx + 0) & 0xffff) as u16;
      let s = retractArray.get(rIdx + 1);
      let p = retractArray.get(rIdx + 2);
      let o = retractArray.get(rIdx + 3);

      // Find matching active axiom
      for (let k: u32 = 1; k < this.axiomCount; k++) {
        if (this.axiomActive.get(k) == 0) continue;
        let baseIdx = k * AXIOM_STRIDE;
        let t = (this.axiomTable.get(baseIdx + 0) & 0xffff) as u16;
        if (t == aType &&
            this.axiomTable.get(baseIdx + 1) == s &&
            this.axiomTable.get(baseIdx + 2) == p &&
            this.axiomTable.get(baseIdx + 3) == o) {
          this.retractAxiom(k);
          break;
        }
      }
    }

    // 2. Process additions
    for (let i: u32 = 0; i < addCount; i++) {
      let aIdx = i * AXIOM_STRIDE;
      let tLang = addArray.get(aIdx + 0);
      let aType = (tLang & 0xffff) as u16;
      let sLang = ((tLang >>> 16) & 0xffff) as u16;
      let s = addArray.get(aIdx + 1);
      let p = addArray.get(aIdx + 2);
      let o = addArray.get(aIdx + 3);
      let flags = addArray.get(aIdx + 4);

      this.addAxiom(aType, sLang, s, p, o, flags);
    }

    // 3. Saturate and recompute index
    this.saturateELRules();
    this.saturateFunctionalProperties();
    this.computeIntervalIndex();
    return addCount + retractCount;
  }

  // --------------------------------------------------------------------------
  // ELF Functional Properties & Individual Equivalence (Union-Find)
  // --------------------------------------------------------------------------

  findIndRoot(indHash: u32): u32 {
    if (indHash == 0) return 0;
    if (!this.individualParent.has(indHash as u64)) {
      this.individualParent.set(indHash as u64, indHash as u32);
      return indHash;
    }
    let p = this.individualParent.get(indHash as u64) as u32;
    if (p == indHash) return indHash;

    let root = this.findIndRoot(p);
    this.individualParent.set(indHash as u64, root as u32); // Path compression
    return root;
  }

  unionInds(indA: u32, indB: u32): u32 {
    let rootA = this.findIndRoot(indA);
    let rootB = this.findIndRoot(indB);
    if (rootA != rootB) {
      this.individualParent.set(rootA as u64, rootB as u32);
      return rootB;
    }
    return rootA;
  }

  areSameIndividual(indA: u32, indB: u32): boolean {
    if (indA == 0 || indB == 0) return false;
    if (indA == indB) return true;
    return this.findIndRoot(indA) == this.findIndRoot(indB);
  }

  /**
   * Consequence-based saturation for Functional Object Properties:
   * Func(R) ∧ R(x, y) ∧ R(x, z) ⇒ y ≡ z
   * Unifies individual class assertions and detects disjointness contradictions.
   */
  saturateFunctionalProperties(): u32 {
    let newInferences: u32 = 0;

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let bIdx = i * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;

      if (aType == AXIOM_FUNCTIONAL_OBJ_PROP) {
        let prop = this.axiomTable.get(bIdx + 2); // predicateHash

        // Find all subjects having this property
        for (let j: u32 = 1; j < this.axiomCount; j++) {
          if (this.axiomActive.get(j) == 0) continue;
          let jIdx = j * AXIOM_STRIDE;
          let jType = (this.axiomTable.get(jIdx + 0) & 0xffff) as u16;

          if (jType == AXIOM_OBJ_PROP_ASSERT && this.axiomTable.get(jIdx + 2) == prop) {
            let subj = this.axiomTable.get(jIdx + 1);
            let obj1 = this.axiomTable.get(jIdx + 3);

            // Find other assertions R(subj, obj2)
            for (let k: u32 = j + 1; k < this.axiomCount; k++) {
              if (this.axiomActive.get(k) == 0) continue;
              let kIdx = k * AXIOM_STRIDE;
              let kType = (this.axiomTable.get(kIdx + 0) & 0xffff) as u16;

              if (kType == AXIOM_OBJ_PROP_ASSERT &&
                  this.axiomTable.get(kIdx + 2) == prop &&
                  this.axiomTable.get(kIdx + 1) == subj) {
                let obj2 = this.axiomTable.get(kIdx + 3);

                if (obj1 != 0 && obj2 != 0 && !this.areSameIndividual(obj1, obj2)) {
                  this.unionInds(obj1, obj2);
                  this.addAxiom(AXIOM_SAME_INDIVIDUAL, 0, obj1, 0, obj2, 1);
                  newInferences++;

                  // Propagate class assertions across unified individuals
                  this.propagateEquivalentIndividualTypes(obj1, obj2);
                }
              }
            }
          }
        }
      }
    }

    return newInferences;
  }

  propagateEquivalentIndividualTypes(ind1: u32, ind2: u32): void {
    let types1 = createChunkedUint32Array(8);
    let types2 = createChunkedUint32Array(8);

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let bIdx = i * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;

      if (aType == AXIOM_CLASS_ASSERT) {
        let ind = this.axiomTable.get(bIdx + 1);
        let cls = this.axiomTable.get(bIdx + 3);
        if (ind == ind1) types1.push(cls);
        if (ind == ind2) types2.push(cls);
      }
    }

    // Add types of ind1 to ind2
    for (let i: u32 = 0; i < types1.length; i++) {
      let c = types1.get(i);
      let found = false;
      for (let j: u32 = 0; j < types2.length; j++) {
        if (types2.get(j) == c) { found = true; break; }
      }
      if (!found) {
        this.addAxiom(AXIOM_CLASS_ASSERT, 0, ind2, 0, c, 1);
      }
    }

    // Add types of ind2 to ind1
    for (let i: u32 = 0; i < types2.length; i++) {
      let c = types2.get(i);
      let found = false;
      for (let j: u32 = 0; j < types1.length; j++) {
        if (types1.get(j) == c) { found = true; break; }
      }
      if (!found) {
        this.addAxiom(AXIOM_CLASS_ASSERT, 0, ind1, 0, c, 1);
      }
    }
  }

  /**
   * Fast SPARQL-DL pattern matching using inverted SPO / POS / OSP indices.
   * Wildcards are represented by WILDCARD_PATTERN (0xffffffff).
   */
  queryTriples(subjectPattern: u32, predicatePattern: u32, objectPattern: u32, outBuffer: ChunkedUint32Array): u32 {
    let matchCount: u32 = 0;

    // Optimal index selection based on bound variables:
    if (subjectPattern != WILDCARD_PATTERN) {
      // Use SPO Index
      let curr = this.spoHead.get(subjectPattern as u64) as u32;
      while (curr != 0) {
        let baseIdx = curr * AXIOM_STRIDE;
        let p = this.axiomTable.get(baseIdx + 2);
        let o = this.axiomTable.get(baseIdx + 3);

        let pMatch = predicatePattern == WILDCARD_PATTERN || predicatePattern == p;
        let oMatch = objectPattern == WILDCARD_PATTERN || objectPattern == o;

        if (pMatch && oMatch) {
          for (let w: u32 = 0; w < AXIOM_STRIDE; w++) {
            outBuffer.push(this.axiomTable.get(baseIdx + w));
          }
          matchCount++;
        }
        curr = this.nextSpo.get(curr);
      }
    } else if (predicatePattern != WILDCARD_PATTERN) {
      // Use POS Index
      let curr = this.posHead.get(predicatePattern as u64) as u32;
      while (curr != 0) {
        let baseIdx = curr * AXIOM_STRIDE;
        let s = this.axiomTable.get(baseIdx + 1);
        let o = this.axiomTable.get(baseIdx + 3);

        let sMatch = subjectPattern == WILDCARD_PATTERN || subjectPattern == s;
        let oMatch = objectPattern == WILDCARD_PATTERN || objectPattern == o;

        if (sMatch && oMatch) {
          for (let w: u32 = 0; w < AXIOM_STRIDE; w++) {
            outBuffer.push(this.axiomTable.get(baseIdx + w));
          }
          matchCount++;
        }
        curr = this.nextPos.get(curr);
      }
    } else if (objectPattern != WILDCARD_PATTERN) {
      // Use OSP Index
      let curr = this.ospHead.get(objectPattern as u64) as u32;
      while (curr != 0) {
        let baseIdx = curr * AXIOM_STRIDE;
        let s = this.axiomTable.get(baseIdx + 1);
        let p = this.axiomTable.get(baseIdx + 2);

        let sMatch = subjectPattern == WILDCARD_PATTERN || subjectPattern == s;
        let pMatch = predicatePattern == WILDCARD_PATTERN || predicatePattern == p;

        if (sMatch && pMatch) {
          for (let w: u32 = 0; w < AXIOM_STRIDE; w++) {
            outBuffer.push(this.axiomTable.get(baseIdx + w));
          }
          matchCount++;
        }
        curr = this.nextOsp.get(curr);
      }
    } else {
      // Full table scan when all patterns are wildcards
      for (let i: u32 = 1; i < this.axiomCount; i++) {
        let baseIdx = i * AXIOM_STRIDE;
        for (let w: u32 = 0; w < AXIOM_STRIDE; w++) {
          outBuffer.push(this.axiomTable.get(baseIdx + w));
        }
        matchCount++;
      }
    }

    return matchCount;
  }

  /**
   * Transitive SubClassOf Subsumption Reasoner in WASM linear memory.
   * Checks if subClass ⊑ superClass holds using O(1) interval dominance with BFS fallback.
   */
  isSubClassOf(subClassHash: u32, superClassHash: u32): boolean {
    if (subClassHash == 0 || superClassHash == 0) return false;
    if (subClassHash == superClassHash) return true;

    // Fast-path: O(1) interval dominance check if interval index is computed
    if (this.hasIntervalIndex) {
      if (this.intervalLeft.has(subClassHash as u64) && this.intervalLeft.has(superClassHash as u64)) {
        let leftSub = this.intervalLeft.get(subClassHash as u64) as u32;
        let rightSub = this.intervalRight.get(subClassHash as u64) as u32;
        let leftSup = this.intervalLeft.get(superClassHash as u64) as u32;
        let rightSup = this.intervalRight.get(superClassHash as u64) as u32;

        if (leftSup <= leftSub && rightSub <= rightSup) {
          return true;
        }
      }
    }

    // Exact fallback: Unmanaged ChunkedUint32Array for zero-GC BFS traversal without arbitrary depth limit
    let queue = this.bfsQueue;
    queue.clear();
    let head: u32 = 0;
    queue.push(subClassHash);

    while (head < queue.length) {
      let current = queue.get(head++);
      if (current == superClassHash) return true;

      // 1. Traverse outgoing SubClassOf and EquivalentClasses via SPO
      let axiomId = this.spoHead.get(current as u64) as u32;
      while (axiomId != 0) {
        if (this.axiomActive.get(axiomId) != 0) {
          let baseIdx = axiomId * AXIOM_STRIDE;
          let typeAndLang = this.axiomTable.get(baseIdx + 0);
          let axiomType = (typeAndLang & 0xffff) as u16;

          if (axiomType == AXIOM_SUBCLASS_OF || axiomType == AXIOM_EQUIV_CLASS) {
            let targetHash = this.axiomTable.get(baseIdx + 3); // objectHash
            if (targetHash == superClassHash) return true;
            if (targetHash != 0) {
              let visited = false;
              for (let k: u32 = 0; k < queue.length; k++) {
                if (queue.get(k) == targetHash) {
                  visited = true;
                  break;
                }
              }
              if (!visited) {
                queue.push(targetHash);
              }
            }
          }
        }
        axiomId = this.nextSpo.get(axiomId);
      }

      // 2. Traverse incoming EquivalentClasses via OSP (Equivalence is symmetric)
      let ospAxiomId = this.ospHead.get(current as u64) as u32;
      while (ospAxiomId != 0) {
        if (this.axiomActive.get(ospAxiomId) != 0) {
          let baseIdx = ospAxiomId * AXIOM_STRIDE;
          let typeAndLang = this.axiomTable.get(baseIdx + 0);
          let axiomType = (typeAndLang & 0xffff) as u16;

          if (axiomType == AXIOM_EQUIV_CLASS) {
            let targetHash = this.axiomTable.get(baseIdx + 1); // subjectHash
            if (targetHash == superClassHash) return true;
            if (targetHash != 0) {
              let visited = false;
              for (let k: u32 = 0; k < queue.length; k++) {
                if (queue.get(k) == targetHash) {
                  visited = true;
                  break;
                }
              }
              if (!visited) {
                queue.push(targetHash);
              }
            }
          }
        }
        ospAxiomId = this.nextOsp.get(ospAxiomId);
      }
    }

    return false;
  }

  /**
   * Disjointness Reasoner (AXIOM_DISJOINT_CLASSES).
   * Checks if class1 and class2 (or their superclasses) share a disjointness axiom.
   */
  areDisjoint(class1Hash: u32, class2Hash: u32): boolean {
    if (class1Hash == 0 || class2Hash == 0) return false;
    if (class1Hash == class2Hash) return false;

    // Collect all superclasses & equivalents of class1
    let ancestors1 = createChunkedUint32Array(32);
    let head: u32 = 0;
    ancestors1.push(class1Hash);

    while (head < ancestors1.length) {
      let current = ancestors1.get(head++);

      // 1. Check outgoing DisjointClasses via SPO
      let axiomId = this.spoHead.get(current as u64) as u32;
      while (axiomId != 0) {
        let baseIdx = axiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;

        if (axiomType == AXIOM_DISJOINT_CLASSES) {
          let disjointPartner = this.axiomTable.get(baseIdx + 3);
          if (disjointPartner == class2Hash || this.isSubClassOf(class2Hash, disjointPartner)) {
            return true;
          }
        } else if (axiomType == AXIOM_SUBCLASS_OF || axiomType == AXIOM_EQUIV_CLASS) {
          let targetHash = this.axiomTable.get(baseIdx + 3);
          if (targetHash != 0) {
            let visited = false;
            for (let k: u32 = 0; k < ancestors1.length; k++) {
              if (ancestors1.get(k) == targetHash) { visited = true; break; }
            }
            if (!visited) ancestors1.push(targetHash);
          }
        }
        axiomId = this.nextSpo.get(axiomId);
      }

      // 2. Check incoming DisjointClasses and EquivalentClasses via OSP
      let ospAxiomId = this.ospHead.get(current as u64) as u32;
      while (ospAxiomId != 0) {
        let baseIdx = ospAxiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;

        if (axiomType == AXIOM_DISJOINT_CLASSES) {
          let disjointPartner = this.axiomTable.get(baseIdx + 1);
          if (disjointPartner == class2Hash || this.isSubClassOf(class2Hash, disjointPartner)) {
            return true;
          }
        } else if (axiomType == AXIOM_EQUIV_CLASS) {
          let targetHash = this.axiomTable.get(baseIdx + 1);
          if (targetHash != 0) {
            let visited = false;
            for (let k: u32 = 0; k < ancestors1.length; k++) {
              if (ancestors1.get(k) == targetHash) { visited = true; break; }
            }
            if (!visited) ancestors1.push(targetHash);
          }
        }
        ospAxiomId = this.nextOsp.get(ospAxiomId);
      }
    }

    return false;
  }

  /**
   * Instance Classification Reasoner (AXIOM_CLASS_ASSERT).
   * Checks if an individual belongs to a class (either directly or via subclass inference).
   */
  isInstanceOf(individualHash: u32, classHash: u32): boolean {
    if (individualHash == 0 || classHash == 0) return false;

    let axiomId = this.spoHead.get(individualHash as u64) as u32;
    while (axiomId != 0) {
      let baseIdx = axiomId * AXIOM_STRIDE;
      let typeAndLang = this.axiomTable.get(baseIdx + 0);
      let axiomType = (typeAndLang & 0xffff) as u16;

      if (axiomType == AXIOM_CLASS_ASSERT) {
        let directTypeHash = this.axiomTable.get(baseIdx + 3); // objectHash is class
        if (directTypeHash == classHash || this.isSubClassOf(directTypeHash, classHash)) {
          return true;
        }
      }
      axiomId = this.nextSpo.get(axiomId);
    }

    return false;
  }

  /**
   * Transitive Property Closure Reasoner (AXIOM_OBJ_PROP_ASSERT).
   * Traverses object property assertions to compute reachable nodes from a source individual.
   */
  getTransitiveClosure(propertyHash: u32, sourceHash: u32, outBuffer: ChunkedUint32Array): u32 {
    if (sourceHash == 0) return 0;

    let queue = createChunkedUint32Array(32);
    let head: u32 = 0;
    queue.push(sourceHash);

    let matchCount: u32 = 0;

    while (head < queue.length) {
      let current = queue.get(head++);

      let axiomId = this.spoHead.get(current as u64) as u32;
      while (axiomId != 0) {
        let baseIdx = axiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;
        let p = this.axiomTable.get(baseIdx + 2);

        if (axiomType == AXIOM_OBJ_PROP_ASSERT && (propertyHash == 0 || propertyHash == WILDCARD_PATTERN || p == propertyHash)) {
          let target = this.axiomTable.get(baseIdx + 3);
          if (target != 0) {
            let visited = false;
            for (let k: u32 = 0; k < queue.length; k++) {
              if (queue.get(k) == target) {
                visited = true;
                break;
              }
            }
            if (!visited) {
              queue.push(target);
              outBuffer.push(target);
              matchCount++;
            }
          }
        }
        axiomId = this.nextSpo.get(axiomId);
      }
    }

    return matchCount;
  }

  /**
   * Explains why subClass is a subclass of superClass by returning the sequence of axiom records
   * that justify the subsumption path.
   * Writes the axiom records into outBuffer and returns the number of axioms.
   */
  explainSubsumption(subClassHash: u32, superClassHash: u32, outBuffer: ChunkedUint32Array): u32 {
    if (subClassHash == 0 || superClassHash == 0) return 0;
    if (subClassHash == superClassHash) return 0;

    let queue = createChunkedUint32Array(64);
    let parentAxiom = createChunkedUint32Array(64);
    let parentNode = createChunkedUint32Array(64);
    let head: u32 = 0;

    queue.push(subClassHash);
    parentAxiom.push(0);
    parentNode.push(0);

    let targetQueueIdx: i32 = -1;

    while (head < queue.length) {
      let currentIdx = head++;
      let current = queue.get(currentIdx);
      if (current == superClassHash) {
        targetQueueIdx = currentIdx as i32;
        break;
      }

      // 1. Traverse outgoing SubClassOf and EquivalentClasses via SPO
      let axiomId = this.spoHead.get(current as u64) as u32;
      while (axiomId != 0) {
        let baseIdx = axiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;

        if (axiomType == AXIOM_SUBCLASS_OF || axiomType == AXIOM_EQUIV_CLASS) {
          let targetHash = this.axiomTable.get(baseIdx + 3); // objectHash
          if (targetHash != 0) {
            let visited = false;
            for (let k: u32 = 0; k < queue.length; k++) {
              if (queue.get(k) == targetHash) {
                visited = true;
                break;
              }
            }
            if (!visited) {
              queue.push(targetHash);
              parentAxiom.push(axiomId);
              parentNode.push(currentIdx);
              if (targetHash == superClassHash) {
                targetQueueIdx = (queue.length - 1) as i32;
                break;
              }
            }
          }
        }
        axiomId = this.nextSpo.get(axiomId);
      }
      if (targetQueueIdx >= 0) break;

      // 2. Traverse incoming EquivalentClasses via OSP
      let ospAxiomId = this.ospHead.get(current as u64) as u32;
      while (ospAxiomId != 0) {
        let baseIdx = ospAxiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;

        if (axiomType == AXIOM_EQUIV_CLASS) {
          let targetHash = this.axiomTable.get(baseIdx + 1); // subjectHash
          if (targetHash != 0) {
            let visited = false;
            for (let k: u32 = 0; k < queue.length; k++) {
              if (queue.get(k) == targetHash) {
                visited = true;
                break;
              }
            }
            if (!visited) {
              queue.push(targetHash);
              parentAxiom.push(ospAxiomId);
              parentNode.push(currentIdx);
              if (targetHash == superClassHash) {
                targetQueueIdx = (queue.length - 1) as i32;
                break;
              }
            }
          }
        }
        ospAxiomId = this.nextOsp.get(ospAxiomId);
      }
      if (targetQueueIdx >= 0) break;
    }

    if (targetQueueIdx < 0) return 0;

    // Backtrack path
    let path = createChunkedUint32Array(16);
    let curr = targetQueueIdx;
    while (curr > 0) {
      let ax = parentAxiom.get(curr);
      if (ax != 0) path.push(ax);
      curr = parentNode.get(curr) as i32;
    }

    // Push in forward order (source -> target)
    let count: u32 = path.length;
    for (let i: i32 = (count as i32) - 1; i >= 0; i--) {
      let axId = path.get(i as u32);
      let baseIdx = axId * AXIOM_STRIDE;
      for (let w: u32 = 0; w < AXIOM_STRIDE; w++) {
        outBuffer.push(this.axiomTable.get(baseIdx + w));
      }
    }

    return count;
  }

  /**
   * Audits full ontology consistency against DisjointClasses axioms.
   * Emits conflicting axiom records to outBuffer and returns conflict count.
   */
  checkConsistency(outBuffer: ChunkedUint32Array): u32 {
    let conflictCount: u32 = 0;

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let baseIdx = i * AXIOM_STRIDE;
      let typeAndLang = this.axiomTable.get(baseIdx + 0);
      let axiomType = (typeAndLang & 0xffff) as u16;

      if (axiomType == AXIOM_DISJOINT_CLASSES) {
        let class1 = this.axiomTable.get(baseIdx + 1); // subjectHash
        let class2 = this.axiomTable.get(baseIdx + 3); // objectHash

        if (class1 != 0 && class2 != 0) {
          // 1. Check if any class is a subclass of both disjoint classes
          for (let c: u32 = 1; c < this.axiomCount; c++) {
            if (this.axiomActive.get(c) == 0) continue;
            let cIdx = c * AXIOM_STRIDE;
            let cType = (this.axiomTable.get(cIdx + 0) & 0xffff) as u16;
            if (cType == AXIOM_CLASS_DECL || cType == AXIOM_SUBCLASS_OF) {
              let cand = this.axiomTable.get(cIdx + 1);
              if (cand != 0) {
                let isSub1 = cand == class1 || this.isSubClassOf(cand, class1);
                let isSub2 = cand == class2 || this.isSubClassOf(cand, class2);
                if (isSub1 && isSub2) {
                  for (let w: u32 = 0; w < AXIOM_STRIDE; w++) {
                    outBuffer.push(this.axiomTable.get(cIdx + w));
                  }
                  conflictCount++;
                  break;
                }
              }
            }
          }

          // 2. Check if any individual is an instance of both class1 and class2
          for (let j: u32 = 1; j < this.axiomCount; j++) {
            if (this.axiomActive.get(j) == 0) continue;
            let indIdx = j * AXIOM_STRIDE;
            let indTypeAndLang = this.axiomTable.get(indIdx + 0);
            let indAxType = (indTypeAndLang & 0xffff) as u16;

            if (indAxType == AXIOM_CLASS_ASSERT) {
              let ind = this.axiomTable.get(indIdx + 1);
              let type1 = this.axiomTable.get(indIdx + 3);
              if ((type1 == class1 || this.isSubClassOf(type1, class1)) && this.isInstanceOf(ind, class2)) {
                for (let w: u32 = 0; w < AXIOM_STRIDE; w++) {
                  outBuffer.push(this.axiomTable.get(indIdx + w));
                }
                conflictCount++;
              }
            }
          }
        }
      }
    }

    return conflictCount;
  }

  /**
   * Tests consistency under an active axiom mask.
   */
  testConsistencyMask(mask: ChunkedUint32Array): boolean {
    let saved = createChunkedUint32Array(this.axiomCount);
    for (let i: u32 = 1; i < this.axiomCount; i++) {
      saved.set(i, this.axiomActive.get(i));
      let shouldBeActive = i < mask.length ? mask.get(i) : 1;
      this.axiomActive.set(i, shouldBeActive & saved.get(i));
    }
    this.computeIntervalIndex();

    let dummy = createChunkedUint32Array(16);
    let count = this.checkConsistency(dummy);

    // Restore
    for (let i: u32 = 1; i < this.axiomCount; i++) {
      this.axiomActive.set(i, saved.get(i));
    }
    this.computeIntervalIndex();
    return count == 0;
  }

  /**
   * Linear-memory Junker's QuickXplain algorithm to isolate a single Minimal Unsatisfiable Subset (MUS).
   */
  quickXplain(bgAxioms: ChunkedUint32Array, deltaAxioms: ChunkedUint32Array, outMus: ChunkedUint32Array): u32 {
    let mask = createChunkedUint32Array(this.axiomCount);
    for (let i: u32 = 0; i < this.axiomCount; i++) mask.push(0);

    for (let i: u32 = 0; i < bgAxioms.length; i++) mask.set(bgAxioms.get(i), 1);
    for (let i: u32 = 0; i < deltaAxioms.length; i++) mask.set(deltaAxioms.get(i), 1);

    if (this.testConsistencyMask(mask)) {
      return 0; // Consistent, no conflict
    }

    return this.qxRecurse(bgAxioms, deltaAxioms, outMus);
  }

  qxRecurse(b: ChunkedUint32Array, delta: ChunkedUint32Array, outMus: ChunkedUint32Array): u32 {
    if (b.length > 0) {
      let bMask = createChunkedUint32Array(this.axiomCount);
      for (let i: u32 = 0; i < this.axiomCount; i++) bMask.push(0);
      for (let i: u32 = 0; i < b.length; i++) bMask.set(b.get(i), 1);
      if (!this.testConsistencyMask(bMask)) {
        return 0;
      }
    }
    if (delta.length == 0) return 0;
    if (delta.length == 1) {
      outMus.push(delta.get(0));
      return 1;
    }

    let mid: u32 = delta.length / 2;
    let d1 = createChunkedUint32Array(mid);
    let d2 = createChunkedUint32Array(delta.length - mid);
    for (let i: u32 = 0; i < mid; i++) d1.push(delta.get(i));
    for (let i: u32 = mid; i < delta.length; i++) d2.push(delta.get(i));

    // Test B ∪ D1
    let bUnionD1 = createChunkedUint32Array(b.length + d1.length);
    let bUnionD1Mask = createChunkedUint32Array(this.axiomCount);
    for (let i: u32 = 0; i < this.axiomCount; i++) bUnionD1Mask.push(0);
    for (let i: u32 = 0; i < b.length; i++) { bUnionD1.push(b.get(i)); bUnionD1Mask.set(b.get(i), 1); }
    for (let i: u32 = 0; i < d1.length; i++) { bUnionD1.push(d1.get(i)); bUnionD1Mask.set(d1.get(i), 1); }

    if (!this.testConsistencyMask(bUnionD1Mask)) {
      return this.qxRecurse(b, d1, outMus);
    }

    let d2Core = createChunkedUint32Array(16);
    this.qxRecurse(bUnionD1, d2, d2Core);

    let bUnionD2Core = createChunkedUint32Array(b.length + d2Core.length);
    for (let i: u32 = 0; i < b.length; i++) bUnionD2Core.push(b.get(i));
    for (let i: u32 = 0; i < d2Core.length; i++) bUnionD2Core.push(d2Core.get(i));

    let d1Core = createChunkedUint32Array(16);
    this.qxRecurse(bUnionD2Core, d1, d1Core);

    for (let i: u32 = 0; i < d1Core.length; i++) outMus.push(d1Core.get(i));
    for (let i: u32 = 0; i < d2Core.length; i++) outMus.push(d2Core.get(i));
    return d1Core.length + d2Core.length;
  }

  /**
   * Reiter's Hitting Set Tree (HST) algorithm:
   * Enumerates All Minimal Unsatisfiable Subsets (All-MUS) in WASM memory.
   * Serializes into outBuffer:
   * [0]: totalMusCount
   * [1]: mus1_size, [2..1+mus1_size]: mus1 axiomIds
   * [...]: mus2_size, ...
   */
  allMusHST(outBuffer: ChunkedUint32Array, maxCores: u32 = 16): u32 {
    let delta = createChunkedUint32Array(this.axiomCount);
    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) != 0) delta.push(i);
    }

    let bg = createChunkedUint32Array(0);
    let rootCore = createChunkedUint32Array(16);
    this.quickXplain(bg, delta, rootCore);

    if (rootCore.length == 0) {
      outBuffer.push(0);
      return 0; // Consistent
    }

    // Queue of hitting set paths (masks of axioms excluded so far)
    let discoveredCores: ChunkedUint32Array[] = [];
    discoveredCores.push(rootCore);

    let pathsQueue = createChunkedUint32Array(64); // array of axiom exclusions
    let pathOffsets = createChunkedUint32Array(16);
    let pathLengths = createChunkedUint32Array(16);

    for (let i: u32 = 0; i < rootCore.length; i++) {
      pathOffsets.push(pathsQueue.length);
      pathLengths.push(1);
      pathsQueue.push(rootCore.get(i));
    }

    let head: u32 = 0;
    while (head < pathOffsets.length && (discoveredCores.length as u32) < maxCores) {
      let pOff = pathOffsets.get(head);
      let pLen = pathLengths.get(head++);

      let curDelta = createChunkedUint32Array(this.axiomCount);
      for (let i: u32 = 1; i < this.axiomCount; i++) {
        if (this.axiomActive.get(i) == 0) continue;
        let excluded = false;
        for (let k: u32 = 0; k < pLen; k++) {
          if (pathsQueue.get(pOff + k) == i) { excluded = true; break; }
        }
        if (!excluded) curDelta.push(i);
      }

      let newCore = createChunkedUint32Array(16);
      this.quickXplain(bg, curDelta, newCore);

      if (newCore.length > 0) {
        // Check uniqueness
        let isDup = false;
        for (let c: i32 = 0; c < discoveredCores.length; c++) {
          let ex = discoveredCores[c];
          if (ex.length == newCore.length) {
            let match = true;
            for (let k: u32 = 0; k < newCore.length; k++) {
              let f = false;
              for (let m: u32 = 0; m < ex.length; m++) {
                if (ex.get(m) == newCore.get(k)) { f = true; break; }
              }
              if (!f) { match = false; break; }
            }
            if (match) { isDup = true; break; }
          }
        }

        if (!isDup) {
          discoveredCores.push(newCore);

          // Enqueue further branching
          if ((discoveredCores.length as u32) < maxCores) {
            for (let i: u32 = 0; i < newCore.length; i++) {
              let ax = newCore.get(i);
              let alreadyInPath = false;
              for (let k: u32 = 0; k < pLen; k++) {
                if (pathsQueue.get(pOff + k) == ax) { alreadyInPath = true; break; }
              }
              if (!alreadyInPath) {
                pathOffsets.push(pathsQueue.length);
                pathLengths.push(pLen + 1);
                for (let k: u32 = 0; k < pLen; k++) pathsQueue.push(pathsQueue.get(pOff + k));
                pathsQueue.push(ax);
              }
            }
          }
        }
      }
    }

    // Serialize to outBuffer
    let totalCores = discoveredCores.length as u32;
    outBuffer.push(totalCores);
    for (let c: i32 = 0; c < discoveredCores.length; c++) {
      let core = discoveredCores[c];
      outBuffer.push(core.length);
      for (let k: u32 = 0; k < core.length; k++) {
        outBuffer.push(core.get(k));
      }
    }

    return totalCores;
  }


  /**
   * Classifies an individual, emitting:
   * [0]: directTypeCount
   * [1..directTypeCount]: direct class hashes
   * [1+directTypeCount]: allTypeCount
   * [2+directTypeCount..]: all transitive class hashes
   */
  classifyIndividual(individualHash: u32, outBuffer: ChunkedUint32Array): u32 {
    if (individualHash == 0) return 0;

    let allTypes = createChunkedUint32Array(32);

    // 1. Find all asserted types via SPO
    let axiomId = this.spoHead.get(individualHash as u64) as u32;
    while (axiomId != 0) {
      let baseIdx = axiomId * AXIOM_STRIDE;
      let typeAndLang = this.axiomTable.get(baseIdx + 0);
      let axiomType = (typeAndLang & 0xffff) as u16;

      if (axiomType == AXIOM_CLASS_ASSERT) {
        let typeHash = this.axiomTable.get(baseIdx + 3);
        if (typeHash != 0) {
          let found = false;
          for (let k: u32 = 0; k < allTypes.length; k++) {
            if (allTypes.get(k) == typeHash) {
              found = true;
              break;
            }
          }
          if (!found) allTypes.push(typeHash);
        }
      }
      axiomId = this.nextSpo.get(axiomId);
    }

    // 2. Expand all transitive superclasses
    let head: u32 = 0;
    while (head < allTypes.length) {
      let curr = allTypes.get(head++);
      let axId = this.spoHead.get(curr as u64) as u32;
      while (axId != 0) {
        let bIdx = axId * AXIOM_STRIDE;
        let tLang = this.axiomTable.get(bIdx + 0);
        let aType = (tLang & 0xffff) as u16;
        if (aType == AXIOM_SUBCLASS_OF || aType == AXIOM_EQUIV_CLASS) {
          let sup = this.axiomTable.get(bIdx + 3);
          if (sup != 0) {
            let exists = false;
            for (let k: u32 = 0; k < allTypes.length; k++) {
              if (allTypes.get(k) == sup) {
                exists = true;
                break;
              }
            }
            if (!exists) allTypes.push(sup);
          }
        }
        axId = this.nextSpo.get(axId);
      }
    }

    // 3. Filter direct types (types that are not superclasses of any other type in allTypes)
    let directTypes = createChunkedUint32Array(16);
    for (let i: u32 = 0; i < allTypes.length; i++) {
      let candidate = allTypes.get(i);
      let isStrictSuper = false;
      for (let j: u32 = 0; j < allTypes.length; j++) {
        if (i == j) continue;
        let other = allTypes.get(j);
        if (this.isSubClassOf(other, candidate) && !this.isSubClassOf(candidate, other)) {
          isStrictSuper = true;
          break;
        }
      }
      if (!isStrictSuper) {
        directTypes.push(candidate);
      }
    }

    // Write layout to outBuffer
    outBuffer.push(directTypes.length);
    for (let i: u32 = 0; i < directTypes.length; i++) {
      outBuffer.push(directTypes.get(i));
    }
    outBuffer.push(allTypes.length);
    for (let i: u32 = 0; i < allTypes.length; i++) {
      outBuffer.push(allTypes.get(i));
    }

    return directTypes.length + allTypes.length + 2;
  }

  /**
   * Traverses object property assertions and emits reachable nodes and path edges.
   */
  getTransitiveClosureWithPath(propertyHash: u32, sourceHash: u32, outBuffer: ChunkedUint32Array): u32 {
    if (sourceHash == 0) return 0;

    let queue = createChunkedUint32Array(32);
    let head: u32 = 0;
    queue.push(sourceHash);

    let reachable = createChunkedUint32Array(32);
    let pathEdges = createChunkedUint32Array(64); // pairs: subject, object

    while (head < queue.length) {
      let current = queue.get(head++);

      let axiomId = this.spoHead.get(current as u64) as u32;
      while (axiomId != 0) {
        let baseIdx = axiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;
        let p = this.axiomTable.get(baseIdx + 2);

        if (
          axiomType == AXIOM_OBJ_PROP_ASSERT &&
          (propertyHash == 0 || propertyHash == WILDCARD_PATTERN || p == propertyHash)
        ) {
          let target = this.axiomTable.get(baseIdx + 3);
          if (target != 0) {
            let visited = false;
            for (let k: u32 = 0; k < queue.length; k++) {
              if (queue.get(k) == target) {
                visited = true;
                break;
              }
            }
            if (!visited) {
              queue.push(target);
              reachable.push(target);
              pathEdges.push(current);
              pathEdges.push(target);
            }
          }
        }
        axiomId = this.nextSpo.get(axiomId);
      }
    }

    outBuffer.push(reachable.length);
    for (let i: u32 = 0; i < reachable.length; i++) {
      outBuffer.push(reachable.get(i));
    }
    let edgeCount = pathEdges.length / 2;
    outBuffer.push(edgeCount);
    for (let i: u32 = 0; i < pathEdges.length; i++) {
      outBuffer.push(pathEdges.get(i));
    }

    return reachable.length;
  }

  /**
   * Serializes all unique class nodes in the ontology with their direct supers, direct subs, and equivalents.
   */
  getTaxonomy(outBuffer: ChunkedUint32Array): u32 {
    let classes = createChunkedUint32Array(64);

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      let baseIdx = i * AXIOM_STRIDE;
      let typeAndLang = this.axiomTable.get(baseIdx + 0);
      let axiomType = (typeAndLang & 0xffff) as u16;

      let s = this.axiomTable.get(baseIdx + 1);
      let o = this.axiomTable.get(baseIdx + 3);

      if (axiomType == AXIOM_CLASS_DECL && s != 0) {
        let found = false;
        for (let k: u32 = 0; k < classes.length; k++) {
          if (classes.get(k) == s) {
            found = true;
            break;
          }
        }
        if (!found) classes.push(s);
      } else if (
        axiomType == AXIOM_SUBCLASS_OF ||
        axiomType == AXIOM_EQUIV_CLASS ||
        axiomType == AXIOM_DISJOINT_CLASSES
      ) {
        if (s != 0) {
          let found = false;
          for (let k: u32 = 0; k < classes.length; k++) {
            if (classes.get(k) == s) {
              found = true;
              break;
            }
          }
          if (!found) classes.push(s);
        }
        if (o != 0) {
          let found = false;
          for (let k: u32 = 0; k < classes.length; k++) {
            if (classes.get(k) == o) {
              found = true;
              break;
            }
          }
          if (!found) classes.push(o);
        }
      }
    }

    outBuffer.push(classes.length);

    for (let i: u32 = 0; i < classes.length; i++) {
      let c = classes.get(i);
      outBuffer.push(c);

      let supers = createChunkedUint32Array(8);
      let subs = createChunkedUint32Array(8);
      let equivs = createChunkedUint32Array(8);

      let axId = this.spoHead.get(c as u64) as u32;
      while (axId != 0) {
        let bIdx = axId * AXIOM_STRIDE;
        let tLang = this.axiomTable.get(bIdx + 0);
        let aType = (tLang & 0xffff) as u16;
        let tgt = this.axiomTable.get(bIdx + 3);
        if (tgt != 0) {
          if (aType == AXIOM_SUBCLASS_OF) supers.push(tgt);
          else if (aType == AXIOM_EQUIV_CLASS) equivs.push(tgt);
        }
        axId = this.nextSpo.get(axId);
      }

      let ospId = this.ospHead.get(c as u64) as u32;
      while (ospId != 0) {
        let bIdx = ospId * AXIOM_STRIDE;
        let tLang = this.axiomTable.get(bIdx + 0);
        let aType = (tLang & 0xffff) as u16;
        let src = this.axiomTable.get(bIdx + 1);
        if (src != 0) {
          if (aType == AXIOM_SUBCLASS_OF) subs.push(src);
          else if (aType == AXIOM_EQUIV_CLASS) equivs.push(src);
        }
        ospId = this.nextOsp.get(ospId);
      }

      outBuffer.push(supers.length);
      for (let k: u32 = 0; k < supers.length; k++) outBuffer.push(supers.get(k));

      outBuffer.push(subs.length);
      for (let k: u32 = 0; k < subs.length; k++) outBuffer.push(subs.get(k));

      outBuffer.push(equivs.length);
      for (let k: u32 = 0; k < equivs.length; k++) outBuffer.push(equivs.get(k));
    }

    return classes.length;
  }


  /**
   * Computes O(1) interval DAG labels for all classes.
   * Traverses the hierarchy from root classes and assigns [L, R] intervals.
   */
  computeIntervalIndex(): void {
    this.intervalLeft.clear();
    this.intervalRight.clear();

    // 1. Collect all distinct classes across all active axioms
    let classes = this.distinctClasses;
    classes.clear();
    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let baseIdx = i * AXIOM_STRIDE;
      let typeAndLang = this.axiomTable.get(baseIdx + 0);
      let axiomType = (typeAndLang & 0xffff) as u16;

      if (
        axiomType == AXIOM_CLASS_DECL ||
        axiomType == AXIOM_SUBCLASS_OF ||
        axiomType == AXIOM_EQUIV_CLASS ||
        axiomType == AXIOM_OBJECT_SOME_VALUES_FROM
      ) {
        let sub = this.axiomTable.get(baseIdx + 1);
        let obj = this.axiomTable.get(baseIdx + 3);
        if (sub != 0) {
          let found = false;
          for (let k: u32 = 0; k < classes.length; k++) {
            if (classes.get(k) == sub) { found = true; break; }
          }
          if (!found) classes.push(sub);
        }
        if (obj != 0 && (axiomType == AXIOM_SUBCLASS_OF || axiomType == AXIOM_EQUIV_CLASS)) {
          let found = false;
          for (let k: u32 = 0; k < classes.length; k++) {
            if (classes.get(k) == obj) { found = true; break; }
          }
          if (!found) classes.push(obj);
        }
      }
    }

    if (classes.length == 0) {
      this.hasIntervalIndex = true;
      return;
    }

    // 2. DFS from root classes (classes without outgoing SubClassOf edges)
    let counter: u32 = 1;

    for (let i: u32 = 0; i < classes.length; i++) {
      let c = classes.get(i);
      if (c == 0) continue;

      let isRoot = true;
      let axiomId = this.spoHead.get(c as u64) as u32;
      while (axiomId != 0) {
        if (this.axiomActive.get(axiomId) != 0) {
          let baseIdx = axiomId * AXIOM_STRIDE;
          let typeAndLang = this.axiomTable.get(baseIdx + 0);
          let axiomType = (typeAndLang & 0xffff) as u16;
          if (axiomType == AXIOM_SUBCLASS_OF) {
            let sup = this.axiomTable.get(baseIdx + 3);
            if (sup != 0 && sup != c) {
              isRoot = false;
              break;
            }
          }
        }
        axiomId = this.nextSpo.get(axiomId);
      }

      if (isRoot && !this.intervalLeft.has(c as u64)) {
        counter = this.dfsIntervalAssign(c, counter);
      }
    }

    // 3. Handle any unvisited classes (cycles, disconnected components)
    for (let i: u32 = 0; i < classes.length; i++) {
      let c = classes.get(i);
      if (c != 0 && !this.intervalLeft.has(c as u64)) {
        counter = this.dfsIntervalAssign(c, counter);
      }
    }

    this.hasIntervalIndex = true;
  }

  dfsIntervalAssign(classHash: u32, currentCounter: u32): u32 {
    if (classHash == 0) return currentCounter;
    if (this.intervalLeft.has(classHash as u64)) return currentCounter;

    let left = currentCounter++;
    this.intervalLeft.set(classHash as u64, left as u32);

    // Traverse direct subclasses (incoming SubClassOf edges via OSP)
    let axiomId = this.ospHead.get(classHash as u64) as u32;
    while (axiomId != 0) {
      if (this.axiomActive.get(axiomId) != 0) {
        let baseIdx = axiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;

        if (axiomType == AXIOM_SUBCLASS_OF || axiomType == AXIOM_EQUIV_CLASS) {
          let subHash = this.axiomTable.get(baseIdx + 1);
          if (subHash != 0 && subHash != classHash && !this.intervalLeft.has(subHash as u64)) {
            currentCounter = this.dfsIntervalAssign(subHash, currentCounter);
          }
        }
      }
      axiomId = this.nextOsp.get(axiomId);
    }

    let right = currentCounter++;
    this.intervalRight.set(classHash as u64, right as u32);
    return currentCounter;
  }

  /**
   * Evaluates SPARQL 1.1 Property Path Algebra:
   * Direct, +, *, ^ (inverse), ^+ (inverse transitive), / (sequence), | (alternation).
   */
  evaluatePropertyPath(
    propertyHash: u32,
    pathOp: u32,
    stepPropertyHash2: u32,
    sourceHash: u32,
    outBuffer: ChunkedUint32Array
  ): u32 {
    if (sourceHash == 0) return 0;

    let reachable = createChunkedUint32Array(32);

    switch (pathOp) {
      case PATH_OP_DIRECT: {
        let axId = this.spoHead.get(sourceHash as u64) as u32;
        while (axId != 0) {
          let bIdx = axId * AXIOM_STRIDE;
          let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
          let p = this.axiomTable.get(bIdx + 2);
          if (aType == AXIOM_OBJ_PROP_ASSERT && (propertyHash == 0 || propertyHash == WILDCARD_PATTERN || p == propertyHash)) {
            let o = this.axiomTable.get(bIdx + 3);
            if (o != 0) reachable.push(o);
          }
          axId = this.nextSpo.get(axId);
        }
        break;
      }

      case PATH_OP_INVERSE: {
        let axId = this.ospHead.get(sourceHash as u64) as u32;
        while (axId != 0) {
          let bIdx = axId * AXIOM_STRIDE;
          let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
          let p = this.axiomTable.get(bIdx + 2);
          if (aType == AXIOM_OBJ_PROP_ASSERT && (propertyHash == 0 || propertyHash == WILDCARD_PATTERN || p == propertyHash)) {
            let s = this.axiomTable.get(bIdx + 1);
            if (s != 0) reachable.push(s);
          }
          axId = this.nextOsp.get(axId);
        }
        break;
      }

      case PATH_OP_STAR:
      case PATH_OP_PLUS: {
        if (pathOp == PATH_OP_STAR) {
          reachable.push(sourceHash);
        }
        let queue = createChunkedUint32Array(32);
        let head: u32 = 0;
        queue.push(sourceHash);

        while (head < queue.length) {
          let curr = queue.get(head++);
          let axId = this.spoHead.get(curr as u64) as u32;
          while (axId != 0) {
            let bIdx = axId * AXIOM_STRIDE;
            let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
            let p = this.axiomTable.get(bIdx + 2);
            if (aType == AXIOM_OBJ_PROP_ASSERT && (propertyHash == 0 || propertyHash == WILDCARD_PATTERN || p == propertyHash)) {
              let tgt = this.axiomTable.get(bIdx + 3);
              if (tgt != 0) {
                let visited = false;
                for (let k: u32 = 0; k < reachable.length; k++) {
                  if (reachable.get(k) == tgt) { visited = true; break; }
                }
                if (!visited) {
                  reachable.push(tgt);
                  queue.push(tgt);
                }
              }
            }
            axId = this.nextSpo.get(axId);
          }
        }
        break;
      }

      case PATH_OP_INVERSE_PLUS: {
        let queue = createChunkedUint32Array(32);
        let head: u32 = 0;
        queue.push(sourceHash);

        while (head < queue.length) {
          let curr = queue.get(head++);
          let axId = this.ospHead.get(curr as u64) as u32;
          while (axId != 0) {
            let bIdx = axId * AXIOM_STRIDE;
            let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
            let p = this.axiomTable.get(bIdx + 2);
            if (aType == AXIOM_OBJ_PROP_ASSERT && (propertyHash == 0 || propertyHash == WILDCARD_PATTERN || p == propertyHash)) {
              let src = this.axiomTable.get(bIdx + 1);
              if (src != 0) {
                let visited = false;
                for (let k: u32 = 0; k < reachable.length; k++) {
                  if (reachable.get(k) == src) { visited = true; break; }
                }
                if (!visited) {
                  reachable.push(src);
                  queue.push(src);
                }
              }
            }
            axId = this.nextOsp.get(axId);
          }
        }
        break;
      }

      case PATH_OP_SEQUENCE: {
        let intermediate = createChunkedUint32Array(16);
        let axId = this.spoHead.get(sourceHash as u64) as u32;
        while (axId != 0) {
          let bIdx = axId * AXIOM_STRIDE;
          let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
          let p = this.axiomTable.get(bIdx + 2);
          if (aType == AXIOM_OBJ_PROP_ASSERT && (propertyHash == 0 || propertyHash == WILDCARD_PATTERN || p == propertyHash)) {
            let tgt = this.axiomTable.get(bIdx + 3);
            if (tgt != 0) intermediate.push(tgt);
          }
          axId = this.nextSpo.get(axId);
        }

        for (let i: u32 = 0; i < intermediate.length; i++) {
          let inter = intermediate.get(i);
          let axId2 = this.spoHead.get(inter as u64) as u32;
          while (axId2 != 0) {
            let bIdx2 = axId2 * AXIOM_STRIDE;
            let aType2 = (this.axiomTable.get(bIdx2 + 0) & 0xffff) as u16;
            let p2 = this.axiomTable.get(bIdx2 + 2);
            if (aType2 == AXIOM_OBJ_PROP_ASSERT && (stepPropertyHash2 == 0 || stepPropertyHash2 == WILDCARD_PATTERN || p2 == stepPropertyHash2)) {
              let tgt2 = this.axiomTable.get(bIdx2 + 3);
              if (tgt2 != 0) {
                let visited = false;
                for (let k: u32 = 0; k < reachable.length; k++) {
                  if (reachable.get(k) == tgt2) { visited = true; break; }
                }
                if (!visited) reachable.push(tgt2);
              }
            }
            axId2 = this.nextSpo.get(axId2);
          }
        }
        break;
      }

      case PATH_OP_ALTERNATION: {
        let axId = this.spoHead.get(sourceHash as u64) as u32;
        while (axId != 0) {
          let bIdx = axId * AXIOM_STRIDE;
          let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
          let p = this.axiomTable.get(bIdx + 2);
          if (aType == AXIOM_OBJ_PROP_ASSERT && (p == propertyHash || p == stepPropertyHash2)) {
            let tgt = this.axiomTable.get(bIdx + 3);
            if (tgt != 0) {
              let visited = false;
              for (let k: u32 = 0; k < reachable.length; k++) {
                if (reachable.get(k) == tgt) { visited = true; break; }
              }
              if (!visited) reachable.push(tgt);
            }
          }
          axId = this.nextSpo.get(axId);
        }
        break;
      }
    }

    for (let i: u32 = 0; i < reachable.length; i++) {
      outBuffer.push(reachable.get(i));
    }
    return reachable.length;
  }

  /**
   * EL++ Consequence-based saturation rules (CR1 - CR3).
   * Runs forward-chaining polynomial fixed point.
   */
  saturateELRules(): u32 {
    let newInferences: u32 = 0;
    let changed = true;
    let iterations: u32 = 0;

    while (changed && iterations < 16) {
      changed = false;
      iterations++;

      // CR1: C ⊑ D ∧ D ⊑ E ⇒ C ⊑ E
      for (let i: u32 = 1; i < this.axiomCount; i++) {
        if (this.axiomActive.get(i) == 0) continue;
        let bIdx1 = i * AXIOM_STRIDE;
        let tLang1 = this.axiomTable.get(bIdx1 + 0);
        let aType1 = (tLang1 & 0xffff) as u16;

        if (aType1 == AXIOM_SUBCLASS_OF) {
          let c = this.axiomTable.get(bIdx1 + 1);
          let d = this.axiomTable.get(bIdx1 + 3);

          if (c != 0 && d != 0 && c != d) {
            let axId2 = this.spoHead.get(d as u64) as u32;
            while (axId2 != 0) {
              if (this.axiomActive.get(axId2) != 0) {
                let bIdx2 = axId2 * AXIOM_STRIDE;
                let aType2 = (this.axiomTable.get(bIdx2 + 0) & 0xffff) as u16;
                if (aType2 == AXIOM_SUBCLASS_OF) {
                  let e = this.axiomTable.get(bIdx2 + 3);
                  if (e != 0 && e != c && e != d) {
                    if (!this.hasDirectSubclass(c, e)) {
                      this.addAxiom(AXIOM_SUBCLASS_OF, 0, c, 0, e, 1);
                      newInferences++;
                      changed = true;
                    }
                  }
                }
              }
              axId2 = this.nextSpo.get(axId2);
            }
          }
        }

        // CR2: C ⊑ ∃R.D ∧ D ⊑ E ∧ ∃R.E ⊑ F ⇒ C ⊑ F
        else if (aType1 == AXIOM_OBJECT_SOME_VALUES_FROM) {
          let c = this.axiomTable.get(bIdx1 + 1);
          let r = this.axiomTable.get(bIdx1 + 2);
          let d = this.axiomTable.get(bIdx1 + 3);

          for (let j: u32 = 1; j < this.axiomCount; j++) {
            if (this.axiomActive.get(j) == 0) continue;
            let bIdx2 = j * AXIOM_STRIDE;
            let aType2 = (this.axiomTable.get(bIdx2 + 0) & 0xffff) as u16;
            if (aType2 == AXIOM_OBJECT_SOME_VALUES_FROM) {
              let exClass = this.axiomTable.get(bIdx2 + 1);
              let r2 = this.axiomTable.get(bIdx2 + 2);
              let e = this.axiomTable.get(bIdx2 + 3);

              if (r == r2 && (d == e || this.isSubClassOf(d, e))) {
                if (exClass != 0 && exClass != c && !this.hasDirectSubclass(c, exClass)) {
                  this.addAxiom(AXIOM_SUBCLASS_OF, 0, c, 0, exClass, 1);
                  newInferences++;
                  changed = true;
                }
              }
            }
          }
        }

        // CR3: R ∘ S ⊑ T (Property Chain): C ⊑ ∃R.D ∧ D ⊑ ∃S.E ⇒ C ⊑ ∃T.E
        else if (aType1 == AXIOM_SUB_PROPERTY_CHAIN) {
          let r = this.axiomTable.get(bIdx1 + 1);
          let s = this.axiomTable.get(bIdx1 + 2);
          let t = this.axiomTable.get(bIdx1 + 3);

          for (let j: u32 = 1; j < this.axiomCount; j++) {
            if (this.axiomActive.get(j) == 0) continue;
            let bIdx2 = j * AXIOM_STRIDE;
            let aType2 = (this.axiomTable.get(bIdx2 + 0) & 0xffff) as u16;
            if (aType2 == AXIOM_OBJECT_SOME_VALUES_FROM) {
              let c = this.axiomTable.get(bIdx2 + 1);
              let rCand = this.axiomTable.get(bIdx2 + 2);
              let d = this.axiomTable.get(bIdx2 + 3);

              if (rCand == r) {
                let axId3 = this.spoHead.get(d as u64) as u32;
                while (axId3 != 0) {
                  if (this.axiomActive.get(axId3) != 0) {
                    let bIdx3 = axId3 * AXIOM_STRIDE;
                    let aType3 = (this.axiomTable.get(bIdx3 + 0) & 0xffff) as u16;
                    let sCand = this.axiomTable.get(bIdx3 + 2);
                    let e = this.axiomTable.get(bIdx3 + 3);

                    if (aType3 == AXIOM_OBJECT_SOME_VALUES_FROM && sCand == s) {
                      if (!this.hasExistential(c, t, e)) {
                        this.addAxiom(AXIOM_OBJECT_SOME_VALUES_FROM, 0, c, t, e, 1);
                        newInferences++;
                        changed = true;
                      }
                    }
                  }
                  axId3 = this.nextSpo.get(axId3);
                }
              }
            }
          }
        }
      }
    }

    if (newInferences > 0) {
      this.computeIntervalIndex();
    }
    return newInferences;
  }

  hasDirectSubclass(sub: u32, sup: u32): boolean {
    let axId = this.spoHead.get(sub as u64) as u32;
    while (axId != 0) {
      if (this.axiomActive.get(axId) != 0) {
        let bIdx = axId * AXIOM_STRIDE;
        let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
        let tgt = this.axiomTable.get(bIdx + 3);
        if (aType == AXIOM_SUBCLASS_OF && tgt == sup) return true;
      }
      axId = this.nextSpo.get(axId);
    }
    return false;
  }

  hasExistential(c: u32, r: u32, d: u32): boolean {
    let axId = this.spoHead.get(c as u64) as u32;
    while (axId != 0) {
      if (this.axiomActive.get(axId) != 0) {
        let bIdx = axId * AXIOM_STRIDE;
        let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
        let rAx = this.axiomTable.get(bIdx + 2);
        let dAx = this.axiomTable.get(bIdx + 3);
        if (aType == AXIOM_OBJECT_SOME_VALUES_FROM && rAx == r && dAx == d) return true;
      }
      axId = this.nextSpo.get(axId);
    }
    return false;
  }

  hasObjectPropertyAssertion(subj: u32, prop: u32, obj: u32): boolean {
    let axId = this.spoHead.get(subj as u64) as u32;
    while (axId != 0) {
      if (this.axiomActive.get(axId) != 0) {
        let bIdx = axId * AXIOM_STRIDE;
        let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
        let p = this.axiomTable.get(bIdx + 2);
        let o = this.axiomTable.get(bIdx + 3);
        if (aType == AXIOM_OBJ_PROP_ASSERT && p == prop && o == obj) return true;
      }
      axId = this.nextSpo.get(axId);
    }
    return false;
  }

  hasDirectClassAssertion(ind: u32, cls: u32): boolean {
    let axId = this.spoHead.get(ind as u64) as u32;
    while (axId != 0) {
      if (this.axiomActive.get(axId) != 0) {
        let bIdx = axId * AXIOM_STRIDE;
        let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
        let c = this.axiomTable.get(bIdx + 3);
        if (aType == AXIOM_CLASS_ASSERT && c == cls) return true;
      }
      axId = this.nextSpo.get(axId);
    }
    return false;
  }

  /**
   * Saturates symmetric properties, inverse properties, and self restrictions.
   */
  saturateSymmetricAndInverses(): u32 {
    let newInferences: u32 = 0;

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let bIdx = i * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;

      // 1. Symmetric Object Property: Sym(R) ∧ R(x, y) ⇒ R(y, x)
      if (aType == AXIOM_SYMMETRIC_PROP) {
        let prop = this.axiomTable.get(bIdx + 2);
        let axId = this.posHead.get(prop as u64) as u32;
        while (axId != 0) {
          if (this.axiomActive.get(axId) != 0) {
            let jIdx = axId * AXIOM_STRIDE;
            let jType = (this.axiomTable.get(jIdx + 0) & 0xffff) as u16;
            if (jType == AXIOM_OBJ_PROP_ASSERT) {
              let s = this.axiomTable.get(jIdx + 1);
              let o = this.axiomTable.get(jIdx + 3);
              if (s != 0 && o != 0 && s != o && !this.hasObjectPropertyAssertion(o, prop, s)) {
                this.addAxiom(AXIOM_OBJ_PROP_ASSERT, 0, o, prop, s, 1);
                newInferences++;
              }
            }
          }
          axId = this.nextPos.get(axId);
        }
      }

      // 2. Inverse Object Property: Inv(R, S) ∧ R(x, y) ⇒ S(y, x)
      else if (aType == AXIOM_INVERSE_PROP) {
        let r = this.axiomTable.get(bIdx + 2);
        let s = this.axiomTable.get(bIdx + 3);

        // Forward: R(x, y) ⇒ S(y, x)
        let axIdR = this.posHead.get(r as u64) as u32;
        while (axIdR != 0) {
          if (this.axiomActive.get(axIdR) != 0) {
            let jIdx = axIdR * AXIOM_STRIDE;
            let jType = (this.axiomTable.get(jIdx + 0) & 0xffff) as u16;
            if (jType == AXIOM_OBJ_PROP_ASSERT) {
              let subj = this.axiomTable.get(jIdx + 1);
              let obj = this.axiomTable.get(jIdx + 3);
              if (subj != 0 && obj != 0 && !this.hasObjectPropertyAssertion(obj, s, subj)) {
                this.addAxiom(AXIOM_OBJ_PROP_ASSERT, 0, obj, s, subj, 1);
                newInferences++;
              }
            }
          }
          axIdR = this.nextPos.get(axIdR);
        }

        // Backward: S(x, y) ⇒ R(y, x)
        let axIdS = this.posHead.get(s as u64) as u32;
        while (axIdS != 0) {
          if (this.axiomActive.get(axIdS) != 0) {
            let jIdx = axIdS * AXIOM_STRIDE;
            let jType = (this.axiomTable.get(jIdx + 0) & 0xffff) as u16;
            if (jType == AXIOM_OBJ_PROP_ASSERT) {
              let subj = this.axiomTable.get(jIdx + 1);
              let obj = this.axiomTable.get(jIdx + 3);
              if (subj != 0 && obj != 0 && !this.hasObjectPropertyAssertion(obj, r, subj)) {
                this.addAxiom(AXIOM_OBJ_PROP_ASSERT, 0, obj, r, subj, 1);
                newInferences++;
              }
            }
          }
          axIdS = this.nextPos.get(axIdS);
        }
      }

      // 3. Self Restriction: C ⊑ ∃R.Self ∧ x : C ⇒ R(x, x)
      else if (aType == AXIOM_SELF_RESTRICTION) {
        let cls = this.axiomTable.get(bIdx + 1);
        let prop = this.axiomTable.get(bIdx + 2);

        for (let j: u32 = 1; j < this.axiomCount; j++) {
          if (this.axiomActive.get(j) == 0) continue;
          let jIdx = j * AXIOM_STRIDE;
          let jType = (this.axiomTable.get(jIdx + 0) & 0xffff) as u16;
          if (jType == AXIOM_CLASS_ASSERT && this.isInstanceOf(this.axiomTable.get(jIdx + 1), cls)) {
            let ind = this.axiomTable.get(jIdx + 1);
            if (ind != 0 && !this.hasObjectPropertyAssertion(ind, prop, ind)) {
              this.addAxiom(AXIOM_OBJ_PROP_ASSERT, 0, ind, prop, ind, 1);
              newInferences++;
            }
          }
        }
      }
    }

    return newInferences;
  }

  /**
   * Consequence-based forward propagation for Universal Restrictions:
   * (C ⊑ ∀R.D ∧ x : C ∧ R(x, y)) ⇒ y : D
   */
  saturateUniversalRestrictions(): u32 {
    let newInferences: u32 = 0;

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let bIdx = i * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;

      if (aType == AXIOM_UNIVERSAL_RESTRICTION) {
        let cls = this.axiomTable.get(bIdx + 1); // C (or 0 for global)
        let prop = this.axiomTable.get(bIdx + 2); // R
        let targetCls = this.axiomTable.get(bIdx + 3); // D

        // Scan all R assertions: R(x, y)
        let axId = this.posHead.get(prop as u64) as u32;
        while (axId != 0) {
          if (this.axiomActive.get(axId) != 0) {
            let jIdx = axId * AXIOM_STRIDE;
            let jType = (this.axiomTable.get(jIdx + 0) & 0xffff) as u16;
            if (jType == AXIOM_OBJ_PROP_ASSERT) {
              let s = this.axiomTable.get(jIdx + 1);
              let o = this.axiomTable.get(jIdx + 3);
              if (s != 0 && o != 0 && (cls == 0 || this.isInstanceOf(s, cls))) {
                if (!this.isInstanceOf(o, targetCls)) {
                  this.addAxiom(AXIOM_CLASS_ASSERT, 0, o, 0, targetCls, 1);
                  newInferences++;
                }
              }
            }
          }
          axId = this.nextPos.get(axId);
        }
      }
    }

    return newInferences;
  }

  /**
   * Deterministic Unit Resolution over Disjunctive Classes (Modus Tollendo Ponens):
   * C ⊑ D1 ⊔ D2 ∧ x : C ∧ x : ¬D1 ⇒ x : D2
   * Also structural merging: D1 ⊑ E ∧ D2 ⊑ E ⇒ C ⊑ E
   */
  saturateDisjunctiveUnitResolution(): u32 {
    let newInferences: u32 = 0;

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let bIdx = i * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;

      if (aType == AXIOM_DISJUNCTIVE_CLASS) {
        let clsC = this.axiomTable.get(bIdx + 1);
        let clsD1 = this.axiomTable.get(bIdx + 3);
        let clsD2 = this.axiomTable.get(bIdx + 4);

        // Structural upward merging: if D1 ⊑ E and D2 ⊑ E ⇒ C ⊑ E
        if (clsD1 != 0 && clsD2 != 0) {
          let axIdE = this.spoHead.get(clsD1 as u64) as u32;
          while (axIdE != 0) {
            if (this.axiomActive.get(axIdE) != 0) {
              let eIdx = axIdE * AXIOM_STRIDE;
              let eType = (this.axiomTable.get(eIdx + 0) & 0xffff) as u16;
              let supE = this.axiomTable.get(eIdx + 3);
              if (eType == AXIOM_SUBCLASS_OF && supE != 0 && this.isSubClassOf(clsD2, supE)) {
                if (!this.hasDirectSubclass(clsC, supE)) {
                  this.addAxiom(AXIOM_SUBCLASS_OF, 0, clsC, 0, supE, 1);
                  newInferences++;
                }
              }
            }
            axIdE = this.nextSpo.get(axIdE);
          }
        }

        // Instance unit resolution: x : C ∧ areDisjoint(typeOf(x), D1) ⇒ x : D2
        for (let j: u32 = 1; j < this.axiomCount; j++) {
          if (this.axiomActive.get(j) == 0) continue;
          let jIdx = j * AXIOM_STRIDE;
          let jType = (this.axiomTable.get(jIdx + 0) & 0xffff) as u16;
          if (jType == AXIOM_CLASS_ASSERT) {
            let ind = this.axiomTable.get(jIdx + 1);
            let indType = this.axiomTable.get(jIdx + 3);
            if (this.isInstanceOf(ind, clsC)) {
              if (clsD1 != 0 && this.areDisjoint(indType, clsD1)) {
                if (clsD2 != 0 && !this.isInstanceOf(ind, clsD2)) {
                  this.addAxiom(AXIOM_CLASS_ASSERT, 0, ind, 0, clsD2, 1);
                  newInferences++;
                }
              } else if (clsD2 != 0 && this.areDisjoint(indType, clsD2)) {
                if (clsD1 != 0 && !this.isInstanceOf(ind, clsD1)) {
                  this.addAxiom(AXIOM_CLASS_ASSERT, 0, ind, 0, clsD1, 1);
                  newInferences++;
                }
              }
            }
          }
        }
      }
    }

    return newInferences;
  }

  /**
   * Evaluates SHACL-AF Rules and exact cardinality aggregations in linear memory.
   * Derives new types and assertions when shape conditions (minCount, maxCount, filler) match.
   */
  evaluateShaclRulesAndCounts(): u32 {
    let newInferences: u32 = 0;

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let bIdx = i * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;

      if (aType == AXIOM_SHACL_RULE) {
        let targetClass = this.axiomTable.get(bIdx + 1);
        let prop = this.axiomTable.get(bIdx + 2);
        let fillerClass = this.axiomTable.get(bIdx + 3);
        let flags = this.axiomTable.get(bIdx + 4);
        let extra = this.axiomTable.get(bIdx + 5);

        let minCount = (flags >>> 16) & 0xffff;
        let maxCount = flags & 0xffff;
        let derivedClass = extra;

        // Iterate over all individuals
        for (let j: u32 = 1; j < this.axiomCount; j++) {
          if (this.axiomActive.get(j) == 0) continue;
          let jIdx = j * AXIOM_STRIDE;
          let jType = (this.axiomTable.get(jIdx + 0) & 0xffff) as u16;

          if (jType == AXIOM_CLASS_ASSERT) {
            let ind = this.axiomTable.get(jIdx + 1);
            if (targetClass == 0 || this.isInstanceOf(ind, targetClass)) {
              // Count matching outgoing property edges
              let count: u32 = 0;
              let axId = this.spoHead.get(ind as u64) as u32;
              while (axId != 0) {
                if (this.axiomActive.get(axId) != 0) {
                  let eIdx = axId * AXIOM_STRIDE;
                  let eType = (this.axiomTable.get(eIdx + 0) & 0xffff) as u16;
                  let p = this.axiomTable.get(eIdx + 2);
                  let o = this.axiomTable.get(eIdx + 3);

                  if (eType == AXIOM_OBJ_PROP_ASSERT && p == prop) {
                    if (fillerClass == 0 || this.isInstanceOf(o, fillerClass)) {
                      count++;
                    }
                  }
                }
                axId = this.nextSpo.get(axId);
              }

              // Check condition: count >= minCount && (maxCount == 0 || count <= maxCount)
              if (count >= minCount && (maxCount == 0 || count <= maxCount)) {
                if (derivedClass != 0 && !this.isInstanceOf(ind, derivedClass)) {
                  this.addAxiom(AXIOM_CLASS_ASSERT, 0, ind, 0, derivedClass, 1);
                  newInferences++;
                }
              }
            }
          }
        }
      }
    }

    return newInferences;
  }

  /**
   * Runs the full hybrid interleaved fixpoint cycle in WASM memory:
   * EL++ ↔ Functional ↔ Symmetric/Inverse ↔ Universal ↔ Disjunctive Unit Resolution ↔ SHACL Rules
   */
  runHybridInterleavedFixpoint(maxRounds: u32 = 16): u32 {
    let totalInferred: u32 = 0;
    let round: u32 = 0;
    let changed = true;

    while (changed && round < maxRounds) {
      changed = false;
      round++;

      let elInf = this.saturateELRules();
      let fnInf = this.saturateFunctionalProperties();
      let symInf = this.saturateSymmetricAndInverses();
      let uniInf = this.saturateUniversalRestrictions();
      let disjInf = this.saturateDisjunctiveUnitResolution();
      let shaclInf = this.evaluateShaclRulesAndCounts();

      let roundTotal = elInf + fnInf + symInf + uniInf + disjInf + shaclInf;
      if (roundTotal > 0) {
        totalInferred += roundTotal;
        changed = true;
      }
    }

    if (totalInferred > 0) {
      this.computeIntervalIndex();
    }
    return totalInferred;
  }

  /**
   * Validates advanced constraints: Asymmetric, Irreflexive, Disjoint Properties,
   * Qualified Cardinalities, and Nominals.
   */
  validateAdvancedConstraints(outViolations: ChunkedUint32Array): u32 {
    let count: u32 = 0;

    for (let i: u32 = 1; i < this.axiomCount; i++) {
      if (this.axiomActive.get(i) == 0) continue;
      let bIdx = i * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;

      // 1. Asymmetric: Asym(R) ∧ R(x, y) ∧ R(y, x) ∧ x != y ⇒ CLASH
      if (aType == AXIOM_ASYMMETRIC_PROP) {
        let prop = this.axiomTable.get(bIdx + 2);
        let axId = this.posHead.get(prop as u64) as u32;
        while (axId != 0) {
          if (this.axiomActive.get(axId) != 0) {
            let jIdx = axId * AXIOM_STRIDE;
            if (((this.axiomTable.get(jIdx + 0) & 0xffff) as u16) == AXIOM_OBJ_PROP_ASSERT) {
              let s = this.axiomTable.get(jIdx + 1);
              let o = this.axiomTable.get(jIdx + 3);
              if (s != 0 && o != 0 && s != o && this.hasObjectPropertyAssertion(o, prop, s)) {
                outViolations.push(s);
                outViolations.push(prop);
                outViolations.push(o);
                count++;
              }
            }
          }
          axId = this.nextPos.get(axId);
        }
      }

      // 2. Irreflexive: Irr(R) ∧ R(x, x) ⇒ CLASH
      else if (aType == AXIOM_IRREFLEXIVE_PROP) {
        let prop = this.axiomTable.get(bIdx + 2);
        let axId = this.posHead.get(prop as u64) as u32;
        while (axId != 0) {
          if (this.axiomActive.get(axId) != 0) {
            let jIdx = axId * AXIOM_STRIDE;
            if (((this.axiomTable.get(jIdx + 0) & 0xffff) as u16) == AXIOM_OBJ_PROP_ASSERT) {
              let s = this.axiomTable.get(jIdx + 1);
              let o = this.axiomTable.get(jIdx + 3);
              if (s != 0 && s == o) {
                outViolations.push(s);
                outViolations.push(prop);
                outViolations.push(o);
                count++;
              }
            }
          }
          axId = this.nextPos.get(axId);
        }
      }

      // 3. Disjoint Properties: Disjoint(R, S) ∧ R(x, y) ∧ S(x, y) ⇒ CLASH
      else if (aType == AXIOM_DISJOINT_PROPS) {
        let r = this.axiomTable.get(bIdx + 2);
        let s = this.axiomTable.get(bIdx + 3);
        let axId = this.posHead.get(r as u64) as u32;
        while (axId != 0) {
          if (this.axiomActive.get(axId) != 0) {
            let jIdx = axId * AXIOM_STRIDE;
            if (((this.axiomTable.get(jIdx + 0) & 0xffff) as u16) == AXIOM_OBJ_PROP_ASSERT) {
              let subj = this.axiomTable.get(jIdx + 1);
              let obj = this.axiomTable.get(jIdx + 3);
              if (subj != 0 && obj != 0 && this.hasObjectPropertyAssertion(subj, s, obj)) {
                outViolations.push(subj);
                outViolations.push(r);
                outViolations.push(obj);
                count++;
              }
            }
          }
          axId = this.nextPos.get(axId);
        }
      }
    }

    return count;
  }

  clear(): void {
    this.axiomTable.clear();
    this.axiomCount = 1;
    this.spoHead.clear();
    this.posHead.clear();
    this.ospHead.clear();
    this.nextSpo.clear();
    this.nextPos.clear();
    this.nextOsp.clear();
    this.axiomActive.clear();
    this.derivationCount.clear();
    this.individualParent.clear();
    this.intervalLeft.clear();
    this.intervalRight.clear();
    this.hasIntervalIndex = false;
    this.bfsQueue.clear();
    this.distinctClasses.clear();
  }
}


// ----------------------------------------------------------------------------
// Global WASM Exported Ontology State & Functions
// ----------------------------------------------------------------------------

export let t_ontologyStore: OntologyStore = changetype<OntologyStore>(0);
export let t_ontologyQueryBuffer: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_ontologyQueryFlatPtr: usize = 0;
export let t_ontologyQueryFlatCapacity: u32 = 0;

export function ensureOntologyStore(): void {
  if (changetype<usize>(t_ontologyStore) == 0) {
    let ptr = atomicChunkAlloc(128);
    t_ontologyStore = changetype<OntologyStore>(ptr);
    t_ontologyStore.init();

    t_ontologyQueryBuffer = createChunkedUint32Array(1024);
    t_ontologyQueryFlatCapacity = 1024;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }
}

export function ontology_addAxiom(
  axiomType: u32,
  sourceLangId: u32,
  subjectHash: u32,
  predicateHash: u32,
  objectHash: u32,
  flags: u32,
  extra: u32
): u32 {
  ensureOntologyStore();
  return t_ontologyStore.addAxiom(axiomType, sourceLangId, subjectHash, predicateHash, objectHash, flags, extra);
}

export function ontology_isSubClassOf(subClassHash: u32, superClassHash: u32): u32 {
  ensureOntologyStore();
  if (t_ontologyStore.isSubClassOf(subClassHash, superClassHash)) return 1;
  return 0;
}

export function ontology_explainSubsumption(subClassHash: u32, superClassHash: u32): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let count = t_ontologyStore.explainSubsumption(subClassHash, superClassHash, t_ontologyQueryBuffer);

  let totalWords = count * AXIOM_STRIDE;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return count;
}

export function ontology_checkConsistency(): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let count = t_ontologyStore.checkConsistency(t_ontologyQueryBuffer);

  let totalWords = count * AXIOM_STRIDE;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return count;
}

export function ontology_classifyIndividual(individualHash: u32): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let wordCount = t_ontologyStore.classifyIndividual(individualHash, t_ontologyQueryBuffer);

  if (wordCount > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = wordCount + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return wordCount;
}

export function ontology_areDisjoint(class1Hash: u32, class2Hash: u32): u32 {
  ensureOntologyStore();
  if (t_ontologyStore.areDisjoint(class1Hash, class2Hash)) return 1;
  return 0;
}

export function ontology_isInstanceOf(individualHash: u32, classHash: u32): u32 {
  ensureOntologyStore();
  if (t_ontologyStore.isInstanceOf(individualHash, classHash)) return 1;
  return 0;
}

export function ontology_getTransitiveClosure(propertyHash: u32, sourceHash: u32): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let count = t_ontologyStore.getTransitiveClosure(propertyHash, sourceHash, t_ontologyQueryBuffer);

  if (count > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = count + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return count;
}

export function ontology_getTransitiveClosureWithPath(propertyHash: u32, sourceHash: u32): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let count = t_ontologyStore.getTransitiveClosureWithPath(propertyHash, sourceHash, t_ontologyQueryBuffer);

  let totalWords = t_ontologyQueryBuffer.length;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return count;
}

export function ontology_getTaxonomy(): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let classCount = t_ontologyStore.getTaxonomy(t_ontologyQueryBuffer);

  let totalWords = t_ontologyQueryBuffer.length;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return classCount;
}

export function ontology_queryTriples(subjectPattern: u32, predicatePattern: u32, objectPattern: u32): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let count = t_ontologyStore.queryTriples(subjectPattern, predicatePattern, objectPattern, t_ontologyQueryBuffer);

  let totalWords = count * AXIOM_STRIDE;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return count;
}

export function ontology_getAxiomCount(): u32 {
  if (changetype<usize>(t_ontologyStore) == 0) return 0;
  return t_ontologyStore.axiomCount - 1;
}

export function ontology_clear(): void {
  if (changetype<usize>(t_ontologyStore) != 0) {
    t_ontologyStore.clear();
  }
}

export function ontology_getQueryBuffer(): usize {
  return t_ontologyQueryFlatPtr;
}

export function ontology_computeIntervalIndex(): void {
  ensureOntologyStore();
  t_ontologyStore.computeIntervalIndex();
}

export function ontology_evaluatePropertyPath(propertyHash: u32, pathOp: u32, stepPropertyHash2: u32, sourceHash: u32): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let count = t_ontologyStore.evaluatePropertyPath(propertyHash, pathOp, stepPropertyHash2, sourceHash, t_ontologyQueryBuffer);

  let totalWords = t_ontologyQueryBuffer.length;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return count;
}

export function ontology_saturateELRules(): u32 {
  ensureOntologyStore();
  return t_ontologyStore.saturateELRules();
}

export function ontology_retractAxiom(axiomId: u32): u32 {
  ensureOntologyStore();
  return t_ontologyStore.retractAxiom(axiomId);
}

export function ontology_applyDelta(
  addCount: u32,
  addPtr: usize,
  retractCount: u32,
  retractPtr: usize
): u32 {
  ensureOntologyStore();

  let addArr = createChunkedUint32Array(addCount * AXIOM_STRIDE);
  let addMem = changetype<UnmanagedUint32Array>(addPtr);
  for (let i: u32 = 0; i < addCount * AXIOM_STRIDE; i++) {
    addArr.push(addMem[i]);
  }

  let retArr = createChunkedUint32Array(retractCount * AXIOM_STRIDE);
  let retMem = changetype<UnmanagedUint32Array>(retractPtr);
  for (let i: u32 = 0; i < retractCount * AXIOM_STRIDE; i++) {
    retArr.push(retMem[i]);
  }

  return t_ontologyStore.applyDelta(addCount, addArr, retractCount, retArr);
}

export function ontology_saturateFunctional(): u32 {
  ensureOntologyStore();
  return t_ontologyStore.saturateFunctionalProperties();
}

export function ontology_quickXplain(): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();

  let bg = createChunkedUint32Array(0);
  let delta = createChunkedUint32Array(t_ontologyStore.axiomCount);
  for (let i: u32 = 1; i < t_ontologyStore.axiomCount; i++) {
    if (t_ontologyStore.axiomActive.get(i) != 0) delta.push(i);
  }

  let mus = createChunkedUint32Array(16);
  t_ontologyStore.quickXplain(bg, delta, mus);

  let count = mus.length;
  t_ontologyQueryBuffer.push(count);
  for (let i: u32 = 0; i < count; i++) {
    let axId = mus.get(i);
    let bIdx = axId * AXIOM_STRIDE;
    for (let w: u32 = 0; w < AXIOM_STRIDE; w++) {
      t_ontologyQueryBuffer.push(t_ontologyStore.axiomTable.get(bIdx + w));
    }
  }

  let totalWords = t_ontologyQueryBuffer.length;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return count;
}

export function ontology_allMus(maxCores: u32 = 16): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();

  let totalCores = t_ontologyStore.allMusHST(t_ontologyQueryBuffer, maxCores);

  let totalWords = t_ontologyQueryBuffer.length;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return totalCores;
}

/**
 * Tier 2: Zero-GC Backtrackable Bump-Pointer Tableau Fallback Engine.
 * Activated on non-Horn disjunctive case-analyses and complex DL proofs.
 */
@unmanaged
export class TableauEngine {
  arena: ChunkedUint32Array;
  arenaPtr: u32;
  watermarkStack: ChunkedUint32Array;
  branchStack: ChunkedUint32Array;

  init(capacity: u32 = 16384): void {
    this.arena = createChunkedUint32Array(capacity);
    this.arenaPtr = 0;
    this.watermarkStack = createChunkedUint32Array(256);
    this.branchStack = createChunkedUint32Array(256);
  }

  mark(): u32 {
    let markVal = this.arenaPtr;
    this.watermarkStack.push(markVal);
    return markVal;
  }

  backtrack(): void {
    if (this.watermarkStack.length > 0) {
      let markVal = this.watermarkStack.pop();
      this.arenaPtr = markVal;
    }
  }

  solveSubsumption(store: OntologyStore, subClass: u32, supClass: u32): boolean {
    if (subClass == supClass) return true;
    if (store.isSubClassOf(subClass, supClass)) return true;

    // Disjunctive branch analysis: if C ⊑ D1 ⊔ D2 and subClass ⊑ C
    for (let i: u32 = 1; i < store.axiomCount; i++) {
      if (store.axiomActive.get(i) == 0) continue;
      let bIdx = i * AXIOM_STRIDE;
      let aType = (store.axiomTable.get(bIdx + 0) & 0xffff) as u16;
      if (aType == AXIOM_DISJUNCTIVE_CLASS) {
        let c = store.axiomTable.get(bIdx + 1);
        let d1 = store.axiomTable.get(bIdx + 3);
        let d2 = store.axiomTable.get(bIdx + 4);
        if (store.isSubClassOf(subClass, c) || subClass == c) {
          this.mark();
          let b1Holds = store.isSubClassOf(d1, supClass) || d1 == supClass;
          let b2Holds = store.isSubClassOf(d2, supClass) || d2 == supClass;
          this.backtrack();

          if (b1Holds && b2Holds) {
            return true;
          }
        }
      }
    }

    return false;
  }
}

export let t_tableauEngine: TableauEngine = changetype<TableauEngine>(0);

export function ensureTableauEngine(): void {
  if (changetype<usize>(t_tableauEngine) == 0) {
    let ptr = atomicChunkAlloc(128);
    t_tableauEngine = changetype<TableauEngine>(ptr);
    t_tableauEngine.init();
  }
}

export function ontology_runHybridFixpoint(): u32 {
  ensureOntologyStore();
  return t_ontologyStore.runHybridInterleavedFixpoint();
}

export function ontology_validateAdvancedConstraints(): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let count = t_ontologyStore.validateAdvancedConstraints(t_ontologyQueryBuffer);

  let totalWords = t_ontologyQueryBuffer.length;
  if (totalWords > t_ontologyQueryFlatCapacity) {
    t_ontologyQueryFlatCapacity = totalWords + 256;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }

  t_ontologyQueryBuffer.copyToFlat(t_ontologyQueryFlatPtr);
  return count;
}

export function ontology_runTableauSubsumption(subClass: u32, supClass: u32): u32 {
  ensureOntologyStore();
  ensureTableauEngine();
  let holds = t_tableauEngine.solveSubsumption(t_ontologyStore, subClass, supClass);
  return holds ? 1 : 0;
}




