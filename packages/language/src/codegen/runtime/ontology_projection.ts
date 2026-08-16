/* eslint-disable */
// @ts-nocheck
import {
  ensureOntologyStore,
  ontology_addAxiom,
  AXIOM_CLASS_DECL,
  AXIOM_SUBCLASS_OF,
  AXIOM_OBJ_PROP_DECL,
  AXIOM_OBJ_PROP_ASSERT,
  AXIOM_STRIDE,
} from "./ontology";
import {
  ensureStubStore,
  t_stubTable,
  t_stubCount,
  t_stubsByFile,
  t_stubNextInFile,
  STUB_STRIDE,
} from "./stub";

/**
 * Projects Tier 1 declaration stubs directly into OWL 2 ontology axioms (Concept 4).
 * Re-projects incrementally based on language slice or file ID.
 */

export function projection_projectFileStubs(fileId: u32, sourceLangId: u16): u32 {
  ensureStubStore();
  ensureOntologyStore();

  let assertedCount: u32 = 0;
  if (fileId == 0 || changetype<usize>(t_stubsByFile) == 0) return 0;

  let stubId = t_stubsByFile.get(fileId as u64);
  while (stubId != 0) {
    let baseIdx = stubId * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);

    if (fId == fileId) {
      let symbolId = t_stubTable.get(baseIdx + 1);
      let parentSymbolId = t_stubTable.get(baseIdx + 2);
      let kf = t_stubTable.get(baseIdx + 3);
      let kind = (kf & 0xffff) as u16;
      let nameHash = t_stubTable.get(baseIdx + 4);

      if (kind == 1) { // Class / Model Declaration
        ontology_addAxiom(AXIOM_CLASS_DECL, sourceLangId, nameHash, 0, 0, 0);
        assertedCount++;

        if (parentSymbolId != 0) {
          let parentBase = parentSymbolId * STUB_STRIDE;
          let parentNameHash = t_stubTable.get(parentBase + 4);
          if (parentNameHash != 0) {
            ontology_addAxiom(AXIOM_SUBCLASS_OF, sourceLangId, nameHash, 0, parentNameHash, 0);
            assertedCount++;
          }
        }
      } else if (kind == 2) { // Component / Field Declaration
        ontology_addAxiom(AXIOM_OBJ_PROP_DECL, sourceLangId, nameHash, 0, 0, 0);
        assertedCount++;

        if (parentSymbolId != 0) {
          let parentBase = parentSymbolId * STUB_STRIDE;
          let parentNameHash = t_stubTable.get(parentBase + 4);
          if (parentNameHash != 0) {
            ontology_addAxiom(AXIOM_OBJ_PROP_ASSERT, sourceLangId, parentNameHash, nameHash, 0, 0);
            assertedCount++;
          }
        }
      }
    }
    stubId = t_stubNextInFile.get(stubId);
  }

  return assertedCount;
}

export function projection_projectAllStubs(sourceLangId: u16): u32 {
  ensureStubStore();
  ensureOntologyStore();

  let assertedCount: u32 = 0;
  let totalStubs = t_stubCount;

  for (let stubId: u32 = 1; stubId < totalStubs; stubId++) {
    let baseIdx = stubId * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);
    if (fId == 0) continue; // Deleted stub

    let symbolId = t_stubTable.get(baseIdx + 1);
    let parentSymbolId = t_stubTable.get(baseIdx + 2);
    let kf = t_stubTable.get(baseIdx + 3);
    let kind = (kf & 0xffff) as u16;
    let nameHash = t_stubTable.get(baseIdx + 4);

    if (kind == 1) { // Class / Model
      ontology_addAxiom(AXIOM_CLASS_DECL, sourceLangId, nameHash, 0, 0, 0);
      assertedCount++;

      if (parentSymbolId != 0) {
        let parentBase = parentSymbolId * STUB_STRIDE;
        let parentNameHash = t_stubTable.get(parentBase + 4);
        if (parentNameHash != 0) {
          ontology_addAxiom(AXIOM_SUBCLASS_OF, sourceLangId, nameHash, 0, parentNameHash, 0);
          assertedCount++;
        }
      }
    } else if (kind == 2) { // Component
      ontology_addAxiom(AXIOM_OBJ_PROP_DECL, sourceLangId, nameHash, 0, 0, 0);
      assertedCount++;
    }
  }

  return assertedCount;
}
