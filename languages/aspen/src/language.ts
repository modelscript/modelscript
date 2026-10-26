// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { language } from "@modelscript/dsl";
import { lowerAspenToDae } from "./dae/aspen-to-dae.js";
import { lintAspen } from "./lints/index.js";
import { parseAspen } from "./parser/aspen-parser.js";
import { aspenToModelica } from "./projections/aspen-to-modelica.js";
import { solveFlashRachfordRice } from "./solvers/flash-solver.js";

/**
 * ModelScript Aspen Plus Input Deck (.in, .inp, .bkp) Language Definition.
 */
export const aspenLanguage = language({
  name: "aspen",
  fileExtensions: [".in", ".inp", ".bkp"],
  lsp: {
    fileExtensions: [".in", ".inp", ".bkp"],
    icons: {
      light: "./assets/aspen/icon-light.png",
      dark: "./assets/aspen/icon-dark.png",
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
      id: "lint_aspen_flowsheet",
      title: "Lint Aspen Flowsheet",
      description: "Performs pre-flight chemical process topology, mass balance, and parameter bounds checks.",
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
          name: "aspen_lint",
          displayName: "Lint Aspen Deck",
          modelDescription: "Lints Aspen input file for unconnected streams, tear cycles, and fraction errors.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseAspen(text);
        return lintAspen(parsed);
      },
    },
    {
      id: "aspen_to_dae",
      title: "Lower Aspen to DAE",
      description: "Compiles Aspen process flowsheet directly into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseAspen(text);
        const dae = lowerAspenToDae(parsed);
        return {
          modelName: "AspenFlowsheet",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "aspen_to_modelica",
      title: "Project Aspen to Modelica",
      description: "Synthesizes standard Modelica 3.x fluid process model from Aspen deck.",
      category: "export",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseAspen(text);
        return aspenToModelica(parsed);
      },
    },
    {
      id: "aspen_solve_flash",
      title: "Solve Flash VLE",
      description: "Solves Rachford-Rice vapor-liquid equilibrium flash for feed stream.",
      category: "simulate",
      execute: async (ctx: any, params: { documentText?: string | undefined; streamId?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseAspen(text);
        const streamId = params?.streamId ?? deck.streams.keys().next().value ?? "FEED";
        const s = deck.streams.get(streamId);
        const comps = Array.from(s?.moleFractions.keys() ?? deck.components.keys());
        const fracs = comps.map((c) => s?.moleFractions.get(c) ?? 1.0 / comps.length);
        return solveFlashRachfordRice({
          temperature: s?.temperature ?? 75.0,
          pressure: s?.pressure ?? 1.2,
          components: comps,
          moleFractions: fracs,
          totalFlow: s?.moleFlow ?? 100.0,
        });
      },
    },
  ],
});
