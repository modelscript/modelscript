// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Language Definition.
 *
 * Registers CellML 1.0 / 1.1 / 2.0 (.cellml, .xml) file extensions, biophysical linting (M9301–M9310),
 * RK4 / Rush-Larsen electrophysiology ODE simulation, DAEBuilder lowering, and Modelica / SBML projections.
 */

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerCellmlToDae } from "./dae/index.js";
import { canIndexCellml, indexCellmlDocument } from "./indexing.js";
import { lintCellmlDocument } from "./lints/index.js";
import { parseCellml } from "./parser/index.js";
import { cellmlToModelica, cellmlToSbml } from "./projections/index.js";
import { solveCellml, type CellmlSolverOptions } from "./solvers/index.js";

export const cellmlLanguage = language({
  name: "cellml",
  fileExtensions: [".cellml", ".xml"],
  maturity: "experimental",
  indexing: {
    indexFile: indexCellmlDocument,
    canIndex: canIndexCellml,
  },
  lsp: {
    fileExtensions: [".cellml", ".xml"],
  },
  rules: {
    Root: () => "cellml",
  },

  writeback: {
    operators: ["="],
  },

  actions: [
    {
      id: "cellml_lint",
      title: "Lint CellML Model (M9301–M9310)",
      description:
        "Validates CellML units, component interfaces, encapsulation hierarchy, and Content MathML equations.",
      category: "verify",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText ?? "";
        if (!text) return [];
        return lintCellmlDocument(parseCellml(text));
      },
    },
    {
      id: "cellml_simulate",
      title: "Simulate CellML Electrophysiology & Cellular ODEs",
      description: "Integrates multi-compartment CellML ODEs and algebraic equations via RK4 / Rush-Larsen.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params?: { documentText?: string | undefined; options?: CellmlSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText ?? "";
        if (!text) return null;
        return solveCellml(parseCellml(text), params?.options);
      },
    },
    {
      id: "cellml_to_dae",
      title: "Lower CellML Model to DAEBuilder Arena",
      description: "Lowers component variables, connection aliases, algebraic equations, and ODEs into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText ?? "";
        if (!text) return null;
        const doc = parseCellml(text);
        const dae = lowerCellmlToDae(doc);
        return {
          modelName: doc.name || "CellmlModel",
          variableCount: dae.getVarCount(),
          equationCount: dae.getEqCount(),
        };
      },
    },
    {
      id: "cellml_to_modelica",
      title: "Project CellML to Modelica 3.x",
      description: "Projects CellML components, connections, and ODEs into a standalone Modelica 3.x model.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText ?? "";
        if (!text) return "";
        return cellmlToModelica(parseCellml(text));
      },
    },
    {
      id: "cellml_to_sbml",
      title: "Project CellML to SBML Level 3",
      description: "Projects CellML ODEs, algebraic rules, and variables into SBML Level 3 Version 2 XML.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText ?? "";
        if (!text) return "";
        return cellmlToSbml(parseCellml(text));
      },
    },
  ],
});
