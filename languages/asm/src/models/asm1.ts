// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IWA Activated Sludge Model No. 1 (ASM1) Biokinetics & Petersen Matrix.
 *
 * Henze, M., Grady, C.P.L., Gujer, W., Marais, G.v.R., Matsuo, T. (1987).
 * Activated Sludge Model No. 1. IAWPRC Scientific and Technical Report No. 1.
 */

import type { AsmComponent, AsmPetersenMatrix, AsmProcess } from "../types.js";

export const ASM1_COMPONENTS: AsmComponent[] = [
  {
    name: "S_I",
    symbol: "S_I",
    unit: "g COD/m3",
    description: "Soluble inert organic matter",
    isParticulate: false,
    isSoluble: true,
  },
  {
    name: "S_S",
    symbol: "S_S",
    unit: "g COD/m3",
    description: "Readily biodegradable substrate",
    isParticulate: false,
    isSoluble: true,
  },
  {
    name: "X_I",
    symbol: "X_I",
    unit: "g COD/m3",
    description: "Particulate inert organic matter",
    isParticulate: true,
    isSoluble: false,
  },
  {
    name: "X_S",
    symbol: "X_S",
    unit: "g COD/m3",
    description: "Slowly biodegradable substrate",
    isParticulate: true,
    isSoluble: false,
  },
  {
    name: "X_BH",
    symbol: "X_B,H",
    unit: "g COD/m3",
    description: "Active heterotrophic biomass",
    isParticulate: true,
    isSoluble: false,
  },
  {
    name: "X_BA",
    symbol: "X_B,A",
    unit: "g COD/m3",
    description: "Active autotrophic biomass",
    isParticulate: true,
    isSoluble: false,
  },
  {
    name: "X_P",
    symbol: "X_P",
    unit: "g COD/m3",
    description: "Particulate products from biomass decay",
    isParticulate: true,
    isSoluble: false,
  },
  {
    name: "S_O",
    symbol: "S_O",
    unit: "g -O2/m3",
    description: "Dissolved oxygen",
    isParticulate: false,
    isSoluble: true,
  },
  {
    name: "S_NO",
    symbol: "S_NO",
    unit: "g N/m3",
    description: "Nitrate and nitrite nitrogen",
    isParticulate: false,
    isSoluble: true,
  },
  {
    name: "S_NH",
    symbol: "S_NH",
    unit: "g N/m3",
    description: "Ammonium and ammonia nitrogen",
    isParticulate: false,
    isSoluble: true,
  },
  {
    name: "S_ND",
    symbol: "S_ND",
    unit: "g N/m3",
    description: "Soluble biodegradable organic nitrogen",
    isParticulate: false,
    isSoluble: true,
  },
  {
    name: "X_ND",
    symbol: "X_ND",
    unit: "g N/m3",
    description: "Particulate biodegradable organic nitrogen",
    isParticulate: true,
    isSoluble: false,
  },
  {
    name: "S_ALK",
    symbol: "S_ALK",
    unit: "mol HCO3-/m3",
    description: "Alkalinity",
    isParticulate: false,
    isSoluble: true,
  },
];

export interface Asm1Parameters {
  // Stoichiometric parameters
  Y_H: number;
  Y_A: number;
  f_P: number;
  i_XB: number;
  i_XP: number;

  // Kinetic parameters (at 20°C)
  mu_H: number;
  K_S: number;
  K_O_H: number;
  K_NO: number;
  b_H: number;
  eta_g: number;
  eta_h: number;
  k_h: number;
  K_X: number;
  mu_A: number;
  K_NH: number;
  K_O_A: number;
  b_A: number;
  k_a: number;

  [key: string]: number;
}

export const ASM1_DEFAULT_PARAMETERS: Asm1Parameters = {
  // Stoichiometric parameters
  Y_H: 0.67, // Heterotrophic yield (g cell COD formed / g COD used)
  Y_A: 0.24, // Autotrophic yield (g cell COD formed / g N oxidized)
  f_P: 0.08, // Fraction of biomass converted to particulate products
  i_XB: 0.086, // Mass N / Mass COD in biomass
  i_XP: 0.06, // Mass N / Mass COD in particulate products

  // Kinetic parameters (at 20°C)
  mu_H: 6.0, // Maximum specific growth rate for heterotrophs (1/day)
  K_S: 20.0, // Substrate half-velocity constant (g COD/m3)
  K_O_H: 0.2, // Oxygen affinity constant for heterotrophs (g O2/m3)
  K_NO: 0.5, // Nitrate affinity constant for denitrifying heterotrophs (g NO3-N/m3)
  b_H: 0.62, // Heterotroph decay rate (1/day)
  eta_g: 0.8, // Anoxic growth rate reduction factor
  eta_h: 0.4, // Anoxic hydrolysis reduction factor
  k_h: 3.0, // Maximum specific hydrolysis rate (g XS / (g XBH * day))
  K_X: 0.03, // Half-saturation coefficient for hydrolysis of slowly biodegradable substrate
  mu_A: 0.8, // Maximum specific growth rate for autotrophic biomass (1/day)
  K_NH: 1.0, // Ammonia affinity constant for autotrophs (g NH4-N/m3)
  K_O_A: 0.4, // Oxygen affinity constant for autotrophs (g O2/m3)
  b_A: 0.15, // Autotroph decay rate (1/day)
  k_a: 0.08, // Ammonification rate constant (m3 / (g COD * day))
};

/**
 * Builds the IWA ASM1 Petersen matrix with stoichiometric coefficients.
 */
export function getAsm1PetersenMatrix(params?: Partial<Asm1Parameters> | Record<string, number>): AsmPetersenMatrix {
  const p = { ...ASM1_DEFAULT_PARAMETERS, ...params } as Asm1Parameters;
  const { Y_H, Y_A, f_P, i_XB, i_XP } = p;

  const processes: AsmProcess[] = [
    // 1. Aerobic growth of heterotrophs
    {
      name: "Aerobic_Growth_Heterotrophs",
      rateEquation: "mu_H * (S_S / (K_S + S_S)) * (S_O / (K_O_H + S_O)) * X_BH",
      stoichiometry: {
        S_S: -1.0 / Y_H,
        X_BH: 1.0,
        S_O: -((1.0 - Y_H) / Y_H),
        S_NH: -i_XB,
        S_ALK: -i_XB / 14.0,
      },
    },
    // 2. Anoxic growth of heterotrophs (Denitrification)
    {
      name: "Anoxic_Growth_Heterotrophs",
      rateEquation: "mu_H * (S_S / (K_S + S_S)) * (K_O_H / (K_O_H + S_O)) * (S_NO / (K_NO + S_NO)) * eta_g * X_BH",
      stoichiometry: {
        S_S: -1.0 / Y_H,
        X_BH: 1.0,
        S_NO: -((1.0 - Y_H) / (2.86 * Y_H)),
        S_NH: -i_XB,
        S_ALK: (1.0 - Y_H) / (14.0 * 2.86 * Y_H) - i_XB / 14.0,
      },
    },
    // 3. Aerobic growth of autotrophs (Nitrification)
    {
      name: "Aerobic_Growth_Autotrophs",
      rateEquation: "mu_A * (S_NH / (K_NH + S_NH)) * (S_O / (K_O_A + S_O)) * X_BA",
      stoichiometry: {
        X_BA: 1.0,
        S_O: -((4.57 - Y_A) / Y_A),
        S_NO: 1.0 / Y_A,
        S_NH: -(i_XB + 1.0 / Y_A),
        S_ALK: -(i_XB / 14.0 + 1.0 / (7.0 * Y_A)),
      },
    },
    // 4. Decay of heterotrophs
    {
      name: "Decay_Heterotrophs",
      rateEquation: "b_H * X_BH",
      stoichiometry: {
        X_BH: -1.0,
        X_S: 1.0 - f_P,
        X_P: f_P,
        X_ND: i_XB - f_P * i_XP,
      },
    },
    // 5. Decay of autotrophs
    {
      name: "Decay_Autotrophs",
      rateEquation: "b_A * X_BA",
      stoichiometry: {
        X_BA: -1.0,
        X_S: 1.0 - f_P,
        X_P: f_P,
        X_ND: i_XB - f_P * i_XP,
      },
    },
    // 6. Ammonification of soluble organic nitrogen
    {
      name: "Ammonification_Soluble_Organic_N",
      rateEquation: "k_a * S_ND * X_BH",
      stoichiometry: {
        S_NH: 1.0,
        S_ND: -1.0,
        S_ALK: 1.0 / 14.0,
      },
    },
    // 7. Hydrolysis of slowly biodegradable substrate
    {
      name: "Hydrolysis_Slowly_Biodegradable_Substrate",
      rateEquation:
        "k_h * ((X_S / X_BH) / (K_X + (X_S / X_BH))) * ((S_O / (K_O_H + S_O)) + eta_h * (K_O_H / (K_O_H + S_O)) * (S_NO / (K_NO + S_NO))) * X_BH",
      stoichiometry: {
        S_S: 1.0,
        X_S: -1.0,
      },
    },
    // 8. Hydrolysis of particulate organic nitrogen
    {
      name: "Hydrolysis_Particulate_Organic_N",
      rateEquation:
        "k_h * ((X_S / X_BH) / (K_X + (X_S / X_BH))) * ((S_O / (K_O_H + S_O)) + eta_h * (K_O_H / (K_O_H + S_O)) * (S_NO / (K_NO + S_NO))) * X_BH * (X_ND / X_S)",
      stoichiometry: {
        S_ND: 1.0,
        X_ND: -1.0,
      },
    },
  ];

  return {
    modelType: "ASM1",
    components: ASM1_COMPONENTS,
    processes,
    parameters: p,
  };
}

/**
 * Evaluates process reaction rates rho (g/(m3*day)) from current concentrations.
 */
export function evaluateAsm1ProcessRates(
  concentrations: Record<string, number>,
  params?: Partial<Asm1Parameters> | Record<string, number>,
): number[] {
  const S_S = Math.max(0, concentrations["S_S"] ?? 0);
  const X_BH = Math.max(0, concentrations["X_BH"] ?? 0);
  const X_BA = Math.max(0, concentrations["X_BA"] ?? 0);
  const X_S = Math.max(0, concentrations["X_S"] ?? 0);
  const S_O = Math.max(0, concentrations["S_O"] ?? 0);
  const S_NO = Math.max(0, concentrations["S_NO"] ?? 0);
  const S_NH = Math.max(0, concentrations["S_NH"] ?? 0);
  const S_ND = Math.max(0, concentrations["S_ND"] ?? 0);
  const X_ND = Math.max(0, concentrations["X_ND"] ?? 0);

  const p = { ...ASM1_DEFAULT_PARAMETERS, ...params } as Asm1Parameters;

  // Process 1: Aerobic growth of heterotrophs
  const rho1 = p.mu_H * (S_S / (p.K_S + S_S)) * (S_O / (p.K_O_H + S_O)) * X_BH;

  // Process 2: Anoxic growth of heterotrophs
  const rho2 = p.mu_H * (S_S / (p.K_S + S_S)) * (p.K_O_H / (p.K_O_H + S_O)) * (S_NO / (p.K_NO + S_NO)) * p.eta_g * X_BH;

  // Process 3: Aerobic growth of autotrophs
  const rho3 = p.mu_A * (S_NH / (p.K_NH + S_NH)) * (S_O / (p.K_O_A + S_O)) * X_BA;

  // Process 4: Decay of heterotrophs
  const rho4 = p.b_H * X_BH;

  // Process 5: Decay of autotrophs
  const rho5 = p.b_A * X_BA;

  // Process 6: Ammonification
  const rho6 = p.k_a * S_ND * X_BH;

  // Process 7: Hydrolysis of substrate
  const xsRatio = X_BH > 0 ? X_S / X_BH : 0;
  const hydroFactor = S_O / (p.K_O_H + S_O) + p.eta_h * (p.K_O_H / (p.K_O_H + S_O)) * (S_NO / (p.K_NO + S_NO));
  const rho7 = p.k_h * (xsRatio / (p.K_X + xsRatio)) * hydroFactor * X_BH;

  // Process 8: Hydrolysis of organic N
  const rho8 = X_S > 0 ? rho7 * (X_ND / X_S) : 0;

  return [rho1, rho2, rho3, rho4, rho5, rho6, rho7, rho8];
}

/**
 * Computes net conversion rate r_i = sum_j (nu_ij * rho_j) for all components.
 */
export function computeAsm1ConversionRates(
  concentrations: Record<string, number>,
  params?: Partial<Asm1Parameters> | Record<string, number>,
): Record<string, number> {
  const petersen = getAsm1PetersenMatrix(params);
  const rhos = evaluateAsm1ProcessRates(concentrations, params);

  const netRates: Record<string, number> = {};
  for (const comp of petersen.components) {
    netRates[comp.name] = 0.0;
  }

  for (let j = 0; j < petersen.processes.length; j++) {
    const proc = petersen.processes[j]!;
    const rho = rhos[j]!;
    for (const [compName, coeff] of Object.entries(proc.stoichiometry)) {
      netRates[compName] = (netRates[compName] ?? 0.0) + coeff * rho;
    }
  }

  return netRates;
}
