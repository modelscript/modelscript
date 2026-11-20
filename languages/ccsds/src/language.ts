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
import { canIndexCcsds, indexCcsdsDocument } from "./indexing.js";
import { lintCcsds } from "./lints/rules.js";
import { parseCcsds } from "./parser/index.js";
import { ccsdsToModelica } from "./projections/ccsds-to-modelica.js";
import { ccsdsToSysml } from "./projections/ccsds-to-sysml.js";
import { ccsdsPolyglotConfig } from "./tgg/index.js";

export const ccsdsLanguage = language({
  polyglot: ccsdsPolyglotConfig,
  name: "ccsds",
  fileExtensions: [".oem", ".opm", ".omm", ".xtce", ".xml"],
  maturity: "experimental",
  indexing: {
    indexFile: indexCcsdsDocument,
    canIndex: canIndexCcsds,
  },
  lsp: {
    fileExtensions: [".oem", ".opm", ".omm", ".xtce", ".xml"],
  },
  rules: {
    Root: () => "ccsds",
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
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        command: "morsel:autoLayout",
      },
      {
        id: "ccsdsToDae",
        label: "Lower CCSDS to DAE Arena",
        shortLabel: "Lower CCSDS",
        tooltip: "Lower CCSDS to DAE Arena",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 20,
        actionId: "ccsds_to_dae",
      },
      {
        id: "ccsdsToModelica",
        label: "Export to Modelica Astrodynamics Model",
        shortLabel: "Export to",
        tooltip: "Export to Modelica Astrodynamics Model",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "primary",
        order: 30,
        actionId: "ccsds_to_modelica",
      },
      {
        id: "ccsdsToSysml",
        label: "Export to SysML v2 Mission Architecture",
        shortLabel: "Export to",
        tooltip: "Export to SysML v2 Mission Architecture",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "ccsds_to_sysml",
      },
      {
        id: "ccsdsLint",
        label: "Lint CCSDS Orbit & Telemetry",
        shortLabel: "Lint CCSDS",
        tooltip: "Lint CCSDS Orbit & Telemetry",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "ccsds_lint",
      },
    ],
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
