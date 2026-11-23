// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript constitutive & explicit dynamics runtime for `@modelscript/lsdyna-std-lib`.
 *
 * Implements Hallquist DYNA3D / LS-DYNA material and section kernels using a 2048-byte slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — material/section parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal state (e.g. eps_p, backstress)
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state increments
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — constitutive I/O bus:
 *       IO[0] = axialStrain       IO[1] = axialStress (Pa)
 *       IO[2] = waveSpeed (m/s)   IO[3] = bulkWaveSpeed (m/s)
 *       IO[4] = charLength (m)    IO[5] = cflTimestep (s)
 *       IO[6] = equivalentPlasticStrain
 *       IO[7] = erodedFlag (0 or 1)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_IO: usize = 0x780;

const ARCH_MAT_001: i32 = 1;
const ARCH_MAT_003: i32 = 3;
const ARCH_MAT_020: i32 = 20;
const ARCH_MAT_024: i32 = 24;
const ARCH_SECTION_SOLID: i32 = 101;
const ARCH_SECTION_SHELL: i32 = 102;
const ARCH_SECTION_BEAM: i32 = 103;

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
function getIO(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIO(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * Computes 1D bar longitudinal wave speed c = sqrt(E / rho).
 */
export function lsdynaBarWaveSpeed(e: f64, rho: f64): f64 {
  if (e <= 0.0 || rho <= 0.0) return 0.0;
  return Math.sqrt(e / rho);
}

/**
 * Computes 3D dilatational (P-wave) speed c_d = sqrt(E*(1-nu) / (rho*(1+nu)*(1-2*nu))).
 */
export function lsdynaSolidWaveSpeed(e: f64, rho: f64, nu: f64): f64 {
  if (e <= 0.0 || rho <= 0.0 || nu <= -1.0 || nu >= 0.5) return 0.0;
  const denom = rho * (1.0 + nu) * (1.0 - 2.0 * nu);
  if (denom <= 0.0) return 0.0;
  return Math.sqrt((e * (1.0 - nu)) / denom);
}

/**
 * Computes CFL critical timestep dt_cr = L_e / c.
 */
export function lsdynaCflTimestep(charLength: f64, waveSpeed: f64): f64 {
  if (charLength <= 0.0 || waveSpeed <= 0.0) return 0.0;
  return charLength / waveSpeed;
}

/**
 * Initializes constitutive state variables in a 2048-byte slot.
 */
export function lsdynaConstitutiveInit(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  setState(slotPtr, 0, 0.0); // equivalent plastic strain
  setState(slotPtr, 1, 0.0); // kinematic backstress
  const ro = getCon(slotPtr, conCount, 0, 7850.0);
  const e = getCon(slotPtr, conCount, 1, 2.1e11);
  const pr = getCon(slotPtr, conCount, 2, 0.3);
  if (
    archetypeId == ARCH_MAT_001 ||
    archetypeId == ARCH_MAT_003 ||
    archetypeId == ARCH_MAT_020 ||
    archetypeId == ARCH_MAT_024
  ) {
    setIO(slotPtr, 2, lsdynaBarWaveSpeed(e, ro));
    setIO(slotPtr, 3, lsdynaSolidWaveSpeed(e, ro, pr));
  } else {
    setIO(slotPtr, 2, 0.0);
    setIO(slotPtr, 3, 0.0);
  }
  setIO(slotPtr, 6, 0.0);
  setIO(slotPtr, 7, 0.0);
}

/**
 * Evaluates 1D uniaxial stress-strain response and CFL timestep for the given archetype.
 */
export function lsdynaConstitutiveEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const strain = getIO(slotPtr, 0);
  const charLen = getIO(slotPtr, 4);

  if (archetypeId == ARCH_SECTION_SOLID || archetypeId == ARCH_SECTION_SHELL || archetypeId == ARCH_SECTION_BEAM) {
    // Section archetypes return element formulation metadata in IO[1]
    const elform = getCon(slotPtr, conCount, 0, 1.0);
    setIO(slotPtr, 1, elform);
    return;
  }

  const ro = getCon(slotPtr, conCount, 0, 7850.0);
  const e = getCon(slotPtr, conCount, 1, 2.1e11);
  const pr = getCon(slotPtr, conCount, 2, 0.3);

  const cBar = lsdynaBarWaveSpeed(e, ro);
  const cSolid = lsdynaSolidWaveSpeed(e, ro, pr);
  setIO(slotPtr, 2, cBar);
  setIO(slotPtr, 3, cSolid);
  setIO(slotPtr, 5, charLen > 0.0 ? lsdynaCflTimestep(charLen, cBar) : 0.0);

  if (archetypeId == ARCH_MAT_001) {
    setIO(slotPtr, 1, e * strain);
    return;
  }

  if (archetypeId == ARCH_MAT_020) {
    // Rigid body: zero internal deformation stress
    setIO(slotPtr, 1, 0.0);
    return;
  }

  if (archetypeId == ARCH_MAT_003 || archetypeId == ARCH_MAT_024) {
    const sigy = getCon(slotPtr, conCount, 3, 2.5e8);
    const etan = getCon(slotPtr, conCount, 4, 2.1e9);
    const failStrain = archetypeId == ARCH_MAT_003 ? getCon(slotPtr, conCount, 6, 0.0) : getCon(slotPtr, conCount, 5, 0.0);

    const epsPPrev = getState(slotPtr, 0);
    const trialStress = e * strain;
    const absTrial = Math.abs(trialStress);
    const sign: f64 = trialStress >= 0.0 ? 1.0 : -1.0;

    let stress = trialStress;
    let epsP = epsPPrev;
    if (absTrial > sigy && e > etan) {
      const h = (e * etan) / (e - etan);
      const dEpsP = (absTrial - sigy) / (e + h);
      epsP = epsPPrev + dEpsP;
      stress = sign * (sigy + h * dEpsP);
      setState(slotPtr, 0, epsP);
    }

    if (failStrain > 0.0 && epsP >= failStrain) {
      setIO(slotPtr, 1, 0.0);
      setIO(slotPtr, 6, epsP);
      setIO(slotPtr, 7, 1.0);
    } else {
      setIO(slotPtr, 1, stress);
      setIO(slotPtr, 6, epsP);
      setIO(slotPtr, 7, 0.0);
    }
  }
}
