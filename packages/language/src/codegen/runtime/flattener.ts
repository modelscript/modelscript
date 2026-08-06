import { DaeBuilder, VarType, Variability, Causality } from "./dae";
import { getNodeFirstChild, getNodeNextSibling, getNodeType } from "./arena";
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
  flattenClass(classNodePtr: u32): u32 {
    let initialVars = this.dae.varCount;

    // Layer 1: Component Instantiation via AST traversal over db.model
    let child = getNodeFirstChild(classNodePtr);
    while (child != 0) {
      let nodeType = getNodeType(child);
      // Register variable declaration in DAE builder
      this.dae.addVariable(child, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      child = getNodeNextSibling(child);
    }

    return this.dae.varCount - initialVars;
  }
}

