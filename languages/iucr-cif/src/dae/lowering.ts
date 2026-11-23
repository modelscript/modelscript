// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for IUCr CIF Crystal Structures.
 *
 * Lowers unit-cell metric tensor components (G_ij), determinant det(G),
 * unit-cell volume (V^2 = det(G)), theoretical density (rho * V = M / (N_A * 1e-24)),
 * and Bragg diffraction law (2 * d_hkl * sin(theta) = lambda) directly into
 * `@modelscript/runtime`'s linear-memory `IDaeBuilder`.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { solveCrystalStructure } from "../solver/index.js";
import type { CifDataBlock, CifDocument, CrystalSolution, CrystalStructure } from "../types.js";

const DEG2RAD = Math.PI / 180;
const AVOGADRO_ANGSTROM3 = 0.602214076; // N_A * 1e-24 cm³/Å³

export interface CifDaeLoweringResult {
  variableCount: number;
  equationCount: number;
  variableMap: Map<string, number>;
  solution: CrystalSolution;
}

/**
 * Lowers a crystal structure's metric geometry and Bragg diffraction equations directly into `IDaeBuilder`.
 */
export function lowerCifToDae(
  builder: IDaeBuilder,
  input: string | CifDocument | CifDataBlock | CrystalStructure,
): CifDaeLoweringResult {
  const solution = solveCrystalStructure(input);
  const { structure, metric, densityGCm3, unitCellMassGPerMol, xrd } = solution;
  const { a, b, c, alpha, beta, gamma } = structure.cell;

  const variableMap = new Map<string, number>();
  let equationCount = 0;

  function addVar(
    name: string,
    variability: Variability,
    startVal: number,
    causality: Causality = Causality.Local,
  ): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Real, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  function eq(lhs: number, rhs: number): void {
    builder.addEquation(EqKind.Simple, lhs, rhs);
    equationCount++;
  }

  // Unit cell parameters
  const vA = addVar("cell_a", Variability.Parameter, a, Causality.Input);
  const vB = addVar("cell_b", Variability.Parameter, b, Causality.Input);
  const vC = addVar("cell_c", Variability.Parameter, c, Causality.Input);
  const vCosA = addVar("cell_cos_alpha", Variability.Parameter, Math.cos(alpha * DEG2RAD));
  const vCosB = addVar("cell_cos_beta", Variability.Parameter, Math.cos(beta * DEG2RAD));
  const vCosG = addVar("cell_cos_gamma", Variability.Parameter, Math.cos(gamma * DEG2RAD));
  const vLambda = addVar("xrd_lambda", Variability.Parameter, xrd.wavelength, Causality.Input);
  const vCellMass = addVar("unit_cell_mass", Variability.Parameter, unitCellMassGPerMol);

  // Metric tensor G components
  const vG11 = addVar("G_11", Variability.Continuous, metric.G[0][0]);
  const vG22 = addVar("G_22", Variability.Continuous, metric.G[1][1]);
  const vG33 = addVar("G_33", Variability.Continuous, metric.G[2][2]);
  const vG12 = addVar("G_12", Variability.Continuous, metric.G[0][1]);
  const vG13 = addVar("G_13", Variability.Continuous, metric.G[0][2]);
  const vG23 = addVar("G_23", Variability.Continuous, metric.G[1][2]);

  eq(builder.addName(vG11), builder.addBinaryExpr(BinOp.Mul, builder.addName(vA), builder.addName(vA)));
  eq(builder.addName(vG22), builder.addBinaryExpr(BinOp.Mul, builder.addName(vB), builder.addName(vB)));
  eq(builder.addName(vG33), builder.addBinaryExpr(BinOp.Mul, builder.addName(vC), builder.addName(vC)));
  eq(
    builder.addName(vG12),
    builder.addBinaryExpr(
      BinOp.Mul,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vA), builder.addName(vB)),
      builder.addName(vCosG),
    ),
  );
  eq(
    builder.addName(vG13),
    builder.addBinaryExpr(
      BinOp.Mul,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vA), builder.addName(vC)),
      builder.addName(vCosB),
    ),
  );
  eq(
    builder.addName(vG23),
    builder.addBinaryExpr(
      BinOp.Mul,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vB), builder.addName(vC)),
      builder.addName(vCosA),
    ),
  );

  // det(G) = G11*(G22*G33 - G23^2) - G12*(G12*G33 - G23*G13) + G13*(G12*G23 - G22*G13)
  const vDetG = addVar("det_G", Variability.Continuous, metric.detG);
  const term1 = builder.addBinaryExpr(
    BinOp.Mul,
    builder.addName(vG11),
    builder.addBinaryExpr(
      BinOp.Sub,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vG22), builder.addName(vG33)),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vG23), builder.addName(vG23)),
    ),
  );
  const term2 = builder.addBinaryExpr(
    BinOp.Mul,
    builder.addName(vG12),
    builder.addBinaryExpr(
      BinOp.Sub,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vG12), builder.addName(vG33)),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vG23), builder.addName(vG13)),
    ),
  );
  const term3 = builder.addBinaryExpr(
    BinOp.Mul,
    builder.addName(vG13),
    builder.addBinaryExpr(
      BinOp.Sub,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vG12), builder.addName(vG23)),
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vG22), builder.addName(vG13)),
    ),
  );
  eq(builder.addName(vDetG), builder.addBinaryExpr(BinOp.Add, builder.addBinaryExpr(BinOp.Sub, term1, term2), term3));

  // Unit-cell volume: cell_volume * cell_volume = det_G
  const vVol = addVar("cell_volume", Variability.Continuous, metric.volume, Causality.Output);
  eq(builder.addBinaryExpr(BinOp.Mul, builder.addName(vVol), builder.addName(vVol)), builder.addName(vDetG));

  // Theoretical density: crystal_density * cell_volume * 0.602214076 = unit_cell_mass
  const vDensity = addVar("crystal_density", Variability.Continuous, densityGCm3, Causality.Output);
  eq(
    builder.addBinaryExpr(
      BinOp.Mul,
      builder.addBinaryExpr(BinOp.Mul, builder.addName(vDensity), builder.addName(vVol)),
      builder.addRealLiteral(AVOGADRO_ANGSTROM3),
    ),
    builder.addName(vCellMass),
  );

  // Top Bragg diffraction equations: 2 * d_hkl * sin(theta_hkl) = lambda
  const topPeaks = [...xrd.peaks].sort((p1, p2) => p2.relativeIntensity - p1.relativeIntensity).slice(0, 6);

  for (const peak of topPeaks) {
    const [h, k, l] = peak.hkl;
    const tag = `${h}_${k}_${l}`.replace(/-/g, "m");
    const sinTheta = Math.sin(((peak.twoTheta / 2) * Math.PI) / 180);

    const vD = addVar(`bragg_d_${tag}`, Variability.Parameter, peak.dSpacing);
    const vSin = addVar(`bragg_sin_theta_${tag}`, Variability.Continuous, sinTheta, Causality.Output);

    eq(
      builder.addBinaryExpr(
        BinOp.Mul,
        builder.addRealLiteral(2.0),
        builder.addBinaryExpr(BinOp.Mul, builder.addName(vD), builder.addName(vSin)),
      ),
      builder.addName(vLambda),
    );
  }

  return {
    variableCount: variableMap.size,
    equationCount,
    variableMap,
    solution,
  };
}
