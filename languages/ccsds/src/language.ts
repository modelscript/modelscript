// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Language Definition.
 *
 * Registers CCSDS (.oem, .opm, .omm) and OMG XTCE (.xtce, .xml) file extensions,
 * pre-flight astrodynamic linter diagnostics, Cowell orbit propagator, DAE lowering,
 * Modelica export, and SysML v2 export.
 */

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerCcsdsToDae } from "./dae/ccsds-to-dae.js";
import { lintCcsds } from "./lints/rules.js";
import { parseCcsds } from "./parser/index.js";
import { ccsdsToModelica } from "./projections/ccsds-to-modelica.js";
import { ccsdsToSysml } from "./projections/ccsds-to-sysml.js";

export const ccsdsLanguage = language({
  name: "ccsds",
  fileExtensions: [".oem", ".opm", ".omm", ".xtce"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".oem", ".opm", ".omm", ".xtce"],
  },
  rules: {
    Root: () => "ccsds",
  },

  actions: [
    {
      id: "ccsds_lint",
      title: "Lint CCSDS Orbit & Telemetry",
      description: "Runs pre-flight sub-orbital impact, reference frame, and telemetry bit-packing checks.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseCcsds(text, context["documentUri"] as string | undefined);
        return lintCcsds(doc);
      },
    },
    {
      id: "ccsds_to_dae",
      title: "Lower CCSDS to DAE Arena",
      description: "Emits 6-DOF Cowell perturbed orbital equations of motion in ModelScript linear memory.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseCcsds(text, context["documentUri"] as string | undefined);
        const arena = lowerCcsdsToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "ccsds_to_modelica",
      title: "Export to Modelica Astrodynamics Model",
      description: "Translates orbital state vectors into continuous Modelica 3.x orbital simulation models.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseCcsds(text, context["documentUri"] as string | undefined);
        return ccsdsToModelica(doc);
      },
    },
    {
      id: "ccsds_to_sysml",
      title: "Export to SysML v2 Mission Architecture",
      description: "Translates XTCE telemetry dictionaries into SysML v2 port definitions and command handlers.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseCcsds(text, context["documentUri"] as string | undefined);
        return ccsdsToSysml(doc);
      },
    },
  ],
});
