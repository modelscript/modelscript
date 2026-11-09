// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Telecom Grandmaster & Base Station Oscillator Holdover DAE Lowering.
 *
 * Models phase time error drift x(t) and fractional frequency offset y(t)
 * during GNSS outages (e.g., solar flares, jamming, spoofing, cable cuts)
 * for OCXO, DOCXO, Rubidium, and CSAC oscillators.
 *
 * System of Differential Algebraic Equations:
 *   der(x) = y
 *   der(y) = D + alpha * der(T)
 *   der(T) = tempRate
 *   timeErrorNs = x * 1.0e9
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";

export type OscillatorType = "TCXO" | "OCXO" | "DOCXO" | "Rubidium" | "CSAC";

export interface OscillatorSpecs {
  type: OscillatorType;
  /** Initial fractional frequency accuracy (dimensionless, e.g. 1e-10 for OCXO, 1e-11 for Rubidium). */
  initialFrequencyOffset: number;
  /** Daily aging drift rate D_day (s/s per day). */
  agingDriftPerDay: number;
  /** Temperature coefficient alpha (s/s per Kelvin). */
  tempCoefficientPerKelvin: number;
}

export const TYPICAL_OSCILLATOR_SPECS: Record<OscillatorType, OscillatorSpecs> = {
  TCXO: {
    type: "TCXO",
    initialFrequencyOffset: 1.0e-7,
    agingDriftPerDay: 1.0e-8,
    tempCoefficientPerKelvin: 5.0e-8,
  },
  OCXO: {
    type: "OCXO",
    initialFrequencyOffset: 1.0e-10,
    agingDriftPerDay: 1.0e-11,
    tempCoefficientPerKelvin: 2.0e-11,
  },
  DOCXO: {
    type: "DOCXO",
    initialFrequencyOffset: 3.0e-11,
    agingDriftPerDay: 5.0e-12,
    tempCoefficientPerKelvin: 5.0e-12,
  },
  Rubidium: {
    type: "Rubidium",
    initialFrequencyOffset: 5.0e-12,
    agingDriftPerDay: 5.0e-13,
    tempCoefficientPerKelvin: 1.0e-12,
  },
  CSAC: {
    type: "CSAC",
    initialFrequencyOffset: 3.0e-10,
    agingDriftPerDay: 9.0e-12,
    tempCoefficientPerKelvin: 5.0e-11,
  },
};

export interface HoldoverSimulationConfig {
  oscillator: OscillatorSpecs | OscillatorType;
  /** Ambient temperature ramp rate in Kelvin per hour (default 1.0 K/hr). */
  temperatureRampKelvinPerHour?: number;
  /** Initial time error at GNSS loss in nanoseconds (default 20.0 ns). */
  initialTimeErrorNs?: number;
  /** Maximum allowable phase error before service degradation in nanoseconds (default 1500 ns for 5G TDD). */
  maxAllowableErrorNs?: number;
}

/**
 * Calculates analytical holdover duration in hours before phase error exceeds maxAllowableErrorNs.
 * x(t) = x0 + y0 * t + 0.5 * (D + alpha * dT_dt) * t^2
 */
export function computeAnalyticalHoldoverDurationHours(config: HoldoverSimulationConfig): number {
  const specs = typeof config.oscillator === "string" ? TYPICAL_OSCILLATOR_SPECS[config.oscillator] : config.oscillator;
  const x0 = (config.initialTimeErrorNs ?? 20.0) * 1e-9; // seconds
  const y0 = specs.initialFrequencyOffset;
  const xMax = (config.maxAllowableErrorNs ?? 1500.0) * 1e-9; // seconds

  const tempRampPerSec = (config.temperatureRampKelvinPerHour ?? 1.0) / 3600.0;
  const agingPerSec = specs.agingDriftPerDay / 86400.0;
  const effectiveA = 0.5 * (agingPerSec + specs.tempCoefficientPerKelvin * tempRampPerSec);

  // Solve quadratic: effectiveA * t^2 + y0 * t + (x0 - xMax) = 0
  const c = x0 - xMax;
  if (Math.abs(effectiveA) < 1e-25) {
    // Linear approximation
    const tSec = Math.abs(c / y0);
    return tSec / 3600.0;
  }

  const discriminant = y0 * y0 - 4.0 * effectiveA * c;
  if (discriminant < 0) {
    return 0.0;
  }

  const tSec = (-y0 + Math.sqrt(discriminant)) / (2.0 * effectiveA);
  return Math.max(0.0, tSec / 3600.0);
}

/**
 * Lowers oscillator holdover drift ODEs directly to DAEBuilder linear memory.
 */
export function lowerOscillatorHoldoverToDae(config: HoldoverSimulationConfig): DAEBuilder {
  const dae = new DAEBuilder(undefined, "OscillatorHoldover");
  const specs = typeof config.oscillator === "string" ? TYPICAL_OSCILLATOR_SPECS[config.oscillator] : config.oscillator;

  const x0Sec = (config.initialTimeErrorNs ?? 20.0) * 1e-9;
  const y0 = specs.initialFrequencyOffset;
  const dPerSec = specs.agingDriftPerDay / 86400.0;
  const dTPerSec = (config.temperatureRampKelvinPerHour ?? 1.0) / 3600.0;
  const alpha = specs.tempCoefficientPerKelvin;

  // Parameters
  const paramD = dae.addVariable("D", VarType.Real, Variability.Parameter, Causality.Local, dPerSec);
  dae.addEquation(EqKind.Simple, dae.addName(paramD), dae.addRealLiteral(dPerSec));

  const paramAlpha = dae.addVariable("alpha", VarType.Real, Variability.Parameter, Causality.Local, alpha);
  dae.addEquation(EqKind.Simple, dae.addName(paramAlpha), dae.addRealLiteral(alpha));

  const paramDtDt = dae.addVariable("dT_dt", VarType.Real, Variability.Parameter, Causality.Local, dTPerSec);
  dae.addEquation(EqKind.Simple, dae.addName(paramDtDt), dae.addRealLiteral(dTPerSec));

  // States
  const varX = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, x0Sec);
  dae.setVarState(varX);
  const varY = dae.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, y0);
  dae.setVarState(varY);
  const varT = dae.addVariable("T", VarType.Real, Variability.Continuous, Causality.Local, 298.15); // 25 C in K
  dae.setVarState(varT);
  const varTimeErrorNs = dae.addVariable(
    "timeErrorNs",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    x0Sec * 1e9,
  );

  // der(x) = y
  const derX = dae.addDer(varX);
  const nameY = dae.addName(varY);
  dae.addEquation(EqKind.Simple, derX, nameY);

  // der(T) = dT_dt
  const derT = dae.addDer(varT);
  const nameDtDt = dae.addName(paramDtDt);
  dae.addEquation(EqKind.Simple, derT, nameDtDt);

  // der(y) = D + alpha * dT_dt
  const derY = dae.addDer(varY);
  const nameD = dae.addName(paramD);
  const nameAlpha = dae.addName(paramAlpha);
  const alphaMulDtDt = dae.addBinaryExpr(BinOp.Mul, nameAlpha, nameDtDt);
  const rhsY = dae.addBinaryExpr(BinOp.Add, nameD, alphaMulDtDt);
  dae.addEquation(EqKind.Simple, derY, rhsY);

  // timeErrorNs = x * 1.0e9
  const nameTimeErrorNs = dae.addName(varTimeErrorNs);
  const nameX = dae.addName(varX);
  const rhsTimeError = dae.addBinaryExpr(BinOp.Mul, nameX, dae.addRealLiteral(1.0e9));
  dae.addEquation(EqKind.Simple, nameTimeErrorNs, rhsTimeError);

  return dae;
}
