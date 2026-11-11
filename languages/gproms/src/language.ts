// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerGpromsToDae } from "./dae/gproms-to-dae.js";
import { indexGpromsDocument } from "./indexing.js";
import { lintGproms } from "./lints/index.js";
import { parseGproms } from "./parser/gproms-parser.js";
import { gpromsToModelica } from "./projections/gproms-to-modelica.js";
import { solveGpromsProcess, type GpromsSolverOptions } from "./solvers/gproms-solver.js";

/**
 * ModelScript gPROMS Process Modeling Language (.gproms, .pml) Language Definition.
 */
export const gpromsLanguage = language({
  name: "gproms",
  fileExtensions: [".gproms", ".pml"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".gproms", ".pml"],
    icons: {
      light: "./assets/gproms/icon-light.png",
      dark: "./assets/gproms/icon-dark.png",
    },
  },

  indexing: {
    indexFile: indexGpromsDocument,
  },

  writeback: {
    operators: [":=", "="],
  },

  actions: [
    {
      id: "lint_gproms",
      title: "Lint gPROMS Model",
      description:
        "Validates DECLARE TYPE bounds, distribution domains, structural degrees of freedom, and differential initial conditions.",
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
          name: "gproms_lint",
          displayName: "Lint gPROMS Model",
          modelDescription:
            "Lints gPROMS (.gproms, .pml) file for undeclared types, invalid bounds, DOF mismatches, and uninitialized differential states.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseGproms(text);
        return lintGproms(parsed);
      },
    },
    {
      id: "gproms_simulate",
      title: "Simulate gPROMS Process",
      description:
        "Solves lumped DAE and Method-of-Lines (MOL) spatially discretized 1D tubular PDE-DAE models via RK4.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: GpromsSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseGproms(text);
        return solveGpromsProcess(doc, params?.options);
      },
    },
    {
      id: "gproms_to_dae",
      title: "Lower gPROMS to DAE",
      description:
        "Discretizes DISTRIBUTION_DOMAIN PARTIAL derivatives via finite differences and lowers models into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseGproms(text);
        const dae = lowerGpromsToDae(parsed);
        const firstModel = parsed.models.values().next().value;
        return {
          modelName: firstModel?.name ?? "GpromsModel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "gproms_to_modelica",
      title: "Project gPROMS to Modelica",
      description: "Synthesizes standalone Modelica 3.x process models from gPROMS MODEL and PROCESS blocks.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseGproms(text);
        return gpromsToModelica(parsed, params?.modelName);
      },
    },
  ],
});
