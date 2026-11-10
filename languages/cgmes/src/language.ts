// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript ENTSO-E CGMES (IEC 61970 CIM) Language Definition.
 */

import { language } from "@modelscript/dsl";
import { formatPowerFlowReport, solvePowerFlow } from "@modelscript/psse";
import { lintCgmesModel } from "./lints/index.js";
import { parseCgmesRdf } from "./parser/cgmes-rdf-parser.js";
import { cgmesToModelica } from "./projections/cgmes-to-modelica.js";
import { cgmesToPsse } from "./projections/cgmes-to-psse.js";

export const cgmesLanguage = language({
  name: "cgmes",
  fileExtensions: [".cgmes", ".xml", ".rdf"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".cgmes"],
  },

  actions: [
    {
      id: "cgmes_lint",
      title: "Lint CGMES Profile",
      description: "Validates ENTSO-E CGMES RDF/XML equipment, topology, and state variable constraints.",
      category: "verify",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const model = parseCgmesRdf(text);
        return lintCgmesModel(model);
      },
    },
    {
      id: "cgmes_solve_powerflow",
      title: "Solve AC Power Flow (CGMES)",
      description: "Processes node-breaker topology and solves steady-state AC Newton-Raphson power flow.",
      category: "simulate",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseCgmesRdf(text);
        const { psseCase } = cgmesToPsse(model);
        const sol = solvePowerFlow(psseCase);
        return {
          ...sol,
          reportText: formatPowerFlowReport(sol, "CGMES Grid Model"),
        };
      },
    },
    {
      id: "cgmes_to_modelica",
      title: "Project CGMES to OpenIPSL Modelica",
      description: "Synthesizes an OpenIPSL / Modelica transmission network model from CGMES RDF/XML.",
      category: "export",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const model = parseCgmesRdf(text);
        return cgmesToModelica(model);
      },
    },
  ],
});

export default cgmesLanguage;
