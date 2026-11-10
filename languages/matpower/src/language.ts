// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript MATPOWER Language Definition.
 */

import { language } from "@modelscript/dsl";
import { formatPowerFlowReport, solvePowerFlow } from "@modelscript/psse";
import { lowerMatpowerToDae } from "./dae/matpower-to-dae.js";
import { lintMatpowerCase } from "./lints/index.js";
import { parseMatpowerCase } from "./parser/matpower-parser.js";
import { matpowerToPsseRaw } from "./projections/matpower-to-psse.js";

export const matpowerLanguage = language({
  name: "matpower",
  fileExtensions: [".m", ".matpower"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".m", ".matpower"],
  },

  actions: [
    {
      id: "solve_matpower_powerflow",
      title: "Solve AC Power Flow (MATPOWER)",
      description: "Solves steady-state AC Newton-Raphson power flow for a MATPOWER .m case file.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "matpower_solve_powerflow",
          displayName: "Solve MATPOWER AC Power Flow",
          modelDescription: "Solves AC Newton-Raphson power flow for a MATPOWER .m power grid case.",
        },
      },
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const mpc = parseMatpowerCase(text);
        const psseCase = matpowerToPsseRaw(mpc);
        const sol = solvePowerFlow(psseCase);
        return {
          ...sol,
          reportText: formatPowerFlowReport(sol, `MATPOWER Case: ${mpc.caseName}`),
        };
      },
    },
    {
      id: "lint_matpower_case",
      title: "Lint MATPOWER Case",
      description: "Checks MATPOWER .m case files for topological, electrical, and data integrity violations.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const mpc = parseMatpowerCase(text);
        return lintMatpowerCase(mpc);
      },
    },
    {
      id: "lower_matpower_dae",
      title: "Lower MATPOWER Case to DAE Arena",
      description: "Compiles MATPOWER nodal AC power flow equations directly into linear memory DAEBuilder arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const mpc = parseMatpowerCase(text);
        const arena = lowerMatpowerToDae(mpc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
  ],
});

export default matpowerLanguage;
