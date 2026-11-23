// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for EDIF 2.0.0 Electrical & Digital Netlists.
 *
 * Lowers flattened EDIF netlists (KCL node equations, passive RLC constitutive laws,
 * DC supplies, and digital gate transfer models) directly into `@modelscript/runtime`'s
 * `IDaeBuilder` linear memory representation without intermediate AST wrappers.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInEdifLibraryRegistered, lookupEdifModelSchema } from "../catalog/library-package-adapter.js";
import { flattenEdifNetlist } from "../solver/flattener.js";
import type { EdifDocument, FlattenedEdifInstance, FlattenedEdifNetlist } from "../types.js";

export interface EdifDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  kclEquationCount: number;
  variableMap: Map<string, number>;
}

export interface EdifDaeLoweringOptions {
  /** Default supply voltage for `VCC`/`VDD` rails and digital logic high (default: 5.0 V). */
  defaultVcc?: number;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

function getNumericProp(inst: FlattenedEdifInstance, keys: string[], fallback: number): number {
  for (const k of keys) {
    const val = inst.properties[k.toUpperCase()];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  const schema = lookupEdifModelSchema(inst.cellName);
  if (schema) {
    for (const k of keys) {
      const p = schema.parameters.find((sp) => sp.key.toUpperCase() === k.toUpperCase());
      if (p && typeof p.defaultValue === "number") return p.defaultValue;
    }
  }
  return fallback;
}

function getPinNet(inst: FlattenedEdifInstance, candidates: string[], fallbackIdx: number): string | undefined {
  const entries = Object.entries(inst.portToNet);
  for (const c of candidates) {
    const hit = entries.find(([k]) => k.toUpperCase() === c);
    if (hit) return hit[1];
  }
  return entries[fallbackIdx]?.[1];
}

function getTwoTerminalNets(inst: FlattenedEdifInstance): [string | undefined, string | undefined] {
  const p = getPinNet(inst, ["P", "POS", "A", "IN", "1", "PIN1"], 0);
  const n = getPinNet(inst, ["N", "NEG", "B", "OUT", "2", "PIN2"], 1);
  return [p, n];
}

/**
 * Lowers an EDIF document or flattened netlist directly into an `IDaeBuilder` arena.
 */
export function lowerEdifToDae(
  builder: IDaeBuilder,
  docOrFlat: EdifDocument | FlattenedEdifNetlist,
  options: EdifDaeLoweringOptions = {},
): EdifDaeLoweringResult {
  ensureBuiltInEdifLibraryRegistered();
  const flat: FlattenedEdifNetlist = "libraries" in docOrFlat ? flattenEdifNetlist(docOrFlat) : docOrFlat;
  const defaultVcc = options.defaultVcc ?? 5.0;

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;
  let kclEquationCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
  ): number {
    const mapped = variableMap.get(name);
    if (mapped !== undefined) return mapped;
    const existing = builder.lookupVariable(name);
    if (existing !== -1) {
      variableMap.set(name, existing);
      return existing;
    }
    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // 1. Register node voltage variables for all nets
  const netVoltageVar = new Map<string, number>();
  for (const net of flat.nets) {
    const vName = `v_${sanitizeId(net.name)}`;
    const vIdx = getOrAddVar(vName, Variability.Continuous, 0.0);
    netVoltageVar.set(net.name, vIdx);
  }

  function ensureNetVar(netName: string): number {
    const existing = netVoltageVar.get(netName);
    if (existing !== undefined) return existing;
    const vIdx = getOrAddVar(`v_${sanitizeId(netName)}`, Variability.Continuous, 0.0);
    netVoltageVar.set(netName, vIdx);
    return vIdx;
  }

  // Track signed incident branch currents per net for KCL equations
  // Each entry is `{ varIdx, sign: +1 | -1 }` where +1 means current leaving node
  const kclTerms = new Map<string, Array<{ varIdx: number; sign: 1 | -1 }>>();
  const fixedPotentialNets = new Set<string>();

  function addKclTerm(netName: string, varIdx: number, sign: 1 | -1): void {
    let arr = kclTerms.get(netName);
    if (!arr) {
      arr = [];
      kclTerms.set(netName, arr);
    }
    arr.push({ varIdx, sign });
  }

  // 2. Lower leaf instances (passives, supplies, digital gates)
  for (const inst of flat.instances) {
    const cn = inst.cellName.toUpperCase();
    const instId = sanitizeId(inst.name);

    switch (cn) {
      case "GND":
      case "GROUND":
      case "VSS": {
        const pNet = getPinNet(inst, ["P", "GND", "1"], 0);
        if (pNet && !fixedPotentialNets.has(pNet)) {
          const vIdx = ensureNetVar(pNet);
          builder.addEquation(EqKind.Simple, builder.addName(vIdx), builder.addRealLiteral(0.0));
          equationCount++;
          fixedPotentialNets.add(pNet);
        }
        break;
      }

      case "VCC":
      case "VDD":
      case "SUPPLY": {
        const pNet = getPinNet(inst, ["P", "VCC", "VDD", "1"], 0);
        if (pNet && !fixedPotentialNets.has(pNet)) {
          const vVal = getNumericProp(inst, ["V", "VALUE", "VOLTAGE", "VDD", "VCC"], defaultVcc);
          const vIdx = ensureNetVar(pNet);
          builder.addEquation(EqKind.Simple, builder.addName(vIdx), builder.addRealLiteral(vVal));
          equationCount++;
          fixedPotentialNets.add(pNet);
        }
        break;
      }

      case "VDC":
      case "VSOURCE": {
        const [pNet, nNet] = getTwoTerminalNets(inst);
        if (!pNet || !nNet) break;
        const vVal = getNumericProp(inst, ["V", "VALUE", "DC", "VOLTAGE"], defaultVcc);
        const vp = ensureNetVar(pNet);
        const vn = ensureNetVar(nNet);
        const iVar = getOrAddVar(`i_${instId}`, Variability.Continuous, 0.0);

        // v_p - v_n = V
        const diff = builder.addBinaryExpr(BinOp.Sub, builder.addName(vp), builder.addName(vn));
        builder.addEquation(EqKind.Simple, diff, builder.addRealLiteral(vVal));
        equationCount++;

        addKclTerm(pNet, iVar, 1);
        addKclTerm(nNet, iVar, -1);
        break;
      }

      case "RES":
      case "RESISTOR":
      case "R": {
        const [pNet, nNet] = getTwoTerminalNets(inst);
        if (!pNet || !nNet) break;
        const r = Math.max(1e-12, getNumericProp(inst, ["R", "VALUE", "RESISTANCE"], 1000.0));
        const vp = ensureNetVar(pNet);
        const vn = ensureNetVar(nNet);
        const iVar = getOrAddVar(`i_${instId}`, Variability.Continuous, 0.0);

        // v_p - v_n = R * i_inst
        const lhs = builder.addBinaryExpr(BinOp.Sub, builder.addName(vp), builder.addName(vn));
        const rhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(r), builder.addName(iVar));
        builder.addEquation(EqKind.Simple, lhs, rhs);
        equationCount++;

        addKclTerm(pNet, iVar, 1);
        addKclTerm(nNet, iVar, -1);
        break;
      }

      case "CAP":
      case "CAPACITOR":
      case "C": {
        const [pNet, nNet] = getTwoTerminalNets(inst);
        if (!pNet || !nNet) break;
        const c = Math.max(1e-18, getNumericProp(inst, ["C", "VALUE", "CAPACITANCE"], 1e-6));
        const vp = ensureNetVar(pNet);
        const vn = ensureNetVar(nNet);
        const vCap = getOrAddVar(`vc_${instId}`, Variability.Continuous, 0.0);
        const iVar = getOrAddVar(`i_${instId}`, Variability.Continuous, 0.0);
        stateVarIndices.push(vCap);

        // vc_inst = v_p - v_n
        const diff = builder.addBinaryExpr(BinOp.Sub, builder.addName(vp), builder.addName(vn));
        builder.addEquation(EqKind.Simple, builder.addName(vCap), diff);
        equationCount++;

        // i_inst = C * der(vc_inst)
        const rhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(c), builder.addDer(vCap));
        builder.addEquation(EqKind.Simple, builder.addName(iVar), rhs);
        equationCount++;

        addKclTerm(pNet, iVar, 1);
        addKclTerm(nNet, iVar, -1);
        break;
      }

      case "IND":
      case "INDUCTOR":
      case "L": {
        const [pNet, nNet] = getTwoTerminalNets(inst);
        if (!pNet || !nNet) break;
        const l = Math.max(1e-18, getNumericProp(inst, ["L", "VALUE", "INDUCTANCE"], 1e-3));
        const vp = ensureNetVar(pNet);
        const vn = ensureNetVar(nNet);
        const iVar = getOrAddVar(`i_${instId}`, Variability.Continuous, 0.0);
        stateVarIndices.push(iVar);

        // v_p - v_n = L * der(i_inst)
        const lhs = builder.addBinaryExpr(BinOp.Sub, builder.addName(vp), builder.addName(vn));
        const rhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(l), builder.addDer(iVar));
        builder.addEquation(EqKind.Simple, lhs, rhs);
        equationCount++;

        addKclTerm(pNet, iVar, 1);
        addKclTerm(nNet, iVar, -1);
        break;
      }

      case "INV":
      case "NOT": {
        const aNet = getPinNet(inst, ["A", "I", "IN"], 0);
        const yNet = getPinNet(inst, ["Y", "O", "OUT"], 1);
        if (!aNet || !yNet) break;
        const vdd = getNumericProp(inst, ["VDD"], defaultVcc);
        const va = ensureNetVar(aNet);
        const vy = ensureNetVar(yNet);
        // v_Y = Vdd - v_A
        const rhs = builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(vdd), builder.addName(va));
        builder.addEquation(EqKind.Simple, builder.addName(vy), rhs);
        equationCount++;
        fixedPotentialNets.add(yNet);
        break;
      }

      case "AND2":
      case "AND":
      case "NAND2":
      case "NAND":
      case "OR2":
      case "OR":
      case "NOR2":
      case "NOR":
      case "XOR2":
      case "XOR": {
        const aNet = getPinNet(inst, ["A", "I0", "IN1"], 0);
        const bNet = getPinNet(inst, ["B", "I1", "IN2"], 1);
        const yNet = getPinNet(inst, ["Y", "O", "OUT"], 2);
        if (!aNet || !bNet || !yNet) break;
        const vdd = Math.max(1e-6, getNumericProp(inst, ["VDD"], defaultVcc));
        const va = ensureNetVar(aNet);
        const vb = ensureNetVar(bNet);
        const vy = ensureNetVar(yNet);

        // Normalized product ab = (v_A * v_B) / Vdd
        const ab = builder.addBinaryExpr(
          BinOp.Div,
          builder.addBinaryExpr(BinOp.Mul, builder.addName(va), builder.addName(vb)),
          builder.addRealLiteral(vdd),
        );

        let rhs: number;
        if (cn === "AND2" || cn === "AND") {
          rhs = ab;
        } else if (cn === "NAND2" || cn === "NAND") {
          rhs = builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(vdd), ab);
        } else if (cn === "OR2" || cn === "OR") {
          const sum = builder.addBinaryExpr(BinOp.Add, builder.addName(va), builder.addName(vb));
          rhs = builder.addBinaryExpr(BinOp.Sub, sum, ab);
        } else if (cn === "NOR2" || cn === "NOR") {
          const sum = builder.addBinaryExpr(BinOp.Add, builder.addName(va), builder.addName(vb));
          const orExpr = builder.addBinaryExpr(BinOp.Sub, sum, ab);
          rhs = builder.addBinaryExpr(BinOp.Sub, builder.addRealLiteral(vdd), orExpr);
        } else {
          // XOR2: v_A + v_B - 2 * v_A * v_B / Vdd
          const sum = builder.addBinaryExpr(BinOp.Add, builder.addName(va), builder.addName(vb));
          const twoAb = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(2.0), ab);
          rhs = builder.addBinaryExpr(BinOp.Sub, sum, twoAb);
        }

        builder.addEquation(EqKind.Simple, builder.addName(vy), rhs);
        equationCount++;
        fixedPotentialNets.add(yNet);
        break;
      }

      case "DFF":
      case "D_FF": {
        const dNet = getPinNet(inst, ["D", "IN"], 0);
        const qNet = getPinNet(inst, ["Q", "OUT", "Y"], 2);
        if (!dNet || !qNet) break;
        const vd = ensureNetVar(dNet);
        const vq = ensureNetVar(qNet);
        const qState = getOrAddVar(`q_${instId}`, Variability.Continuous, getNumericProp(inst, ["Q0"], 0.0));
        stateVarIndices.push(qState);
        // First-order latching state approximation: der(q) = (v_D - q) / tau, v_Q = q
        const diff = builder.addBinaryExpr(BinOp.Sub, builder.addName(vd), builder.addName(qState));
        const rhs = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(1e6), diff);
        builder.addEquation(EqKind.Simple, builder.addDer(qState), rhs);
        builder.addEquation(EqKind.Simple, builder.addName(vq), builder.addName(qState));
        equationCount += 2;
        fixedPotentialNets.add(qNet);
        break;
      }

      default:
        break;
    }
  }

  // Ensure a ground reference equation exists if a GND/VSS/0 net is present and not yet constrained
  for (const net of flat.nets) {
    const u = net.name.toUpperCase();
    if ((u === "GND" || u === "VSS" || u === "0") && !fixedPotentialNets.has(net.name)) {
      const vIdx = ensureNetVar(net.name);
      builder.addEquation(EqKind.Simple, builder.addName(vIdx), builder.addRealLiteral(0.0));
      equationCount++;
      fixedPotentialNets.add(net.name);
      break;
    }
  }

  // 3. Emit KCL equations: sum(incident branch currents) = 0 for every non-reference node
  for (const [netName, terms] of kclTerms) {
    if (fixedPotentialNets.has(netName) || terms.length === 0) continue;

    let sumExpr: number | undefined;
    for (const term of terms) {
      const termExpr =
        term.sign === 1
          ? builder.addName(term.varIdx)
          : builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(-1.0), builder.addName(term.varIdx));
      if (sumExpr === undefined) {
        sumExpr = termExpr;
      } else {
        sumExpr = builder.addBinaryExpr(BinOp.Add, sumExpr, termExpr);
      }
    }

    if (sumExpr !== undefined) {
      builder.addEquation(EqKind.Simple, sumExpr, builder.addRealLiteral(0.0));
      equationCount++;
      kclEquationCount++;
    }
  }

  return {
    stateVarIndices,
    equationCount,
    kclEquationCount,
    variableMap,
  };
}
