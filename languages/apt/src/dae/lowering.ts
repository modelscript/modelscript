// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for APT (ISO 4342) CNC Machining Physics.
 *
 * Lowers feed rate, spindle speed, material removal rate (MRR), cutting power,
 * spindle torque, and cumulative removed-volume / energy / feed-progress ODEs
 * directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory arena.
 */

import { BinOp, Causality, EqKind, VarType, Variability, type IDaeBuilder } from "@modelscript/runtime";
import { solveAptToClData, type SolveClDataOptions } from "../cad/geometry-solver.js";
import { ensureBuiltInAptLibraryRegistered } from "../catalog/library-package-adapter.js";
import { parseAptProgram } from "../parser/apt-parser.js";
import type { AptProgram, ClDataProgram } from "../types.js";

const MM_PER_INCH = 25.4;

export interface AptMachiningPhysicsOptions extends SolveClDataOptions {
  /** Axial depth of cut a_p in mm (default: 5.0 mm). */
  axialDepthMm?: number | undefined;
  /** Radial width of cut a_e in mm (default: cutter diameter in mm, or 6.35 mm). */
  radialWidthMm?: number | undefined;
  /** Specific cutting energy k_c in N/mm^2 = J/cm^3 (default: 700.0 for Al 6061). */
  specificCuttingEnergyNmm2?: number | undefined;
  /** Spindle drive mechanical efficiency (0..1, default: 0.85). */
  spindleEfficiency?: number | undefined;
}

export interface AptDaeLoweringResult {
  clData: ClDataProgram;
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  /** Analytical steady-state machining physics metrics in SI/metric units. */
  metrics: {
    feedrateMmPerMin: number;
    spindleRpm: number;
    cuttingLengthMm: number;
    rapidLengthMm: number;
    cuttingTimeSec: number;
    totalCycleTimeSec: number;
    mrrMm3PerSec: number;
    cuttingPowerW: number;
    spindlePowerW: number;
    spindleTorqueNm: number;
    totalRemovedVolumeMm3: number;
    totalCuttingEnergyJ: number;
  };
}

/**
 * Lowers APT CNC cutting power, MRR, spindle torque, and cumulative machining ODEs into `IDaeBuilder`.
 */
export function lowerAptToDae(
  builder: IDaeBuilder,
  input: AptProgram | ClDataProgram | string,
  options: AptMachiningPhysicsOptions = {},
): AptDaeLoweringResult {
  ensureBuiltInAptLibraryRegistered();

  const clData: ClDataProgram =
    typeof input === "string"
      ? solveAptToClData(parseAptProgram(input), options)
      : "records" in input
        ? input
        : solveAptToClData(input, options);

  const unitScaleToMm = clData.units === "INCHES" ? MM_PER_INCH : 1.0;

  const cutterDiamMm = clData.cutterDiameter > 0 ? clData.cutterDiameter * unitScaleToMm : 12.7;
  const ap = options.axialDepthMm ?? 5.0;
  const ae = options.radialWidthMm ?? cutterDiamMm;
  const kc = options.specificCuttingEnergyNmm2 ?? 700.0;
  const eta = Math.max(0.05, Math.min(1.0, options.spindleEfficiency ?? 0.85));

  // Weighted average cutting feedrate across cutting records (converted to mm/min)
  let cutTimeMinSum = 0;
  let weightedFeed = 0;
  for (const rec of clData.records) {
    if ((rec.kind === "LINEAR" || rec.kind === "ARC_CW" || rec.kind === "ARC_CCW") && rec.length && rec.length > 0) {
      const f = rec.feedRate && rec.feedRate > 0 ? rec.feedRate : clData.feedRate;
      const dt = f > 0 ? rec.length / f : 0;
      cutTimeMinSum += dt;
      weightedFeed += f * dt;
    }
  }
  const avgFeedProgUnits = cutTimeMinSum > 0 ? weightedFeed / cutTimeMinSum : clData.feedRate;
  const feedrateMmPerMin = avgFeedProgUnits * unitScaleToMm;
  const spindleRpm = Math.max(1.0, clData.spindleRpm > 0 ? clData.spindleRpm : 1500.0);

  const cuttingLengthMm = clData.totalCuttingLength * unitScaleToMm;
  const rapidLengthMm = clData.totalRapidLength * unitScaleToMm;
  const cuttingTimeSec = clData.cuttingTimeMin * 60.0;
  const totalCycleTimeSec = clData.totalCycleTimeSec;

  const mrrMm3PerSec = (ap * ae * feedrateMmPerMin) / 60.0;
  const cuttingPowerW = kc * mrrMm3PerSec * 1e-3;
  const spindlePowerW = cuttingPowerW / eta;
  const omegaRadPerSec = (2.0 * Math.PI * spindleRpm) / 60.0;
  const spindleTorqueNm = omegaRadPerSec > 1e-9 ? spindlePowerW / omegaRadPerSec : 0.0;
  const totalRemovedVolumeMm3 = mrrMm3PerSec * cuttingTimeSec;
  const totalCuttingEnergyJ = spindlePowerW * cuttingTimeSec;

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];

  const addParam = (name: string, val: number): number => {
    const idx = builder.addVariable(name, VarType.Real, Variability.Parameter, Causality.Local, val);
    variableMap.set(name, idx);
    return idx;
  };

  const addVar = (name: string, startVal: number, isState = false): number => {
    const idx = builder.addVariable(name, VarType.Real, Variability.Continuous, Causality.Local, startVal);
    variableMap.set(name, idx);
    if (isState) stateVarIndices.push(idx);
    return idx;
  };

  // Parameters
  const vAp = addParam("axial_depth_mm", ap);
  const vAe = addParam("radial_width_mm", ae);
  const vKc = addParam("specific_cutting_energy_n_mm2", kc);
  const vEta = addParam("spindle_efficiency", eta);
  const vFeed = addParam("feedrate_mm_min", feedrateMmPerMin);
  const vRpm = addParam("spindle_rpm", spindleRpm);
  addParam("cutter_diameter_mm", cutterDiamMm);
  addParam("cutting_length_mm", cuttingLengthMm);
  addParam("rapid_length_mm", rapidLengthMm);
  addParam("total_cycle_time_s", totalCycleTimeSec);

  // Algebraic & dynamic state variables
  const vMrr = addVar("mrr_mm3_s", mrrMm3PerSec);
  const vPcut = addVar("cutting_power_w", cuttingPowerW);
  const vPspindle = addVar("spindle_power_w", spindlePowerW);
  const vOmega = addVar("spindle_omega_rad_s", omegaRadPerSec);
  const vTorque = addVar("spindle_torque_nm", spindleTorqueNm);
  const vVolRemoved = addVar("removed_volume_mm3", 0.0, true);
  const vEnergy = addVar("cutting_energy_j", 0.0, true);
  const vFeedProgress = addVar("feed_progress_mm", 0.0, true);

  let equationCount = 0;

  // Eq 1: mrr_mm3_s = (axial_depth_mm * radial_width_mm * feedrate_mm_min) / 60.0
  const apAe = builder.addBinaryExpr(BinOp.Mul, builder.addName(vAp), builder.addName(vAe));
  const apAeF = builder.addBinaryExpr(BinOp.Mul, apAe, builder.addName(vFeed));
  const mrrRhs = builder.addBinaryExpr(BinOp.Div, apAeF, builder.addRealLiteral(60.0));
  builder.addEquation(EqKind.Simple, builder.addName(vMrr), mrrRhs);
  equationCount++;

  // Eq 2: cutting_power_w = specific_cutting_energy_n_mm2 * mrr_mm3_s * 1e-3
  const kcMrr = builder.addBinaryExpr(BinOp.Mul, builder.addName(vKc), builder.addName(vMrr));
  const pCutRhs = builder.addBinaryExpr(BinOp.Mul, kcMrr, builder.addRealLiteral(1e-3));
  builder.addEquation(EqKind.Simple, builder.addName(vPcut), pCutRhs);
  equationCount++;

  // Eq 3: spindle_power_w = cutting_power_w / spindle_efficiency
  const pSpindleRhs = builder.addBinaryExpr(BinOp.Div, builder.addName(vPcut), builder.addName(vEta));
  builder.addEquation(EqKind.Simple, builder.addName(vPspindle), pSpindleRhs);
  equationCount++;

  // Eq 4: spindle_omega_rad_s = (2 * pi / 60) * spindle_rpm
  const omegaRhs = builder.addBinaryExpr(
    BinOp.Mul,
    builder.addRealLiteral((2.0 * Math.PI) / 60.0),
    builder.addName(vRpm),
  );
  builder.addEquation(EqKind.Simple, builder.addName(vOmega), omegaRhs);
  equationCount++;

  // Eq 5: spindle_torque_nm * spindle_omega_rad_s = spindle_power_w
  const torqueLhs = builder.addBinaryExpr(BinOp.Mul, builder.addName(vTorque), builder.addName(vOmega));
  builder.addEquation(EqKind.Simple, torqueLhs, builder.addName(vPspindle));
  equationCount++;

  // Eq 6 (ODE): der(removed_volume_mm3) = mrr_mm3_s
  builder.addEquation(EqKind.Simple, builder.addDer(vVolRemoved), builder.addName(vMrr));
  equationCount++;

  // Eq 7 (ODE): der(cutting_energy_j) = spindle_power_w
  builder.addEquation(EqKind.Simple, builder.addDer(vEnergy), builder.addName(vPspindle));
  equationCount++;

  // Eq 8 (ODE): der(feed_progress_mm) = feedrate_mm_min / 60.0
  const feedPerSec = builder.addBinaryExpr(BinOp.Div, builder.addName(vFeed), builder.addRealLiteral(60.0));
  builder.addEquation(EqKind.Simple, builder.addDer(vFeedProgress), feedPerSec);
  equationCount++;

  return {
    clData,
    stateVarIndices,
    equationCount,
    variableMap,
    metrics: {
      feedrateMmPerMin,
      spindleRpm,
      cuttingLengthMm,
      rapidLengthMm,
      cuttingTimeSec,
      totalCycleTimeSec,
      mrrMm3PerSec,
      cuttingPowerW,
      spindlePowerW,
      spindleTorqueNm,
      totalRemovedVolumeMm3,
      totalCuttingEnergyJ,
    },
  };
}
