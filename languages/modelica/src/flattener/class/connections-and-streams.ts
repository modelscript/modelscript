// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TopologyGraph } from "@modelscript/diagram";
import { ExprKind } from "@modelscript/dsl";
import { DAEBuilder, eliminateArenaAliases, EqKind, foldArenaConstants, type SymbolId } from "@modelscript/runtime";
import { ModelicaPortBalancer } from "../../connections.js";
import { extractStateMachines, processExpandableConnectors, propagateImpureFunctions } from "../elaboration/index.js";
import { getFlatteningState } from "../support/state.js";
import type { WasmBailInfo } from "../support/wasm-bail-reasons.js";
import { populateShowAnnotations } from "./annotations-and-extensions.js";
import type { ClassFlattenerContext, CstNodeLike, DaeWithExtras, WasmDiffStats } from "./types.js";

export interface ConnectionsFinalizeCallbacks {
  generateOmcFunctions: () => void;
  consumeWasmDiffStats: () => WasmDiffStats | null | undefined;
}

export function runConnectionsAndFinalize(
  ctx: ClassFlattenerContext,
  dae: DAEBuilder,
  rootClassId: SymbolId,
  classCst: CstNodeLike | null,
  flattenedInWasm: boolean,
  isOldFrontend: boolean,
  shouldScalarize: boolean,
  flowThreshold: number | undefined,
  wasmBail: WasmBailInfo | null,
  callbacks: ConnectionsFinalizeCallbacks,
): DAEBuilder {
  const varCountBeforeConnections = dae.varCount;
  const eqCountBeforeConnections = dae.eqCount;
  const exprCountBeforeConnections = dae.exprCount;

  // 2.6 Expandable connector dynamic augmentation, cross-bus pooling, and variable pruning
  if (!flattenedInWasm) {
    processExpandableConnectors(rootClassId, dae, ctx.db, ctx.expandableBuses);
  }

  // 3. Layer 3: Physical connector expansion & flow balance
  const connState = getFlatteningState(dae, ctx);
  connState.db = ctx.db;
  connState.flattener = ctx;
  connState.currentClassId = rootClassId;
  connState.currentRootClassId = rootClassId;
  ModelicaPortBalancer.expandConnections(dae, {
    omcCompatibility: ctx.options.omcCompatibility,
    useWasmKernel: ctx.options.useWasmKernel,
    isOldFrontend,
    flowThreshold,
  });

  // 4. Constant folding and alias elimination
  if (
    shouldScalarize ||
    ctx.expandableBuses.size > 0 ||
    dae.varCount !== varCountBeforeConnections ||
    dae.eqCount !== eqCountBeforeConnections ||
    dae.exprCount !== exprCountBeforeConnections
  ) {
    foldArenaConstants(dae, ctx.db, rootClassId, ctx.options.omcCompatibility);
  }

  if (ctx.options.eliminateAliases) {
    eliminateArenaAliases(dae);
  }

  if (flattenedInWasm) {
    for (let vi = 0; vi < dae.varCount; vi++) {
      const b = dae.getVarBindingExpr(vi) ?? -1;
      if (b < 0) continue;
      const bk = dae.getExprKind(b);
      if (bk === ExprKind.ArrayCtor || bk === ExprKind.Tuple) {
        const vName = dae.getVarName(vi);
        if (!vName.includes("[")) {
          let elem0 = dae.getExprLeft(b);
          while (elem0 >= 0 && dae.getExprKind(elem0) === ExprKind.Tuple) {
            elem0 = dae.getExprLeft(elem0);
          }
          if (elem0 >= 0) {
            dae.setVarExpression(vi, elem0);
          }
        }
      }
    }
  }

  if (ctx.options.omcCompatibility) {
    callbacks.generateOmcFunctions();
    propagateImpureFunctions(dae);
  }

  const attachDiffReport = (targetDae: DAEBuilder) => {
    const wasmDiff = callbacks.consumeWasmDiffStats();
    if (wasmDiff) {
      (targetDae as DaeWithExtras).diffReport = wasmDiff;
      if (process.env["DEBUG_DIFF"] === "1") {
        if (wasmDiff.error) {
          console.warn(`[DiffFlattener] WASM flattener failed: ${wasmDiff.error}`);
        } else {
          const varMatch = wasmDiff.varCount === targetDae.varCount;
          const eqMatch = wasmDiff.eqCount === targetDae.eqCount;
          const bailSuffix = wasmDiff.bail ? ` [bail=${wasmDiff.bail.reason}(${wasmDiff.bail.code})]` : "";
          console.log(
            `[DiffFlattener] ${varMatch && eqMatch && !wasmDiff.bail ? "PARITY MATCH" : "PARITY MISMATCH"}: vars (WASM=${wasmDiff.varCount}, TS=${targetDae.varCount}), eqs (WASM=${wasmDiff.eqCount}, TS=${targetDae.eqCount})${bailSuffix}`,
          );
        }
      }
    }
  };

  if (flattenedInWasm && isOldFrontend) {
    const smState = getFlatteningState(dae);
    for (const ch of ctx.db.childrenOf(rootClassId)) {
      if (ch.kind !== "Component") continue;
      const stTypeId = ctx.db.query<SymbolId | null>("classInstance", ch.id);
      if (!stTypeId) continue;
      for (const sub of ctx.db.childrenOf(stTypeId)) {
        if (sub.kind !== "Component") continue;
        type CstClauseNode = { type?: string; text?: string; parent?: CstClauseNode | null };
        const subCst = ctx.db.cstNode(sub.id) as CstClauseNode | null;
        let clause = subCst;
        while (clause && clause.type !== "component_clause" && clause.parent) clause = clause.parent;
        const txt: string = (clause?.text ?? "").trim();
        if (/^\s*(?:protected\s+)?output\b/.test(txt)) {
          (smState.stateOutputVars ??= new Set()).add(`${ch.name}.${sub.name}`);
        }
      }
    }
  }
  extractStateMachines(dae, ctx.options);
  dae.groupEquationsForParity();
  ctx.checkBalance(dae, rootClassId);
  if (classCst?.text?.includes("showAnnotations") || classCst?.tree?.rootNode?.text?.includes("showAnnotations")) {
    populateShowAnnotations(ctx.db, dae, rootClassId);
  }

  attachDiffReport(dae);
  if (wasmBail) {
    // Structured metadata only: a diagnostic here would perturb tests whose
    // expected output is driven by linter diagnostics.
    ctx.state.wasmBail = wasmBail;
    (dae as DaeWithExtras).wasmBail = wasmBail;
  }
  ctx.state.isRealNameCache?.clear();
  ctx.state.varPrefixSet?.clear();
  ctx.state.varPrefixCount = 0;
  return dae;
}

export function flattenFromTopology(ctx: ClassFlattenerContext, graph: TopologyGraph): DAEBuilder {
  const dae = new DAEBuilder(undefined, "HybridSystem", "");

  for (const rootId of graph.rootIds) {
    const node = graph.nodes.get(rootId);
    if (node?.targetClassId) {
      const elements = ctx.db.query<SymbolId[]>("instantiate", node.targetClassId);
      if (elements) {
        ctx.instantiateElements(elements, node.path, dae);
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

  const topoState = getFlatteningState(dae, ctx);
  topoState.db = ctx.db;
  topoState.flattener = ctx;
  ModelicaPortBalancer.expandConnections(dae, {
    omcCompatibility: ctx.options.omcCompatibility,
    useWasmKernel: ctx.options.useWasmKernel,
  });

  if (ctx.options.eliminateAliases) {
    eliminateArenaAliases(dae);
  }

  ctx.checkBalance(dae);

  return dae;
}
