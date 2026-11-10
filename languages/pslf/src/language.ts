// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript GE PSLF Language Definition.
 */

import { language } from "@modelscript/dsl";
import { formatPowerFlowReport, solvePowerFlow } from "@modelscript/psse";
import { lintPslfEpc } from "./lints/index.js";
import { parsePslfEpc } from "./parser/epc-parser.js";
import { pslfEpcToPsseRaw } from "./projections/pslf-to-psse.js";

export const pslfLanguage = language({
  name: "pslf",
  fileExtensions: [".epc", ".dyd"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".epc", ".dyd"],
  },

  actions: [
    {
      id: "solve_pslf_powerflow",
      title: "Solve AC Power Flow (PSLF)",
      description: "Solves steady-state AC Newton-Raphson power flow for a GE PSLF .epc base case.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "pslf_solve_powerflow",
          displayName: "Solve PSLF AC Power Flow",
          modelDescription: "Solves AC Newton-Raphson power flow for a GE PSLF .epc grid model.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const epc = parsePslfEpc(text);
        const psseCase = pslfEpcToPsseRaw(epc);
        const sol = solvePowerFlow(psseCase);
        return {
          ...sol,
          reportText: formatPowerFlowReport(sol, `PSLF Case: ${epc.title1}`),
        };
      },
    },
    {
      id: "lint_pslf_model",
      title: "Lint PSLF Base Case",
      description: "Checks GE PSLF .epc and .dyd model files for topological, electrical, and data integrity violations.",
      category: "verify",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const epc = parsePslfEpc(text);
        return lintPslfEpc(epc);
      },
    },
  ],
});

export default pslfLanguage;
