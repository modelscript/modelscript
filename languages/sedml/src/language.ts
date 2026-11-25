// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, xmlRules, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerSedmlToDae } from "./dae/sedml-to-dae.js";
import { sedmlIndexing } from "./indexing.js";
import { lintSedml } from "./lints/index.js";
import { parseSedml } from "./parser/sedml-parser.js";
import { sedmlToModelica } from "./projections/sedml-to-modelica.js";
import { executeSedmlExperiment, type SedmlRunnerOptions } from "./solvers/sedml-runner.js";
import { sedmlPolyglotConfig } from "./tgg/index.js";

/**
 * ModelScript Simulation Experiment Description Markup Language (.sedml, .xml) Language Definition.
 */
export const sedmlLanguage = language({
  polyglot: sedmlPolyglotConfig,
  name: "sedml",
  fileExtensions: [".sedml", ".xml"],
  maturity: "experimental",
  indexing: sedmlIndexing,
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
        id: "sedmlSimulate",
        label: "Execute SED-ML Experiment",
        shortLabel: "Execute SED-ML",
        tooltip: "Execute SED-ML Experiment",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "sedml_simulate",
      },
      {
        id: "sedmlToDae",
        label: "Lower SED-ML to DAE",
        shortLabel: "Lower SED-ML",
        tooltip: "Lower SED-ML to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "sedml_to_dae",
      },
      {
        id: "sedmlToModelica",
        label: "Project SED-ML to Modelica",
        shortLabel: "Project SED-ML",
        tooltip: "Project SED-ML to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "sedml_to_modelica",
      },
      {
        id: "lintSedml",
        label: "Lint SED-ML Experiment",
        shortLabel: "Lint SED-ML",
        tooltip: "Lint SED-ML Experiment",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "lint_sedml",
      },
    ],
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
  extras: () => [/[ \t\r\n]+/],
  rules: xmlRules,
});

export default sedmlLanguage;
