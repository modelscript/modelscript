// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pypsa — Project PyPSA Capacity Expansion / DC-OPF Network to AMPL.
 */

import type { PypsaNetwork } from "../types.js";

export function projectPypsaToAmpl(net: PypsaNetwork): string {
  const lines: string[] = [];
  lines.push(`# AMPL Capacity Expansion & DC-OPF Model generated from PyPSA (${net.name})`);
  lines.push("set BUSES;");
  lines.push("set GENS;");
  lines.push("param load_mw {BUSES} default 0;");
  lines.push("param gen_bus {GENS} symbolic;");
  lines.push("param gen_p_nom {GENS} >= 0;");
  lines.push("param gen_mc {GENS} >= 0;");
  lines.push("param gen_capex {GENS} >= 0;");
  lines.push("var p_gen {g in GENS} >= 0, <= gen_p_nom[g];");
  lines.push("minimize TotalCost: sum {g in GENS} gen_mc[g] * p_gen[g];");
  lines.push("data;");
  lines.push(`set BUSES := ${net.buses.map((b) => b.name).join(" ")};`);
  lines.push(`set GENS := ${net.generators.map((g) => g.name).join(" ")};`);
  lines.push("param load_mw :=");
  for (const l of net.loads) {
    lines.push(`  ${l.bus} ${l.p_set}`);
  }
  lines.push(";");
  lines.push("param: gen_bus gen_p_nom gen_mc gen_capex :=");
  for (const g of net.generators) {
    lines.push(`  ${g.name} ${g.bus} ${g.p_nom} ${g.marginal_cost} ${g.capital_cost}`);
  }
  lines.push(";");
  return lines.join("\n");
}
