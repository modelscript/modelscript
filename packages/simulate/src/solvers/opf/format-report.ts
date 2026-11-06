// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formats an Optimal Power Flow solution into an engineering report.
 */

import type { OpfSolution } from "./types.js";

export function formatOpfReport(sol: OpfSolution, caseTitle = "POWER NETWORK"): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`  OPTIMAL POWER FLOW (DC-OPF) DISPATCH & LMP REPORT — ${caseTitle}`);
  lines.push(`================================================================================`);
  lines.push(
    `  Status          : ${sol.status} (Formulation: ${sol.formulation.toUpperCase()}-OPF)`,
  );
  lines.push(`  Total Gen Cost  : $${sol.objectiveValue.toLocaleString()}/hr`);
  lines.push(
    `  System Demand   : ${sol.totalLoadMw.toFixed(2)} MW  |  Total Generation: ${sol.totalGenMw.toFixed(2)} MW`,
  );
  lines.push(
    `  Average LMP     : $${sol.averageLmp.toFixed(2)}/MWh`,
  );
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  ECONOMIC GENERATION DISPATCH`);
  lines.push(`  Bus   Gen ID   Dispatch (MW)   Min (MW)   Max (MW)   Offer ($/MWh)   Cost ($/hr)   Limit Status`);
  lines.push(`  ----  -------  -------------  ---------  ---------  --------------  ------------  ------------`);

  for (const g of sol.generators) {
    const limitTag = g.atMaxLimit ? "AT UPPER MAX" : g.atMinLimit ? "AT LOWER MIN" : "ECONOMIC MARGINAL";
    lines.push(
      `  ${String(g.busNumber).padStart(4)}  ${g.genId.padEnd(7)}  ${g.pgMw.toFixed(2).padStart(13)}  ${g.pMinMw.toFixed(1).padStart(9)}  ${g.pMaxMw.toFixed(1).padStart(9)}  ${g.marginalCost.toFixed(2).padStart(14)}  ${g.totalCostPerHour.toFixed(2).padStart(12)}  ${limitTag}`,
    );
  }

  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  BUS LOCATIONAL MARGINAL PRICES (LMPS) & CONGESTION DECOMPOSITION`);
  lines.push(`  Bus   Name                     Base kV   Va (deg)   Load (MW)   LMP ($/MWh)   Energy ($)   Congestion ($)`);
  lines.push(`  ----  -----------------------  -------  ---------  ----------  ------------  -----------  ---------------`);

  for (const b of sol.buses.slice(0, 20)) {
    lines.push(
      `  ${String(b.busNumber).padStart(4)}  ${b.name.padEnd(23).slice(0, 23)}  ${b.baseKv.toFixed(1).padStart(7)}  ${b.vaDeg.toFixed(2).padStart(9)}  ${b.plMw.toFixed(1).padStart(10)}  ${b.lmpDollarsPerMwh.toFixed(2).padStart(12)}  ${b.energyComponent.toFixed(2).padStart(11)}  ${b.congestionComponent.toFixed(2).padStart(15)}`,
    );
  }
  if (sol.buses.length > 20) {
    lines.push(`  ... and ${sol.buses.length - 20} more buses.`);
  }

  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  TRANSMISSION BRANCH POWER FLOWS & CONGESTION RENT`);
  lines.push(`  From    To  Ckt    Flow (MW)   Rating (MVA)   Loading (%)   Congested   Shadow Price ($/MWh)`);
  lines.push(`  ----  ----  ---  -----------  -------------  ------------  -----------  ---------------------`);

  for (const br of sol.branches) {
    const congTag = br.congested ? "CONGESTED" : "CLEAR";
    lines.push(
      `  ${String(br.fromBus).padStart(4)}  ${String(br.toBus).padStart(4)}  ${br.ckt.padEnd(3)}  ${br.pFlowMw.toFixed(2).padStart(11)}  ${(br.rateMva < 900 ? br.rateMva.toFixed(1) : "None").padStart(13)}  ${br.loadingPercent.toFixed(1).padStart(12)}%  ${congTag.padEnd(11)}  ${br.shadowPrice.toFixed(2).padStart(21)}`,
    );
  }

  lines.push(`================================================================================`);
  return lines.join("\n");
}
