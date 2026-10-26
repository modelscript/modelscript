// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { language } from "@modelscript/dsl";
import { lowerOpenDssToDae } from "./dae/opendss-to-dae.js";
import { lintOpenDss } from "./lints/index.js";
import { parseOpenDss } from "./parser/opendss-parser.js";
import { openDssToModelica } from "./projections/opendss-to-modelica.js";
import { solveDistributionPowerFlow } from "./solvers/power-flow-solver.js";

/**
 * ModelScript EPRI OpenDSS (.dss) Language Definition.
 */
export const openDssLanguage = language({
  name: "opendss",
  fileExtensions: [".dss"],
  lsp: {
    fileExtensions: [".dss"],
    icons: {
      light: "./assets/opendss/icon-light.png",
      dark: "./assets/opendss/icon-dark.png",
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
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
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
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
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
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
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
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseOpenDss(text);
        return openDssToModelica(parsed);
      },
    },
  ],
});
