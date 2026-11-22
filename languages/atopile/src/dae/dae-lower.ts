// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atopile — Direct Linear-Memory `DAEBuilder` MNA Lowering.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { elaborateAtopile, type AtopileElaborationResult } from "../netlist.js";
import type { AtoFile, AtoPhysicalValue } from "../types.js";

export interface AtopileDaeResult {
  arena: DAEBuilder;
  interner: StringInterner;
  elaboration: AtopileElaborationResult;
  groundNet: string;
  nodeCount: number;
  loweredComponentCount: number;
}

function sanitizeIdent(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

function getNumericProp(props: Record<string, string | AtoPhysicalValue>, keys: string[]): number | null {
  for (const k of keys) {
    const v = props[k];
    if (v && typeof v === "object" && Number.isFinite(v.nominal)) return v.nominal;
  }
  return null;
}

/**
 * Lowers an `.ato` module directly into ModelScript's linear-memory `DAEBuilder`
 * via Modified Nodal Analysis (MNA) conservation equations.
 */
export function lowerAtopileToDAE(file: AtoFile, entryModule?: string, groundOverride?: string): AtopileDaeResult {
  const arena = new DAEBuilder();
  const interner = new StringInterner();
  const elaboration = elaborateAtopile(file, entryModule);

  const netNames = elaboration.netlist.nets.map((n) => n.id);
  const groundNet =
    groundOverride ??
    netNames.find((n) => ["GND", "0", "VSS", "AGND", "DGND"].includes(n.toUpperCase())) ??
    netNames[0] ??
    "gnd";

  const zeroExpr = arena.addRealLiteral(0.0);
  const nodeVarExpr = new Map<string, number>();
  const kclTerms = new Map<string, number[]>();

  for (const net of netNames) {
    const vNameId = interner.intern(`v_${sanitizeIdent(net)}`);
    arena.addVariable(vNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
    nodeVarExpr.set(net, arena.addExpression(ExprKind.Name, vNameId));
    kclTerms.set(net, []);
  }

  const gndExpr = nodeVarExpr.get(groundNet);
  if (gndExpr !== undefined) {
    arena.addEquation(EqKind.Simple, gndExpr, zeroExpr);
  }

  const addKcl = (net: string, expr: number) => {
    if (net === groundNet) return;
    kclTerms.get(net)?.push(expr);
  };

  let loweredComponentCount = 0;

  for (const comp of elaboration.components) {
    if (comp.pins.length < 2) continue;
    const netP = elaboration.pinNetMap.get(`${comp.refDes}.${comp.pins[0]!}`);
    const netN = elaboration.pinNetMap.get(`${comp.refDes}.${comp.pins[1]!}`);
    if (!netP || !netN) continue;

    const vP = nodeVarExpr.get(netP) ?? zeroExpr;
    const vN = nodeVarExpr.get(netN) ?? zeroExpr;
    const vDiff = arena.addBinaryExpr(BinOp.Sub, vP, vN);
    const id = sanitizeIdent(comp.refDes);

    const t = comp.typeName.toLowerCase();
    let kind: "R" | "C" | "L" | "V" | "I" | null = null;
    let val: number | null = null;

    if (t.includes("resistor")) {
      kind = "R";
      val = getNumericProp(comp.properties, ["resistance", "value"]);
    } else if (t.includes("capacitor")) {
      kind = "C";
      val = getNumericProp(comp.properties, ["capacitance", "value"]);
    } else if (t.includes("inductor")) {
      kind = "L";
      val = getNumericProp(comp.properties, ["inductance", "value"]);
    } else if (t.includes("voltage") || t === "power") {
      kind = "V";
      val = getNumericProp(comp.properties, ["voltage", "value"]);
    } else if (t.includes("current")) {
      kind = "I";
      val = getNumericProp(comp.properties, ["current", "value"]);
    }

    if (!kind || val === null) continue;

    const iNameId = interner.intern(`i_${id}`);
    arena.addVariable(iNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
    const iExpr = arena.addExpression(ExprKind.Name, iNameId);

    const pNameId = interner.intern(`${kind}_${id}`);
    arena.addVariable(pNameId, VarType.Real, Variability.Parameter, Causality.Local, val, 0);
    const pExpr = arena.addExpression(ExprKind.Name, pNameId);

    switch (kind) {
      case "R":
        arena.addEquation(EqKind.Simple, vDiff, arena.addBinaryExpr(BinOp.Mul, pExpr, iExpr));
        break;
      case "C": {
        const vcNameId = interner.intern(`v_C_${id}`);
        arena.addVariable(vcNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
        const vcExpr = arena.addExpression(ExprKind.Name, vcNameId);
        arena.addEquation(EqKind.Simple, vcExpr, vDiff);
        arena.addEquation(
          EqKind.Simple,
          iExpr,
          arena.addBinaryExpr(BinOp.Mul, pExpr, arena.addCallExpr("der", [vcExpr])),
        );
        break;
      }
      case "L":
        arena.addEquation(
          EqKind.Simple,
          vDiff,
          arena.addBinaryExpr(BinOp.Mul, pExpr, arena.addCallExpr("der", [iExpr])),
        );
        break;
      case "V":
        arena.addEquation(EqKind.Simple, vDiff, pExpr);
        break;
      case "I":
        arena.addEquation(EqKind.Simple, iExpr, pExpr);
        break;
    }

    addKcl(netP, iExpr);
    addKcl(netN, arena.addBinaryExpr(BinOp.Sub, zeroExpr, iExpr));
    loweredComponentCount++;
  }

  for (const [net, terms] of kclTerms) {
    if (net === groundNet || terms.length === 0) continue;
    let sum = terms[0]!;
    for (let i = 1; i < terms.length; i++) {
      sum = arena.addBinaryExpr(BinOp.Add, sum, terms[i]!);
    }
    arena.addEquation(EqKind.Simple, sum, zeroExpr);
  }

  return { arena, interner, elaboration, groundNet, nodeCount: netNames.length, loweredComponentCount };
}
