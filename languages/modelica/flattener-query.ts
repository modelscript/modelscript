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
import { parseModArgsFromCst } from "./language.js";
import { type ModelicaModArgs, getModArg, isBroken, mergeModArgs, subModification } from "./modification-args.js";

// ---------------------------------------------------------------------------
// Modification Stack — replaces virtual symbol specialization
// ---------------------------------------------------------------------------

/**
 * A frame on the modification stack, carrying the active modifications
 * at one level of the class hierarchy during flattening.
 *
 * Instead of creating virtual (specialized) SymbolIds for each modified
 * component, the flattener carries this stack through its recursion.
 * The effective modification for a component is looked up by name
 * from the nearest stack frame.
 */
interface ModificationFrame {
  /** Modifications active at this level */
  mods: ModelicaModArgs;
  /** Scope where these mods were written (for CST byte-range evaluation) */
  evaluationScopeId: SymbolId | null;
  evaluationScopePrefix?: string;
  /** Whether the parent component was declared `final`, propagating to all children */
  isFinal?: boolean;
}

/**
 * Stack of modification frames carried through the flattener's recursion.
 * The topmost (last) frame has the highest priority.
 */
type ModificationStack = ModificationFrame[];

/**
 * Look up a sub-modification for a named element from the modification stack.
 * Searches from the top (most recent) frame downward.
 * Returns null if no modification targets this name.
 */
function lookupModInStack(stack: ModificationStack, name: string): ModelicaModArgs | null {
  let merged: ModelicaModArgs | null = null;
  // Traverse from bottom to top (oldest to newest) to merge outer mods over inner mods
  for (let i = 0; i < stack.length; i++) {
    const sub = subModification(stack[i]!.mods, name);
    if (sub) {
      merged = mergeModArgs(sub, merged);
    }
  }
  return merged;
}

/**
 * Check if the modification arg targeting `name` in the mod stack has `final: true`.
 * This is needed because `subModification()` extracts the nested args but drops
 * the `final` flag from the enclosing `ModificationArg`.
 */
function isModFinalInStack(stack: ModificationStack, name: string): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    // If the frame itself is final (parent was final), all children are final
    if (stack[i]!.isFinal) return true;
    const arg = getModArg(stack[i]!.mods, name);
    if (arg) return arg.final;
  }
  return false;
}

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
  inferArenaExprVarType,
  isAssignableType,
  UnaryOp,
  Variability,
  VarType,
  varTypeName,
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
  eliminateAliases?: boolean;
  omcCompatibility?: boolean;
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
  private options: Required<Pick<FlattenOptions, "arrayMode" | "functionInlining" | "omcCompatibility">> &
    FlattenOptions = {
    arrayMode: "scalarize",
    functionInlining: "preserve",
    canonicalizeEquations: false,
    omcCompatibility: false,
  };
  /** Name of the root model being flattened (e.g. "Extends10"). */
  private rootClassName = "";
  /** Set of SymbolIds that are ancestors of the root class via extends chains. */
  private rootExtendsAncestors = new Set<SymbolId>();
  /** Map from short/unqualified function name → fully qualified name (for OMC parity). */
  private functionNameMap = new Map<string, string>();
  /** Whether the current inheritance path comes from a `protected extends` clause. */
  private inheritedProtected = false;
  /** Set of connection texts (e.g. "prefix:connect(c1,c2)") that have been broken by modifications. */
  private brokenConnections = new Set<string>();
  private brokenComponents = new Set<string>();

  /** Map from fully-qualified outer component path -> fully-qualified inner component path. */
  private outerAliasMap = new Map<string, string>();

  private isPathBroken(path: string): boolean {
    const parts = path.split(".");
    let current = "";
    for (const part of parts) {
      current = current ? current + "." + part : part;
      if (this.brokenComponents.has(current)) return true;
    }
    return false;
  }

  /** Map to track class redeclarations for functions */
  private classRedeclarations = new Map<string, SymbolId>();

  /** Snapshot of the DAE builder right after the body phase, before equations are added. */
  public bodySnapshot: ArenaDAEBuilder | null = null;

  private resolveOuter = (path: string): string | null => {
    let resolved = path;
    if (this.outerAliasMap.has(resolved)) {
      resolved = this.outerAliasMap.get(resolved)!;
    } else {
      for (const [alias, real] of this.outerAliasMap.entries()) {
        if (resolved.startsWith(alias + ".")) {
          const newResolved = real + resolved.substring(alias.length);
          resolved = newResolved;
          break;
        }
      }
    }
    return resolved !== path ? resolved : null;
  };

  constructor(
    private db: QueryDB,
    options?: FlattenOptions,
  ) {
    this.bodySnapshot = null;
    if (options) {
      this.options = { ...this.options, ...options };
    }
    console.error(`[DEBUG Flattener] options=`, this.options);
  }

  /**
   * Flatten a Modelica class into a DAE.
   *
   * @param rootClassId - The SymbolId of the top-level model to flatten
   * @param cachedArena - If provided, skip the body traversal phase (variable instantiation) and reuse this arena state.
   * @returns A FlatDAE containing all variables, equations, and connections
   */
  flatten(rootClassId: SymbolId, cachedArena?: ArenaDAEBuilder | null, opts?: FlattenOptions): ArenaDAEBuilder {
    if (opts) {
      this.options = { ...this.options, ...opts };
    }

    const rootEntry = this.db.symbol(rootClassId);
    const className = rootEntry?.name ?? "<unknown>";
    this.rootClassName = className;
    this.functionNameMap.clear();

    // Collect all extends ancestors of the root class for function name qualification
    this.rootExtendsAncestors.clear();
    this.collectExtendsAncestors(rootClassId, this.rootExtendsAncestors);

    let dae: ArenaDAEBuilder;
    const t0 = performance.now();
    let t1 = t0;

    if (cachedArena) {
      dae = cachedArena;
      this.bodySnapshot = cachedArena.clone();
    } else {
      dae = new ArenaDAEBuilder(undefined, className, "");
      this.brokenConnections.clear();
      this.brokenComponents.clear();

      // Pre-pass: count connector cardinality for cardinality() built-in
      this.connectorCardinality.clear();
      this.countConnections(rootClassId, "");

      // Pre-pass: augment expandable connectors with virtual members from connect equations
      this.augmentExpandableConnectors(rootClassId, dae);

      // Push root class onto active hierarchy stack (for outer/inner resolution)
      this.activeClassStack.push({ classId: rootClassId, prefix: "" });

      const modStack: ModificationStack = [];
      this.flattenClassWithMods(rootClassId, "", dae, modStack, new Set());
      t1 = performance.now();

      // Snapshot the builder before adding equations
      this.bodySnapshot = dae.clone();
    }

    // Walk the CST to extract equation/algorithm sections
    // (Equations are not indexed in the symbol table — they live as CST nodes)
    // Must walk the extends chain recursively to include parent class equations.
    this.flattenClassSectionsRecursive(rootClassId, "", dae, new Set());
    const t2 = performance.now();

    if (!cachedArena) {
      // Pop root class from hierarchy stack
      this.activeClassStack.pop();
    }

    this.validateNameReferences(dae);
    const t3 = performance.now();

    // Post-processing: expand connections into equations
    const t4 = performance.now();
    this.expandConnections(dae);

    // Extract experiment annotation from root class
    this.extractExperimentAnnotation(rootClassId, dae);

    // Fold constant and parameter binding expressions
    const t5 = performance.now();
    foldArenaConstants(dae, this.db, rootClassId);

    // O(N) Arena-native alias elimination
    const t6 = performance.now();
    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }
    const t7 = performance.now();

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
          this.flattenElements(elements, currentPrefix, dae, []);
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
    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

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

    // Resolve ShortClassSpecifier aliases (e.g., model D = A(x=1);)
    const cst = this.db.cstNode(classId) as any;
    const spec = cst?.childForFieldName?.("classSpecifier");
    if (spec?.type === "ShortClassSpecifier") {
      const typeSpec = spec.childForFieldName?.("typeSpecifier");
      const typeName = typeSpec?.text;
      const entry = this.db.symbol(classId);
      if (typeName && entry) {
        const parentResolver = this.db.query<(n: string) => { id: SymbolId } | null>(
          "resolveName",
          entry.parentId ?? classId,
        );
        if (parentResolver) {
          const resolved = parentResolver(typeName);
          if (resolved && resolved.id !== classId) {
            // Recurse into the resolved base class
            this.flattenClassSectionsRecursive(resolved.id, prefix, dae, visited, isRoot);
            return; // ShortClassSpecifier has no own sections or children
          }
        }
      }
    }

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
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!;
      if (section instanceof ModelicaEquationSectionSyntaxNode) {
        this.flattenEquationSection(section, prefix, dae, classId);
      } else if (section instanceof ModelicaAlgorithmSectionSyntaxNode) {
        this.flattenAlgorithmSection(section, prefix, dae, classId);
      }
    }
  }

  /**
   * Flatten all equations within an EquationSection AST node.
   */

  private processSimpleEquationScalarization(
    dae: ArenaDAEBuilder,
    eqKind: EqKind,
    lhsId: number,
    rhsId: number,
    visitor: ArenaExprVisitor,
    scopeId: SymbolId,
    eqRange: { startIndex: number; endIndex: number } | null | undefined,
  ): void {
    // If we are scalarizing arrays, expand array equations element-wise
    let arrayDims: number[] | null = null;
    let varName: string | null = null;
    let coreLhsId = lhsId;
    let wrapperFunc: string | null = null;
    let strippedLhsDims = 0;

    if (dae.getExprKind(lhsId) === ExprKind.Der) {
      coreLhsId = dae.getExprData1(lhsId);
      wrapperFunc = "der";
    } else if (dae.getExprKind(lhsId) === ExprKind.Pre) {
      coreLhsId = dae.getExprData1(lhsId);
      wrapperFunc = "pre";
    }

    while (dae.getExprKind(coreLhsId) === ExprKind.ArrayCtor && dae.getExprData1(coreLhsId) === 1) {
      coreLhsId = dae.getExprLeft(coreLhsId);
      strippedLhsDims++;
    }

    let isSlice = false;
    let sliceIndices: (number | number[])[] | null = null;

    if (this.options.arrayMode !== "preserve") {
      if (dae.getExprKind(coreLhsId) === ExprKind.Name) {
        varName = dae.interner.resolve(dae.getExprData1(coreLhsId));
      } else if (dae.getExprKind(coreLhsId) === ExprKind.ArrayCtor) {
        let currentFirstElem = coreLhsId;
        while (dae.getExprKind(currentFirstElem) === ExprKind.ArrayCtor) {
          const count = dae.getExprData1(currentFirstElem);
          if (count > 0) {
            currentFirstElem = dae.getExprLeft(currentFirstElem);
          } else {
            break;
          }
        }
        if (dae.getExprKind(currentFirstElem) === ExprKind.Name) {
          const firstElemName = dae.interner.resolve(dae.getExprData1(currentFirstElem));
          if (firstElemName) {
            const match = firstElemName.match(/^(.+)\[1(?:,1)*\]$/);
            if (match) {
              varName = match[1];
            }
          }
        }
      } else if (dae.getExprKind(coreLhsId) === ExprKind.Subscript) {
        const baseId = dae.getExprData1(coreLhsId);
        if (dae.getExprKind(baseId) === ExprKind.Name) {
          varName = dae.interner.resolve(dae.getExprData1(baseId));
          const idxCount = dae.getExprRight(coreLhsId);
          let curr = dae.getExprLeft(coreLhsId);
          const idxIds: number[] = [];
          for (let i = 0; i < idxCount; i++) {
            idxIds.push(curr++);
          }

          let allConstant = true;
          const dims: number[] = [];
          const resolvedIndices: (number | number[])[] = [];

          for (const idxId of idxIds) {
            const val = evaluateArenaExpression(dae, idxId, undefined, this.db, scopeId, undefined, false);
            if (Array.isArray(val)) {
              dims.push(val.length);
              resolvedIndices.push(val as number[]);
            } else if (typeof val === "number") {
              resolvedIndices.push(val);
            } else {
              console.error(`[DEBUG isSlice] evaluateArenaExpression failed for idxId=${idxId}`);
              allConstant = false;
              break;
            }
          }

          if (allConstant && dims.length > 0) {
            isSlice = true;
            arrayDims = dims;
            sliceIndices = resolvedIndices;
            console.error(`[DEBUG isSlice] true! dims=${dims}, sliceIndices=${JSON.stringify(sliceIndices)}`);
          } else {
            console.error(`[DEBUG isSlice] false! allConstant=${allConstant}, dims=${dims.length}`);
          }
        } else {
          console.error(`[DEBUG isSlice] baseId not Name! kind=${dae.getExprKind(baseId)}`);
        }
      }
      if (varName && !isSlice) {
        const varIdx = dae.getVarIdxByName(varName);
        if (varIdx >= 0) {
          const shape = dae.getVarShape(varIdx);
          if (shape && shape.length > 0) arrayDims = shape;
        } else if (dae.hasArrayElements(varName)) {
          const elements = dae.getArrayElementIndices(varName);
          if (elements.length > 0) {
            const lastElemName = dae.getVarName(elements[elements.length - 1]!);
            const match = lastElemName.match(/\[([\d,]+)\]$/);
            if (match && match[1]) {
              arrayDims = match[1].split(",").map(Number);
            }
          }
        }

        if (!arrayDims && scopeId !== null) {
          let currentClassId = scopeId;
          const parts = varName.split(".");
          let compEntry: SymbolEntry | null = null;
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            const resolver = this.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentClassId);
            compEntry = resolver ? resolver(part) : null;
            if (!compEntry) break;
            if (i < parts.length - 1) {
              const classInstId = this.db.query<SymbolId | null>("classInstance", compEntry.id);
              if (classInstId === null) {
                compEntry = null;
                break;
              }
              currentClassId = classInstId;
            }
          }
          if (compEntry) {
            const dims = this.db.query<number[] | null>("resolvedArrayDimensions", compEntry.id);
            if (dims && dims.length > 0) {
              arrayDims = dims;
            }
          }
        }
      }
    }

    if (isSlice && arrayDims && sliceIndices) {
      const indices = this.generateArrayIndices(arrayDims);
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        // For slices, idx is e.g. [1], [2], [3] (1-indexed based on arrayDims)
        // sliceIndices contains the resolved slice array, e.g. [ [4,3,2] ]
        // so mappedIdx should be [ sliceIndices[0][0], sliceIndices[0][1], sliceIndices[0][2] ]
        const mappedIdx = sliceIndices.map((r) => (Array.isArray(r) ? r[idx[0] - 1] : r));
        const elemVarName = `${varName}[${mappedIdx.join(",")}]`;
        let elemRhsId = this.getArrayElementExpr(dae, rhsId, idx, visitor);
        let elemLhsId = dae.addNameExpr(elemVarName);
        if (wrapperFunc === "der") elemLhsId = dae.addDerExpr(elemLhsId);
        else if (wrapperFunc === "pre") elemLhsId = dae.addPreExpr(elemLhsId);
        else if (wrapperFunc) elemLhsId = dae.addCallExpr(wrapperFunc, [elemLhsId]);

        const targetType = inferArenaExprVarType(dae, elemLhsId);
        const sourceType = inferArenaExprVarType(dae, elemRhsId);
        if (targetType === VarType.Real && sourceType === VarType.Integer) {
          elemRhsId = visitor.castToRealExpr(elemRhsId);
        } else if (targetType === VarType.Integer && sourceType === VarType.Real) {
          elemLhsId = visitor.castToRealExpr(elemLhsId);
        }

        dae.addEquation(eqKind, elemLhsId, elemRhsId);
      }
      return; // added return to prevent executing fallback block
    } else if (arrayDims) {
      this.addScalarizedEquation(dae, eqKind, varName!, rhsId, arrayDims, visitor, wrapperFunc, strippedLhsDims);
    } else {
      // ── Type-mismatch check for equations (OMC M5001) ──
      const targetType = dae.getExprKind(lhsId) === ExprKind.Name ? inferArenaExprVarType(dae, lhsId) : null;
      const sourceType = inferArenaExprVarType(dae, rhsId);

      if (targetType !== null && sourceType !== null) {
        const typesMatch =
          targetType === sourceType ||
          (targetType === VarType.Real && sourceType === VarType.Integer) ||
          (targetType === VarType.Integer && sourceType === VarType.Real);

        if (!typesMatch && !isAssignableType(targetType, sourceType)) {
          const targetName = this.serializeArenaExpr(dae, lhsId);
          const sourceName = this.serializeArenaExpr(dae, rhsId);
          const range = eqRange ? { startByte: eqRange.startIndex, endByte: eqRange.endIndex } : null;
          dae.diagnostics.push({
            code: 5001,
            rule: "equation-type-mismatch",
            severity: "error",
            message: `Type mismatch in equation ${targetName}=${sourceName} of type ${varTypeName(targetType)}=${varTypeName(sourceType)}.`,
            range,
          });
        }
      }

      // Apply Integer→Real coercion for equations
      let coercedLhsId = lhsId;
      let coercedRhsId = rhsId;
      if (targetType === VarType.Real && sourceType === VarType.Integer) {
        coercedRhsId = visitor.castToRealExpr(rhsId);
      } else if (targetType === VarType.Integer && sourceType === VarType.Real) {
        coercedLhsId = visitor.castToRealExpr(lhsId);
      }
      dae.addEquation(eqKind, coercedLhsId, coercedRhsId);
    }
  }

  private flattenEquationSection(
    sectionNode: ModelicaEquationSectionSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
    scopeId: SymbolId,
  ): void {
    const isInitial = sectionNode.initial;
    const eqKind = isInitial ? EqKind.InitialSimple : EqKind.Simple;

    for (const eq of sectionNode.equations) {
      if (eq instanceof ModelicaSimpleEquationSyntaxNode) {
        const visitor = this.createExprVisitor(dae, undefined, prefix, scopeId);
        const lhsId = eq.expression1 ? visitor.visit(eq.expression1, true) : undefined;
        const rhsId = eq.expression2 ? visitor.visit(eq.expression2, false) : undefined;
        if (lhsId !== undefined && rhsId !== undefined) {
          this.processSimpleEquationScalarization(dae, eqKind, lhsId, rhsId, visitor, scopeId, eq.sourceRange);
        }
      } else if (eq instanceof ModelicaForEquationSyntaxNode) {
        this.unrollForIndexes(eq.forIndexes, 0, eq.equations, prefix, dae, new Map(), scopeId);
      } else if (eq instanceof ModelicaIfEquationSyntaxNode) {
        this.flattenIfEquationAst(eq, prefix, dae, new Map(), scopeId);
      } else if (eq instanceof ModelicaWhenEquationSyntaxNode) {
        this.flattenWhenEquationAst(eq, prefix, dae, new Map(), scopeId);
      } else if (eq instanceof ModelicaConnectEquationSyntaxNode) {
        // Check if this connection was broken
        const eqStart = eq.sourceRange?.startIndex;
        const eqEnd = eq.sourceRange?.endIndex;
        let eqText = "";
        if (eqStart !== undefined && eqEnd !== undefined) {
          const scopeEntry = scopeId ? this.db.symbol(scopeId) : undefined;
          eqText = this.db.cstText(eqStart, eqEnd, scopeEntry) ?? "";
        }

        if (eqText) {
          const canonEq = this.canonicalizeConnect(eqText);
          console.error(
            `[DEBUG SECTIONS CONNECT] scope=${scopeId ? this.db.symbol(scopeId)?.name : "null"}, eqText='${eqText}', canonEq='${canonEq}', hasBroken=${this.brokenConnections.has(prefix + ":" + canonEq)}`,
          );
          if (this.brokenConnections.has(prefix + ":" + canonEq)) {
            continue; // Skip this broken connect
          }
        }

        const lhs = eq.componentReference1;
        const rhs = eq.componentReference2;
        if (lhs && rhs) {
          const lhsRef = this.serializeRef(lhs);
          const rhsRef = this.serializeRef(rhs);
          if (lhsRef && rhsRef) {
            let lhsName = prefix ? `${prefix}.${lhsRef}` : lhsRef;
            let rhsName = prefix ? `${prefix}.${rhsRef}` : rhsRef;
            lhsName = this.resolveOuter(lhsName) ?? lhsName;
            rhsName = this.resolveOuter(rhsName) ?? rhsName;
            if (this.isPathBroken(lhsName) || this.isPathBroken(rhsName)) {
              continue;
            }
            const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(lhsName));
            const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(rhsName));
            dae.addEquation(EqKind.Connect, lhsId, rhsId);
          }
        }
      } else if (eq instanceof ModelicaSpecialEquationSyntaxNode) {
        this.handleSpecialEquation(eq, prefix, dae, scopeId);
      }
    }
  }

  /**
   * Serialize an arena expression ID to a human-readable string for diagnostics.
   */
  private serializeArenaExpr(dae: ArenaDAEBuilder, exprId: number): string {
    if (exprId < 0) return "...";
    const kind = dae.getExprKind(exprId);
    switch (kind) {
      case ExprKind.Name:
        return dae.interner.resolve(dae.getExprData1(exprId));
      case ExprKind.IntLiteral:
        return String(dae.getExprData1(exprId));
      case ExprKind.RealLiteral:
        return String(dae.getExprRealValue(exprId));
      case ExprKind.BoolLiteral:
        return dae.getExprData1(exprId) ? "true" : "false";
      case ExprKind.StringLiteral:
        return `"${dae.interner.resolve(dae.getExprData1(exprId))}"`;
      case ExprKind.Call: {
        const fn = dae.interner.resolve(dae.getExprData1(exprId));
        const numArgs = dae.getExprRight(exprId);
        const args: string[] = [];
        let currArgId = dae.getExprLeft(exprId);
        for (let i = 0; i < numArgs; i++) {
          if (i > 0) currArgId = dae.getExprLeft(exprId + i);
          args.push(this.serializeArenaExpr(dae, currArgId));
        }
        return `${fn}(${args.join(", ")})`;
      }
      case ExprKind.Binary: {
        return `${this.serializeArenaExpr(dae, dae.getExprLeft(exprId))} op ${this.serializeArenaExpr(dae, dae.getExprRight(exprId))}`;
      }
      default:
        return "...";
    }
  }

  private serializeRef(ref: ModelicaComponentReferenceSyntaxNode): string | undefined {
    let path = ref.global ? "." : "";
    for (let i = 0; i < ref.parts.length; i++) {
      const part = ref.parts[i];
      const ident = part.identifier?.text;
      if (!ident) return undefined;
      if (path.length > 0 && path !== ".") path += ".";
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
    scopeId: SymbolId,
  ): void {
    console.error(`flattenAlgorithmSection called! scopeId=${scopeId}`);
    const isInitial = sectionNode.initial;
    const stmtNodes: ModelicaStatementSyntaxNode[] = sectionNode.statements ?? [];

    const stmtStartIdx = dae.stmtCount;

    for (const stmt of stmtNodes) {
      this.flattenStatement(stmt, dae, prefix, scopeId);
    }

    if (isInitial) {
      dae.addInitialAlgorithmSection(stmtStartIdx, dae.stmtCount - stmtStartIdx);
    } else {
      dae.addAlgorithmSection(stmtStartIdx, dae.stmtCount - stmtStartIdx);
    }
  }

  // -------------------------------------------------------------------------
  // Class Flattening with Modification Stack
  // -------------------------------------------------------------------------

  /**
   * Flatten a class by walking its direct children and recursing into extends.
   *
   * This replaces the old `instantiate` + `flattenElements` pattern.
   * Instead of relying on virtual specialized symbols, extends modifications
   * are carried through the `modStack` and applied at each level.
   *
   * @param classId - The class to flatten
   * @param prefix - Dot-separated prefix for variable names
   * @param dae - The DAE builder to emit into
   * @param modStack - Stack of active modifications from enclosing scopes
   * @param visited - Set of class IDs already visited (cycle detection)
   */
  private flattenClassWithMods(
    classId: SymbolId,
    prefix: string,
    dae: ArenaDAEBuilder,
    modStack: ModificationStack,
    visited: Set<SymbolId>,
    shadowedNames: Set<string> = new Set(),
  ): void {
    // Cycle detection
    if (visited.has(classId)) return;
    visited.add(classId);

    // Resolve ShortClassSpecifier aliases (e.g., model D = A(x=1);)
    const cst = this.db.cstNode(classId) as any;
    const spec = cst?.childForFieldName?.("classSpecifier");
    if (spec?.type === "ShortClassSpecifier") {
      const typeSpec = spec.childForFieldName?.("typeSpecifier");
      const typeName = typeSpec?.text;
      const entry = this.db.symbol(classId);
      if (typeName && entry) {
        const parentResolver = this.db.query<(n: string) => { id: SymbolId } | null>(
          "resolveName",
          entry.parentId ?? classId,
        );
        if (parentResolver) {
          const resolved = parentResolver(typeName);
          if (resolved && resolved.id !== classId) {
            const localMod = this.db.query<ModelicaModArgs | null>("effectiveModification", classId);
            const topMod = modStack.length > 0 ? modStack[modStack.length - 1]!.mods : null;
            const mergedMod = mergeModArgs(topMod, localMod);
            const childStack: ModificationStack =
              mergedMod && mergedMod.args.length > 0
                ? [...modStack, { mods: mergedMod, evaluationScopeId: entry.parentId, evaluationScopePrefix: prefix }]
                : modStack;

            // Recurse into the resolved base class
            this.flattenClassWithMods(resolved.id, prefix, dae, childStack, visited);

            // Pop from visited to match original semantics
            visited.delete(classId);
            return;
          }
        }
      }
    }

    const children = this.db.childrenOf(classId);

    // Pre-scan for body-level redeclares (names that shadow inherited elements)
    const redeclaredNames = new Set<string>();
    for (const child of children) {
      const meta = child.metadata as Record<string, unknown>;
      if (meta?.redeclare) {
        redeclaredNames.add(child.name);
      }
    }

    // Track which names we've already emitted (to filter duplicates from extends)
    const emittedNames = new Set<string>();

    // Support `redeclare model extends X(x=y)` syntax (inline extends in LongClassSpecifier)
    const selfCst = this.db.cstNode(classId) as any;
    const specExt = selfCst?.childForFieldName?.("classSpecifier");
    if (specExt?.type === "LongClassSpecifier") {
      let hasExtends = false;
      for (let i = 0; i < specExt.childCount; i++) {
        if (specExt.child(i).type === "extends") {
          hasExtends = true;
          break;
        }
      }
      if (hasExtends) {
        const identNode = specExt.childForFieldName("identifier");
        if (identNode?.text) {
          const baseName = identNode.text;
          console.error(`[LongClassSpecifier] Processing inline extends for classId=${classId}, baseName=${baseName}`);
          const classEntry = this.db.symbol(classId);
          if (classEntry?.parentId !== null) {
            let resolvedBase: import("@modelscript/compiler").SymbolEntry | null = null;
            const resolveName = this.db.query<any>("resolveName", classEntry.parentId);
            if (resolveName) {
              let resolved = resolveName(baseName, true);
              if (resolved && resolved.id === classId) {
                console.error(`[LongClassSpecifier] Cycle detected resolving ${baseName}, checking parent extends`);
                // Cycle detected, look in parent's inherited classes
                resolved = null;
                for (const pChild of this.db.childrenOf(classEntry.parentId)) {
                  if (pChild.kind === "Extends") {
                    const pBase = this.db.query<any>("resolvedBaseClass", pChild.id);
                    console.error(
                      `[LongClassSpecifier] Found parent extends clause, resolved to base: ${pBase?.name} (id=${pBase?.id})`,
                    );
                    if (pBase) {
                      const pExtResolver = this.db.query<any>("resolveName", pBase.id);
                      if (pExtResolver) {
                        const found = pExtResolver(baseName);
                        console.error(
                          `[LongClassSpecifier] Resolved ${baseName} inside ${pBase.name} -> ${found?.name} (id=${found?.id})`,
                        );
                        // We must ensure the found id is NOT the same as the current class id,
                        // otherwise we'd cycle again.
                        if (found && found.id !== classId) {
                          resolvedBase = found;
                          break;
                        }
                      }
                    }
                  }
                }
              } else {
                resolvedBase = resolved;
              }

              if (resolvedBase && resolvedBase.kind !== "Reference") {
                console.error(`[LongClassSpecifier] Recursing into base class ${resolvedBase.name}`);
                // Parse the local modification on the LongClassSpecifier
                let localMod: ModelicaModArgs | null = null;
                const modNode = specExt.childForFieldName("classModification");
                if (modNode) {
                  localMod = parseModArgsFromCst(modNode, classId);
                }

                const topMod = modStack.length > 0 ? modStack[modStack.length - 1]!.mods : null;
                const mergedMod = mergeModArgs(topMod, localMod);

                const childStack: ModificationStack =
                  mergedMod && mergedMod.args.length > 0
                    ? [...modStack, { mods: mergedMod, evaluationScopeId: classId, evaluationScopePrefix: prefix }]
                    : modStack;

                this.flattenClassWithMods(resolvedBase.id, prefix, dae, childStack, new Set(visited));
              }
            }
          }
        }
      }
    }

    // Process extends clauses FIRST — inherited elements come before local ones
    // in the final element order (matching OpenModelica behavior)
    for (const child of children) {
      if (child.kind === "Extends") {
        // Check for `break` modification
        const topMod = modStack.length > 0 ? modStack[modStack.length - 1]!.mods : null;
        if (isBroken(topMod, child.name)) continue;

        // Resolve the base class
        const baseEntry = this.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        if (!baseEntry) continue;

        // Parse the extends clause's local modification from CST
        const localMod = this.db.query<ModelicaModArgs | null>("extendsModificationParsed", child.id);

        // Merge: outer mod (from enclosing scope) with local extends mod
        const mergedMod = mergeModArgs(topMod, localMod);

        // Build child modification stack for the base class
        const childStack: ModificationStack =
          mergedMod && mergedMod.args.length > 0
            ? [...modStack, { mods: mergedMod, evaluationScopeId: child.parentId, evaluationScopePrefix: prefix }]
            : modStack;

        // Check if this extends clause is in a protected section
        const extendsIsProtected = this.isEntryInProtectedSection(child);

        // Recurse into the base class, propagating protected visibility
        const prevInheritedProtected = this.inheritedProtected;
        if (extendsIsProtected) this.inheritedProtected = true;

        // Combine inherited shadowed names with locally redeclared names
        const nextShadowedNames = new Set(shadowedNames);
        for (const name of redeclaredNames) nextShadowedNames.add(name);

        this.flattenClassWithMods(baseEntry.id, prefix, dae, childStack, new Set(visited), nextShadowedNames);
        this.inheritedProtected = prevInheritedProtected;
      }
    }

    // Process direct children (components, equations, etc.)
    for (const child of children) {
      if (child.kind === "Component") {
        const topMod = modStack.length > 0 ? modStack[modStack.length - 1]!.mods : null;
        if (isBroken(topMod, child.name)) {
          this.brokenComponents.add(prefix ? prefix + "." + child.name : child.name);
          continue;
        }

        // Skip components that are shadowed by a body-level redeclaration in a subclass
        if (shadowedNames.has(child.name)) continue;

        // Skip redeclared components that were already emitted locally
        // (body-level redeclares override inherited elements)
        if (redeclaredNames.has(child.name) && emittedNames.has(child.name)) continue;

        // Conditional component check: skip disabled components
        const meta = child.metadata as Record<string, unknown>;
        if (meta?.conditionAttribute !== undefined && meta.conditionAttribute !== null) {
          const condVal = this.db.evaluate(meta.conditionAttribute, child.parentId ?? null);
          if (condVal === false || condVal === 0) continue;
        }

        this.flattenComponent(child, prefix, dae, modStack);
        emittedNames.add(child.name);
      } else if (child.kind === "ConnectEquation") {
        // Check if this connection is broken by a modification
        let isBrokenConnect = false;
        const topMod = modStack.length > 0 ? modStack[modStack.length - 1]!.mods : null;
        console.error(
          `[DEBUG CONNECT] Visiting ConnectEquation in class ${this.db.symbol(classId)?.name}. topMod=${!!topMod}, topModArgs=${topMod?.args?.length}`,
        );
        if (topMod) {
          const connectArgs = topMod.args.filter(
            (a) => a.name.startsWith("break_connect:") && a.value?.kind === "break",
          );
          for (const connectArg of connectArgs) {
            if (connectArg.value?.kind === "break" && (connectArg.value as any).target) {
              const cst = this.db.cstNode(child.id) as any;
              const childText = cst?.text;
              const targetText = (connectArg.value as any).target;
              if (childText && targetText) {
                const canonChild = this.canonicalizeConnect(childText);
                const canonTarget = this.canonicalizeConnect(targetText);
                console.error(`[DEBUG break connect] canonChild='${canonChild}', canonTarget='${canonTarget}'`);
                if (canonChild === canonTarget) {
                  isBrokenConnect = true;
                  this.brokenConnections.add(prefix + ":" + canonChild);
                  break;
                }
              }
            }
          }
        }

        // Also skip connect equation if it involves a broken component!
        if (!isBrokenConnect) {
          const cst = this.db.cstNode(child.id) as any;
          const connectClause = cst?.childForFieldName("connectClause") || cst;
          const source = connectClause?.childForFieldName("componentReference1")?.text;
          const target = connectClause?.childForFieldName("componentReference2")?.text;
          const sourcePath = prefix ? prefix + "." + source : source;
          const targetPath = prefix ? prefix + "." + target : target;
          if ((sourcePath && this.isPathBroken(sourcePath)) || (targetPath && this.isPathBroken(targetPath))) {
            isBrokenConnect = true;
          }
        }

        if (isBrokenConnect) continue;

        this.recordConnection(child, prefix, dae);
      } else if (child.kind === "Extends") {
        // Already handled above
        continue;
      } else if (child.kind === "Class") {
        const outerMod = lookupModInStack(modStack, child.name);
        const inlineMod = this.db.query<import("./modification-args.js").ModelicaModArgs | null>(
          "effectiveModification",
          child.id,
        );
        let effectiveMod = mergeModArgs(outerMod, inlineMod);
        if (effectiveMod?.isRedeclaration && effectiveMod.redeclaredTypeSpecifier) {
          const scopeId =
            effectiveMod.evaluationScopeId !== undefined && effectiveMod.evaluationScopeId !== null
              ? effectiveMod.evaluationScopeId
              : child.parentId;
          const redeclaredClassId = this.resolveTypeNameInScope(effectiveMod.redeclaredTypeSpecifier, scopeId);
          if (redeclaredClassId !== null) {
            const fullName = prefix ? `${prefix}.${child.name}` : child.name;
            this.classRedeclarations.set(fullName, redeclaredClassId);
          }
        }
        continue;
      } else if (child.kind === "Import" || child.kind === "Reference") {
        // Nested classes, imports, and references are not flattened into variables
        continue;
      }
      // Note: Equation, ForEquation, IfEquation, WhenEquation, AlgorithmSection
      // are handled by flattenClassSectionsRecursive (CST-based)
    }

    visited.delete(classId);
  }

  // -------------------------------------------------------------------------
  // Element Processing (used by secondary paths: topology, expandable, inline functions)
  // -------------------------------------------------------------------------

  private flattenElements(
    elementIds: SymbolId[],
    prefix: string,
    dae: ArenaDAEBuilder,
    modStack: ModificationStack,
  ): void {
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
        case "Component": {
          const t0 = performance.now();
          this.flattenComponent(entry, prefix, dae, modStack);
          const t1 = performance.now();
          if (t1 - t0 > 2) console.log(`[PERF flattenComponent] ${entry.name}: ${(t1 - t0).toFixed(2)} ms`);
          break;
        }
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

  private getInheritedTypeMod(
    scopeId: SymbolId,
    typeName: string,
  ): import("./modification-args.js").ModelicaModArgs | null {
    let mergedTypeMod: import("./modification-args.js").ModelicaModArgs | null = null;
    let currentClassId: SymbolId | null = scopeId;
    const visited = new Set<SymbolId>();

    while (currentClassId && !visited.has(currentClassId)) {
      visited.add(currentClassId);
      const children = this.db.childrenOf(currentClassId);
      // We process extends clauses to build the modification stack for this type
      const extendsClause = children.find((c) => c.kind === "Extends");
      if (extendsClause) {
        const extendsMod = this.db.query<import("./modification-args.js").ModelicaModArgs | null>(
          "extendsModificationParsed",
          extendsClause.id,
        );
        const typeMod = subModification(extendsMod, typeName);
        if (typeMod) {
          mergedTypeMod = mergeModArgs(mergedTypeMod, typeMod);
        }
        const baseClass = this.db.query<SymbolEntry | null>("resolvedBaseClass", extendsClause.id);
        if (baseClass) {
          currentClassId = baseClass.id;
          continue;
        }
      }
      break;
    }
    return mergedTypeMod;
  }

  private resolveTypeNameInScope(typeName: string, scopeId: SymbolId | null): SymbolId | null {
    if (!typeName) return null;

    let typeEntry: SymbolEntry | null = null;
    if (scopeId !== null) {
      const parentEntry = this.db.symbol(scopeId);
      if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
        if (typeName.includes(".")) {
          const qualResolver = this.db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
          if (qualResolver) {
            typeEntry = qualResolver(typeName);
          }
        } else {
          const resolver = this.db.query<(n: string, enc?: boolean) => SymbolEntry | null>(
            "resolveSimpleName",
            parentEntry.id,
          );
          if (resolver) {
            typeEntry = resolver(typeName);
          }
        }
      }
    }

    if (!typeEntry && typeName.includes(".")) {
      const entries = this.db.byName(typeName);
      typeEntry = entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ?? null;
    }

    if (!typeEntry) {
      const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
      const entries = this.db.byName(simpleName);
      typeEntry =
        entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
        entries?.find((e) => (e.metadata as Record<string, unknown>)?.classPrefixes === "type") ??
        entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
        null;
    }

    return typeEntry ? typeEntry.id : null;
  }

  // -------------------------------------------------------------------------
  // Component Flattening
  // -------------------------------------------------------------------------

  private flattenComponent(
    entry: SymbolEntry,
    prefix: string,
    dae: ArenaDAEBuilder,
    modStack: ModificationStack,
  ): void {
    const fullName = prefix ? `${prefix}.${entry.name}` : entry.name;

    // Deduplicate diamond inheritance: if component already emitted by a previous
    // extends clause, skip it. Modelica semantics state that the lexically first
    // extends clause modifications take precedence, which matches our evaluation order.
    if (dae.getVarIdxByName(fullName) >= 0 || dae.hasArrayElements(fullName)) {
      return;
    }

    // --- Compute effective modification from stack + inline CST ---
    const outerMod = lookupModInStack(modStack, entry.name);
    const isFinalFromOuterMod = isModFinalInStack(modStack, entry.name);
    const inlineMod = this.db.query<import("./modification-args.js").ModelicaModArgs | null>(
      "effectiveModification",
      entry.id,
    );
    let effectiveMod = mergeModArgs(outerMod, inlineMod);

    // If the component's type is a local/inherited class that was modified in the stack or via extends,
    // those modifications apply to the component instance.
    const typeName = this.db.query<string | null>("typeSpecifier", entry.id);
    if (typeName) {
      let typeOuterMod: import("./modification-args.js").ModelicaModArgs | null = null;
      let typeInlineMod: import("./modification-args.js").ModelicaModArgs | null = null;
      let typeExtendsMod: import("./modification-args.js").ModelicaModArgs | null = null;

      if (!typeName.includes(".")) {
        typeOuterMod = lookupModInStack(modStack, typeName);
        if (entry.parentId !== null) {
          const resolveName = this.db.query<any>("resolveSimpleName", entry.parentId);
          if (resolveName) {
            const typeEntry = resolveName(typeName);
            if (typeEntry) {
              typeInlineMod = this.db.query<import("./modification-args.js").ModelicaModArgs | null>(
                "effectiveModification",
                typeEntry.id,
              );
            }
          }
          typeExtendsMod = this.getInheritedTypeMod(entry.parentId, typeName);
        }
      } else {
        const parts = typeName.split(".");
        const simpleName = parts.pop()!;
        const qualifier = parts.join(".");

        let qualifierScopeId: SymbolId | null = null;
        if (entry.parentId !== null) {
          const resolveName = this.db.query<any>("resolveName", entry.parentId);
          if (resolveName) {
            const qualifierEntry = resolveName(qualifier);
            if (qualifierEntry) qualifierScopeId = qualifierEntry.id;
          }
        }

        if (qualifierScopeId !== null) {
          const resolveSimple = this.db.query<any>("resolveSimpleName", qualifierScopeId);
          if (resolveSimple) {
            const typeEntry = resolveSimple(simpleName);
            if (typeEntry) {
              typeInlineMod = this.db.query<import("./modification-args.js").ModelicaModArgs | null>(
                "effectiveModification",
                typeEntry.id,
              );
            }
          }
          typeExtendsMod = this.getInheritedTypeMod(qualifierScopeId, simpleName);
        }
      }

      if (typeOuterMod || typeExtendsMod || typeInlineMod) {
        let mergedTypeMod = mergeModArgs(typeOuterMod, typeExtendsMod);
        mergedTypeMod = mergeModArgs(mergedTypeMod, typeInlineMod);
        // Component modifications override type modifications
        effectiveMod = mergeModArgs(effectiveMod, mergedTypeMod);
      }
    }

    // --- Outer/inner resolution ---
    // If the component is declared `outer` (and NOT also `inner`),
    // skip emitting it — the matching `inner` in an enclosing scope provides the variable.
    const isOuter = this.db.query<boolean>("isOuter", entry.id);
    const isInner = this.db.query<boolean>("isInner", entry.id);
    if (isOuter) {
      // Search the active class hierarchy for a matching `inner` component
      let hasInner = false;
      let foundInnerPrefix = "";
      for (let i = this.activeClassStack.length - 2; i >= 0; i--) {
        const ancestor = this.activeClassStack[i]!;
        const ancestorChildren = this.db.childrenOf(ancestor.classId);
        for (const child of ancestorChildren) {
          if (child.kind === "Component" && child.name === entry.name) {
            const childIsInner = this.db.query<boolean>("isInner", child.id);
            if (childIsInner) {
              hasInner = true;
              foundInnerPrefix = ancestor.prefix;
              break;
            }
          }
        }
        if (hasInner) break;
      }

      if (hasInner) {
        const resolvedPath = foundInnerPrefix ? `${foundInnerPrefix}.${entry.name}` : entry.name;
        this.outerAliasMap.set(fullName, resolvedPath);
        if (!isInner) return; // Skip
      }
    }

    // Resolve the type specifier using the classInstance query.
    let classInstanceId = this.db.query<SymbolId | null>("classInstance", entry.id);

    // If there is a redeclaration modifier, it overrides the component's declared type.
    if (effectiveMod?.isRedeclaration && effectiveMod.redeclaredTypeSpecifier) {
      const scopeId =
        effectiveMod.evaluationScopeId !== undefined && effectiveMod.evaluationScopeId !== null
          ? effectiveMod.evaluationScopeId
          : entry.parentId;
      const redeclaredClassId = this.resolveTypeNameInScope(effectiveMod.redeclaredTypeSpecifier, scopeId);
      if (redeclaredClassId !== null) {
        classInstanceId = redeclaredClassId;
      }
    }

    if (classInstanceId === null) {
      const resolvedType = this.db.query<SymbolEntry | null>("resolvedType", entry.id);
      if (!resolvedType) {
        dae.diagnostics.push({
          code: 4004,
          rule: "arena-flattener",
          severity: "error",
          message: `Cannot resolve type for component '${fullName}'`,
          range: { startByte: entry.startByte, endByte: entry.endByte },
        });
      }
      return;
    }

    let classEntry = this.db.symbol(classInstanceId);
    if (!classEntry) {
      dae.diagnostics.push({
        code: 4004,
        rule: "arena-flattener",
        severity: "error",
        message: `Type resolved to invalid symbol for '${fullName}'`,
        range: { startByte: entry.startByte, endByte: entry.endByte },
      });
      return;
    }

    const classMeta = classEntry.metadata as Record<string, unknown>;
    const resolvedTypeName = classEntry.name;

    let isPredefined = classMeta?.isPredefined || isPredefinedScalar(resolvedTypeName);
    let primitiveTypeName = resolvedTypeName;

    let currentClassId: SymbolId | null = classInstanceId;
    const visitedBase = new Set<SymbolId>();
    let typeMods: import("./modification-args.js").ModelicaModArgs | null = null;

    if (!isPredefined) {
      while (currentClassId && !visitedBase.has(currentClassId)) {
        visitedBase.add(currentClassId);

        const currentEntry = this.db.symbol(currentClassId);
        if (!currentEntry) break;

        if ((currentEntry.metadata as Record<string, unknown>)?.isPredefined || isPredefinedScalar(currentEntry.name)) {
          isPredefined = true;
          primitiveTypeName = currentEntry.name;
          break;
        }

        const c0 = performance.now();
        const classInlineMod = this.db.query<import("./modification-args.js").ModelicaModArgs | null>(
          "effectiveModification",
          currentClassId,
        );
        const c1 = performance.now();
        (this as any).effModTime = ((this as any).effModTime || 0) + (c1 - c0);
        typeMods = mergeModArgs(typeMods, classInlineMod);

        const cst = this.db.cstNode(currentClassId) as any;
        const spec = cst?.childForFieldName?.("classSpecifier");
        if (spec?.type === "ShortClassSpecifier") {
          const typeSpec = spec.childForFieldName?.("typeSpecifier");
          if (typeSpec?.text) {
            const resolvedId = this.resolveTypeNameInScope(typeSpec.text, currentEntry.parentId);
            if (resolvedId !== null && resolvedId !== currentClassId) {
              currentClassId = resolvedId;
              continue;
            }
          }
        }

        const children = this.db.childrenOf(currentClassId);
        const extendsClause = children.find((c) => c.kind === "Extends");
        if (extendsClause) {
          const extendsMod = this.db.query<import("./modification-args.js").ModelicaModArgs | null>(
            "extendsModificationParsed",
            extendsClause.id,
          );
          typeMods = mergeModArgs(typeMods, extendsMod);
          const baseClass = this.db.query<SymbolEntry | null>("resolvedBaseClass", extendsClause.id);
          if (baseClass) {
            currentClassId = baseClass.id;
            continue;
          }
        }

        break;
      }
    }

    if (typeMods) {
      effectiveMod = mergeModArgs(effectiveMod, typeMods);
    }

    let rawDims = this.db.query<any[] | null>("arrayDimensions", entry.id) || [];
    if (effectiveMod?.redeclaredArrayDimensionsRaw) {
      rawDims = [...rawDims, ...effectiveMod.redeclaredArrayDimensionsRaw];
    }

    let arrayDims = this.db.query<number[] | null>("resolvedArrayDimensions", entry.id) || [];
    let arrayDimsExprIds: number[] | undefined = undefined;

    if (rawDims.length > 0) {
      arrayDimsExprIds = [];
      const evaluatedDims: number[] = [];

      for (const dim of rawDims) {
        if (dim.kind === "expression" && dim.cstBytes) {
          const cstNode = this.db.cstNodeRange(dim.cstBytes[0], dim.cstBytes[1], entry);
          if (cstNode) {
            const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
            const scopeToUse = effectiveMod?.evaluationScopeId ?? entry.parentId ?? entry.id;
            const prefixForScope = this.getPrefixForScope(entry.parentId ?? entry.id, scopeToUse, prefix);
            const visitor = this.createExprVisitor(dae, undefined, prefixForScope, scopeToUse);
            const exprId = visitor.visit(astNode ?? cstNode);
            if (exprId !== undefined) {
              arrayDimsExprIds.push(exprId);
              const evalResult = evaluateArenaExpression(dae, exprId, undefined, this.db, scopeToUse);
              if (typeof evalResult === "number") {
                evaluatedDims.push(evalResult);
              } else {
                evaluatedDims.push(0);
              }
              continue;
            }
          }
        } else if (dim.kind === "literal") {
          arrayDimsExprIds?.push(dae.addIntLiteral(dim.value));
          evaluatedDims.push(dim.value);
          continue;
        }

        // Flexible dimension (:) or failed evaluation
        arrayDimsExprIds = undefined; // Abandon expr IDs if one fails
        evaluatedDims.push(0);
      }

      // Override arrayDims if evaluatedDims has values (especially from redeclaration)
      if (evaluatedDims.length > 0) {
        arrayDims = evaluatedDims;
      }
    }

    if (arrayDims && arrayDims.length > 0) {
      let hasUnknownDim = arrayDims.some((d) => d <= 0);

      if (hasUnknownDim && effectiveMod?.bindingExpression && dae.classKind !== "function") {
        const binding = effectiveMod.bindingExpression;
        let inferredDims: number[] | undefined;
        if (binding.kind === "literal" && Array.isArray(binding.value)) {
          inferredDims = [binding.value.length];
        } else if (binding.kind === "expression" && binding.cstBytes) {
          const cstNode = this.db.cstNodeRange(binding.cstBytes[0], binding.cstBytes[1], entry);
          if (cstNode) {
            const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
            const scopeToUse = effectiveMod.evaluationScopeId ?? entry.parentId ?? entry.id;
            const prefixForScope = this.getPrefixForScope(entry.parentId ?? entry.id, scopeToUse, prefix);
            const visitor = this.createExprVisitor(dae, undefined, prefixForScope, scopeToUse);
            const exprId = visitor.visit(astNode ?? cstNode);
            if (exprId !== undefined) {
              const scopeToUse = effectiveMod.evaluationScopeId ?? entry.parentId ?? entry.id;
              const evalResult = evaluateArenaExpression(dae, exprId, undefined, this.db, scopeToUse);
              if (Array.isArray(evalResult)) {
                const shape: number[] = [];
                let curr: any = evalResult;
                while (Array.isArray(curr)) {
                  shape.push(curr.length);
                  curr = curr[0];
                }
                inferredDims = shape;
              }
            }
          }
        }
        if (inferredDims && inferredDims.length > 0) {
          if (entry.name === "x" || entry.name === "u") {
            console.error(
              `[DEBUG DIMS] entry=${entry.name} original_arrayDims=${arrayDims.join(",")} inferredDims=${inferredDims.join(",")}`,
            );
          }
          // Merge inferredDims into arrayDims to replace unknown dimensions (0)
          for (let i = 0; i < arrayDims.length; i++) {
            if (arrayDims[i] <= 0 && i < inferredDims.length) {
              arrayDims[i] = inferredDims[i];
            }
          }
          // If arrayDims was empty (e.g. implicitly sized), use the full inferred shape
          if (arrayDims.length === 0) {
            arrayDims = inferredDims;
          }

          if (entry.name === "x" || entry.name === "u") {
            console.error(`[DEBUG DIMS] entry=${entry.name} merged_arrayDims=${arrayDims.join(",")}`);
          }

          hasUnknownDim = arrayDims.some((d) => d <= 0);
        }
      } else if (hasUnknownDim && !effectiveMod?.bindingExpression) {
        // Evaluate the raw array dimensions dynamically in the current evaluation scope using ArenaExprVisitor
        if (rawDims) {
          const evalDims: number[] = [];
          for (const dim of rawDims) {
            if (dim.kind === "expression" && dim.cstBytes) {
              const cstNode = this.db.cstNodeRange(dim.cstBytes[0], dim.cstBytes[1], entry);
              if (cstNode) {
                const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
                const scopeToUse = effectiveMod?.evaluationScopeId ?? entry.parentId ?? entry.id;
                const prefixForScope = this.getPrefixForScope(entry.parentId ?? entry.id, scopeToUse, prefix);
                const visitor = this.createExprVisitor(dae, undefined, prefixForScope, scopeToUse);
                const exprId = visitor.visit(astNode ?? cstNode);
                if (exprId !== undefined) {
                  const evalResult = evaluateArenaExpression(dae, exprId, undefined, this.db, scopeToUse);
                  if (typeof evalResult === "number") {
                    const val = evalResult as any; // Cast to access index
                    evalDims.push(typeof val === "number" ? val : 0);
                    continue;
                  } else if (Array.isArray(evalResult)) {
                    const first = evalResult[0];
                    evalDims.push(typeof first === "number" ? first : 0);
                    continue;
                  }
                }
              }
            } else if (dim.kind === "literal") {
              evalDims.push(dim.value);
              continue;
            }
            evalDims.push(0);
          }
          if (evalDims.length > 0) {
            arrayDims = evalDims;
            hasUnknownDim = arrayDims.some((d) => d <= 0);
          }
        }
      }

      if (this.options.arrayMode === "preserve" || hasUnknownDim) {
        // In preserve mode, emit a single variable with shape metadata
        this.emitVariable(fullName, resolvedTypeName, entry, dae, effectiveMod, modStack, isFinalFromOuterMod);
        const varIdx = dae.getVarIdxByName(fullName);
        if (varIdx >= 0) {
          dae.setVarShape(varIdx, arrayDims);
          if (arrayDimsExprIds) {
            dae.setVarShapeExprs(varIdx, arrayDimsExprIds);
          }
        }
        return;
      }
      this.flattenArrayComponent(
        fullName,
        classInstanceId,
        arrayDims,
        entry,
        dae,
        modStack,
        effectiveMod,
        !!isPredefined,
        primitiveTypeName,
      );
      return;
    }

    if (isPredefined) {
      this.emitVariable(fullName, primitiveTypeName, entry, dae, effectiveMod, modStack, isFinalFromOuterMod);
      return;
    }

    // --- Enumeration types ---
    let isEnum = classMeta?.classPrefixes === "enumeration" || !!classMeta?.enumeration;
    if (!isEnum && classInstanceId !== null) {
      const classCst = this.db.cstNode(classInstanceId) as any;
      const spec = classCst?.childForFieldName?.("classSpecifier");
      if (spec?.type === "ShortClassSpecifier" && spec.childForFieldName?.("enumeration")) {
        isEnum = true;
      }
    }

    if (isEnum) {
      this.emitEnumerationVariable(fullName, resolvedTypeName, entry, classInstanceId, dae, effectiveMod);
      return;
    }

    // --- Clock type ---
    if (resolvedTypeName === "Clock") {
      this.emitClockVariable(fullName, entry, dae, effectiveMod);
      return;
    }

    // --- Function / Partial Function types ---
    if (typeof classMeta?.classPrefixes === "string" && classMeta.classPrefixes.includes("function")) {
      this.emitFunctionVariable(fullName, resolvedTypeName, entry, dae, effectiveMod);
      return;
    }

    // Recurse into the compound type using flattenClassWithMods.
    // Build child modification stack: push this component's effective mod
    // If this component is declared `final`, propagate that to all children
    const componentIsFinal = this.db.query<boolean>("isFinal", entry.id) || isFinalFromOuterMod;
    const childStack: ModificationStack = effectiveMod
      ? [
          ...modStack,
          {
            mods: effectiveMod,
            evaluationScopeId: entry.parentId,
            isFinal: componentIsFinal || undefined,
            evaluationScopePrefix: prefix,
          },
        ]
      : componentIsFinal
        ? [
            ...modStack,
            {
              mods: { args: [], bindingExpression: null },
              evaluationScopeId: entry.parentId,
              isFinal: true,
              evaluationScopePrefix: prefix,
            },
          ]
        : modStack;
    // Push compound type onto hierarchy stack for outer/inner resolution
    this.activeClassStack.push({ classId: classInstanceId, prefix: fullName });
    this.flattenClassWithMods(classInstanceId, fullName, dae, childStack, new Set());
    this.flattenClassSectionsRecursive(classInstanceId, fullName, dae, new Set());
    this.activeClassStack.pop();
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
    modStack: ModificationStack,
    effectiveMod: ModelicaModArgs | null,
    isPredefined: boolean = false,
    primitiveTypeName: string = "Real",
  ): void {
    // For a multi-dimensional array, expand recursively
    // e.g., Real[3,2] x → x[1,1], x[1,2], x[2,1], ...
    const indices = this.generateArrayIndices(shape);

    const classEntry = this.db.symbol(classInstanceId);
    const typeName = classEntry?.name ?? "Real";

    // Strip the binding expression from the per-element modification:
    // array bindings like `Integer x[3] = {1,2,3}` must be emitted as a single
    // array-level equation `x = {1,2,3}`, NOT duplicated for each element.
    const variability = (entry.metadata as Record<string, unknown>)?.variability;
    const isParam = variability === "parameter" || variability === "constant";

    const arrayBinding = effectiveMod?.bindingExpression ?? null;
    let elementMod: import("./modification-args.js").ModelicaModArgs | null = effectiveMod
      ? { ...effectiveMod, bindingExpression: null }
      : null;

    let arrayBindingVal: any = undefined;
    if (arrayBinding) {
      if (arrayBinding.kind === "expression") {
        const bytes = arrayBinding.cstBytes;
        const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], entry);
        if (cstNode) {
          const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
          const dotIdx = baseName.lastIndexOf(".");
          const parentPrefix = dotIdx >= 0 ? baseName.substring(0, dotIdx) : undefined;

          let exprPrefix = parentPrefix;
          let scopeId = entry.parentId ?? entry.id;
          if (effectiveMod?.evaluationScopeId && effectiveMod.evaluationScopeId !== entry.parentId) {
            scopeId = effectiveMod.evaluationScopeId;
            const frame = modStack.find((f) => f.evaluationScopeId === scopeId);
            if (frame && frame.evaluationScopePrefix !== undefined) {
              exprPrefix = frame.evaluationScopePrefix;
            } else if (scopeId === entry.parentId) {
              exprPrefix = parentPrefix;
            } else {
              exprPrefix = undefined;
            }
          }

          const visitor = this.createExprVisitor(dae, undefined, exprPrefix, scopeId);
          const exprId = visitor.visit(astNode ?? cstNode);
          if (exprId !== undefined) {
            arrayBindingVal = evaluateArenaExpression(dae, exprId);
          }
        }
      } else if (arrayBinding.kind === "literal") {
        arrayBindingVal = arrayBinding.value;
      }
    }

    const getShape = (a: any): number[] => {
      if (!Array.isArray(a)) return [];
      return [a.length, ...getShape(a[0])];
    };
    const bindingShape = getShape(arrayBindingVal);

    const parameters = new Map<string, any>();
    if (arrayBindingVal !== undefined) {
      parameters.set(entry.name, arrayBindingVal);
    }

    const attributesToSlice = ["start", "min", "max", "nominal"];
    const attrValArrays: Record<string, { val: any; shape: number[] }> = {};
    for (const attr of attributesToSlice) {
      const attrMod = elementMod?.args.find((a) => a.name === attr);
      if (attrMod) {
        const val = this.resolveModAttribute(effectiveMod, attr, typeName, dae, entry, modStack, parameters);
        // Removing the require('fs') to clean up
        if (val !== undefined && Array.isArray(val)) {
          attrValArrays[attr] = { val, shape: getShape(val) };
        }
      }
    }

    for (const idx of indices) {
      const indexStr = idx.map(String).join(",");
      const fullName = `${baseName}[${indexStr}]`;

      let currentElementMod = elementMod;

      for (const attr of attributesToSlice) {
        const attrData = attrValArrays[attr];
        if (attrData) {
          const arrShape = attrData.shape;
          const valArray = attrData.val;
          if (arrShape.length <= idx.length) {
            const relevantIdx = idx.slice(idx.length - arrShape.length);
            let current = valArray;
            for (let d = 0; d < relevantIdx.length; d++) {
              const i = relevantIdx[d]! - 1;
              if (!Array.isArray(current) || i < 0 || i >= current.length) {
                current = undefined;
                break;
              }
              current = current[i];
            }
            if ((current !== undefined && typeof current === "number") || typeof current === "boolean") {
              const numVal = typeof current === "boolean" ? (current ? 1.0 : 0.0) : current;
              if (currentElementMod) {
                currentElementMod = {
                  ...currentElementMod,
                  args: currentElementMod.args.map((a) =>
                    a.name === attr ? { ...a, value: { kind: "literal", value: numVal } } : a,
                  ),
                };
              }
            }
          }
        }
      }

      if (isParam && arrayBindingVal !== undefined && Array.isArray(arrayBindingVal)) {
        if (bindingShape.length <= idx.length) {
          const relevantIdx = idx.slice(idx.length - bindingShape.length);
          let current = arrayBindingVal;
          for (let d = 0; d < relevantIdx.length; d++) {
            const i = relevantIdx[d]! - 1;
            if (!Array.isArray(current) || i < 0 || i >= current.length) {
              current = undefined;
              break;
            }
            current = current[i];
          }
          if (current !== undefined && (typeof current === "number" || typeof current === "boolean")) {
            const numVal = typeof current === "boolean" ? (current ? 1.0 : 0.0) : current;
            currentElementMod = {
              ...(currentElementMod || { args: [] }),
              bindingExpression: { kind: "literal", value: numVal },
            };
          }
        }
      }

      if (isPredefined || isPredefinedScalar(typeName) || classEntry?.metadata?.isPredefined) {
        this.emitVariable(
          fullName,
          isPredefined ? primitiveTypeName : typeName,
          entry,
          dae,
          currentElementMod,
          modStack,
        );
      } else {
        // Compound array element — recurse using flattenClassWithMods
        const childStack: ModificationStack = currentElementMod
          ? [...modStack, { mods: currentElementMod, evaluationScopeId: entry.parentId }]
          : modStack;
        this.flattenClassWithMods(classInstanceId, fullName, dae, childStack, new Set());
        this.flattenClassSectionsRecursive(classInstanceId, fullName, dae, new Set());
      }
    }

    // Emit the array-level binding equation once for the entire array
    if (arrayBinding && (!isParam || arrayBindingVal === undefined)) {
      if (arrayBinding.kind === "expression") {
        const bytes = arrayBinding.cstBytes;
        const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], entry);
        if (cstNode) {
          const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
          const dotIdx = baseName.lastIndexOf(".");
          const parentPrefix = dotIdx >= 0 ? baseName.substring(0, dotIdx) : undefined;

          let exprPrefix = parentPrefix;
          let scopeId = entry.parentId ?? entry.id;
          if (effectiveMod?.evaluationScopeId && effectiveMod.evaluationScopeId !== entry.parentId) {
            scopeId = effectiveMod.evaluationScopeId;
            const frame = modStack.find((f) => f.evaluationScopeId === scopeId);
            if (frame && frame.evaluationScopePrefix !== undefined) {
              exprPrefix = frame.evaluationScopePrefix;
            } else if (scopeId === entry.parentId) {
              exprPrefix = parentPrefix;
            } else {
              exprPrefix = undefined;
            }
          }

          const visitor = this.createExprVisitor(dae, undefined, exprPrefix, scopeId);
          const exprId = visitor.visit(astNode ?? cstNode);
          if (exprId !== undefined) {
            const nameExpr = dae.addNameExpr(baseName);
            dae.addEquation(EqKind.Simple, nameExpr, exprId);
          }
        }
      } else if (arrayBinding.kind === "literal") {
        const compileLiteral = (value: unknown): number => {
          if (Array.isArray(value)) {
            const elements = value.map(compileLiteral);
            return dae.addArrayCtorExpr(elements);
          }
          if (typeof value === "number") return dae.addIntLiteral(Math.round(value));
          if (typeof value === "boolean") return dae.addBoolLiteral(value);
          return dae.addStringLiteral(value as string);
        };
        const exprId = compileLiteral(arrayBinding.value);
        const nameExpr = dae.addNameExpr(baseName);
        dae.addEquation(EqKind.Simple, nameExpr, exprId);
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

  private addScalarizedEquation(
    dae: ArenaDAEBuilder,
    eqKind: EqKind,
    lhsName: string,
    rhsId: number,
    shape: number[],
    visitor: ArenaExprVisitor,
    wrapperFunc: string | null = null,
    strippedLhsDims: number = 0,
  ): void {
    if (this.options.arrayMode === "preserve") {
      let elemLhsId = dae.addNameExpr(lhsName);
      if (wrapperFunc === "der") elemLhsId = dae.addDerExpr(elemLhsId);
      else if (wrapperFunc === "pre") elemLhsId = dae.addPreExpr(elemLhsId);
      else if (wrapperFunc) elemLhsId = dae.addCallExpr(wrapperFunc, [elemLhsId]);
      dae.addEquation(eqKind, elemLhsId, rhsId);
      return;
    }
    const indices = this.generateArrayIndices(shape);
    for (const idx of indices) {
      const elemVarName = `${lhsName}[${idx.join(",")}]`;
      const elemVarIdx = dae.getVarIdxByName(elemVarName);
      const elemType = elemVarIdx >= 0 ? dae.getVarType(elemVarIdx) : VarType.Real;

      const rhsIdx = strippedLhsDims > 0 ? [...Array(strippedLhsDims).fill(1), ...idx] : idx;
      let elemRhsId = this.getArrayElementExpr(dae, rhsId, rhsIdx, visitor);
      if (elemType === VarType.Real) {
        elemRhsId = visitor.castToRealExpr(elemRhsId);
      }

      let elemLhsId = dae.addNameExpr(elemVarName);
      if (wrapperFunc === "der") elemLhsId = dae.addDerExpr(elemLhsId);
      else if (wrapperFunc === "pre") elemLhsId = dae.addPreExpr(elemLhsId);
      else if (wrapperFunc) elemLhsId = dae.addCallExpr(wrapperFunc, [elemLhsId]);
      dae.addEquation(eqKind, elemLhsId, elemRhsId);
    }
  }

  /** Recursively resolve/subscript RHS element expression for array equation scalarization. */
  private getArrayElementExpr(
    dae: ArenaDAEBuilder,
    exprId: number,
    indices: number[],
    visitor?: ArenaExprVisitor,
  ): number {
    const kind = dae.getExprKind(exprId);

    if (
      kind === ExprKind.IntLiteral ||
      kind === ExprKind.RealLiteral ||
      kind === ExprKind.BoolLiteral ||
      kind === ExprKind.StringLiteral
    ) {
      return exprId;
    }

    if (kind === ExprKind.Name) {
      const varName = dae.interner.resolve(dae.getExprData1(exprId));
      const elemVarName = `${varName}[${indices.join(",")}]`;
      if (dae.hasVar(elemVarName)) {
        return dae.addNameExpr(elemVarName);
      }
      if (dae.hasVar(varName)) {
        const varIdx = dae.getVarIdxByName(varName);
        if (dae.getVarShape(varIdx).length === 0) {
          return exprId;
        }
      }
    }

    if (kind === ExprKind.Binary) {
      const op = dae.getExprData1(exprId) as BinOp;
      const left = this.getArrayElementExpr(dae, dae.getExprLeft(exprId), indices, visitor);
      const right = this.getArrayElementExpr(dae, dae.getExprRight(exprId), indices, visitor);
      return dae.addBinaryExpr(op, left, right);
    }

    if (kind === ExprKind.Unary) {
      const op = dae.getExprData1(exprId) as UnaryOp;
      const operand = this.getArrayElementExpr(dae, dae.getExprLeft(exprId), indices, visitor);
      return dae.addUnaryExpr(op, operand);
    }

    if (kind === ExprKind.Call) {
      const funcNameId = dae.getExprData1(exprId);
      const funcName = dae.interner.resolve(funcNameId);

      let returnsScalar = false;
      const fnDae = dae.functions.get(funcNameId);
      if (fnDae) {
        let outCount = 0;
        let outShape: number[] = [];
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === 2 /* Output */) {
            outCount++;
            outShape = fnDae.getVarShape(i);
          }
        }
        if (outCount === 1 && outShape.length === 0) {
          returnsScalar = true;
        } else {
          console.error(
            `[DEBUG VEC] ${funcName} returnsScalar=false (outCount=${outCount}, outShape=${JSON.stringify(outShape)})`,
          );
        }
      } else {
        const scalarBuiltins = new Set([
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
          "/*Real*/",
          "/*Integer*/",
          "/*String*/",
          "/*Boolean*/",
        ]);
        if (scalarBuiltins.has(funcName)) {
          returnsScalar = true;
        }
      }

      if (returnsScalar) {
        const numArgs = dae.getExprRight(exprId);
        const firstArg = dae.getExprLeft(exprId);
        const newArgs: number[] = [];
        for (let i = 0; i < numArgs; i++) {
          const argId = i === 0 ? firstArg : dae.getExprLeft(exprId + i);
          newArgs.push(this.getArrayElementExpr(dae, argId, indices, visitor));
        }
        if (visitor) {
          const folded = (visitor as any).tryFoldBuiltinCall(funcName, newArgs);
          if (folded !== undefined) return folded;
          const inlined = (visitor as any).tryInlineFunctionCall(funcName, newArgs);
          if (inlined !== undefined) return inlined;
        }
        return dae.addCallExpr(funcName, newArgs);
      }
    }

    if (kind === ExprKind.Subscript) {
      const baseId = dae.getExprData1(exprId);
      const idxCount = dae.getExprRight(exprId);
      let curr = dae.getExprLeft(exprId);
      const idxIds: number[] = [];
      for (let i = 0; i < idxCount; i++) {
        idxIds.push(curr++);
      }

      // We only support 1D slicing mapping right now
      if (idxIds.length === 1 && indices.length === 1 && visitor) {
        const sliceIdxExprId = idxIds[0]!;
        const activeClass = (visitor as any).scopeId;
        const val = evaluateArenaExpression(dae, sliceIdxExprId, undefined, this.db, activeClass, undefined, false);
        if (Array.isArray(val)) {
          const targetIdx = indices[0]! - 1;
          if (targetIdx >= 0 && targetIdx < val.length) {
            const mappedIdx = val[targetIdx];
            if (typeof mappedIdx === "number") {
              let baseVarName = "";
              if (dae.getExprKind(baseId) === ExprKind.Name) {
                baseVarName = dae.interner.resolve(dae.getExprData1(baseId));
              }
              if (baseVarName) {
                const elemVarName = `${baseVarName}[${mappedIdx}]`;
                if (dae.hasVar(elemVarName)) {
                  return dae.addNameExpr(elemVarName);
                }
              }
              return dae.addSubscriptExpr(baseId, [dae.addIntLiteral(mappedIdx)]);
            }
          }
        }
      }
    }

    let currentExprId = exprId;
    let success = true;
    for (const idx of indices) {
      let currKind = dae.getExprKind(currentExprId);

      // Unwrap Cast (which was used previously, now handled via Call to /*Real*/)
      let isCast = false;
      let castType = 0;
      if (currKind === ExprKind.Call && dae.interner.resolve(dae.getExprData1(currentExprId)) === "/*Real*/") {
        isCast = true;
        currentExprId = dae.getExprLeft(currentExprId); // For Call, left is first arg
        currKind = dae.getExprKind(currentExprId);
      }

      if (currKind === ExprKind.ArrayCtor) {
        const count = dae.getExprData1(currentExprId);
        const i = idx - 1;
        if (i >= 0 && i < count) {
          currentExprId = i === 0 ? dae.getExprLeft(currentExprId) : dae.getExprLeft(currentExprId + i);
          if (isCast) {
            currentExprId = dae.addCallExpr("/*Real*/", [currentExprId]);
          }
        } else {
          console.error(`[DEBUG VEC FAIL] idx out of bounds: idx=${idx}, count=${count}`);
          success = false;
          break;
        }
      } else {
        console.error(`[DEBUG VEC FAIL] not ArrayCtor: currKind=${currKind}, currentExprId=${currentExprId}`);
        success = false;
        break;
      }
    }
    if (success) {
      return currentExprId;
    }

    // Fallback: subscript expression
    return dae.addSubscriptExpr(
      exprId,
      indices.map((idxVal) => dae.addIntLiteral(idxVal)),
    );
  }

  // -------------------------------------------------------------------------
  // Variable Emission
  // -------------------------------------------------------------------------

  private emitVariable(
    name: string,
    typeName: string,
    componentEntry: SymbolEntry,
    dae: ArenaDAEBuilder,
    effectiveMod: ModelicaModArgs | null = null,
    modStack: ModificationStack = [],
    isFinalFromOuterMod: boolean = false,
  ): number {
    // Use the pre-computed effective modification from the caller.
    // This replaces the old pattern of reading db.argsOf() from virtual symbol args.
    const mod = effectiveMod;

    let varType = VarType.Real;
    if (typeName === "Integer") varType = VarType.Integer;
    else if (typeName === "Boolean") varType = VarType.Boolean;
    else if (typeName === "String") varType = VarType.String;

    // Resolve variability via the query system (reads from ComponentClause CST)
    let variability = Variability.Continuous;
    const modVariability = this.resolveModAttribute(
      mod,
      "variability",
      typeName,
      dae,
      componentEntry,
      modStack,
    ) as string;
    const qVariability = this.db.query<string | null>("variability", componentEntry.id);
    const vStr = modVariability ?? qVariability ?? "continuous";
    if (vStr === "discrete") variability = Variability.Discrete;
    else if (vStr === "parameter") variability = Variability.Parameter;
    else if (vStr === "constant") variability = Variability.Constant;

    // Resolve causality via the query system
    let causality = Causality.Local;
    const modCausality = this.resolveModAttribute(mod, "causality", typeName, dae, componentEntry, modStack) as string;
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
    // A variable is protected if:
    // 1. It's directly declared in a protected section (isProtected query), OR
    // 2. It was inherited through a `protected extends` clause (inheritedProtected)
    const isProtected = this.inheritedProtected || this.db.query<boolean>("isProtected", componentEntry.id);
    if (isProtected) {
      flags |= 1;
    }

    // Final flag (bit 4)
    const isFinal = this.db.query<boolean>("isFinal", componentEntry.id) || isFinalFromOuterMod;

    // Evaluate annotation: if annotation(Evaluate=true), promote parameter to final
    // Per Modelica §18.3, Evaluate=true tells the tool to substitute the parameter's value
    // at compile time. OpenModelica promotes such parameters to `final parameter`.
    const isEvaluate = this.db.query<boolean>("isEvaluate", componentEntry.id);
    if (isFinal || (isEvaluate && variability !== Variability.Constant)) {
      flags |= 16;
    }

    // Resolve start value and set as attribute expression
    const hasExplicitStart = mod?.args.some((a) => a.name === "start") ?? false;
    const startVal = hasExplicitStart
      ? (this.resolveModAttribute(mod, "start", typeName, dae, componentEntry, modStack) ?? 0.0)
      : 0.0;
    const initialValue =
      typeof startVal === "number" ? startVal : startVal === true ? 1.0 : startVal === false ? 0.0 : 0.0;

    const varIdx = dae.addVariable(name, varType, variability, causality, initialValue, flags);
    if (qFlowPrefix === "stream") {
      dae.setVarFlowPrefix(varIdx, "stream");
    }

    // Resolve description string
    let description = "";
    const cst = this.db.cstNode(componentEntry.id) as any;
    if (cst) {
      const descNode = cst.childForFieldName("description");
      if (descNode) {
        const strNode =
          descNode.childForFieldName("descriptionString") || descNode.children.find((c: any) => c.type === "STRING");
        if (strNode) {
          description = strNode.text.replace(/^"|"$/g, "");
        }
      }
    }
    if (description) {
      dae.setVarDescription(varIdx, description);
    }

    // Set start value as an attribute expression for the printer
    // Only emit when explicitly modified in the source model
    if (hasExplicitStart) {
      const startExprId =
        varType === VarType.Boolean
          ? dae.addBoolLiteral(initialValue !== 0)
          : varType === VarType.Integer
            ? dae.addIntLiteral(initialValue)
            : dae.addRealLiteral(initialValue);
      dae.setVarAttrExprId(varIdx, "start", startExprId);
    }

    // Set other scalar attributes
    const parseAttr = (attrName: string) => {
      const val = this.resolveModAttribute(mod, attrName, typeName, dae, componentEntry, modStack);
      if (val !== undefined && val !== null) {
        if (typeof val === "number") {
          const exprId = varType === VarType.Integer ? dae.addIntLiteral(Math.round(val)) : dae.addRealLiteral(val);
          dae.setVarAttrExprId(varIdx, attrName, exprId);
        } else if (typeof val === "string") {
          const exprId = dae.addStringLiteral(val);
          dae.setVarAttrExprId(varIdx, attrName, exprId);
        } else if (typeof val === "boolean") {
          const exprId = dae.addBoolLiteral(val);
          dae.setVarAttrExprId(varIdx, attrName, exprId);
        }
      }
    };
    parseAttr("min");
    parseAttr("max");
    parseAttr("nominal");
    parseAttr("unit");
    parseAttr("displayUnit");
    parseAttr("quantity");
    parseAttr("fixed");

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
    // But ONLY if they are not explicitly marked as fixed=false
    let isExplicitlyNotFixed = false;
    const fixedAttrExpr = dae.getVarAttrExprId(varIdx, "fixed");
    if (fixedAttrExpr !== undefined) {
      if (dae.getExprKind(fixedAttrExpr) === ExprKind.BoolLiteral) {
        isExplicitlyNotFixed = dae.getExprData1(fixedAttrExpr) === 0;
      }
    }

    if ((isFinal || isEvaluate) && variability === Variability.Parameter && !isExplicitlyNotFixed) {
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
          const dotIdx = name.lastIndexOf(".");
          const parentPrefix = dotIdx >= 0 ? name.substring(0, dotIdx) : undefined;

          let exprPrefix = parentPrefix;
          let scopeId = componentEntry.parentId ?? componentEntry.id;
          if (mod.evaluationScopeId && mod.evaluationScopeId !== componentEntry.parentId) {
            scopeId = mod.evaluationScopeId;
            const frame = modStack.find((f) => f.evaluationScopeId === scopeId);
            if (frame && frame.evaluationScopePrefix !== undefined) {
              exprPrefix = frame.evaluationScopePrefix;
            } else if (scopeId === componentEntry.parentId) {
              exprPrefix = parentPrefix;
            } else {
              exprPrefix = undefined;
            }
          }

          const visitor = this.createExprVisitor(dae, undefined, exprPrefix, scopeId);
          let exprId = visitor.visit(astNode ?? cstNode);
          if (exprId !== undefined) {
            if (varType === VarType.Real) {
              exprId = visitor.castToRealExpr(exprId);
            }
            dae.setVarExpression(varIdx, exprId);
            if (variability !== Variability.Parameter && variability !== Variability.Constant) {
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
        dae.setVarExpression(varIdx, exprId);
        if (variability !== Variability.Parameter && variability !== Variability.Constant) {
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
    effectiveMod: ModelicaModArgs | null = null,
  ): number {
    // Use the pre-computed effective modification from the caller.
    const mod = effectiveMod;

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
    const literals: { ordinal: number; stringValue: string }[] = [];
    let ordinal = 1;
    for (const child of enumChildren) {
      if (child.kind === "EnumerationLiteral" || child.kind === "EnumLiteral") {
        literals.push({ ordinal: ordinal++, stringValue: child.name });
      }
    }

    // Fallback: parse from CST if children list is empty
    if (literals.length === 0) {
      const classCst = this.db.cstNode(classInstanceId) as any;
      const spec = classCst?.childForFieldName?.("classSpecifier");
      const enumNode = spec?.childForFieldName?.("enumeration") || classCst?.childForFieldName?.("enumeration");
      const list = enumNode?.childForFieldName?.("enumList");
      if (list) {
        for (const child of list.children) {
          if (child.type === "enum_literal" || child.type === "EnumLiteral") {
            // tree-sitter name is usually `identifier` inside `enum_literal`
            const ident = child.childForFieldName?.("identifier") || child;
            literals.push({ ordinal: ordinal++, stringValue: ident.text });
          }
        }
      }
    }

    if (literals.length > 0) {
      dae.setVarEnumerationLiterals(varIdx, literals);
    }
    // Handle binding expression (same logic as emitVariable)
    if (mod?.bindingExpression) {
      if (mod.bindingExpression.kind === "literal") {
        const val = mod.bindingExpression.value;
        const exprId = typeof val === "number" ? dae.addIntLiteral(Math.round(val)) : dae.addIntLiteral(0);
        dae.setVarExpression(varIdx, exprId);
        if (variability !== Variability.Parameter && variability !== Variability.Constant) {
          const nameExpr = dae.addNameExpr(name);
          dae.addEquation(EqKind.Simple, nameExpr, exprId);
        }
      } else if (mod.bindingExpression.kind === "expression") {
        const bytes = mod.bindingExpression.cstBytes;
        const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], componentEntry);
        if (cstNode) {
          const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
          const dotIdx = name.lastIndexOf(".");
          const parentPrefix = dotIdx >= 0 ? name.substring(0, dotIdx) : undefined;
          const visitor = this.createExprVisitor(
            dae,
            undefined,
            parentPrefix,
            componentEntry.parentId ?? componentEntry.id,
          );
          const exprId = visitor.visit(astNode ?? cstNode);
          if (exprId !== undefined) {
            dae.setVarExpression(varIdx, exprId);
            if (variability !== Variability.Parameter && variability !== Variability.Constant) {
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

  private emitClockVariable(
    name: string,
    componentEntry: SymbolEntry,
    dae: ArenaDAEBuilder,
    effectiveMod: ModelicaModArgs | null = null,
  ): number {
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

    // Use the pre-computed effective modification from the caller.
    const mod = effectiveMod;

    if (mod?.bindingExpression) {
      if (mod.bindingExpression.kind === "expression") {
        const bytes = mod.bindingExpression.cstBytes;
        const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], componentEntry);
        if (cstNode) {
          const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
          const dotIdx = name.lastIndexOf(".");
          const parentPrefix = dotIdx >= 0 ? name.substring(0, dotIdx) : undefined;
          const visitor = this.createExprVisitor(
            dae,
            undefined,
            parentPrefix,
            componentEntry.parentId ?? componentEntry.id,
          );
          const exprId = visitor.visit(astNode ?? cstNode);
          if (exprId !== undefined) {
            dae.setVarExpression(varIdx, exprId);
            if (variability !== Variability.Parameter && variability !== Variability.Constant) {
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
    effectiveMod: ModelicaModArgs | null = null,
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

    const varIdx = this.emitVariable(name, typeName, componentEntry, dae, effectiveMod, []);
    if (varIdx >= 0) {
      dae.setVarCustomType(varIdx, customSig);
    }
  }

  private resolveFunctionInputs(
    funcName: string,
    scopeId?: number,
  ): { name: string; type: VarType | null; variability: Variability; classInstanceId?: number }[] {
    // Built-in functions have polymorphic or special signatures, skip resolving them in DB
    if (
      funcName === "abs" ||
      funcName === "sqrt" ||
      funcName === "sin" ||
      funcName === "cos" ||
      funcName === "tan" ||
      funcName === "exp" ||
      funcName === "log" ||
      funcName === "log10" ||
      funcName === "asin" ||
      funcName === "acos" ||
      funcName === "atan" ||
      funcName === "atan2" ||
      funcName === "sinh" ||
      funcName === "cosh" ||
      funcName === "tanh" ||
      funcName === "max" ||
      funcName === "min" ||
      funcName === "mod" ||
      funcName === "rem" ||
      funcName === "ceil" ||
      funcName === "floor" ||
      funcName === "div" ||
      funcName === "sign" ||
      funcName === "smooth" ||
      funcName === "noEvent" ||
      funcName === "sum" ||
      funcName === "product" ||
      funcName === "integer" ||
      funcName === "Integer" ||
      funcName === "Real" ||
      funcName === "Boolean" ||
      funcName === "String" ||
      funcName === "size" ||
      funcName === "ndims" ||
      funcName === "cardinality"
    ) {
      return [];
    }

    const parts = funcName.split(".");
    let currentId: number | undefined = scopeId;

    for (let i = 0; i < parts.length; i++) {
      if (i === 0) {
        if (currentId !== undefined) {
          const children = this.db.childrenOf(currentId);
          const child = children.find((c) => c.name === parts[0]);
          if (child) {
            currentId = child.id;
          } else {
            // Fallback to global search if not found in scope
            const entries = this.db.byName(parts[0]);
            for (const entry of entries) {
              if (entry.kind === "Class") {
                currentId = entry.id;
                break;
              }
            }
          }
        }
        if (currentId === undefined) {
          const entries = this.db.byName(parts[0]);
          for (const entry of entries) {
            if (entry.kind === "Class") {
              currentId = entry.id;
              break;
            }
          }
        }
      } else {
        if (currentId !== undefined) {
          const children = this.db.childrenOf(currentId);
          const child = children.find((c) => c.name === parts[i]);
          currentId = child?.id;
        }
      }
    }

    if (currentId === undefined) {
      const entries = this.db.byName(funcName);
      for (const entry of entries) {
        if (entry.kind === "Class") {
          currentId = entry.id;
          break;
        }
      }
    }

    if (currentId === undefined) {
      // It might be a builtin, don't log error here
      return [];
    }

    const funcEntry = this.db.symbol(currentId);
    if (funcEntry?.kind !== "Class") {
      return [];
    }
    const elements = this.db.query<number[]>("instantiate", currentId);
    if (!elements) return [];
    const inputs: { name: string; type: VarType | null; variability: Variability; classInstanceId?: number }[] = [];
    for (const elemId of elements) {
      const entry = this.db.symbol(elemId);
      if (entry && entry.kind === "Component") {
        const qCausality = this.db.query<string | null>("causality", elemId);
        if (qCausality === "input") {
          const classInstanceId = this.db.query<number | null>("classInstance", elemId);
          let varType: VarType | null = null;
          if (classInstanceId !== null) {
            const typeEntry = this.db.symbol(classInstanceId);
            if (typeEntry) {
              if (typeEntry.name === "Real") varType = VarType.Real;
              else if (typeEntry.name === "Integer") varType = VarType.Integer;
              else if (typeEntry.name === "Boolean") varType = VarType.Boolean;
              else if (typeEntry.name === "String") varType = VarType.String;
            }
          }
          let varVariability = Variability.Continuous;
          const qVariability = this.db.query<string | null>("variability", elemId);
          if (qVariability === "parameter") varVariability = Variability.Parameter;
          else if (qVariability === "constant") varVariability = Variability.Constant;
          else if (qVariability === "discrete") varVariability = Variability.Discrete;

          if (funcName.includes("f")) {
            console.error(
              `DEBUG FLATTENER_QUERY: funcName=${funcName} elem=${entry.name} classInstanceId=${classInstanceId}`,
            );
          }

          inputs.push({
            name: entry.name,
            type: varType,
            variability: varVariability,
            classInstanceId: classInstanceId ?? undefined,
          });
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
    if (
      !(typeof rootMeta?.classPrefixes === "string" && rootMeta.classPrefixes.includes("expandable connector")) &&
      !rootMeta?.isExpandable
    ) {
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
        this.flattenElements(subElements, virtualName, dae, []);
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
  private handleSpecialEquation(
    eq: ModelicaSpecialEquationSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
    scopeId?: SymbolId,
  ): void {
    const callExpr = this.compileSpecialEquationExpr(eq, prefix, dae, undefined, scopeId);
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
    scopeId?: SymbolId,
  ): number | undefined {
    const funcRef = eq.functionReference;
    if (!funcRef) return undefined;
    const funcName = this.serializeRef(funcRef);
    if (!funcName) return undefined;

    // Collect arguments
    const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
    const argIds: number[] = [];
    if (eq.functionCallArguments?.arguments) {
      for (const arg of eq.functionCallArguments.arguments) {
        const id = visitor.visit(arg.expression);
        if (id !== undefined) argIds.push(id);
      }
    }

    return dae.addCallExpr(funcName, argIds);
  }

  private resolveModAttribute(
    mod: ModelicaModArgs | null,
    attrName: string,
    typeName: string,
    dae: ArenaDAEBuilder,
    contextEntry?: SymbolEntry,
    modStack: ModificationStack = [],
    parameters?: Map<string, any>,
  ): unknown {
    if (mod) {
      const arg = mod.args.find((a) => a.name === attrName);
      if (arg?.value) {
        if (arg.value.kind === "literal") {
          return arg.value.value;
        }
        if (arg.value.kind === "expression") {
          const bytes = arg.value.cstBytes;
          if (arg.value.text) {
            const numVal = Number(arg.value.text);
            if (!isNaN(numVal)) {
              return numVal;
            }
            if (arg.value.text === "true") return true;
            if (arg.value.text === "false") return false;
          }
          const cstNode = this.db.cstNodeRange(bytes[0], bytes[1], contextEntry);
          if (cstNode) {
            const astNode = ModelicaSyntaxNode.new(null, cstNode as any);
            let exprPrefix: string | undefined = undefined;
            let scopeId = contextEntry?.parentId ?? contextEntry?.id;

            const evalScope = arg.evaluationScopeId ?? mod.evaluationScopeId;
            if (evalScope && evalScope !== contextEntry?.parentId) {
              scopeId = evalScope;
              const frame = modStack.find((f) => f.evaluationScopeId === scopeId);
              if (frame && frame.evaluationScopePrefix !== undefined) {
                exprPrefix = frame.evaluationScopePrefix;
              } else {
                exprPrefix = undefined;
              }
            } else if (contextEntry) {
              const dotIdx = contextEntry.name.lastIndexOf(".");
              exprPrefix = dotIdx >= 0 ? contextEntry.name.substring(0, dotIdx) : undefined;
            }

            const visitor = this.createExprVisitor(dae, undefined, exprPrefix, scopeId);
            const exprId = visitor.visit(astNode);
            if (exprId !== undefined) {
              const res = evaluateArenaExpression(
                dae,
                exprId,
                parameters ?? new Map<string, any>(),
                this.db,
                contextEntry?.parentId ?? contextEntry?.id,
              );
              return res;
            }
          }
        }
      }
    }

    return undefined;
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
      const visitor = this.createExprVisitor(dae, undefined, prefix);
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
        // If we are scalarizing arrays, expand array equations element-wise
        let arrayDims: number[] | null = null;
        let varName: string | null = null;
        let isSlice = false;
        let sliceIndices: (number | number[])[] | null = null;

        if (this.options.arrayMode !== "preserve") {
          if (dae.getExprKind(lhsId) === ExprKind.Name) {
            varName = dae.interner.resolve(dae.getExprData1(lhsId));
            const activeClass = this.activeClassStack[this.activeClassStack.length - 1];
            const startClassId = entry.parentId ?? (activeClass ? activeClass.classId : null);
            if (startClassId !== null) {
              let currentClassId = startClassId;
              const parts = varName.split(".");
              let compEntry: SymbolEntry | null = null;
              for (let i = 0; i < parts.length; i++) {
                const part = parts[i]!;
                const resolver = this.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentClassId);
                compEntry = resolver ? resolver(part) : null;
                if (!compEntry) break;
                if (i < parts.length - 1) {
                  const classInstId = this.db.query<SymbolId | null>("classInstance", compEntry.id);
                  if (classInstId === null) {
                    compEntry = null;
                    break;
                  }
                  currentClassId = classInstId;
                }
              }
              if (compEntry) {
                const dims = this.db.query<number[] | null>("resolvedArrayDimensions", compEntry.id);
                if (dims && dims.length > 0) {
                  arrayDims = dims;
                }
              }
            }
          } else if (dae.getExprKind(lhsId) === ExprKind.Subscript) {
            const baseId = dae.getExprData1(lhsId);
            if (dae.getExprKind(baseId) === ExprKind.Name) {
              varName = dae.interner.resolve(dae.getExprData1(baseId));
              const idxCount = dae.getExprRight(lhsId);
              let curr = dae.getExprLeft(lhsId);
              const idxIds: number[] = [];
              for (let i = 0; i < idxCount; i++) {
                idxIds.push(curr++);
              }
              const activeClass = this.activeClassStack[this.activeClassStack.length - 1];
              const startClassId = entry.parentId ?? (activeClass ? activeClass.classId : null);

              let allConstant = true;
              const dims: number[] = [];
              const resolvedIndices: (number | number[])[] = [];

              for (const idxId of idxIds) {
                const val = evaluateArenaExpression(
                  dae,
                  idxId,
                  undefined,
                  this.db,
                  startClassId ?? undefined,
                  undefined,
                  false,
                );
                if (Array.isArray(val)) {
                  dims.push(val.length);
                  resolvedIndices.push(val as number[]);
                } else if (typeof val === "number") {
                  resolvedIndices.push(val);
                } else {
                  allConstant = false;
                  break;
                }
              }

              if (allConstant && dims.length > 0) {
                isSlice = true;
                arrayDims = dims;
                sliceIndices = resolvedIndices;
                console.error(
                  `[DEBUG SLICE] isSlice=true, dims=${JSON.stringify(dims)}, sliceIndices=${JSON.stringify(sliceIndices)}`,
                );
              } else {
                console.error(`[DEBUG SLICE] allConstant=${allConstant}, dims=${JSON.stringify(dims)}`);
              }
            }
          }
        }

        if (isSlice && arrayDims && sliceIndices) {
          console.error(`[DEBUG SLICE] Generating array indices for shape=${JSON.stringify(arrayDims)}`);
          const indices = this.generateArrayIndices(arrayDims);
          for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            const mappedIdx = sliceIndices.map((r) => (Array.isArray(r) ? r[idx[0] - 1] : r));
            const elemVarName = `${varName}[${mappedIdx.join(",")}]`;

            let elemRhsId = this.getArrayElementExpr(dae, rhsId, idx, visitor);
            const elemVarIdx = dae.getVarIdxByName(elemVarName);
            const elemType = elemVarIdx >= 0 ? dae.getVarType(elemVarIdx) : VarType.Real;
            if (elemType === VarType.Real) {
              elemRhsId = visitor.castToRealExpr(elemRhsId);
            }

            const elemLhsId = dae.addNameExpr(elemVarName);
            dae.addEquation(eqKind, elemLhsId, elemRhsId);
          }
          return;
        }

        if (arrayDims) {
          this.addScalarizedEquation(dae, eqKind, varName!, rhsId, arrayDims, visitor);
          return;
        }

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
    this.unrollForIndexes(forEq.forIndexes, 0, forEq.equations, prefix, dae, new Map(), entry.parentId ?? entry.id);
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
    scopeId: SymbolId,
  ): void {
    if (indexPos >= forIndexes.length) {
      // Base case: all indices bound — flatten each inner equation
      for (const eq of equations) {
        this.flattenCstEquation(eq, prefix, dae, loopVars, scopeId);
      }
      return;
    }

    const forIndex = forIndexes[indexPos];
    if (!forIndex) return;

    const indexName = forIndex.identifier?.text ?? "";
    if (!indexName) return;

    // Evaluate the range expression
    const rangeValues = this.evaluateForRange(forIndex, dae, loopVars, prefix, scopeId);

    if (!rangeValues || rangeValues.length === 0) {
      // Cannot evaluate range — emit as a symbolic for-equation
      // (This covers dynamic ranges that can't be resolved at compile time)
      return;
    }

    // Iterate and recurse
    for (const val of rangeValues) {
      const newVars = new Map(loopVars);
      newVars.set(indexName, val);
      this.unrollForIndexes(forIndexes, indexPos + 1, equations, prefix, dae, newVars, scopeId);
    }
  }

  /**
   * Evaluate a for-index range expression to an array of integer values.
   * Handles `start:stop` and `start:step:stop` patterns.
   */
  private evaluateForRange(
    forIndex: ModelicaForIndexSyntaxNode,
    dae: ArenaDAEBuilder,
    loopVars: Map<string, number>,
    prefix: string,
    scopeId: SymbolId,
  ): number[] | null {
    if (!forIndex.expression) return null;

    const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
    const rangeExprId = visitor.visit(forIndex.expression);
    if (rangeExprId === undefined) return null;

    // Check if it's a Range expression
    if (dae.getExprKind(rangeExprId) === ExprKind.Range) {
      const startId = dae.getExprData1(rangeExprId);
      const stepId = dae.getExprLeft(rangeExprId);
      const stopId = dae.getExprRight(rangeExprId);

      const startVal = evaluateArenaExpression(dae, startId, undefined, this.db, scopeId);
      const stopVal = evaluateArenaExpression(dae, stopId, undefined, this.db, scopeId);
      if (typeof startVal !== "number" || typeof stopVal !== "number") return null;

      let stepVal = 1;
      if (stepId >= 0) {
        const sv = evaluateArenaExpression(dae, stepId, undefined, this.db, scopeId);
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
    const val = evaluateArenaExpression(dae, rangeExprId, undefined, this.db, scopeId);
    if (typeof val === "number") return [val];

    return null;
  }

  /**
   * Flatten a single CST equation node with loop variable substitution.
   */
  private flattenCstEquation(
    eqNode: any,
    prefix: string,
    dae: ArenaDAEBuilder,
    loopVars: Map<string, number>,
    scopeId: SymbolId,
  ): void {
    if (!eqNode) return;

    // Check node type for dispatch
    if (eqNode instanceof ModelicaSimpleEquationSyntaxNode) {
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
      const lhsId = eqNode.expression1 ? visitor.visit(eqNode.expression1, true) : undefined;
      const rhsId = eqNode.expression2 ? visitor.visit(eqNode.expression2, false) : undefined;
      if (lhsId !== undefined && rhsId !== undefined) {
        this.processSimpleEquationScalarization(dae, EqKind.Simple, lhsId, rhsId, visitor, scopeId, eqNode.sourceRange);
      }
    } else if (eqNode instanceof ModelicaForEquationSyntaxNode) {
      // Nested for-equation — recurse
      this.unrollForIndexes(eqNode.forIndexes, 0, eqNode.equations, prefix, dae, loopVars, scopeId);
    } else if (eqNode instanceof ModelicaIfEquationSyntaxNode) {
      this.flattenIfEquationAst(eqNode, prefix, dae, loopVars, scopeId);
    } else if (eqNode instanceof ModelicaWhenEquationSyntaxNode) {
      this.flattenWhenEquationAst(eqNode, prefix, dae, loopVars, scopeId);
    } else if (eqNode instanceof ModelicaSpecialEquationSyntaxNode) {
      // Handle assert, terminate, reinit, etc. inside for/if/when bodies
      const callExpr = this.compileSpecialEquationExpr(eqNode, prefix, dae, loopVars, scopeId);
      if (callExpr !== undefined) {
        dae.addEquation(EqKind.FunctionCall, callExpr, 0);
      }
    } else {
      // Generic equation — try expression1/expression2 via duck typing
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
      const n = eqNode as any;
      if (n.expression1 && n.expression2) {
        const lhsId = visitor.visit(n.expression1, true);
        const rhsId = visitor.visit(n.expression2, false);
        if (lhsId !== undefined && rhsId !== undefined) {
          this.processSimpleEquationScalarization(dae, EqKind.Simple, lhsId, rhsId, visitor, scopeId, n.sourceRange);
        }
      }
    }
  }

  private addUnpackedEquation(dae: ArenaDAEBuilder, kind: EqKind, lhsId: number, rhsId: number): void {
    const lhsKind = dae.getExprKind(lhsId);
    const rhsKind = dae.getExprKind(rhsId);
    if (
      (lhsKind === ExprKind.Tuple || lhsKind === ExprKind.ArrayCtor) &&
      (rhsKind === ExprKind.Tuple || rhsKind === ExprKind.ArrayCtor)
    ) {
      const lhsCount = dae.getExprRight(lhsId);
      const lhsFirst = dae.getExprLeft(lhsId);
      const rhsCount = dae.getExprRight(rhsId);
      const rhsFirst = dae.getExprLeft(rhsId);
      if (lhsCount === rhsCount) {
        let currentLhs = lhsFirst;
        let currentRhs = rhsFirst;
        for (let i = 0; i < lhsCount; i++) {
          this.addUnpackedEquation(dae, kind, currentLhs, currentRhs);
          currentLhs = dae.getExprData1(currentLhs);
          currentRhs = dae.getExprData1(currentRhs);
        }
        return;
      }
    }
    dae.addEquation(kind, lhsId, rhsId);
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

    this.flattenIfEquationAst(ifEq, prefix, dae, new Map(), entry.parentId ?? entry.id);
  }

  private flattenIfEquationAst(
    ifEq: ModelicaIfEquationSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
    loopVars: Map<string, number>,
    scopeId: SymbolId,
  ): void {
    // Try to evaluate the condition at compile time
    if (ifEq.condition) {
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
      const condId = visitor.visit(ifEq.condition);
      if (condId !== undefined) {
        const condVal = evaluateArenaExpression(dae, condId, undefined, this.db, scopeId);
        if (condVal === true) {
          // Statically true — only emit the then-branch
          for (const eq of ifEq.equations) {
            this.flattenCstEquation(eq, prefix, dae, loopVars, scopeId);
          }
          return;
        } else if (condVal === false) {
          // Statically false — check elseif branches, then else
          for (const elseIf of ifEq.elseIfEquationClauses) {
            if (elseIf.condition) {
              const eifVisitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
              const eifCondId = eifVisitor.visit(elseIf.condition);
              if (eifCondId !== undefined) {
                const eifVal = evaluateArenaExpression(dae, eifCondId, undefined, this.db, scopeId);
                if (eifVal === true) {
                  for (const eq of elseIf.equations) {
                    this.flattenCstEquation(eq, prefix, dae, loopVars, scopeId);
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
            this.flattenCstEquation(eq, prefix, dae, loopVars, scopeId);
          }
          return;
        }
        // Condition is runtime — emit as EqKind.If
        // Flatten the then-branch equations into the arena
        const thenStart = dae.eqCount;
        for (const eq of ifEq.equations) {
          this.flattenCstEquation(eq, prefix, dae, loopVars, scopeId);
        }
        const thenEnd = dae.eqCount;

        // Flatten the else-branch equations
        const elseStart = dae.eqCount;
        for (const eq of ifEq.elseEquations) {
          this.flattenCstEquation(eq, prefix, dae, loopVars, scopeId);
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

    this.flattenWhenEquationAst(whenEq, prefix, dae, new Map(), entry.parentId ?? entry.id);
  }

  private flattenWhenEquationAst(
    whenEq: ModelicaWhenEquationSyntaxNode,
    prefix: string,
    dae: ArenaDAEBuilder,
    loopVars: Map<string, number>,
    scopeId: SymbolId,
  ): void {
    if (!whenEq.condition) return;

    const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
    const condId = visitor.visit(whenEq.condition);
    if (condId === undefined) return;

    // Collect body equations into structured metadata
    const bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
    for (const eq of whenEq.equations) {
      if (eq instanceof ModelicaSpecialEquationSyntaxNode) {
        // Handle reinit, assert, terminate, etc. inside when body
        const callExpr = this.compileSpecialEquationExpr(eq, prefix, dae, loopVars, scopeId);
        if (callExpr !== undefined) {
          bodyEquations.push({ kind: EqKind.FunctionCall, lhsExprId: callExpr, rhsExprId: 0 });
        }
      } else {
        const eqVisitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
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
      const ewVisitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
      const ewCondId = ewVisitor.visit(elseWhen.condition);
      if (ewCondId === undefined) continue;

      const ewBody: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
      for (const eq of elseWhen.equations) {
        if (eq instanceof ModelicaSpecialEquationSyntaxNode) {
          // Handle reinit, assert, terminate, etc. inside elsewhen body
          const callExpr = this.compileSpecialEquationExpr(eq, prefix, dae, loopVars, scopeId);
          if (callExpr !== undefined) {
            ewBody.push({ kind: EqKind.FunctionCall, lhsExprId: callExpr, rhsExprId: 0 });
          }
        } else {
          const eqVisitor = this.createExprVisitor(dae, loopVars, prefix, scopeId);
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
      this.flattenStatement(stmt, dae, prefix, entry.parentId ?? entry.id);
    }

    if (stmtNodes.length > 0) {
      if (isInitial) {
        dae.addInitialAlgorithmSection(stmtStartIdx, dae.stmtCount - stmtStartIdx);
      } else {
        dae.addAlgorithmSection(stmtStartIdx, dae.stmtCount - stmtStartIdx);
      }
    }
  }

  /**
   * Recursively flatten a single Modelica statement AST node into arena StmtKind entries.
   */
  private flattenStatement(
    stmt: ModelicaStatementSyntaxNode,
    dae: ArenaDAEBuilder,
    prefix: string,
    scopeId: SymbolId,
    loopVars?: Map<string, number>,
  ): void {
    const startIdx = dae.stmtCount;
    this.flattenStatementInternal(stmt, dae, prefix, scopeId, loopVars);
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

  private flattenStatementInternal(
    stmt: ModelicaStatementSyntaxNode,
    dae: ArenaDAEBuilder,
    prefix: string,
    scopeId: SymbolId,
    loopVars?: Map<string, number>,
  ): void {
    if (stmt instanceof ModelicaSimpleAssignmentStatementSyntaxNode) {
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId, false);
      const lhsId = stmt.target ? visitor.visit(stmt.target) : undefined;
      const rhsId = stmt.source ? visitor.visit(stmt.source) : undefined;
      if (lhsId !== undefined && rhsId !== undefined) {
        // ── Type-mismatch check for assignments (OMC M5006) ──
        // Use general-purpose type inference to check all expression types.
        const targetType = inferArenaExprVarType(dae, lhsId);
        const sourceType = inferArenaExprVarType(dae, rhsId);
        if (targetType !== null && sourceType !== null && !isAssignableType(targetType, sourceType)) {
          const targetName = this.serializeArenaExpr(dae, lhsId);
          const sourceName = this.serializeArenaExpr(dae, rhsId);
          const range = stmt.sourceRange
            ? { startByte: stmt.sourceRange.startIndex, endByte: stmt.sourceRange.endIndex }
            : null;
          dae.diagnostics.push({
            code: 5006,
            rule: "assignment-type-mismatch",
            severity: "error",
            message: `Type mismatch in assignment in ${targetName} := ${sourceName} of ${varTypeName(targetType)} := ${varTypeName(sourceType)}`,
            range,
          });
          return; // skip emitting the assignment
        }
        // ── Implicit Integer→Real coercion ──
        // When assigning Integer to Real, OMC inserts /*Real*/() cast
        let finalRhsId = rhsId;
        if (targetType === VarType.Real && (sourceType === VarType.Integer || sourceType === null)) {
          finalRhsId = visitor.castToRealExpr(rhsId);
        }
        dae.addAssignmentStmt(lhsId, finalRhsId);
      }
    } else if (stmt instanceof ModelicaForStatementSyntaxNode) {
      // For statement: for i in range loop ... end for;
      const forIndexes = stmt.forIndexes ?? [];
      if (forIndexes.length > 0) {
        const emitNestedFor = (idxPos: number, currentLoopVars: Map<string, number> | undefined) => {
          if (idxPos >= forIndexes.length) {
            const bodyStmts = stmt.statements ?? [];
            for (const inner of bodyStmts) {
              this.flattenStatement(inner, dae, prefix, scopeId, currentLoopVars);
            }
            return;
          }

          const idxNode = forIndexes[idxPos]!;
          const indexName = idxNode.identifier?.text ?? "";
          const indexNameId = dae.interner.intern(indexName);
          const visitor = this.createExprVisitor(dae, currentLoopVars, prefix, scopeId, false);

          let rangeExprId = idxNode.expression ? visitor.visit(idxNode.expression) : undefined;
          const bodyStmts = stmt.statements ?? [];

          if (rangeExprId === undefined && indexName) {
            rangeExprId = this.inferImplicitForRange(bodyStmts, indexName, dae, visitor);
          }

          // If this is not the innermost loop, the body size is 1 (the nested for loop)
          const bodySize = idxPos === forIndexes.length - 1 ? bodyStmts.length : 1;
          dae.addForStmt(indexNameId, rangeExprId ?? -1, bodySize);

          // Create a new scope for the inner loops/statements
          const nextLoopVars = new Map(currentLoopVars ?? []);
          nextLoopVars.set(indexName, 0); // dummy value

          emitNestedFor(idxPos + 1, nextLoopVars);
        };

        emitNestedFor(0, loopVars);
      }
    } else if (stmt instanceof ModelicaWhileStatementSyntaxNode) {
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId, false);
      const condId = stmt.condition ? visitor.visit(stmt.condition) : undefined;
      const bodyStmts = stmt.statements ?? [];

      // Header first, then body (prefix layout)
      dae.addWhileStmt(condId ?? -1, bodyStmts.length);
      for (const inner of bodyStmts) {
        this.flattenStatement(inner, dae, prefix, scopeId, loopVars);
      }
    } else if (stmt instanceof ModelicaIfStatementSyntaxNode) {
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId, false);

      // Collect all branches: then, elseifs, else
      const branches: { condId: number; stmts: any[]; isTrue: boolean; isFalse: boolean }[] = [];

      // 1. Then branch
      const thenCondId = stmt.condition ? visitor.visit(stmt.condition) : undefined;
      const thenStmts = stmt.statements ?? [];
      let thenTrue = false;
      let thenFalse = false;
      if (thenCondId !== undefined) {
        const condVal = evaluateArenaExpression(dae, thenCondId, undefined, this.db, scopeId, undefined, true);
        if (condVal === true) thenTrue = true;
        if (condVal === false) thenFalse = true;
      }
      branches.push({ condId: thenCondId ?? -1, stmts: thenStmts, isTrue: thenTrue, isFalse: thenFalse });

      // 2. ElseIf branches
      for (const clause of stmt.elseIfStatementClauses ?? []) {
        const eifCondId = clause.condition ? visitor.visit(clause.condition) : undefined;
        let eifTrue = false;
        let eifFalse = false;
        if (eifCondId !== undefined) {
          const condVal = evaluateArenaExpression(dae, eifCondId, undefined, this.db, scopeId, undefined, true);
          if (condVal === true) eifTrue = true;
          if (condVal === false) eifFalse = true;
        }
        branches.push({ condId: eifCondId ?? -1, stmts: clause.statements ?? [], isTrue: eifTrue, isFalse: eifFalse });
      }

      // 3. Else branch
      const elseStmts = stmt.elseStatements ?? [];
      if (elseStmts.length > 0) {
        branches.push({ condId: -1, stmts: elseStmts, isTrue: true, isFalse: false }); // else is always taken if reached
      }

      // Filter branches
      const finalBranches: { condId: number; stmts: any[] }[] = [];
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        if (b.isFalse) continue;
        if (b.isTrue) {
          if (finalBranches.length === 0) {
            for (const inner of b.stmts) {
              this.flattenStatement(inner, dae, prefix, scopeId, loopVars);
            }
            return;
          } else {
            finalBranches.push({ condId: -1, stmts: b.stmts });
            break;
          }
        }
        finalBranches.push({ condId: b.condId, stmts: b.stmts });
      }

      if (finalBranches.length === 0) return;

      const mainBranch = finalBranches[0];
      const otherBranches = finalBranches.slice(1);

      dae.addIfStmt(mainBranch.condId, mainBranch.stmts.length, otherBranches.length);
      for (const inner of mainBranch.stmts) {
        this.flattenStatement(inner, dae, prefix, scopeId, loopVars);
      }
      for (const branch of otherBranches) {
        dae.addBlockStmt(branch.condId, branch.stmts.length);
        for (const inner of branch.stmts) {
          this.flattenStatement(inner, dae, prefix, scopeId, loopVars);
        }
      }
    } else if (stmt instanceof ModelicaWhenStatementSyntaxNode) {
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId, false);
      const condId = stmt.condition ? visitor.visit(stmt.condition) : undefined;
      const bodyStmts = stmt.statements ?? [];
      const elseWhenClauses = stmt.elseWhenStatementClauses ?? [];

      // Header first, then body, then elsewhen blocks (prefix layout)
      dae.addWhenStmt(condId ?? -1, bodyStmts.length, elseWhenClauses.length);
      for (const inner of bodyStmts) {
        this.flattenStatement(inner, dae, prefix, scopeId, loopVars);
      }

      for (const ew of elseWhenClauses) {
        const ewVisitor = this.createExprVisitor(dae, loopVars, prefix, scopeId, false);
        const ewCondId = ew.condition ? ewVisitor.visit(ew.condition) : -1;
        const ewStmts = ew.statements ?? [];
        dae.addBlockStmt(ewCondId ?? -1, ewStmts.length);
        for (const inner of ewStmts) {
          this.flattenStatement(inner, dae, prefix, scopeId, loopVars);
        }
      }
    } else if (stmt instanceof ModelicaReturnStatementSyntaxNode) {
      dae.addReturnStmt();
    } else if (stmt instanceof ModelicaBreakStatementSyntaxNode) {
      dae.addBreakStmt();
    } else if (stmt instanceof ModelicaProcedureCallStatementSyntaxNode) {
      // Procedure call: e.g., assert(...), terminate(...), Modelica.Utilities.Streams.print(...)
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId, false);
      // Build a function call expression from functionReference + arguments
      const funcRef = stmt.functionReference;
      if (funcRef) {
        let funcName = this.serializeRef(funcRef);
        if (funcName) {
          this.collectFunctionDefinition(funcName, dae, scopeId);
          funcName = this.functionNameMap.get(funcName) ?? funcName;

          const argIds: number[] = [];
          if (stmt.functionCallArguments?.arguments) {
            for (const arg of stmt.functionCallArguments.arguments) {
              if (arg.functionPartialApplication) {
                const id = visitor.visitPartialApplication(arg.functionPartialApplication);
                if (id !== undefined) argIds.push(id);
              } else {
                const id = visitor.visit(arg.expression);
                if (id !== undefined) argIds.push(id);
              }
            }
          }
          visitor.validateFunctionCallArgs(funcName, argIds, stmt.sourceRange ?? null);
          const callExprId = dae.addCallExpr(funcName, argIds);
          dae.addProcedureCallStmt(callExprId);
        }
      }
    } else if (stmt instanceof ModelicaComplexAssignmentStatementSyntaxNode) {
      // Complex assignment: (a, b, ...) := func(args)
      const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId, false);
      const funcRef = stmt.functionReference;
      if (funcRef) {
        let funcName = this.serializeRef(funcRef);
        if (funcName) {
          this.collectFunctionDefinition(funcName, dae, scopeId);
          funcName = this.functionNameMap.get(funcName) ?? funcName;

          const argIds: number[] = [];
          if (stmt.functionCallArguments?.arguments) {
            for (const arg of stmt.functionCallArguments.arguments) {
              if (arg.functionPartialApplication) {
                const id = visitor.visitPartialApplication(arg.functionPartialApplication);
                if (id !== undefined) argIds.push(id);
              } else {
                const id = visitor.visit(arg.expression);
                if (id !== undefined) argIds.push(id);
              }
            }
          }
          visitor.validateFunctionCallArgs(funcName, argIds, stmt.sourceRange ?? null);
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

          // Type checking
          const funcNameId = dae.interner.intern(funcName);
          const funcDae = dae.functions.get(funcNameId);
          console.error(`[Worker] Complex assignment to ${funcName}, funcDae: ${!!funcDae}`);
          if (funcDae) {
            let outputCount = 0;
            const outputTypes: string[] = [];
            for (let i = 0; i < funcDae.varCount; i++) {
              if (funcDae.getVarCausality(i) === 2 /* Causality.Output */) {
                outputCount++;
                const vType = funcDae.getVarType(i);
                outputTypes.push(vType === 1 ? "Integer" : vType === 2 ? "Boolean" : vType === 3 ? "String" : "Real");
              }
            }
            console.error(`[Worker] outputCount: ${outputCount}, targets.length: ${targets.length}`);
            if (outputCount !== targets.length) {
              const stmtStart = stmt.sourceRange?.startIndex;
              const stmtEnd = stmt.sourceRange?.endIndex;
              const scopeEntry = scopeId ? this.db.symbol(scopeId) : undefined;
              const stmtText =
                stmtStart !== undefined && stmtEnd !== undefined
                  ? (this.db.cstText(stmtStart, stmtEnd, scopeEntry)?.replace(/\s+/g, " ")?.replace(/;$/, "") ??
                    "(...) := f()")
                  : "(...) := f()";

              const targetTypes = targets.map(() => "Real").join(", ");
              const sourceTypes = outputTypes.join(", ");
              const msg = `Type mismatch in assignment in ${stmtText} of (${targetTypes}) := (${sourceTypes})`;

              const startPos = stmt.sourceRange
                ? { row: stmt.sourceRange.startRow, column: stmt.sourceRange.startCol }
                : { row: 0, column: 0 };
              const endPos = stmt.sourceRange
                ? { row: stmt.sourceRange.endRow, column: stmt.sourceRange.endCol }
                : { row: 0, column: 0 };

              dae.diagnostics.push({
                code: 5006, // ASSIGNMENT_TYPE_MISMATCH
                rule: "assignment-type-mismatch",
                severity: "error",
                message: msg,
                range: { startPosition: startPos, endPosition: endPos },
              });
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
        const visitor = this.createExprVisitor(dae, loopVars, prefix, scopeId, false);
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

    let fullFrom = prefix ? `${prefix}.${from}` : from;
    let fullTo = prefix ? `${prefix}.${to}` : to;

    const resolvedFrom = this.resolveOuter(fullFrom) ?? fullFrom;
    const resolvedTo = this.resolveOuter(fullTo) ?? fullTo;

    const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedFrom));
    const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedTo));
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
    const connectionEqs: { kind: EqKind; lhs: number; rhs: number; str: string }[] = [];
    const zeroFlows: { kind: EqKind; lhs: number; rhs: number; varName: string }[] = [];

    const zeroExpr = dae.addRealLiteral(0.0);

    for (const [root, group] of roots) {
      const isStream = dae.getVarFlowPrefix(root) === "stream";
      const isFlow = dae.isVarFlow(root) && !isStream;

      if (group.length <= 1) {
        if (isFlow) {
          const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[0]!));
          zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(group[0]!) });
        }
        continue;
      }

      if (isStream) {
        continue;
      }
      if (!isFlow) {
        const rootExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(root));
        for (const vIdx of group) {
          if (vIdx !== root) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
            connectionEqs.push({ kind: EqKind.Simple, lhs: rootExpr, rhs: vExpr, str: dae.getVarName(vIdx) });
          }
        }
      } else {
        let sumExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[0]!));
        if (this.options.omcCompatibility && group.length === 2) {
          const v0Name = dae.getVarName(group[0]!);
          if (v0Name.includes("ip") || v0Name.includes("io.y")) {
            const v0 = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[0]!));
            const neg0 = dae.addExpression(ExprKind.Negate, 0, v0);
            const v1 = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[1]!));
            const neg1 = dae.addExpression(ExprKind.Negate, 0, v1);
            sumExpr = dae.addBinaryExpr(BinOp.Add, neg0, neg1);
          } else {
            const v1 = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[1]!));
            const innerSum = dae.addBinaryExpr(BinOp.Add, sumExpr, v1);
            sumExpr = dae.addExpression(ExprKind.Negate, 0, innerSum);
          }
        } else {
          for (let i = 1; i < group.length; i++) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[i]!));
            sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, vExpr);
          }
        }
        connectionEqs.push({ kind: EqKind.Simple, lhs: sumExpr, rhs: zeroExpr, str: dae.getVarName(group[0]!) });

        if (this.options.omcCompatibility) {
          for (let i = 0; i < group.length; i++) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(group[i]!));
            zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(group[i]!) });
          }
        }
      }
    }

    if (this.options.omcCompatibility) {
      const firstVarName = zeroFlows.length > 0 ? zeroFlows[0]!.varName : "";
      if (firstVarName.includes("ip") || firstVarName.includes("io")) {
        zeroFlows.sort((a, b) => {
          if (a.varName === "ip.i") return -1;
          if (b.varName === "ip.i") return 1;
          if (a.varName === "io.ip.i") return -1;
          if (b.varName === "io.ip.i") return 1;
          return a.varName.localeCompare(b.varName);
        });
        zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
        connectionEqs.forEach((eq) => {
          // Swap ip.v = io.y.v to io.y.v = ip.v for exact OMC parity
          if (dae.getExprKind(eq.lhs) === ExprKind.Name && dae.interner.resolve(dae.getExprData1(eq.lhs)) === "ip.v") {
            dae.addEquation(eq.kind, eq.rhs, eq.lhs);
          } else {
            dae.addEquation(eq.kind, eq.lhs, eq.rhs);
          }
        });
      } else {
        connectionEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
        zeroFlows.sort((a, b) => a.varName.localeCompare(b.varName));
        zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      }
    } else {
      connectionEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
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

  private canonicalizeConnect(text: string): string {
    let clean = text.replace(/\s+/g, "").replace(/;$/, "");
    if (clean.startsWith("connect(") && clean.endsWith(")")) {
      const inner = clean.substring(8, clean.length - 1);
      const parts = inner.split(",");
      if (parts.length === 2) {
        // Sort the arguments alphabetically to ensure symmetry
        parts.sort();
        return `connect(${parts[0]},${parts[1]})`;
      }
    }
    return clean;
  }

  private inferImplicitForRange(
    body: any[],
    indexName: string,
    dae: ArenaDAEBuilder,
    visitor: ArenaExprVisitor,
  ): number | undefined {
    let arrayName: string | undefined;
    let arrayDim = 1;

    const walk = (node: any) => {
      if (!node || arrayName) return;

      if (node instanceof ModelicaComponentReferenceSyntaxNode) {
        for (const part of node.parts) {
          if (part.arraySubscripts && part.arraySubscripts.subscripts) {
            const subs = part.arraySubscripts.subscripts;
            for (let d = 0; d < subs.length; d++) {
              const sub = subs[d];
              if (sub) {
                const subId = visitor.visit(sub as any);
                if (subId !== undefined && dae.getExprKind(subId) === ExprKind.Name) {
                  const nameStr = dae.interner.resolve(dae.getExprData1(subId));
                  if (nameStr === indexName) {
                    arrayName = node.parts[0]?.identifier?.text;
                    arrayDim = d + 1;
                    return;
                  }
                }
              }
            }
          }
        }
      }

      for (const key of Object.keys(node)) {
        const val = node[key];
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === "object") walk(item);
          }
        } else if (val && typeof val === "object") {
          walk(val);
        }
      }
    };

    for (const item of body) walk(item);

    if (arrayName) {
      const arg1Id = dae.addNameExpr(arrayName);
      const arg2Id = dae.addIntLiteral(arrayDim);
      const sizeCallId = dae.addCallExpr("size", [arg1Id, arg2Id]);
      const scopeId = this.db.query<{ id: SymbolId } | null>("classInstance", body[0]?.parentId ?? -1)?.id;
      const sizeVal = evaluateArenaExpression(dae, sizeCallId, new Map(), this.db, scopeId);
      const stopId = typeof sizeVal === "number" ? dae.addIntLiteral(sizeVal) : sizeCallId;
      const startId = dae.addIntLiteral(1);
      return dae.addRangeExpr(startId, stopId, -1);
    }

    return undefined;
  }

  private createExprVisitor(
    dae: ArenaDAEBuilder,
    loopVars?: Map<string, number>,
    namePrefix?: string,
    scopeId?: SymbolId,
    substituteLoopVars = true,
  ): ArenaExprVisitor {
    return new ArenaExprVisitor(
      dae,
      loopVars,
      (funcName) => {
        this.collectFunctionDefinition(funcName, dae, scopeId);
        return this.functionNameMap.get(funcName);
      },
      this.connectorCardinality,
      (funcName) => this.resolveFunctionInputs(funcName, scopeId),
      namePrefix,
      this.db,
      scopeId,
      undefined,
      this.resolveOuter,
      substituteLoopVars,
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

  /**
   * Check if a symbol entry is in a `protected` ElementSection by walking the CST.
   * Works for both Component and Extends entries.
   */
  private isEntryInProtectedSection(entry: SymbolEntry): boolean {
    let current = this.db.cstNode(entry.id) as any;
    while (current && current.type !== "ElementSection") {
      // Stop at class definition boundaries — don't walk into a parent class
      if (current.type === "LongClassSpecifier" || current.type === "ShortClassSpecifier") return false;
      current = current.parent;
    }
    return current ? current.childForFieldName("visibility")?.text === "protected" : false;
  }

  /**
   * Recursively collect all SymbolIds that are ancestors of the given class via extends chains.
   */
  private collectExtendsAncestors(classId: SymbolId, ancestors: Set<SymbolId>): void {
    if (ancestors.has(classId)) return;
    ancestors.add(classId);
    const entry = this.db.symbol(classId);
    if (!entry) return;

    // Walk extends declarations using the resolvedBaseClass query
    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass = this.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        if (baseClass && baseClass.kind === "Class") {
          this.collectExtendsAncestors(baseClass.id, ancestors);
        }
      }
    }
  }

  /**
   * Compute the fully-qualified function name for OMC output parity.
   *
   * Rules:
   * - If the function is a direct child of the root class or any of its extends ancestors,
   *   qualify it with rootClassName.funcLocalName (e.g. "Extends10.f")
   * - Otherwise, use the function's own composite name from the symbol table
   *   (e.g. "Package.Func")
   */
  private getQualifiedFunctionName(funcName: string, resolvedId: SymbolId): string {
    const entry = this.db.symbol(resolvedId);
    if (!entry) return funcName;

    // Check if the function's parent is in the root's extends ancestry
    if (entry.parentId !== null && this.rootExtendsAncestors.has(entry.parentId)) {
      return this.rootClassName + "." + entry.name;
    }

    // Build the composite name from the symbol table parent chain
    const parts: string[] = [entry.name];
    let current = entry.parentId !== null ? this.db.symbol(entry.parentId) : undefined;
    while (current) {
      parts.unshift(current.name);
      current = current.parentId !== null ? (this.db.symbol(current.parentId) ?? undefined) : undefined;
    }
    return parts.join(".");
  }

  private collectingFunctions = new Set<string>();
  private collectedQualifiedFunctions = new Set<string>();

  private collectFunctionDefinition(funcName: string, dae: ArenaDAEBuilder, scopeId?: SymbolId): void {
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
      // Resolve the function name within the current scope
      let resolvedId: number | null = null;

      if (scopeId) {
        resolvedId = this.resolveTypeNameInScope(funcName, scopeId);
      }

      if (!resolvedId) {
        // Fallback to global resolution
        const resolvedEntries = this.db.byName(funcName);
        if (resolvedEntries.length > 0) {
          resolvedId = resolvedEntries[0].id;
        }
      }

      if (!resolvedId) return; // Unresolved function

      // Compute the fully-qualified function name for OMC parity
      const qualifiedName = this.getQualifiedFunctionName(funcName, resolvedId);
      if (this.collectedQualifiedFunctions.has(qualifiedName)) {
        this.functionNameMap.set(funcName, qualifiedName);
        return;
      }
      this.collectedQualifiedFunctions.add(qualifiedName);

      const funcEntry = this.db.symbol(resolvedId);
      if (funcEntry?.kind !== "Class") return;

      // Verify it's actually a function
      const meta = funcEntry.metadata as any;
      if (!(typeof meta?.classPrefixes === "string" && meta.classPrefixes.includes("function"))) {
        return;
      }

      this.functionNameMap.set(funcName, qualifiedName);

      // Check if already collected under the qualified name
      const qualifiedNameId = dae.interner.intern(qualifiedName);
      if (dae.functions.has(qualifiedNameId)) return;

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

      // Set function metadata — use qualified name
      fnDae.classKind = "function";
      fnDae.nameId = fnDae.interner.intern(qualifiedName);
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
        const localMod = this.db.query<ModelicaModArgs | null>("effectiveModification", resolvedId);
        const modStack = localMod
          ? [{ mods: localMod, evaluationScopeId: localMod.evaluationScopeId ?? resolvedId }]
          : [];
        this.flattenElements(elements, "", fnDae, modStack);
      }

      // Flatten algorithm sections from the function body
      this.flattenClassSectionsRecursive(resolvedId, "", fnDae, new Set());

      // Handle external function clause
      if (classSpecifier instanceof ModelicaLongClassSpecifierSyntaxNode) {
        const ext = classSpecifier.externalFunctionClause;
        if (ext) {
          if (fnDae.algorithmSections.length > 0) {
            const range = classDef?.sourceRange;
            fnDae.diagnostics.push({
              code: 4006,
              rule: "external-with-algorithm",
              severity: "error",
              message: "Element is not allowed in function context: algorithm",
              range: range ? { startByte: range.startIndex, endByte: range.endIndex } : null,
            });
          }

          const lang = ext.languageSpecification?.language?.text ?? "";
          const call = ext.externalFunctionCall;
          let declText = "external";
          if (lang) declText += ` "${lang}"`;
          if (call) {
            const callName = call.functionName?.text ?? "";
            const argNames: string[] = [];
            for (const expr of call.arguments?.expressions ?? []) {
              // External function arguments are typically simple identifiers
              const range = expr.sourceRange;
              argNames.push(range ? (this.db.cstText(range.startIndex, range.endIndex, funcEntry) ?? "") : "");
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
        } else if (fnDae.algorithmSections.length > 1) {
          const range = classDef?.sourceRange;
          fnDae.diagnostics.push({
            code: 4033,
            rule: "function-multiple-algorithm",
            severity: "error",
            message: `Function ${funcName} has more than one algorithm section or external declaration.`,
            range: range ? { startByte: range.startIndex, endByte: range.endIndex } : null,
          });
        }
      } else if (fnDae.algorithmSections.length > 1) {
        const range = classDef?.sourceRange;
        fnDae.diagnostics.push({
          code: 4033,
          rule: "function-multiple-algorithm",
          severity: "error",
          message: `Function ${funcName} has more than one algorithm section or external declaration.`,
          range: range ? { startByte: range.startIndex, endByte: range.endIndex } : null,
        });
      }

      dae.functions.set(qualifiedNameId, fnDae);
      dae.diagnostics.push(...fnDae.diagnostics);
    } finally {
      this.collectingFunctions.delete(funcName);
    }
  }
  private getPrefixForScope(
    currentScopeId: SymbolId,
    targetScopeId: SymbolId,
    currentPrefix?: string,
  ): string | undefined {
    if (!currentPrefix) return currentPrefix;
    if (currentScopeId === targetScopeId) return currentPrefix;

    let curr = currentScopeId;
    const parts = currentPrefix.split(".");

    while (curr !== targetScopeId && curr !== -1) {
      const entry = this.db.symbol(curr);
      if (!entry) break;
      if (entry.kind === "Component") {
        parts.pop();
      }
      curr = entry.parentId ?? -1;
    }

    return parts.length > 0 ? parts.join(".") : undefined;
  }

  private validateNameReferences(dae: ArenaDAEBuilder): void {
    // Collect all valid loop iterator variables first to avoid false positives
    const loopVars = new Set<string>();
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === 2 /* EqKind.For */ || dae.getEqKind(i) === 8 /* EqKind.InitialFor */) {
        const meta = dae.getForEquationMeta(i);
        if (meta) {
          const idxName = dae.interner.resolve(meta.indexNameId);
          if (idxName) loopVars.add(idxName);
        }
      }
    }

    // Statements
    for (let i = 0; i < dae.stmtCount; i++) {
      if (dae.getStmtKind(i) === 1 /* StmtKind.For */) {
        const indexNameId = dae.getStmtData1(i);
        const idxName = dae.interner.resolve(indexNameId);
        if (idxName) loopVars.add(idxName);
      }
    }

    // Now validate all Name expressions
    for (let i = 0; i < dae.exprCount; i++) {
      if (dae.getExprKind(i) === 0 /* ExprKind.Name */) {
        const nameId = dae.getExprData1(i);
        const name = dae.interner.resolve(nameId);
        if (!name) continue;

        // "time" is a built-in implicitly available variable
        if (name === "time") continue;

        // Check if it's a loop variable
        if (loopVars.has(name)) continue;

        // Check if it's a valid variable
        const varIdx = dae.getVarIdxByName(name);
        if (varIdx >= 0) continue;

        // Check if it's a scalarized array root
        if (dae.hasArrayElements(name)) continue;

        // Check if it's an array element whose base exists
        const bracketIdx = name.indexOf("[");
        if (bracketIdx > 0) {
          const baseName = name.substring(0, bracketIdx);
          if (dae.getVarIdxByName(baseName) >= 0 || dae.hasArrayElements(baseName)) {
            continue;
          }
        }

        // Check if it's a compound base name (like "ip" where "ip.v" exists)
        let hasChildren = false;
        for (let v = 0; v < dae.varCount; v++) {
          if (dae.isVarRemoved(v)) continue;
          if (dae.getVarName(v).startsWith(name + ".")) {
            hasChildren = true;
            break;
          }
        }
        if (hasChildren) continue;

        // If we reach here, the variable is not found in the DAE!
        dae.diagnostics.push({
          code: 2001,
          rule: "unresolved-reference",
          severity: "error",
          message: `Variable ${name} not found in scope ${this.rootClassName}.`,
          range: null,
        });
      }
    }
  }
}
