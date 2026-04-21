import { SymbolId } from "./runtime.js";

/**
 * An intermediate representation of a connected diagram of parts,
 * agnostic of whether it came from SysML v2 or Modelica.
 */
export interface TopologyNode {
  /** Symbol ID of the usage (Part, Component) */
  usageId: SymbolId;
  /** Flattened name prefix for DAE (e.g., "sys.engine") */
  path: string;
  /** Resolution target for semantic binding (Modelica class, etc.) */
  targetClassId: SymbolId | null;
  /** Type identifier for the usage */
  typeName: string;
  /** Child nodes instantiated within this node */
  children: TopologyNode[];
  /** Parent node (null if root) */
  parentId: SymbolId | null;
}

export interface TopologyEdge {
  sourceId: SymbolId;
  sourcePort?: string;
  targetId: SymbolId;
  targetPort?: string;
  /** The connection symbol (e.g. SysML allocate, bind, connect) */
  connectionId: SymbolId;
}

export interface TopologyGraph {
  rootIds: SymbolId[];
  nodes: Map<SymbolId, TopologyNode>;
  edges: TopologyEdge[];
  /**
   * Explicit mapping from SysML feature paths (e.g. "circuit.C.v") to
   * simulation variable names (e.g. "C.v") produced during topology extraction.
   * Allows the verifier to resolve constraint operands without guessing
   * how the target simulator flattens hierarchical names.
   */
  variableMap?: Map<string, string>;
}
