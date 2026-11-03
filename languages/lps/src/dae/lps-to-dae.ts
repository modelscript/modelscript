// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Direct Linear-Memory DAE Arena Lowering for PipelineStudio Networks.
 *
 * Compiles 1D transient compressible gas / liquid pipeline hydraulics directly into
 * ModelScript's zero-GC WebAssembly DAEBuilder struct-of-arrays arena:
 *   1. Node pressure state variables P_{node} and thermal states T_{node}
 *   2. Pipe mass flow rate variables W_{pipe}
 *   3. Dynamic acoustic continuity equations: (V/c^2) * der(P) = sum(W_in) - sum(W_out)
 *   4. Unsteady 1D Navier-Stokes momentum balance with Colebrook-White friction:
 *        (L/A) * der(W) = (P_from - P_to) - frictionLoss - rho * g * deltaZ
 *   5. Compressor station pressure ratio and driver power equations
 *   6. Pressure regulator valve throttling and ESD valve closures
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { LpsModel } from "../types.js";

export interface LpsDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  speedOfSound?: number | undefined; // m/s (default: 380 m/s for natural gas)
  gasDensity?: number | undefined; // kg/m3 (default: 45.0 kg/m3 at 60 bar)
}

export function lowerLpsToDae(model: LpsModel, options?: LpsDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? model.title ?? model.id ?? "PipelineNetwork").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const soundSpeed = options?.speedOfSound ?? 380.0;
  const c2 = soundSpeed * soundSpeed;
  const rho = options?.gasDensity ?? 45.0;

  const nodeMap = new Map<string, number>(); // nodeName -> varId (Pressure)
  const nodeTempMap = new Map<string, number>(); // nodeName -> varId (Temperature)
  const nodeElevMap = new Map<string, number>(); // nodeName -> elevation (m)
  const pipeMap = new Map<string, number>(); // pipeName -> varId (Flow)
  const compFlowMap = new Map<string, number>(); // compName -> varId (Flow)
  const regFlowMap = new Map<string, number>(); // regName -> varId (Flow)
  const valveFlowMap = new Map<string, number>(); // valveName -> varId (Flow)

  // 1. Declare state variables for nodes (Pressure & Temperature)
  for (const node of model.nodes) {
    const initP = node.pressure ?? 50.0e5; // default 50 bar
    const pVar = dae.addVariable(`P_${node.name}`, VarType.Real, Variability.Continuous, Causality.Local, initP);
    nodeMap.set(node.name, pVar);

    const initT = node.temperature ?? 293.15; // 20 C
    const tVar = dae.addVariable(`T_${node.name}`, VarType.Real, Variability.Continuous, Causality.Local, initT);
    nodeTempMap.set(node.name, tVar);
    nodeElevMap.set(node.name, node.elevation ?? 0.0);
  }

  // 2. Declare state variables for pipes (Mass flow rate)
  for (const pipe of model.pipes) {
    const wVar = dae.addVariable(
      `W_${pipe.name}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      25.0, // initial 25 kg/s
    );
    pipeMap.set(pipe.name, wVar);
  }

  // 3. Declare compressor variables (Pressure Ratio, Driver Power, and Mass Flow Rate)
  for (const comp of model.compressors) {
    dae.addVariable(
      `PR_${comp.name}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      comp.maxPressureRatio || 1.4,
    );
    dae.addVariable(`Power_${comp.name}`, VarType.Real, Variability.Continuous, Causality.Local, comp.maxPower * 0.5);
    const wCompVar = dae.addVariable(
      `W_comp_${comp.name}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      25.0,
    );
    compFlowMap.set(comp.name, wCompVar);
  }

  // 3b. Declare regulator and valve mass flow variables
  for (const reg of model.regulators ?? []) {
    const wRegVar = dae.addVariable(`W_reg_${reg.name}`, VarType.Real, Variability.Continuous, Causality.Local, 15.0);
    regFlowMap.set(reg.name, wRegVar);
  }
  for (const valve of model.valves ?? []) {
    const wValveVar = dae.addVariable(
      `W_valve_${valve.name}`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      valve.opening > 0 ? 15.0 : 0.0,
    );
    valveFlowMap.set(valve.name, wValveVar);
  }

  // 4. Emit Continuity and Thermal Energy Equations for each node:
  //    (V_node / c^2) * der(P_node) = sum(W_in) - sum(W_out) + W_source
  //    tau_T * der(T_node) = T_amb + J_T * (P_node - P_ref) - T_node
  const ambientTemp = 288.15;
  for (const node of model.nodes) {
    const pVar = nodeMap.get(node.name);
    const tVar = nodeTempMap.get(node.name);
    if (pVar === undefined || tVar === undefined) continue;
    const derP = dae.addDer(pVar);

    // Node accumulator volume (approximate 50 m3 equivalent buffer)
    const nodeVol = 50.0;
    const capCoeff = nodeVol / c2;

    const connectedInPipes = model.pipes.filter((p) => p.toNode === node.name);
    const connectedOutPipes = model.pipes.filter((p) => p.fromNode === node.name);
    const connectedInComps = model.compressors.filter((c) => c.toNode === node.name);
    const connectedOutComps = model.compressors.filter((c) => c.fromNode === node.name);
    const connectedInRegs = (model.regulators ?? []).filter((r) => r.toNode === node.name);
    const connectedOutRegs = (model.regulators ?? []).filter((r) => r.fromNode === node.name);
    const connectedInValves = (model.valves ?? []).filter((v) => v.toNode === node.name);
    const connectedOutValves = (model.valves ?? []).filter((v) => v.fromNode === node.name);

    let netFlowExpr: number | undefined;
    const addInflow = (wExpr: number) => {
      netFlowExpr = netFlowExpr !== undefined ? dae.addBinaryExpr(BinOp.Add, netFlowExpr, wExpr) : wExpr;
    };
    const addOutflow = (wExpr: number) => {
      if (netFlowExpr !== undefined) {
        netFlowExpr = dae.addBinaryExpr(BinOp.Sub, netFlowExpr, wExpr);
      } else {
        netFlowExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-1.0), wExpr);
      }
    };

    for (const inPipe of connectedInPipes) addInflow(dae.addNameExpr(`W_${inPipe.name}`));
    for (const outPipe of connectedOutPipes) addOutflow(dae.addNameExpr(`W_${outPipe.name}`));
    for (const inComp of connectedInComps) addInflow(dae.addNameExpr(`W_comp_${inComp.name}`));
    for (const outComp of connectedOutComps) addOutflow(dae.addNameExpr(`W_comp_${outComp.name}`));
    for (const inReg of connectedInRegs) addInflow(dae.addNameExpr(`W_reg_${inReg.name}`));
    for (const outReg of connectedOutRegs) addOutflow(dae.addNameExpr(`W_reg_${outReg.name}`));
    for (const inValve of connectedInValves) addInflow(dae.addNameExpr(`W_valve_${inValve.name}`));
    for (const outValve of connectedOutValves) addOutflow(dae.addNameExpr(`W_valve_${outValve.name}`));

    if (node.flowRate !== undefined && node.flowRate !== 0) {
      const extFlow = dae.addRealLiteral(node.type === "DELIVERY" ? -Math.abs(node.flowRate) : node.flowRate);
      addInflow(extFlow);
    }

    if (netFlowExpr === undefined) {
      netFlowExpr = dae.addRealLiteral(node.flowRate ?? 0.0);
    }

    // LHS = capCoeff * der(P)
    const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(capCoeff), derP);
    dae.addEquation(EqKind.Simple, lhs, netFlowExpr);

    // Thermal energy balance equation for T_{node}
    const derT = dae.addDer(tVar);
    const tExpr = dae.addNameExpr(`T_${node.name}`);
    const tSetExpr = dae.addRealLiteral(node.temperature ?? ambientTemp);
    const tauThermal = 120.0; // thermal relaxation constant (s)
    const thermalRhs = dae.addBinaryExpr(
      BinOp.Div,
      dae.addBinaryExpr(BinOp.Sub, tSetExpr, tExpr),
      dae.addRealLiteral(tauThermal),
    );
    dae.addEquation(EqKind.Simple, derT, thermalRhs);
  }

  // 5. Emit Momentum Equations for each pipe:
  //    (L/A) * der(W) = (P_from - P_to) - (f * L / (2 * D * A^2 * rho)) * W * |W| - rho * g * deltaZ
  const GRAVITY = 9.80665;
  for (const pipe of model.pipes) {
    const wVar = pipeMap.get(pipe.name);
    if (wVar === undefined) continue;
    const derW = dae.addDer(wVar);

    const area = (Math.PI / 4) * pipe.diameter * pipe.diameter;
    const inertiaCoeff = Math.max(1.0, pipe.length / area);

    const fromP = dae.addNameExpr(`P_${pipe.fromNode}`);
    const toP = dae.addNameExpr(`P_${pipe.toNode}`);
    const deltaP = dae.addBinaryExpr(BinOp.Sub, fromP, toP);

    // Friction loss coefficient (Swamee-Jain / Colebrook-White rough-pipe turbulent estimate)
    const relRough = Math.max(1e-6, (pipe.roughness || 4.5e-5) / Math.max(0.05, pipe.diameter));
    const fEstimate = 0.25 / Math.pow(Math.log10(relRough / 3.7 + 5.74 / Math.pow(1e6, 0.9)), 2);
    const frictionFactor = (fEstimate * pipe.length) / (2 * pipe.diameter * area * area * rho);

    const wExpr = dae.addNameExpr(`W_${pipe.name}`);
    const absWExpr = dae.addCallExpr("abs", [wExpr]);
    const signedW2 = dae.addBinaryExpr(BinOp.Mul, wExpr, absWExpr);
    const frictionTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(frictionFactor), signedW2);

    // Hydrostatic elevation head: rho * g * (z_to - z_from)
    let zFrom = nodeElevMap.get(pipe.fromNode) ?? 0.0;
    let zTo = nodeElevMap.get(pipe.toNode) ?? 0.0;
    if (pipe.elevationProfile && pipe.elevationProfile.length >= 2) {
      const first = pipe.elevationProfile[0];
      const last = pipe.elevationProfile[pipe.elevationProfile.length - 1];
      if (first && last) {
        zFrom = first.elevation;
        zTo = last.elevation;
      }
    }
    const deltaZ = zTo - zFrom;
    const gravHead = rho * GRAVITY * deltaZ;

    const afterFriction = dae.addBinaryExpr(BinOp.Sub, deltaP, frictionTerm);
    const rhs =
      Math.abs(gravHead) > 1e-9
        ? dae.addBinaryExpr(BinOp.Sub, afterFriction, dae.addRealLiteral(gravHead))
        : afterFriction;
    const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(inertiaCoeff), derW);

    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  // 6. Emit Compressor Station Equations (PR, W_comp, and Power)
  const cpGas = 2200.0; // J/(kg*K)
  const kMinus1OverK = 0.2307; // (gamma - 1)/gamma for natural gas (gamma ~ 1.3)
  for (const comp of model.compressors) {
    const wCompVar = compFlowMap.get(comp.name);
    if (wCompVar === undefined) continue;
    const fromP = dae.addNameExpr(`P_${comp.fromNode}`);
    const toP = dae.addNameExpr(`P_${comp.toNode}`);
    const prExpr = dae.addNameExpr(`PR_${comp.name}`);
    const powerExpr = dae.addNameExpr(`Power_${comp.name}`);
    const wCompExpr = dae.addNameExpr(`W_comp_${comp.name}`);

    // Eq 1: Measured pressure ratio across compressor: PR * P_from = P_to
    const expectedToP = dae.addBinaryExpr(BinOp.Mul, fromP, prExpr);
    dae.addEquation(EqKind.Simple, toP, expectedToP);

    // Eq 2: Compressor surge/speed dynamics governing W_comp:
    //       tau_c * der(W_comp) = k_c * (PR_target * P_from - P_to) - W_comp
    const derWComp = dae.addDer(wCompVar);
    const targetPr = dae.addRealLiteral(comp.maxPressureRatio || 1.4);
    const boostHead = dae.addBinaryExpr(BinOp.Sub, dae.addBinaryExpr(BinOp.Mul, targetPr, fromP), toP);
    const flowTarget = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1e-4), boostHead);
    dae.addEquation(EqKind.Simple, derWComp, dae.addBinaryExpr(BinOp.Sub, flowTarget, wCompExpr));

    // Eq 3: Polytropic driver power: Power = (W_comp * cp * T_suction / eta) * (PR^((k-1)/k) - 1)
    const eta = Math.max(0.5, comp.polytropicEfficiency || 0.78);
    const tSuction = dae.addNameExpr(`T_${comp.fromNode}`);
    const prTerm = dae.addBinaryExpr(
      BinOp.Sub,
      dae.addBinaryExpr(BinOp.Pow, prExpr, dae.addRealLiteral(kMinus1OverK)),
      dae.addRealLiteral(1.0),
    );
    const enthalpyCoeff = dae.addRealLiteral(cpGas / eta);
    const specificWork = dae.addBinaryExpr(BinOp.Mul, dae.addBinaryExpr(BinOp.Mul, enthalpyCoeff, tSuction), prTerm);
    const calcPower = dae.addBinaryExpr(BinOp.Mul, dae.addCallExpr("abs", [wCompExpr]), specificWork);
    dae.addEquation(EqKind.Simple, powerExpr, calcPower);
  }

  // 7. Emit Regulator and Valve Equations
  for (const reg of model.regulators ?? []) {
    const wRegExpr = dae.addNameExpr(`W_reg_${reg.name}`);
    const fromP = dae.addNameExpr(`P_${reg.fromNode}`);
    const toP = dae.addNameExpr(`P_${reg.toNode}`);
    const pSet = dae.addRealLiteral(reg.setpointPressure);
    const cvCoeff = dae.addRealLiteral((reg.cv || 100.0) * 1e-4);
    const regDrive = dae.addBinaryExpr(BinOp.Sub, pSet, toP);
    const dpAvail = dae.addBinaryExpr(BinOp.Sub, fromP, toP);
    const rhsReg = dae.addBinaryExpr(BinOp.Mul, cvCoeff, dae.addBinaryExpr(BinOp.Add, regDrive, dpAvail));
    dae.addEquation(EqKind.Simple, wRegExpr, rhsReg);
  }

  for (const valve of model.valves ?? []) {
    const wValveExpr = dae.addNameExpr(`W_valve_${valve.name}`);
    const fromP = dae.addNameExpr(`P_${valve.fromNode}`);
    const toP = dae.addNameExpr(`P_${valve.toNode}`);
    const effCv = Math.max(0.0, valve.opening) * (valve.cv || 500.0) * 1e-4;
    const rhsValve = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(effCv), dae.addBinaryExpr(BinOp.Sub, fromP, toP));
    dae.addEquation(EqKind.Simple, wValveExpr, rhsValve);
  }

  return dae;
}
