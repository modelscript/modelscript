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
import { type ModelicaModArgs, mergeModArgs } from "./modification-args.js";

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
  foldArenaConstants,
  Variability,
  VarType,
} from "@modelscript/compiler";
import { ArenaExprVisitor } from "./arena-expr-visitor.js";
import {
  ModelicaAlgorithmSectionSyntaxNode,
  ModelicaBreakStatementSyntaxNode,
  ModelicaClassDefinitionSyntaxNode,
  ModelicaComplexAssignmentStatementSyntaxNode,
  ModelicaComponentReferenceSyntaxNode,
  ModelicaConnectEquationSyntaxNode,
  ModelicaEquationSectionSyntaxNode,
  ModelicaForEquationSyntaxNode,
  ModelicaForIndexSyntaxNode,
  ModelicaForStatementSyntaxNode,
  ModelicaIfEquationSyntaxNode,
  ModelicaIfStatementSyntaxNode,
  ModelicaLongClassSpecifierSyntaxNode,
  ModelicaProcedureCallStatementSyntaxNode,
  ModelicaReturnStatementSyntaxNode,
  ModelicaSimpleAssignmentStatementSyntaxNode,
  ModelicaSimpleEquationSyntaxNode,
  ModelicaSpecialEquationSyntaxNode,
  ModelicaStatementSyntaxNode,
  ModelicaSyntaxNode,
  ModelicaWhenEquationSyntaxNode,
  ModelicaWhenStatementSyntaxNode,
  ModelicaWhileStatementSyntaxNode,
} from "./ast.js";

// ---------------------------------------------------------------------------
// Compiler Options
// ---------------------------------------------------------------------------

export interface FlattenOptions {
  arrayMode?: "scalarize" | "preserve";
  functionInlining?: "inline" | "preserve";
  canonicalizeEquations?: boolean;
}

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
  /** Connector cardinality map: flattened connector name → count of connect references. */
  private connectorCardinality = new Map<string, number>();
  /** Active class hierarchy for outer/inner resolution. */
  private activeClassStack: { classId: SymbolId; prefix: string }[] = [];
  /** Compiler options. */
  private options: Required<Pick<FlattenOptions, "arrayMode" | "functionInlining">> & FlattenOptions = {
    arrayMode: "scalarize",
    functionInlining: "preserve",
    canonicalizeEquations: false,
  };

  constructor(private db: QueryDB) {}

  /**
   * Flatten a Modelica class into a DAE.
   *
   * @param rootClassId - The SymbolId of the top-level model to flatten
   * @returns A FlatDAE containing all variables, equations, and connections
   */
  flatten(rootClassId: SymbolId, opts?: FlattenOptions): ArenaDAEBuilder {
    // Apply options
    if (opts) {
      this.options = { ...this.options, ...opts };
    }

    const rootEntry = this.db.symbol(rootClassId);
    const className = rootEntry?.name ?? "<unknown>";

    const dae = new ArenaDAEBuilder(undefined, className, "");

    // Use the instantiate query to get the resolved element tree
    const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);

    if (!elements || elements.length === 0) {
      return dae;
    }

    // Pre-pass: count connector cardinality for cardinality() built-in
    this.connectorCardinality.clear();
    this.countConnections(rootClassId, "");

    // Pre-pass: augment expandable connectors with virtual members from connect equations
    this.augmentExpandableConnectors(rootClassId, dae);

    // Push root class onto active hierarchy stack (for outer/inner resolution)
    this.activeClassStack.push({ classId: rootClassId, prefix: "" });

    // Walk the resolved elements and emit DAE entries (components, connections)
    this.flattenElements(elements, "", dae);

    // Walk the CST to extract equation/algorithm sections
    // (Equations are not indexed in the symbol table — they live as CST nodes)
    // Must walk the extends chain recursively to include parent class equations.
    this.flattenClassSectionsRecursive(rootClassId, "", dae, new Set());

    // Pop root class from hierarchy stack
    this.activeClassStack.pop();

    // Post-processing: expand connections into equations
    this.expandConnections(dae);

    // Extract experiment annotation from root class
    this.extractExperimentAnnotation(rootClassId, dae);

    // Fold constant and parameter binding expressions
    foldArenaConstants(dae);

    // O(N) Arena-native alias elimination
    eliminateArenaAliases(dae);

    // Group equations for perfect print/AST ordering parity with legacy
    dae.groupEquationsForParity();

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
  // CST-Based Section Extraction (Equations & Algorithms)
  // -------------------------------------------------------------------------

  /**
   * Recursively flatten equation/algorithm sections from a class and all
   * its ancestors (via extends). This ensures that parent class equations
   * are included when flattening a child class.
   *
   * For the root class: own sections first, then extends equations.
   * For inherited classes: extends parents first (depth-first), then own.
   * This matches the legacy flattener's `localEqs → extEqs` ordering
   * where extEqs internally are depth-first (grandparent before parent).
   *
   * @param classId - The class to extract sections from
   * @param prefix - Dot-path prefix for name resolution
   * @param dae - The DAE builder to emit into
   * @param visited - Set of already-visited class IDs to prevent cycles
   * @param isRoot - True for the top-level class being flattened
   */
  private flattenClassSectionsRecursive(
    classId: SymbolId,
    prefix: string,
    dae: ArenaDAEBuilder,
    visited: Set<SymbolId>,
    isRoot = true,
  ): void {
    if (visited.has(classId)) return;
    visited.add(classId);

    // Root class: own sections first, then inherited
    // Inherited classes: parents first (depth-first), then own
    if (isRoot) {
      this.flattenClassSections(classId, prefix, dae);
    }

    // Walk extends clauses to emit parent class sections
    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const targetName = (child.metadata as Record<string, unknown>)?.typeSpecifier as string | undefined;
        if (!targetName) continue;

        const targets = this.db.byName(targetName);
        for (const target of targets) {
          if (target.kind === "Class") {
            this.flattenClassSectionsRecursive(target.id, prefix, dae, visited, false);
            break;
          }
        }
      }
    }

    if (!isRoot) {
      this.flattenClassSections(classId, prefix, dae);
    }
  }

  /**
   * Walk the CST of a class definition to extract and flatten
   * EquationSection and AlgorithmSection nodes.
   *
   * Equations are NOT indexed in the symbol table — they exist only as
   * CST nodes within the class body. This method fills that gap by
   * walking the concrete syntax tree directly.
   */
  private flattenClassSections(classId: SymbolId, prefix: string, dae: ArenaDAEBuilder): void {
    const cstNode = this.db.cstNode(classId) as any;
    if (!cstNode) return;

    const classDef = ModelicaClassDefinitionSyntaxNode.new(null, cstNode);
    if (!classDef) return;

    const sections = [...classDef.sections];
    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i]!;
      if (section instanceof ModelicaEquationSectionSyntaxNode) {
        this.flattenEquationSection(section, prefix, dae);
      } else if (section instanceof ModelicaAlgorithmSectionSyntaxNode) {
        this.flattenAlgorithmSection(section, prefix, dae);
      }
    }
  }

  /**
   * Flatten all equations within an EquationSection AST node.
   */
  private flattenEquationSection(
    sectionNode: ModelicaEquationSectionSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
  ): void {
    const isInitial = sectionNode.initial;
    const eqKind = isInitial ? EqKind.InitialSimple : EqKind.Simple;

    for (const eq of sectionNode.equations) {
      if (eq instanceof ModelicaSimpleEquationSyntaxNode) {
        const visitor = this.createExprVisitor(dae);
        const lhsId = eq.expression1 ? visitor.visit(eq.expression1) : undefined;
        const rhsId = eq.expression2 ? visitor.visit(eq.expression2) : undefined;
        if (lhsId !== undefined && rhsId !== undefined) {
          dae.addEquation(eqKind, lhsId, rhsId);
        }
      } else if (eq instanceof ModelicaForEquationSyntaxNode) {
        this.unrollForIndexes(eq.forIndexes, 0, eq.equations, prefix, dae, new Map());
      } else if (eq instanceof ModelicaIfEquationSyntaxNode) {
        this.flattenIfEquationAst(eq, prefix, dae, new Map());
      } else if (eq instanceof ModelicaWhenEquationSyntaxNode) {
        this.flattenWhenEquationAst(eq, prefix, dae, new Map());
      } else if (eq instanceof ModelicaConnectEquationSyntaxNode) {
        const lhs = eq.componentReference1;
        const rhs = eq.componentReference2;
        if (lhs && rhs) {
          const lhsRef = this.serializeRef(lhs);
          const rhsRef = this.serializeRef(rhs);
          if (lhsRef && rhsRef) {
            const lhsName = prefix ? `${prefix}.${lhsRef}` : lhsRef;
            const rhsName = prefix ? `${prefix}.${rhsRef}` : rhsRef;
            const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(lhsName));
            const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(rhsName));
            dae.addEquation(EqKind.Connect, lhsId, rhsId);
          }
        }
      } else if (eq instanceof ModelicaSpecialEquationSyntaxNode) {
        this.handleSpecialEquation(eq, prefix, dae);
      }
    }
  }

  private serializeRef(ref: ModelicaComponentReferenceSyntaxNode): string | undefined {
    let path = "";
    for (const part of ref.parts) {
      const ident = part.identifier?.text;
      if (!ident) return undefined;
      if (path.length > 0) path += ".";
      path += ident;
      if (part.arraySubscripts && part.arraySubscripts.subscripts.length > 0) {
        for (const sub of part.arraySubscripts.subscripts) {
          if (sub.expression) {
            const expr = sub.expression as any;
            const subText = expr.text ?? expr.concreteSyntaxNode?.text ?? "";
            if (subText) {
              path += `[${subText}]`;
            }
          }
        }
      }
    }
    return path;
  }

  /**
   * Flatten an AlgorithmSection AST node into arena statements.
   */
  private flattenAlgorithmSection(
    sectionNode: ModelicaAlgorithmSectionSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
  ): void {
    const isInitial = sectionNode.initial;
    const stmtNodes: ModelicaStatementSyntaxNode[] = sectionNode.statements ?? [];
    if (stmtNodes.length === 0) return;

    const stmtStartIdx = dae.stmtCount;

    for (const stmt of stmtNodes) {
      this.flattenStatement(stmt, dae);
    }

    // Use top-level statement count (not total slot count including nested bodies)
    if (isInitial) {
      dae.addInitialAlgorithmSection(stmtStartIdx, stmtNodes.length);
    } else {
      dae.addAlgorithmSection(stmtStartIdx, stmtNodes.length);
    }
  }

  // -------------------------------------------------------------------------
  // Element Processing
  // -------------------------------------------------------------------------

  private flattenElements(elementIds: SymbolId[], prefix: string, dae: ArenaDAEBuilder): void {
    for (const eid of elementIds) {
      const entry = this.db.symbol(eid);
      if (!entry) continue;

      // Conditional component check: skip disabled components
      if (entry.kind === "Component") {
        const meta = entry.metadata as Record<string, unknown>;
        if (meta?.conditionAttribute !== undefined && meta.conditionAttribute !== null) {
          // Evaluate the condition — if statically false, skip this component
          const condVal = this.db.evaluate(meta.conditionAttribute, entry.parentId ?? null);
          if (condVal === false || condVal === 0) continue;
        }
      }

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

    // --- Outer/inner resolution ---
    // If the component is declared `outer` (and NOT also `inner`),
    // skip emitting it — the matching `inner` in an enclosing scope provides the variable.
    const isOuter = this.db.query<boolean>("isOuter", entry.id);
    const isInner = this.db.query<boolean>("isInner", entry.id);
    if (isOuter && !isInner) {
      // Search the active class hierarchy for a matching `inner` component
      let hasInner = false;
      for (let i = this.activeClassStack.length - 1; i >= 0; i--) {
        const ancestor = this.activeClassStack[i]!;
        const ancestorChildren = this.db.childrenOf(ancestor.classId);
        for (const child of ancestorChildren) {
          if (child.kind === "Component" && child.name === entry.name) {
            const childIsInner = this.db.query<boolean>("isInner", child.id);
            if (childIsInner) {
              hasInner = true;
              break;
            }
          }
        }
        if (hasInner) break;
      }
      if (hasInner) return; // Skip — the `inner` declaration provides this variable
    }

    // Resolve the type specifier using the classInstance query.
    const classInstanceId = this.db.query<SymbolId | null>("classInstance", entry.id);

    if (classInstanceId === null) {
      const resolvedType = this.db.query<SymbolEntry | null>("resolvedType", entry.id);
      if (!resolvedType) {
        dae.diagnostics.push({
          code: 4004,
          rule: "arena-flattener",
          severity: "error",
          message: `Cannot resolve type for component '${fullName}'`,
          range: null,
        });
      }
      return;
    }

    const classEntry = this.db.symbol(classInstanceId);
    if (!classEntry) {
      dae.diagnostics.push({
        code: 4004,
        rule: "arena-flattener",
        severity: "error",
        message: `Type resolved to invalid symbol for '${fullName}'`,
        range: null,
      });
      return;
    }

    const classMeta = classEntry.metadata as Record<string, unknown>;
    const resolvedTypeName = classEntry.name;

    // --- Predefined scalar types ---
    if (classMeta?.isPredefined || isPredefinedScalar(resolvedTypeName)) {
      this.emitVariable(fullName, resolvedTypeName, entry, dae);
      return;
    }

    // --- Enumeration types ---
    if (classMeta?.classPrefixes === "enumeration") {
      this.emitEnumerationVariable(fullName, resolvedTypeName, entry, classInstanceId, dae);
      return;
    }

    // --- Clock type ---
    if (resolvedTypeName === "Clock") {
      this.emitClockVariable(fullName, entry, dae);
      return;
    }

    // --- Function / Partial Function types ---
    if (classMeta?.classKind === "function" || classMeta?.classKind === "operator function") {
      this.emitFunctionVariable(fullName, resolvedTypeName, entry, dae);
      return;
    }

    // Check array dimensions (resolvedArrayDimensions evaluates expression dims via Salsa)
    const arrayDims = this.db.query<number[] | null>("resolvedArrayDimensions", entry.id);

    if (arrayDims && arrayDims.length > 0) {
      if (this.options.arrayMode === "preserve") {
        // In preserve mode, emit a single variable with shape metadata
        this.emitVariable(fullName, resolvedTypeName, entry, dae);
        const varIdx = dae.getVarIdxByName(fullName);
        if (varIdx >= 0) dae.setVarShape(varIdx, arrayDims);
        return;
      }
      this.flattenArrayComponent(fullName, classInstanceId, arrayDims, entry, dae);
      return;
    }

    // Recurse into the compound type's elements
    const subElements = this.db.query<SymbolId[]>("instantiate", classInstanceId);

    if (subElements) {
      // Push compound type onto hierarchy stack for outer/inner resolution
      this.activeClassStack.push({ classId: classInstanceId, prefix: fullName });
      this.flattenElements(subElements, fullName, dae);
      this.flattenClassSectionsRecursive(classInstanceId, fullName, dae, new Set());
      this.activeClassStack.pop();
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
          this.flattenClassSectionsRecursive(classInstanceId, fullName, dae, new Set());
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
    // Extract outer modification from specialization
    const specArgs = this.db.argsOf<ModelicaModArgs>(componentEntry.id);
    const outerMod = specArgs?.data ?? null;

    // Extract inline modification from CST declaration
    const inlineMod = this.db.query<ModelicaModArgs | null>("effectiveModification", componentEntry.id);

    // Merge modifications: outer takes precedence over inline
    const mod = mergeModArgs(outerMod, inlineMod);

    let varType = VarType.Real;
    if (typeName === "Integer") varType = VarType.Integer;
    else if (typeName === "Boolean") varType = VarType.Boolean;
    else if (typeName === "String") varType = VarType.String;

    // Resolve variability via the query system (reads from ComponentClause CST)
    let variability = Variability.Continuous;
    const modVariability = this.resolveModAttribute(mod, "variability", typeName, dae, componentEntry) as string;
    const qVariability = this.db.query<string | null>("variability", componentEntry.id);
    const vStr = modVariability ?? qVariability ?? "continuous";
    if (vStr === "discrete") variability = Variability.Discrete;
    else if (vStr === "parameter") variability = Variability.Parameter;
    else if (vStr === "constant") variability = Variability.Constant;

    // Resolve causality via the query system
    let causality = Causality.Local;
    const modCausality = this.resolveModAttribute(mod, "causality", typeName, dae, componentEntry) as string;
    const qCausality = this.db.query<string | null>("causality", componentEntry.id);
    const cStr = modCausality ?? qCausality ?? "local";
    if (cStr === "input") causality = Causality.Input;
    else if (cStr === "output") causality = Causality.Output;

    // Resolve flow prefix via the query system
    const qFlowPrefix = this.db.query<string | null>("flowPrefix", componentEntry.id);
    let flags = 0;
    if (qFlowPrefix === "flow" || qFlowPrefix === "stream") {
      flags |= 8; // isFlow
    }

    // Protected flag (bit 0)
    const isProtected = this.db.query<boolean>("isProtected", componentEntry.id);
    if (isProtected) {
      flags |= 1;
    }

    // Final flag (bit 4)
    const isFinal = this.db.query<boolean>("isFinal", componentEntry.id);

    // Evaluate annotation: if annotation(Evaluate=true), promote parameter to final
    // Per Modelica §18.3, Evaluate=true tells the tool to substitute the parameter's value
    // at compile time. OpenModelica promotes such parameters to `final parameter`.
    const isEvaluate = this.db.query<boolean>("isEvaluate", componentEntry.id);
    if (isFinal || (isEvaluate && variability !== Variability.Constant)) {
      flags |= 16;
    }

    // Resolve start value and set as attribute expression
    const startVal = this.resolveModAttribute(mod, "start", typeName, dae, componentEntry) ?? 0.0;
    const initialValue =
      typeof startVal === "number" ? startVal : startVal === true ? 1.0 : startVal === false ? 0.0 : 0.0;

    const varIdx = dae.addVariable(name, varType, variability, causality, initialValue, flags);
    if (qFlowPrefix === "stream") {
      dae.setVarFlowPrefix(varIdx, "stream");
    }

    // Set start value as an attribute expression for the printer
    // (if explicitly modified, or if non-default: non-zero for Real, non-false for Boolean)
    const hasExplicitStart = mod?.args.some((a) => a.name === "start");
    const isDefaultStart =
      (varType === VarType.Real && initialValue === 0.0) ||
      (varType === VarType.Integer && initialValue === 0) ||
      (varType === VarType.Boolean && initialValue === 0.0);
    if (!isDefaultStart || hasExplicitStart) {
      const startExprId =
        varType === VarType.Boolean
          ? dae.addBoolLiteral(initialValue !== 0)
          : varType === VarType.Integer
            ? dae.addIntLiteral(initialValue)
            : dae.addRealLiteral(initialValue);
      dae.setVarAttrExprId(varIdx, "start", startExprId);
    }

    // Set variable description string from CST description field
    const meta = componentEntry.metadata as Record<string, unknown>;
    const descNode = meta?.description as { descriptionString?: string } | undefined;
    if (descNode?.descriptionString) {
      // Strip quotes from the description string literal
      const rawDesc = descNode.descriptionString;
      const desc = rawDesc.startsWith('"') && rawDesc.endsWith('"') ? rawDesc.slice(1, -1) : rawDesc;
      if (desc) dae.setVarDescription(varIdx, desc);
    }

    // Mark final/evaluate parameters as fixed for compile-time substitution
    if ((isFinal || isEvaluate) && variability === Variability.Parameter) {
      dae.setVarFixed(varIdx);
    }

    // If there's a binding expression, set it as the variable's expression
    // (for parameters/constants this produces `parameter Real a = 2.0`,
    //  for continuous vars we still emit an equation)
    if (mod?.bindingExpression) {
      if (mod.bindingExpression.kind === "expression") {
        const bytes = mod.bindingExpression.cstBytes;
        const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], componentEntry);
        if (cstNode) {
          const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
          const visitor = this.createExprVisitor(dae);
          // If the AST wrapper fails (e.g. raw "true"/"false" CST nodes),
          // pass the CST node directly — the visitor has fallback handling.
          let exprId = visitor.visit(astNode ?? cstNode);
          if (exprId !== undefined) {
            if (varType === VarType.Real) {
              exprId = visitor.castToRealExpr(exprId);
            }
            if (variability === Variability.Parameter || variability === Variability.Constant) {
              // Set as variable expression (printed as `parameter Real a = 2.0`)
              dae.setVarExpression(varIdx, exprId);
            } else {
              // Emit as equation (printed in the equation section)
              const nameExpr = dae.addNameExpr(name);
              dae.addEquation(EqKind.Simple, nameExpr, exprId);
            }
          }
        }
      } else if (mod.bindingExpression.kind === "literal") {
        const val = mod.bindingExpression.value;
        const compileLiteral = (value: unknown): number => {
          if (Array.isArray(value)) {
            const elements = value.map(compileLiteral);
            return dae.addArrayCtorExpr(elements);
          }
          if (typeof value === "number") {
            if (varType === VarType.Integer) {
              return dae.addIntLiteral(Math.round(value));
            } else {
              return dae.addRealLiteral(value);
            }
          } else if (typeof value === "boolean") {
            return dae.addBoolLiteral(value);
          } else {
            return dae.addStringLiteral(value as string);
          }
        };
        const exprId = compileLiteral(val);
        if (variability === Variability.Parameter || variability === Variability.Constant) {
          dae.setVarExpression(varIdx, exprId);
        } else {
          const nameExpr = dae.addNameExpr(name);
          dae.addEquation(EqKind.Simple, nameExpr, exprId);
        }
      }
    }

    return varIdx;
  }

  // -------------------------------------------------------------------------
  // Enumeration Variable Emission
  // -------------------------------------------------------------------------

  /**
   * Emit an enumeration variable. Enumerations are stored as VarType.Enumeration
   * with their literal list attached via setVarEnumerationLiterals.
   */
  private emitEnumerationVariable(
    name: string,
    typeName: string,
    componentEntry: SymbolEntry,
    classInstanceId: SymbolId,
    dae: ArenaDAEBuilder,
  ): number {
    // Resolve variability, causality, etc. — same as scalar variables
    const specArgs = this.db.argsOf<ModelicaModArgs>(componentEntry.id);
    const outerMod = specArgs?.data ?? null;
    const inlineMod = this.db.query<ModelicaModArgs | null>("effectiveModification", componentEntry.id);
    const mod = mergeModArgs(outerMod, inlineMod);

    let variability = Variability.Discrete; // Enumerations are discrete by default
    const qVariability = this.db.query<string | null>("variability", componentEntry.id);
    const vStr = qVariability ?? "discrete";
    if (vStr === "parameter") variability = Variability.Parameter;
    else if (vStr === "constant") variability = Variability.Constant;

    let causality = Causality.Local;
    const qCausality = this.db.query<string | null>("causality", componentEntry.id);
    const cStr = qCausality ?? "local";
    if (cStr === "input") causality = Causality.Input;
    else if (cStr === "output") causality = Causality.Output;

    const startVal = this.resolveModAttribute(mod, "start", typeName, dae, componentEntry) ?? 0;
    const initialValue = typeof startVal === "number" ? startVal : 0;

    const varIdx = dae.addVariable(name, VarType.Enumeration, variability, causality, initialValue, 0);

    // Attach enumeration literal metadata
    const enumChildren = this.db.childrenOf(classInstanceId);
    const literals: { ordinal: number; name: string }[] = [];
    let ordinal = 1;
    for (const child of enumChildren) {
      if (child.kind === "EnumerationLiteral") {
        literals.push({ ordinal: ordinal++, name: child.name });
      }
    }
    if (literals.length > 0) {
      dae.setVarEnumerationLiterals(varIdx, literals);
    }

    // Set enumeration type name for the printer
    dae.setVarDescription(varIdx, `enumeration(${literals.map((l) => l.name).join(", ")})`);

    // Handle binding expression (same logic as emitVariable)
    if (mod?.bindingExpression) {
      if (mod.bindingExpression.kind === "literal") {
        const val = mod.bindingExpression.value;
        const exprId = typeof val === "number" ? dae.addIntLiteral(Math.round(val)) : dae.addIntLiteral(0);
        if (variability === Variability.Parameter || variability === Variability.Constant) {
          dae.setVarExpression(varIdx, exprId);
        } else {
          const nameExpr = dae.addNameExpr(name);
          dae.addEquation(EqKind.Simple, nameExpr, exprId);
        }
      } else if (mod.bindingExpression.kind === "expression") {
        const bytes = mod.bindingExpression.cstBytes;
        const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], componentEntry);
        if (cstNode) {
          const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
          const visitor = this.createExprVisitor(dae);
          const exprId = visitor.visit(astNode ?? cstNode);
          if (exprId !== undefined) {
            if (variability === Variability.Parameter || variability === Variability.Constant) {
              dae.setVarExpression(varIdx, exprId);
            } else {
              const nameExpr = dae.addNameExpr(name);
              dae.addEquation(EqKind.Simple, nameExpr, exprId);
            }
          }
        }
      }
    }

    return varIdx;
  }

  // -------------------------------------------------------------------------
  // Clock Variable Emission
  // -------------------------------------------------------------------------

  private emitClockVariable(name: string, componentEntry: SymbolEntry, dae: ArenaDAEBuilder): number {
    // Resolve variability and causality (Clock variables default to continuous/local)
    let variability = Variability.Continuous;
    const qVariability = this.db.query<string | null>("variability", componentEntry.id);
    if (qVariability === "parameter") variability = Variability.Parameter;
    else if (qVariability === "constant") variability = Variability.Constant;

    let causality = Causality.Local;
    const qCausality = this.db.query<string | null>("causality", componentEntry.id);
    if (qCausality === "input") causality = Causality.Input;
    else if (qCausality === "output") causality = Causality.Output;

    const varIdx = dae.addVariable(name, VarType.Clock, variability, causality, 0.0, 0);

    // Handle binding expression (same pattern as emitVariable)
    const specArgs = this.db.argsOf<ModelicaModArgs>(componentEntry.id);
    const outerMod = specArgs?.data ?? null;
    const inlineMod = this.db.query<ModelicaModArgs | null>("effectiveModification", componentEntry.id);
    const mod = mergeModArgs(outerMod, inlineMod);

    if (mod?.bindingExpression) {
      if (mod.bindingExpression.kind === "expression") {
        const bytes = mod.bindingExpression.cstBytes;
        const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], componentEntry);
        if (cstNode) {
          const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
          const visitor = this.createExprVisitor(dae);
          const exprId = visitor.visit(astNode ?? cstNode);
          if (exprId !== undefined) {
            if (variability === Variability.Parameter || variability === Variability.Constant) {
              dae.setVarExpression(varIdx, exprId);
            } else {
              // Emit as equation: c = Clock(0.1);
              const nameExpr = dae.addNameExpr(name);
              dae.addEquation(EqKind.Simple, nameExpr, exprId);
            }
          }
        }
      }
    }

    return varIdx;
  }

  // -------------------------------------------------------------------------
  // Function Variable Emission
  // -------------------------------------------------------------------------

  private emitFunctionVariable(
    name: string,
    typeName: string,
    componentEntry: SymbolEntry,
    dae: ArenaDAEBuilder,
  ): void {
    const resolvedEntries = this.db.byName(typeName);
    const resolvedId = resolvedEntries.length > 0 ? resolvedEntries[0].id : null;
    const inputParts: string[] = [];
    const outputParts: string[] = [];
    if (resolvedId !== null) {
      const elements = this.db.query<number[]>("instantiate", resolvedId);
      if (elements) {
        for (const elemId of elements) {
          const entry = this.db.symbol(elemId);
          if (entry && entry.kind === "Component") {
            const qCausality = this.db.query<string | null>("causality", elemId);
            const classInstId = this.db.query<number | null>("classInstance", elemId);
            const classEntry = classInstId ? this.db.symbol(classInstId) : null;
            let argType = classEntry?.name ?? "Real";
            if (argType !== "Integer" && argType !== "Boolean" && argType !== "String" && argType !== "Clock") {
              argType = "Real";
            }
            if (qCausality === "input") {
              inputParts.push(`#${argType} ${entry.name}`);
            } else if (qCausality === "output") {
              outputParts.push(`#${argType}`);
            }
          }
        }
      }
    }
    const outputType = outputParts.length > 0 ? outputParts[0] : "#Real";
    const varShortName = name.split(".").pop() ?? name;
    const customSig = `${varShortName}<function>(${inputParts.join(", ")}) => ${outputType}`;

    const varIdx = this.emitVariable(name, typeName, componentEntry, dae);
    if (varIdx >= 0) {
      dae.setVarCustomType(varIdx, customSig);
    }
  }

  private resolveFunctionInputs(funcName: string): string[] {
    const resolvedEntries = this.db.byName(funcName);
    if (resolvedEntries.length === 0) return [];
    const resolvedId = resolvedEntries[0].id;
    const funcEntry = this.db.symbol(resolvedId);
    if (funcEntry?.kind !== "Class") return [];
    const elements = this.db.query<number[]>("instantiate", resolvedId);
    if (!elements) return [];
    const inputs: string[] = [];
    for (const elemId of elements) {
      const entry = this.db.symbol(elemId);
      if (entry && entry.kind === "Component") {
        const qCausality = this.db.query<string | null>("causality", elemId);
        if (qCausality === "input") {
          inputs.push(entry.name);
        }
      }
    }
    return inputs;
  }

  // -------------------------------------------------------------------------
  // Cardinality Pre-Pass (§9.3.1)
  // -------------------------------------------------------------------------

  /**
   * Count how many connect equations reference each connector.
   * Populates this.connectorCardinality so that cardinality() calls
   * in equations can be resolved at compile time.
   */
  private countConnections(classId: SymbolId, prefix: string): void {
    const cstNode = this.db.cstNode(classId) as any;
    if (!cstNode) return;

    const classDef = ModelicaClassDefinitionSyntaxNode.new(null, cstNode);
    if (!classDef) return;

    for (const section of classDef.sections) {
      if (!(section instanceof ModelicaEquationSectionSyntaxNode)) continue;
      for (const eq of section.equations) {
        if (eq instanceof ModelicaConnectEquationSyntaxNode) {
          const ref1 = eq.componentReference1;
          const ref2 = eq.componentReference2;
          if (ref1 && ref2) {
            const name1 = this.serializeRefWithPrefix(ref1, prefix);
            const name2 = this.serializeRefWithPrefix(ref2, prefix);
            if (name1) this.connectorCardinality.set(name1, (this.connectorCardinality.get(name1) ?? 0) + 1);
            if (name2) this.connectorCardinality.set(name2, (this.connectorCardinality.get(name2) ?? 0) + 1);
          }
        }
        // Scan for-equations for nested connect statements
        if (eq instanceof ModelicaForEquationSyntaxNode) {
          this.countConnectionsInForEq(eq, prefix);
        }
      }
    }

    // Scan inherited sections from extends
    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const targetName = (child.metadata as Record<string, unknown>)?.typeSpecifier as string | undefined;
        if (!targetName) continue;
        const targets = this.db.byName(targetName);
        for (const target of targets) {
          if (target.kind === "Class") {
            this.countConnections(target.id, prefix);
            break;
          }
        }
      }
    }
  }

  private countConnectionsInForEq(forEq: ModelicaForEquationSyntaxNode, prefix: string): void {
    for (const eq of forEq.equations) {
      if (eq instanceof ModelicaConnectEquationSyntaxNode) {
        const ref1 = eq.componentReference1;
        const ref2 = eq.componentReference2;
        if (ref1 && ref2) {
          const name1 = this.serializeRefWithPrefix(ref1, prefix);
          const name2 = this.serializeRefWithPrefix(ref2, prefix);
          if (name1) this.connectorCardinality.set(name1, (this.connectorCardinality.get(name1) ?? 0) + 1);
          if (name2) this.connectorCardinality.set(name2, (this.connectorCardinality.get(name2) ?? 0) + 1);
        }
      }
      if (eq instanceof ModelicaForEquationSyntaxNode) {
        this.countConnectionsInForEq(eq, prefix);
      }
    }
  }

  private serializeRefWithPrefix(ref: ModelicaComponentReferenceSyntaxNode, prefix: string): string | undefined {
    const path = this.serializeRef(ref);
    if (!path) return undefined;
    return prefix ? `${prefix}.${path}` : path;
  }

  // -------------------------------------------------------------------------
  // Expandable Connector Augmentation (§9.1.3)
  // -------------------------------------------------------------------------

  /**
   * Pre-pass: scan connect equations for references to expandable connector
   * members that don't exist yet, and create virtual variables.
   * Per §9.1.3, expandable connectors are dynamically augmented by connect equations.
   */
  private augmentExpandableConnectors(rootClassId: SymbolId, dae: ArenaDAEBuilder): void {
    const cstNode = this.db.cstNode(rootClassId) as any;
    if (!cstNode) return;

    const classDef = ModelicaClassDefinitionSyntaxNode.new(null, cstNode);
    if (!classDef) return;

    for (const section of classDef.sections) {
      if (!(section instanceof ModelicaEquationSectionSyntaxNode)) continue;
      for (const eq of section.equations) {
        if (!(eq instanceof ModelicaConnectEquationSyntaxNode)) continue;
        const ref1 = eq.componentReference1;
        const ref2 = eq.componentReference2;
        if (!ref1 || !ref2) continue;

        this.tryAugmentExpandableRef(ref1, ref2, rootClassId, dae);
        this.tryAugmentExpandableRef(ref2, ref1, rootClassId, dae);
      }
    }
  }

  /**
   * If `ref` points to a member of an expandable connector that doesn't exist,
   * create a virtual variable using the type inferred from `otherRef`.
   */
  private tryAugmentExpandableRef(
    ref: ModelicaComponentReferenceSyntaxNode,
    otherRef: ModelicaComponentReferenceSyntaxNode,
    scopeClassId: SymbolId,
    dae: ArenaDAEBuilder,
  ): void {
    const parts = ref.parts;
    if (parts.length < 2) return;

    const rootName = parts[0]?.identifier?.text;
    if (!rootName) return;

    // Find the root component in the scope
    const scopeChildren = this.db.childrenOf(scopeClassId);
    let rootEntry: SymbolEntry | null = null;
    for (const child of scopeChildren) {
      if (child.kind === "Component" && child.name === rootName) {
        rootEntry = child;
        break;
      }
    }
    if (!rootEntry) return;

    // Resolve its type
    const rootClassId = this.db.query<SymbolId | null>("classInstance", rootEntry.id);
    if (!rootClassId) return;
    const rootClassEntry = this.db.symbol(rootClassId);
    if (!rootClassEntry) return;

    const rootMeta = rootClassEntry.metadata as Record<string, unknown>;
    if (rootMeta?.classKind !== "expandable connector" && !rootMeta?.isExpandable) {
      return;
    }

    // Check if the referenced member already exists
    const memberName = parts[1]?.identifier?.text;
    if (!memberName) return;
    const rootClassChildren = this.db.childrenOf(rootClassId);
    for (const child of rootClassChildren) {
      if (child.name === memberName) return; // Already exists
    }

    // Resolve the other side to determine the type
    const otherRootName = otherRef.parts[0]?.identifier?.text;
    if (!otherRootName) return;

    let otherTypeEntry: SymbolEntry | null = null;
    // Walk the other reference chain to find the leaf component's type
    let currentScopeId = scopeClassId;
    for (let i = 0; i < otherRef.parts.length; i++) {
      const partName = otherRef.parts[i]?.identifier?.text;
      if (!partName) break;

      const currentChildren = this.db.childrenOf(currentScopeId);
      let found = false;
      for (const child of currentChildren) {
        if (child.kind === "Component" && child.name === partName) {
          const childClassId = this.db.query<SymbolId | null>("classInstance", child.id);
          if (childClassId) {
            currentScopeId = childClassId;
            otherTypeEntry = this.db.symbol(childClassId);
          }
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (!otherTypeEntry) return;

    // Create a virtual variable for the missing expandable connector member
    const virtualName = `${rootName}.${memberName}`;
    const otherTypeName = otherTypeEntry.name;
    if (isPredefinedScalar(otherTypeName)) {
      let varType = VarType.Real;
      if (otherTypeName === "Integer") varType = VarType.Integer;
      else if (otherTypeName === "Boolean") varType = VarType.Boolean;
      else if (otherTypeName === "String") varType = VarType.String;
      dae.addVariable(virtualName, varType, Variability.Continuous, Causality.Local, 0.0, 0);
    } else {
      // Compound type — expand its elements under the virtual name
      const subElements = this.db.query<SymbolId[]>("instantiate", currentScopeId);
      if (subElements) {
        this.flattenElements(subElements, virtualName, dae);
      }
    }
  }

  // -------------------------------------------------------------------------
  // State Machine Expansion (§17)
  // -------------------------------------------------------------------------

  /**
   * Handle `assert(...)`, `terminate(...)`, `reinit(...)`, `initialState(...)`,
   * `transition(...)` and other special equations.
   * These are emitted as EqKind.FunctionCall so the printer produces
   * `assert(...);` rather than `assert(...) = 0;`.
   */
  private handleSpecialEquation(eq: ModelicaSpecialEquationSyntaxNode, prefix: string, dae: ArenaDAEBuilder): void {
    const callExpr = this.compileSpecialEquationExpr(eq, prefix, dae);
    if (callExpr !== undefined) {
      dae.addEquation(EqKind.FunctionCall, callExpr, 0);
    }
  }

  /**
   * Compile a special equation into a call expression ID.
   * Used both for top-level special equations and for when/for/if body entries.
   */
  private compileSpecialEquationExpr(
    eq: ModelicaSpecialEquationSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
    loopVars?: Map<string, number>,
  ): number | undefined {
    const funcRef = eq.functionReference;
    if (!funcRef) return undefined;
    const funcName = this.serializeRef(funcRef);
    if (!funcName) return undefined;

    // Collect arguments
    const visitor = this.createExprVisitor(dae, loopVars);
    const argIds: number[] = [];
    if (eq.functionCallArguments?.arguments) {
      for (const arg of eq.functionCallArguments.arguments) {
        const id = visitor.visit(arg.expression);
        if (id !== undefined) argIds.push(id);
      }
    }

    // Prefix component reference arguments
    const prefixedArgIds = argIds.map((argId) => {
      const kind = dae.getExprKind(argId);
      if (kind === ExprKind.Name && prefix) {
        const nameStr = dae.interner.resolve(dae.getExprData1(argId));
        return dae.addNameExpr(`${prefix}.${nameStr}`);
      }
      return argId;
    });

    return dae.addCallExpr(funcName, prefixedArgIds);
  }

  private resolveModAttribute(
    mod: ModelicaModArgs | null,
    attrName: string,
    typeName: string,
    dae: ArenaDAEBuilder,
    contextEntry?: SymbolEntry,
  ): unknown {
    if (mod) {
      const arg = mod.args.find((a) => a.name === attrName);
      if (arg?.value) {
        if (arg.value.kind === "literal") return arg.value.value;
        if (arg.value.kind === "expression") {
          const bytes = arg.value.cstBytes;
          // Use the text property directly if available (avoids CST tree lookup)
          if (arg.value.text) {
            const numVal = Number(arg.value.text);
            if (!isNaN(numVal)) return numVal;
            if (arg.value.text === "true") return true;
            if (arg.value.text === "false") return false;
          }
          const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], contextEntry);
          if (cstNode) {
            const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
            const visitor = this.createExprVisitor(dae);
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

  /**
   * Check if an equation entry's parent section is an `initial equation` section.
   * The `initial` keyword is a field on the EquationSection CST node.
   */
  private isInitialSection(entry: SymbolEntry): boolean {
    // Walk up to the parent to check if the section has the `initial` field
    if (entry.parentId !== null) {
      const parentEntry = this.db.symbol(entry.parentId);
      if (parentEntry) {
        const parentCst = this.db.cstNode(parentEntry.id) as any;
        if (parentCst) {
          // Check if the classSpecifier has any EquationSection with initial
          const classSpec = parentCst.childForFieldName?.("classSpecifier");
          if (classSpec) {
            for (const child of classSpec.children ?? []) {
              if (child.type === "EquationSection") {
                const hasInitial = child.childForFieldName?.("initial") !== null;
                // Check if this entry's byte range falls within this section
                if (hasInitial && entry.startByte >= child.startIndex && entry.endByte <= child.endIndex) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  }

  private flattenEquation(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
    const isInitial = this.isInitialSection(entry);
    const eqKind = isInitial ? EqKind.InitialSimple : EqKind.Simple;

    const cstNode = this.db.cstNodeRange(entry.startByte, entry.endByte, entry);
    if (cstNode) {
      const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
      // Depending on the equation type, the AST node will have different structure
      // For a simple equation, it usually has expression1 and expression2 or left/right
      const visitor = this.createExprVisitor(dae);
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
          dae.addEquation(eqKind, exprId, zero);
          return;
        }
      }

      if (lhsId !== undefined && rhsId !== undefined) {
        dae.addEquation(eqKind, lhsId, rhsId);
        return;
      }
    }

    // Fallback if parsing fails
    const lhs = dae.addExpression(ExprKind.IntLiteral, 0);
    const rhs = dae.addExpression(ExprKind.IntLiteral, 0);
    dae.addEquation(eqKind, lhs, rhs);
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

    const visitor = this.createExprVisitor(dae);
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
      const visitor = this.createExprVisitor(dae, loopVars);
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
    } else if (eqNode instanceof ModelicaSpecialEquationSyntaxNode) {
      // Handle assert, terminate, reinit, etc. inside for/if/when bodies
      const callExpr = this.compileSpecialEquationExpr(eqNode, prefix, dae, loopVars);
      if (callExpr !== undefined) {
        dae.addEquation(EqKind.FunctionCall, callExpr, 0);
      }
    } else {
      // Generic equation — try expression1/expression2 via duck typing
      const visitor = this.createExprVisitor(dae, loopVars);
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
      const visitor = this.createExprVisitor(dae, loopVars);
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
              const eifVisitor = this.createExprVisitor(dae, loopVars);
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

    const visitor = this.createExprVisitor(dae, loopVars);
    const condId = visitor.visit(whenEq.condition);
    if (condId === undefined) return;

    // Collect body equations into structured metadata
    const bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
    for (const eq of whenEq.equations) {
      if (eq instanceof ModelicaSpecialEquationSyntaxNode) {
        // Handle reinit, assert, terminate, etc. inside when body
        const callExpr = this.compileSpecialEquationExpr(eq, prefix, dae, loopVars);
        if (callExpr !== undefined) {
          bodyEquations.push({ kind: EqKind.FunctionCall, lhsExprId: callExpr, rhsExprId: 0 });
        }
      } else {
        const eqVisitor = this.createExprVisitor(dae, loopVars);
        const n = eq as any;
        if (n.expression1 && n.expression2) {
          const lhsId = eqVisitor.visit(n.expression1);
          const rhsId = eqVisitor.visit(n.expression2);
          if (lhsId !== undefined && rhsId !== undefined) {
            bodyEquations.push({ kind: EqKind.Simple, lhsExprId: lhsId, rhsExprId: rhsId });
          }
        }
      }
    }

    // Collect elsewhen clauses
    const elseWhenClauses: {
      conditionExprId: number;
      bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
    }[] = [];
    for (const elseWhen of whenEq.elseWhenEquationClauses) {
      if (!elseWhen.condition) continue;
      const ewVisitor = this.createExprVisitor(dae, loopVars);
      const ewCondId = ewVisitor.visit(elseWhen.condition);
      if (ewCondId === undefined) continue;

      const ewBody: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
      for (const eq of elseWhen.equations) {
        if (eq instanceof ModelicaSpecialEquationSyntaxNode) {
          // Handle reinit, assert, terminate, etc. inside elsewhen body
          const callExpr = this.compileSpecialEquationExpr(eq, prefix, dae, loopVars);
          if (callExpr !== undefined) {
            ewBody.push({ kind: EqKind.FunctionCall, lhsExprId: callExpr, rhsExprId: 0 });
          }
        } else {
          const eqVisitor = this.createExprVisitor(dae, loopVars);
          const n = eq as any;
          if (n.expression1 && n.expression2) {
            const lhsId = eqVisitor.visit(n.expression1);
            const rhsId = eqVisitor.visit(n.expression2);
            if (lhsId !== undefined && rhsId !== undefined) {
              ewBody.push({ kind: EqKind.Simple, lhsExprId: lhsId, rhsExprId: rhsId });
            }
          }
        }
      }
      elseWhenClauses.push({ conditionExprId: ewCondId, bodyEquations: ewBody });
    }

    // Use the compound addWhenEquation method for proper metadata storage
    dae.addWhenEquation(condId, bodyEquations, elseWhenClauses);
  }

  /**
   * Flatten an algorithm section into StmtKind entries in the arena.
   * Emits proper statement opcodes (Assignment, For, While, If, When, etc.)
   * and registers the section via addAlgorithmSection / addInitialAlgorithmSection.
   */
  private flattenAlgorithm(entry: SymbolEntry, prefix: string, dae: ArenaDAEBuilder): void {
    const cstNode = this.db.cstNodeRange(entry.startByte, entry.endByte, entry);
    if (!cstNode) return;

    // Detect whether this is an `initial algorithm` section
    const cst = cstNode as any;
    const isInitial = cst.childForFieldName?.("initial") !== null;

    // Parse AST statements
    const algoNode = ModelicaSyntaxNode.new(null, cst) as any;
    const stmtNodes: ModelicaStatementSyntaxNode[] = algoNode?.statements ?? [];

    const stmtStartIdx = dae.stmtCount;

    for (const stmt of stmtNodes) {
      this.flattenStatement(stmt, dae);
    }

    // Use top-level statement count (not total slot count including nested bodies)
    if (stmtNodes.length > 0) {
      if (isInitial) {
        dae.addInitialAlgorithmSection(stmtStartIdx, stmtNodes.length);
      } else {
        dae.addAlgorithmSection(stmtStartIdx, stmtNodes.length);
      }
    }
  }

  /**
   * Recursively flatten a single Modelica statement AST node into arena StmtKind entries.
   */
  private flattenStatement(stmt: ModelicaStatementSyntaxNode, dae: ArenaDAEBuilder): void {
    const startIdx = dae.stmtCount;
    this.flattenStatementInternal(stmt, dae);
    const endIdx = dae.stmtCount;
    if (stmt.sourceRange && startIdx < endIdx) {
      const loc = {
        startLine: stmt.sourceRange.startRow + 1,
        startCol: stmt.sourceRange.startCol + 1,
      };
      for (let idx = startIdx; idx < endIdx; idx++) {
        dae.stmtLocations.set(idx, loc);
      }
    }
  }

  private flattenStatementInternal(stmt: ModelicaStatementSyntaxNode, dae: ArenaDAEBuilder): void {
    if (stmt instanceof ModelicaSimpleAssignmentStatementSyntaxNode) {
      const visitor = this.createExprVisitor(dae);
      const lhsId = stmt.target ? visitor.visit(stmt.target) : undefined;
      const rhsId = stmt.source ? visitor.visit(stmt.source) : undefined;
      if (lhsId !== undefined && rhsId !== undefined) {
        dae.addAssignmentStmt(lhsId, rhsId);
      }
    } else if (stmt instanceof ModelicaForStatementSyntaxNode) {
      // For statement: for i in range loop ... end for;
      const forIndexes = stmt.forIndexes ?? [];
      if (forIndexes.length > 0) {
        const firstIdx = forIndexes[0]!;
        const indexName = firstIdx.identifier?.text ?? "";
        const indexNameId = dae.interner.intern(indexName);
        const visitor = this.createExprVisitor(dae);
        const rangeExprId = firstIdx.expression ? visitor.visit(firstIdx.expression) : undefined;
        const bodyStmts = stmt.statements ?? [];

        // Header first, then body (prefix layout)
        dae.addForStmt(indexNameId, rangeExprId ?? -1, bodyStmts.length);
        for (const inner of bodyStmts) {
          this.flattenStatement(inner, dae);
        }
      }
    } else if (stmt instanceof ModelicaWhileStatementSyntaxNode) {
      const visitor = this.createExprVisitor(dae);
      const condId = stmt.condition ? visitor.visit(stmt.condition) : undefined;
      const bodyStmts = stmt.statements ?? [];

      // Header first, then body (prefix layout)
      dae.addWhileStmt(condId ?? -1, bodyStmts.length);
      for (const inner of bodyStmts) {
        this.flattenStatement(inner, dae);
      }
    } else if (stmt instanceof ModelicaIfStatementSyntaxNode) {
      const visitor = this.createExprVisitor(dae);
      const condId = stmt.condition ? visitor.visit(stmt.condition) : undefined;

      // Pre-count body statements for the then-branch
      const thenStmts = stmt.statements ?? [];

      // Pre-count elseif + else branches
      const elseIfClauses = stmt.elseIfStatementClauses ?? [];
      const elseStmts = stmt.elseStatements ?? [];
      const branchCount = elseIfClauses.length + (elseStmts.length > 0 ? 1 : 0);

      // Emit header FIRST (printer expects prefix layout: header → body → branches)
      dae.addIfStmt(condId ?? -1, thenStmts.length, branchCount);

      // Then-branch body
      for (const inner of thenStmts) {
        this.flattenStatement(inner, dae);
      }

      // ElseIf branches: Block header → body for each
      for (const clause of elseIfClauses) {
        const eifVisitor = this.createExprVisitor(dae);
        const eifCondId = clause.condition ? eifVisitor.visit(clause.condition) : -1;
        const clauseStmts = clause.statements ?? [];
        dae.addBlockStmt(eifCondId ?? -1, clauseStmts.length);
        for (const inner of clauseStmts) {
          this.flattenStatement(inner, dae);
        }
      }

      // Else branch: Block(-1, count) → body
      if (elseStmts.length > 0) {
        dae.addBlockStmt(-1, elseStmts.length);
        for (const inner of elseStmts) {
          this.flattenStatement(inner, dae);
        }
      }
    } else if (stmt instanceof ModelicaWhenStatementSyntaxNode) {
      const visitor = this.createExprVisitor(dae);
      const condId = stmt.condition ? visitor.visit(stmt.condition) : undefined;
      const bodyStmts = stmt.statements ?? [];
      const elseWhenClauses = stmt.elseWhenStatementClauses ?? [];

      // Header first, then body, then elsewhen blocks (prefix layout)
      dae.addWhenStmt(condId ?? -1, bodyStmts.length, elseWhenClauses.length);
      for (const inner of bodyStmts) {
        this.flattenStatement(inner, dae);
      }

      for (const ew of elseWhenClauses) {
        const ewVisitor = this.createExprVisitor(dae);
        const ewCondId = ew.condition ? ewVisitor.visit(ew.condition) : -1;
        const ewStmts = ew.statements ?? [];
        dae.addBlockStmt(ewCondId ?? -1, ewStmts.length);
        for (const inner of ewStmts) {
          this.flattenStatement(inner, dae);
        }
      }
    } else if (stmt instanceof ModelicaReturnStatementSyntaxNode) {
      dae.addReturnStmt();
    } else if (stmt instanceof ModelicaBreakStatementSyntaxNode) {
      dae.addBreakStmt();
    } else if (stmt instanceof ModelicaProcedureCallStatementSyntaxNode) {
      // Procedure call: e.g., assert(...), terminate(...), Modelica.Utilities.Streams.print(...)
      const visitor = this.createExprVisitor(dae);
      // Build a function call expression from functionReference + arguments
      const funcRef = stmt.functionReference;
      if (funcRef) {
        const funcName = this.serializeRef(funcRef);
        if (funcName) {
          const argIds: number[] = [];
          if (stmt.functionCallArguments?.arguments) {
            for (const arg of stmt.functionCallArguments.arguments) {
              const id = visitor.visit(arg.expression);
              if (id !== undefined) argIds.push(id);
            }
          }
          const callExprId = dae.addCallExpr(funcName, argIds);
          dae.addProcedureCallStmt(callExprId);
        }
      }
    } else if (stmt instanceof ModelicaComplexAssignmentStatementSyntaxNode) {
      // Complex assignment: (a, b, ...) := func(args)
      const visitor = this.createExprVisitor(dae);
      const funcRef = stmt.functionReference;
      if (funcRef) {
        const funcName = this.serializeRef(funcRef);
        if (funcName) {
          const argIds: number[] = [];
          if (stmt.functionCallArguments?.arguments) {
            for (const arg of stmt.functionCallArguments.arguments) {
              const id = visitor.visit(arg.expression);
              if (id !== undefined) argIds.push(id);
            }
          }
          const callExprId = dae.addCallExpr(funcName, argIds);
          // Extract target expression IDs from the output list
          const targets: number[] = [];
          if (stmt.outputExpressionList?.outputs) {
            for (const expr of stmt.outputExpressionList.outputs) {
              if (expr) {
                const tid = visitor.visit(expr);
                if (tid !== undefined) targets.push(tid);
                else targets.push(-1); // placeholder for skipped outputs
              } else {
                targets.push(-1); // underscore/wildcard output
              }
            }
          }
          if (targets.length > 0) {
            dae.addComplexAssignmentStmt(targets, callExprId);
          }
        }
      }
    } else {
      // Fallback: try to handle via duck-typing for any other statement types
      const stmtAny = stmt as any;
      if (stmtAny.functionReference && stmtAny.functionCallArguments) {
        const visitor = this.createExprVisitor(dae);
        const funcCallExprId = visitor.visit(stmt);
        if (funcCallExprId !== undefined) {
          dae.addProcedureCallStmt(funcCallExprId);
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
    const resolvedPairs: [number, number][] = [];
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
            resolvedPairs.push([i, targetIdx]);
          }
        }
      }
    }

    // Generate inStream equations for stream variable pairs
    for (const [idxA, idxB] of resolvedPairs) {
      if (dae.getVarFlowPrefix(idxA) === "stream") {
        const nameA = dae.getVarName(idxA);
        const nameB = dae.getVarName(idxB);

        // inStream(A) = B
        const inStreamA = `$inStream(${nameA})`;
        dae.addVariable(inStreamA, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
        const inStreamAId = dae.addNameExpr(inStreamA);
        const exprBId = dae.addExpression(ExprKind.Name, dae.getVarNameId(idxB));
        dae.addEquation(EqKind.Simple, inStreamAId, exprBId);

        // inStream(B) = A
        const inStreamB = `$inStream(${nameB})`;
        dae.addVariable(inStreamB, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
        const inStreamBId = dae.addNameExpr(inStreamB);
        const exprAId = dae.addExpression(ExprKind.Name, dae.getVarNameId(idxA));
        dae.addEquation(EqKind.Simple, inStreamBId, exprAId);
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
      const isStream = dae.getVarFlowPrefix(root) === "stream";
      const isFlow = dae.isVarFlow(root) && !isStream;

      if (group.length <= 1) {
        if (isFlow) {
          // Unconnected flow variable: emit flow = 0
          const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[0]!));
          const zeroExpr = dae.addRealLiteral(0.0);
          dae.addEquation(EqKind.Simple, vExpr, zeroExpr);
        }
        continue;
      }

      if (isStream) {
        // Stream variables do not generate potential equality or flow sum equations here.
        // Their inStream equations were generated above.
        continue;
      }
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
          sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, vExpr);
        }
        const zeroExpr = dae.addRealLiteral(0.0);
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

  private createExprVisitor(dae: ArenaDAEBuilder, loopVars?: Map<string, number>): ArenaExprVisitor {
    return new ArenaExprVisitor(
      dae,
      loopVars,
      (funcName) => this.collectFunctionDefinition(funcName, dae),
      this.connectorCardinality,
      (funcName) => this.resolveFunctionInputs(funcName),
    );
  }

  /**
   * Extract experiment annotation (StartTime, StopTime, Tolerance, Interval)
   * from the root class CST node and populate dae.experiment.
   */
  private extractExperimentAnnotation(rootClassId: SymbolId, dae: ArenaDAEBuilder): void {
    const cstNode = this.db.cstNode(rootClassId) as any;
    if (!cstNode) return;

    // Navigate to the class specifier's annotation clause
    const classSpec = cstNode.childForFieldName?.("classSpecifier");
    if (!classSpec) return;

    const annClause = classSpec.childForFieldName?.("annotationClause");
    if (!annClause) return;

    const classMod = annClause.childForFieldName?.("classModification");
    if (!classMod) return;

    // Look for the "experiment" modification argument
    for (const arg of classMod.namedChildren ?? []) {
      const argName = arg.childForFieldName?.("name")?.text ?? arg.childForFieldName?.("identifier")?.text;
      if (argName !== "experiment") continue;

      // Extract sub-modifications (StartTime, StopTime, etc.)
      const subMod = arg.childForFieldName?.("modification")?.childForFieldName?.("classModification");
      if (!subMod) continue;

      for (const subArg of subMod.namedChildren ?? []) {
        const subName = subArg.childForFieldName?.("name")?.text ?? subArg.childForFieldName?.("identifier")?.text;
        if (!subName) continue;

        // Extract the value from the modification expression
        const exprNode =
          subArg.childForFieldName?.("modification")?.childForFieldName?.("expression") ??
          subArg.childForFieldName?.("expression");
        if (!exprNode) continue;

        const text = exprNode.text;
        if (!text) continue;

        const numVal = Number(text);
        if (isNaN(numVal)) continue;

        switch (subName) {
          case "StartTime":
            dae.experiment.startTime = numVal;
            break;
          case "StopTime":
            dae.experiment.stopTime = numVal;
            break;
          case "Tolerance":
            dae.experiment.tolerance = numVal;
            break;
          case "Interval":
            dae.experiment.interval = numVal;
            break;
          case "__modelscript_equidistantOutput":
            dae.experiment.__modelscript_equidistantOutput = text === "true";
            break;
        }
      }
    }
  }

  private collectingFunctions = new Set<string>();

  private collectFunctionDefinition(funcName: string, dae: ArenaDAEBuilder): void {
    if (
      !funcName.includes(".") &&
      [
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "atan2",
        "sinh",
        "cosh",
        "tanh",
        "exp",
        "log",
        "log10",
        "sqrt",
        "abs",
        "sign",
        "ceil",
        "floor",
        "integer",
        "max",
        "min",
        "mod",
        "rem",
        "div",
        "pow",
        "der",
        "pre",
        "noEvent",
        "String",
        "cardinality",
        "initialState",
        "transition",
        "sample",
        "delay",
        "edge",
        "change",
        "reinit",
        "smooth",
        "terminal",
        "assert",
        "terminate",
        "ndims",
        "size",
        "scalar",
        "vector",
        "matrix",
        "identity",
        "diagonal",
        "zeros",
        "ones",
        "fill",
        "linspace",
        "transpose",
        "cat",
        "sum",
        "product",
        "cross",
        "skew",
        "symmetric",
        "homotopy",
        "semiLinear",
        "inStream",
        "actualStream",
        "spatialDistribution",
        "getInstanceName",
        "outerProduct",
      ].includes(funcName)
    ) {
      return;
    }

    const funcNameId = dae.interner.intern(funcName);
    if (dae.functions.has(funcNameId) || this.collectingFunctions.has(funcName)) return;
    this.collectingFunctions.add(funcName);

    try {
      // Resolve the function name globally (or via fully qualified path).
      let resolvedId: number | null = null;

      // Attempt to resolve globally
      const resolvedEntries = this.db.byName(funcName);
      if (resolvedEntries.length > 0) {
        resolvedId = resolvedEntries[0].id;
      }

      if (!resolvedId) return; // Unresolved function

      const funcEntry = this.db.symbol(resolvedId);
      if (funcEntry?.kind !== "Class") return;

      // Verify it's actually a function
      const meta = funcEntry.metadata as any;
      if (meta?.classKind !== "function" && meta?.classKind !== "operator function") {
        return;
      }

      // Get the CST to extract metadata (description, external decl, impure)
      const cstNode = this.db.cstNode(resolvedId) as any;
      const classDef = cstNode ? ModelicaClassDefinitionSyntaxNode.new(null, cstNode) : null;
      const classSpecifier = classDef?.classSpecifier ?? null;

      // Skip external "builtin" functions — they are platform-provided
      if (classSpecifier instanceof ModelicaLongClassSpecifierSyntaxNode) {
        const ext = classSpecifier.externalFunctionClause;
        if (ext) {
          const lang = ext.languageSpecification?.language?.text ?? "";
          if (lang === "builtin") return;
        }
      }

      // Flatten the function into a new ArenaDAEBuilder
      const fnDae = new ArenaDAEBuilder();

      // Set function metadata
      fnDae.classKind = "function";
      fnDae.nameId = fnDae.interner.intern(funcName);
      if (classDef?.classPrefixes?.purity === "impure") {
        fnDae.isImpure = true;
      }

      // Extract description string from the class specifier
      const descStrings = classSpecifier?.description?.strings;
      if (descStrings && descStrings.length > 0) {
        const descText = descStrings.map((d: any) => d.text ?? "").join(" ");
        // Strip quotes from string literal
        const desc = descText.startsWith('"') && descText.endsWith('"') ? descText.slice(1, -1) : descText;
        if (desc) fnDae.descriptionId = fnDae.interner.intern(desc);
      }

      // Flatten function elements (inputs, outputs, protected vars)
      const elements = this.db.query<number[]>("instantiate", resolvedId);
      if (elements) {
        this.flattenElements(elements, "", fnDae);
      }

      // Flatten algorithm sections from the function body
      this.flattenClassSectionsRecursive(resolvedId, "", fnDae, new Set());

      // Handle external function clause
      if (classSpecifier instanceof ModelicaLongClassSpecifierSyntaxNode) {
        const ext = classSpecifier.externalFunctionClause;
        if (ext) {
          const lang = ext.languageSpecification?.language?.text ?? "";
          const call = ext.externalFunctionCall;
          let declText = "external";
          if (lang) declText += ` "${lang}"`;
          if (call) {
            const callName = call.functionName?.text ?? "";
            const argNames: string[] = [];
            for (const expr of call.arguments?.expressions ?? []) {
              // External function arguments are typically simple identifiers
              const exprAny = expr as any;
              argNames.push(exprAny.concreteSyntaxNode?.text ?? exprAny.text ?? "");
            }
            const returnVar = call.output?.parts?.map((p) => p.identifier?.text ?? "").join(".") ?? "";
            if (returnVar) {
              declText += ` ${returnVar} = ${callName}(${argNames.join(", ")})`;
            } else if (callName) {
              declText += ` ${callName}(${argNames.join(", ")})`;
            }
          } else {
            // No explicit external call — synthesize default: output = functionName(inputs...)
            const fnName = funcEntry.name;
            const inputNames: string[] = [];
            let outputName: string | null = null;
            for (let i = 0; i < fnDae.varCount; i++) {
              const causality = fnDae.getVarCausality(i);
              const varName = fnDae.getVarName(i);
              if (causality === Causality.Input) inputNames.push(varName);
              else if (causality === Causality.Output && !outputName) outputName = varName;
            }
            if (outputName) {
              declText += ` ${outputName} = ${fnName}(${inputNames.join(", ")})`;
            } else {
              declText += ` ${fnName}(${inputNames.join(", ")})`;
            }
          }
          declText += ";";
          fnDae.externalDecl = declText;
        }
      }

      dae.functions.set(funcNameId, fnDae);
    } finally {
      this.collectingFunctions.delete(funcName);
    }
  }
}
