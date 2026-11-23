// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for RS-274 / ISO 6983 CNC Machining Physics.
 *
 * Lowers feedrate, spindle speed, material removal rate (MRR), cutting power,
 * spindle torque, and cumulative volume/energy ODEs directly into `@modelscript/runtime`'s
 * `IDaeBuilder` linear memory arena.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { simulateToolpath } from "../cad/toolpath.js";
import { ensureBuiltInGCodeLibraryRegistered, lookupGCodeSchema } from "../catalog/library-package-adapter.js";
import type { GCodeProgram, ToolpathOptions, ToolpathSummary } from "../types.js";

export interface GCodeMachiningPhysicsOptions extends ToolpathOptions {
  /** Optional tool preset code from `@modelscript/gcode-std-lib` (e.g. "ENDMILL_CARBIDE_AL"). */
  toolPreset?: string | undefined;
  /** Axial depth of cut a_p in mm (default: 5.0 or preset). */
  axialDepthMm?: number | undefined;
  /** Radial width of cut a_e in mm (default: 5.0 or preset). */
  radialWidthMm?: number | undefined;
  /** Specific cutting energy k_c in N/mm^2 (default: 700.0 for Al 6061 or preset). */
  specificCuttingEnergyNmm2?: number | undefined;
  /** Spindle drive mechanical efficiency (0..1, default: 0.85). */
  spindleEfficiency?: number | undefined;
}

export interface GCodeDaeLoweringResult {
  summary: ToolpathSummary;
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  /** Analytical steady-state metrics for direct verification. */
  metrics: {
    mrrMm3PerSec: number;
    cuttingPowerW: number;
    spindlePowerW: number;
    spindleTorqueNm: number;
    totalRemovedVolumeMm3: number;
    totalCuttingEnergyJ: number;
  };
}

/**
 * Lowers CNC cutting power, MRR, spindle torque, and cumulative machining ODEs into `IDaeBuilder`.
 */
export function lowerGCodeToDae(
  builder: IDaeBuilder,
  input: GCodeProgram | ToolpathSummary | string,
  options: GCodeMachiningPhysicsOptions = {},
): GCodeDaeLoweringResult {
  ensureBuiltInGCodeLibraryRegistered();

  const summary: ToolpathSummary =
    typeof input === "object" && "segments" in input ? input : simulateToolpath(input, options);

  // Resolve defaults from cleanroom tool preset if specified
  let defaultAp = 5.0;
  let defaultAe = 5.0;
  let defaultKc = 700.0;
  if (options.toolPreset) {
    const schema = lookupGCodeSchema(options.toolPreset);
    if (schema) {
      for (const p of schema.parameters) {
        if (p.key === "axialDepthMm" && typeof p.defaultValue === "number") defaultAp = p.defaultValue;
        if (p.key === "radialWidthMm" && typeof p.defaultValue === "number") defaultAe = p.defaultValue;
        if (p.key === "specificCuttingEnergyNmm2" && typeof p.defaultValue === "number") defaultKc = p.defaultValue;
      }
    }
  }

  const ap = options.axialDepthMm ?? defaultAp;
  const ae = options.radialWidthMm ?? defaultAe;
  const kc = options.specificCuttingEnergyNmm2 ?? defaultKc;
  const eta = Math.max(0.05, Math.min(1.0, options.spindleEfficiency ?? 0.85));

  // Weighted average cutting feedrate & spindle RPM across cutting segments
  let cutTimeSum = 0;
  let weightedFeed = 0;
  let weightedRpm = 0;
  for (const seg of summary.segments) {
    if (seg.kind === "linear" || seg.kind === "arc_cw" || seg.kind === "arc_ccw" || seg.kind === "drill_plunge") {
      cutTimeSum += seg.durationSec;
      weightedFeed += seg.feedrateMmPerMin * seg.durationSec;
      weightedRpm += seg.spindleRpm * seg.durationSec;
    }
  }
  const avgFeedMmMin = cutTimeSum > 0 ? weightedFeed / cutTimeSum : summary.feedrateMaxMmPerMin;
  const avgRpm = cutTimeSum > 0 ? weightedRpm / cutTimeSum : Math.max(1, summary.spindleRpmMax);

  const mrrMm3PerSec = (ap * ae * avgFeedMmMin) / 60.0;
  const cuttingPowerW = kc * mrrMm3PerSec * 1e-3;
  const spindlePowerW = cuttingPowerW / eta;
  const omegaRadPerSec = (2.0 * Math.PI * avgRpm) / 60.0;
  const spindleTorqueNm = omegaRadPerSec > 1e-9 ? spindlePowerW / omegaRadPerSec : 0.0;
  const totalRemovedVolumeMm3 = mrrMm3PerSec * summary.cuttingTimeSec;
  const totalCuttingEnergyJ = spindlePowerW * summary.cuttingTimeSec;

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
  const vFeed = addParam("feedrate_mm_min", avgFeedMmMin);
  const vRpm = addParam("spindle_rpm", avgRpm);
  addParam("cutting_length_mm", summary.cuttingLengthMm);
  addParam("rapid_length_mm", summary.rapidLengthMm);
  addParam("total_cycle_time_s", summary.totalCycleTimeSec);

  // Algebraic & dynamic state variables
  const vMrr = addVar("mrr_mm3_s", mrrMm3PerSec);
  const vPcut = addVar("cutting_power_w", cuttingPowerW);
  const vPspindle = addVar("spindle_power_w", spindlePowerW);
  const vOmega = addVar("spindle_omega_rad_s", omegaRadPerSec);
  const vTorque = addVar("spindle_torque_nm", spindleTorqueNm);
  const vVolRemoved = addVar("removed_volume_mm3", 0.0, true);
  const vEnergy = addVar("cutting_energy_j", 0.0, true);

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

  return {
    summary,
    stateVarIndices,
    equationCount,
    variableMap,
    metrics: {
      mrrMm3PerSec,
      cuttingPowerW,
      spindlePowerW,
      spindleTorqueNm,
      totalRemovedVolumeMm3,
      totalCuttingEnergyJ,
    },
  };
}
