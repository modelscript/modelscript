// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerToughToDae } from "./dae/index.js";
import { lintTough } from "./lints/index.js";
import { parseTough } from "./parser/index.js";
import { solveGeothermalWells } from "./solver/index.js";

export const toughLanguage = language({
  name: "tough",
  fileExtensions: [".tough", ".dat", ".tgh"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".tough", ".dat", ".tgh"],
  },
  actions: [
    {
      id: "tough_lint",
      title: "Lint TOUGH Deck",
      description: "Validates rock properties, grid topology, and connection geometry.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintTough(parseTough(text));
      },
    },
    {
      id: "tough_solve_wells",
      title: "Solve Geothermal Production",
      description: "Computes well production rates and steam fraction.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return solveGeothermalWells(parseTough(text));
      },
    },
    {
      id: "tough_to_dae",
      title: "Lower TOUGH to DAEBuilder",
      description: "Lowers reservoir grid blocks and flux equations to DAE arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseTough(text);
        const dae = lowerToughToDae(deck);
        return {
          title: deck.title,
          variables: dae.variables().length,
          equations: dae.equations().length,
        };
      },
    },
  ],
});
