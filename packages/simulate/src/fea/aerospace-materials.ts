// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Aerospace Structural Constitutive Models:
 *   1. 3D Orthotropic Elasticity (`computeOrthotropicConstitutiveMatrix`) for CFRP composites
 *   2. Classical Laminate Theory [A, B, D] stiffness (`computeLaminateABD`) for arbitrary ply stackups
 *   3. 3D J2 von Mises Elastoplasticity radial return-mapping (`returnMapJ2Plasticity`)
 *
 * Voigt stress/strain convention (matching `Tet4Element`):
 *   stress = [sigma_11, sigma_22, sigma_33, tau_12, tau_23, tau_13]
 *   strain = [eps_11,   eps_22,   eps_33,   gam_12, gam_23, gam_13]
 */

export interface OrthotropicMaterialProps {
  /** Young's modulus along material axis 1 (fiber direction) [Pa]. */
  E1: number;
  /** Young's modulus along material axis 2 (transverse in-plane) [Pa]. */
  E2: number;
  /** Young's modulus along material axis 3 (through-thickness) [Pa]. */
  E3: number;
  /** Major Poisson's ratio nu_12 (-eps_2 / eps_1 for uniaxial load in 1). */
  nu12: number;
  /** Poisson's ratio nu_23 (-eps_3 / eps_2 for uniaxial load in 2). */
  nu23: number;
  /** Poisson's ratio nu_13 (-eps_3 / eps_1 for uniaxial load in 1). */
  nu13: number;
  /** In-plane shear modulus G_12 [Pa]. */
  G12: number;
  /** Transverse shear modulus G_23 [Pa]. */
  G23: number;
  /** Transverse shear modulus G_13 [Pa]. */
  G13: number;
}

export interface LaminatePly {
  /** Fiber-direction Young's modulus E_1 [Pa]. */
  E1: number;
  /** Transverse Young's modulus E_2 [Pa]. */
  E2: number;
  /** Major in-plane Poisson's ratio nu_12. */
  nu12: number;
  /** In-plane shear modulus G_12 [Pa]. */
  G12: number;
  /** Ply thickness [m]. */
  thickness: number;
  /** Fiber orientation angle relative to laminate x-axis [degrees]. */
  angleDeg: number;
}

export interface LaminateABDResult {
  /** 3x3 extensional stiffness matrix A (row-major, length 9) [N/m]. */
  A: Float64Array;
  /** 3x3 bending-extension coupling matrix B (row-major, length 9) [N]. */
  B: Float64Array;
  /** 3x3 bending stiffness matrix D (row-major, length 9) [N*m]. */
  D: Float64Array;
  /** 6x6 assembled [[A, B], [B, D]] laminate stiffness matrix (row-major, length 36). */
  ABD: Float64Array;
  /** Total laminate thickness [m]. */
  totalThickness: number;
}

export interface J2ReturnMapResult {
  /** Updated 6-component Cauchy stress [s11, s22, s33, t12, t23, t13]. */
  stress: Float64Array;
  /** Updated equivalent plastic strain eps_p^{n+1}. */
  eqPlasticStrain: number;
  /** Incremental equivalent plastic strain Delta(eps_p) >= 0. */
  deltaPlasticStrain: number;
  /** Updated von Mises equivalent stress sigma_vm. */
  vonMisesStress: number;
  /** True if plastic yielding occurred during this step. */
  yielded: boolean;
  /** Plastic strain increment in engineering Voigt notation [deps11, deps22, deps33, dgam12, dgam23, dgam13]. */
  plasticStrainIncrement6: Float64Array;
  /** Consistent 6x6 elastoplastic tangent modulus C_ep (row-major, length 36). */
  consistentTangent: Float64Array;
}

/**
 * Computes the 3D 6x6 orthotropic elasticity constitutive stiffness matrix D_ortho
 * in row-major Voigt order [11, 22, 33, 12, 23, 13].
 *
 * Reduces identically to the isotropic Hookean stiffness matrix when
 * E1 = E2 = E3 = E, nu12 = nu23 = nu13 = nu, and G12 = G23 = G13 = E / (2 * (1 + nu)).
 */
export function computeOrthotropicConstitutiveMatrix(props: OrthotropicMaterialProps): Float64Array {
  const { E1, E2, E3, nu12, nu23, nu13, G12, G23, G13 } = props;

  if (E1 <= 0 || E2 <= 0 || E3 <= 0 || G12 <= 0 || G23 <= 0 || G13 <= 0) {
    throw new Error("Orthotropic elastic moduli (E1, E2, E3, G12, G23, G13) must be strictly positive.");
  }

  // Minor Poisson's ratios from compliance symmetry: nu_ji / E_j = nu_ij / E_i
  const nu21 = (nu12 * E2) / E1;
  const nu32 = (nu23 * E3) / E2;
  const nu31 = (nu13 * E3) / E1;

  const denom = 1.0 - nu12 * nu21 - nu23 * nu32 - nu31 * nu13 - 2.0 * nu12 * nu23 * nu31;
  if (denom <= 0.0) {
    throw new Error(
      `Orthotropic material violates thermodynamic stability (1 - nu12*nu21 - nu23*nu32 - nu31*nu13 - 2*nu12*nu23*nu31 = ${denom} <= 0).`,
    );
  }

  const delta = denom / (E1 * E2 * E3);
  const D = new Float64Array(36);

  const d11 = (1.0 - nu23 * nu32) / (E2 * E3 * delta);
  const d22 = (1.0 - nu13 * nu31) / (E1 * E3 * delta);
  const d33 = (1.0 - nu12 * nu21) / (E1 * E2 * delta);
  const d12 = (nu21 + nu31 * nu23) / (E2 * E3 * delta);
  const d13 = (nu31 + nu21 * nu32) / (E2 * E3 * delta);
  const d23 = (nu32 + nu12 * nu31) / (E1 * E3 * delta);

  // Row 0 (11)
  D[0] = d11;
  D[1] = d12;
  D[2] = d13;
  // Row 1 (22)
  D[6] = d12;
  D[7] = d22;
  D[8] = d23;
  // Row 2 (33)
  D[12] = d13;
  D[13] = d23;
  D[14] = d33;
  // Shear diagonal (12, 23, 13)
  D[21] = G12;
  D[28] = G23;
  D[35] = G13;

  return D;
}

/**
 * Computes Classical Laminate Theory (CLT) [A, B, D] stiffness matrices for an
 * arbitrary composite ply stackup ordered from bottom (z = -H/2) to top (z = +H/2).
 *
 * For symmetric laminates such as [0/45/-45/90]s, the bending-extension coupling
 * matrix B vanishes identically (B = 0).
 */
export function computeLaminateABD(plies: readonly LaminatePly[]): LaminateABDResult {
  const A = new Float64Array(9);
  const B = new Float64Array(9);
  const D = new Float64Array(9);

  let totalThickness = 0.0;
  for (let k = 0; k < plies.length; k++) {
    const ply = plies[k]!;
    if (ply.thickness <= 0) {
      throw new Error(`Ply ${k} thickness must be strictly positive.`);
    }
    totalThickness += ply.thickness;
  }

  let zPrev = -0.5 * totalThickness;
  for (let k = 0; k < plies.length; k++) {
    const ply = plies[k]!;
    const zCurr = zPrev + ply.thickness;

    const nu21 = (ply.nu12 * ply.E2) / ply.E1;
    const denom = 1.0 - ply.nu12 * nu21;
    if (denom <= 0.0) {
      throw new Error(`Ply ${k} violates plane-stress stability (1 - nu12*nu21 = ${denom} <= 0).`);
    }

    // Reduced plane-stress stiffness Q in material axes
    const Q11 = ply.E1 / denom;
    const Q22 = ply.E2 / denom;
    const Q12 = (ply.nu12 * ply.E2) / denom;
    const Q66 = ply.G12;

    // Rotate Q -> Qbar by ply angle theta
    const theta = (ply.angleDeg * Math.PI) / 180.0;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const c2 = c * c;
    const s2 = s * s;
    const c4 = c2 * c2;
    const s4 = s2 * s2;
    const s2c2 = s2 * c2;
    const sc3 = s * c2 * c;
    const s3c = s2 * s * c;

    const Qb11 = Q11 * c4 + 2.0 * (Q12 + 2.0 * Q66) * s2c2 + Q22 * s4;
    const Qb22 = Q11 * s4 + 2.0 * (Q12 + 2.0 * Q66) * s2c2 + Q22 * c4;
    const Qb12 = (Q11 + Q22 - 4.0 * Q66) * s2c2 + Q12 * (s4 + c4);
    const Qb16 = (Q11 - Q12 - 2.0 * Q66) * sc3 + (Q12 - Q22 + 2.0 * Q66) * s3c;
    const Qb26 = (Q11 - Q12 - 2.0 * Q66) * s3c + (Q12 - Q22 + 2.0 * Q66) * sc3;
    const Qb66 = (Q11 + Q22 - 2.0 * Q12 - 2.0 * Q66) * s2c2 + Q66 * (s4 + c4);

    const dz = zCurr - zPrev;
    const dz2 = 0.5 * (zCurr * zCurr - zPrev * zPrev);
    const dz3 = (zCurr * zCurr * zCurr - zPrev * zPrev * zPrev) / 3.0;

    // Accumulate 3x3 symmetric matrices [11, 22, 12]
    const qbar = [Qb11, Qb12, Qb16, Qb12, Qb22, Qb26, Qb16, Qb26, Qb66];
    for (let idx = 0; idx < 9; idx++) {
      const q = qbar[idx]!;
      A[idx] = A[idx]! + q * dz;
      B[idx] = B[idx]! + q * dz2;
      D[idx] = D[idx]! + q * dz3;
    }

    zPrev = zCurr;
  }

  // Assemble 6x6 block matrix [[A, B], [B, D]]
  const ABD = new Float64Array(36);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const aVal = A[i * 3 + j]!;
      const bVal = B[i * 3 + j]!;
      const dVal = D[i * 3 + j]!;
      ABD[i * 6 + j] = aVal;
      ABD[i * 6 + (j + 3)] = bVal;
      ABD[(i + 3) * 6 + j] = bVal;
      ABD[(i + 3) * 6 + (j + 3)] = dVal;
    }
  }

  return { A, B, D, ABD, totalThickness };
}

/**
 * Radial return-mapping algorithm for 3D J2 von Mises elastoplasticity with
 * linear isotropic hardening:
 *   sigma_y(eps_p) = yieldStress + hardeningModulus * eps_p
 *
 * Projects any over-yield trial stress tensor exactly onto the updated von Mises
 * yield surface such that sigma_vm = (yieldStress + H * eps_p^n) + H * Delta(eps_p).
 */
export function returnMapJ2Plasticity(
  trialStress6: Float64Array | readonly number[],
  eqPlasticStrain: number,
  E: number,
  nu: number,
  yieldStress: number,
  hardeningModulus: number,
): J2ReturnMapResult {
  if (trialStress6.length !== 6) {
    throw new Error(`Expected 6-component Voigt trial stress, got length ${trialStress6.length}.`);
  }

  const G = E / (2.0 * (1.0 + nu));
  const K = E / (3.0 * (1.0 - 2.0 * nu));
  const lambda = K - (2.0 / 3.0) * G;

  const s11 = trialStress6[0]!;
  const s22 = trialStress6[1]!;
  const s33 = trialStress6[2]!;
  const t12 = trialStress6[3]!;
  const t23 = trialStress6[4]!;
  const t13 = trialStress6[5]!;

  // Hydrostatic pressure p = tr(sigma) / 3 and deviatoric trial stress s^trial
  const p = (s11 + s22 + s33) / 3.0;
  const dev0 = s11 - p;
  const dev1 = s22 - p;
  const dev2 = s33 - p;
  const dev3 = t12;
  const dev4 = t23;
  const dev5 = t13;

  // Frobenius norm of symmetric deviatoric tensor ||s^trial||
  const devNormSq = dev0 * dev0 + dev1 * dev1 + dev2 * dev2 + 2.0 * (dev3 * dev3 + dev4 * dev4 + dev5 * dev5);
  const devNorm = Math.sqrt(devNormSq);
  const qTrial = Math.sqrt(1.5) * devNorm;

  const currentYield = yieldStress + hardeningModulus * eqPlasticStrain;
  const fTrial = qTrial - currentYield;

  // Build elastic 6x6 tangent as baseline
  const C = new Float64Array(36);
  C[0] = lambda + 2.0 * G;
  C[1] = lambda;
  C[2] = lambda;
  C[6] = lambda;
  C[7] = lambda + 2.0 * G;
  C[8] = lambda;
  C[12] = lambda;
  C[13] = lambda;
  C[14] = lambda + 2.0 * G;
  C[21] = G;
  C[28] = G;
  C[35] = G;

  if (fTrial <= 0.0 || devNorm <= 1e-30) {
    return {
      stress: Float64Array.from(trialStress6),
      eqPlasticStrain,
      deltaPlasticStrain: 0.0,
      vonMisesStress: qTrial,
      yielded: false,
      plasticStrainIncrement6: new Float64Array(6),
      consistentTangent: C,
    };
  }

  // Plastic step: exact closed-form radial return for linear isotropic hardening
  const dGamma = fTrial / (3.0 * G + hardeningModulus);
  const newEqPlasticStrain = eqPlasticStrain + dGamma;
  const scale = 1.0 - (3.0 * G * dGamma) / qTrial;

  const stress = new Float64Array(6);
  stress[0] = p + scale * dev0;
  stress[1] = p + scale * dev1;
  stress[2] = p + scale * dev2;
  stress[3] = scale * dev3;
  stress[4] = scale * dev4;
  stress[5] = scale * dev5;

  // Compute updated von Mises stress directly from returned stress to verify consistency
  const rP = (stress[0] + stress[1] + stress[2]) / 3.0;
  const rd0 = stress[0] - rP;
  const rd1 = stress[1] - rP;
  const rd2 = stress[2] - rP;
  const vonMisesStress = Math.sqrt(
    1.5 *
      (rd0 * rd0 +
        rd1 * rd1 +
        rd2 * rd2 +
        2.0 * (stress[3] * stress[3] + stress[4] * stress[4] + stress[5] * stress[5])),
  );

  // Unit flow direction n = s^trial / ||s^trial||
  const invDevNorm = 1.0 / devNorm;
  const nVec = [
    dev0 * invDevNorm,
    dev1 * invDevNorm,
    dev2 * invDevNorm,
    dev3 * invDevNorm,
    dev4 * invDevNorm,
    dev5 * invDevNorm,
  ];

  // Engineering Voigt plastic strain increment: deps_p = sqrt(3/2) * dGamma * n (x2 for shear)
  const sqrt32dG = Math.sqrt(1.5) * dGamma;
  const plasticStrainIncrement6 = new Float64Array(6);
  plasticStrainIncrement6[0] = sqrt32dG * nVec[0]!;
  plasticStrainIncrement6[1] = sqrt32dG * nVec[1]!;
  plasticStrainIncrement6[2] = sqrt32dG * nVec[2]!;
  plasticStrainIncrement6[3] = 2.0 * sqrt32dG * nVec[3]!;
  plasticStrainIncrement6[4] = 2.0 * sqrt32dG * nVec[4]!;
  plasticStrainIncrement6[5] = 2.0 * sqrt32dG * nVec[5]!;

  // Consistent algorithmic elastoplastic tangent modulus C_ep:
  //   C_ep = K (I x I) + 2 G * theta * I_dev - 2 G * theta_bar * (n x n)
  //   where theta = 1 - 3 G dGamma / qTrial = scale,
  //         theta_bar = 1 / (1 + H / (3 G)) - (1 - theta)
  const theta = scale;
  const thetaBar = 1.0 / (1.0 + hardeningModulus / (3.0 * G)) - (1.0 - theta);
  const gEff = G * theta;
  const lamEff = K - (2.0 / 3.0) * gEff;
  const twoGThetaBar = 2.0 * G * thetaBar;

  const Cep = new Float64Array(36);
  // Isotropic elastic part with scaled shear modulus gEff
  Cep[0] = lamEff + 2.0 * gEff;
  Cep[1] = lamEff;
  Cep[2] = lamEff;
  Cep[6] = lamEff;
  Cep[7] = lamEff + 2.0 * gEff;
  Cep[8] = lamEff;
  Cep[12] = lamEff;
  Cep[13] = lamEff;
  Cep[14] = lamEff + 2.0 * gEff;
  Cep[21] = gEff;
  Cep[28] = gEff;
  Cep[35] = gEff;

  // Subtract rank-1 plastic flow correction: 2 G thetaBar (n x n)
  for (let i = 0; i < 6; i++) {
    const ni = nVec[i]!;
    for (let j = 0; j < 6; j++) {
      Cep[i * 6 + j] = Cep[i * 6 + j]! - twoGThetaBar * ni * nVec[j]!;
    }
  }

  return {
    stress,
    eqPlasticStrain: newEqPlasticStrain,
    deltaPlasticStrain: dGamma,
    vonMisesStress,
    yielded: true,
    plasticStrainIncrement6,
    consistentTangent: Cep,
  };
}
