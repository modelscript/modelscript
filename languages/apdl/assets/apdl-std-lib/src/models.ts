// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript structural element evaluation runtime for `@modelscript/apdl-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — element & material parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal state variables
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — element I/O bus:
 *       Inputs:
 *         IO[0] = primary displacement / strain (du or eps11)
 *         IO[1] = secondary displacement / strain (dv or eps22)
 *         IO[2] = velocity / shear strain (v or gamma12)
 *         IO[3] = applied force / load P
 *       Outputs:
 *         IO[8]  = primary stiffness (kAxial, kBend, D_flex, or K_spring)
 *         IO[9]  = primary force / stress (N, sigma, or F_spring)
 *         IO[10] = strain energy (0.5 * k * u^2)
 *         IO[11] = element mass (kg)
 *         IO[12] = auxiliary metric (shear modulus G, flexural rigidity EI, or damping force)
 */

const OFF_CON: usize = 0x080;
const OFF_IO: usize = 0x780;

const ARCH_LINK180: i32 = 1;
const ARCH_BEAM188: i32 = 2;
const ARCH_PLANE182: i32 = 3;
const ARCH_SHELL181: i32 = 4;
const ARCH_SOLID185: i32 = 5;
const ARCH_MASS21: i32 = 6;
const ARCH_COMBIN14: i32 = 7;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * Evaluates a single APDL element archetype in-place within its 2048-byte linear memory slot.
 */
export function evalElement(slotPtr: usize, archetypeId: i32, conCount: i32): i32 {
  const u0 = getIo(slotPtr, 0);
  const u1 = getIo(slotPtr, 1);
  const v0 = getIo(slotPtr, 2);

  if (archetypeId == ARCH_LINK180) {
    // CON: [EX, A, L, DENS]
    const E = getCon(slotPtr, conCount, 0, 2.1e11);
    const A = getCon(slotPtr, conCount, 1, 1e-4);
    const L = Math.max(getCon(slotPtr, conCount, 2, 1.0), 1e-12);
    const rho = getCon(slotPtr, conCount, 3, 7850.0);
    const kAxial = (E * A) / L;
    const force = kAxial * u0;
    const energy = 0.5 * kAxial * u0 * u0;
    const mass = rho * A * L;
    const stress = A > 0.0 ? force / A : 0.0;
    setIo(slotPtr, 8, kAxial);
    setIo(slotPtr, 9, force);
    setIo(slotPtr, 10, energy);
    setIo(slotPtr, 11, mass);
    setIo(slotPtr, 12, stress);
    return 0;
  }

  if (archetypeId == ARCH_BEAM188) {
    // CON: [EX, PRXY, A, IZZ, IYY, J, L, DENS]
    const E = getCon(slotPtr, conCount, 0, 2.1e11);
    const nu = getCon(slotPtr, conCount, 1, 0.3);
    const A = getCon(slotPtr, conCount, 2, 1e-3);
    const Izz = getCon(slotPtr, conCount, 3, 8.3333333333e-8);
    const L = Math.max(getCon(slotPtr, conCount, 6, 1.0), 1e-12);
    const rho = getCon(slotPtr, conCount, 7, 7850.0);
    const kBend = (12.0 * E * Izz) / (L * L * L);
    const shearForce = kBend * u0;
    const energy = 0.5 * kBend * u0 * u0;
    const mass = rho * A * L;
    const G = E / (2.0 * (1.0 + nu));
    setIo(slotPtr, 8, kBend);
    setIo(slotPtr, 9, shearForce);
    setIo(slotPtr, 10, energy);
    setIo(slotPtr, 11, mass);
    setIo(slotPtr, 12, G);
    return 0;
  }

  if (archetypeId == ARCH_PLANE182) {
    // CON: [EX, PRXY, THICK, DENS]
    const E = getCon(slotPtr, conCount, 0, 2.1e11);
    const nu = getCon(slotPtr, conCount, 1, 0.3);
    const t = getCon(slotPtr, conCount, 2, 0.01);
    const rho = getCon(slotPtr, conCount, 3, 7850.0);
    const denom = Math.max(1.0 - nu * nu, 1e-9);
    const c11 = E / denom;
    const sig11 = c11 * (u0 + nu * u1);
    const sig22 = c11 * (nu * u0 + u1);
    const energy = 0.5 * (sig11 * u0 + sig22 * u1) * t;
    setIo(slotPtr, 8, c11);
    setIo(slotPtr, 9, sig11);
    setIo(slotPtr, 10, energy);
    setIo(slotPtr, 11, rho * t);
    setIo(slotPtr, 12, E / (2.0 * (1.0 + nu)));
    return 0;
  }

  if (archetypeId == ARCH_SHELL181) {
    // CON: [EX, PRXY, THICK, DENS]
    const E = getCon(slotPtr, conCount, 0, 2.1e11);
    const nu = getCon(slotPtr, conCount, 1, 0.3);
    const t = getCon(slotPtr, conCount, 2, 0.005);
    const rho = getCon(slotPtr, conCount, 3, 7850.0);
    const denom = Math.max(1.0 - nu * nu, 1e-9);
    const dFlex = (E * t * t * t) / (12.0 * denom);
    const moment = dFlex * u0;
    const energy = 0.5 * dFlex * u0 * u0;
    setIo(slotPtr, 8, dFlex);
    setIo(slotPtr, 9, moment);
    setIo(slotPtr, 10, energy);
    setIo(slotPtr, 11, rho * t);
    setIo(slotPtr, 12, (E * t) / denom);
    return 0;
  }

  if (archetypeId == ARCH_SOLID185) {
    // CON: [EX, PRXY, DENS]
    const E = getCon(slotPtr, conCount, 0, 2.1e11);
    const nu = getCon(slotPtr, conCount, 1, 0.3);
    const rho = getCon(slotPtr, conCount, 2, 7850.0);
    const mu = E / (2.0 * (1.0 + nu));
    const lam = (E * nu) / Math.max((1.0 + nu) * (1.0 - 2.0 * nu), 1e-9);
    const sig11 = (lam + 2.0 * mu) * u0 + lam * u1;
    const energy = 0.5 * sig11 * u0;
    setIo(slotPtr, 8, lam + 2.0 * mu);
    setIo(slotPtr, 9, sig11);
    setIo(slotPtr, 10, energy);
    setIo(slotPtr, 11, rho);
    setIo(slotPtr, 12, mu);
    return 0;
  }

  if (archetypeId == ARCH_MASS21) {
    // CON: [MASS, IXX, IYY, IZZ]
    const m = getCon(slotPtr, conCount, 0, 1.0);
    const kinetic = 0.5 * m * v0 * v0;
    setIo(slotPtr, 8, 0.0);
    setIo(slotPtr, 9, m * u0);
    setIo(slotPtr, 10, kinetic);
    setIo(slotPtr, 11, m);
    setIo(slotPtr, 12, getCon(slotPtr, conCount, 3, 0.0));
    return 0;
  }

  if (archetypeId == ARCH_COMBIN14) {
    // CON: [K, CV1]
    const k = getCon(slotPtr, conCount, 0, 1e5);
    const c = getCon(slotPtr, conCount, 1, 10.0);
    const fSpring = k * u0;
    const fDamp = c * v0;
    const energy = 0.5 * k * u0 * u0;
    setIo(slotPtr, 8, k);
    setIo(slotPtr, 9, fSpring + fDamp);
    setIo(slotPtr, 10, energy);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, fDamp);
    return 0;
  }

  return -1;
}
