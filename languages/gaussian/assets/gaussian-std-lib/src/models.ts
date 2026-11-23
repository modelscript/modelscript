// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript quantum chemistry method & basis set runtime for
 * `@modelscript/gaussian-std-lib`.
 *
 * Implements zero-GC slot evaluation for:
 *  - Quantum chemistry methods: HF (1), MP2 (2), CCSD(T) (3), B3LYP (4), PBE0 (5), M06-2X (6)
 *  - Basis sets: STO-3G (101), 3-21G (102), 6-31G(d) (103), 6-311++G(d,p) (104),
 *                cc-pVDZ (105), cc-pVTZ (106)
 *
 * 256-byte aligned slot layout:
 *  - `0x00..0x3F`: CON[8] (`f64`) — model parameters
 *  - `0x40..0x7F`: IN[8]  (`f64`) — inputs (nHydrogen, nHeavy, rawZpeKcalMol, nBasisOverride)
 *  - `0x80..0xBF`: OUT[8] (`f64`) — outputs (basisCount, scaledZpe, costMetric, hfExchange)
 */

const OFF_CON: usize = 0x00;
const OFF_IN: usize = 0x40;
const OFF_OUT: usize = 0x80;

const ARCH_HF: i32 = 1;
const ARCH_MP2: i32 = 2;
const ARCH_CCSD_T: i32 = 3;
const ARCH_B3LYP: i32 = 4;
const ARCH_PBE0: i32 = 5;
const ARCH_M06_2X: i32 = 6;

const ARCH_STO_3G: i32 = 101;
const ARCH_3_21G: i32 = 102;
const ARCH_6_31G_D: i32 = 103;
const ARCH_6_311PP_G_DP: i32 = 104;
const ARCH_CC_PVDZ: i32 = 105;
const ARCH_CC_PVTZ: i32 = 106;

@inline
function getCon(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
}

@inline
function getIn(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IN + (<usize>idx << 3));
}

@inline
function setOut(slotPtr: usize, idx: i32, val: f64): void {
  store<f64>(slotPtr + OFF_OUT + (<usize>idx << 3), val);
}

/**
 * Returns the default ZPE harmonic frequency scaling factor for a method archetype.
 */
export function gaussianMethodZpeScale(archetypeId: i32): f64 {
  switch (archetypeId) {
    case ARCH_HF:
      return 0.8953;
    case ARCH_MP2:
      return 0.967;
    case ARCH_CCSD_T:
      return 0.975;
    case ARCH_B3LYP:
      return 0.9614;
    case ARCH_PBE0:
      return 0.9512;
    case ARCH_M06_2X:
      return 0.947;
    default:
      return 1.0;
  }
}

/**
 * Returns the formal asymptotic scaling exponent k in O(N^k) for a method archetype.
 */
export function gaussianMethodScalingOrder(archetypeId: i32): f64 {
  switch (archetypeId) {
    case ARCH_HF:
      return 4.0;
    case ARCH_MP2:
      return 5.0;
    case ARCH_CCSD_T:
      return 7.0;
    case ARCH_B3LYP:
    case ARCH_PBE0:
    case ARCH_M06_2X:
      return 3.0;
    default:
      return 3.0;
  }
}

/**
 * Computes contracted basis function count for a molecule with `nHydrogen` H atoms
 * and `nHeavy` second-row heavy atoms (C/N/O/F).
 */
export function gaussianBasisFunctionCount(archetypeId: i32, nHydrogen: i32, nHeavy: i32): i32 {
  const h = nHydrogen > 0 ? nHydrogen : 0;
  const c = nHeavy > 0 ? nHeavy : 0;
  switch (archetypeId) {
    case ARCH_STO_3G:
      return h * 1 + c * 5;
    case ARCH_3_21G:
      return h * 2 + c * 9;
    case ARCH_6_31G_D:
      return h * 2 + c * 15;
    case ARCH_6_311PP_G_DP:
      return h * 7 + c * 22;
    case ARCH_CC_PVDZ:
      return h * 5 + c * 14;
    case ARCH_CC_PVTZ:
      return h * 14 + c * 30;
    default:
      return h * 2 + c * 10;
  }
}

/**
 * Evaluates a method or basis set archetype in-place on a 256-byte linear-memory slot.
 */
export function gaussianModelEval(archetypeId: i32, slotPtr: usize): void {
  const nH = <i32>getIn(slotPtr, 0);
  const nHeavy = <i32>getIn(slotPtr, 1);
  const rawZpe = getIn(slotPtr, 2);
  const nBasisIn = getIn(slotPtr, 3);

  if (archetypeId >= 100) {
    const nbf = <f64>gaussianBasisFunctionCount(archetypeId, nH, nHeavy);
    setOut(slotPtr, 0, nbf);
    setOut(slotPtr, 1, rawZpe);
    setOut(slotPtr, 2, nbf * nbf);
    setOut(slotPtr, 3, 0.0);
    return;
  }

  const scale = getCon(slotPtr, 2) > 0.0 ? getCon(slotPtr, 2) : gaussianMethodZpeScale(archetypeId);
  const order = getCon(slotPtr, 0) > 0.0 ? getCon(slotPtr, 0) : gaussianMethodScalingOrder(archetypeId);
  const hfEx = getCon(slotPtr, 1);
  const nBasis = nBasisIn > 0.0 ? nBasisIn : <f64>(nH * 2 + nHeavy * 15);
  const cost = Math.pow(nBasis > 1.0 ? nBasis : 1.0, order);

  setOut(slotPtr, 0, nBasis);
  setOut(slotPtr, 1, rawZpe * scale);
  setOut(slotPtr, 2, cost);
  setOut(slotPtr, 3, hfEx);
}
