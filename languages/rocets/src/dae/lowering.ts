// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for NASA ROCETS Liquid Propulsion Engine Decks.
 *
 * Translates propulsion modules (turbopumps, combustion chambers, regenerative
 * cooling jackets, piping manifolds, valves, and rotating shafts) directly into
 * @modelscript/runtime's IDaeBuilder linear memory representation without
 * allocating intermediate AST wrappers.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { lowerRocetsRoutineToDae } from "../script/user-routines.js";
import type { RocetsEngineModel } from "../types.js";

export interface RocetsDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
}

export function lowerRocetsToDae(builder: IDaeBuilder, model: RocetsEngineModel): RocetsDaeLoweringResult {
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  let equationCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
  ): number {
    const key = name.toUpperCase();
    const mapped = variableMap.get(key);
    if (mapped !== undefined) return mapped;

    const existingIdx = builder.lookupVariable(name);
    if (existingIdx !== -1) {
      variableMap.set(key, existingIdx);
      return existingIdx;
    }

    const idx = builder.addVariable(name, VarType.Real, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  // 1. Lower Modules/Components
  for (const [compId, comp] of model.components) {
    const typeUpper = comp.type.toUpperCase();

    // Register all component ports as variables
    for (const portName of Object.keys(comp.ports)) {
      const varName = `${compId}_${portName}`;
      getOrAddVar(varName, Variability.Continuous, 0.0);
    }

    switch (typeUpper) {
      case "CHAMBER":
      case "TC":
      case "COMBUSTOR": {
        // Combustion Chamber Dynamics
        // Vc * dPc/dt = (gamma * R * Tc / Vc) * (mdot_in - Pc * At / cstar)
        const vc = typeof comp.parameters["VC"] === "number" ? comp.parameters["VC"] : 0.01;
        const at = typeof comp.parameters["AT"] === "number" ? comp.parameters["AT"] : 0.005;
        const cstar = typeof comp.parameters["CSTAR"] === "number" ? comp.parameters["CSTAR"] : 1780.0;
        const p0 =
          comp.initialStates["PC"] ?? (typeof comp.parameters["PC"] === "number" ? comp.parameters["PC"] : 7.0e6);

        const pcVar = getOrAddVar(`${compId}_Pc`, Variability.Continuous, p0);
        stateVarIndices.push(pcVar);

        const mdotOx = getOrAddVar(`${compId}_IN_OX`);
        const mdotFuel = getOrAddVar(`${compId}_IN_FUEL`);
        const mdotGas = getOrAddVar(`${compId}_OUT_GAS`);

        // mdot_gas = Pc * At / cstar
        const atOverCstar = at / cstar;
        const rhsMdotGas = builder.addBinaryExpr(
          BinOp.Mul,
          builder.addName(pcVar),
          builder.addRealLiteral(atOverCstar),
        );
        builder.addEquation(EqKind.Simple, builder.addName(mdotGas), rhsMdotGas);
        equationCount++;

        // der(Pc) = (gamma * R * Tc / Vc) * (mdot_ox + mdot_fuel - mdot_gas)
        const timeConstant = (1.2 * 360.0 * 3000.0) / Math.max(1e-5, vc);
        const mdotIn = builder.addBinaryExpr(BinOp.Add, builder.addName(mdotOx), builder.addName(mdotFuel));
        const deltaMdot = builder.addBinaryExpr(BinOp.Sub, mdotIn, builder.addName(mdotGas));
        const derPc = builder.addDer(pcVar);
        const rhsDerPc = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(timeConstant), deltaMdot);
        builder.addEquation(EqKind.Simple, derPc, rhsDerPc);
        equationCount++;
        break;
      }

      case "SHAFT": {
        // Rotating Shaft Dynamics: J * der(omega) = Tau_turb - Tau_pump
        const inertia = typeof comp.parameters["INERTIA"] === "number" ? comp.parameters["INERTIA"] : 0.08;
        const rpm0 =
          comp.initialStates["SPEED_RPM"] ??
          (typeof comp.parameters["SPEED_RPM"] === "number" ? comp.parameters["SPEED_RPM"] : 30000.0);
        const omega0 = (rpm0 * 2.0 * Math.PI) / 60.0;

        const omegaVar = getOrAddVar(`${compId}_omega`, Variability.Continuous, omega0);
        stateVarIndices.push(omegaVar);

        const tauTurb = getOrAddVar(`${compId}_TORQUE_TURB`);
        const tauPump = getOrAddVar(`${compId}_TORQUE_PUMP`);
        const netTorque = builder.addBinaryExpr(BinOp.Sub, builder.addName(tauTurb), builder.addName(tauPump));

        // der(omega) = netTorque / inertia
        const derOmega = builder.addDer(omegaVar);
        const rhsDerOmega = builder.addBinaryExpr(BinOp.Div, netTorque, builder.addRealLiteral(inertia));
        builder.addEquation(EqKind.Simple, derOmega, rhsDerOmega);
        equationCount++;

        // Also define SPEED_RPM = omega * 60 / (2*PI)
        const rpmVar = getOrAddVar(`${compId}_SPEED_RPM`);
        const radToRpm = 60.0 / (2.0 * Math.PI);
        const rhsRpm = builder.addBinaryExpr(BinOp.Mul, builder.addName(omegaVar), builder.addRealLiteral(radToRpm));
        builder.addEquation(EqKind.Simple, builder.addName(rpmVar), rhsRpm);
        equationCount++;
        break;
      }

      case "PUMP": {
        // Centrifugal/Axial Pump: Head and Power
        // P_out - P_in = DeltaP = rho * g * H
        // Power = mdot * DeltaP / (rho * eta)
        const prise = typeof comp.parameters["DELTA_P"] === "number" ? comp.parameters["DELTA_P"] : 10.0e6;
        const eta = typeof comp.parameters["ETA"] === "number" ? comp.parameters["ETA"] : 0.75;
        const rho = typeof comp.parameters["RHO"] === "number" ? comp.parameters["RHO"] : 1140.0;

        const inP = getOrAddVar(`${compId}_IN_P`);
        const outP = getOrAddVar(`${compId}_OUT_P`);
        const mdot = getOrAddVar(`${compId}_MDOT`);
        const power = getOrAddVar(`${compId}_POWER`);

        // OUT_P = IN_P + DELTA_P
        const rhsOutP = builder.addBinaryExpr(BinOp.Add, builder.addName(inP), builder.addRealLiteral(prise));
        builder.addEquation(EqKind.Simple, builder.addName(outP), rhsOutP);
        equationCount++;

        // POWER = MDOT * DELTA_P / (rho * eta)
        const coeff = prise / Math.max(1e-5, rho * eta);
        const rhsPower = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(coeff), builder.addName(mdot));
        builder.addEquation(EqKind.Simple, builder.addName(power), rhsPower);
        equationCount++;
        break;
      }

      case "TURBINE": {
        // Gas Turbine: Power = MDOT * Cp * Tin * eta * (1 - (Pout/Pin)^((gamma-1)/gamma))
        const cp = typeof comp.parameters["CP"] === "number" ? comp.parameters["CP"] : 2200.0;
        const tin = typeof comp.parameters["T_IN"] === "number" ? comp.parameters["T_IN"] : 950.0;
        const eta = typeof comp.parameters["ETA"] === "number" ? comp.parameters["ETA"] : 0.72;
        const pr = typeof comp.parameters["PR"] === "number" ? comp.parameters["PR"] : 1.6;

        const inP = getOrAddVar(`${compId}_IN_P`);
        const outP = getOrAddVar(`${compId}_OUT_P`);
        const mdot = getOrAddVar(`${compId}_MDOT`);
        const power = getOrAddVar(`${compId}_POWER`);

        // OUT_P = IN_P / PR
        const rhsOutP = builder.addBinaryExpr(BinOp.Div, builder.addName(inP), builder.addRealLiteral(pr));
        builder.addEquation(EqKind.Simple, builder.addName(outP), rhsOutP);
        equationCount++;

        // Specific enthalpy drop dh = cp * tin * eta * (1 - (1/pr)^0.285)
        const tempDropFrac = 1.0 - Math.pow(1.0 / pr, 0.285);
        const dh = cp * tin * eta * tempDropFrac;
        const rhsPower = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(dh), builder.addName(mdot));
        builder.addEquation(EqKind.Simple, builder.addName(power), rhsPower);
        equationCount++;
        break;
      }

      case "VALVE":
      case "ORIFICE": {
        // Flow Control Valve: mdot = Cv * position * sqrt(rho * (Pin - Pout))
        const cv = typeof comp.parameters["CV"] === "number" ? comp.parameters["CV"] : 0.002;
        const pos = typeof comp.parameters["POSITION"] === "number" ? comp.parameters["POSITION"] : 1.0;
        const effectiveCv = cv * pos;

        const inP = getOrAddVar(`${compId}_IN_P`);
        const outP = getOrAddVar(`${compId}_OUT_P`);
        const mdot = getOrAddVar(`${compId}_MDOT`);

        // Linearized DP relationship for solver robust convergence:
        // P_in - P_out = (mdot / effectiveCv)^2
        // Or OUT_P = IN_P - R * MDOT
        const rVal = 1.0 / Math.max(1e-9, effectiveCv * 100.0);
        const lossTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(rVal), builder.addName(mdot));
        const rhsOutP = builder.addBinaryExpr(BinOp.Sub, builder.addName(inP), lossTerm);
        builder.addEquation(EqKind.Simple, builder.addName(outP), rhsOutP);
        equationCount++;
        break;
      }

      case "COOLING_JACKET": {
        // Regenerative Cooling Jacket: M_wall * C_wall * der(Tw) = Q_gas - Q_cool
        const tw0 =
          comp.initialStates["T_WALL"] ??
          (typeof comp.parameters["T_WALL"] === "number" ? comp.parameters["T_WALL"] : 600.0);
        const twVar = getOrAddVar(`${compId}_Tw`, Variability.Continuous, tw0);
        stateVarIndices.push(twVar);

        const qGas = getOrAddVar(`${compId}_Q_GAS`);
        const qCool = getOrAddVar(`${compId}_Q_COOL`);
        const netQ = builder.addBinaryExpr(BinOp.Sub, builder.addName(qGas), builder.addName(qCool));

        // der(Tw) = (Q_gas - Q_cool) / (M_wall * C_wall)
        const heatCap = 50.0 * 500.0; // 25,000 J/K
        const derTw = builder.addDer(twVar);
        const rhsDerTw = builder.addBinaryExpr(BinOp.Div, netQ, builder.addRealLiteral(heatCap));
        builder.addEquation(EqKind.Simple, derTw, rhsDerTw);
        equationCount++;
        break;
      }

      default: {
        // User custom module with Fortran code if present
        if (comp.userCode) {
          const res = lowerRocetsRoutineToDae(builder, comp.userCode, compId);
          stateVarIndices.push(...res.stateVarIndices);
          equationCount += res.equationCount;
        } else if (comp.ports["IN"] && comp.ports["OUT"]) {
          const inVar = getOrAddVar(`${compId}_IN`);
          const outVar = getOrAddVar(`${compId}_OUT`);
          builder.addEquation(EqKind.Simple, builder.addName(outVar), builder.addName(inVar));
          equationCount++;
        }
        break;
      }
    }
  }

  // 2. Lower Connections (to.port = from.port)
  for (const conn of model.connections) {
    const fromVarName = `${conn.fromComponent}_${conn.fromPort}`;
    const toVarName = `${conn.toComponent}_${conn.toPort}`;

    const fromVarIdx = getOrAddVar(fromVarName);
    const toVarIdx = getOrAddVar(toVarName);

    const lhs = builder.addName(toVarIdx);
    const rhs = builder.addName(fromVarIdx);
    builder.addEquation(EqKind.Simple, lhs, rhs);
    equationCount++;
  }

  return {
    stateVarIndices,
    equationCount,
    variableMap,
  };
}
