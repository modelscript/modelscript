// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { language } from "@modelscript/dsl";
import { lowerIbisToDae } from "./dae/ibis-to-dae.js";
import { lintIbis } from "./lints/index.js";
import { parseIbis } from "./parser/ibis-parser.js";
import { ibisToModelica } from "./projections/ibis-to-modelica.js";
import { calculateOutputResistance, evaluateBufferCurrent } from "./solvers/buffer-solver.js";

/**
 * ModelScript ANSI/EIA-656-B IBIS (.ibs) Language Definition.
 */
export const ibisLanguage = language({
  name: "ibis",
  fileExtensions: [".ibs"],
  lsp: {
    fileExtensions: [".ibs"],
    icons: {
      light: "./assets/ibis/icon-light.png",
      dark: "./assets/ibis/icon-dark.png",
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
      id: "lint_ibis",
      title: "Lint IBIS Model",
      description: "Validates pin model bindings, voltage ranges, and I/V table monotonicity.",
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
          name: "ibis_lint",
          displayName: "Lint IBIS Deck",
          modelDescription: "Lints IBIS file for pin mismatches, non-monotonic curves, and invalid parasitics.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseIbis(text);
        return lintIbis(parsed);
      },
    },
    {
      id: "ibis_to_dae",
      title: "Lower IBIS to DAE",
      description: "Compiles IBIS buffer and package model directly into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseIbis(text);
        const dae = lowerIbisToDae(parsed);
        return {
          modelName: "IbisBufferModule",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "ibis_to_modelica",
      title: "Project IBIS to Modelica",
      description: "Synthesizes standard Modelica 3.x analog buffer driver model.",
      category: "export",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseIbis(text);
        return ibisToModelica(parsed);
      },
    },
    {
      id: "ibis_eval_buffer",
      title: "Evaluate Buffer Characteristics",
      description: "Computes output dynamic on-resistance and driver currents from I/V curves.",
      category: "simulate",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseIbis(text);
        const firstMod = deck.models.values().next().value;
        if (!firstMod) return null;
        return {
          modelName: firstMod.name,
          resistance: calculateOutputResistance(firstMod),
          currentSample: evaluateBufferCurrent(firstMod, 1.5, 1),
        };
      },
    },
  ],
});
