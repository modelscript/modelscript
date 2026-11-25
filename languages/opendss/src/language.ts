// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerOpenDssToDae } from "./dae/opendss-to-dae.js";
import { openDssGrammar } from "./grammar/opendss-grammar.js";
import { indexOpenDssFile } from "./indexing.js";
import { lintOpenDss } from "./lints/index.js";
import { parseOpenDss } from "./parser/opendss-parser.js";
import { openDssToModelica } from "./projections/opendss-to-modelica.js";
import { solveDistributionPowerFlow } from "./solvers/power-flow-solver.js";
import { opendssPolyglotConfig } from "./tgg/index.js";

/**
 * ModelScript EPRI OpenDSS (.dss) Language Definition.
 */
export const openDssLanguage = language({
  polyglot: opendssPolyglotConfig,
  name: "opendss",
  fileExtensions: [".dss"],
  maturity: "experimental",
  indexing: {
    indexFile: indexOpenDssFile,
  },
  lsp: {
    fileExtensions: [".dss"],
    icons: {
      light: "./assets/opendss/icon-light.png",
      dark: "./assets/opendss/icon-dark.png",
    },
    folding: openDssGrammar.lsp?.folding,
    outline: openDssGrammar.lsp?.outline,
  },
  word: openDssGrammar.word,
  extras: openDssGrammar.extras,
  conflicts: openDssGrammar.conflicts,
  rules: openDssGrammar.rules,

  writeback: {
    operators: ["="],
  },

  ui: {
    panels: [
      {
        id: "opendssEditor",
        viewType: "modelscript.opendssEditor",
        title: "OpenDSS Distribution Feeder Studio",
        shortTitle: "OpenDSS",
        selector: ["*.dss"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/OpenDssPanel.tsx",
        artifactViewTypes: ["opendss", "dss"],
      },
    ],
    stencils: [
      { label: "Bus", snippet: "New Circuit.Bus_New basekv=13.8 pu=1.0\n" },
      { label: "Line", snippet: "New Line.Line_New Bus1=SourceBus Bus2=LoadBus R1=0.05 X1=0.15\n" },
      {
        label: "Transformer",
        snippet: "New Transformer.TR_New Buses=[SourceBus LoadBus] kVs=[13.8 0.48] kVAs=[1000 1000]\n",
      },
      { label: "Load", snippet: "New Load.Load_New Bus1=LoadBus kV=0.48 kW=250 kvar=100\n" },
    ],
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
        id: "opendssPowerflow",
        label: "Solve Distribution Power Flow",
        shortLabel: "Solve",
        tooltip: "Solve Distribution Power Flow",
        icon: "zap",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "opendss_powerflow",
      },
      {
        id: "opendssToDae",
        label: "Lower OpenDSS to DAE",
        shortLabel: "Lower OpenDSS",
        tooltip: "Lower OpenDSS to DAE",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "opendss_to_dae",
      },
      {
        id: "opendssToModelica",
        label: "Project OpenDSS to Modelica",
        shortLabel: "Project OpenDSS",
        tooltip: "Project OpenDSS to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "opendss_to_modelica",
      },
      {
        id: "lintOpendss",
        label: "Lint OpenDSS Circuit",
        shortLabel: "Lint OpenDSS",
        tooltip: "Lint OpenDSS Circuit",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "lint_opendss",
      },
    ],
  },

  actions: [
    {
      id: "lint_opendss",
      title: "Lint OpenDSS Circuit",
      description: "Validates bus connectivity, voltage levels, line lengths, and hosting capacities.",
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
          name: "opendss_lint",
          displayName: "Lint OpenDSS Circuit",
          modelDescription: "Lints OpenDSS file for unconnected buses, hosting capacity limits, and bad line lengths.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseOpenDss(text);
        return lintOpenDss(parsed);
      },
    },
    {
      id: "opendss_powerflow",
      title: "Solve Distribution Power Flow",
      description: "Calculates radial/meshed forward-backward sweep distribution power flow and voltages.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseOpenDss(text);
        return solveDistributionPowerFlow(deck);
      },
    },
    {
      id: "opendss_to_dae",
      title: "Lower OpenDSS to DAE",
      description: "Compiles distribution network lines, transformers, and loads into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseOpenDss(text);
        const dae = lowerOpenDssToDae(parsed);
        return {
          modelName: parsed.circuit?.name || "DistributionGrid",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "opendss_to_modelica",
      title: "Project OpenDSS to Modelica",
      description: "Synthesizes standard Modelica 3.x distribution grid electrical circuit.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseOpenDss(text);
        return openDssToModelica(parsed);
      },
    },
  ],
});

export const opendssLanguage = openDssLanguage;
export default openDssLanguage;
