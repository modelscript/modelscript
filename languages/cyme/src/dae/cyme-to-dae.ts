// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cyme — Linear-Memory DAE Arena Lowering for CYME Networks.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { ensureBuiltInCymeLibraryRegistered, lookupCymeModelSchema } from "../catalog/library-package-adapter.js";
import type { CymeNetwork } from "../types.js";

/**
 * Resolves parameter defaults for a CYME equipment/device model from `@modelscript/cyme-std-lib`,
 * merging any user-specified overrides over the cleanroom schema defaults.
 */
export function resolveCymeSchemaParamDefaults(
  modelType: string,
  overrides: Record<string, number | string | boolean> = {},
): Record<string, number | string | boolean> {
  ensureBuiltInCymeLibraryRegistered();
  const out: Record<string, number | string | boolean> = {};
  const schema = lookupCymeModelSchema(modelType);
  if (schema) {
    for (const p of schema.parameters) {
      if (p.defaultValue !== undefined) {
        out[p.key] = p.defaultValue;
      }
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function lowerCymeToDae(net: CymeNetwork, builder?: DAEBuilder): DAEBuilder {
  ensureBuiltInCymeLibraryRegistered();
  const dae = builder ?? new DAEBuilder(undefined, sanitize(net.networkId || "CymeNetwork"));
  const omega = 2 * Math.PI * (net.frequencyHz || 60);
  const sourceNodeIds = new Set(net.sources.map((s) => s.nodeId));
  const busBranches = new Map<string, { exprId: number; isLeaving: boolean }[]>();
  const busLoads = new Map<string, number[]>();

  for (const node of net.nodes) {
    const id = sanitize(node.nodeId);
    const vNom = ((node.nominalKv ?? 12.47) * 1e3) / Math.sqrt(3);
    const vVar = dae.addVariable(`V_${id}`, VarType.Real, Variability.Continuous, Causality.Local, vNom);
    dae.addVariable(`I_inj_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    busBranches.set(node.nodeId, []);
    busLoads.set(node.nodeId, []);

    if (sourceNodeIds.has(node.nodeId) && vVar !== -1) {
      const src = net.sources.find((s) => s.nodeId === node.nodeId);
      const vSrc = ((src?.operatingKv ?? 12.47) * 1e3) / Math.sqrt(3);
      dae.addEquation(EqKind.Simple, dae.addName(vVar), dae.addRealLiteral(vSrc));
    }
  }

  for (const sec of net.sections) {
    const vFrom = dae.lookupVariable(`V_${sanitize(sec.fromNodeId)}`);
    const vTo = dae.lookupVariable(`V_${sanitize(sec.toNodeId)}`);
    if (vFrom === -1 || vTo === -1) continue;

    const iVar = dae.addVariable(
      `I_sec_${sanitize(sec.sectionId)}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      0.0,
    );
    if (iVar === -1) continue;

    const lenKm = Math.max(1e-4, sec.lengthMeters / 1000);
    const rTotal = (sec.rOhmPerKm ?? 0.25) * lenKm;
    const lTotal = Math.max(1e-7, ((sec.xOhmPerKm ?? 0.4) * lenKm) / omega);

    const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(lTotal), dae.addDer(iVar));
    const vDiff = dae.addBinaryExpr(BinOp.Sub, dae.addName(vFrom), dae.addName(vTo));
    const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rTotal), dae.addName(iVar));
    dae.addEquation(EqKind.Simple, lhs, dae.addBinaryExpr(BinOp.Sub, vDiff, rDrop));

    busBranches.get(sec.fromNodeId)?.push({ exprId: dae.addName(iVar), isLeaving: true });
    busBranches.get(sec.toNodeId)?.push({ exprId: dae.addName(iVar), isLeaving: false });
  }

  for (const load of net.loads) {
    const vBus = dae.lookupVariable(`V_${sanitize(load.nodeId)}`);
    if (vBus === -1) continue;
    const iLoad = dae.addVariable(
      `I_load_${sanitize(load.loadId)}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      0.0,
    );
    if (iLoad === -1) continue;

    const pExpr = dae.addBinaryExpr(BinOp.Mul, dae.addName(iLoad), dae.addName(vBus));
    dae.addEquation(EqKind.Simple, pExpr, dae.addRealLiteral(load.kw * 1e3));
    busLoads.get(load.nodeId)?.push(dae.addName(iLoad));
  }

  for (const node of net.nodes) {
    const iInj = dae.lookupVariable(`I_inj_${sanitize(node.nodeId)}`);
    if (iInj === -1) continue;
    let sumExpr: number | null = null;
    for (const b of busBranches.get(node.nodeId) ?? []) {
      sumExpr =
        sumExpr === null
          ? b.isLeaving
            ? b.exprId
            : dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), b.exprId)
          : dae.addBinaryExpr(b.isLeaving ? BinOp.Add : BinOp.Sub, sumExpr, b.exprId);
    }
    for (const l of busLoads.get(node.nodeId) ?? []) {
      sumExpr = sumExpr === null ? l : dae.addBinaryExpr(BinOp.Add, sumExpr, l);
    }
    dae.addEquation(EqKind.Simple, dae.addName(iInj), sumExpr ?? dae.addRealLiteral(0.0));
    if (!sourceNodeIds.has(node.nodeId)) {
      dae.addEquation(EqKind.Simple, dae.addName(iInj), dae.addRealLiteral(0.0));
    }
  }

  return dae;
}
