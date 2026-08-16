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
   */
  isSubClassOf(subClassHash: u32, superClassHash: u32): boolean {
    if (subClassHash == 0 || superClassHash == 0) return false;
    if (subClassHash == superClassHash) return true;

    // Small fixed-capacity queue for BFS cycle-safe traversal
    let queue = new Array<u32>(64);
    let head: i32 = 0;
    let tail: i32 = 0;
    queue[tail++] = subClassHash;

    while (head < tail && head < 64) {
      let current = queue[head++];
      if (current == superClassHash) return true;

      let axiomId = this.spoHead.get(current as u64) as u32;
      while (axiomId != 0) {
        let baseIdx = axiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;

        if (axiomType == AXIOM_SUBCLASS_OF) {
          let parentHash = this.axiomTable.get(baseIdx + 3); // objectHash is parent
          if (parentHash == superClassHash) return true;
          if (parentHash != 0 && tail < 64) {
            // Avoid duplicate pushes in queue
            let alreadyInQueue = false;
            for (let k: i32 = 0; k < tail; k++) {
              if (queue[k] == parentHash) {
                alreadyInQueue = true;
                break;
              }
            }
            if (!alreadyInQueue) {
              queue[tail++] = parentHash;
            }
          }
        }
        axiomId = this.nextSpo.get(axiomId);
      }
    }

    return false;
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

export function ensureOntologyStore(): void {
  if (changetype<usize>(t_ontologyStore) == 0) {
    let ptr = atomicChunkAlloc(sizeof<OntologyStore>());
    t_ontologyStore = changetype<OntologyStore>(ptr);
    t_ontologyStore.init();

    t_ontologyQueryBuffer = createChunkedUint32Array(1024);
    t_ontologyQueryFlatPtr = atomicChunkAlloc(1024 * 4);
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

export function ontology_queryTriples(subjectPattern: u32, predicatePattern: u32, objectPattern: u32): u32 {
  ensureOntologyStore();
  t_ontologyQueryBuffer.clear();
  let count = t_ontologyStore.queryTriples(subjectPattern, predicatePattern, objectPattern, t_ontologyQueryBuffer);

  let totalWords = count * AXIOM_STRIDE;
  if (t_ontologyQueryFlatPtr == 0) {
    t_ontologyQueryFlatPtr = atomicChunkAlloc(totalWords * 4 + 64);
  }
  for (let i: u32 = 0; i < totalWords; i++) {
    store<u32>(t_ontologyQueryFlatPtr + (i * 4), t_ontologyQueryBuffer.get(i));
  }

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

