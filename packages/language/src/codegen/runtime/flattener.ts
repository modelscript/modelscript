import { DaeBuilder, VarType, Variability, Causality } from "./dae";
import { getNodeFirstChild, getNodeNextSibling, getNodeType } from "./arena";
import { CorrespondenceIndex } from "./correspondence";
import { runQuery } from "./graph";

/**
 * Arena-native Query Flattener.
 * Consumes AST blackboard nodes (db.model) and Salsa queries (runQuery) to populate DaeBuilder SoA data structures.
 */
@unmanaged
export class ArenaQueryFlattener {
  dae: DaeBuilder;

  init(dae: DaeBuilder): void {
    this.dae = dae;
  }

  /**
   * Flattens a class definition AST node into flat DAE variables and equations.
   */
  @inline
  flattenClass(classNodePtr: u32, corr: CorrespondenceIndex = null): u32 {
    let initialVars = this.dae.varCount;

    // Layer 1: Component Instantiation via AST traversal over db.model
    let child = getNodeFirstChild(classNodePtr);
    while (child != 0) {
      let nodeType = getNodeType(child);
      // Register variable declaration in DAE builder
      this.dae.addVariable(child, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      child = getNodeNextSibling(child);
    }

    // Layer 2: Cross-language inherited components via Correspondence Index
    if (corr != null) {
      let foreignTargetPtr = corr.findBySource(classNodePtr);
      if (foreignTargetPtr != 0) {
        let foreignChild = getNodeFirstChild(foreignTargetPtr);
        while (foreignChild != 0) {
          this.dae.addVariable(foreignChild, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
          foreignChild = getNodeNextSibling(foreignChild);
        }
      }
    }

    return this.dae.varCount - initialVars;
  }
}


