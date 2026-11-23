// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Direct Linear-Memory DAE Arena Lowering.
 *
 * Lowers an MCNP transport deck into ModelScript's zero-GC `DAEBuilder`:
 *   1. 6-group delayed neutron precursor point-kinetics ODEs (`reactor_power`, `reactivity`, `C_1..C_6`)
 *   2. Cell-level 1-group neutron flux balance equations (`phi_cell_<id>`) using homogenized
 *      macroscopic cross-sections (`Sigma_a`, `nu*Sigma_f`) and external source / leakage terms.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { computeExactCellVolume } from "../cad/csg-geometry.js";
import { ensureBuiltInMcnpLibraryRegistered } from "../catalog/library-package-adapter.js";
import { computeMaterialCrossSections } from "../solver/monte-carlo.js";
import type { McnpDeck } from "../types.js";

export interface McnpDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  /** Prompt neutron generation time Lambda (seconds, default 1e-5 for fast / 5e-5 thermal). */
  promptGenerationTime?: number | undefined;
  /** Initial reactivity rho (default 0.0). */
  initialReactivity?: number | undefined;
}

/** Standard U-235 6-group delayed neutron precursor parameters (Keepin 1965). */
const U235_DELAYED_GROUPS = [
  { group: 1, beta: 0.000215, lambda: 0.0124 },
  { group: 2, beta: 0.001424, lambda: 0.0305 },
  { group: 3, beta: 0.001274, lambda: 0.111 },
  { group: 4, beta: 0.002568, lambda: 0.301 },
  { group: 5, beta: 0.000748, lambda: 1.14 },
  { group: 6, beta: 0.000273, lambda: 3.01 },
] as const;

/**
 * Lowers an `McnpDeck` into a linear-memory `DAEBuilder` containing point-kinetics ODEs
 * and cell-level neutron flux-balance equations.
 */
export function lowerMcnpToDae(deck: McnpDeck, options?: McnpDaeOptions): DAEBuilder {
  ensureBuiltInMcnpLibraryRegistered();
  const modelName = (options?.modelName ?? (deck.title || "McnpTransportModel")).replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const lambdaGen = options?.promptGenerationTime ?? 1e-5;
  const rho0 = options?.initialReactivity ?? 0.0;
  const betaTotal = U235_DELAYED_GROUPS.reduce((acc, g) => acc + g.beta, 0);

  // 1. Point-Kinetics ODEs (reactor_power, reactivity, and 6 delayed precursor concentrations C_1..C_6)
  const nVar = dae.addVariable("reactor_power", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  const rhoVar = dae.addVariable("reactivity", VarType.Real, Variability.Continuous, Causality.Local, rho0);

  // reactivity = rho0 (algebraic control input)
  dae.addEquation(EqKind.Simple, dae.addName(rhoVar), dae.addRealLiteral(rho0));

  let precursorSourceSum: number | null = null;
  for (const g of U235_DELAYED_GROUPS) {
    const c0 = g.beta / (lambdaGen * g.lambda);
    const cVar = dae.addVariable(`C_${g.group}`, VarType.Real, Variability.Continuous, Causality.Local, c0);

    // der(C_i) = (beta_i / Lambda) * n - lambda_i * C_i
    const prodTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(g.beta / lambdaGen), dae.addName(nVar));
    const decayTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(g.lambda), dae.addName(cVar));
    const rhsC = dae.addBinaryExpr(BinOp.Sub, prodTerm, decayTerm);
    dae.addEquation(EqKind.Simple, dae.addDer(cVar), rhsC);

    precursorSourceSum =
      precursorSourceSum === null ? decayTerm : dae.addBinaryExpr(BinOp.Add, precursorSourceSum, decayTerm);
  }

  // der(reactor_power) = ((reactivity - betaTotal) / Lambda) * reactor_power + sum(lambda_i * C_i)
  const rhoMinusBeta = dae.addBinaryExpr(BinOp.Sub, dae.addName(rhoVar), dae.addRealLiteral(betaTotal));
  const promptRate = dae.addBinaryExpr(BinOp.Div, rhoMinusBeta, dae.addRealLiteral(lambdaGen));
  const promptTerm = dae.addBinaryExpr(BinOp.Mul, promptRate, dae.addName(nVar));
  const rhsN = precursorSourceSum !== null ? dae.addBinaryExpr(BinOp.Add, promptTerm, precursorSourceSum) : promptTerm;
  dae.addEquation(EqKind.Simple, dae.addDer(nVar), rhsN);

  // 2. Cell-level 1-group neutron flux balance equations for all non-graveyard cells
  const vNeutron = 1.4e9; // Fast neutron speed (cm/s)
  for (const cell of deck.cells.values()) {
    const isGraveyard = Object.values(cell.imp).some((v) => v === 0);
    if (isGraveyard) continue;

    const mat = cell.materialId > 0 ? deck.materials.get(cell.materialId) : undefined;
    const xs =
      mat && cell.density
        ? computeMaterialCrossSections(mat, cell.density, "fast")
        : { sigmaS: 0, sigmaC: 0, sigmaF: 0, sigmaA: 0, sigmaT: 0, nuSigmaF: 0, sigma12: 0 };

    const vol = computeExactCellVolume(deck, cell.id) ?? 1000.0;
    const rEff = Math.cbrt((3 * vol) / (4 * Math.PI));
    const dCoeff = xs.sigmaT > 0 ? 1.0 / (3.0 * xs.sigmaT) : 1.0;
    const bucklingSq = (Math.PI / Math.max(1.0, rEff)) ** 2;
    const removalRate = xs.sigmaA + dCoeff * bucklingSq;
    const sourceRate = deck.source.sdef ? 1.0 / vol : 0.0;

    const phiVar = dae.addVariable(`phi_cell_${cell.id}`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);

    // (1/v) * der(phi) = (nuSigmaF - removalRate) * phi + sourceRate
    // => der(phi) = v * (nuSigmaF - removalRate) * phi + v * sourceRate
    const netCoeff = vNeutron * (xs.nuSigmaF - removalRate);
    const fluxTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(netCoeff), dae.addName(phiVar));
    const rhsPhi =
      sourceRate > 0 ? dae.addBinaryExpr(BinOp.Add, fluxTerm, dae.addRealLiteral(vNeutron * sourceRate)) : fluxTerm;
    dae.addEquation(EqKind.Simple, dae.addDer(phiVar), rhsPhi);
  }

  return dae;
}
