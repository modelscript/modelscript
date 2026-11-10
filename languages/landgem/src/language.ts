// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerLandgemToDae } from "./dae/index.js";
import { lintLandgem } from "./lints/index.js";
import { parseLandgem } from "./parser/index.js";
import { solveBiogas } from "./solver/index.js";

export const landgemLanguage = language({
  name: "landgem",
  fileExtensions: [".landgem", ".lfg", ".biogas"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".landgem", ".lfg", ".biogas"],
  },
  actions: [
    {
      id: "landgem_lint",
      title: "Lint LandGEM / Biogas Deck",
      description: "Validates kinetic rate constants, waste acceptance years, and digester pH.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintLandgem(parseLandgem(text));
      },
    },
    {
      id: "landgem_solve_emissions",
      title: "Solve Methane & Biogas Generation",
      description: "Computes first-order decay methane generation curves and digester CHP outputs.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return solveBiogas(parseLandgem(text));
      },
    },
    {
      id: "landgem_to_dae",
      title: "Lower LandGEM to DAEBuilder",
      description: "Lowers methane generation and digester state equations to DAE arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseLandgem(text);
        const dae = lowerLandgemToDae(model);
        return {
          variables: dae.variables().length,
          equations: dae.equations().length,
        };
      },
    },
  ],
});
