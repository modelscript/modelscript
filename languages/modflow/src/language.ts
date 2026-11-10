// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerModflowToDae } from "./dae/index.js";
import { lintModflow } from "./lints/index.js";
import { parseModflow } from "./parser/index.js";
import { solveAquiferBalance } from "./solver/index.js";

export const modflowLanguage = language({
  name: "modflow",
  fileExtensions: [".dis", ".dis6", ".npf", ".npf6", ".wel", ".wel6", ".riv", ".riv6", ".chd", ".chd6", ".nam"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".dis", ".dis6", ".npf", ".npf6", ".wel", ".wel6", ".riv", ".riv6", ".chd", ".chd6", ".nam"],
  },
  actions: [
    {
      id: "modflow_lint",
      title: "Lint MODFLOW Model",
      description: "Validates grid cell bounds, conductivity values, and boundary elevations.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintModflow(parseModflow(text));
      },
    },
    {
      id: "modflow_solve_balance",
      title: "Solve Aquifer Balance",
      description: "Computes cell conductances, boundary water fluxes, and mass balances.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return solveAquiferBalance(parseModflow(text));
      },
    },
    {
      id: "modflow_to_dae",
      title: "Lower MODFLOW to DAEBuilder",
      description: "Lowers aquifer grid cells and Darcy continuity equations to DAE arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseModflow(text);
        const dae = lowerModflowToDae(model);
        return {
          name: model.name,
          variables: dae.variables().length,
          equations: dae.equations().length,
        };
      },
    },
  ],
});
