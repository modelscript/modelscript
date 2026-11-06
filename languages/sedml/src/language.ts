// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerSedmlToDae } from "./dae/sedml-to-dae.js";
import { lintSedml } from "./lints/index.js";
import { parseSedml } from "./parser/sedml-parser.js";
import { sedmlToModelica } from "./projections/sedml-to-modelica.js";
import { executeSedmlExperiment, type SedmlRunnerOptions } from "./solvers/sedml-runner.js";

/**
 * ModelScript Simulation Experiment Description Markup Language (.sedml, .xml) Language Definition.
 */
export const sedmlLanguage = language({
  name: "sedml",
  fileExtensions: [".sedml", ".xml"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".sedml", ".xml"],
    icons: {
      light: "./assets/sedml/icon-light.png",
      dark: "./assets/sedml/icon-dark.png",
    },
  },

  writeback: {
    operators: ["="],
  },

  actions: [
    {
      id: "lint_sedml",
      title: "Lint SED-ML Experiment",
      description:
        "Validates time-course bounds, KiSAO solver IDs, model/task/dataGenerator references, and MathML variables.",
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
          name: "sedml_lint",
          displayName: "Lint SED-ML Experiment",
          modelDescription:
            "Lints SED-ML file for invalid time bounds, malformed KiSAO IDs, and unresolved references.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseSedml(text);
        return lintSedml(parsed);
      },
    },
    {
      id: "sedml_simulate",
      title: "Execute SED-ML Experiment",
      description:
        "Executes uniform time courses, model changes, and post-processing data generators to produce plots and reports.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: SedmlRunnerOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseSedml(text);
        return executeSedmlExperiment(doc, params?.options);
      },
    },
    {
      id: "sedml_to_dae",
      title: "Lower SED-ML to DAE",
      description:
        "Compiles simulation time-course parameters, model overrides, and data generator equations into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseSedml(text);
        const dae = lowerSedmlToDae(parsed);
        return {
          modelName: parsed.models[0]?.id || "SedmlExperiment",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "sedml_to_modelica",
      title: "Project SED-ML to Modelica",
      description:
        "Synthesizes a Modelica 3.x simulation experiment model with experiment(StartTime, StopTime, NumberOfIntervals) annotation.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseSedml(text);
        return sedmlToModelica(parsed, params?.modelName);
      },
    },
  ],
});
