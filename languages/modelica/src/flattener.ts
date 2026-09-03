// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Query Flattener (TypeScript Host Bridge).
 *
 * Coordinates host-side Salsa QueryDB / SymbolIndex data with the high-performance
 * native WebAssembly Semantic Flattening Kernel (`src/flattener-wasm.ts`).
 */

import { createChunkedUint32Array, EqKind, ExprKind, type ChunkedUint32Array } from "@modelscript/language";
import {
  Causality,
  DAEBuilder,
  eliminateArenaAliases,
  foldArenaConstants,
  scalarizeArena,
  Variability,
  VarType,
  type QueryDB,
  type SymbolId,
  type TopologyGraph,
} from "@modelscript/language/compiler";
import { ModelicaPortBalancer } from "./connections.js";

export interface FlattenOptions {
  arrayMode?: "scalarize" | "preserve";
  functionInlining?: boolean;
  omcCompatibility?: boolean;
  eliminateAliases?: boolean;
}

export class ModelicaModificationEnv {
  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  flags: ChunkedUint32Array;
  count: number;
  parentEnvPtr: number;

  init(parentPtr = 0): void {
    this.keyHashes = createChunkedUint32Array(256);
    this.valExprIds = createChunkedUint32Array(256);
    this.flags = createChunkedUint32Array(256);
    this.count = 0;
    this.parentEnvPtr = parentPtr;
  }

  bind(keyHash: number, valExprId: number, isFinal = false, isEach = false): void {
    const idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    const f: number = (isFinal ? 1 : 0) | (isEach ? 2 : 0);
    this.flags.set(idx, f);
  }

  lookup(keyHash: number): number {
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) === keyHash) {
        return this.valExprIds.get(i);
      }
    }
    return 0xffffffff;
  }
}

/**
 * High-performance Salsa Query Flattener delegating to native WASM flattening kernel.
 */
interface ComponentInstanceData {
  typeSpecifier?: string | null;
  variability?: string | null;
  causality?: string | null;
  arrayDimensions?: number[] | null;
  modification?: {
    bindingExpression?: {
      text?: string;
    } | null;
  } | null;
}

export class ModelicaFlattener {
  bodySnapshot: DAEBuilder | null = null;

  private options: Required<Pick<FlattenOptions, "arrayMode" | "functionInlining" | "omcCompatibility">> &
    Pick<FlattenOptions, "eliminateAliases">;

  constructor(
    private db: QueryDB,
    options?: FlattenOptions,
  ) {
    this.options = {
      arrayMode: options?.arrayMode ?? "scalarize",
      functionInlining: options?.functionInlining ?? false,
      omcCompatibility: options?.omcCompatibility ?? false,
      eliminateAliases: options?.eliminateAliases ?? true,
    };
  }

  /**
   * Flattens a Modelica class definition (Context compatibility signature).
   */
  flatten(rootClassId: SymbolId, cachedArena?: DAEBuilder | null, options?: FlattenOptions): DAEBuilder {
    if (options) {
      if (options.arrayMode !== undefined) this.options.arrayMode = options.arrayMode;
      if (options.functionInlining !== undefined) this.options.functionInlining = options.functionInlining;
      if (options.omcCompatibility !== undefined) this.options.omcCompatibility = options.omcCompatibility;
      if (options.eliminateAliases !== undefined) this.options.eliminateAliases = options.eliminateAliases;
    }
    const dae = this.flattenClass(rootClassId);
    this.bodySnapshot = dae.clone();
    return dae;
  }

  /**
   * Flattens a Modelica class definition into a flat Arena DAE.
   */
  flattenClass(rootClassId: SymbolId): DAEBuilder {
    const rootEntry = this.db.symbol(rootClassId);
    const className = rootEntry?.name ?? "Model";
    const dae = new DAEBuilder(undefined, className, "");

    // 1. Layer 1: Component instantiation via Salsa database
    const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);
    if (elements) {
      this.instantiateElements(elements, "", dae);
    }

    // 2. Layer 2: Extract equation sections and algorithms
    this.extractClassEquations(rootClassId, "", dae);

    // 3. Layer 3: Physical connector expansion & flow balance
    ModelicaPortBalancer.expandConnections(dae, { omcCompatibility: this.options.omcCompatibility });

    // 4. Constant folding and alias elimination
    foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    if (this.options.arrayMode === "preserve") {
      return scalarizeArena(dae);
    }

    dae.groupEquationsForParity();
    return dae;
  }

  /**
   * Flattens a multi-domain system from a SysML TopologyGraph.
   */
  flattenFromTopology(graph: TopologyGraph): DAEBuilder {
    const dae = new DAEBuilder(undefined, "HybridSystem", "");

    for (const rootId of graph.rootIds) {
      const node = graph.nodes.get(rootId);
      if (node?.targetClassId) {
        const elements = this.db.query<SymbolId[]>("instantiate", node.targetClassId);
        if (elements) {
          this.instantiateElements(elements, node.path, dae);
        }
      }
    }

    for (const edge of graph.edges) {
      const srcNode = graph.nodes.get(edge.sourceId);
      const tgtNode = graph.nodes.get(edge.targetId);
      if (srcNode && tgtNode) {
        const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(srcNode.path));
        const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(tgtNode.path));
        dae.addEquation(EqKind.Connect, lhsId, rhsId);
      }
    }

    ModelicaPortBalancer.expandConnections(dae, { omcCompatibility: this.options.omcCompatibility });

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    return dae;
  }

  private instantiateElements(elements: SymbolId[], prefix: string, dae: DAEBuilder): void {
    for (const elemId of elements) {
      const elem = this.db.symbol(elemId);
      if (!elem) continue;

      const name = prefix ? `${prefix}.${elem.name}` : elem.name;
      if (elem.kind === "Component") {
        const compInst = this.db.query<ComponentInstanceData | null>("componentInstance", elem.id);
        const meta = elem.metadata as Record<string, unknown> | undefined;

        let varType = VarType.Real;
        if (compInst?.typeSpecifier === "Integer") varType = VarType.Integer;
        else if (compInst?.typeSpecifier === "Boolean") varType = VarType.Boolean;
        else if (compInst?.typeSpecifier === "String") varType = VarType.String;
        else if (typeof meta?.varType === "number") varType = meta.varType as number;

        let variability = Variability.Continuous;
        if (compInst?.variability === "parameter") variability = Variability.Parameter;
        else if (compInst?.variability === "constant") variability = Variability.Constant;
        else if (compInst?.variability === "discrete") variability = Variability.Discrete;
        else if (typeof meta?.variability === "number") variability = meta.variability as number;

        let causality = Causality.Local;
        if (compInst?.causality === "input") causality = Causality.Input;
        else if (compInst?.causality === "output") causality = Causality.Output;
        else if (typeof meta?.causality === "number") causality = meta.causality as number;

        const arrayDims =
          compInst?.arrayDimensions ??
          (Array.isArray(meta?.arrayDimensions) ? (meta.arrayDimensions as number[]) : null);
        if (arrayDims && arrayDims.length > 0) {
          const totalElements = arrayDims.reduce((acc: number, val: number) => acc * val, 1);
          for (let idx = 1; idx <= totalElements; idx++) {
            const arrVarName = `${name}[${idx}]`;
            const varIdx = dae.addVariable(
              dae.interner.intern(arrVarName),
              varType as number,
              variability as number,
              causality as number,
              0.0,
            );
            if (compInst?.modification?.bindingExpression?.text) {
              const exprId = dae.addExpression(
                ExprKind.Name,
                dae.interner.intern(compInst.modification.bindingExpression.text),
              );
              dae.setVarExpression(varIdx, exprId);
            }
          }
        } else {
          const varIdx = dae.addVariable(
            dae.interner.intern(name),
            varType as number,
            variability as number,
            causality as number,
            0.0,
          );
          if (compInst?.modification?.bindingExpression?.text) {
            const exprId = dae.addExpression(
              ExprKind.Name,
              dae.interner.intern(compInst.modification.bindingExpression.text),
            );
            dae.setVarExpression(varIdx, exprId);
          }
        }
      }
    }
  }

  private extractClassEquations(classId: SymbolId, prefix: string, dae: DAEBuilder): void {
    const cst = this.db.cstNode(classId);
    if (cst) {
      interface CSTWalkerNode {
        type?: string;
        text?: string;
        children?: CSTWalkerNode[];
      }
      const walk = (node: CSTWalkerNode): void => {
        if (!node) return;
        if (
          node.type === "simple_equation" ||
          node.type === "SimpleEquation" ||
          node.type === "equality_equation" ||
          node.type === "EqualityEquation"
        ) {
          const expressions = (node.children || []).filter((c) => c.type === "expression" || c.type === "Expression");
          if (expressions.length >= 2) {
            const lhs = expressions[0];
            const rhs = expressions[1];
            const lhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(lhs?.text ? lhs.text.trim() : ""));
            const rhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(rhs?.text ? rhs.text.trim() : ""));
            dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
          }
        }
        for (const kid of node.children || []) {
          if (kid.type !== "class_definition" && kid.type !== "ClassDefinition") {
            walk(kid);
          }
        }
      };
      walk(cst as CSTWalkerNode);
    }

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseTargets = this.db.byName(child.name);
        for (const target of baseTargets) {
          if (target.kind === "Class") {
            this.extractClassEquations(target.id, prefix, dae);
          }
        }
      }
    }
  }
}

export { ModelicaFlattener as ArenaQueryFlattener };
