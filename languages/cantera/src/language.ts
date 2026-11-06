// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerCanteraToDae } from "./dae/cantera-to-dae.js";
import { lintCantera } from "./lints/index.js";
import { parseCantera } from "./parser/cantera-parser.js";
import { canteraToModelica } from "./projections/cantera-to-modelica.js";
import { solveCanteraReactor, type CanteraReactorOptions } from "./solvers/kinetics-solver.js";

/**
 * ModelScript Cantera Chemical Kinetics & Thermochemistry (.yaml, .cti) Language Definition.
 */
export const canteraLanguage = language({
  name: "cantera",
  fileExtensions: [".yaml", ".cti"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".yaml", ".cti"],
    icons: {
      light: "./assets/cantera/icon-light.png",
      dark: "./assets/cantera/icon-dark.png",
    },
  },

  writeback: {
    operators: [":", "="],
  },

  actions: [
    {
      id: "lint_cantera",
      title: "Lint Cantera Mechanism",
      description:
        "Validates atomic element balance, charge conservation, NASA-7 polynomial continuity, and Arrhenius parameters.",
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
          name: "cantera_lint",
          displayName: "Lint Cantera Mechanism",
          modelDescription:
            "Lints Cantera YAML or CTI mechanism for element/charge imbalance, NASA-7 discontinuities, and reaction rate errors.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseCantera(text);
        return lintCantera(parsed);
      },
    },
    {
      id: "cantera_simulate",
      title: "Simulate Gas-Phase Batch Reactor",
      description:
        "Integrates gas-phase chemical kinetics ODEs with NASA-7 equilibrium reverse rates and Troe falloff.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: {
          documentText?: string | undefined;
          options?: CanteraReactorOptions | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseCantera(text);
        return solveCanteraReactor(doc, params?.options);
      },
    },
    {
      id: "cantera_to_dae",
      title: "Lower Cantera Mechanism to DAE",
      description:
        "Compiles species concentrations, Arrhenius forward rates, and molar production ODEs into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseCantera(text);
        const dae = lowerCanteraToDae(parsed);
        return {
          modelName: parsed.mechanism.name || "CanteraMechanism",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "cantera_to_modelica",
      title: "Project Cantera to Modelica",
      description: "Synthesizes standalone Modelica 3.x gas-phase chemical kinetics equations and rate variables.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseCantera(text);
        return canteraToModelica(parsed, params?.modelName);
      },
    },
  ],
});
