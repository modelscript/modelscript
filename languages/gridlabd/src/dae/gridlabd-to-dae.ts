// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gridlabd — Direct Linear-Memory DAE Arena Lowering for GridLAB-D (.glm).
 *
 * Compiles GridLAB-D distribution nodes, lines, transformers, switches, loads, and DERs
 * into ModelScript's zero-GC DAEBuilder:
 *   1. Bus voltages V_<bus> and injection currents I_inj_<bus>
 *   2. Line RL branch differential equations: L * der(i) = v_from - v_to - R * i
 *   3. Transformer turns-ratio and leakage RL dynamics
 *   4. Switch/fuse/recloser closed/open branch equations
 *   5. Load and DER (solar/inverter/battery/DG) power-balance equations
 *   6. KCL nodal current balance
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import {
  parseGlmComplex,
  parseGlmLengthMiles,
  parseGlmNumber,
  parseGlmPowerW,
  parseGlmVoltageV,
} from "../parser/gridlabd-parser.js";
import type { GlmModel, GlmObject } from "../types.js";

export interface GlmDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  frequencyHz?: number | undefined;
}

const NODE_CLASSES = new Set(["node", "meter", "load", "triplex_node", "triplex_meter", "triplex_load", "capacitor"]);

const LINE_CLASSES = new Set(["overhead_line", "underground_line", "triplex_line"]);
const SWITCH_CLASSES = new Set(["switch", "fuse", "recloser"]);
const DER_CLASSES = new Set(["solar", "inverter", "battery", "diesel_dg", "windturb_dg"]);

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function getObjId(obj: GlmObject, fallbackIdx: number): string {
  return sanitizeId(obj.name ?? obj.id ?? `${obj.className}_${fallbackIdx}`);
}

function resolveRootBus(obj: GlmObject, model: GlmModel): string | undefined {
  let curr: GlmObject | undefined = obj;
  const visited = new Set<GlmObject>();
  while (curr && !visited.has(curr)) {
    visited.add(curr);
    if (NODE_CLASSES.has(curr.className) && curr.name) {
      return curr.name;
    }
    if (!curr.parent) break;
    curr = model.objectsByName.get(curr.parent);
  }
  return undefined;
}

function extractTotalLoadWatts(obj: GlmObject): number {
  let totalW = 0;
  for (const key of [
    "constant_power_A",
    "constant_power_B",
    "constant_power_C",
    "constant_power_1",
    "constant_power_2",
    "constant_power_12",
    "base_power_A",
    "base_power_B",
    "base_power_C",
  ]) {
    const p = parseGlmPowerW(obj.properties[key]);
    if (p) totalW += p.pWatts;
  }
  return totalW;
}

function extractDerWatts(obj: GlmObject, model: GlmModel): number {
  const rated = parseGlmPowerW(obj.properties["rated_power"]);
  if (rated) return rated.pWatts;
  const pOut = parseGlmPowerW(obj.properties["P_Out"]);
  if (pOut) return pOut.pWatts;
  const area = parseGlmNumber(obj.properties["area"]);
  if (obj.className === "solar" && area) {
    const eff = parseGlmNumber(obj.properties["efficiency"])?.value ?? 0.18;
    const insolation = parseGlmNumber(obj.properties["insolation"])?.value ?? 800;
    return area.value * eff * insolation;
  }
  // If inverter has a child solar/battery, sum their ratings
  let childSum = 0;
  for (const child of obj.children) {
    childSum += extractDerWatts(child, model);
  }
  return childSum > 0 ? childSum : 5000;
}

function resolveLineImpedanceOhms(line: GlmObject, model: GlmModel): { rOhms: number; xOhms: number } {
  const lengthMiles = Math.max(1e-4, parseGlmLengthMiles(line.properties["length"]) ?? 0.1);
  let rPerMile = 0.3;
  let xPerMile = 0.7;

  const cfgName = line.properties["configuration"];
  const cfg = cfgName ? model.objectsByName.get(cfgName) : undefined;
  if (cfg) {
    const z11 = parseGlmComplex(cfg.properties["z11"]);
    if (z11) {
      rPerMile = Math.max(1e-4, z11.re);
      xPerMile = Math.max(1e-4, z11.im);
    } else {
      const condName = cfg.properties["conductor_A"] ?? cfg.properties["conductor_1"];
      const cond = condName ? model.objectsByName.get(condName) : undefined;
      if (cond) {
        const res = parseGlmNumber(cond.properties["resistance"]);
        if (res && res.value > 0) rPerMile = res.value;
      }
    }
  }

  return {
    rOhms: rPerMile * lengthMiles,
    xOhms: xPerMile * lengthMiles,
  };
}

/**
 * Lower a parsed GridLAB-D (.glm) model into a linear-memory DAEBuilder arena.
 */
export function lowerGridlabdToDae(model: GlmModel, options?: GlmDaeOptions): DAEBuilder {
  const modelName = sanitizeId(options?.modelName ?? "GridlabdDistributionGrid");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const omega = 2 * Math.PI * (options?.frequencyHz ?? 60);

  const busObjects = new Map<string, GlmObject>();
  const swingBusNames = new Set<string>();

  for (const obj of model.allObjects) {
    if (NODE_CLASSES.has(obj.className) && obj.name) {
      busObjects.set(obj.name, obj);
      const bt = obj.properties["bustype"]?.toUpperCase();
      if (bt === "SWING" || bt === "SWING_PQ") {
        swingBusNames.add(obj.name);
      }
    }
  }

  const busBranchTerms = new Map<string, { exprId: number; isLeaving: boolean }[]>();
  const busShuntTerms = new Map<string, { exprId: number; isGeneration: boolean }[]>();

  // 1. Declare Bus Voltage and Injection Current Variables
  for (const [busName, busObj] of busObjects) {
    const busId = sanitizeId(busName);
    const vNom = parseGlmVoltageV(busObj.properties["nominal_voltage"]) ?? 7200;
    const vVar = dae.addVariable(`V_${busId}`, VarType.Real, Variability.Continuous, Causality.Local, vNom);
    dae.addVariable(`I_inj_${busId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    busBranchTerms.set(busName, []);
    busShuntTerms.set(busName, []);

    if (swingBusNames.has(busName) && vVar !== -1) {
      dae.addEquation(EqKind.Simple, dae.addName(vVar), dae.addRealLiteral(vNom));
    }
  }

  // 2. Declare Lines (overhead_line, underground_line, triplex_line)
  let idx = 0;
  for (const obj of model.allObjects) {
    idx++;
    if (!LINE_CLASSES.has(obj.className)) continue;

    const from = obj.properties["from"];
    const to = obj.properties["to"];
    if (!from || !to) continue;

    const vFromVar = dae.lookupVariable(`V_${sanitizeId(from)}`);
    const vToVar = dae.lookupVariable(`V_${sanitizeId(to)}`);
    if (vFromVar === -1 || vToVar === -1) continue;

    const lineId = getObjId(obj, idx);
    const iLineVar = dae.addVariable(`I_line_${lineId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    if (iLineVar === -1) continue;

    const { rOhms, xOhms } = resolveLineImpedanceOhms(obj, model);
    const lHenrys = Math.max(1e-7, xOhms / omega);

    // L * der(i_line) = V_from - V_to - R * i_line
    const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(lHenrys), dae.addDer(iLineVar));
    const vDiff = dae.addBinaryExpr(BinOp.Sub, dae.addName(vFromVar), dae.addName(vToVar));
    const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rOhms), dae.addName(iLineVar));
    const rhs = dae.addBinaryExpr(BinOp.Sub, vDiff, rDrop);
    dae.addEquation(EqKind.Simple, lhs, rhs);

    busBranchTerms.get(from)?.push({ exprId: dae.addName(iLineVar), isLeaving: true });
    busBranchTerms.get(to)?.push({ exprId: dae.addName(iLineVar), isLeaving: false });
  }

  // 3. Declare Transformers
  idx = 0;
  for (const obj of model.allObjects) {
    idx++;
    if (obj.className !== "transformer") continue;

    const from = obj.properties["from"];
    const to = obj.properties["to"];
    if (!from || !to) continue;

    const vFromVar = dae.lookupVariable(`V_${sanitizeId(from)}`);
    const vToVar = dae.lookupVariable(`V_${sanitizeId(to)}`);
    if (vFromVar === -1 || vToVar === -1) continue;

    const cfgName = obj.properties["configuration"];
    const cfg = cfgName ? model.objectsByName.get(cfgName) : undefined;
    const vPrim = parseGlmVoltageV(cfg?.properties["primary_voltage"]) ?? 7200;
    const vSec = parseGlmVoltageV(cfg?.properties["secondary_voltage"]) ?? 240;
    const turnsRatio = vSec > 0 ? vPrim / vSec : 1.0;

    const rPu = parseGlmNumber(cfg?.properties["resistance"])?.value ?? 0.01;
    const xPu = parseGlmNumber(cfg?.properties["reactance"])?.value ?? 0.05;
    const ratingKva = parseGlmNumber(cfg?.properties["power_rating"])?.value ?? 500;
    const zBaseSec = (vSec * vSec) / Math.max(1, ratingKva * 1e3);
    const rEq = Math.max(1e-4, rPu * zBaseSec);
    const lEq = Math.max(1e-7, (xPu * zBaseSec) / omega);

    const xfmrId = getObjId(obj, idx);
    const iXfmrVar = dae.addVariable(`I_xfmr_${xfmrId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    if (iXfmrVar === -1) continue;

    // L_eq * der(I_xfmr) = V_from / a - V_to - R_eq * I_xfmr
    const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(lEq), dae.addDer(iXfmrVar));
    const vPrimScaled = dae.addBinaryExpr(BinOp.Div, dae.addName(vFromVar), dae.addRealLiteral(turnsRatio));
    const vDiff = dae.addBinaryExpr(BinOp.Sub, vPrimScaled, dae.addName(vToVar));
    const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rEq), dae.addName(iXfmrVar));
    dae.addEquation(EqKind.Simple, lhs, dae.addBinaryExpr(BinOp.Sub, vDiff, rDrop));

    const primCurrent = dae.addBinaryExpr(BinOp.Div, dae.addName(iXfmrVar), dae.addRealLiteral(turnsRatio));
    busBranchTerms.get(from)?.push({ exprId: primCurrent, isLeaving: true });
    busBranchTerms.get(to)?.push({ exprId: dae.addName(iXfmrVar), isLeaving: false });
  }

  // 4. Declare Switches, Fuses, Reclosers
  idx = 0;
  for (const obj of model.allObjects) {
    idx++;
    if (!SWITCH_CLASSES.has(obj.className)) continue;

    const from = obj.properties["from"];
    const to = obj.properties["to"];
    if (!from || !to) continue;

    const vFromVar = dae.lookupVariable(`V_${sanitizeId(from)}`);
    const vToVar = dae.lookupVariable(`V_${sanitizeId(to)}`);
    if (vFromVar === -1 || vToVar === -1) continue;

    const swId = getObjId(obj, idx);
    const iSwVar = dae.addVariable(`I_sw_${swId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    if (iSwVar === -1) continue;

    const status = (obj.properties["status"] ?? "CLOSED").toUpperCase();
    if (status === "OPEN") {
      dae.addEquation(EqKind.Simple, dae.addName(iSwVar), dae.addRealLiteral(0.0));
    } else {
      const vDiff = dae.addBinaryExpr(BinOp.Sub, dae.addName(vFromVar), dae.addName(vToVar));
      const rDrop = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1e-3), dae.addName(iSwVar));
      dae.addEquation(EqKind.Simple, vDiff, rDrop);
    }

    busBranchTerms.get(from)?.push({ exprId: dae.addName(iSwVar), isLeaving: true });
    busBranchTerms.get(to)?.push({ exprId: dae.addName(iSwVar), isLeaving: false });
  }

  // 5. Declare Loads
  idx = 0;
  for (const obj of model.allObjects) {
    idx++;
    if (obj.className !== "load" && obj.className !== "triplex_load") continue;

    const busName = obj.name ?? resolveRootBus(obj, model);
    if (!busName) continue;

    const vBusVar = dae.lookupVariable(`V_${sanitizeId(busName)}`);
    if (vBusVar === -1) continue;

    const pWatts = extractTotalLoadWatts(obj);
    if (pWatts === 0) continue;

    const loadId = getObjId(obj, idx);
    const vNom = parseGlmVoltageV(obj.properties["nominal_voltage"]) ?? 7200;
    const iLoadVar = dae.addVariable(
      `I_load_${loadId}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      pWatts / Math.max(1, vNom),
    );
    if (iLoadVar === -1) continue;

    // I_load * V_bus = P_load
    const pExpr = dae.addBinaryExpr(BinOp.Mul, dae.addName(iLoadVar), dae.addName(vBusVar));
    dae.addEquation(EqKind.Simple, pExpr, dae.addRealLiteral(pWatts));
    busShuntTerms.get(busName)?.push({ exprId: dae.addName(iLoadVar), isGeneration: false });
  }

  // 6. Declare DERs (solar, inverter, battery, diesel_dg, windturb_dg)
  idx = 0;
  for (const obj of model.allObjects) {
    idx++;
    if (!DER_CLASSES.has(obj.className)) continue;

    const busName = resolveRootBus(obj, model);
    if (!busName) continue;

    const vBusVar = dae.lookupVariable(`V_${sanitizeId(busName)}`);
    if (vBusVar === -1) continue;

    const pWatts = extractDerWatts(obj, model);
    const derId = getObjId(obj, idx);
    const vNom = parseGlmVoltageV(busObjects.get(busName)?.properties["nominal_voltage"]) ?? 7200;
    const iDerVar = dae.addVariable(
      `I_der_${derId}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      pWatts / Math.max(1, vNom),
    );
    if (iDerVar === -1) continue;

    const pExpr = dae.addBinaryExpr(BinOp.Mul, dae.addName(iDerVar), dae.addName(vBusVar));
    dae.addEquation(EqKind.Simple, pExpr, dae.addRealLiteral(pWatts));
    busShuntTerms.get(busName)?.push({ exprId: dae.addName(iDerVar), isGeneration: true });
  }

  // 7. KCL Nodal Balance at each bus
  for (const [busName] of busObjects) {
    const busId = sanitizeId(busName);
    const iInjVar = dae.lookupVariable(`I_inj_${busId}`);
    if (iInjVar === -1) continue;

    const branches = busBranchTerms.get(busName) ?? [];
    const shunts = busShuntTerms.get(busName) ?? [];

    let rhsExpr: number | null = null;
    const addTerm = (termExpr: number, sign: 1 | -1) => {
      if (rhsExpr === null) {
        rhsExpr = sign === 1 ? termExpr : dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), termExpr);
      } else {
        rhsExpr = dae.addBinaryExpr(sign === 1 ? BinOp.Add : BinOp.Sub, rhsExpr, termExpr);
      }
    };

    for (const b of branches) {
      addTerm(b.exprId, b.isLeaving ? 1 : -1);
    }
    for (const s of shunts) {
      addTerm(s.exprId, s.isGeneration ? -1 : 1);
    }

    if (rhsExpr !== null) {
      dae.addEquation(EqKind.Simple, dae.addName(iInjVar), rhsExpr);
      if (!swingBusNames.has(busName)) {
        dae.addEquation(EqKind.Simple, dae.addName(iInjVar), dae.addRealLiteral(0.0));
      }
    } else {
      dae.addEquation(EqKind.Simple, dae.addName(iInjVar), dae.addRealLiteral(0.0));
    }
  }

  return dae;
}
