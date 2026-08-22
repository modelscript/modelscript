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
export const AXIOM_OBJECT_SOME_VALUES_FROM: u16 = 12; // C ⊑ ∃R.D
export const AXIOM_SUB_PROPERTY_CHAIN: u16 = 13;      // R ∘ S ⊑ T

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

  // O(1) Interval/Topological DAG Indexing
  intervalLeft: UnmanagedMap64;  // maps classHash -> left interval
  intervalRight: UnmanagedMap64; // maps classHash -> right interval
  hasIntervalIndex: boolean;

  init(initialCapacity: u32 = 1024): void {
    this.axiomTable = createChunkedUint32Array(initialCapacity * AXIOM_STRIDE);
    this.axiomCount = 1; // 1-indexed (0 reserved for null)

    this.spoHead = changetype<UnmanagedMap64>(createMap64());
    this.posHead = changetype<UnmanagedMap64>(createMap64());
    this.ospHead = changetype<UnmanagedMap64>(createMap64());

    this.nextSpo = createChunkedUint32Array(initialCapacity);
    this.nextPos = createChunkedUint32Array(initialCapacity);
    this.nextOsp = createChunkedUint32Array(initialCapacity);

    this.intervalLeft = changetype<UnmanagedMap64>(createMap64());
    this.intervalRight = changetype<UnmanagedMap64>(createMap64());
    this.hasIntervalIndex = false;
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
      let baseIdx = i * AXIOM_STRIDE;
      let typeAndLang = this.axiomTable.get(baseIdx + 0);
      let axiomType = (typeAndLang & 0xffff) as u16;

      if (axiomType == AXIOM_DISJOINT_CLASSES) {
        let class1 = this.axiomTable.get(baseIdx + 1); // subjectHash
        let class2 = this.axiomTable.get(baseIdx + 3); // objectHash

        if (class1 != 0 && class2 != 0) {
          // 1. Check if any class is a subclass of both disjoint classes
          for (let c: u32 = 1; c < this.axiomCount; c++) {
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
    this.intervalLeft.init();
    this.intervalRight.init();

    // 1. Collect all distinct classes
    let classes = createChunkedUint32Array(64);
    for (let i: u32 = 1; i < this.axiomCount; i++) {
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

    // 2. Identify root classes (classes with no outgoing superclasses)
    let isChild = createChunkedUint32Array(classes.length);
    for (let i: u32 = 0; i < classes.length; i++) isChild.push(0);

    for (let i: u32 = 0; i < classes.length; i++) {
      let c = classes.get(i);
      let axiomId = this.spoHead.get(c as u64) as u32;
      while (axiomId != 0) {
        let baseIdx = axiomId * AXIOM_STRIDE;
        let typeAndLang = this.axiomTable.get(baseIdx + 0);
        let axiomType = (typeAndLang & 0xffff) as u16;
        if (axiomType == AXIOM_SUBCLASS_OF) {
          let sup = this.axiomTable.get(baseIdx + 3);
          if (sup != 0 && sup != c) {
            isChild.set(i, 1);
            break;
          }
        }
        axiomId = this.nextSpo.get(axiomId);
      }
    }

    // 3. DFS to assign pre-order left and post-order right intervals [L, R]
    let counter: u32 = 1;

    for (let r: u32 = 0; r < classes.length; r++) {
      if (isChild.get(r) == 0) {
        let rootHash = classes.get(r);
        counter = this.dfsIntervalAssign(rootHash, counter);
      }
    }

    // Handle any unvisited classes (e.g. cycles)
    for (let r: u32 = 0; r < classes.length; r++) {
      let ch = classes.get(r);
      if (!this.intervalLeft.has(ch as u64)) {
        counter = this.dfsIntervalAssign(ch, counter);
      }
    }

    this.hasIntervalIndex = true;
  }

  dfsIntervalAssign(classHash: u32, currentCounter: u32): u32 {
    if (this.intervalLeft.has(classHash as u64)) return currentCounter;

    let left = currentCounter++;
    this.intervalLeft.set(classHash as u64, left as u32);

    // Traverse direct subclasses (incoming SubClassOf edges via OSP)
    let axiomId = this.ospHead.get(classHash as u64) as u32;
    while (axiomId != 0) {
      let baseIdx = axiomId * AXIOM_STRIDE;
      let typeAndLang = this.axiomTable.get(baseIdx + 0);
      let axiomType = (typeAndLang & 0xffff) as u16;

      if (axiomType == AXIOM_SUBCLASS_OF || axiomType == AXIOM_EQUIV_CLASS) {
        let subHash = this.axiomTable.get(baseIdx + 1);
        if (subHash != 0 && subHash != classHash && !this.intervalLeft.has(subHash as u64)) {
          currentCounter = this.dfsIntervalAssign(subHash, currentCounter);
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
        let bIdx1 = i * AXIOM_STRIDE;
        let tLang1 = this.axiomTable.get(bIdx1 + 0);
        let aType1 = (tLang1 & 0xffff) as u16;

        if (aType1 == AXIOM_SUBCLASS_OF) {
          let c = this.axiomTable.get(bIdx1 + 1);
          let d = this.axiomTable.get(bIdx1 + 3);

          if (c != 0 && d != 0 && c != d) {
            let axId2 = this.spoHead.get(d as u64) as u32;
            while (axId2 != 0) {
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
            let bIdx2 = j * AXIOM_STRIDE;
            let aType2 = (this.axiomTable.get(bIdx2 + 0) & 0xffff) as u16;
            if (aType2 == AXIOM_OBJECT_SOME_VALUES_FROM) {
              let c = this.axiomTable.get(bIdx2 + 1);
              let rCand = this.axiomTable.get(bIdx2 + 2);
              let d = this.axiomTable.get(bIdx2 + 3);

              if (rCand == r) {
                let axId3 = this.spoHead.get(d as u64) as u32;
                while (axId3 != 0) {
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
      let bIdx = axId * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
      let tgt = this.axiomTable.get(bIdx + 3);
      if (aType == AXIOM_SUBCLASS_OF && tgt == sup) return true;
      axId = this.nextSpo.get(axId);
    }
    return false;
  }

  hasExistential(c: u32, r: u32, d: u32): boolean {
    let axId = this.spoHead.get(c as u64) as u32;
    while (axId != 0) {
      let bIdx = axId * AXIOM_STRIDE;
      let aType = (this.axiomTable.get(bIdx + 0) & 0xffff) as u16;
      let rAx = this.axiomTable.get(bIdx + 2);
      let dAx = this.axiomTable.get(bIdx + 3);
      if (aType == AXIOM_OBJECT_SOME_VALUES_FROM && rAx == r && dAx == d) return true;
      axId = this.nextSpo.get(axId);
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
    this.intervalLeft.init();
    this.intervalRight.init();
    this.hasIntervalIndex = false;
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
  flags: u32
): u32 {
  ensureOntologyStore();
  return t_ontologyStore.addAxiom(axiomType, sourceLangId, subjectHash, predicateHash, objectHash, flags);
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



