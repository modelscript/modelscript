// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for ARINC 429 Avionics Flight-State Kinematics.
 *
 * Lowers decoded flight-state telemetry (altitude, airspeed, pitch, roll, heading)
 * and 3D point-mass aircraft kinematic ODEs directly into `@modelscript/runtime`'s
 * linear-memory `DAEBuilder` without intermediate AST wrapper allocations.
 */

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { analyzeBusUtilization, decodeFlightState } from "../solver/index.js";
import type { Arinc429Document } from "../types.js";

const FT_TO_M = 0.3048;
const KT_TO_MPS = 0.5144444444444445;
const DEG_TO_RAD = Math.PI / 180;
const G0_MPS2 = 9.80665;

export interface Arinc429DaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

export interface Arinc429ToDaeOptions {
  modelName?: string;
}

/**
 * Lowers ARINC 429 flight-state kinematics and bus parameters directly into an `IDaeBuilder`.
 *
 * Kinematic ODEs lowered:
 *  - `der(altitude_m) = airspeed_mps * sin(pitch_rad)`
 *  - `der(north_m)    = airspeed_mps * cos(pitch_rad) * cos(heading_rad)`
 *  - `der(east_m)     = airspeed_mps * cos(pitch_rad) * sin(heading_rad)`
 *  - `der(heading_rad)= (g / max(airspeed_mps, 1.0)) * tan(roll_rad)`  (coordinated turn)
 */
export function lowerArinc429ToDae(builder: IDaeBuilder, doc: Arinc429Document): Arinc429DaeLoweringResult {
  const flight = decodeFlightState(doc);
  const util = analyzeBusUtilization(doc);

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function addVar(name: string, variability: Variability, causality: Causality, startVal: number): number {
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // Bus timing parameters
  addVar("bus_bit_rate_bps", Variability.Parameter, Causality.Local, util.bitRateBps);
  addVar("bus_word_duration_s", Variability.Parameter, Causality.Local, util.wordDurationSec);
  addVar("bus_utilization_pct", Variability.Parameter, Causality.Local, util.utilizationPct);
  addVar("g0", Variability.Parameter, Causality.Local, G0_MPS2);

  // Flight-state inputs / initial conditions from decoded ARINC 429 words
  const altM0 = flight.altitudeFt * FT_TO_M;
  const airspeedMps0 = Math.max(flight.airspeedKt * KT_TO_MPS, 1.0);
  const pitchRad0 = flight.pitchDeg * DEG_TO_RAD;
  const rollRad0 = flight.rollDeg * DEG_TO_RAD;
  const headingRad0 = flight.headingDeg * DEG_TO_RAD;

  const altVar = addVar("altitude_m", Variability.Continuous, Causality.Output, altM0);
  const northVar = addVar("north_m", Variability.Continuous, Causality.Output, 0.0);
  const eastVar = addVar("east_m", Variability.Continuous, Causality.Output, 0.0);
  const headingVar = addVar("heading_rad", Variability.Continuous, Causality.Output, headingRad0);

  stateVarIndices.push(altVar, northVar, eastVar, headingVar);

  const airspeedVar = addVar("airspeed_mps", Variability.Parameter, Causality.Input, airspeedMps0);
  const pitchVar = addVar("pitch_rad", Variability.Parameter, Causality.Input, pitchRad0);
  const rollVar = addVar("roll_rad", Variability.Parameter, Causality.Input, rollRad0);
  const g0Var = variableMap.get("g0")!;

  // Precomputed trig factors as parameters for linear-memory kinematic ODEs
  const sinPitchVar = addVar("sin_pitch", Variability.Parameter, Causality.Local, Math.sin(pitchRad0));
  const cosPitchVar = addVar("cos_pitch", Variability.Parameter, Causality.Local, Math.cos(pitchRad0));
  const cosHdgVar = addVar("cos_heading", Variability.Parameter, Causality.Local, Math.cos(headingRad0));
  const sinHdgVar = addVar("sin_heading", Variability.Parameter, Causality.Local, Math.sin(headingRad0));
  const tanRollVar = addVar("tan_roll", Variability.Parameter, Causality.Local, Math.tan(rollRad0));

  // Algebraic telemetry observables
  addVar("mach", Variability.Parameter, Causality.Output, flight.mach);
  addVar("radio_alt_m", Variability.Parameter, Causality.Output, flight.radioAltFt * FT_TO_M);
  addVar("latitude_deg", Variability.Parameter, Causality.Output, flight.latitudeDeg);
  addVar("longitude_deg", Variability.Parameter, Causality.Output, flight.longitudeDeg);

  // Equation 1: der(altitude_m) = airspeed_mps * sin_pitch
  const derAlt = builder.addDer(altVar);
  const rhsAlt = builder.addBinaryExpr(BinOp.Mul, builder.addName(airspeedVar), builder.addName(sinPitchVar));
  builder.addEquation(EqKind.Simple, derAlt, rhsAlt);
  equationCount++;

  // Equation 2: der(north_m) = airspeed_mps * cos_pitch * cos_heading
  const derNorth = builder.addDer(northVar);
  const vHoriz1 = builder.addBinaryExpr(BinOp.Mul, builder.addName(airspeedVar), builder.addName(cosPitchVar));
  const rhsNorth = builder.addBinaryExpr(BinOp.Mul, vHoriz1, builder.addName(cosHdgVar));
  builder.addEquation(EqKind.Simple, derNorth, rhsNorth);
  equationCount++;

  // Equation 3: der(east_m) = airspeed_mps * cos_pitch * sin_heading
  const derEast = builder.addDer(eastVar);
  const vHoriz2 = builder.addBinaryExpr(BinOp.Mul, builder.addName(airspeedVar), builder.addName(cosPitchVar));
  const rhsEast = builder.addBinaryExpr(BinOp.Mul, vHoriz2, builder.addName(sinHdgVar));
  builder.addEquation(EqKind.Simple, derEast, rhsEast);
  equationCount++;

  // Equation 4: der(heading_rad) = (g0 / airspeed_mps) * tan_roll
  const derHdg = builder.addDer(headingVar);
  const gOverV = builder.addBinaryExpr(BinOp.Div, builder.addName(g0Var), builder.addName(airspeedVar));
  const rhsHdg = builder.addBinaryExpr(BinOp.Mul, gOverV, builder.addName(tanRollVar));
  builder.addEquation(EqKind.Simple, derHdg, rhsHdg);
  equationCount++;

  // Keep references to pitch/roll parameters in arena
  void pitchVar;
  void rollVar;

  return {
    stateVarIndices,
    equationCount,
    variableMap,
  };
}

/**
 * High-level wrapper lowering an ARINC 429 document into a fresh `DAEBuilder`.
 */
export function arinc429ToDae(doc: Arinc429Document, options?: Arinc429ToDaeOptions): DAEBuilder {
  const modelName = (options?.modelName || doc.busName || "Arinc429FlightKinematics").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerArinc429ToDae(builder, doc);
  return builder;
}
