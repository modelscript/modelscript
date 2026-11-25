// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/topas — Language Definition.
 *
 * Registers TOPAS (.topas) and GATE (.mac) file extensions,
 * Monte Carlo & hadrontherapy linting (M9601–M9610), Bortfeld Bragg peak evaluation,
 * linear-memory DAE lowering, and OpenSCAD / Modelica projections.
 */

import { language } from "@modelscript/dsl";
import { topasDeckGrammar } from "./grammar/topas-grammar.js";
import { indexTopasFile } from "./indexing.js";
import { lintTopasDocument } from "./lints/rules.js";
import { parseTopas } from "./parser/index.js";
import { computeBraggPeakDepthDose, lowerTopasToDae } from "./physics/index.js";
import { topasToModelica, topasToScad } from "./projections/index.js";
import { topasPolyglotConfig } from "./tgg/index.js";

export const topasLanguage = language({
  polyglot: topasPolyglotConfig,
  name: "topas",
  fileExtensions: [".topas", ".mac"],
  maturity: "experimental",
  indexing: {
    indexFile: indexTopasFile,
  },
  lsp: {
    fileExtensions: [".topas", ".mac"],
    folding: topasDeckGrammar.lsp?.folding,
    outline: topasDeckGrammar.lsp?.outline,
  },
  word: topasDeckGrammar.word,
  extras: topasDeckGrammar.extras,
  rules: topasDeckGrammar.rules,

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
        id: "topasBraggPeak",
        label: "Compute Analytical Proton/Ion Bragg Peak Depth-Dose Curve",
        shortLabel: "Compute",
        tooltip: "Compute Analytical Proton/Ion Bragg Peak Depth-Dose Curve",
        icon: "pulse",
        views: ["3d", "simulation"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "topas_bragg_peak",
      },
      {
        id: "topasToDae",
        label: "Lower TOPAS / GATE Model to DAE Arena",
        shortLabel: "Lower TOPAS",
        tooltip: "Lower TOPAS / GATE Model to DAE Arena",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "topas_to_dae",
      },
      {
        id: "topasToScad",
        label: "Export TOPAS Geometry to OpenSCAD (.scad)",
        shortLabel: "Export TOPAS",
        tooltip: "Export TOPAS Geometry to OpenSCAD (.scad)",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "topas_to_scad",
      },
      {
        id: "topasToModelica",
        label: "Export TOPAS Setup to Modelica 3.x Hadrontherapy Model",
        shortLabel: "Export TOPAS",
        tooltip: "Export TOPAS Setup to Modelica 3.x Hadrontherapy Model",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "topas_to_modelica",
      },
      {
        id: "topasLint",
        label: "Lint TOPAS / GATE Hadrontherapy Configuration",
        shortLabel: "Lint TOPAS",
        tooltip: "Lint TOPAS / GATE Hadrontherapy Configuration",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "topas_lint",
      },
    ],
  },
  actions: [
    {
      id: "topas_lint",
      title: "Lint TOPAS / GATE Hadrontherapy Configuration",
      description: "Runs Monte Carlo geometry, material, beam energy, and parameter checks (M9601–M9610).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseTopas(context.documentText ?? "");
        return lintTopasDocument(doc);
      },
    },
    {
      id: "topas_bragg_peak",
      title: "Compute Analytical Proton/Ion Bragg Peak Depth-Dose Curve",
      description: "Computes Bethe-Bloch / Bortfeld depth-dose profile, R0, R80, straggling, and LET_d in water.",
      category: "simulate",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseTopas(context.documentText ?? "");
        return computeBraggPeakDepthDose(doc);
      },
    },
    {
      id: "topas_to_dae",
      title: "Lower TOPAS / GATE Model to DAE Arena",
      description: "Lowers geometry volumes, beam energetics, and Bragg peak metrics into DAEBuilder.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseTopas(context.documentText ?? "");
        const arena = lowerTopasToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "topas_to_scad",
      title: "Export TOPAS Geometry to OpenSCAD (.scad)",
      description: "Projects TOPAS / GATE treatment nozzle and water phantom hierarchy to OpenSCAD CSG.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseTopas(context.documentText ?? "");
        return topasToScad(doc);
      },
    },
    {
      id: "topas_to_modelica",
      title: "Export TOPAS Setup to Modelica 3.x Hadrontherapy Model",
      description: "Projects TOPAS beam sources, range-energy equations, and geometry parameters to Modelica.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseTopas(context.documentText ?? "");
        return topasToModelica(doc);
      },
    },
  ],
});

export default topasLanguage;
