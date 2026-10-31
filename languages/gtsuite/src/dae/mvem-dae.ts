// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import type {
  GtCylinderComponent,
  GtModel,
  GtPlenumComponent,
  GtShaftComponent,
  GtTurboCompressorComponent,
  GtTurboTurbineComponent,
} from "../types.js";

export interface GtDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

/**
 * Lowers a GT-SUITE engine model into @modelscript/runtime's IDaeBuilder linear memory representation
 * using Mean-Value Engine Model (MVEM) continuous differential-algebraic equations.
 */
export function lowerGtSuiteToDae(builder: IDaeBuilder, model: GtModel): GtDaeLoweringResult {
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function getOrAddVar(name: string, variability: Variability = Variability.Continuous, startVal = 0.0): number {
    const key = name.toUpperCase();
    if (variableMap.has(key)) return variableMap.get(key)!;

    const existingIdx = builder.lookupVariable(name);
    if (existingIdx !== -1) {
      variableMap.set(key, existingIdx);
      return existingIdx;
    }

    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  // Aggregate engine displacement and cylinder counts
  const cylinders = model.components.filter((c) => c.kind === "cylinder") as GtCylinderComponent[];
  let totalDisplacementM3 = 0.0;
  for (const cyl of cylinders) {
    totalDisplacementM3 += cyl.displacementM3 ?? (Math.PI / 4) * cyl.boreM * cyl.boreM * cyl.strokeM;
  }
  if (totalDisplacementM3 <= 0.0) totalDisplacementM3 = 0.002; // default 2.0L

  const engineSpeedRpm = model.simulationSettings.engineSpeedRpm || 3000.0;
  const speedVar = getOrAddVar("engine_speed_rpm", Variability.Parameter, engineSpeedRpm);
  builder.addEquation(EqKind.Simple, builder.addName(speedVar), builder.addRealLiteral(engineSpeedRpm));
  equationCount++;

  // 1. Intake Manifold Dynamics: dPim/dt = (R * T_im / V_im) * (mdot_throttle - mdot_eng)
  const intakePlenum = model.components.find((c) => c.kind === "plenum" || c.kind === "flow_split") as
    | GtPlenumComponent
    | undefined;
  const vIm = intakePlenum?.volumeM3 ?? 0.0035;
  const pIm0 = intakePlenum?.initialPressurePa ?? 101325.0;

  const pImVar = getOrAddVar("P_intake_manifold", Variability.Continuous, pIm0);
  stateVarIndices.push(pImVar);

  const mdotAirVar = getOrAddVar("mdot_air_in", Variability.Continuous, 0.05);
  const mdotEngVar = getOrAddVar("mdot_engine_flow", Variability.Continuous, 0.05);

  // mdot_eng = eta_v * (Vd * N / 120) * (Pim / (R * Tim))
  // Constant factor = 0.88 * (Vd / 120) / (287.05 * 315)
  const etaV = 0.88;
  const rGas = 287.05;
  const tIm = 315.0; // K (after intercooler)
  const engFlowCoeff = (etaV * totalDisplacementM3) / (120.0 * rGas * tIm);

  const termEngFlow = builder.addBinaryExpr(
    BinOp.Mul,
    builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(engFlowCoeff), builder.addName(speedVar)),
    builder.addName(pImVar),
  );
  builder.addEquation(EqKind.Simple, builder.addName(mdotEngVar), termEngFlow);
  equationCount++;

  // der(P_im) = (R * T_im / V_im) * (mdot_air - mdot_eng)
  const manifoldGain = (rGas * tIm) / Math.max(1e-5, vIm);
  const deltaMdotIm = builder.addBinaryExpr(BinOp.Sub, builder.addName(mdotAirVar), builder.addName(mdotEngVar));
  const derPim = builder.addDer(pImVar);
  const rhsDerPim = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(manifoldGain), deltaMdotIm);
  builder.addEquation(EqKind.Simple, derPim, rhsDerPim);
  equationCount++;

  // 2. Exhaust Manifold Dynamics: dPem/dt = (R * T_em / V_em) * (mdot_eng + mdot_fuel - mdot_turb)
  const pEm0 = 120000.0;
  const pEmVar = getOrAddVar("P_exhaust_manifold", Variability.Continuous, pEm0);
  stateVarIndices.push(pEmVar);

  const mdotFuelVar = getOrAddVar("mdot_fuel", Variability.Continuous, 0.0035);
  const mdotTurbVar = getOrAddVar("mdot_turbine", Variability.Continuous, 0.0535);

  // Fuel flow based on stoich AFR (14.7) * lambda
  const afr = 14.7 * (model.simulationSettings.airFuelRatioLambda || 1.0);
  const fuelCoeff = 1.0 / afr;
  const rhsMdotFuel = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(fuelCoeff), builder.addName(mdotEngVar));
  builder.addEquation(EqKind.Simple, builder.addName(mdotFuelVar), rhsMdotFuel);
  equationCount++;

  // Constitutive equation for exhaust turbine/nozzle flow: mdot_turbine = c_turb * P_exhaust_manifold
  const turbFlowCoeff = 0.0535 / pEm0;
  const rhsMdotTurb = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(turbFlowCoeff), builder.addName(pEmVar));
  builder.addEquation(EqKind.Simple, builder.addName(mdotTurbVar), rhsMdotTurb);
  equationCount++;

  const vEm = 0.0025;
  const tEm = 1050.0; // K
  const exhManifoldGain = (rGas * tEm) / Math.max(1e-5, vEm);
  const mdotExhIn = builder.addBinaryExpr(BinOp.Add, builder.addName(mdotEngVar), builder.addName(mdotFuelVar));
  const deltaMdotEm = builder.addBinaryExpr(BinOp.Sub, mdotExhIn, builder.addName(mdotTurbVar));
  const derPem = builder.addDer(pEmVar);
  const rhsDerPem = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(exhManifoldGain), deltaMdotEm);
  builder.addEquation(EqKind.Simple, derPem, rhsDerPem);
  equationCount++;

  // 3. Turbocharger Shaft Dynamics: J_tc * der(omega_tc) = (P_turb * eta_m - P_comp) / omega_tc
  const shaft = model.components.find((c) => c.kind === "shaft") as GtShaftComponent | undefined;
  const compressor = model.components.find((c) => c.kind === "turbo_compressor") as
    | GtTurboCompressorComponent
    | undefined;
  const turbine = model.components.find((c) => c.kind === "turbo_turbine") as GtTurboTurbineComponent | undefined;

  if (shaft || (compressor && turbine)) {
    const inertia = shaft?.momentOfInertiaKgM2 ?? 0.00008;
    const rpm0 = shaft?.speedRpm ?? compressor?.speedRpm ?? 100000.0;
    const omega0 = (rpm0 * 2.0 * Math.PI) / 60.0;

    const omegaTcVar = getOrAddVar("omega_turbo_rad_s", Variability.Continuous, omega0);
    stateVarIndices.push(omegaTcVar);

    // Constitutive equation for compressor mass flow: mdot_air_in = c_comp * omega_turbo_rad_s
    const mdotAir0 = compressor?.massFlowKgS ?? 0.05;
    const compFlowCoeff = mdotAir0 / Math.max(1.0, omega0);
    const rhsMdotAir = builder.addBinaryExpr(
      BinOp.Mul,
      builder.addRealLiteral(compFlowCoeff),
      builder.addName(omegaTcVar),
    );
    builder.addEquation(EqKind.Simple, builder.addName(mdotAirVar), rhsMdotAir);
    equationCount++;

    const pCompVar = getOrAddVar("power_compressor_w", Variability.Continuous, 8000.0);
    const pTurbVar = getOrAddVar("power_turbine_w", Variability.Continuous, 8200.0);

    // Constitutive equation for compressor power: P_comp = mdot_air_in * cp_air * T_amb / eta_c * (PR^(0.286) - 1)
    const cpAir = 1005.0;
    const tAmb = 298.15;
    const etaComp = Math.max(0.4, compressor?.efficiency ?? 0.76);
    const prRatioExpr = builder.addBinaryExpr(BinOp.Div, builder.addName(pImVar), builder.addRealLiteral(101325.0));
    const prMinusOne = builder.addBinaryExpr(BinOp.Sub, prRatioExpr, builder.addRealLiteral(1.0));
    const compEnthalpyFactor = (cpAir * tAmb * 0.286) / etaComp;
    const rhsPComp = builder.addBinaryExpr(
      BinOp.Mul,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(mdotAirVar), builder.addRealLiteral(compEnthalpyFactor)),
      prMinusOne,
    );
    builder.addEquation(EqKind.Simple, builder.addName(pCompVar), rhsPComp);
    equationCount++;

    // Constitutive equation for turbine power: P_turb = mdot_turbine * cp_exh * T_em * eta_t * (1 - (P_amb / P_em)^0.259)
    const cpExh = 1150.0;
    const etaTurb = Math.max(0.4, turbine?.efficiency ?? 0.72);
    const erMinusOne = builder.addBinaryExpr(
      BinOp.Sub,
      builder.addBinaryExpr(BinOp.Div, builder.addName(pEmVar), builder.addRealLiteral(101325.0)),
      builder.addRealLiteral(1.0),
    );
    const turbEnthalpyFactor = cpExh * tEm * etaTurb * 0.259;
    const rhsPTurb = builder.addBinaryExpr(
      BinOp.Mul,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(mdotTurbVar), builder.addRealLiteral(turbEnthalpyFactor)),
      erMinusOne,
    );
    builder.addEquation(EqKind.Simple, builder.addName(pTurbVar), rhsPTurb);
    equationCount++;

    // Power balance ODE: der(omega_tc) = (pTurb * 0.95 - pComp) / (J * omega_tc)
    const netPower = builder.addBinaryExpr(
      BinOp.Sub,
      builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(0.95), builder.addName(pTurbVar)),
      builder.addName(pCompVar),
    );
    const jOmega = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(inertia), builder.addName(omegaTcVar));
    const rhsDerOmega = builder.addBinaryExpr(BinOp.Div, netPower, jOmega);
    const derOmega = builder.addDer(omegaTcVar);
    builder.addEquation(EqKind.Simple, derOmega, rhsDerOmega);
    equationCount++;
  } else {
    // Naturally aspirated intake throttle constitutive equation: mdot_air_in = mdot_engine_flow
    builder.addEquation(EqKind.Simple, builder.addName(mdotAirVar), builder.addName(mdotEngVar));
    equationCount++;
  }

  // 4. Engine Torque & Power
  const torqueVar = getOrAddVar("engine_brake_torque_nm", Variability.Continuous, 250.0);
  const powerVar = getOrAddVar("engine_brake_power_kw", Variability.Continuous, 78.5);

  // Torque ~ (mdot_fuel * LHV * eta_th) / omega_eng
  const lhv = 44.0e6; // J/kg
  const etaTh = 0.36; // thermal efficiency
  const omegaEng = (engineSpeedRpm * 2.0 * Math.PI) / 60.0;
  const torqueCoeff = (lhv * etaTh) / Math.max(1.0, omegaEng);

  const rhsTorque = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(torqueCoeff), builder.addName(mdotFuelVar));
  builder.addEquation(EqKind.Simple, builder.addName(torqueVar), rhsTorque);
  equationCount++;

  // Power (kW) = Torque * omega_eng / 1000
  const powerCoeff = omegaEng / 1000.0;
  const rhsPower = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(powerCoeff), builder.addName(torqueVar));
  builder.addEquation(EqKind.Simple, builder.addName(powerVar), rhsPower);
  equationCount++;

  return {
    stateVarIndices,
    equationCount,
    variableMap,
  };
}
