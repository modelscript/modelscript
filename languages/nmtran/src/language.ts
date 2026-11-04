// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerNmtranToDae } from "./dae/nmtran-to-dae.js";
import { lintNmtran } from "./lints/index.js";
import { parseNmtran } from "./parser/nmtran-parser.js";
import { nmtranToModelica } from "./projections/nmtran-to-modelica.js";
import { solveNmtranPkPd, type PkPdSolverOptions } from "./solvers/pkpd-solver.js";

/**
 * ModelScript NONMEM / NMTRAN Pharmacometrics (.ctl, .mod) Language Definition.
 */
export const nmtranLanguage = language({
  name: "nmtran",
  fileExtensions: [".ctl", ".mod"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".ctl", ".mod"],
    icons: {
      light: "./assets/nmtran/icon-light.png",
      dark: "./assets/nmtran/icon-dark.png",
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
      id: "lint_nmtran",
      title: "Lint NMTRAN Control Stream",
      description: "Validates $PROBLEM, $THETA bounds, $OMEGA variances, $DES compartments, and $PK TRANS parameters.",
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
          name: "nmtran_lint",
          displayName: "Lint NMTRAN Control Stream",
          modelDescription:
            "Lints NONMEM / NMTRAN control stream for bounds violations, missing $DES/$ERROR blocks, and undefined THETA/ETA references.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseNmtran(text);
        return lintNmtran(parsed);
      },
    },
    {
      id: "nmtran_simulate",
      title: "Simulate PK/PD Control Stream",
      description:
        "Simulates compartmental and custom $DES PK/PD trajectories across bolus, infusion, and multi-dose regimens.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: PkPdSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseNmtran(text);
        return solveNmtranPkPd(doc, params?.options);
      },
    },
    {
      id: "nmtran_to_dae",
      title: "Lower NMTRAN to DAE",
      description: "Compiles $THETA parameters, $PK equations, and compartment ODEs into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseNmtran(text);
        const dae = lowerNmtranToDae(parsed);
        return {
          modelName: parsed.controlStream.problem || "NmtranPkPdModel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "nmtran_to_modelica",
      title: "Project NMTRAN to Modelica",
      description: "Synthesizes standalone Modelica 3.x pharmacokinetic and pharmacodynamic compartment equations.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseNmtran(text);
        return nmtranToModelica(parsed, params?.modelName);
      },
    },
  ],
});
