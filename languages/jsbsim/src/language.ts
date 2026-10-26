// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { language } from "@modelscript/dsl";
import { lowerJsbsimToDae } from "./dae/jsbsim-to-dae.js";
import { lintJsbsim } from "./lints/index.js";
import { parseJsbsim } from "./parser/jsbsim-parser.js";
import { jsbsimToModelica } from "./projections/jsbsim-to-modelica.js";
import { solveFlightDynamics } from "./solvers/flight-solver.js";

/**
 * ModelScript JSBSim 2.0 Aircraft Flight Dynamics (.xml) Language Definition.
 */
export const jsbsimLanguage = language({
  name: "jsbsim",
  fileExtensions: [".xml"],
  lsp: {
    fileExtensions: [".xml"],
    icons: {
      light: "./assets/jsbsim/icon-light.png",
      dark: "./assets/jsbsim/icon-dark.png",
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
      id: "lint_jsbsim",
      title: "Lint JSBSim Model",
      description: "Validates airframe metrics, inertia tensor, propulsion, and aerodynamic coefficients.",
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
          name: "jsbsim_lint",
          displayName: "Lint JSBSim Model",
          modelDescription:
            "Lints JSBSim XML file for negative wing areas, non-physical inertias, and missing aerodynamics.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseJsbsim(text);
        return lintJsbsim(parsed);
      },
    },
    {
      id: "jsbsim_simulate",
      title: "Simulate 6-DOF Flight Dynamics",
      description: "Integrates rigid-body 6 degrees-of-freedom equations of motion coupled with aerodynamic forces.",
      category: "simulate",
      execute: async (ctx: any, params: { documentText?: string | undefined; options?: any }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseJsbsim(text);
        return solveFlightDynamics(doc, params?.options);
      },
    },
    {
      id: "jsbsim_to_dae",
      title: "Lower JSBSim to DAE",
      description: "Compiles 6-DOF flight dynamics equations of motion into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseJsbsim(text);
        const dae = lowerJsbsimToDae(parsed);
        return {
          modelName: parsed.model.name || "JsbsimAircraft",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "jsbsim_to_modelica",
      title: "Project JSBSim to Modelica",
      description: "Synthesizes standard Modelica 3.x 6-DOF aircraft flight mechanics simulation model.",
      category: "export",
      execute: async (ctx: any, params: { documentText?: string | undefined; modelName?: string }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseJsbsim(text);
        return jsbsimToModelica(parsed, params?.modelName);
      },
    },
  ],
});
