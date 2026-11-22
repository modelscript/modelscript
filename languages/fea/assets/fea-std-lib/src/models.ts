// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript constitutive & element evaluation runtime for `@modelscript/fea-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — material / section / element parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal state variables (plastic/creep strains)
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state increments / rates & 3D aux outputs:
 *       DSTATE[0] = dGamma (plastic multiplier) or creepRate
 *       DSTATE[1] = tau23 (3D out-of-plane shear stress, Pa)
 *       DSTATE[2] = tau13 (3D out-of-plane shear stress, Pa)
 *       DSTATE[3] = shearStiffness (Mindlin-Reissner G*ks*t) or consistent elastoplastic shear modulus mu_ep
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — constitutive & structural I/O bus:
 *       Inputs:
 *         IO[0] = eps11, IO[1] = eps22, IO[2] = eps33,
 *         IO[3] = gamma12, IO[4] = gamma23, IO[5] = gamma13,
 *         IO[6] = tempC, IO[7] = dtSec
 *       Outputs:
 *         IO[8] = sig11, IO[9] = sig22, IO[10] = sig33, IO[11] = tau12,
 *         IO[12] = vonMises, IO[13] = strainEnergy,
 *         IO[14] = aux1 (lambda / eqPlasticStrain / creepRate / Q11 / A11 / epsTh / rho / kEff),
 *         IO[15] = aux2 (mu / tangentModulus / eqCreepStrain / Q22 / A22 / K0 / D_flex)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `FeaArchetypeId` in fea-std-schemas.ts)
const ARCH_SOLID_TET: i32 = 1;
const ARCH_SOLID_HEX: i32 = 2;
const ARCH_SHELL_ELEM: i32 = 3;
const ARCH_BEAM_ELEM: i32 = 4;
const ARCH_MPC_CONSTRAINT: i32 = 5;

const ARCH_MAT_ISOTROPIC: i32 = 10;
const ARCH_MAT_ORTHOTROPIC: i32 = 11;
const ARCH_MAT_ANISOTROPIC: i32 = 12;
const ARCH_MAT_PLASTIC_J2: i32 = 20;
const ARCH_MAT_HYPER_NEO_HOOKE: i32 = 30;
const ARCH_MAT_HYPER_MOONEY_RIVLIN: i32 = 31;
const ARCH_MAT_CREEP_NORTON: i32 = 40;
const ARCH_MAT_DENSITY: i32 = 50;
const ARCH_MAT_EXPANSION: i32 = 51;

const ARCH_SEC_LAMINATE: i32 = 60;
const ARCH_SEC_SHELL: i32 = 61;
const ARCH_SEC_SOLID: i32 = 62;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

@inline
function computeVonMises(
  s11: f64,
  s22: f64,
  s33: f64,
  t12: f64,
  t23: f64,
  t13: f64,
): f64 {
  const d12 = s11 - s22;
  const d23 = s22 - s33;
  const d31 = s33 - s11;
  const j2Term = 0.5 * (d12 * d12 + d23 * d23 + d31 * d31) + 3.0 * (t12 * t12 + t23 * t23 + t13 * t13);
  return j2Term > 0.0 ? Math.sqrt(j2Term) : 0.0;
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function feaGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes internal state variables for an FEA archetype slot.
 * Returns the number of active internal state variables.
 */
export function feaModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  // Zero state and dstate buffers
  for (let i = 0; i < 16; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_MAT_PLASTIC_J2) {
    // STATE[0] = eqPlasticStrain, STATE[1..6] = plastic strain tensor
    return 7;
  }

  if (archetypeId == ARCH_MAT_CREEP_NORTON) {
    // STATE[0] = eqCreepStrain, STATE[1] = elapsedTime
    return 2;
  }

  if (archetypeId == ARCH_MAT_ISOTROPIC || archetypeId == ARCH_SEC_SOLID) {
    const E = Math.max(1.0, getCon(slotPtr, conCount, 0, 210e9));
    const nu = Math.min(0.499, Math.max(-0.99, getCon(slotPtr, conCount, 1, 0.3)));
    const mu = E / (2.0 * (1.0 + nu));
    const lam = (E * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
    setState(slotPtr, 0, lam);
    setState(slotPtr, 1, mu);
    return 2;
  }

  if (archetypeId == ARCH_MAT_ORTHOTROPIC || archetypeId == ARCH_SEC_LAMINATE) {
    const E1 = Math.max(1.0, getCon(slotPtr, conCount, 0, 140e9));
    const E2 = Math.max(1.0, getCon(slotPtr, conCount, 1, 10e9));
    const nu12 = getCon(slotPtr, conCount, 2, 0.3);
    const nu21 = nu12 * (E2 / E1);
    const denom = Math.max(1e-9, 1.0 - nu12 * nu21);
    setState(slotPtr, 0, E1 / denom); // Q11
    setState(slotPtr, 1, E2 / denom); // Q22
    setState(slotPtr, 2, (nu12 * E2) / denom); // Q12
    return 3;
  }

  return 0;
}

/**
 * Evaluates constitutive stress-strain law or element/section stiffness metrics for a single slot.
 * Returns 0 on success, non-zero on unknown archetype.
 */
export function feaModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const e11 = getIo(slotPtr, 0);
  const e22 = getIo(slotPtr, 1);
  const e33 = getIo(slotPtr, 2);
  const g12 = getIo(slotPtr, 3);
  const g23 = getIo(slotPtr, 4);
  const g13 = getIo(slotPtr, 5);
  const tempC = getIo(slotPtr, 6);
  const dtSec = Math.max(0.0, getIo(slotPtr, 7));

  // 1. 3D Isotropic Hooke's Law & Lamé Constants (MAT1_ISOTROPIC, ABQ_ELASTIC, PSOLID_SECTION)
  if (archetypeId == ARCH_MAT_ISOTROPIC || archetypeId == ARCH_SEC_SOLID) {
    const E = Math.max(1.0, getCon(slotPtr, conCount, 0, 210e9));
    const nu = Math.min(0.499, Math.max(-0.99, getCon(slotPtr, conCount, 1, 0.3)));
    const mu = E / (2.0 * (1.0 + nu));
    const lam = (E * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
    const theta = e11 + e22 + e33;

    const s11 = lam * theta + 2.0 * mu * e11;
    const s22 = lam * theta + 2.0 * mu * e22;
    const s33 = lam * theta + 2.0 * mu * e33;
    const t12 = mu * g12;
    const t23 = mu * g23;
    const t13 = mu * g13;
    const vm = computeVonMises(s11, s22, s33, t12, t23, t13);
    const w = 0.5 * (s11 * e11 + s22 * e22 + s33 * e33 + t12 * g12 + t23 * g23 + t13 * g13);

    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, s22);
    setIo(slotPtr, 10, s33);
    setIo(slotPtr, 11, t12);
    setIo(slotPtr, 12, vm);
    setIo(slotPtr, 13, w);
    setIo(slotPtr, 14, lam);
    setIo(slotPtr, 15, mu);
    setDState(slotPtr, 1, t23);
    setDState(slotPtr, 2, t13);
    return 0;
  }

  // 2. Full 3D 6-Component Voigt J2 von Mises Plasticity with Linear Isotropic Hardening & Radial Return (ABQ_PLASTIC_J2)
  if (archetypeId == ARCH_MAT_PLASTIC_J2) {
    const E = Math.max(1.0, getCon(slotPtr, conCount, 0, 210e9));
    const nu = Math.min(0.499, Math.max(-0.99, getCon(slotPtr, conCount, 1, 0.3)));
    const sigY0 = Math.max(1.0, getCon(slotPtr, conCount, 2, 250e6));
    const H = Math.max(0.0, getCon(slotPtr, conCount, 3, 2e9));

    const mu = E / (2.0 * (1.0 + nu));
    const lam = (E * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));

    const epBarOld = getState(slotPtr, 0);
    const ep11Old = getState(slotPtr, 1);
    const ep22Old = getState(slotPtr, 2);
    const ep33Old = getState(slotPtr, 3);
    const gp12Old = getState(slotPtr, 4);
    const gp23Old = getState(slotPtr, 5);
    const gp13Old = getState(slotPtr, 6);

    // 6-component Voigt elastic trial strain [e11, e22, e33, g12, g23, g13]
    const ee11 = e11 - ep11Old;
    const ee22 = e22 - ep22Old;
    const ee33 = e33 - ep33Old;
    const ge12 = g12 - gp12Old;
    const ge23 = g23 - gp23Old;
    const ge13 = g13 - gp13Old;

    const theta = ee11 + ee22 + ee33;
    const s11Trial = lam * theta + 2.0 * mu * ee11;
    const s22Trial = lam * theta + 2.0 * mu * ee22;
    const s33Trial = lam * theta + 2.0 * mu * ee33;
    const t12Trial = mu * ge12;
    const t23Trial = mu * ge23;
    const t13Trial = mu * ge13;

    // Hydrostatic pressure & deviatoric trial stress projection
    const p = (s11Trial + s22Trial + s33Trial) / 3.0;
    const dev11 = s11Trial - p;
    const dev22 = s22Trial - p;
    const dev33 = s33Trial - p;

    let s11 = s11Trial;
    let s22 = s22Trial;
    let s33 = s33Trial;
    let t12 = t12Trial;
    let t23 = t23Trial;
    let t13 = t13Trial;

    const qTrial = computeVonMises(s11Trial, s22Trial, s33Trial, t12Trial, t23Trial, t13Trial);
    const sigYCurrent = sigY0 + H * epBarOld;
    const fTrial = qTrial - sigYCurrent;

    let epBarNew = epBarOld;
    let dGamma = 0.0;
    let vm = qTrial;
    let tangentMod = E;
    let muConsistent = mu;

    if (fTrial > 0.0 && qTrial > 1e-12) {
      dGamma = fTrial / (3.0 * mu + H);
      epBarNew = epBarOld + dGamma;
      const scale = 1.0 - (3.0 * mu * dGamma) / qTrial;

      // Exact radial return on all 6 Voigt stress components
      s11 = p + scale * dev11;
      s22 = p + scale * dev22;
      s33 = p + scale * dev33;
      t12 = scale * t12Trial;
      t23 = scale * t23Trial;
      t13 = scale * t13Trial;

      // Associated J2 plastic flow rule in Voigt engineering shear convention (gamma_p = 2 * eps_p)
      const flowFactor = (1.5 * dGamma) / qTrial;
      setState(slotPtr, 0, epBarNew);
      setState(slotPtr, 1, ep11Old + flowFactor * dev11);
      setState(slotPtr, 2, ep22Old + flowFactor * dev22);
      setState(slotPtr, 3, ep33Old + flowFactor * dev33);
      setState(slotPtr, 4, gp12Old + 2.0 * flowFactor * t12Trial);
      setState(slotPtr, 5, gp23Old + 2.0 * flowFactor * t23Trial);
      setState(slotPtr, 6, gp13Old + 2.0 * flowFactor * t13Trial);
      setDState(slotPtr, 0, dGamma);

      vm = computeVonMises(s11, s22, s33, t12, t23, t13);
      // Consistent 1D elastoplastic tangent modulus E_ep and deviatoric shear tangent mu_ep
      tangentMod = (E * H) / (E + H);
      muConsistent = (mu * H) / (3.0 * mu + H);
    } else {
      setDState(slotPtr, 0, 0.0);
    }

    const ee11New = e11 - getState(slotPtr, 1);
    const ee22New = e22 - getState(slotPtr, 2);
    const ee33New = e33 - getState(slotPtr, 3);
    const ge12New = g12 - getState(slotPtr, 4);
    const ge23New = g23 - getState(slotPtr, 5);
    const ge13New = g13 - getState(slotPtr, 6);
    const wEl =
      0.5 *
      (s11 * ee11New +
        s22 * ee22New +
        s33 * ee33New +
        t12 * ge12New +
        t23 * ge23New +
        t13 * ge13New);

    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, s22);
    setIo(slotPtr, 10, s33);
    setIo(slotPtr, 11, t12);
    setIo(slotPtr, 12, vm);
    setIo(slotPtr, 13, wEl);
    setIo(slotPtr, 14, epBarNew);
    setIo(slotPtr, 15, tangentMod);
    setDState(slotPtr, 1, t23);
    setDState(slotPtr, 2, t13);
    setDState(slotPtr, 3, muConsistent);
    return 0;
  }

  // 3. Neo-Hookean Hyperelasticity (ABQ_HYPERELASTIC_NEO_HOOKE)
  if (archetypeId == ARCH_MAT_HYPER_NEO_HOOKE) {
    const c10 = Math.max(1.0, getCon(slotPtr, conCount, 0, 0.5e6));
    const d1 = Math.max(0.0, getCon(slotPtr, conCount, 1, 1e-8));
    const stretch = Math.max(0.1, 1.0 + e11);
    const stretch2 = stretch * stretch;
    const invStretch = 1.0 / stretch;

    const s11 = 2.0 * c10 * (stretch2 - invStretch);
    const i1 = stretch2 + 2.0 * invStretch;
    const w = c10 * (i1 - 3.0);
    const mu0 = 2.0 * c10;
    const k0 = d1 > 1e-20 ? 2.0 / d1 : 0.0;

    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, Math.abs(s11));
    setIo(slotPtr, 13, w);
    setIo(slotPtr, 14, mu0);
    setIo(slotPtr, 15, k0);
    return 0;
  }

  // 4. Mooney-Rivlin Hyperelasticity (ABQ_HYPERELASTIC_MOONEY_RIVLIN)
  if (archetypeId == ARCH_MAT_HYPER_MOONEY_RIVLIN) {
    const c10 = getCon(slotPtr, conCount, 0, 0.4e6);
    const c01 = getCon(slotPtr, conCount, 1, 0.1e6);
    const d1 = Math.max(0.0, getCon(slotPtr, conCount, 2, 1e-8));
    const stretch = Math.max(0.1, 1.0 + e11);
    const stretch2 = stretch * stretch;
    const invStretch = 1.0 / stretch;
    const invStretch2 = invStretch * invStretch;

    const s11 = 2.0 * (c10 + c01 * invStretch) * (stretch2 - invStretch);
    const i1 = stretch2 + 2.0 * invStretch;
    const i2 = 2.0 * stretch + invStretch2;
    const w = c10 * (i1 - 3.0) + c01 * (i2 - 3.0);
    const mu0 = 2.0 * (c10 + c01);
    const k0 = d1 > 1e-20 ? 2.0 / d1 : 0.0;

    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, Math.abs(s11));
    setIo(slotPtr, 13, w);
    setIo(slotPtr, 14, mu0);
    setIo(slotPtr, 15, k0);
    return 0;
  }

  // 5. Norton Power-Law Creep (ABQ_CREEP_NORTON): d(eps_c)/dt = A * sigma_eq^n * t^m
  if (archetypeId == ARCH_MAT_CREEP_NORTON) {
    const A = Math.max(0.0, getCon(slotPtr, conCount, 0, 1e-36));
    const n = getCon(slotPtr, conCount, 1, 4.0);
    const m = getCon(slotPtr, conCount, 2, 0.0);
    const E = Math.max(1.0, getCon(slotPtr, conCount, 3, 200e9));
    const nu = Math.min(0.499, Math.max(-0.99, getCon(slotPtr, conCount, 4, 0.3)));

    const mu = E / (2.0 * (1.0 + nu));
    const lam = (E * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
    const theta = e11 + e22 + e33;

    const s11 = lam * theta + 2.0 * mu * e11;
    const s22 = lam * theta + 2.0 * mu * e22;
    const s33 = lam * theta + 2.0 * mu * e33;
    const t12 = mu * g12;
    const t23 = mu * g23;
    const t13 = mu * g13;
    const vm = computeVonMises(s11, s22, s33, t12, t23, t13);

    const tOld = getState(slotPtr, 1);
    const tNew = tOld + dtSec;
    const timeFactor = m == 0.0 ? 1.0 : Math.pow(Math.max(1e-6, tNew), m);
    const creepRate = vm > 0.0 ? A * Math.pow(vm, n) * timeFactor : 0.0;
    const eqCreepNew = getState(slotPtr, 0) + creepRate * dtSec;

    setState(slotPtr, 0, eqCreepNew);
    setState(slotPtr, 1, tNew);
    setDState(slotPtr, 0, creepRate);

    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, s22);
    setIo(slotPtr, 10, s33);
    setIo(slotPtr, 11, t12);
    setIo(slotPtr, 12, vm);
    setIo(slotPtr, 13, 0.5 * (s11 * e11 + s22 * e22 + s33 * e33 + t12 * g12));
    setIo(slotPtr, 14, creepRate);
    setIo(slotPtr, 15, eqCreepNew);
    return 0;
  }

  // 6. Orthotropic Plane-Stress Lamina (MAT8_ORTHOTROPIC) & CLT Laminate (PCOMP_LAMINATE)
  if (archetypeId == ARCH_MAT_ORTHOTROPIC || archetypeId == ARCH_SEC_LAMINATE) {
    const E1 = Math.max(1.0, getCon(slotPtr, conCount, 0, 140e9));
    const E2 = Math.max(1.0, getCon(slotPtr, conCount, 1, 10e9));
    const nu12 = getCon(slotPtr, conCount, 2, 0.3);
    const G12 = Math.max(1.0, getCon(slotPtr, conCount, 3, 5e9));

    const nu21 = nu12 * (E2 / E1);
    const denom = Math.max(1e-9, 1.0 - nu12 * nu21);
    const q11 = E1 / denom;
    const q22 = E2 / denom;
    const q12 = (nu12 * E2) / denom;
    const q66 = G12;

    if (archetypeId == ARCH_MAT_ORTHOTROPIC) {
      const s11 = q11 * e11 + q12 * e22;
      const s22 = q12 * e11 + q22 * e22;
      const t12 = q66 * g12;
      const vm = computeVonMises(s11, s22, 0.0, t12, 0.0, 0.0);
      const w = 0.5 * (s11 * e11 + s22 * e22 + t12 * g12);

      setIo(slotPtr, 8, s11);
      setIo(slotPtr, 9, s22);
      setIo(slotPtr, 10, 0.0);
      setIo(slotPtr, 11, t12);
      setIo(slotPtr, 12, vm);
      setIo(slotPtr, 13, w);
      setIo(slotPtr, 14, q11);
      setIo(slotPtr, 15, q22);
      return 0;
    }

    // Classical Laminate Theory (PCOMP_LAMINATE) transformed reduced stiffness Q_bar and [A]
    const tPly = Math.max(1e-7, getCon(slotPtr, conCount, 4, 0.000125));
    const angleRad = getCon(slotPtr, conCount, 5, 0.0) * (Math.PI / 180.0);
    const nPlies = Math.max(1.0, getCon(slotPtr, conCount, 6, 8.0));
    const hTotal = tPly * nPlies;

    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);
    const c2 = c * c;
    const s2 = s * s;
    const c4 = c2 * c2;
    const s4 = s2 * s2;
    const c2s2 = c2 * s2;

    const qb11 = q11 * c4 + 2.0 * (q12 + 2.0 * q66) * c2s2 + q22 * s4;
    const qb22 = q11 * s4 + 2.0 * (q12 + 2.0 * q66) * c2s2 + q22 * c4;
    const qb12 = (q11 + q22 - 4.0 * q66) * c2s2 + q12 * (c4 + s4);
    const qb66 = (q11 + q22 - 2.0 * q12 - 2.0 * q66) * c2s2 + q66 * (c4 + s4);

    const s11 = qb11 * e11 + qb12 * e22;
    const s22 = qb12 * e11 + qb22 * e22;
    const t12 = qb66 * g12;
    const vm = computeVonMises(s11, s22, 0.0, t12, 0.0, 0.0);
    const w = 0.5 * (s11 * e11 + s22 * e22 + t12 * g12);

    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, s22);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, t12);
    setIo(slotPtr, 12, vm);
    setIo(slotPtr, 13, w);
    setIo(slotPtr, 14, qb11 * hTotal); // A11 (N/m)
    setIo(slotPtr, 15, qb22 * hTotal); // A22 (N/m)
    return 0;
  }

  // 7. 3D Anisotropic Material (MAT9_ANISOTROPIC)
  if (archetypeId == ARCH_MAT_ANISOTROPIC) {
    const c11 = getCon(slotPtr, conCount, 0, 160e9);
    const c12 = getCon(slotPtr, conCount, 1, 60e9);
    const c13 = getCon(slotPtr, conCount, 2, 60e9);
    const c22 = getCon(slotPtr, conCount, 3, 160e9);
    const c23 = getCon(slotPtr, conCount, 4, 60e9);
    const c33 = getCon(slotPtr, conCount, 5, 160e9);
    const c44 = getCon(slotPtr, conCount, 6, 50e9);
    const c55 = getCon(slotPtr, conCount, 7, 50e9);
    const c66 = getCon(slotPtr, conCount, 8, 50e9);

    const s11 = c11 * e11 + c12 * e22 + c13 * e33;
    const s22 = c12 * e11 + c22 * e22 + c23 * e33;
    const s33 = c13 * e11 + c23 * e22 + c33 * e33;
    const t12 = c44 * g12;
    const t23 = c55 * g23;
    const t13 = c66 * g13;
    const vm = computeVonMises(s11, s22, s33, t12, t23, t13);
    const w = 0.5 * (s11 * e11 + s22 * e22 + s33 * e33 + t12 * g12 + t23 * g23 + t13 * g13);

    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, s22);
    setIo(slotPtr, 10, s33);
    setIo(slotPtr, 11, t12);
    setIo(slotPtr, 12, vm);
    setIo(slotPtr, 13, w);
    setIo(slotPtr, 14, c11);
    setIo(slotPtr, 15, c44);
    return 0;
  }

  // 8. Thermal Expansion (ABQ_EXPANSION)
  if (archetypeId == ARCH_MAT_EXPANSION) {
    const alpha = getCon(slotPtr, conCount, 0, 1.2e-5);
    const tRef = getCon(slotPtr, conCount, 1, 20.0);
    const epsTh = alpha * (tempC - tRef);
    setIo(slotPtr, 8, 0.0);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, 0.0);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, epsTh);
    setIo(slotPtr, 15, alpha);
    return 0;
  }

  // 9. Mass Density (ABQ_DENSITY)
  if (archetypeId == ARCH_MAT_DENSITY) {
    const rho = Math.max(0.0, getCon(slotPtr, conCount, 0, 7850.0));
    setIo(slotPtr, 8, 0.0);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, 0.0);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, rho);
    setIo(slotPtr, 15, 0.0);
    return 0;
  }

  // 10. Structural Elements & Shell Section
  if (archetypeId == ARCH_SOLID_TET || archetypeId == ARCH_SOLID_HEX) {
    const E = Math.max(1.0, getCon(slotPtr, conCount, 3, 210e9));
    const nu = Math.min(0.499, Math.max(-0.99, getCon(slotPtr, conCount, 4, 0.3)));
    const mu = E / (2.0 * (1.0 + nu));
    const lam = (E * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
    const theta = e11 + e22 + e33;
    const s11 = lam * theta + 2.0 * mu * e11;
    const s22 = lam * theta + 2.0 * mu * e22;
    const s33 = lam * theta + 2.0 * mu * e33;
    const t12 = mu * g12;
    const vm = computeVonMises(s11, s22, s33, t12, 0.0, 0.0);
    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, s22);
    setIo(slotPtr, 10, s33);
    setIo(slotPtr, 11, t12);
    setIo(slotPtr, 12, vm);
    setIo(slotPtr, 13, 0.5 * (s11 * e11 + s22 * e22 + s33 * e33 + t12 * g12));
    setIo(slotPtr, 14, lam);
    setIo(slotPtr, 15, mu);
    return 0;
  }

  if (archetypeId == ARCH_SHELL_ELEM || archetypeId == ARCH_SEC_SHELL) {
    // MITC4 / Mindlin-Reissner shell element: membrane + bending rigidity D + transverse shear stiffness G * ks * t
    const t = Math.max(
      1e-9,
      archetypeId == ARCH_SEC_SHELL ? getCon(slotPtr, conCount, 0, 0.01) : getCon(slotPtr, conCount, 1, 0.01),
    );
    const E = Math.max(
      1.0,
      archetypeId == ARCH_SEC_SHELL ? getCon(slotPtr, conCount, 1, 210e9) : getCon(slotPtr, conCount, 2, 210e9),
    );
    const nu = Math.min(
      0.499,
      Math.max(
        -0.99,
        archetypeId == ARCH_SEC_SHELL ? getCon(slotPtr, conCount, 2, 0.3) : getCon(slotPtr, conCount, 3, 0.3),
      ),
    );
    const ks = Math.max(
      1e-6,
      archetypeId == ARCH_SEC_SHELL
        ? getCon(slotPtr, conCount, 3, 5.0 / 6.0)
        : getCon(slotPtr, conCount, 4, 5.0 / 6.0),
    );

    const denom = Math.max(1e-9, 1.0 - nu * nu);
    const G = E / (2.0 * (1.0 + nu));
    const s11 = (E / denom) * (e11 + nu * e22);
    const s22 = (E / denom) * (e22 + nu * e11);
    const t12 = G * g12;
    const t23 = G * ks * g23;
    const t13 = G * ks * g13;
    const dFlex = (E * t * t * t) / (12.0 * denom);
    const shearStiff = G * ks * t;
    const w = 0.5 * (s11 * e11 + s22 * e22 + t12 * g12 + t23 * g23 + t13 * g13);

    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, s22);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, t12);
    setIo(slotPtr, 12, computeVonMises(s11, s22, 0.0, t12, t23, t13));
    setIo(slotPtr, 13, w);
    setIo(slotPtr, 14, (E * t) / denom); // Membrane stiffness E*t/(1-nu^2)
    setIo(slotPtr, 15, dFlex); // Mindlin-Reissner flexural rigidity D = E*t^3/(12*(1-nu^2))
    setDState(slotPtr, 1, t23);
    setDState(slotPtr, 2, t13);
    setDState(slotPtr, 3, shearStiff); // Mindlin-Reissner transverse shear stiffness G*ks*t
    return 0;
  }

  if (archetypeId == ARCH_BEAM_ELEM) {
    const area = Math.max(1e-9, getCon(slotPtr, conCount, 0, 1e-3));
    const Iyy = Math.max(1e-12, getCon(slotPtr, conCount, 1, 8.33e-8));
    const E = Math.max(1.0, getCon(slotPtr, conCount, 4, 210e9));
    const length = Math.max(1e-6, getCon(slotPtr, conCount, 6, 1.0));
    const s11 = E * e11;
    setIo(slotPtr, 8, s11);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, Math.abs(s11));
    setIo(slotPtr, 13, 0.5 * s11 * e11);
    setIo(slotPtr, 14, (E * area) / length); // Axial stiffness EA/L
    setIo(slotPtr, 15, E * Iyy); // Bending rigidity EI
    return 0;
  }

  if (archetypeId == ARCH_MPC_CONSTRAINT) {
    const penalty = getCon(slotPtr, conCount, 2, 1e14);
    setIo(slotPtr, 8, 0.0);
    setIo(slotPtr, 9, 0.0);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, 0.0);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, penalty);
    setIo(slotPtr, 15, getCon(slotPtr, conCount, 0, 6.0));
    return 0;
  }

  return -1;
}
