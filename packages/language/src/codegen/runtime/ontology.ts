/* eslint-disable */
// @ts-nocheck
import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
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

  init(initialCapacity: u32 = 1024): void {
    this.axiomTable = createChunkedUint32Array(initialCapacity * AXIOM_STRIDE);
    this.axiomCount = 1; // 1-indexed (0 reserved for null)

    this.spoHead = changetype<UnmanagedMap64>(createMap64());
    this.posHead = changetype<UnmanagedMap64>(createMap64());
    this.ospHead = changetype<UnmanagedMap64>(createMap64());

    this.nextSpo = createChunkedUint32Array(initialCapacity);
    this.nextPos = createChunkedUint32Array(initialCapacity);
    this.nextOsp = createChunkedUint32Array(initialCapacity);
  }

  /**
   * Adds an OWL 2 axiom into the indexed knowledge store.
   * Updates SPO, POS, and OSP index chains for fast relational queries.
   */
  addAxiom(axiomType: u16, sourceLangId: u16, subjectHash: u32, predicateHash: u32, objectHash: u32, flags: u32 = 0): u32 {
    let id = this.axiomCount++;
    let baseIdx = id * AXIOM_STRIDE;

    let typeAndLang = (axiomType as u32) | ((sourceLangId as u32) << 16);
    this.axiomTable.set(baseIdx + 0, typeAndLang);
    this.axiomTable.set(baseIdx + 1, subjectHash);
    this.axiomTable.set(baseIdx + 2, predicateHash);
    this.axiomTable.set(baseIdx + 3, objectHash);
    this.axiomTable.set(baseIdx + 4, flags);
    this.axiomTable.set(baseIdx + 5, 0);

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

    return id;
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
   * Evaluates if subClass is a direct or indirect subclass of superClass.
   * Supports symmetric EquivalentClasses (AXIOM_EQUIV_CLASS) navigation.
   */
  isSubClassOf(subClassHash: u32, superClassHash: u32): boolean {
    if (subClassHash == 0 || superClassHash == 0) return false;
    if (subClassHash == superClassHash) return true;

    // Unmanaged ChunkedUint32Array for zero-GC BFS traversal without arbitrary depth limit
    let queue = createChunkedUint32Array(64);
    let head: u32 = 0;
    queue.push(subClassHash);

    while (head < queue.length) {
      let current = queue.get(head++);
      if (current == superClassHash) return true;

      // 1. Traverse outgoing SubClassOf and EquivalentClasses via SPO
      let axiomId = this.spoHead.get(current as u64) as u32;
      while (axiomId != 0) {
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
        axiomId = this.nextSpo.get(axiomId);
      }

      // 2. Traverse incoming EquivalentClasses via OSP (Equivalence is symmetric)
      let ospAxiomId = this.ospHead.get(current as u64) as u32;
      while (ospAxiomId != 0) {
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

  clear(): void {
    this.axiomTable.clear();
    this.axiomCount = 1;
    this.spoHead.init();
    this.posHead.init();
    this.ospHead.init();
    this.nextSpo.clear();
    this.nextPos.clear();
    this.nextOsp.clear();
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
    let ptr = atomicChunkAlloc(sizeof<OntologyStore>());
    t_ontologyStore = changetype<OntologyStore>(ptr);
    t_ontologyStore.init();

    t_ontologyQueryBuffer = createChunkedUint32Array(1024);
    t_ontologyQueryFlatCapacity = 1024;
    t_ontologyQueryFlatPtr = atomicChunkAlloc(t_ontologyQueryFlatCapacity * sizeof<u32>());
  }
}

export function ontology_addAxiom(
  axiomType: u16,
  sourceLangId: u16,
  subjectHash: u32,
  predicateHash: u32,
  objectHash: u32,
  flags: u32,
): u32 {
  ensureOntologyStore();
  return t_ontologyStore.addAxiom(axiomType, sourceLangId, subjectHash, predicateHash, objectHash, flags);
}

export function ontology_isSubClassOf(subClassHash: u32, superClassHash: u32): u32 {
  ensureOntologyStore();
  return t_ontologyStore.isSubClassOf(subClassHash, superClassHash) ? 1 : 0;
}

export function ontology_areDisjoint(class1Hash: u32, class2Hash: u32): u32 {
  ensureOntologyStore();
  return t_ontologyStore.areDisjoint(class1Hash, class2Hash) ? 1 : 0;
}

export function ontology_isInstanceOf(individualHash: u32, classHash: u32): u32 {
  ensureOntologyStore();
  return t_ontologyStore.isInstanceOf(individualHash, classHash) ? 1 : 0;
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

