// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Time-Domain Critical Clearing Time (CCT) Binary Search + SOS Lyapunov Certificate
 *
 * Pairs exact time-domain binary search over `simulatePsseTransient` with the formal
 * Equal-Area / SOS Lyapunov barrier lower bound from `verifyCriticalClearingBarrier`.
 */

import { verifyCriticalClearingBarrier, type CriticalClearingBarrierResult } from "../analysis/formal-grid-checks.js";
import type { PsseCase } from "../types.js";
import { simulatePsseTransient } from "./ac-powerflow.js";

export interface CctSearchOptions {
  /** Target fault bus number. */
  faultBus: number;
  /** Fault inception time in seconds (default: 0.1 s). */
  faultStartSec?: number | undefined;
  /** Minimum clearing duration to test in seconds (default: 0.02 s). */
  minClearingSec?: number | undefined;
  /** Maximum clearing duration to test in seconds (default: 0.50 s). */
  maxClearingSec?: number | undefined;
  /** Binary search tolerance in seconds (default: 0.002 s = 2 ms). */
  toleranceSec?: number | undefined;
  /** Total transient simulation horizon in seconds (default: 2.0 s). */
  tEndSec?: number | undefined;
  /** Transient integration step in seconds (default: 0.005 s). */
  dtSec?: number | undefined;
  /** Maximum rotor angle separation threshold in degrees for instability (default: 180 deg). */
  maxAngleSpreadDeg?: number | undefined;
}

export interface CctSearchResult {
  faultBus: number;
  numericalCctSec: number;
  formalLowerBoundCctSec: number;
  iterations: number;
  stableAtMin: boolean;
  unstableAtMax: boolean;
  formalCertificate: CriticalClearingBarrierResult;
  summary: string;
}

function isTransientStable(
  psseCase: PsseCase,
  faultBus: number,
  faultStartSec: number,
  clearingSec: number,
  durationSec: number,
  dtSec: number,
  maxAngleSpreadDeg: number,
): boolean {
  const res = simulatePsseTransient(psseCase, {
    faultBus,
    faultStartSec,
    faultClearSec: faultStartSec + clearingSec,
    stopTime: durationSec,
    timeStep: dtSec,
  });
  if (!res.summary.stable) return false;
  if (res.summary.maxRotorAngleSpreadDeg > maxAngleSpreadDeg) return false;
  return true;
}

/**
 * Computes numerical Critical Clearing Time (CCT) via binary search and pairs it with the formal SOS barrier certificate.
 */
export function searchCriticalClearingTime(psseCase: PsseCase, options: CctSearchOptions): CctSearchResult {
  const faultStartSec = options.faultStartSec ?? 0.1;
  let lo = options.minClearingSec ?? 0.02;
  let hi = options.maxClearingSec ?? 0.5;
  const tol = options.toleranceSec ?? 0.002;
  const tEndSec = options.tEndSec ?? 2.0;
  const dtSec = options.dtSec ?? 0.005;
  const maxAngleSpreadDeg = options.maxAngleSpreadDeg ?? 180.0;

  const stableAtMin = isTransientStable(
    psseCase,
    options.faultBus,
    faultStartSec,
    lo,
    tEndSec,
    dtSec,
    maxAngleSpreadDeg,
  );
  const stableAtMax = isTransientStable(
    psseCase,
    options.faultBus,
    faultStartSec,
    hi,
    tEndSec,
    dtSec,
    maxAngleSpreadDeg,
  );
  const unstableAtMax = !stableAtMax;

  let iterations = 0;
  let numericalCctSec = stableAtMin ? (stableAtMax ? hi : lo) : 0;

  if (stableAtMin && unstableAtMax) {
    while (hi - lo > tol && iterations < 16) {
      const mid = 0.5 * (lo + hi);
      iterations++;
      if (isTransientStable(psseCase, options.faultBus, faultStartSec, mid, tEndSec, dtSec, maxAngleSpreadDeg)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    numericalCctSec = lo;
  }

  const formalCertificate = verifyCriticalClearingBarrier(psseCase, {
    clearingTimeSec: numericalCctSec > 0 ? numericalCctSec : lo,
  });
  const formalLowerBoundCctSec = formalCertificate.minCctSec;

  const summary =
    `CCT Search (Fault Bus ${options.faultBus}): Numerical CCT = ${(numericalCctSec * 1e3).toFixed(1)} ms ` +
    `(${iterations} binary-search iters), Formal SOS Lower Bound = ${(formalLowerBoundCctSec * 1e3).toFixed(1)} ms.`;

  return {
    faultBus: options.faultBus,
    numericalCctSec: Number(numericalCctSec.toFixed(4)),
    formalLowerBoundCctSec: Number(formalLowerBoundCctSec.toFixed(4)),
    iterations,
    stableAtMin,
    unstableAtMax,
    formalCertificate,
    summary,
  };
}
