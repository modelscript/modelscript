// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Direct Linear-Memory DAE Lowering.
 *
 * Lowers multi-zone building thermal models, 3R2C envelope thermal capacitance,
 * glazing conduction, infiltration, internal gains, and HVAC loops directly into
 * ModelScript's zero-GC linear memory DAEBuilder arena.
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
import type { EnergyPlusDocument, IdfMaterial, IdfMaterialNoMass, IdfSurface, IdfVertex3D, IdfZone } from "../types.js";

function computePolygonArea(vertices: IdfVertex3D[]): number {
  if (vertices.length < 3) return 0.0;
  const v0 = vertices[0];
  if (!v0) return 0.0;
  let nx = 0.0;
  let ny = 0.0;
  let nz = 0.0;
  for (let i = 1; i < vertices.length - 1; i++) {
    const v1 = vertices[i];
    const v2 = vertices[i + 1];
    if (!v1 || !v2) continue;
    const ux = v1.x - v0.x;
    const uy = v1.y - v0.y;
    const uz = v1.z - v0.z;
    const vx = v2.x - v0.x;
    const vy = v2.y - v0.y;
    const vz = v2.z - v0.z;
    nx += uy * vz - uz * vy;
    ny += uz * vx - ux * vz;
    nz += ux * vy - uy * vx;
  }
  return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
}

export function lowerEnergyPlusToDae(doc: EnergyPlusDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? doc.building?.name ?? "EnergyPlus_Building";
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  // 1. Ambient Conditions Parameters (T_amb = 283.15 K = 10 deg C)
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

  // 2. Pre-calculate construction thermal transmittances (U-values) and areal thermal capacitances
  const materialMap = new Map<string, IdfMaterial>();
  for (const m of doc.materials) {
    materialMap.set(m.name.toLowerCase(), m);
  }
  const materialNoMassMap = new Map<string, IdfMaterialNoMass>();
  for (const m of doc.materialsNoMass) {
    materialNoMassMap.set(m.name.toLowerCase(), m);
  }

  const uValueMap = new Map<string, number>();
  const cWallPerAreaMap = new Map<string, number>();
  for (const c of doc.constructions) {
    let rVal = 0.17; // R_si (0.13) + R_se (0.04)
    let cPerArea = 0.0;
    for (const layer of c.layers) {
      const mat = materialMap.get(layer.toLowerCase());
      const matNoMass = materialNoMassMap.get(layer.toLowerCase());
      if (mat && mat.conductivity > 0.0) {
        rVal += mat.thickness / mat.conductivity;
        if (mat.density > 0.0 && mat.specificHeat > 0.0 && mat.thickness > 0.0) {
          cPerArea += mat.density * mat.specificHeat * mat.thickness;
        }
      } else if (matNoMass && matNoMass.thermalResistance > 0.0) {
        rVal += matNoMass.thermalResistance;
      } else {
        rVal += 0.2; // nominal fallback layer resistance
      }
    }
    uValueMap.set(c.name.toLowerCase(), 1.0 / Math.max(0.1, rVal));
    cWallPerAreaMap.set(c.name.toLowerCase(), cPerArea);
  }

  // 3. For each zone, create thermal capacitance dynamic equation (and 3R2C wall thermal mass when present)
  for (const zone of doc.zones) {
    lowerZoneToDae(arena, interner, zone, doc, uValueMap, cWallPerAreaMap, tAmbExpr, tGroundExpr);
  }

  return arena;
}

function lowerZoneToDae(
  arena: DAEBuilder,
  interner: StringInterner,
  zone: IdfZone,
  doc: EnergyPlusDocument,
  uValueMap: Map<string, number>,
  cWallPerAreaMap: Map<string, number>,
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

  // Collect conductance to ambient, ground, and interzone surfaces
  let totalExtConductance = 0.0;
  let totalExtWallCap = 0.0;
  let totalGroundConductance = 0.0;
  const interzoneConductances = new Map<string, number>();

  const surfaceByName = new Map<string, IdfSurface>();
  for (const s of doc.surfaces) {
    surfaceByName.set(s.name.toLowerCase(), s);
  }
  const zoneByName = new Map<string, IdfZone>();
  for (const z of doc.zones) {
    zoneByName.set(z.name.toLowerCase(), z);
  }

  const zoneSurfaces = doc.surfaces.filter((s) => s.zoneName.toLowerCase() === zone.name.toLowerCase());
  const zoneSurfaceNames = new Set(zoneSurfaces.map((s) => s.name.toLowerCase()));

  for (const surf of zoneSurfaces) {
    const area = surf.grossArea && surf.grossArea > 0 ? surf.grossArea : 20.0;
    const uVal = uValueMap.get(surf.constructionName.toLowerCase()) ?? 1.5;
    const cPerArea = cWallPerAreaMap.get(surf.constructionName.toLowerCase()) ?? 0.0;
    const gVal = area * uVal;

    const bc = surf.boundaryCondition.toLowerCase();
    if (bc === "outdoors") {
      totalExtConductance += gVal;
      totalExtWallCap += area * cPerArea;
    } else if (bc === "ground") {
      totalGroundConductance += gVal;
    } else if (bc === "surface" || bc === "zone") {
      const targetObj = surf.outsideBoundaryConditionObject;
      if (targetObj) {
        const targetSurf = surfaceByName.get(targetObj.toLowerCase());
        const targetZone = targetSurf
          ? zoneByName.get(targetSurf.zoneName.toLowerCase())
          : zoneByName.get(targetObj.toLowerCase());
        if (targetZone && targetZone.name.toLowerCase() !== zone.name.toLowerCase()) {
          const prevG = interzoneConductances.get(targetZone.name) ?? 0.0;
          interzoneConductances.set(targetZone.name, prevG + gVal);
        }
      }
    }
    // Note: bc === "adiabatic" contributes 0 conductance to outdoors, ground, and other zones
  }

  // Account for fenestration (windows / glass doors) mounted on zone surfaces
  let totalWinConductance = 0.0;
  for (const fen of doc.fenestrations) {
    if (zoneSurfaceNames.has(fen.buildingSurfaceName.toLowerCase())) {
      const winArea = computePolygonArea(fen.vertices) || 4.0;
      const uWin = uValueMap.get(fen.constructionName.toLowerCase()) ?? 2.8;
      totalWinConductance += winArea * uWin;
    }
  }

  if (zoneSurfaces.length === 0 && totalExtConductance === 0.0) {
    totalExtConductance = 50.0; // Nominal fallback exterior conductance when zone has no surfaces defined
  }

  const deltaTExt = arena.addBinaryExpr(BinOp.Sub, tAmbExpr, tempExpr);
  let qTotalExpr: number;

  if (totalExtWallCap > 0.0 && totalExtConductance > 0.0) {
    // 3R2C Thermal Network: Explicit Wall Thermal Mass Node T_wall_<zone>
    const wallVarName = `T_wall_${cleanZoneName}`;
    const wallId = interner.intern(wallVarName);
    arena.addVariable(wallVarName, VarType.Real, Variability.Continuous, Causality.Local);
    const wallExpr = arena.addExpression(ExprKind.Name, wallId);

    // Initial wall temperature: 290.15 K (17 deg C)
    const initWallTemp = arena.addRealLiteral(290.15);
    arena.addEquation(EqKind.InitialSimple, wallExpr, initWallTemp);

    // Split wall resistance into outer and inner halves: G_out = 2*G_ext, G_in = 2*G_ext
    const gWallOutLit = arena.addRealLiteral(2.0 * totalExtConductance);
    const gWallInLit = arena.addRealLiteral(2.0 * totalExtConductance);
    const cWallLit = arena.addRealLiteral(totalExtWallCap);

    const qWallFromAmb = arena.addBinaryExpr(
      BinOp.Mul,
      gWallOutLit,
      arena.addBinaryExpr(BinOp.Sub, tAmbExpr, wallExpr),
    );
    const qWallFromZone = arena.addBinaryExpr(
      BinOp.Mul,
      gWallInLit,
      arena.addBinaryExpr(BinOp.Sub, tempExpr, wallExpr),
    );
    const qWallNet = arena.addBinaryExpr(BinOp.Add, qWallFromAmb, qWallFromZone);
    const derWall = arena.addExpression(ExprKind.Der, wallExpr);
    arena.addEquation(EqKind.Simple, derWall, arena.addBinaryExpr(BinOp.Div, qWallNet, cWallLit));

    // Conduction into zone air from inner wall surface: G_in * (T_wall - T_z)
    qTotalExpr = arena.addBinaryExpr(BinOp.Mul, gWallInLit, arena.addBinaryExpr(BinOp.Sub, wallExpr, tempExpr));

    if (totalWinConductance > 0.0) {
      const gWinLit = arena.addRealLiteral(totalWinConductance);
      const qWinExpr = arena.addBinaryExpr(BinOp.Mul, gWinLit, deltaTExt);
      qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qWinExpr);
    }
  } else {
    // Purely resistive envelope conduction: Q_cond_ext = (G_ext + G_win) * (T_amb - T_z)
    const gExtLit = arena.addRealLiteral(totalExtConductance + totalWinConductance);
    qTotalExpr = arena.addBinaryExpr(BinOp.Mul, gExtLit, deltaTExt);
  }

  // Ground Conduction: Q_cond_gnd = G_gnd * (T_ground - T_z)
  if (totalGroundConductance > 0.0) {
    const gGndLit = arena.addRealLiteral(totalGroundConductance);
    const deltaTGnd = arena.addBinaryExpr(BinOp.Sub, tGroundExpr, tempExpr);
    const qGndExpr = arena.addBinaryExpr(BinOp.Mul, gGndLit, deltaTGnd);
    qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qGndExpr);
  }

  // Interzone Conduction: Q_cond_iz = G_iz * (T_other - T_z)
  for (const [otherZoneName, gIz] of interzoneConductances) {
    if (gIz > 0.0) {
      const cleanOther = otherZoneName.replace(/[^a-zA-Z0-9_]/g, "_");
      const otherTempId = interner.intern(`zone_${cleanOther}_T`);
      const otherTempExpr = arena.addExpression(ExprKind.Name, otherTempId);
      const gIzLit = arena.addRealLiteral(gIz);
      const deltaTIz = arena.addBinaryExpr(BinOp.Sub, otherTempExpr, tempExpr);
      const qIzExpr = arena.addBinaryExpr(BinOp.Mul, gIzLit, deltaTIz);
      qTotalExpr = arena.addBinaryExpr(BinOp.Add, qTotalExpr, qIzExpr);
    }
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
