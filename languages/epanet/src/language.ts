// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Language Definition.
 *
 * Registers US EPA EPANET (.inp) hydraulic network file extensions,
 * pre-flight linter diagnostics, Todini GGM solver, DAE lowering, and Modelica export.
 */

import { iniSectionRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerEpanetToDae } from "./dae/epanet-to-dae.js";
import { canIndexEpanet, indexEpanetDocument } from "./indexing.js";
import { lintEpanet } from "./lints/rules.js";
import { parseInp } from "./parser/index.js";
import { epanetToModelica } from "./projections/epanet-to-modelica.js";
import { solveHydraulics } from "./solver/todini-ggm.js";
import { epanetPolyglotConfig } from "./tgg/index.js";

export const epanetLanguage = language({
  polyglot: epanetPolyglotConfig,
  name: "epanet",
  fileExtensions: [".epanet", ".epanet.inp", ".inp", ".net"],
  maturity: "experimental",
  extras: ($) => [/[ \t\r\n]+/, $["IniComment"]!],
  indexing: {
    indexFile: indexEpanetDocument,
    canIndex: canIndexEpanet,
  },
  lsp: {
    fileExtensions: [".epanet", ".epanet.inp", ".inp", ".net"],
    folding: ["IniSectionHeader"],
    outline: ["IniSectionHeader"],
  },
  ui: {
    panels: [
      {
        id: "epanetEditor",
        viewType: "modelscript.epanetEditor",
        title: "EPANET Water Network Studio",
        shortTitle: "EPANET",
        selector: ["*.epanet", "*.epanet.inp", "*.net"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/EpanetPanel.tsx",
        artifactViewTypes: ["epanet"],
      },
    ],
    simulationCards: [
      {
        id: "water-compliance",
        title: "Water Utility Compliance (AWIA / AWWA M36 / LCRI)",
        entry: "./src/ui/WaterComplianceCard.tsx",
      },
    ],
    toolbarButtons: [
      {
        id: "solveHydraulics",
        label: "Solve Hydraulic Network",
        shortLabel: "Solve",
        tooltip: "Run EPANET hydraulic and water-quality solver",
        icon: "pulse",
        views: ["diagram", "inspector"],
        targets: ["morsel", "vscode"],
        placement: "primary",
        order: 10,
        actionId: "epanet_solve",
      },
      {
        id: "epanetLint",
        label: "Validate Water Network Topology",
        tooltip: "Check EPANET network for disconnected nodes and invalid curves",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel", "vscode"],
        placement: "overflow",
        order: 20,
        actionId: "epanet_lint",
      },
      {
        id: "epanetToModelica",
        label: "Export to Modelica Fluid Model",
        tooltip: "Project this EPANET network into a Modelica fluid system",
        icon: "file-code",
        views: ["code", "inspector"],
        targets: ["morsel", "vscode"],
        placement: "overflow",
        order: 30,
        actionId: "epanet_to_modelica",
      },
    ],
  },
  rules: iniSectionRules,

  actions: [
    {
      id: "epanet_lint",
      title: "Lint EPANET Hydraulic Network",
      description: "Runs pre-flight isolated node, pipe geometry, and pump curve monotonicity checks.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
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
      execute: async (context: ActionExecutionContext) => {
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
      execute: async (context: ActionExecutionContext) => {
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
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const net = parseInp(text);
        return epanetToModelica(net);
      },
    },
  ],
});
