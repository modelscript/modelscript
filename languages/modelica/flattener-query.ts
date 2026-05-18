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

import type { QueryDB, SymbolEntry, SymbolId, TopologyGraph } from "@modelscript/compiler";
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

import {
  Causality,
  DAEArenaBuilder,
  EqKind,
  evaluateArenaExpression,
  ExprKind,
  Variability,
  VarType,
} from "@modelscript/compiler";
import { ArenaExprVisitor } from "./arena-expr-visitor.js";
import { ModelicaSyntaxNode } from "./ast.js";

// We remove FlatDAE and FlatVariable interfaces since we emit directly to DAEArenaBuilder.

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
export class ArenaQueryFlattener {
  constructor(private db: QueryDB) {}

  /**
   * Flatten a Modelica class into a DAE.
   *
   * @param rootClassId - The SymbolId of the top-level model to flatten
   * @returns A FlatDAE containing all variables, equations, and connections
   */
  flatten(rootClassId: SymbolId): DAEArenaBuilder {
    const rootEntry = this.db.symbol(rootClassId);
    const className = rootEntry?.name ?? "<unknown>";

    const dae = new DAEArenaBuilder(undefined, className, "");

    // Use the instantiate query to get the resolved element tree
    const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);

    if (!elements || elements.length === 0) {
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
  flattenFromTopology(graph: TopologyGraph): DAEArenaBuilder {
    const dae = new DAEArenaBuilder(undefined, "HybridSystem", "");

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
        const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(srcNode.path));
        const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(tgtNode.path));
        dae.addEquation(EqKind.Connect, lhsId, rhsId);
      }
    }

    this.expandConnections(dae);

    return dae;
  }

  // -------------------------------------------------------------------------
  // Element Processing
  // -------------------------------------------------------------------------

  private flattenElements(elementIds: SymbolId[], prefix: string, dae: DAEArenaBuilder): void {
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

  private flattenComponent(entry: SymbolEntry, prefix: string, dae: DAEArenaBuilder): void {
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
    dae: DAEArenaBuilder,
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

  private emitVariable(name: string, typeName: string, componentEntry: SymbolEntry, dae: DAEArenaBuilder): void {
    const meta = componentEntry.metadata as Record<string, unknown>;

    // Extract modification values for start, unit, etc.
    const specArgs = this.db.argsOf<ModelicaModArgs>(componentEntry.id);
    const mod = specArgs?.data ?? null;

    let varType = VarType.Real;
    if (typeName === "Integer") varType = VarType.Integer;
    else if (typeName === "Boolean") varType = VarType.Boolean;
    else if (typeName === "String") varType = VarType.String;

    let variability = Variability.Continuous;
    const vStr = this.resolveModAttribute(mod, "variability", typeName, dae) as string;
    if (vStr === "discrete") variability = Variability.Discrete;
    else if (vStr === "parameter") variability = Variability.Parameter;
    else if (vStr === "constant") variability = Variability.Constant;

    let causality = Causality.Local;
    const cStr = this.resolveModAttribute(mod, "causality", typeName, dae) as string;
    if (cStr === "input") causality = Causality.Input;
    else if (cStr === "output") causality = Causality.Output;

    dae.addVariable(varType, name, (meta?.description as string) ?? "", variability, causality);

    // If there's a binding expression, emit a binding equation
    if (mod?.bindingExpression) {
      if (mod.bindingExpression.kind === "expression") {
        const bytes = mod.bindingExpression.cstBytes;
        const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], undefined);
        if (cstNode) {
          const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
          const visitor = new ArenaExprVisitor(dae);
          const exprId = visitor.visit(astNode);
          if (exprId !== undefined) {
            const nameExpr = dae.addExpression(ExprKind.Name, name);
            dae.addEquation(EqKind.Simple, nameExpr, exprId);
          }
        }
      } else if (mod.bindingExpression.kind === "literal") {
        const val = mod.bindingExpression.value;
        const exprId =
          typeof val === "number"
            ? dae.addExpression(ExprKind.RealLiteral, val)
            : typeof val === "boolean"
              ? dae.addExpression(ExprKind.BoolLiteral, val)
              : dae.addExpression(ExprKind.StringLiteral, val as string);
        const nameExpr = dae.addExpression(ExprKind.Name, name);
        dae.addEquation(EqKind.Simple, nameExpr, exprId);
      }
    }
  }

  private resolveModAttribute(
    mod: ModelicaModArgs | null,
    attrName: string,
    typeName: string,
    dae: DAEArenaBuilder,
  ): unknown {
    if (mod) {
      const arg = mod.args.find((a) => a.name === attrName);
      if (arg?.value) {
        if (arg.value.kind === "literal") return arg.value.value;
        if (arg.value.kind === "expression") {
          const bytes = arg.value.cstBytes;
          const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], undefined);
          if (cstNode) {
            const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
            const visitor = new ArenaExprVisitor(dae);
            const exprId = visitor.visit(astNode);
            if (exprId !== undefined) {
              return evaluateArenaExpression(dae, exprId);
            }
          }
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

  private flattenEquation(entry: SymbolEntry, prefix: string, dae: DAEArenaBuilder): void {
    const cstNode = this.db.cstNodeRange(entry.startByte, entry.endByte, entry);
    if (cstNode) {
      const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
      // Depending on the equation type, the AST node will have different structure
      // For a simple equation, it usually has expression1 and expression2 or left/right
      const visitor = new ArenaExprVisitor(dae);
      let lhsId: number | undefined = undefined;
      let rhsId: number | undefined = undefined;

      const astAny = astNode as any;
      if (astAny.expression1 && astAny.expression2) {
        lhsId = visitor.visit(astAny.expression1);
        rhsId = visitor.visit(astAny.expression2);
      } else if (astAny.left && astAny.right) {
        lhsId = visitor.visit(astAny.left);
        rhsId = visitor.visit(astAny.right);
      } else if (astAny.expression) {
        // Just an expression statement like `foo();`
        const exprId = visitor.visit(astAny.expression);
        if (exprId !== undefined) {
          const zero = dae.addExpression(ExprKind.IntLiteral, 0);
          dae.addEquation(EqKind.Simple, exprId, zero);
          return;
        }
      }

      if (lhsId !== undefined && rhsId !== undefined) {
        dae.addEquation(EqKind.Simple, lhsId, rhsId);
        return;
      }
    }

    // Fallback if parsing fails
    const lhs = dae.addExpression(ExprKind.IntLiteral, 0);
    const rhs = dae.addExpression(ExprKind.IntLiteral, 0);
    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  private flattenForEquation(entry: SymbolEntry, prefix: string, dae: DAEArenaBuilder): void {
    // Stub
  }

  private flattenIfEquation(entry: SymbolEntry, prefix: string, dae: DAEArenaBuilder): void {
    // Stub
  }

  private flattenWhenEquation(entry: SymbolEntry, prefix: string, dae: DAEArenaBuilder): void {
    // Stub
  }

  private flattenAlgorithm(entry: SymbolEntry, prefix: string, dae: DAEArenaBuilder): void {
    // Stub
  }

  // -------------------------------------------------------------------------
  // Connection Handling
  // -------------------------------------------------------------------------

  private recordConnection(entry: SymbolEntry, prefix: string, dae: DAEArenaBuilder): void {
    const meta = entry.metadata as Record<string, unknown>;
    const from = meta?.from as string;
    const to = meta?.to as string;

    if (!from || !to) return;

    const fullFrom = prefix ? `${prefix}.${from}` : from;
    const fullTo = prefix ? `${prefix}.${to}` : to;

    const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(fullFrom));
    const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(fullTo));
    dae.addEquation(EqKind.Connect, lhsId, rhsId);
  }

  private expandConnections(dae: DAEArenaBuilder): void {
    // Stub for future flow expansion implementation
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
