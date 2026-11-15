// SPDX-License-Identifier: AGPL-3.0-or-later

import type { P3743BoundaryEquivalent } from "@modelscript/exchange";
import { calculateShortCircuit } from "../solver/ac-powerflow.js";
import type { PsseCase } from "../types.js";

/**
 * Computes IEEE P3743 short-circuit boundary equivalents (`P3743BoundaryEquivalent`)
 * for selected (or all) buses in a PSS/E `.raw` + `.seq` case.
 */
export function psseToP3743Boundaries(psseCase: PsseCase, busNumbers?: number[]): P3743BoundaryEquivalent[] {
  const sc = calculateShortCircuit(psseCase, { seq: psseCase.seq });
  const filter = busNumbers ? new Set(busNumbers) : undefined;
  const sbase = sc.sbaseMva > 0 ? sc.sbaseMva : 100.0;

  return sc.buses
    .filter((b) => !filter || filter.has(b.busNumber))
    .map((b) => {
      const zBaseOhm = (b.baseKv * b.baseKv) / sbase;
      const r1Ohm = b.theveninR1Pu * zBaseOhm;
      const x1Ohm = b.theveninX1Pu * zBaseOhm;
      const x0Ohm = b.theveninX0Pu * zBaseOhm;
      const r0Ohm = b.xrRatio > 0 ? x0Ohm / b.xrRatio : r1Ohm;
      return {
        busId: `BUS_${b.busNumber}`,
        shortCircuitMva: b.sk3PhaseMva,
        xOverRRatio: b.xrRatio,
        z1Ohm: { r: r1Ohm, x: x1Ohm },
        z0Ohm: { r: r0Ohm, x: x0Ohm },
        sourceTool: "psse-seq",
      };
    });
}
