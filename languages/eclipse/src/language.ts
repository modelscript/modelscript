// SPDX-License-Identifier: AGPL-3.0-or-later

import { cardDeckRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInEclipseLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerEclipseToDae } from "./dae/eclipse-to-dae.js";
import { canIndexEclipse, indexEclipseDocument } from "./indexing.js";
import { lintEclipse } from "./lints/index.js";
import { parseEclipse } from "./parser/eclipse-parser.js";
import { eclipseToModelica } from "./projections/eclipse-to-modelica.js";
import { solveReservoirDepletion, type ReservoirSolverOptions } from "./solvers/reservoir-solver.js";
import { eclipsePolyglotConfig } from "./tgg/index.js";

/**
 * ModelScript Schlumberger ECLIPSE Reservoir (.data, .dat, .inc) Language Definition.
 */
export const eclipseLanguage = language({
  polyglot: eclipsePolyglotConfig,
  name: "eclipse",
  fileExtensions: [".data", ".dat", ".inc"],
  maturity: "experimental",
  indexing: {
    indexFile: indexEclipseDocument,
    canIndex: canIndexEclipse,
  },
  lsp: {
    fileExtensions: [".data", ".dat", ".inc"],
    icons: {
      light: "./assets/eclipse/icon-light.png",
      dark: "./assets/eclipse/icon-dark.png",
    },
  },

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
        id: "eclipseReservoirSolve",
        label: "Solve Reservoir Depletion",
        shortLabel: "Solve Reservoir",
        tooltip: "Solve Reservoir Depletion",
        icon: "play",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "eclipse_reservoir_solve",
      },
      {
        id: "eclipseToDae",
        label: "Lower ECLIPSE to DAE",
        shortLabel: "Lower ECLIPSE",
        tooltip: "Lower ECLIPSE to DAE",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "eclipse_to_dae",
      },
      {
        id: "eclipseToModelica",
        label: "Project ECLIPSE to Modelica",
        shortLabel: "Project ECLIPSE",
        tooltip: "Project ECLIPSE to Modelica",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "eclipse_to_modelica",
      },
      {
        id: "lintEclipse",
        label: "Lint ECLIPSE Reservoir Deck",
        shortLabel: "Lint ECLIPSE",
        tooltip: "Lint ECLIPSE Reservoir Deck",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "lint_eclipse",
      },
    ],
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
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
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
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: ReservoirSolverOptions | undefined },
      ) => {
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
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
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
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseEclipse(text);
        return eclipseToModelica(parsed, params?.modelName);
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default eclipseLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInEclipseLibrarySync();
