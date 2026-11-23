// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript power-flow component runtime for `@modelscript/ieee-cdf-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — component parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — [Vm, Va]
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — residuals
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`):
 *       IO[0] = Vf (pu)      IO[1] = thetaF (rad)
 *       IO[2] = Vt (pu)      IO[3] = thetaT (rad)
 *       IO[4] = P_from (pu)  IO[5] = Q_from (pu)
 *       IO[6] = P_to (pu)    IO[7] = Q_to (pu)
 *       IO[8] = G_s (pu)     IO[9] = B_s (pu)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_IO: usize = 0x780;

const ARCH_PQ_BUS: i32 = 1;
const ARCH_PV_BUS: i32 = 2;
const ARCH_SLACK_BUS: i32 = 3;
const ARCH_TRANSMISSION_LINE: i32 = 10;
const ARCH_TAP_TRANSFORMER: i32 = 11;
const ARCH_PHASE_SHIFTER: i32 = 12;
const ARCH_SHUNT_ELEMENT: i32 = 20;

const DEG_TO_RAD: f64 = 0.017453292519943295;

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

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function ieeeCdfGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes an IEEE CDF bus/branch/shunt component slot.
 */
export function ieeeCdfModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  if (archetypeId == ARCH_SLACK_BUS) {
    const vSet = getCon(slotPtr, conCount, 0, 1.06);
    const angRad = getCon(slotPtr, conCount, 1, 0.0) * DEG_TO_RAD;
    setState(slotPtr, 0, vSet);
    setState(slotPtr, 1, angRad);
    return 2;
  }
  if (archetypeId == ARCH_PV_BUS) {
    const vSet = getCon(slotPtr, conCount, 1, 1.0);
    setState(slotPtr, 0, vSet);
    setState(slotPtr, 1, 0.0);
    return 2;
  }
  if (archetypeId == ARCH_PQ_BUS) {
    setState(slotPtr, 0, 1.0);
    setState(slotPtr, 1, 0.0);
    return 2;
  }
  return 0;
}

/**
 * Evaluates branch power flows or nodal shunt injections for an IEEE CDF archetype.
 */
export function ieeeCdfModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  if (
    archetypeId == ARCH_TRANSMISSION_LINE ||
    archetypeId == ARCH_TAP_TRANSFORMER ||
    archetypeId == ARCH_PHASE_SHIFTER
  ) {
    const r = getCon(slotPtr, conCount, 0, 0.01);
    const x = getCon(slotPtr, conCount, 1, 0.1);
    const bChg = archetypeId == ARCH_TRANSMISSION_LINE ? getCon(slotPtr, conCount, 2, 0.0) : 0.0;
    const tapRaw =
      archetypeId == ARCH_TAP_TRANSFORMER || archetypeId == ARCH_PHASE_SHIFTER
        ? getCon(slotPtr, conCount, 2, 1.0)
        : 1.0;
    const a = tapRaw > 0.0 ? tapRaw : 1.0;
    const phiDeg = archetypeId == ARCH_PHASE_SHIFTER ? getCon(slotPtr, conCount, 3, 0.0) : 0.0;
    const phi = phiDeg * DEG_TO_RAD;

    const denom = r * r + x * x;
    if (denom < 1e-18) return;
    const gs = r / denom;
    const bs = -x / denom;
    const bcHalf = 0.5 * bChg;

    const a2 = a * a;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const yffG = gs / a2;
    const yffB = (bs + bcHalf) / a2;
    const yttG = gs;
    const yttB = bs + bcHalf;
    const yftG = -(gs * cosPhi - bs * sinPhi) / a;
    const yftB = -(gs * sinPhi + bs * cosPhi) / a;
    const ytfG = -(gs * cosPhi + bs * sinPhi) / a;
    const ytfB = -(-gs * sinPhi + bs * cosPhi) / a;

    const vf = getIo(slotPtr, 0);
    const tf = getIo(slotPtr, 1);
    const vt = getIo(slotPtr, 2);
    const tt = getIo(slotPtr, 3);

    const vfRe = vf * Math.cos(tf);
    const vfIm = vf * Math.sin(tf);
    const vtRe = vt * Math.cos(tt);
    const vtIm = vt * Math.sin(tt);

    const ifRe = yffG * vfRe - yffB * vfIm + (yftG * vtRe - yftB * vtIm);
    const ifIm = yffG * vfIm + yffB * vfRe + (yftG * vtIm + yftB * vtRe);
    const itRe = ytfG * vfRe - ytfB * vfIm + (yttG * vtRe - yttB * vtIm);
    const itIm = ytfG * vfIm + ytfB * vfRe + (yttG * vtIm + yttB * vtRe);

    setIo(slotPtr, 4, vfRe * ifRe + vfIm * ifIm);
    setIo(slotPtr, 5, vfIm * ifRe - vfRe * ifIm);
    setIo(slotPtr, 6, vtRe * itRe + vtIm * itIm);
    setIo(slotPtr, 7, vtIm * itRe - vtRe * itIm);
    setIo(slotPtr, 8, gs);
    setIo(slotPtr, 9, bs);
    return;
  }

  if (archetypeId == ARCH_SHUNT_ELEMENT) {
    const gSh = getCon(slotPtr, conCount, 0, 0.0);
    const bSh = getCon(slotPtr, conCount, 1, 0.19);
    const v = getIo(slotPtr, 0);
    const v2 = v * v;
    setIo(slotPtr, 4, gSh * v2);
    setIo(slotPtr, 5, -bSh * v2);
    setIo(slotPtr, 8, gSh);
    setIo(slotPtr, 9, bSh);
  }
}
