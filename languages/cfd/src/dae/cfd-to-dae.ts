// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { CfdModelData } from "../types.js";

export interface CfdDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  numCells?: number | undefined; // Streamtube spatial discretization cells (default: 5)
  streamLength?: number | undefined; // Domain stream length in meters (default: 10.0)
  referenceArea?: number | undefined; // Reference aerodynamic surface area in m^2 (default: 1.0)
}

/**
 * Lowers a CFD aerodynamic / fluid domain model directly into ModelScript's
 * zero-GC WebAssembly DAEBuilder struct-of-arrays arena.
 */
export function cfdToDae(model: CfdModelData, options?: CfdDaeOptions): DAEBuilder {
  const modelName = (options?.modelName ?? model.mathProblem ?? "CfdAerodynamics").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const numCells = options?.numCells ?? 5;
  const streamLength = options?.streamLength ?? 10.0;
  const dx = streamLength / numCells;

  const mach = model.machNumber ?? 0.8;
  const rhoInf = model.density ?? 1.225; // kg/m^3 (sea level air)
  const soundSpeed = 340.29; // m/s
  const uInf = model.freestreamVelocity ?? mach * soundSpeed;
  const pInf = rhoInf * 287.05 * 288.15; // ~101325 Pa
  const refArea = options?.referenceArea ?? (parseFloat(model.directives.get("REF_AREA") ?? "1.0") || 1.0);
  const aoaDeg = model.aoa ?? (parseFloat(model.directives.get("AOA") ?? "0.0") || 0.0);
  const aoaRad = (aoaDeg * Math.PI) / 180.0;

  // 1. Declare global aerodynamic force & coefficient variables
  const cd0 = 0.02;
  const kInduced = 0.05;
  const clAlpha = 2 * Math.PI; // thin airfoil theoretical lift slope
  const clNominal = clAlpha * aoaRad;
  const cdNominal = cd0 + kInduced * clNominal * clNominal;
  const qInf = 0.5 * rhoInf * uInf * uInf; // dynamic pressure
  const liftNominal = qInf * refArea * clNominal;
  const dragNominal = qInf * refArea * cdNominal;

  const clVar = dae.addVariable("C_L", VarType.Real, Variability.Continuous, Causality.Output, clNominal);
  const cdVar = dae.addVariable("C_D", VarType.Real, Variability.Continuous, Causality.Output, cdNominal);
  const liftVar = dae.addVariable("Lift", VarType.Real, Variability.Continuous, Causality.Output, liftNominal);
  const dragVar = dae.addVariable("Drag", VarType.Real, Variability.Continuous, Causality.Output, dragNominal);

  // Algebraic definitions for C_L and C_D: C_L = clNominal, C_D = cd0 + kInduced * C_L^2
  dae.addEquation(EqKind.Simple, clVar, dae.addRealLiteral(clNominal));
  const clSq = dae.addBinaryExpr(BinOp.Mul, clVar, clVar);
  const cdiExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(kInduced), clSq);
  const cdExpr = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(cd0), cdiExpr);
  dae.addEquation(EqKind.Simple, cdVar, cdExpr);

  // Lift and Drag definitions: Lift = qInf * refArea * C_L
  const liftCoeffProd = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(qInf * refArea), clVar);
  dae.addEquation(EqKind.Simple, liftVar, liftCoeffProd);

  const dragCoeffProd = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(qInf * refArea), cdVar);
  dae.addEquation(EqKind.Simple, dragVar, dragCoeffProd);

  // 2. Register boundary markers first so they can couple into cell 1 and cell N
  let firstInletVar: number | null = null;
  let firstOutletVar: number | null = null;

  for (const [name, marker] of model.markers.entries()) {
    const markerKind = marker.type.toUpperCase();
    if (markerKind === "INLET" || markerKind === "MARKER_INLET") {
      const p0Opt = typeof marker.options[0] === "number" && marker.options[0] > 1000 ? marker.options[0] : pInf * 1.05;
      const inletVar = dae.addVariable(
        `Inlet_${name}_TotalP`,
        VarType.Real,
        Variability.Parameter,
        Causality.Input,
        p0Opt,
      );
      dae.addEquation(EqKind.Simple, inletVar, dae.addRealLiteral(p0Opt));
      if (firstInletVar === null) firstInletVar = inletVar;
    } else if (markerKind === "OUTLET" || markerKind === "MARKER_OUTLET") {
      const pBackOpt = typeof marker.options[0] === "number" && marker.options[0] > 1000 ? marker.options[0] : pInf;
      const outletVar = dae.addVariable(
        `Outlet_${name}_BackP`,
        VarType.Real,
        Variability.Parameter,
        Causality.Input,
        pBackOpt,
      );
      dae.addEquation(EqKind.Simple, outletVar, dae.addRealLiteral(pBackOpt));
      if (firstOutletVar === null) firstOutletVar = outletVar;
    }
  }

  // 3. Discretize 1D Streamtube FVM Fluid Cells
  const rhoVars: number[] = [];
  const uVars: number[] = [];
  const pVars: number[] = [];

  for (let i = 0; i < numCells; i++) {
    const rhoCell = dae.addVariable(`rho_${i + 1}`, VarType.Real, Variability.Continuous, Causality.Local, rhoInf);
    const uCell = dae.addVariable(`u_${i + 1}`, VarType.Real, Variability.Continuous, Causality.Local, uInf);
    const pCell = dae.addVariable(`p_${i + 1}`, VarType.Real, Variability.Continuous, Causality.Local, pInf);

    rhoVars.push(rhoCell);
    uVars.push(uCell);
    pVars.push(pCell);

    // Conservation of Mass: der(rho_i) = -(rho_i * u_i - rho_{i-1} * u_{i-1}) / dx
    const derRho = dae.addDer(rhoCell);
    const prevU = i === 0 ? dae.addRealLiteral(uInf) : uVars[i - 1]!;
    const prevRho = i === 0 ? dae.addRealLiteral(rhoInf) : rhoVars[i - 1]!;

    const fluxIn = dae.addBinaryExpr(BinOp.Mul, prevRho, prevU);
    const fluxOut = dae.addBinaryExpr(BinOp.Mul, rhoCell, uCell);
    const massFluxDiff = dae.addBinaryExpr(BinOp.Sub, fluxIn, fluxOut);
    const dRhoDt = dae.addBinaryExpr(BinOp.Div, massFluxDiff, dae.addRealLiteral(dx));
    dae.addEquation(EqKind.Simple, derRho, dRhoDt);

    // Conservation of Momentum: der(u_i) = -(p_downstream - p_upstream) / (rho_i * dx)
    const derU = dae.addDer(uCell);
    const prevP = i === 0 ? (firstInletVar ?? dae.addRealLiteral(pInf)) : pVars[i - 1]!;
    const downP = i === numCells - 1 && firstOutletVar !== null ? firstOutletVar : pCell;
    const dp = dae.addBinaryExpr(BinOp.Sub, downP, prevP);
    const rhoDx = dae.addBinaryExpr(BinOp.Mul, rhoCell, dae.addRealLiteral(dx));
    const dpDx = dae.addBinaryExpr(BinOp.Div, dp, rhoDx);
    const negDpDx = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), dpDx);
    dae.addEquation(EqKind.Simple, derU, negDpDx);

    // State Equation: p_i = rho_i * R * T (approx speed of sound c^2 * (rho_i - rhoInf) + pInf)
    const c2 = soundSpeed * soundSpeed;
    const deltaRho = dae.addBinaryExpr(BinOp.Sub, rhoCell, dae.addRealLiteral(rhoInf));
    const deltaP = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(c2), deltaRho);
    const pState = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(pInf), deltaP);
    dae.addEquation(EqKind.Simple, pCell, pState);
  }

  return dae;
}
