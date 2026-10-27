// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerOpenScenarioToDae } from "./dae/openscenario-to-dae.js";
import { lintOpenScenario } from "./lints/index.js";
import { parseOpenScenario } from "./parser/openscenario-parser.js";
import { openScenarioToModelica } from "./projections/openscenario-to-modelica.js";
import { simulateScenario, type OrchestratorOptions } from "./solvers/scenario-orchestrator.js";

/**
 * ModelScript ASAM OpenSCENARIO (.xosc, .osc) Language Definition.
 */
export const openScenarioLanguage = language({
  name: "openscenario",
  fileExtensions: [".xosc", ".osc"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".xosc", ".osc"],
    icons: {
      light: "./assets/openscenario/icon-light.png",
      dark: "./assets/openscenario/icon-dark.png",
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
      id: "lint_openscenario",
      title: "Lint OpenSCENARIO",
      description: "Validates actor references, trigger delays, speed limits, and collision envelopes.",
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
          name: "openscenario_lint",
          displayName: "Lint OpenSCENARIO",
          modelDescription: "Lints OpenSCENARIO files for dangling actors, invalid triggers, and initial collisions.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseOpenScenario(text);
        return lintOpenScenario(parsed);
      },
    },
    {
      id: "openscenario_simulate",
      title: "Simulate OpenSCENARIO & Safety Verification",
      description: "Executes scenario events, evaluates TTC, and verifies RSS safety stopping margins.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: OrchestratorOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseOpenScenario(text);
        return simulateScenario(doc, params?.options);
      },
    },
    {
      id: "openscenario_to_dae",
      title: "Lower OpenSCENARIO to DAE",
      description: "Compiles vehicle kinematics and safety equations into DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseOpenScenario(text);
        const dae = lowerOpenScenarioToDae(parsed);
        return {
          modelName: parsed.header.description || "ScenarioSimulation",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "openscenario_to_modelica",
      title: "Project OpenSCENARIO to Modelica",
      description: "Synthesizes standard Modelica 3.x vehicle dynamics and safety verification model.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseOpenScenario(text);
        return openScenarioToModelica(parsed, params?.modelName);
      },
    },
  ],
});
