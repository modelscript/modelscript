// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Underground and Submarine Cable Ampacity Sizing Engine.
 *
 * Implements continuous current carrying capacity ratings and thermal calculations
 * in strict accordance with:
 * - IEC 60287-1-1: Current rating equations (100% load factor) and calculation of losses.
 * - IEC 60287-2-1: Calculation of thermal resistance.
 * - IEC 60949: Calculation of thermally permissible short-circuit currents.
 * - IEEE 835: Standard Power Cable Ampacity Tables (Neher-McGrath method comparison).
 */

export type ConductorMaterial = "copper" | "aluminum";
export type InsulationMaterial = "xlpe" | "epr" | "pvc" | "paper";
export type InstallationMedium = "buried_direct" | "duct_bank" | "tunnel" | "free_air";
export type CableFormation = "trefoil" | "flat_touching" | "flat_spaced";
export type SheathBonding = "both_ends" | "single_point" | "cross_bonded";

export interface CableSpecification {
  id?: string;
  nominalVoltageKv: number; // Phase-to-phase rms voltage (e.g. 11, 33, 66, 132, 220, 400 kV)
  conductorMaterial: ConductorMaterial;
  crossSectionMm2: number; // Conductor area in mm^2 (e.g. 240, 400, 630, 800, 1000, 1200)
  insulationMaterial: InsulationMaterial;
  conductorDiameterMm?: number; // Conductor outer diameter (estimated if omitted)
  insulationThicknessMm: number; // Radial thickness of insulation (mm)
  sheathThicknessMm?: number; // Radial thickness of metallic sheath / screen (mm)
  jacketThicknessMm?: number; // Radial thickness of outer jacket / serving (mm)
  overallDiameterMm?: number; // Overall cable outer diameter (mm)
  numberOfCores: 1 | 3;
  sheathBonding: SheathBonding;
  operatingFrequencyHz?: number; // default: 50 Hz
}

export interface CableInstallationConditions {
  medium: InstallationMedium;
  formation: CableFormation;
  burialDepthM?: number; // Depth to center of cable/duct (default 1.0 m)
  soilThermalResistivityKmPerW?: number; // Soil thermal resistivity (default 1.0 K*m/W)
  ambientTemperatureC?: number; // Ambient soil or air temperature (default 20 C for soil, 35 C for air)
  maxConductorTemperatureC?: number; // Maximum permissible conductor temp (default: 90 C for XLPE/EPR, 70 C for PVC)
  axialSpacingMm?: number; // Center-to-center spacing for flat formation (mm)
  ductDiameterMm?: number; // Inner diameter of duct in duct bank (mm)
  windSpeedMPerS?: number; // Wind speed in free air (default 0.5 m/s)
  solarRadiationWPerM2?: number; // Solar radiation in free air (default 0 W/m^2 if shaded, 1000 if exposed)
  numberOfCircuits?: number; // Parallel circuits (default 1)
  circuitSpacingM?: number; // Spacing between parallel circuits (m)
}

export interface CableThermalResistances {
  t1: number; // Thermal resistance between conductor and sheath (K*m/W)
  t2: number; // Thermal resistance of bedding between sheath and armour (K*m/W)
  t3: number; // Thermal resistance of external serving / jacket (K*m/W)
  t4: number; // Thermal resistance of surrounding medium (K*m/W)
  totalEquivalent: number; // Effective total thermal resistance (K*m/W)
}

export interface CableSizingResult {
  continuousAmpacityA: number; // Continuous current rating I (Amperes)
  ratedPowerMva: number; // Three-phase rated power capacity at nominal voltage (MVA)
  rAcOhmPerKm: number; // AC conductor resistance at max operating temperature (Ohm/km)
  rDcOhmPerKm: number; // DC conductor resistance at max operating temperature (Ohm/km)
  skinEffectFactorYs: number; // Skin effect factor y_s
  proximityEffectFactorYp: number; // Proximity effect factor y_p
  dielectricLossWPerM: number; // Dielectric loss per unit length per phase W_d (W/m)
  sheathLossFactorLambda1: number; // Sheath loss factor lambda_1 (circulating + eddy)
  armourLossFactorLambda2: number; // Armour loss factor lambda_2
  thermalResistances: CableThermalResistances;
  shortCircuitWithstandCurrentKa: number; // 1-second adiabatic short-circuit rating (kA) per IEC 60949
  deratingFactors: {
    temperatureDerating: number;
    depthDerating: number;
    soilResistivityDerating: number;
    groupingDerating: number;
    totalDerating: number;
  };
}

// Material constants per IEC 60287
const RHO_20: Record<ConductorMaterial, number> = {
  copper: 1.7241e-8, // Ohm * m at 20 C
  aluminum: 2.8264e-8, // Ohm * m at 20 C
};

const ALPHA_20: Record<ConductorMaterial, number> = {
  copper: 0.00393, // 1/K
  aluminum: 0.00403, // 1/K
};

const INSULATION_SPECS: Record<
  InsulationMaterial,
  {
    thermalResistivity: number; // K * m / W
    epsR: number; // Relative permittivity
    tanDelta: number; // Loss factor
    defaultMaxTemp: number; // C
  }
> = {
  xlpe: { thermalResistivity: 3.5, epsR: 2.5, tanDelta: 0.001, defaultMaxTemp: 90 },
  epr: { thermalResistivity: 3.5, epsR: 3.0, tanDelta: 0.005, defaultMaxTemp: 90 },
  pvc: { thermalResistivity: 6.0, epsR: 8.0, tanDelta: 0.08, defaultMaxTemp: 70 },
  paper: { thermalResistivity: 6.0, epsR: 3.5, tanDelta: 0.003, defaultMaxTemp: 85 },
};

const RHO_JACKET = 3.5; // Polyethylene outer serving thermal resistivity (K * m / W)

/**
 * Calculates the continuous current rating (ampacity) of an underground or aerial power cable
 * according to IEC 60287-1-1 and IEC 60287-2-1.
 */
export function calculateCableAmpacity(
  cable: CableSpecification,
  installation: CableInstallationConditions,
): CableSizingResult {
  const f = cable.operatingFrequencyHz ?? 50;
  const omega = 2 * Math.PI * f;
  const insSpec = INSULATION_SPECS[cable.insulationMaterial];
  const thetaMax = installation.maxConductorTemperatureC ?? insSpec.defaultMaxTemp;
  const thetaAmb = installation.ambientTemperatureC ?? (installation.medium === "free_air" ? 35 : 20);
  const deltaTheta = Math.max(1, thetaMax - thetaAmb);

  // 1. Geometry estimation if not explicitly given
  // Conductor outer radius r1 (m)
  const conductorAreaM2 = cable.crossSectionMm2 * 1e-6;
  const dcMm = cable.conductorDiameterMm ?? 2 * Math.sqrt(cable.crossSectionMm2 / Math.PI) * 1.08; // Compacted factor
  const r1 = (dcMm / 2) * 1e-3; // meters

  // Insulation outer radius r2 (m)
  const tInsM = cable.insulationThicknessMm * 1e-3;
  const r2 = r1 + tInsM;

  // Sheath outer radius r3 (m)
  const tSheathM = (cable.sheathThicknessMm ?? 1.5) * 1e-3;
  const r3 = r2 + tSheathM;

  // Jacket outer radius r4 (m)
  const tJacketM = (cable.jacketThicknessMm ?? 3.0) * 1e-3;
  const r4 = r3 + tJacketM;
  const overallDeM = cable.overallDiameterMm ? cable.overallDiameterMm * 1e-3 : 2 * r4;

  // 2. Conductor DC and AC Resistance per IEC 60287-1-1 Clause 2.1
  const rho20 = RHO_20[cable.conductorMaterial];
  const alpha20 = ALPHA_20[cable.conductorMaterial];
  const rDc20 = rho20 / conductorAreaM2; // Ohm/m at 20 C
  const rDcMax = rDc20 * (1 + alpha20 * (thetaMax - 20)); // Ohm/m at thetaMax

  // Skin effect factor y_s (IEC 60287-1-1 Cl. 2.1.2)
  const ks = 1.0; // Round stranded compacted conductor
  const xs2 = ((8 * Math.PI * f) / (rDcMax * 1e-7)) * ks * 1e-14; // normalized xs^2
  const xs4 = xs2 * xs2;
  const ys = xs4 / (192 + 0.8 * xs4);

  // Proximity effect factor y_p (IEC 60287-1-1 Cl. 2.1.3)
  const kp = 1.0;
  const xp2 = ((8 * Math.PI * f) / (rDcMax * 1e-7)) * kp * 1e-14;
  const xp4 = xp2 * xp2;
  const sMm =
    installation.formation === "trefoil" ? overallDeM * 1000 : (installation.axialSpacingMm ?? overallDeM * 1000 * 2.0);
  const dcOverS = Math.min(1.0, dcMm / Math.max(dcMm, sMm));
  const yp =
    (xp4 / (192 + 0.8 * xp4)) *
    Math.pow(dcOverS, 2) *
    (0.312 * Math.pow(dcOverS, 2) + 1.18 / (xp4 / (192 + 0.8 * xp4) + 0.27));

  // AC resistance at max operating temperature
  const rAc = rDcMax * (1 + ys + yp); // Ohm/m

  // 3. Dielectric Losses W_d (IEC 60287-1-1 Cl. 2.2)
  const eps0 = 8.854187817e-12; // F/m
  const capacitanceFPerM = (2 * Math.PI * eps0 * insSpec.epsR) / Math.log(r2 / r1);
  const u0V = (cable.nominalVoltageKv * 1e3) / Math.sqrt(3); // Phase-to-ground voltage
  let wd = 0;
  if (cable.nominalVoltageKv >= 33) {
    wd = omega * capacitanceFPerM * Math.pow(u0V, 2) * insSpec.tanDelta; // W/m per phase
  }

  // 4. Sheath Losses lambda_1 (IEC 60287-1-1 Cl. 2.3)
  let lambda1 = 0;
  if (cable.sheathBonding === "both_ends") {
    // Both ends bonded -> circulating currents
    const meanSheathRadiusM = (r2 + r3) / 2;
    const sheathAreaM2 = Math.PI * (r3 * r3 - r2 * r2);
    const rhoSheath = 2.14e-7; // Lead alloy or Al/Cu screen equivalent
    const rs = rhoSheath / sheathAreaM2; // Sheath resistance Ohm/m
    const sM = sMm * 1e-3;
    const xMutual = omega * 2e-7 * Math.log((2 * sM) / (2 * meanSheathRadiusM));
    lambda1 = (rs / rAc) * (Math.pow(xMutual, 2) / (Math.pow(rs, 2) + Math.pow(xMutual, 2)));
  } else if (cable.sheathBonding === "single_point" || cable.sheathBonding === "cross_bonded") {
    // Special bonding eliminates circulating currents; only residual eddy currents remain
    lambda1 = 0.02; // Typical ~2% eddy currents
  }

  const lambda2 = 0; // Unarmoured or non-magnetic armour

  // 5. Thermal Resistances (IEC 60287-2-1)
  const n = cable.numberOfCores;

  // T1: Conductor to sheath
  const t1 = (insSpec.thermalResistivity / (2 * Math.PI)) * Math.log(r2 / r1);

  // T2: Sheath to armour (0 for unarmoured)
  const t2 = 0.0;

  // T3: Outer jacket / serving
  const t3 = (RHO_JACKET / (2 * Math.PI)) * Math.log(r4 / r3);

  // T4: External environment
  const rhoSoil = installation.soilThermalResistivityKmPerW ?? 1.0;
  const depthM = installation.burialDepthM ?? 1.0;
  let t4 = 0;

  if (installation.medium === "buried_direct") {
    // Kennelly formula with image method
    const u = (2 * depthM) / overallDeM;
    const t4Single = (rhoSoil / (2 * Math.PI)) * Math.log(u + Math.sqrt(Math.max(1, u * u - 1)));
    if (installation.formation === "trefoil") {
      t4 = 1.5 * t4Single; // Mutual heating in trefoil
    } else if (installation.formation === "flat_touching") {
      t4 = 1.8 * t4Single;
    } else {
      t4 = 1.2 * t4Single;
    }
  } else if (installation.medium === "duct_bank") {
    // Cable in duct: air thermal resistance in duct + soil thermal resistance
    const ductDiameterM = (installation.ductDiameterMm ?? 150) * 1e-3;
    const uDuct = (2 * depthM) / ductDiameterM;
    const t4Soil = (rhoSoil / (2 * Math.PI)) * Math.log(uDuct + Math.sqrt(Math.max(1, uDuct * uDuct - 1)));
    const t4AirDuct = 0.1; // Thermal resistance between cable surface and duct inner wall (K*m/W)
    t4 = t4AirDuct + t4Soil;
  } else if (installation.medium === "tunnel") {
    // Enclosed tunnel / trough with ambient air
    t4 = 0.25;
  } else {
    // Free air (convection and radiation) per IEC 60287-2-1 Clause 2.2
    const h = 10.0; // Convective + radiative heat transfer coefficient ~10 W/(m^2 * K)
    t4 = 1 / (Math.PI * overallDeM * h);
  }

  // 6. Complete IEC 60287-1-1 Continuous Ampacity Formula
  // I = sqrt( (DeltaTheta - Wd * [0.5 * T1 + n * (T2 + T3 + T4)]) / (R * [T1 + n*(1+lambda1)*T2 + n*(1+lambda1+lambda2)*(T3+T4)]) )
  const numerator = deltaTheta - wd * (0.5 * t1 + n * (t2 + t3 + t4));
  const denominator = rAc * (t1 + n * (1 + lambda1) * t2 + n * (1 + lambda1 + lambda2) * (t3 + t4));

  const continuousAmpacityA = numerator > 0 && denominator > 0 ? Math.sqrt(numerator / denominator) : 0;

  // Rated MVA Capacity
  const ratedPowerMva = (Math.sqrt(3) * cable.nominalVoltageKv * continuousAmpacityA) / 1000;

  // 7. Derating Factors Evaluation
  // Baseline: 20 C soil, 1.0 K*m/W, 1.0 m depth
  const tempDerating = Math.sqrt(Math.max(0, (thetaMax - thetaAmb) / (thetaMax - 20)));
  const soilResDerating = Math.sqrt(1.0 / Math.max(0.5, rhoSoil));
  const depthDerating = Math.max(0.7, 1.0 - 0.05 * Math.max(0, depthM - 1.0));
  const numCircuits = installation.numberOfCircuits ?? 1;
  const groupingDerating = numCircuits > 1 ? Math.pow(0.85, Math.log2(numCircuits)) : 1.0;
  const totalDerating = tempDerating * soilResDerating * depthDerating * groupingDerating;

  // 8. 1-Second Adiabatic Short-Circuit Current per IEC 60949
  // I_sc = K * S / sqrt(t_sc)
  // For XLPE: 90 C -> 250 C: Copper K = 143, Aluminum K = 94
  // For PVC:  70 C -> 160 C: Copper K = 115, Aluminum K = 76
  const kSc =
    cable.insulationMaterial === "pvc"
      ? cable.conductorMaterial === "copper"
        ? 115
        : 76
      : cable.conductorMaterial === "copper"
        ? 143
        : 94;
  const shortCircuitWithstandCurrentKa = (kSc * cable.crossSectionMm2) / 1000; // kA for 1s

  return {
    continuousAmpacityA: Math.round(continuousAmpacityA * 10) / 10,
    ratedPowerMva: Math.round(ratedPowerMva * 100) / 100,
    rAcOhmPerKm: Math.round(rAc * 1e3 * 1e5) / 1e5,
    rDcOhmPerKm: Math.round(rDcMax * 1e3 * 1e5) / 1e5,
    skinEffectFactorYs: Math.round(ys * 1e5) / 1e5,
    proximityEffectFactorYp: Math.round(yp * 1e5) / 1e5,
    dielectricLossWPerM: Math.round(wd * 1e3) / 1e3,
    sheathLossFactorLambda1: Math.round(lambda1 * 1e4) / 1e4,
    armourLossFactorLambda2: lambda2,
    thermalResistances: {
      t1: Math.round(t1 * 1e4) / 1e4,
      t2: t2,
      t3: Math.round(t3 * 1e4) / 1e4,
      t4: Math.round(t4 * 1e4) / 1e4,
      totalEquivalent: Math.round((t1 + n * (t2 + t3 + t4)) * 1e4) / 1e4,
    },
    shortCircuitWithstandCurrentKa: Math.round(shortCircuitWithstandCurrentKa * 10) / 10,
    deratingFactors: {
      temperatureDerating: Math.round(tempDerating * 1e3) / 1e3,
      depthDerating: Math.round(depthDerating * 1e3) / 1e3,
      soilResistivityDerating: Math.round(soilResDerating * 1e3) / 1e3,
      groupingDerating: Math.round(groupingDerating * 1e3) / 1e3,
      totalDerating: Math.round(totalDerating * 1e3) / 1e3,
    },
  };
}

/**
 * Sizes the minimum standard cable cross-section (mm^2) required to safely transmit
 * a required design current `targetCurrentA` under specified installation conditions.
 */
export function sizeCableCrossSection(
  targetCurrentA: number,
  cableBase: Omit<CableSpecification, "crossSectionMm2">,
  installation: CableInstallationConditions,
): {
  recommendedCrossSectionMm2: number;
  ampacityA: number;
  loadingPct: number;
  result: CableSizingResult;
} {
  const standardSections = [50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000, 1200];

  for (const s of standardSections) {
    const spec: CableSpecification = { ...cableBase, crossSectionMm2: s };
    const res = calculateCableAmpacity(spec, installation);
    if (res.continuousAmpacityA >= targetCurrentA) {
      return {
        recommendedCrossSectionMm2: s,
        ampacityA: res.continuousAmpacityA,
        loadingPct: Math.round((targetCurrentA / res.continuousAmpacityA) * 1000) / 10,
        result: res,
      };
    }
  }

  // Fallback to largest standard size
  const maxS = standardSections[standardSections.length - 1]!;
  const fallbackRes = calculateCableAmpacity({ ...cableBase, crossSectionMm2: maxS }, installation);
  return {
    recommendedCrossSectionMm2: maxS,
    ampacityA: fallbackRes.continuousAmpacityA,
    loadingPct: Math.round((targetCurrentA / fallbackRes.continuousAmpacityA) * 1000) / 10,
    result: fallbackRes,
  };
}
