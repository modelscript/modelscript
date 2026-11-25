// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PowerFlowBranchSnapshot, PowerFlowBusSnapshot, PowerFlowSnapshot } from "@modelscript/exchange";
import type { PowerFlowSolution } from "../solver/ac-powerflow.js";
import type { PsseCase } from "../types.js";

/**
 * Converts a solved PSS/E `PsseCase` + `PowerFlowSolution` into a canonical `PowerFlowSnapshot`
 * for cross-tool powerflow comparison (PSS/E <-> PSCAD <-> OpenDSS / PSLF / PowerFactory / MATPOWER).
 */
export function pssePowerFlowToSnapshot(
  psseCase: PsseCase,
  pfResult: PowerFlowSolution,
  label?: string,
): PowerFlowSnapshot {
  const buses: PowerFlowBusSnapshot[] = pfResult.buses.map((b) => ({
    busId: String(b.busNumber),
    name: b.name?.trim(),
    baseKv: b.baseKv,
    vmPu: b.vm,
    vaDeg: b.va,
    pGenMw: b.pgMw,
    qGenMvar: b.qgMvar,
    pLoadMw: b.plMw,
    qLoadMvar: b.qlMvar,
  }));

  const branches: PowerFlowBranchSnapshot[] = pfResult.branches.map((br) => ({
    id: `${br.fromBus}-${br.toBus}-${br.ckt.trim() || "1"}`,
    fromBus: String(br.fromBus),
    toBus: String(br.toBus),
    ckt: br.ckt.trim() || "1",
    pFlowMw: br.pFromMw,
    qFlowMvar: br.qFromMvar,
    loadingPct: br.loadingPercent,
  }));

  return {
    solver: "psse",
    label: label ?? psseCase.title1?.trim(),
    converged: pfResult.converged,
    frequencyHz: psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0,
    sbaseMva: psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0,
    buses,
    branches,
  };
}
