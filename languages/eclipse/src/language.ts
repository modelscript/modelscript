// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { language } from "@modelscript/dsl";
import { lowerEclipseToDae } from "./dae/eclipse-to-dae.js";
import { lintEclipse } from "./lints/index.js";
import { parseEclipse } from "./parser/eclipse-parser.js";
import { eclipseToModelica } from "./projections/eclipse-to-modelica.js";
import { solveReservoirDepletion } from "./solvers/reservoir-solver.js";

/**
 * ModelScript Schlumberger ECLIPSE Reservoir (.data, .dat, .inc) Language Definition.
 */
export const eclipseLanguage = language({
  name: "eclipse",
  fileExtensions: [".data", ".dat", ".inc"],
  lsp: {
    fileExtensions: [".data", ".dat", ".inc"],
    icons: {
      light: "./assets/eclipse/icon-light.png",
      dark: "./assets/eclipse/icon-dark.png",
    },
  },

  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset >= entry.startOffset) {
      return { startOffset: entry.startOffset, endOffset: entry.endOffset, newText: newValue.trim() };
    }
    return null;
  },

  actions: [
    {
      id: "lint_eclipse",
      title: "Lint ECLIPSE Reservoir Deck",
      description: "Validates grid dimensions, porosity bounds, PVT monotonicity, and well completion indices.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "eclipse_lint",
          displayName: "Lint ECLIPSE Reservoir Deck",
          modelDescription:
            "Lints ECLIPSE file for out-of-bounds completions, non-monotonic PVT tables, and missing sections.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseEclipse(text);
        return lintEclipse(parsed);
      },
    },
    {
      id: "eclipse_reservoir_solve",
      title: "Solve Reservoir Depletion",
      description: "Solves multiphase Darcy flow material balance and Peaceman well inflow performance.",
      category: "simulate",
      execute: async (ctx: any, params: { documentText?: string | undefined; options?: any }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseEclipse(text);
        return solveReservoirDepletion(deck, params?.options);
      },
    },
    {
      id: "eclipse_to_dae",
      title: "Lower ECLIPSE to DAE",
      description: "Compiles reservoir material balance and Peaceman well inflow into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseEclipse(text);
        const dae = lowerEclipseToDae(parsed);
        return {
          modelName: parsed.title || "EclipseReservoir",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "eclipse_to_modelica",
      title: "Project ECLIPSE to Modelica",
      description: "Synthesizes standard Modelica 3.x porous media reservoir simulation model.",
      category: "export",
      execute: async (ctx: any, params: { documentText?: string | undefined; modelName?: string }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseEclipse(text);
        return eclipseToModelica(parsed, params?.modelName);
      },
    },
  ],
});
