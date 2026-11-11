// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — AMPL Language Definition and Action Handlers.
 */

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerAmplToDae } from "./dae/index.js";
import { canIndexAmpl, indexAmplDocument } from "./indexing.js";
import { instantiateAmpl } from "./instantiator/index.js";
import { lintAmpl } from "./lints/index.js";
import { writeMpsProblem } from "./mps/index.js";
import { writeNlProblem } from "./nl/index.js";
import { parseAmplData } from "./parser/ampl-dat-parser.js";
import { parseAmplModel } from "./parser/ampl-mod-parser.js";
import { amplToModelica } from "./projections/ampl-to-modelica.js";
import { runAmplScript } from "./runtime/index.js";
import { solveAmpl } from "./solvers/index.js";
import type { AmplSolverOptions } from "./types.js";

export const amplLanguage = language({
  name: "ampl",
  fileExtensions: [".mod", ".dat", ".run", ".ampl", ".mps"],
  maturity: "beta",
  indexing: {
    indexFile: indexAmplDocument,
    canIndex: canIndexAmpl,
  },
  lsp: {
    fileExtensions: [".mod", ".dat", ".run", ".ampl", ".mps"],
  },

  writeback: {
    operators: [":=", "="],
  },

  actions: [
    {
      id: "ampl_lint",
      title: "Lint AMPL Model",
      description: "Validates set references, parameter bounds, variable types, and constraint linearity.",
      category: "query",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; dataText?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const model = parseAmplModel(text);
        const data = params?.dataText ? parseAmplData(params.dataText) : undefined;
        return lintAmpl(model, data);
      },
    },
    {
      id: "ampl_solve",
      title: "Solve AMPL Optimization Problem",
      description: "Solves linear (CLP), mixed-integer (CBC), or non-linear (IPOPT) mathematical programs.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: {
          documentText?: string | undefined;
          dataText?: string | undefined;
          options?: AmplSolverOptions | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseAmplModel(text);
        const data = params?.dataText ? parseAmplData(params.dataText) : undefined;
        const instantiated = instantiateAmpl(model, data);
        return solveAmpl(instantiated, params?.options);
      },
    },
    {
      id: "ampl_run",
      title: "Execute AMPL .run Script",
      description: "Executes an imperative AMPL .run script with loops, let/fix/drop mutations, and solve sequences.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: {
          documentText?: string | undefined;
          virtualFiles?: Record<string, string> | undefined;
          options?: AmplSolverOptions | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        return runAmplScript(text, {
          virtualFiles: params?.virtualFiles,
          solverOptions: params?.options,
        });
      },
    },
    {
      id: "ampl_to_dae",
      title: "Lower AMPL to DAEBuilder",
      description: "Lowers decision variables and equality/slack constraints into ModelScript's DAE arena.",
      category: "transform",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; dataText?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseAmplModel(text);
        const data = params?.dataText ? parseAmplData(params.dataText) : undefined;
        const instantiated = instantiateAmpl(model, data);
        const dae = lowerAmplToDae(instantiated);
        return {
          problemName: instantiated.name,
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "ampl_to_nl",
      title: "Export to AMPL .nl Format",
      description: "Generates an ASL standard ASCII .nl file for external solvers (HiGHS, Gurobi, CPLEX, KNITRO).",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; dataText?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const model = parseAmplModel(text);
        const data = params?.dataText ? parseAmplData(params.dataText) : undefined;
        const instantiated = instantiateAmpl(model, data);
        return writeNlProblem(instantiated);
      },
    },
    {
      id: "ampl_to_mps",
      title: "Export to MPS Format",
      description:
        "Generates an industry-standard Fixed/Free MPS file for LP/MILP solvers (CPLEX, HiGHS, Gurobi, CBC, SCIP).",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; dataText?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const model = parseAmplModel(text);
        const data = params?.dataText ? parseAmplData(params.dataText) : undefined;
        const instantiated = instantiateAmpl(model, data);
        return writeMpsProblem(instantiated);
      },
    },
    {
      id: "ampl_to_modelica",
      title: "Lower AMPL to Modelica",
      description: "Generates an equivalent acausal Modelica optimization model.",
      category: "transform",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; dataText?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const model = parseAmplModel(text);
        const data = params?.dataText ? parseAmplData(params.dataText) : undefined;
        const instantiated = instantiateAmpl(model, data);
        return amplToModelica(instantiated);
      },
    },
  ],
});
