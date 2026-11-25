// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Language Definition.
 *
 * Registers CellML 1.0 / 1.1 / 2.0 (.cellml, .xml) file extensions, biophysical linting (M9301–M9310),
 * RK4 / Rush-Larsen electrophysiology ODE simulation, DAEBuilder lowering, and Modelica / SBML projections.
 */

import { language, xmlRules, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerCellmlToDae } from "./dae/index.js";
import { canIndexCellml, indexCellmlDocument } from "./indexing.js";
import { lintCellmlDocument } from "./lints/index.js";
import { parseCellml } from "./parser/index.js";
import { cellmlToModelica, cellmlToSbml } from "./projections/index.js";
import { solveCellml, type CellmlSolverOptions } from "./solvers/index.js";
import { cellmlPolyglotConfig } from "./tgg/index.js";

export const cellmlLanguage = language({
  polyglot: cellmlPolyglotConfig,
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
  extras: () => [/[ \t\r\n]+/],
  rules: xmlRules,

  writeback: {
    operators: ["="],
  },

  ui: {
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "cellmlSimulate",
        label: "Simulate CellML Electrophysiology & Cellular ODEs",
        shortLabel: "Simulate CellML",
        tooltip: "Simulate CellML Electrophysiology & Cellular ODEs",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "cellml_simulate",
      },
      {
        id: "cellmlToDae",
        label: "Lower CellML Model to DAEBuilder Arena",
        shortLabel: "Lower CellML",
        tooltip: "Lower CellML Model to DAEBuilder Arena",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "cellml_to_dae",
      },
      {
        id: "cellmlToModelica",
        label: "Project CellML to Modelica 3.x",
        shortLabel: "Project CellML",
        tooltip: "Project CellML to Modelica 3.x",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "cellml_to_modelica",
      },
      {
        id: "cellmlToSbml",
        label: "Project CellML to SBML Level 3",
        shortLabel: "Project CellML",
        tooltip: "Project CellML to SBML Level 3",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "cellml_to_sbml",
      },
      {
        id: "cellmlLint",
        label: "Lint CellML Model (M9301–M9310)",
        shortLabel: "Lint CellML",
        tooltip: "Lint CellML Model (M9301–M9310)",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "cellml_lint",
      },
    ],
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
