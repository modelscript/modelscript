// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript Alternative Transients Program (ATP-EMTP) Language Definition.
 */

import { language } from "@modelscript/dsl";
import { simulateAtpCase } from "./analysis/transient-solver.js";
import { lowerAtpToDae } from "./dae/atp-to-dae.js";
import { canIndexAtp, indexAtpDocument } from "./indexing.js";
import { lintAtpCase } from "./lints/index.js";
import { parseAtp } from "./parser/atp-parser.js";
import { writeAtp } from "./parser/atp-writer.js";

export const atpLanguage = language({
  name: "atp",
  fileExtensions: [".atp", ".dat"],
  maturity: "beta",
  indexing: {
    indexFile: indexAtpDocument,
    canIndex: canIndexAtp,
  },
  lsp: {
    fileExtensions: [".atp", ".dat"],
  },

  actions: [
    {
      id: "simulate_atp_transient",
      title: "Simulate Electromagnetic Transient (ATP)",
      description: "Applies Dommel's companion-matrix trapezoidal integration to compute nodal voltage waveforms.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "atp_simulate_transient",
          displayName: "Simulate ATP-EMTP Transient Response",
          modelDescription:
            "Runs Dommel trapezoidal integration on high-voltage electrical network deck, tracking residuals and convergence.",
        },
      },
      execute: async (ctx, params?: { documentText?: string | undefined; maxSteps?: number }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const atpCase = parseAtp(text);
        return simulateAtpCase(atpCase, { maxSteps: params?.maxSteps });
      },
    },
    {
      id: "lower_atp_dae",
      title: "Lower ATP Case to DAE Arena",
      description: "Compiles RLC network, switches, and sources into zero-GC linear memory DAEBuilder arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const atpCase = parseAtp(text);
        const dae = lowerAtpToDae(atpCase);
        return {
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
        };
      },
    },
    {
      id: "lint_atp_deck",
      title: "Lint ATP Card Deck",
      description: "Validates simulation control parameters, branch non-negativity, and switch timing.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const atpCase = parseAtp(text);
        return lintAtpCase(atpCase);
      },
    },
    {
      id: "export_atp_deck",
      title: "Export ATP Card Deck",
      description: "Serializes AtpCase into standard 80-column card deck format.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const atpCase = parseAtp(text);
        return writeAtp(atpCase);
      },
    },
  ],
});
