// SPDX-License-Identifier: AGPL-3.0-or-later

import { language } from "@modelscript/dsl";
import { lowerJsbsimToDae } from "./dae/jsbsim-to-dae.js";
import { lintJsbsim } from "./lints/index.js";
import { parseJsbsim } from "./parser/jsbsim-parser.js";
import { jsbsimToModelica } from "./projections/jsbsim-to-modelica.js";
import { solveFlightDynamics, type FlightSolverOptions } from "./solvers/flight-solver.js";

interface JsbsimActionContext {
  documentText?: string | undefined;
}

/**
 * ModelScript JSBSim 2.0 Aircraft Flight Dynamics (.xml) Language Definition.
 */
export const jsbsimLanguage = language({
  name: "jsbsim",
  fileExtensions: [".jsbsim", ".jsbsim.xml", ".xml"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".jsbsim", ".jsbsim.xml", ".xml"],
    icons: {
      light: "./assets/jsbsim/icon-light.png",
      dark: "./assets/jsbsim/icon-dark.png",
    },
  },
  indexing: {
    canIndex: (uri, text) =>
      uri.toLowerCase().endsWith(".jsbsim") ||
      uri.toLowerCase().endsWith(".jsbsim.xml") ||
      Boolean(text && text.includes("<fdm_config")),
    indexFile(ctx) {
      try {
        const doc = parseJsbsim(ctx.text, ctx.uri);
        ctx.setParsedModel(doc);
        const m = doc.model;

        const rootId = ctx.addSymbol(
          m.name || "AircraftModel",
          "package",
          null,
          0,
          ctx.text.length,
          {
            version: m.version,
            wingArea: m.metrics.wingArea,
            emptyWeight: m.massBalance.emptyWeight,
            enginesCount: m.engines.length,
          },
          { ruleName: "jsbsim_symbol" },
        );

        if (m.metrics) {
          const start = m.metrics.range?.startOffset ?? 0;
          const end = m.metrics.range?.endOffset ?? 50;
          ctx.addSymbol(
            "AirframeMetrics",
            "struct",
            rootId,
            start,
            end,
            {
              wingArea: m.metrics.wingArea,
              wingspan: m.metrics.wingspan,
              chord: m.metrics.chord,
            },
            { ruleName: "jsbsim_symbol" },
          );
        }

        if (m.massBalance) {
          const start = m.massBalance.range?.startOffset ?? 0;
          const end = m.massBalance.range?.endOffset ?? 50;
          ctx.addSymbol(
            "MassBalance",
            "struct",
            rootId,
            start,
            end,
            {
              emptyWeight: m.massBalance.emptyWeight,
              ixx: m.massBalance.ixx,
              iyy: m.massBalance.iyy,
              izz: m.massBalance.izz,
            },
            { ruleName: "jsbsim_symbol" },
          );
        }

        for (const g of m.groundReactions) {
          const start = g.range?.startOffset ?? 0;
          const end = g.range?.endOffset ?? 50;
          ctx.addSymbol(
            `Gear_${g.name}`,
            "component",
            rootId,
            start,
            end,
            {
              type: g.type,
              steerable: g.steerable,
            },
            { ruleName: "jsbsim_symbol" },
          );
        }

        for (const e of m.engines) {
          const start = e.range?.startOffset ?? 0;
          const end = e.range?.endOffset ?? 50;
          ctx.addSymbol(
            `Engine_${e.name}`,
            "component",
            rootId,
            start,
            end,
            { maxThrust: e.maxThrust },
            { ruleName: "jsbsim_symbol" },
          );
        }

        for (const c of m.aeroCoefficients) {
          const start = c.range?.startOffset ?? 0;
          const end = c.range?.endOffset ?? 50;
          ctx.addSymbol(
            c.name,
            "variable",
            rootId,
            start,
            end,
            { axis: c.axis, baseValue: c.baseValue },
            { ruleName: "jsbsim_symbol" },
          );
        }
      } catch {
        // Return partial symbol map if parsing failed
      }
    },
  },

  writeback: {
    operators: ["="],
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
      execute: async (ctx: JsbsimActionContext | undefined, params: { documentText?: string | undefined }) => {
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
      execute: async (
        ctx: JsbsimActionContext | undefined,
        params: { documentText?: string | undefined; options?: FlightSolverOptions | undefined },
      ) => {
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
      execute: async (ctx: JsbsimActionContext | undefined, params: { documentText?: string | undefined }) => {
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
      execute: async (
        ctx: JsbsimActionContext | undefined,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseJsbsim(text);
        return jsbsimToModelica(parsed, params?.modelName);
      },
    },
  ],
});
