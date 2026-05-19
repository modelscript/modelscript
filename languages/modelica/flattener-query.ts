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
  ArenaDAEBuilder,
  BinOp,
  Causality,
  eliminateArenaAliases,
  EqKind,
  evaluateArenaExpression,
  ExprKind,
  Variability,
  VarType,
} from "@modelscript/compiler";
import { ArenaExprVisitor } from "./arena-expr-visitor.js";
import {
  ModelicaForEquationSyntaxNode,
  ModelicaForIndexSyntaxNode,
  ModelicaIfEquationSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
  ModelicaSyntaxNode,
  ModelicaWhenEquationSyntaxNode,
} from "./ast.js";

// We remove FlatDAE and FlatVariable interfaces since we emit directly to ArenaDAEBuilder.
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
  flatten(rootClassId: SymbolId): ArenaDAEBuilder {
    const rootEntry = this.db.symbol(rootClassId);
    const className = rootEntry?.name ?? "<unknown>";

    const dae = new ArenaDAEBuilder(undefined, className, "");

    // Use the instantiate query to get the resolved element tree
    const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);

    if (!elements || elements.length === 0) {
      return dae;
    }

    // Walk the resolved elements and emit DAE entries
    this.flattenElements(elements, "", dae);

    // Post-processing: expand connections into equations
    this.expandConnections(dae);

    // O(N) Arena-native alias elimination
    eliminateArenaAliases(dae);

    return dae;
  }

  /**
   * Flatten a hybrid system from a SysML TopologyGraph.
   * Walks the topology, instantiating Modelica artifacts bound to each node.
   */
  flattenFromTopology(graph: TopologyGraph): ArenaDAEBuilder {
    const dae = new ArenaDAEBuilder(undefined, "HybridSystem", "");

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

    // O(N) Arena-native alias elimination
    eliminateArenaAliases(dae);

    return dae;
  }

  // -------------------------------------------------------------------------
  // Element Processing
  // -------------------------------------------------------------------------

  private flattenElements(elementIds: SymbolId[], prefix: string, dae: ArenaDAEBuilder): void {
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

  private flattenComponent(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
    const fullName = prefix ? `${prefix}.${entry.name}` : entry.name;
    const meta = entry.metadata as Record<string, unknown>;
    const typeName = meta?.typeSpecifier as string | undefined;

    if (!typeName) {
      dae.diagnostics.push({
        code: 4004,
        rule: "arena-flattener",
        severity: "error",
        message: `Component '${fullName}' has no type specifier`,
        range: null,
      });
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
      dae.diagnostics.push({
        code: 4004,
        rule: "arena-flattener",
        severity: "error",
        message: `Cannot resolve type '${typeName}' for component '${fullName}'`,
        range: null,
      });
      return;
    }

    const classEntry = this.db.symbol(classInstanceId);
    if (!classEntry) {
      dae.diagnostics.push({
        code: 4004,
        rule: "arena-flattener",
        severity: "error",
        message: `Type '${typeName}' resolved to invalid symbol for '${fullName}'`,
        range: null,
      });
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
    dae: ArenaDAEBuilder,
  ): void {
    // For a multi-dimensional array, expand recursively
    // e.g., Real[3,2] x → x[1,1], x[1,2], x[2,1], ...
    const indices = this.generateArrayIndices(shape);

    const classEntry = this.db.symbol(classInstanceId);
    const typeName = classEntry?.name ?? "Real";

    // Track the root variable index so we can set its shape metadata
    const rootIdx = dae.getVarIdxByName(baseName);

    for (const idx of indices) {
      const indexStr = idx.map(String).join(",");
      const fullName = `${baseName}[${indexStr}]`;

      if (isPredefinedScalar(typeName) || classEntry?.metadata?.isPredefined) {
        const varIdx = this.emitVariable(fullName, typeName, entry, dae);
        // Set shape on the first expanded element to record the original array shape
        if (varIdx >= 0 && idx.every((v, i) => v === 1 || i > 0)) {
          dae.setVarShape(varIdx, shape);
        }
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

  private emitVariable(name: string, typeName: string, componentEntry: SymbolEntry, dae: ArenaDAEBuilder): number {
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

    let flags = 0;
    if (meta?.flowPrefix === "flow" || meta?.flowPrefix === "stream") {
      flags |= 8; // isFlow
    }

    const varIdx = dae.addVariable(name, varType, variability, causality, 0.0, flags);

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
            const nameExpr = dae.addNameExpr(name);
            dae.addEquation(EqKind.Simple, nameExpr, exprId);
          }
        }
      } else if (mod.bindingExpression.kind === "literal") {
        const val = mod.bindingExpression.value;
        const exprId =
          typeof val === "number"
            ? dae.addRealLiteral(val)
            : typeof val === "boolean"
              ? dae.addBoolLiteral(val as boolean)
              : dae.addStringLiteral(val as string);
        const nameExpr = dae.addNameExpr(name);
        dae.addEquation(EqKind.Simple, nameExpr, exprId);
      }
    }

    return varIdx;
  }

  private resolveModAttribute(
    mod: ModelicaModArgs | null,
    attrName: string,
    typeName: string,
    dae: ArenaDAEBuilder,
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

  private flattenEquation(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
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

  /**
   * Unroll a for-equation by evaluating the index range at compile time
   * and emitting one copy of each inner equation per iteration.
   */
  private flattenForEquation(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
    const cstNode = this.db.cstNodeRange(entry.startByte, entry.endByte, entry);
    if (!cstNode) return;

    const forEq = ModelicaForEquationSyntaxNode.new(null, cstNode as any);
    if (!forEq) return;

    // Recursively unroll all for-indexes
    this.unrollForIndexes(forEq.forIndexes, 0, forEq.equations, prefix, dae, new Map());
  }

  /**
   * Recursively bind for-index variables and unroll inner equations.
   */
  private unrollForIndexes(
    forIndexes: ModelicaForIndexSyntaxNode[],
    indexPos: number,
    equations: any[],
    prefix: string,
    dae: ArenaDAEBuilder,
    loopVars: Map<string, number>,
  ): void {
    if (indexPos >= forIndexes.length) {
      // Base case: all indices bound — flatten each inner equation
      for (const eq of equations) {
        this.flattenCstEquation(eq, prefix, dae, loopVars);
      }
      return;
    }

    const forIndex = forIndexes[indexPos];
    if (!forIndex) return;

    const indexName = forIndex.identifier?.text ?? "";
    if (!indexName) return;

    // Evaluate the range expression
    const rangeValues = this.evaluateForRange(forIndex, dae);

    if (!rangeValues || rangeValues.length === 0) {
      // Cannot evaluate range — emit as a symbolic for-equation
      // (This covers dynamic ranges that can't be resolved at compile time)
      return;
    }

    // Iterate and recurse
    for (const val of rangeValues) {
      const newVars = new Map(loopVars);
      newVars.set(indexName, val);
      this.unrollForIndexes(forIndexes, indexPos + 1, equations, prefix, dae, newVars);
    }
  }

  /**
   * Evaluate a for-index range expression to an array of integer values.
   * Handles `start:stop` and `start:step:stop` patterns.
   */
  private evaluateForRange(forIndex: ModelicaForIndexSyntaxNode, dae: ArenaDAEBuilder): number[] | null {
    if (!forIndex.expression) return null;

    const visitor = new ArenaExprVisitor(dae);
    const rangeExprId = visitor.visit(forIndex.expression);
    if (rangeExprId === undefined) return null;

    // Check if it's a Range expression
    if (dae.getExprKind(rangeExprId) === ExprKind.Range) {
      const startId = dae.getExprData1(rangeExprId);
      const stepId = dae.getExprLeft(rangeExprId);
      const stopId = dae.getExprRight(rangeExprId);

      const startVal = evaluateArenaExpression(dae, startId);
      const stopVal = evaluateArenaExpression(dae, stopId);
      if (typeof startVal !== "number" || typeof stopVal !== "number") return null;

      let stepVal = 1;
      if (stepId >= 0) {
        const sv = evaluateArenaExpression(dae, stepId);
        if (typeof sv === "number") stepVal = sv;
      }

      const result: number[] = [];
      if (stepVal > 0) {
        for (let i = startVal; i <= stopVal; i += stepVal) result.push(i);
      } else if (stepVal < 0) {
        for (let i = startVal; i >= stopVal; i += stepVal) result.push(i);
      }
      return result;
    }

    // Try direct evaluation (e.g., a literal or parameter reference)
    const val = evaluateArenaExpression(dae, rangeExprId);
    if (typeof val === "number") return [val];

    return null;
  }

  /**
   * Flatten a single CST equation node with loop variable substitution.
   */
  private flattenCstEquation(eqNode: any, prefix: string, dae: ArenaDAEBuilder, loopVars: Map<string, number>): void {
    if (!eqNode) return;

    // Check node type for dispatch
    if (eqNode instanceof ModelicaSimpleEquationSyntaxNode) {
      const visitor = new ArenaExprVisitor(dae, loopVars);
      const lhsId = eqNode.expression1 ? visitor.visit(eqNode.expression1) : undefined;
      const rhsId = eqNode.expression2 ? visitor.visit(eqNode.expression2) : undefined;
      if (lhsId !== undefined && rhsId !== undefined) {
        dae.addEquation(EqKind.Simple, lhsId, rhsId);
      }
    } else if (eqNode instanceof ModelicaForEquationSyntaxNode) {
      // Nested for-equation — recurse
      this.unrollForIndexes(eqNode.forIndexes, 0, eqNode.equations, prefix, dae, loopVars);
    } else if (eqNode instanceof ModelicaIfEquationSyntaxNode) {
      this.flattenIfEquationAst(eqNode, prefix, dae, loopVars);
    } else if (eqNode instanceof ModelicaWhenEquationSyntaxNode) {
      this.flattenWhenEquationAst(eqNode, prefix, dae, loopVars);
    } else {
      // Generic equation — try expression1/expression2 via duck typing
      const visitor = new ArenaExprVisitor(dae, loopVars);
      const n = eqNode as any;
      if (n.expression1 && n.expression2) {
        const lhsId = visitor.visit(n.expression1);
        const rhsId = visitor.visit(n.expression2);
        if (lhsId !== undefined && rhsId !== undefined) {
          dae.addEquation(EqKind.Simple, lhsId, rhsId);
        }
      }
    }
  }

  /**
   * Flatten an if-equation. Attempts compile-time branch elimination;
   * if the condition is not statically evaluable, emits EqKind.If.
   */
  private flattenIfEquation(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
    const cstNode = this.db.cstNodeRange(entry.startByte, entry.endByte, entry);
    if (!cstNode) return;

    const ifEq = ModelicaIfEquationSyntaxNode.new(null, cstNode as any);
    if (!ifEq) return;

    this.flattenIfEquationAst(ifEq, prefix, dae, new Map());
  }

  private flattenIfEquationAst(
    ifEq: ModelicaIfEquationSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
    loopVars: Map<string, number>,
  ): void {
    // Try to evaluate the condition at compile time
    if (ifEq.condition) {
      const visitor = new ArenaExprVisitor(dae, loopVars);
      const condId = visitor.visit(ifEq.condition);
      if (condId !== undefined) {
        const condVal = evaluateArenaExpression(dae, condId);
        if (condVal === true) {
          // Statically true — only emit the then-branch
          for (const eq of ifEq.equations) {
            this.flattenCstEquation(eq, prefix, dae, loopVars);
          }
          return;
        } else if (condVal === false) {
          // Statically false — check elseif branches, then else
          for (const elseIf of ifEq.elseIfEquationClauses) {
            if (elseIf.condition) {
              const eifVisitor = new ArenaExprVisitor(dae, loopVars);
              const eifCondId = eifVisitor.visit(elseIf.condition);
              if (eifCondId !== undefined) {
                const eifVal = evaluateArenaExpression(dae, eifCondId);
                if (eifVal === true) {
                  for (const eq of elseIf.equations) {
                    this.flattenCstEquation(eq, prefix, dae, loopVars);
                  }
                  return;
                } else if (eifVal === false) {
                  continue;
                }
              }
            }
            // Can't evaluate this elseif — fall through to dynamic
            break;
          }
          // All conditions false — emit else branch
          for (const eq of ifEq.elseEquations) {
            this.flattenCstEquation(eq, prefix, dae, loopVars);
          }
          return;
        }
        // Condition is runtime — emit as EqKind.If
        // Flatten the then-branch equations into the arena
        const thenStart = dae.eqCount;
        for (const eq of ifEq.equations) {
          this.flattenCstEquation(eq, prefix, dae, loopVars);
        }
        const thenEnd = dae.eqCount;

        // Flatten the else-branch equations
        const elseStart = dae.eqCount;
        for (const eq of ifEq.elseEquations) {
          this.flattenCstEquation(eq, prefix, dae, loopVars);
        }

        // Emit the if-equation with condition and then-branch range as aux
        dae.addEquation(EqKind.If, condId, thenStart, thenEnd);
      }
    }
  }

  /**
   * Flatten a when-equation. Always emits EqKind.When since when-equations
   * are event-driven and cannot be eliminated at compile time.
   */
  private flattenWhenEquation(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
    const cstNode = this.db.cstNodeRange(entry.startByte, entry.endByte, entry);
    if (!cstNode) return;

    const whenEq = ModelicaWhenEquationSyntaxNode.new(null, cstNode as any);
    if (!whenEq) return;

    this.flattenWhenEquationAst(whenEq, prefix, dae, new Map());
  }

  private flattenWhenEquationAst(
    whenEq: ModelicaWhenEquationSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
    loopVars: Map<string, number>,
  ): void {
    if (!whenEq.condition) return;

    const visitor = new ArenaExprVisitor(dae, loopVars);
    const condId = visitor.visit(whenEq.condition);
    if (condId === undefined) return;

    // Flatten the body equations
    for (const eq of whenEq.equations) {
      const eqVisitor = new ArenaExprVisitor(dae, loopVars);
      const n = eq as any;
      if (n.expression1 && n.expression2) {
        const lhsId = eqVisitor.visit(n.expression1);
        const rhsId = eqVisitor.visit(n.expression2);
        if (lhsId !== undefined && rhsId !== undefined) {
          dae.addEquation(EqKind.When, lhsId, rhsId, condId);
        }
      }
    }

    // Handle elsewhen clauses
    for (const elseWhen of whenEq.elseWhenEquationClauses) {
      if (!elseWhen.condition) continue;
      const ewVisitor = new ArenaExprVisitor(dae, loopVars);
      const ewCondId = ewVisitor.visit(elseWhen.condition);
      if (ewCondId === undefined) continue;

      for (const eq of elseWhen.equations) {
        const eqVisitor = new ArenaExprVisitor(dae, loopVars);
        const n = eq as any;
        if (n.expression1 && n.expression2) {
          const lhsId = eqVisitor.visit(n.expression1);
          const rhsId = eqVisitor.visit(n.expression2);
          if (lhsId !== undefined && rhsId !== undefined) {
            dae.addEquation(EqKind.When, lhsId, rhsId, ewCondId);
          }
        }
      }
    }
  }

  /**
   * Flatten an algorithm section into statement-level assignments in the arena.
   */
  private flattenAlgorithm(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
    const cstNode = this.db.cstNodeRange(entry.startByte, entry.endByte, entry);
    if (!cstNode) return;

    const cst = cstNode as any;
    const statements = cst.childrenForFieldName?.("statement") ?? [];

    for (const stmt of statements) {
      // Handle simple assignment: target := source
      const target = stmt.childForFieldName?.("target");
      const source = stmt.childForFieldName?.("source");
      if (target && source) {
        const visitor = new ArenaExprVisitor(dae);
        const targetAst = ModelicaSyntaxNode.new(null, target);
        const sourceAst = ModelicaSyntaxNode.new(null, source);
        const lhsId = targetAst ? visitor.visit(targetAst) : undefined;
        const rhsId = sourceAst ? visitor.visit(sourceAst) : undefined;
        if (lhsId !== undefined && rhsId !== undefined) {
          dae.addEquation(EqKind.Simple, lhsId, rhsId);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Connection Handling
  // -------------------------------------------------------------------------

  private recordConnection(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
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

  private expandConnections(dae: ArenaDAEBuilder): void {
    class IntUnionFind {
      private parent: Int32Array;
      private rank: Int32Array;
      constructor(size: number) {
        this.parent = new Int32Array(size);
        this.rank = new Int32Array(size);
        for (let i = 0; i < size; i++) this.parent[i] = i;
      }
      find(i: number): number {
        let root = i;
        while (root !== this.parent[root]!) root = this.parent[root]!;
        let curr = i;
        while (curr !== root) {
          const n = this.parent[curr]!;
          this.parent[curr] = root;
          curr = n;
        }
        return root;
      }
      union(i: number, j: number): boolean {
        const rootI = this.find(i);
        const rootJ = this.find(j);
        if (rootI === rootJ) return false;
        if (this.rank[rootI]! < this.rank[rootJ]!) {
          this.parent[rootI] = rootJ;
        } else if (this.rank[rootI]! > this.rank[rootJ]!) {
          this.parent[rootJ] = rootI;
        } else {
          this.parent[rootJ] = rootI;
          this.rank[rootI]!++;
        }
        return true;
      }
    }

    const uf = new IntUnionFind(dae.varCount);
    const connectPairs: [number, number][] = [];

    // 1. Gather all explicit connect() equation pairs
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.Connect) {
        const lhsId = dae.getEqLhs(i);
        const rhsId = dae.getEqRhs(i);
        if (dae.getExprKind(lhsId) === ExprKind.Name && dae.getExprKind(rhsId) === ExprKind.Name) {
          connectPairs.push([dae.getExprData1(lhsId), dae.getExprData1(rhsId)]);
        }
      }
    }

    if (connectPairs.length === 0) return;

    // 2. Resolve structural connections to variable index pairs
    for (let i = 0; i < dae.varCount; i++) {
      const varName = dae.getVarName(i);

      for (const [fromStrId, toStrId] of connectPairs) {
        const fromStr = dae.interner.resolve(fromStrId);
        const toStr = dae.interner.resolve(toStrId);

        // Match from -> to
        let matchSuffix: string | null = null;
        if (varName === fromStr) matchSuffix = "";
        else if (varName.startsWith(fromStr + ".")) matchSuffix = varName.substring(fromStr.length);

        if (matchSuffix !== null) {
          const targetName = toStr + matchSuffix;
          const targetIdx = dae.getVarIdxByName(targetName);
          if (targetIdx >= 0) {
            uf.union(i, targetIdx);
          }
        }
      }
    }

    // 3. Build equivalence classes
    const roots = new Map<number, number[]>();
    for (let i = 0; i < dae.varCount; i++) {
      const root = uf.find(i);
      if (!roots.has(root)) roots.set(root, []);
      roots.get(root)!.push(i);
    }

    // 4. Emit flow-balance and potential equality equations
    for (const [root, group] of roots) {
      if (group.length <= 1) continue;

      const isFlow = dae.isVarFlow(root);

      if (!isFlow) {
        // Potential variables: emit v1 = root, v2 = root...
        const rootExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(root));
        for (const vIdx of group) {
          if (vIdx !== root) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
            dae.addEquation(EqKind.Simple, vExpr, rootExpr);
          }
        }
      } else {
        // Flow variables: emit sum(flows) = 0
        let sumExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[0]!));
        for (let i = 1; i < group.length; i++) {
          const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[i]!));
          sumExpr = dae.addExpression(ExprKind.Binary, BinOp.Add, sumExpr, vExpr);
        }
        const zeroExpr = dae.addExpression(ExprKind.RealLiteral, 0.0);
        dae.addEquation(EqKind.Simple, sumExpr, zeroExpr);
      }
    }
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
