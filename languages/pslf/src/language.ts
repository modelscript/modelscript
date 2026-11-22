// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript GE PSLF Language Definition.
 */

import { cardDeckRules, language } from "@modelscript/dsl";
import { formatPowerFlowReport, solvePowerFlow } from "@modelscript/psse";
import { registerBuiltInPslfLibrarySync } from "./catalog/library-package-adapter.js";
import { lintPslfEpc } from "./lints/index.js";
import { parsePslfEpc } from "./parser/epc-parser.js";
import { pslfEpcToPsseRaw } from "./projections/pslf-to-psse.js";
import { pslfPolyglotConfig } from "./tgg/index.js";

export const pslfLanguage = language({
  polyglot: pslfPolyglotConfig,
  name: "pslf",
  fileExtensions: [".epc", ".dyd"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".epc", ".dyd"],
  },

  ui: {
    toolbarButtons: [
      {
        id: "solvePslfPowerflow",
        label: "Solve AC Power Flow (PSLF)",
        shortLabel: "Solve AC",
        tooltip: "Solve AC Power Flow (PSLF)",
        icon: "pulse",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        actionId: "solve_pslf_powerflow",
      },
      {
        id: "lintPslfModel",
        label: "Lint PSLF Base Case",
        shortLabel: "Lint PSLF",
        tooltip: "Lint PSLF Base Case",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 20,
        actionId: "lint_pslf_model",
      },
    ],
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
      description:
        "Checks GE PSLF .epc and .dyd model files for topological, electrical, and data integrity violations.",
      category: "verify",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const epc = parsePslfEpc(text);
        return lintPslfEpc(epc);
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default pslfLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInPslfLibrarySync();
