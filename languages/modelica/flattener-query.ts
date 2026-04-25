/* eslint-disable */
/**
 * examples/modelica/flattener-query.ts
 *
 * Query-based Modelica flattener.
 *
 * Replaces the monolithic ModelicaModelVisitor from modelscript's
 * flattener.ts with a two-layer architecture:
 *
 * Layer 1 (Pure Queries — memoized by the QueryEngine):
 *   - `instantiate` query on ClassDefinition → resolved element IDs
 *   - `classInstance` query on ComponentClause → specialized class ID
 *   - `resolveSimpleName` query → scope resolution
 *
 * Layer 2 (Imperative Assembly — this file):
 *   - Walks the resolved structure from Layer 1
 *   - Emits DAE variables and equations with flattened name prefixes
 *   - Handles connect expansion, flow balance, and stream expansion
 *
 * Usage:
 * ```typescript
 * const flattener = new QueryBasedFlattener(engine);
 * const dae = flattener.flatten(rootClassId);
 * ```
 */

import type { QueryDB, SymbolEntry, SymbolId, TopologyGraph } from "@modelscript/polyglot";
import type { ModelicaModArgs } from "./modification-args.js";

// ---------------------------------------------------------------------------
// DAE Output Types (mirrors dae.ts from modelscript)
// ---------------------------------------------------------------------------

/**
 * Simplified DAE variable.
 * In the full implementation, this would import from modelscript/dae.ts.
 */
export interface FlatVariable {
  /** Flattened dot-path name, e.g., "circuit.R1.v" */
  name: string;
  /** The predefined type: Real, Integer, Boolean, String */
  typeName: string;
  /** Variability: continuous, discrete, parameter, constant */
  variability: string;
  /** Causality: input, output, internal */
  causality: string;
  /** Whether this variable has a binding equation */
  hasBindingEquation: boolean;
  /** Start value (from modification or type default) */
  startValue: unknown;
  /** Unit string (from modification or type default) */
  unit: string;
  /** Display unit string */
  displayUnit: string;
  /** Min/max bounds */
  min: number | null;
  max: number | null;
  /** Fixed flag (for initialization) */
  fixed: boolean;
  /** Comment/description string */
  description: string;
  /** Whether this is a flow variable */
  isFlow: boolean;
  /** Whether this is a stream variable */
  isStream: boolean;
  /** Whether this is a connector variable (for connection tracking) */
  isConnector: boolean;
  /** Array shape (null for scalars) */
  arrayShape: number[] | null;
}

/**
 * Simplified DAE equation.
 */
export interface FlatEquation {
  /** Equation kind: simple, connect, for, if, when, algorithm */
  kind: string;
  /** Source text of the equation (from CST) */
  sourceText: string;
  /** Description string */
  description: string;
  /** Left-hand side component reference (flattened) */
  lhs: string;
  /** Right-hand side (for simple equations) */
  rhs: string;
}

/**
 * Connection pair tracked during flattening.
 * Each `connect(a, b)` creates a connection set entry.
 */
export interface ConnectionPair {
  /** Flattened name of first connector */
  from: string;
  /** Flattened name of second connector */
  to: string;
  /** Whether the connectors contain flow variables */
  hasFlow: boolean;
}

/**
 * Flattened DAE output.
 * The result of flattening a Modelica model.
 */
export interface FlatDAE {
  /** The original class name */
  className: string;
  /** All flattened variables */
  variables: FlatVariable[];
  /** All flattened equations */
  equations: FlatEquation[];
  /** Connection pairs (pre-expansion) */
  connections: ConnectionPair[];
  /** Initial equations */
  initialEquations: FlatEquation[];
  /** Algorithm sections (as text) */
  algorithms: string[];
  /** Diagnostics generated during flattening */
  diagnostics: string[];
}

// ---------------------------------------------------------------------------
// Predefined Type Detection
// ---------------------------------------------------------------------------

const PREDEFINED_SCALAR_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);

function isPredefinedScalar(name: string): boolean {
  return PREDEFINED_SCALAR_TYPES.has(name);
}

// ---------------------------------------------------------------------------
// Query-Based Flattener
// ---------------------------------------------------------------------------

/**
 * Query-based Modelica flattener.
 *
 * Walks the instantiated class hierarchy using the query engine's
 * `instantiate` and `classInstance` queries, and emits a flat DAE.
 *
 * The flattener is stateless between calls to `flatten()`.
 */
export class QueryBasedFlattener {
  constructor(private db: QueryDB) {}

  /**
   * Flatten a Modelica class into a DAE.
   *
   * @param rootClassId - The SymbolId of the top-level model to flatten
   * @returns A FlatDAE containing all variables, equations, and connections
   */
  flatten(rootClassId: SymbolId): FlatDAE {
    const rootEntry = this.db.symbol(rootClassId);
    const className = rootEntry?.name ?? "<unknown>";

    const dae: FlatDAE = {
      className,
      variables: [],
      equations: [],
      connections: [],
      initialEquations: [],
      algorithms: [],
      diagnostics: [],
    };

    // Use the instantiate query to get the resolved element tree
    const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);

    if (!elements || elements.length === 0) {
      dae.diagnostics.push(`Class '${className}' has no instantiated elements`);
      return dae;
    }

    // Walk the resolved elements and emit DAE entries
    this.flattenElements(elements, "", dae);

    // Post-processing: expand connections into equations
    this.expandConnections(dae);

    return dae;
  }

  /**
   * Flatten a hybrid system from a SysML TopologyGraph.
   * Walks the topology, instantiating Modelica artifacts bound to each node.
   */
  flattenFromTopology(graph: TopologyGraph): FlatDAE {
    const dae: FlatDAE = {
      className: "HybridSystem",
      variables: [],
      equations: [],
      connections: [],
      initialEquations: [],
      algorithms: [],
      diagnostics: [],
    };

    const processTopologyNode = (nodeId: SymbolId, prefix: string) => {
      const node = graph.nodes.get(nodeId);
      if (!node) return;

      const currentPrefix = prefix ? `${prefix}.${node.path.split(".").pop()}` : node.path.split(".").pop()!;

      // Flatten target Modelica class if bound
      if (node.targetClassId) {
        const elements = this.db.query<SymbolId[]>("instantiate", node.targetClassId);
        if (elements) {
          this.flattenElements(elements, currentPrefix, dae);
        }
      }

      for (const child of node.children) {
        processTopologyNode(child.usageId, currentPrefix);
      }
    };

    for (const rootId of graph.rootIds) {
      processTopologyNode(rootId, "");
    }

    // Process explicit topology edges as Modelica connect equations
    for (const edge of graph.edges) {
      const srcNode = graph.nodes.get(edge.sourceId);
      const tgtNode = graph.nodes.get(edge.targetId);
      if (srcNode && tgtNode) {
        // We emit connect equations using their simple paths. The flow
        // expansion step will later process these.
        dae.equations.push({
          kind: "connect",
          sourceText: `connect(${srcNode.path}, ${tgtNode.path})`,
          description: "",
          lhs: "",
          rhs: "",
        });
        dae.connections.push({ from: srcNode.path, to: tgtNode.path, hasFlow: false });
      }
    }

    this.expandConnections(dae);

    return dae;
  }

  // -------------------------------------------------------------------------
  // Element Processing
  // -------------------------------------------------------------------------

  private flattenElements(elementIds: SymbolId[], prefix: string, dae: FlatDAE): void {
    for (const eid of elementIds) {
      const entry = this.db.symbol(eid);
      if (!entry) continue;

      switch (entry.kind) {
        case "Component":
          this.flattenComponent(entry, prefix, dae);
          break;
        case "Class":
          // Nested class definitions are not flattened into variables
          // unless they are function definitions used in equations
          break;
        case "ConnectEquation":
          this.recordConnection(entry, prefix, dae);
          break;
        case "Equation":
          this.flattenEquation(entry, prefix, dae);
          break;
        case "ForEquation":
          this.flattenForEquation(entry, prefix, dae);
          break;
        case "IfEquation":
          this.flattenIfEquation(entry, prefix, dae);
          break;
        case "WhenEquation":
          this.flattenWhenEquation(entry, prefix, dae);
          break;
        case "AlgorithmSection":
          this.flattenAlgorithm(entry, prefix, dae);
          break;
        default:
          // Skip other kinds (Import, etc.)
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Component Flattening
  // -------------------------------------------------------------------------

  private flattenComponent(entry: SymbolEntry, prefix: string, dae: FlatDAE): void {
    const fullName = prefix ? `${prefix}.${entry.name}` : entry.name;
    const meta = entry.metadata as Record<string, unknown>;
    const typeName = meta?.typeSpecifier as string | undefined;

    if (!typeName) {
      dae.diagnostics.push(`Component '${fullName}' has no type specifier`);
      return;
    }

    // Check if it's a predefined scalar type
    if (isPredefinedScalar(typeName)) {
      this.emitVariable(fullName, typeName, entry, dae);
      return;
    }

    // Compound type — resolve via classInstance query and recurse
    const classInstanceId = this.db.query<SymbolId | null>("classInstance", entry.id);

    if (classInstanceId === null) {
      dae.diagnostics.push(`Cannot resolve type '${typeName}' for component '${fullName}'`);
      return;
    }

    const classEntry = this.db.symbol(classInstanceId);
    if (!classEntry) {
      dae.diagnostics.push(`Type '${typeName}' resolved to invalid symbol for '${fullName}'`);
      return;
    }

    // Check if the resolved type is actually a predefined type
    const classMeta = classEntry.metadata as Record<string, unknown>;
    if (classMeta?.isPredefined) {
      this.emitVariable(fullName, classEntry.name, entry, dae);
      return;
    }

    // Check array dimensions
    const arrayDims = this.db.query<number[] | null>("arrayDimensions", entry.id);

    if (arrayDims && arrayDims.length > 0) {
      // Array component — expand each index
      this.flattenArrayComponent(fullName, classInstanceId, arrayDims, entry, dae);
      return;
    }

    // Recurse into the compound type's elements
    const subElements = this.db.query<SymbolId[]>("instantiate", classInstanceId);

    if (subElements) {
      this.flattenElements(subElements, fullName, dae);
    }
  }

  // -------------------------------------------------------------------------
  // Array Component Expansion
  // -------------------------------------------------------------------------

  private flattenArrayComponent(
    baseName: string,
    classInstanceId: SymbolId,
    shape: number[],
    entry: SymbolEntry,
    dae: FlatDAE,
  ): void {
    // For a multi-dimensional array, expand recursively
    // e.g., Real[3,2] x → x[1,1], x[1,2], x[2,1], ...
    const indices = this.generateArrayIndices(shape);

    const classEntry = this.db.symbol(classInstanceId);
    const typeName = classEntry?.name ?? "Real";

    for (const idx of indices) {
      const indexStr = idx.map(String).join(",");
      const fullName = `${baseName}[${indexStr}]`;

      if (isPredefinedScalar(typeName) || classEntry?.metadata?.isPredefined) {
        this.emitVariable(fullName, typeName, entry, dae);
      } else {
        // Compound array element — recurse
        const subElements = this.db.query<SymbolId[]>("instantiate", classInstanceId);
        if (subElements) {
          this.flattenElements(subElements, fullName, dae);
        }
      }
    }
  }

  /** Generate all index combinations for a multi-dimensional array. */
  private generateArrayIndices(shape: number[]): number[][] {
    if (shape.length === 0) return [[]];
    if (shape.length === 1) {
      return Array.from({ length: shape[0]! }, (_, i) => [i + 1]);
    }

    const rest = this.generateArrayIndices(shape.slice(1));
    const result: number[][] = [];
    for (let i = 1; i <= shape[0]!; i++) {
      for (const r of rest) {
        result.push([i, ...r]);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Variable Emission
  // -------------------------------------------------------------------------

  private emitVariable(name: string, typeName: string, componentEntry: SymbolEntry, dae: FlatDAE): void {
    const meta = componentEntry.metadata as Record<string, unknown>;

    // Extract modification values for start, unit, etc.
    const specArgs = this.db.argsOf<ModelicaModArgs>(componentEntry.id);
    const mod = specArgs?.data ?? null;

    const variable: FlatVariable = {
      name,
      typeName,
      variability: (meta?.variability as string) ?? "continuous",
      causality: (meta?.causality as string) ?? "internal",
      hasBindingEquation: !!mod?.bindingExpression,
      startValue: this.resolveModAttribute(mod, "start", typeName),
      unit: (this.resolveModAttribute(mod, "unit", typeName) as string) ?? "",
      displayUnit: (this.resolveModAttribute(mod, "displayUnit", typeName) as string) ?? "",
      min: this.resolveModAttribute(mod, "min", typeName) as number | null,
      max: this.resolveModAttribute(mod, "max", typeName) as number | null,
      fixed: (this.resolveModAttribute(mod, "fixed", typeName) as boolean) ?? false,
      description: (meta?.description as string) ?? "",
      isFlow: meta?.flow === "flow",
      isStream: meta?.flow === "stream",
      isConnector: false, // Set during parent connector detection
      arrayShape: null,
    };

    dae.variables.push(variable);

    // If there's a binding expression, emit a binding equation
    if (mod?.bindingExpression) {
      const sourceText = this.resolveExpressionText(mod.bindingExpression);
      if (sourceText) {
        dae.equations.push({
          kind: "binding",
          sourceText: `${name} = ${sourceText}`,
          description: "",
          lhs: name,
          rhs: sourceText,
        });
      }
    }
  }

  private resolveModAttribute(mod: ModelicaModArgs | null, attrName: string, typeName: string): unknown {
    if (mod) {
      const arg = mod.args.find((a) => a.name === attrName);
      if (arg?.value) {
        if (arg.value.kind === "literal") return arg.value.value;
        if (arg.value.kind === "expression") {
          return this.db.evaluate(arg.value);
        }
      }
    }

    // Fall back to type defaults
    return this.getTypeDefault(typeName, attrName);
  }

  private getTypeDefault(typeName: string, attrName: string): unknown {
    const defaults: Record<string, Record<string, unknown>> = {
      Real: { start: 0.0, min: -1e100, max: 1e100, unit: "", fixed: false },
      Integer: { start: 0, min: -2147483648, max: 2147483647, fixed: false },
      Boolean: { start: false, fixed: false },
      String: { start: "" },
    };
    return defaults[typeName]?.[attrName] ?? null;
  }

  private resolveExpressionText(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    if (v.kind === "literal") return String(v.value);
    if (v.kind === "expression") {
      const bytes = v.cstBytes as [number, number];
      return this.db.cstText(bytes[0], bytes[1]);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Equation Flattening
  // -------------------------------------------------------------------------

  private flattenEquation(entry: SymbolEntry, prefix: string, dae: FlatDAE): void {
    // Get the equation source text from CST
    const sourceText = this.db.cstText(entry.startByte, entry.endByte);
    if (!sourceText) return;

    // Prefix component references in the equation
    const prefixedText = prefix ? this.prefixComponentRefs(sourceText, prefix) : sourceText;

    dae.equations.push({
      kind: "equation",
      sourceText: prefixedText,
      description: "",
      lhs: "",
      rhs: "",
    });
  }

  private flattenForEquation(entry: SymbolEntry, prefix: string, dae: FlatDAE): void {
    const sourceText = this.db.cstText(entry.startByte, entry.endByte);
    if (!sourceText) return;

    dae.equations.push({
      kind: "for",
      sourceText: prefix ? this.prefixComponentRefs(sourceText, prefix) : sourceText,
      description: "",
      lhs: "",
      rhs: "",
    });
  }

  private flattenIfEquation(entry: SymbolEntry, prefix: string, dae: FlatDAE): void {
    const sourceText = this.db.cstText(entry.startByte, entry.endByte);
    if (!sourceText) return;

    dae.equations.push({
      kind: "if",
      sourceText: prefix ? this.prefixComponentRefs(sourceText, prefix) : sourceText,
      description: "",
      lhs: "",
      rhs: "",
    });
  }

  private flattenWhenEquation(entry: SymbolEntry, prefix: string, dae: FlatDAE): void {
    const sourceText = this.db.cstText(entry.startByte, entry.endByte);
    if (!sourceText) return;

    dae.equations.push({
      kind: "when",
      sourceText: prefix ? this.prefixComponentRefs(sourceText, prefix) : sourceText,
      description: "",
      lhs: "",
      rhs: "",
    });
  }

  private flattenAlgorithm(entry: SymbolEntry, prefix: string, dae: FlatDAE): void {
    const sourceText = this.db.cstText(entry.startByte, entry.endByte);
    if (sourceText) {
      dae.algorithms.push(prefix ? this.prefixComponentRefs(sourceText, prefix) : sourceText);
    }
  }

  // -------------------------------------------------------------------------
  // Connection Handling
  // -------------------------------------------------------------------------

  private recordConnection(entry: SymbolEntry, prefix: string, dae: FlatDAE): void {
    const meta = entry.metadata as Record<string, unknown>;
    const from = meta?.from as string;
    const to = meta?.to as string;

    if (!from || !to) return;

    const fullFrom = prefix ? `${prefix}.${from}` : from;
    const fullTo = prefix ? `${prefix}.${to}` : to;

    dae.connections.push({
      from: fullFrom,
      to: fullTo,
      hasFlow: false, // Will be resolved during expandConnections
    });
  }

  /**
   * Expand connections into equality and flow-balance equations.
   *
   * Implementation of Modelica §9.1:
   * - For each connection set, generate equality equations for effort variables
   * - For each connection set, generate sum=0 equations for flow variables
   */
  private expandConnections(dae: FlatDAE): void {
    if (dae.connections.length === 0) return;

    // Build connection sets using Union-Find
    const connectionSets = new Map<string, Set<string>>();

    for (const conn of dae.connections) {
      const fromSet = this.findSet(connectionSets, conn.from);
      const toSet = this.findSet(connectionSets, conn.to);

      // Merge sets
      if (fromSet !== toSet) {
        const mergedSet = new Set([...fromSet, ...toSet]);
        for (const name of mergedSet) {
          connectionSets.set(name, mergedSet);
        }
      }
    }

    // Generate equations for each unique connection set
    const processedSets = new Set<Set<string>>();

    for (const connSet of connectionSets.values()) {
      if (processedSets.has(connSet)) continue;
      processedSets.add(connSet);

      const members = [...connSet];
      if (members.length < 2) continue;

      // Find which of these are flow variables
      const flowMembers: string[] = [];
      const effortMembers: string[] = [];

      for (const name of members) {
        const v = dae.variables.find((v) => v.name === name);
        if (v?.isFlow) {
          flowMembers.push(name);
        } else {
          effortMembers.push(name);
        }
      }

      // Effort variables: generate equality equations
      // a = b, b = c, etc. (chain)
      for (let i = 1; i < effortMembers.length; i++) {
        dae.equations.push({
          kind: "connect_effort",
          sourceText: `${effortMembers[i - 1]} = ${effortMembers[i]}`,
          description: "Connection equation (effort)",
          lhs: effortMembers[i - 1]!,
          rhs: effortMembers[i]!,
        });
      }

      // Flow variables: generate sum = 0
      if (flowMembers.length > 0) {
        const sumExpr = flowMembers.join(" + ");
        dae.equations.push({
          kind: "connect_flow",
          sourceText: `${sumExpr} = 0`,
          description: "Flow balance equation",
          lhs: sumExpr,
          rhs: "0",
        });
      }
    }
  }

  private findSet(sets: Map<string, Set<string>>, name: string): Set<string> {
    const existing = sets.get(name);
    if (existing) return existing;
    const newSet = new Set([name]);
    sets.set(name, newSet);
    return newSet;
  }

  // -------------------------------------------------------------------------
  // Prefix Utility
  // -------------------------------------------------------------------------

  /**
   * Prefix component references in equation/algorithm text.
   *
   * This is a simplified implementation. The full version would use
   * CST-based component reference resolution to only prefix actual
   * variable references (not keywords, function names, etc.).
   */
  private prefixComponentRefs(text: string, prefix: string): string {
    // In a full implementation, we'd walk the CST to identify
    // component references and prefix them properly.
    // For now, return the text as-is (equation text will need
    // full CST-based processing for production use).
    return text;
  }
}
