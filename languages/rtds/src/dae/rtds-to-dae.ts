// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/rtds — Linear-Memory DAE Arena Lowering for RTDS EMT Subsystems.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { RtdsDraft } from "../types.js";

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function isGnd(node: string | undefined): boolean {
  return !node || node === "0" || node.toUpperCase() === "GND";
}

export function lowerRtdsToDae(draft: RtdsDraft, builder?: DAEBuilder): DAEBuilder {
  const dae = builder ?? new DAEBuilder(undefined, sanitize(draft.name || "RTDS_Case"));
  const nodeTerms = new Map<string, { exprId: number; isLeaving: boolean }[]>();

  for (const n of draft.nodes) {
    const id = sanitize(n);
    dae.addVariable(`v_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    nodeTerms.set(n, []);
  }

  const nodeExpr = (node: string | undefined): number => {
    if (isGnd(node)) return dae.addRealLiteral(0.0);
    const vId = dae.lookupVariable(`v_${sanitize(node!)}`);
    return vId !== -1 ? dae.addName(vId) : dae.addRealLiteral(0.0);
  };

  for (const comp of draft.components) {
    const n1 = comp.nodes[0];
    const n2 = comp.nodes[1] ?? "0";
    const id = sanitize(comp.name);
    const iVar = dae.addVariable(`i_${id}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    if (iVar === -1) continue;

    const v1 = nodeExpr(n1);
    const v2 = nodeExpr(n2);
    const vDiff = dae.addBinaryExpr(BinOp.Sub, v1, v2);

    if (comp.type === "SOURCE") {
      const vPeak = Number(comp.params["V"] ?? comp.params["Vpk"] ?? 1000.0);
      dae.addEquation(EqKind.Simple, vDiff, dae.addRealLiteral(vPeak));
    } else if (comp.type === "L") {
      const l = Math.max(1e-7, Number(comp.params["L"] ?? 1e-3));
      dae.addEquation(EqKind.Simple, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(l), dae.addDer(iVar)), vDiff);
    } else if (comp.type === "C") {
      const c = Math.max(1e-9, Number(comp.params["C"] ?? 1e-6));
      const derV1 = !isGnd(n1) ? dae.addDer(dae.lookupVariable(`v_${sanitize(n1!)}`)) : dae.addRealLiteral(0.0);
      const derV2 = !isGnd(n2) ? dae.addDer(dae.lookupVariable(`v_${sanitize(n2)}`)) : dae.addRealLiteral(0.0);
      const derDiff = dae.addBinaryExpr(BinOp.Sub, derV1, derV2);
      dae.addEquation(EqKind.Simple, dae.addName(iVar), dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(c), derDiff));
    } else {
      const r = Math.max(1e-4, Number(comp.params["R"] ?? 1.0));
      const l = Number(comp.params["L"] ?? 0.0);
      const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(r), dae.addName(iVar));
      if (l > 0) {
        const lDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(l), dae.addDer(iVar));
        dae.addEquation(EqKind.Simple, dae.addBinaryExpr(BinOp.Add, lDrop, rDrop), vDiff);
      } else {
        dae.addEquation(EqKind.Simple, rDrop, vDiff);
      }
    }

    if (!isGnd(n1)) nodeTerms.get(n1!)?.push({ exprId: dae.addName(iVar), isLeaving: true });
    if (!isGnd(n2)) nodeTerms.get(n2)?.push({ exprId: dae.addName(iVar), isLeaving: false });
  }

  for (const [, terms] of nodeTerms) {
    if (terms.length === 0) continue;
    let sumExpr: number | null = null;
    for (const t of terms) {
      sumExpr =
        sumExpr === null
          ? t.isLeaving
            ? t.exprId
            : dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), t.exprId)
          : dae.addBinaryExpr(t.isLeaving ? BinOp.Add : BinOp.Sub, sumExpr, t.exprId);
    }
    if (sumExpr !== null) {
      dae.addEquation(EqKind.Simple, sumExpr, dae.addRealLiteral(0.0));
    }
  }

  return dae;
}
