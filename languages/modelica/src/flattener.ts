// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Query Flattener (TypeScript Host Bridge).
 *
 * Coordinates host-side Salsa QueryDB / SymbolIndex data with the high-performance
 * native WebAssembly Semantic Flattening Kernel (`src/flattener-wasm.ts`).
 */

import { createChunkedUint32Array, EqKind, ExprKind, type ChunkedUint32Array } from "@modelscript/language";
import {
  DAEBuilder,
  eliminateArenaAliases,
  foldArenaConstants,
  scalarizeArena,
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
        const varType = (elem.metadata as Record<string, unknown>)?.varType ?? 0;
        const variability = (elem.metadata as Record<string, unknown>)?.variability ?? 0;
        const causality = (elem.metadata as Record<string, unknown>)?.causality ?? 0;

        dae.addVariable(dae.interner.intern(name), varType as number, variability as number, causality as number, 0.0);
      }
    }
  }

  private extractClassEquations(classId: SymbolId, prefix: string, dae: DAEBuilder): void {
    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Equation") {
        // Equation nodes
      } else if (child.kind === "Extends") {
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
