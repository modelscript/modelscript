// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BergeronLineState } from "./emt-solver-types.js";

/**
 * Reads an interpolated delayed sample at `(t - tau)` from a Bergeron ring buffer.
 */
export function readDelayedSample(
  buf: Float64Array,
  ptr: number,
  bufLen: number,
  delaySteps: number,
  fracDelay: number,
): number {
  const idx1 = (ptr - delaySteps + bufLen * 2) % bufLen;
  const idx2 = (idx1 - 1 + bufLen) % bufLen;
  return (1.0 - fracDelay) * buf[idx1]! + fracDelay * buf[idx2]!;
}

/**
 * Computes terminal traveling-wave history currents for a Bergeron or ULM / J. Marti
 * frequency-dependent (`modelType === "fdpm"`) transmission line using O(N_poles) recursive convolution.
 */
export function computeLineHistoryCurrents(
  bl: BergeronLineState,
  advanceStates: boolean,
): {
  iHistKmA: number;
  iHistKmB: number;
  iHistKmC: number;
  iHistMkA: number;
  iHistMkB: number;
  iHistMkC: number;
} {
  const { ptr, bufLen, delaySteps, fracDelay, gBerg, hLoss } = bl;
  const c1 = 0.5 * (1.0 + hLoss);
  const c2 = 0.5 * (1.0 - hLoss);

  let rawKmA: number;
  let rawKmB: number;
  let rawKmC: number;
  let rawMkA: number;
  let rawMkB: number;
  let rawMkC: number;

  if (bl.hasModal) {
    // 1. Retrieve delayed Mode 0 (Ground return mode with slower velocity tau0)
    const vkDel0 = readDelayedSample(bl.vkBufA, ptr, bufLen, bl.delaySteps0, bl.fracDelay0);
    const vmDel0 = readDelayedSample(bl.vmBufA, ptr, bufLen, bl.delaySteps0, bl.fracDelay0);
    const ikmDel0 = readDelayedSample(bl.ikmBufA, ptr, bufLen, bl.delaySteps0, bl.fracDelay0);
    const imkDel0 = readDelayedSample(bl.imkBufA, ptr, bufLen, bl.delaySteps0, bl.fracDelay0);

    const c1_0 = 0.5 * (1.0 + bl.hLoss0);
    const c2_0 = 0.5 * (1.0 - bl.hLoss0);
    const rawKm0 =
      -c1_0 * (bl.gBerg0 * vmDel0 + bl.hLoss0 * imkDel0) - c2_0 * (bl.gBerg0 * vkDel0 + bl.hLoss0 * ikmDel0);
    const rawMk0 =
      -c1_0 * (bl.gBerg0 * vkDel0 + bl.hLoss0 * ikmDel0) - c2_0 * (bl.gBerg0 * vmDel0 + bl.hLoss0 * imkDel0);

    // 2. Retrieve delayed Modes 1 & 2 (Aerial modes with velocity ~ c)
    const vkDel1 = readDelayedSample(bl.vkBufB, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
    const vmDel1 = readDelayedSample(bl.vmBufB, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
    const ikmDel1 = readDelayedSample(bl.ikmBufB, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
    const imkDel1 = readDelayedSample(bl.imkBufB, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);

    const c1_1 = 0.5 * (1.0 + bl.hLoss1);
    const c2_1 = 0.5 * (1.0 - bl.hLoss1);
    const rawKm1 =
      -c1_1 * (bl.gBerg1 * vmDel1 + bl.hLoss1 * imkDel1) - c2_1 * (bl.gBerg1 * vkDel1 + bl.hLoss1 * ikmDel1);
    const rawMk1 =
      -c1_1 * (bl.gBerg1 * vkDel1 + bl.hLoss1 * ikmDel1) - c2_1 * (bl.gBerg1 * vmDel1 + bl.hLoss1 * imkDel1);

    const vkDel2 = readDelayedSample(bl.vkBufC, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
    const vmDel2 = readDelayedSample(bl.vmBufC, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
    const ikmDel2 = readDelayedSample(bl.ikmBufC, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
    const imkDel2 = readDelayedSample(bl.imkBufC, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);

    const rawKm2 =
      -c1_1 * (bl.gBerg1 * vmDel2 + bl.hLoss1 * imkDel2) - c2_1 * (bl.gBerg1 * vkDel2 + bl.hLoss1 * ikmDel2);
    const rawMk2 =
      -c1_1 * (bl.gBerg1 * vkDel2 + bl.hLoss1 * ikmDel2) - c2_1 * (bl.gBerg1 * vmDel2 + bl.hLoss1 * imkDel2);

    // 3. Inverse Clarke Transformation T: Modal (0, 1, 2) -> Phase (A, B, C)
    const SQRT3_HALF = 0.5 * Math.sqrt(3.0);
    rawKmA = rawKm0 + rawKm1;
    rawKmB = rawKm0 - 0.5 * rawKm1 + SQRT3_HALF * rawKm2;
    rawKmC = rawKm0 - 0.5 * rawKm1 - SQRT3_HALF * rawKm2;

    rawMkA = rawMk0 + rawMk1;
    rawMkB = rawMk0 - 0.5 * rawMk1 + SQRT3_HALF * rawMk2;
    rawMkC = rawMk0 - 0.5 * rawMk1 - SQRT3_HALF * rawMk2;
  } else {
    const vkDelA = readDelayedSample(bl.vkBufA, ptr, bufLen, delaySteps, fracDelay);
    const vkDelB = readDelayedSample(bl.vkBufB, ptr, bufLen, delaySteps, fracDelay);
    const vkDelC = readDelayedSample(bl.vkBufC, ptr, bufLen, delaySteps, fracDelay);

    const vmDelA = readDelayedSample(bl.vmBufA, ptr, bufLen, delaySteps, fracDelay);
    const vmDelB = readDelayedSample(bl.vmBufB, ptr, bufLen, delaySteps, fracDelay);
    const vmDelC = readDelayedSample(bl.vmBufC, ptr, bufLen, delaySteps, fracDelay);

    const ikmDelA = readDelayedSample(bl.ikmBufA, ptr, bufLen, delaySteps, fracDelay);
    const ikmDelB = readDelayedSample(bl.ikmBufB, ptr, bufLen, delaySteps, fracDelay);
    const ikmDelC = readDelayedSample(bl.ikmBufC, ptr, bufLen, delaySteps, fracDelay);

    const imkDelA = readDelayedSample(bl.imkBufA, ptr, bufLen, delaySteps, fracDelay);
    const imkDelB = readDelayedSample(bl.imkBufB, ptr, bufLen, delaySteps, fracDelay);
    const imkDelC = readDelayedSample(bl.imkBufC, ptr, bufLen, delaySteps, fracDelay);

    rawKmA = -c1 * (gBerg * vmDelA + hLoss * imkDelA) - c2 * (gBerg * vkDelA + hLoss * ikmDelA);
    rawKmB = -c1 * (gBerg * vmDelB + hLoss * imkDelB) - c2 * (gBerg * vkDelB + hLoss * ikmDelB);
    rawKmC = -c1 * (gBerg * vmDelC + hLoss * imkDelC) - c2 * (gBerg * vkDelC + hLoss * ikmDelC);

    rawMkA = -c1 * (gBerg * vkDelA + hLoss * ikmDelA) - c2 * (gBerg * vmDelA + hLoss * imkDelA);
    rawMkB = -c1 * (gBerg * vkDelB + hLoss * ikmDelB) - c2 * (gBerg * vmDelB + hLoss * imkDelB);
    rawMkC = -c1 * (gBerg * vkDelC + hLoss * ikmDelC) - c2 * (gBerg * vmDelC + hLoss * imkDelC);
  }

  if (!bl.isFdpm || bl.expDecays.length === 0) {
    return {
      iHistKmA: rawKmA,
      iHistKmB: rawKmB,
      iHistKmC: rawKmC,
      iHistMkA: rawMkA,
      iHistMkB: rawMkB,
      iHistMkC: rawMkC,
    };
  }

  const nPoles = bl.expDecays.length;
  let convKmA = bl.d0 * rawKmA;
  let convKmB = bl.d0 * rawKmB;
  let convKmC = bl.d0 * rawKmC;
  let convMkA = bl.d0 * rawMkA;
  let convMkB = bl.d0 * rawMkB;
  let convMkC = bl.d0 * rawMkC;

  for (let m = 0; m < nPoles; m++) {
    const alpha = bl.expDecays[m]!;
    const beta = bl.convGains[m]!;
    const nextKmA = alpha * bl.xKmA[m]! + beta * rawKmA;
    const nextKmB = alpha * bl.xKmB[m]! + beta * rawKmB;
    const nextKmC = alpha * bl.xKmC[m]! + beta * rawKmC;
    const nextMkA = alpha * bl.xMkA[m]! + beta * rawMkA;
    const nextMkB = alpha * bl.xMkB[m]! + beta * rawMkB;
    const nextMkC = alpha * bl.xMkC[m]! + beta * rawMkC;

    convKmA += nextKmA;
    convKmB += nextKmB;
    convKmC += nextKmC;
    convMkA += nextMkA;
    convMkB += nextMkB;
    convMkC += nextMkC;

    if (advanceStates) {
      bl.xKmA[m] = nextKmA;
      bl.xKmB[m] = nextKmB;
      bl.xKmC[m] = nextKmC;
      bl.xMkA[m] = nextMkA;
      bl.xMkB[m] = nextMkB;
      bl.xMkC[m] = nextMkC;
    }
  }

  return {
    iHistKmA: convKmA,
    iHistKmB: convKmB,
    iHistKmC: convKmC,
    iHistMkA: convMkA,
    iHistMkB: convMkB,
    iHistMkC: convMkC,
  };
}
