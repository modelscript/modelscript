// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Direct Linear-Memory DAEBuilder Lowering for ORIGEN Bateman Depletion ODEs.
 *
 * Compiles the Bateman nuclide transmutation & decay ODE system directly into `@modelscript/runtime`'s
 * zero-GC `DAEBuilder`:
 *
 *   der(N_i) = sum_{j != i} (lambda_{j->i} + sigma_{j->i} * phi) * N_j - (lambda_i + sigma_i * phi) * N_i
 *   P_decay  = sum_i lambda_i * N_i * E_i * 1.602176634e-13
 *   A_total  = sum_i lambda_i * N_i
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { ensureBuiltInScaleLibraryRegistered } from "../catalog/library-package-adapter.js";
import { BARN_TO_CM2, normalizeNuclideId, SCALE_NUCLIDE_DATA } from "../catalog/scale-std-schemas.js";
import { expandNuclideNetwork } from "../solver/bateman-solver.js";
import type { ScaleDeck } from "../types.js";

const MEV_TO_JOULES = 1.602176634e-13;
const AVOGADRO = 6.02214076e23;

export interface ScaleDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  /** Override neutron flux in n/(cm^2*s) */
  flux?: number | undefined;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Lowers a parsed SCALE / ORIGEN deck's Bateman depletion ODEs directly into `DAEBuilder`.
 */
export function lowerScaleToDae(deck: ScaleDeck, options?: ScaleDaeOptions): DAEBuilder {
  ensureBuiltInScaleLibraryRegistered();
  const modelName = sanitizeId(options?.modelName ?? (deck.title || "ScaleBatemanDepletion"));
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // Extract initial nuclide inventories and nominal flux
  const initialAtoms: Record<string, number> = {};
  let nominalFlux = options?.flux ?? 0;

  if (deck.origenCases.length > 0) {
    const oc = deck.origenCases[0]!;
    if (options?.flux === undefined) {
      if (oc.flux.length > 0) {
        nominalFlux = oc.flux[0]!;
      } else if (oc.power.length > 0) {
        nominalFlux = oc.power[0]! * 1.0e12;
      }
    }
    for (const nuc of oc.nuclides) {
      const norm = normalizeNuclideId(nuc.nuclide);
      const rec = SCALE_NUCLIDE_DATA[norm];
      const mass = rec?.atomicMass ?? 235.0;
      let atoms = nuc.amount;
      if (nuc.unit === "moles") atoms = nuc.amount * AVOGADRO;
      else if (nuc.unit === "grams") atoms = (nuc.amount / mass) * AVOGADRO;
      else if (nuc.unit === "kg") atoms = ((nuc.amount * 1000.0) / mass) * AVOGADRO;
      initialAtoms[norm] = (initialAtoms[norm] ?? 0) + atoms;
    }
  } else {
    for (const comp of deck.compositions) {
      for (const [iso, pct] of Object.entries(comp.isotopes)) {
        const norm = normalizeNuclideId(iso);
        initialAtoms[norm] = (initialAtoms[norm] ?? 0) + pct * 1.0e20;
      }
    }
    if (options?.flux === undefined && Object.keys(initialAtoms).length > 0) {
      nominalFlux = 3.0e13;
    }
  }

  if (Object.keys(initialAtoms).length === 0) {
    initialAtoms["U-235"] = 1.0e21;
  }

  const nuclides = expandNuclideNetwork(Object.keys(initialAtoms), nominalFlux > 0);

  // 1. Declare neutron flux parameter `phi`
  const phiVar = dae.addVariable("phi", VarType.Real, Variability.Parameter, Causality.Local, nominalFlux);

  // 2. Declare nuclide atom-density state variables `N_<nuclide>`
  const nucVarMap = new Map<string, number>();
  for (const id of nuclides) {
    const n0 = initialAtoms[id] ?? 0.0;
    const varId = dae.addVariable(`N_${sanitizeId(id)}`, VarType.Real, Variability.Continuous, Causality.Local, n0);
    nucVarMap.set(id, varId);
  }

  // 3. Declare algebraic observables: total decay heat (W) and total activity (Bq)
  const decayHeatVar = dae.addVariable("P_decay", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  const totalActVar = dae.addVariable("A_total", VarType.Real, Variability.Continuous, Causality.Output, 0.0);

  // 4. Emit Bateman ODEs: der(N_i) = sum_j (production_ji * N_j) - (lambda_i + sigma_a,i * phi) * N_i
  for (const id of nuclides) {
    const iVar = nucVarMap.get(id)!;
    const rec = SCALE_NUCLIDE_DATA[id];
    const lambdaI = rec?.decayConstant ?? 0.0;
    const sigmaACm2 = (rec?.sigmaAbsorptionBarns ?? 0.0) * BARN_TO_CM2;

    // Loss term: (lambda_i + sigma_a,i * phi) * N_i
    const phiRef = dae.addName(phiVar);
    const sigPhi = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(sigmaACm2), phiRef);
    const totalLossRate = dae.addBinaryExpr(BinOp.Add, dae.addRealLiteral(lambdaI), sigPhi);
    const lossTerm = dae.addBinaryExpr(BinOp.Mul, totalLossRate, dae.addName(iVar));

    // Production terms from all parent nuclides j
    let prodExpr: number | undefined;
    const addProd = (termExpr: number) => {
      prodExpr = prodExpr === undefined ? termExpr : dae.addBinaryExpr(BinOp.Add, prodExpr, termExpr);
    };

    for (const parentId of nuclides) {
      if (parentId === id) continue;
      const pRec = SCALE_NUCLIDE_DATA[parentId];
      if (!pRec) continue;
      const pVar = nucVarMap.get(parentId)!;

      // Radioactive decay parent -> daughter
      if (pRec.decayDaughter === id && pRec.decayConstant > 0) {
        addProd(dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(pRec.decayConstant), dae.addName(pVar)));
      }

      // Neutron capture parent -> product
      if (pRec.captureProduct === id && pRec.sigmaCaptureBarns > 0) {
        const capCoeff = pRec.sigmaCaptureBarns * BARN_TO_CM2;
        const capRate = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(capCoeff), dae.addName(phiVar));
        addProd(dae.addBinaryExpr(BinOp.Mul, capRate, dae.addName(pVar)));
      }

      // Fission yield from U-235 -> fission product
      if (parentId === "U-235" && rec?.u235FissionYield && rec.u235FissionYield > 0 && pRec.sigmaFissionBarns > 0) {
        const yieldCoeff = rec.u235FissionYield * pRec.sigmaFissionBarns * BARN_TO_CM2;
        const yieldRate = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(yieldCoeff), dae.addName(phiVar));
        addProd(dae.addBinaryExpr(BinOp.Mul, yieldRate, dae.addName(pVar)));
      }
    }

    const rhs =
      prodExpr === undefined
        ? dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), lossTerm)
        : dae.addBinaryExpr(BinOp.Sub, prodExpr, lossTerm);

    const lhs = dae.addDer(iVar);
    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  // 5. Emit decay heat and total activity algebraic equations
  let heatRhs: number | undefined;
  let actRhs: number | undefined;
  for (const id of nuclides) {
    const rec = SCALE_NUCLIDE_DATA[id];
    if (!rec || rec.decayConstant <= 0) continue;
    const vRef = dae.addName(nucVarMap.get(id)!);
    const actTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(rec.decayConstant), vRef);
    actRhs = actRhs === undefined ? actTerm : dae.addBinaryExpr(BinOp.Add, actRhs, actTerm);

    const heatFactor = rec.decayConstant * rec.decayEnergyMeV * MEV_TO_JOULES;
    const heatTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(heatFactor), dae.addName(nucVarMap.get(id)!));
    heatRhs = heatRhs === undefined ? heatTerm : dae.addBinaryExpr(BinOp.Add, heatRhs, heatTerm);
  }

  dae.addEquation(EqKind.Simple, dae.addName(decayHeatVar), heatRhs ?? dae.addRealLiteral(0.0));
  dae.addEquation(EqKind.Simple, dae.addName(totalActVar), actRhs ?? dae.addRealLiteral(0.0));

  return dae;
}
