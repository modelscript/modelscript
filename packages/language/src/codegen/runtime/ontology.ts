import { ChunkedInt32Array, createChunkedInt32Array } from "./array";

export const TRIPLE_STRIDE = 3;

/**
 * WASM Knowledge Graph & Ontology Store.
 * Encodes OWL 2 triples (subject, predicate, object) in contiguous linear memory over db.model.
 */
@unmanaged
export class OntologyStore {
  tripleData: ChunkedInt32Array;
  tripleCount: u32;

  init(): void {
    this.tripleData = createChunkedInt32Array(1024 * TRIPLE_STRIDE);
    this.tripleCount = 0;
  }

  @inline
  addFact(subject: u32, predicate: u32, object: u32): u32 {
    let idx = this.tripleCount++;
    let offset = idx * TRIPLE_STRIDE;

    this.tripleData.set(offset + 0, subject);
    this.tripleData.set(offset + 1, predicate);
    this.tripleData.set(offset + 2, object);

    return idx;
  }

  /**
   * SPARQL-DL pattern matching over WASM triple store.
   * Wildcards represented as 0xffffffff.
   */
  @inline
  queryTriples(subjectPattern: u32, predicatePattern: u32, objectPattern: u32): u32 {
    let matches: u32 = 0;
    for (let i: u32 = 0; i < this.tripleCount; i++) {
      let offset = i * TRIPLE_STRIDE;
      let s = this.tripleData.get(offset + 0);
      let p = this.tripleData.get(offset + 1);
      let o = this.tripleData.get(offset + 2);

      let sMatch = subjectPattern == 0xffffffff || subjectPattern == s;
      let pMatch = predicatePattern == 0xffffffff || predicatePattern == p;
      let oMatch = objectPattern == 0xffffffff || objectPattern == o;

      if (sMatch && pMatch && oMatch) {
        matches++;
      }
    }
    return matches;
  }
}
