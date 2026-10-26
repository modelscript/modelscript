// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/epanet — Language Definition.
 *
 * Registers US EPA EPANET (.inp) hydraulic network file extensions,
 * pre-flight linter diagnostics, Todini GGM solver, DAE lowering, and Modelica export.
 */

import { language } from "@modelscript/dsl";
import { lowerEpanetToDae } from "./dae/epanet-to-dae.js";
import { lintEpanet } from "./lints/rules.js";
import { parseInp } from "./parser/index.js";
import { epanetToModelica } from "./projections/epanet-to-modelica.js";
import { solveHydraulics } from "./solver/todini-ggm.js";

export const epanetLanguage = language({
  name: "epanet",
  fileExtensions: [".inp"],
  lsp: {
    fileExtensions: [".inp"],
  },
  rules: {
    Root: () => "epanet",
  },

  actions: [
    {
      id: "epanet_lint",
      title: "Lint EPANET Hydraulic Network",
      description: "Runs pre-flight isolated node, pipe geometry, and pump curve monotonicity checks.",
      category: "verify",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const net = parseInp(text);
        return lintEpanet(net);
      },
    },
    {
      id: "epanet_solve",
      title: "Solve Network Hydraulics (Todini GGM)",
      description: "Computes steady-state junction pressures and pipe flows via Todini Global Gradient Algorithm.",
      category: "simulate",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const net = parseInp(text);
        const res = solveHydraulics(net);
        return {
          converged: res.converged,
          iterations: res.iterations,
          maxFlowChange: res.maxFlowChange,
          nodePressures: Object.fromEntries(res.nodePressures),
          linkFlows: Object.fromEntries(res.linkFlows),
        };
      },
    },
    {
      id: "epanet_to_dae",
      title: "Lower EPANET to DAE Arena",
      description: "Generates hydraulic pressure head and flow balance equations in ModelScript linear memory.",
      category: "transform",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const net = parseInp(text);
        const arena = lowerEpanetToDae(net);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "epanet_to_modelica",
      title: "Export to Modelica.Fluid Hydraulic Model",
      description: "Translates EPANET reservoirs, pipes, and demands into Modelica.Fluid network components.",
      category: "export",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const net = parseInp(text);
        return epanetToModelica(net);
      },
    },
  ],
});
