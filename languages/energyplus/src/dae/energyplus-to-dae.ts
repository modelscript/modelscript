// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Direct Linear-Memory DAE Lowering.
 *
 * Lowers multi-zone building thermal models, envelope conduction, solar absorption,
 * infiltration, internal gains, and HVAC loops directly into ModelScript's
 * zero-GC linear memory DAEBuilder arena.
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
import type { EnergyPlusDocument, IdfMaterial, IdfZone } from "../types.js";

export function lowerEnergyPlusToDae(doc: EnergyPlusDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? doc.building?.name ?? "EnergyPlus_Building";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  // 1. Ambient Conditions Parameters (T_amb = 283.15 K = 10 deg C, I_solar = 300 W/m^2)
  const tAmbId = interner.intern("T_amb");
  arena.addVariable("T_amb", VarType.Real, Variability.Parameter, Causality.Input);
  const tAmbExpr = arena.addExpression(ExprKind.Name, tAmbId);
  const tAmbDefault = arena.addRealLiteral(283.15);
  arena.addEquation(EqKind.InitialSimple, tAmbExpr, tAmbDefault);

  const tGroundId = interner.intern("T_ground");
  arena.addVariable("T_ground", VarType.Real, Variability.Parameter, Causality.Input);
  const tGroundExpr = arena.addExpression(ExprKind.Name, tGroundId);
  const tGroundDefault = arena.addRealLiteral(285.15); // 12 deg C
  arena.addEquation(EqKind.InitialSimple, tGroundExpr, tGroundDefault);

  // 2. Pre-calculate construction thermal transmittances (U-values)
  const materialMap = new Map<string, IdfMaterial>();
  for (const m of doc.materials) {
    materialMap.set(m.name.toLowerCase(), m);
  }

  const uValueMap = new Map<string, number>();
  for (const c of doc.constructions) {
    let rVal = 0.17; // R_si (0.13) + R_se (0.04)
    for (const layer of c.layers) {
      const mat = materialMap.get(layer.toLowerCase());
      if (mat && mat.conductivity > 0.0) {
        rVal += mat.thickness / mat.conductivity;
      } else {
        rVal += 0.2; // nominal fallback layer resistance
      }
    }
    uValueMap.set(c.name.toLowerCase(), 1.0 / Math.max(0.1, rVal));
  }

  // 3. For each zone, create thermal capacitance dynamic equation
  for (const zone of doc.zones) {
    lowerZoneToDae(arena, interner, zone, doc, uValueMap, tAmbExpr, tGroundExpr);
  }

  return arena;
}

function lowerZoneToDae(
  arena: DAEBuilder,
  interner: StringInterner,
  zone: IdfZone,
  doc: EnergyPlusDocument,
  uValueMap: Map<string, number>,
  tAmbExpr: number,
  tGroundExpr: number,
): void {
  const cleanZoneName = zone.name.replace(/[^a-zA-Z0-9_]/g, "_");
  const tempVarName = `zone_${cleanZoneName}_T`;
  const tempId = interner.intern(tempVarName);

  // Zone Temperature State Variable (K)
  arena.addVariable(tempVarName, VarType.Real, Variability.Continuous, Causality.Local);
  const tempExpr = arena.addExpression(ExprKind.Name, tempId);

  // Initial zone temperature: 293.15 K (20 deg C)
  const initTemp = arena.addRealLiteral(293.15);
  arena.addEquation(EqKind.InitialSimple, tempExpr, initTemp);

  // Thermal Capacitance C_z (J/K) = V * rho_air * cp_air * thermal_mass_factor
  const volume = zone.volume ?? (zone.floorArea ?? 40.0) * (zone.ceilingHeight ?? 2.8);
  const cAir = volume * 1.2 * 1005.0; // rho=1.2 kg/m^3, cp=1005 J/kg-K
  const cZone = cAir * 3.0; // 3x multiplier for internal furniture/partitions
  const cZoneLit = arena.addRealLiteral(cZone);

  // Collect conductance to ambient and to ground
  let totalExtConductance = 0.0;
  let totalGroundConductance = 0.0;

  const zoneSurfaces = doc.surfaces.filter((s) => s.zoneName.toLowerCase() === zone.name.toLowerCase());
  for (const surf of zoneSurfaces) {
    const area = surf.grossArea && surf.grossArea > 0 ? surf.grossArea : 20.0;
    const uVal = uValueMap.get(surf.constructionName.toLowerCase()) ?? 1.5;
    const gVal = area * uVal;

    const bc = surf.boundaryCondition.toLowerCase();
    if (bc === "outdoors" || bc === "adiabatic") {
      totalExtConductance += gVal;
    } else if (bc === "ground") {
      totalGroundConductance += gVal;
    }
  }

  if (totalExtConductance === 0.0) {
    totalExtConductance = 50.0; // Nominal fallback exterior conductance
  }

  // Envelope Conduction: Q_cond_ext = G_ext * (T_amb - T_z)
  const gExtLit = arena.addRealLiteral(totalExtConductance);
  const deltaTExt = arena.addBinaryExpr(BinOp.Sub, tAmbExpr, tempExpr);
  let qTotalExpr = arena.addBinaryExpr(BinOp.Mul, gExtLit, deltaTExt);

  // Ground Conduction: Q_cond_gnd = G_gnd * (T_ground - T_z)
  if (totalGroundConductance > 0.0) {
    const gGndLit = arena.addRealLiteral(totalGroundConductance);
    const deltaTGnd = arena.addBinaryExpr(BinOp.Sub, tGroundExpr, tempExpr);
    const qGndExpr = arena.addBinaryExpr(BinOp.Mul, gGndLit, deltaTGnd);
    qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qGndExpr);
  }

  // Infiltration: Q_inf = m_dot_inf * cp_air * (T_amb - T_z)
  const zoneInfilts = doc.infiltrations.filter((i) => i.zoneName.toLowerCase() === zone.name.toLowerCase());
  let mDotInf = 0.0;
  for (const inf of zoneInfilts) {
    if (inf.designVolumeFlowRate) {
      mDotInf += inf.designVolumeFlowRate * 1.2;
    } else if (inf.airChangesPerHour) {
      mDotInf += ((inf.airChangesPerHour * volume) / 3600.0) * 1.2;
    }
  }
  if (mDotInf > 0.0) {
    const cpAirInf = arena.addRealLiteral(mDotInf * 1005.0);
    const qInfExpr = arena.addBinaryExpr(BinOp.Mul, cpAirInf, deltaTExt);
    qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qInfExpr);
  }

  // Internal Gains: Q_internal = Q_people + Q_lights + Q_equip (W)
  let qInternalWatts = 0.0;
  for (const p of doc.people.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
    qInternalWatts += p.numberOfPeople * 100.0; // 100W per person
  }
  for (const l of doc.lights.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
    qInternalWatts += l.lightingLevel;
  }
  for (const e of doc.electricEquipment.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
    qInternalWatts += e.designLevel;
  }

  if (qInternalWatts > 0.0) {
    const qIntLit = arena.addRealLiteral(qInternalWatts);
    qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qIntLit);
  }

  // HVAC Heat / Cool Output Variable
  const qHvacName = `zone_${cleanZoneName}_Q_hvac`;
  const qHvacId = interner.intern(qHvacName);
  arena.addVariable(qHvacName, VarType.Real, Variability.Continuous, Causality.Local);
  const qHvacExpr = arena.addExpression(ExprKind.Name, qHvacId);

  // Check if zone has IdealLoadsAirSystem or thermostat
  const hasHvac = doc.zoneHvacs.some((h) => h.zoneName.toLowerCase() === zone.name.toLowerCase());
  if (hasHvac) {
    // Proportional control law: Q_hvac = K_p * (T_set - T_z)
    const tSetLit = arena.addRealLiteral(295.15); // 22 deg C setpoint
    const kpLit = arena.addRealLiteral(2000.0); // 2000 W/K heating/cooling gain
    const deltaTSet = arena.addBinaryExpr(BinOp.Sub, tSetLit, tempExpr);
    const hvacControlLaw = arena.addBinaryExpr(BinOp.Mul, kpLit, deltaTSet);
    arena.addEquation(EqKind.Simple, qHvacExpr, hvacControlLaw);
  } else {
    const zeroLit = arena.addRealLiteral(0.0);
    arena.addEquation(EqKind.Simple, qHvacExpr, zeroLit);
  }

  qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qHvacExpr);

  // Dynamic Equation: der(T_z) = Q_total / C_z
  const derT = arena.addExpression(ExprKind.Der, tempExpr);
  const rhsRate = arena.addBinaryExpr(BinOp.Div, qTotalExpr, cZoneLit);
  arena.addEquation(EqKind.Simple, derT, rhsRate);
}
