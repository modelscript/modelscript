// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Direct Linear-Memory DAE Arena Lowering.
 *
 * Lowers an evaluated ENDF-6 tape into ModelScript's zero-GC `DAEBuilder`:
 *   1. Collapses `MF=3` pointwise cross-sections into G-group constants (`DEFAULT_TWO_GROUP_BOUNDS`).
 *   2. Emits multigroup neutron flux balance ODEs (`phi_g1..phi_gG`):
 *        der(phi_g) = v_g * (S_g + chi_g * sum(nu * Sigma_f_g' * phi_g') - (Sigma_t_g + D_g * B2) * phi_g)
 *   3. Emits material-level reaction-rate algebraic equations (`R_total`, `R_capture`, `R_fission`).
 *   4. Emits radioactive decay ODEs (`der(N_decay_<mat>) = -lambda * N_decay_<mat>`) when `MF=8 MT=457` is present.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import {
  collapseMaterialMultigroup,
  DEFAULT_TWO_GROUP_BOUNDS,
  type MultigroupCollapseOptions,
} from "../solver/multigroup.js";
import type { Endf6Tape } from "../types.js";

export interface Endf6DaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  /** Energy group boundaries in eV (default: 2-group `[1e-5, 0.625, 2e7]`). */
  groupBounds?: readonly number[] | undefined;
  /** Atom number density N in atoms/(barn·cm) (default: `0.048` ~ dense uranium/water). */
  atomDensity?: number | undefined;
  /** Average neutrons per fission nu (default: `2.43`). */
  nuBar?: number | undefined;
  /** Geometric buckling B^2 in cm^-2 (default: `0.001`). */
  bucklingB2?: number | undefined;
  /** External neutron source per group S_g in n/(cm^3·s) (default: `1e6`). */
  externalSource?: number | undefined;
  /** Weighting spectrum options for multigroup collapse. */
  collapseOptions?: MultigroupCollapseOptions | undefined;
}

/** Characteristic neutron speed (cm/s) from group midpoint energy E_mid (eV): v = sqrt(2 E / m_n). */
function groupNeutronSpeedCmPerS(eLow: number, eHigh: number): number {
  const eMid = Math.sqrt(Math.max(1e-10, eLow) * Math.max(1e-10, eHigh));
  // v(0.0253 eV) = 2.2e5 cm/s -> v(E) = 1.38315e6 * sqrt(E_eV) cm/s
  return 1.38315e6 * Math.sqrt(eMid);
}

/**
 * Lowers an `Endf6Tape` directly into a linear-memory `DAEBuilder`.
 */
export function lowerEndf6ToDae(tape: Endf6Tape, options?: Endf6DaeOptions): DAEBuilder {
  const rawTitle = options?.modelName ?? (tape.tpid || "Endf6MultigroupModel");
  const modelName = rawTitle.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  const groupBounds = options?.groupBounds ?? DEFAULT_TWO_GROUP_BOUNDS;
  const numGroups = Math.max(1, groupBounds.length - 1);
  const atomDensity = options?.atomDensity ?? 0.048; // atoms / (barn * cm)
  const nuBar = options?.nuBar ?? 2.43;
  const bucklingB2 = options?.bucklingB2 ?? 0.001;
  const extSource = options?.externalSource ?? 1.0e6;

  // Collapse all materials in the tape
  const collapsedMaterials = [...tape.materials.values()].map((m) =>
    collapseMaterialMultigroup(m, groupBounds, options?.collapseOptions),
  );

  // Allocate group flux state variables phi_g1 .. phi_gG
  const phiVars: number[] = [];
  for (let g = 0; g < numGroups; g++) {
    const phiVar = dae.addVariable(`phi_g${g + 1}`, VarType.Real, Variability.Continuous, Causality.Local, 1.0e12);
    phiVars.push(phiVar);
  }

  // Aggregate homogenized macroscopic cross-sections across materials per group
  const macroTotal = new Array<number>(numGroups).fill(0);
  const macroCapture = new Array<number>(numGroups).fill(0);
  const macroFission = new Array<number>(numGroups).fill(0);
  const macroScatter = new Array<number>(numGroups).fill(0);

  for (const cm of collapsedMaterials) {
    for (let g = 0; g < numGroups; g++) {
      const grp = cm.groups[g];
      if (!grp) continue;
      const sigT = atomDensity * grp.sigmaTotal;
      const sigS = atomDensity * grp.sigmaElastic;
      const sigF = atomDensity * grp.sigmaFission;
      const sigC = atomDensity * grp.sigmaCapture;

      macroTotal[g]! += sigT;
      macroScatter[g]! += sigS;
      macroFission[g]! += sigF;
      macroCapture[g]! += sigC;

      // Per-material reaction-rate algebraic variables & equations
      const tag = `mat${cm.mat}_g${g + 1}`;
      const rTotVar = dae.addVariable(`R_total_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const rCapVar = dae.addVariable(`R_capture_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const rFisVar = dae.addVariable(`R_fission_${tag}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

      dae.addEquation(
        EqKind.Simple,
        dae.addName(rTotVar),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(sigT), dae.addName(phiVars[g]!)),
      );
      dae.addEquation(
        EqKind.Simple,
        dae.addName(rCapVar),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(sigC), dae.addName(phiVars[g]!)),
      );
      dae.addEquation(
        EqKind.Simple,
        dae.addName(rFisVar),
        dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(sigF), dae.addName(phiVars[g]!)),
      );
    }
  }

  // Fission source sum: sum_g' (nu * Sigma_f_g' * phi_g')
  let totalFissionSourceExpr: number | null = null;
  for (let g = 0; g < numGroups; g++) {
    const nuSigF = nuBar * macroFission[g]!;
    if (nuSigF > 0) {
      const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(nuSigF), dae.addName(phiVars[g]!));
      totalFissionSourceExpr =
        totalFissionSourceExpr === null ? term : dae.addBinaryExpr(BinOp.Add, totalFissionSourceExpr, term);
    }
  }

  // Multigroup neutron balance ODEs:
  // der(phi_g) = v_g * (S_g + chi_g * fissionSource + downscatter - (Sigma_t_g + D_g * B^2) * phi_g)
  for (let g = 0; g < numGroups; g++) {
    const eLow = groupBounds[g]!;
    const eHigh = groupBounds[g + 1]!;
    const vG = groupNeutronSpeedCmPerS(eLow, eHigh);
    const sigT = Math.max(macroTotal[g]!, 1e-6);
    const diffusionD = 1.0 / (3.0 * sigT);
    const removalRate = sigT + diffusionD * bucklingB2;

    // Fission neutrons are born in the highest-energy (fast) group (chi = 1 for last group)
    const chiG = g === numGroups - 1 ? 1.0 : 0.0;

    let rhs = dae.addRealLiteral(extSource);
    if (chiG > 0 && totalFissionSourceExpr !== null) {
      const fisTerm =
        chiG === 1.0
          ? totalFissionSourceExpr
          : dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(chiG), totalFissionSourceExpr);
      rhs = dae.addBinaryExpr(BinOp.Add, rhs, fisTerm);
    }

    // Simple downscatter coupling from group g+1 -> g (10% of upper-group elastic scattering)
    if (g + 1 < numGroups && macroScatter[g + 1]! > 0) {
      const sigDown = 0.1 * macroScatter[g + 1]!;
      const downTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(sigDown), dae.addName(phiVars[g + 1]!));
      rhs = dae.addBinaryExpr(BinOp.Add, rhs, downTerm);
    }

    const lossTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(removalRate), dae.addName(phiVars[g]!));
    const netBalance = dae.addBinaryExpr(BinOp.Sub, rhs, lossTerm);
    const scaledRhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(vG), netBalance);

    dae.addEquation(EqKind.Simple, dae.addDer(phiVars[g]!), scaledRhs);
  }

  // Radioactive decay ODEs from MF=8 MT=457: der(N_decay_<mat>) = -lambda * N_decay_<mat>
  for (const mat of tape.materials.values()) {
    if (mat.decay && mat.decay.nst === 0 && Number.isFinite(mat.decay.halfLife) && mat.decay.halfLife > 0) {
      const lambda = Math.LN2 / mat.decay.halfLife;
      const nVar = dae.addVariable(`N_decay_mat${mat.mat}`, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
      const decayRhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-lambda), dae.addName(nVar));
      dae.addEquation(EqKind.Simple, dae.addDer(nVar), decayRhs);
    }
  }

  return dae;
}
