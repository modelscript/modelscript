// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerPhreeqcToDae } from "./dae/phreeqc-to-dae.js";
import { lintPhreeqc } from "./lints/index.js";
import { parsePhreeqc } from "./parser/phreeqc-parser.js";
import { phreeqcToModelica } from "./projections/phreeqc-to-modelica.js";
import { solvePhreeqcSpeciation, type SpeciationSolverOptions } from "./solvers/speciation-solver.js";

/**
 * ModelScript USGS PHREEQC Aqueous Geochemistry & Reactive Transport (.pqi, .dat) Language Definition.
 */
export const phreeqcLanguage = language({
  name: "phreeqc",
  fileExtensions: [".pqi", ".dat"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".pqi", ".dat"],
    icons: {
      light: "./assets/phreeqc/icon-light.png",
      dark: "./assets/phreeqc/icon-dark.png",
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
      id: "lint_phreeqc",
      title: "Lint PHREEQC Deck",
      description:
        "Validates pH/pe/temperature bounds, solute concentrations, electrical charge balance, and mineral phases.",
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
          name: "phreeqc_lint",
          displayName: "Lint PHREEQC Geochemical Deck",
          modelDescription:
            "Lints PHREEQC (.pqi/.dat) deck for pH/pe bounds, charge imbalance, unknown species, and mineral phases.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parsePhreeqc(text);
        return lintPhreeqc(parsed);
      },
    },
    {
      id: "phreeqc_speciate",
      title: "Solve Aqueous Speciation & Saturation Indices",
      description:
        "Computes ionic strength, Davies activity coefficients, carbonate speciation, and mineral saturation indices.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: SpeciationSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parsePhreeqc(text);
        return solvePhreeqcSpeciation(doc, params?.options);
      },
    },
    {
      id: "phreeqc_to_dae",
      title: "Lower PHREEQC to DAE",
      description:
        "Compiles aqueous species, Davies activity coefficients, carbonate equilibria, and kinetic mineral rates into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parsePhreeqc(text);
        const dae = lowerPhreeqcToDae(parsed);
        return {
          modelName: parsed.title ?? "PhreeqcAqueousSystem",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "phreeqc_to_modelica",
      title: "Project PHREEQC to Modelica",
      description: "Synthesizes standalone Modelica 3.x aqueous chemistry, speciation, and mineral kinetics equations.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parsePhreeqc(text);
        return phreeqcToModelica(parsed, params?.modelName);
      },
    },
  ],
});
