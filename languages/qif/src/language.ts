// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Language Definition.
 *
 * Registers ISO 23952 / ANSI DMSC Quality Information Framework (.qif, .qif.xml)
 * file extensions, NIST QIF Rules & ASME Y14.5 linting, SPC evaluation,
 * linear-memory DAE lowering, STEP AP242 reconciliation, and SysML v2 / Modelica projections.
 */

import { language, xmlRules } from "@modelscript/dsl";
import { qifIndexing } from "./indexing.js";
import { lintQifDocument } from "./lints/rules.js";
import { parseQif } from "./parser/index.js";
import { qifToModelica, qifToSysML2 } from "./projections/index.js";
import { evaluateQifSpc, lowerQifToDae } from "./spc/index.js";
import { reconcileStepWithQif } from "./step-bridge/index.js";
import { qifPolyglotConfig } from "./tgg/index.js";

export const qifLanguage = language({
  polyglot: qifPolyglotConfig,
  name: "qif",
  fileExtensions: [".qif", ".qif.xml"],
  maturity: "experimental",
  indexing: qifIndexing,
  lsp: {
    fileExtensions: [".qif", ".qif.xml"],
  },
  ui: {
    panels: [
      {
        id: "qifEditor",
        viewType: "modelscript.qifEditor",
        title: "QIF Quality Information Framework Metrology Studio",
        shortTitle: "QIF Metrology",
        selector: ["*.qif", "*.qif.json", "*.qif.xml"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/QifPanel.tsx",
        artifactViewTypes: ["qif", "qif-metrology"],
      },
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
        id: "qifSpc",
        label: "Evaluate QIF Statistical Process Control (SPC)",
        shortLabel: "Evaluate QIF",
        tooltip: "Evaluate QIF Statistical Process Control (SPC)",
        icon: "graph",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "qif_spc",
      },
      {
        id: "qifReconcileStep",
        label: "Reconcile QIF with STEP AP242 Model",
        shortLabel: "Reconcile QIF",
        tooltip: "Reconcile QIF with STEP AP242 Model",
        icon: "tools",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "qif_reconcile_step",
      },
      {
        id: "qifToDae",
        label: "Lower QIF Tolerances to DAE Arena",
        shortLabel: "Lower QIF",
        tooltip: "Lower QIF Tolerances to DAE Arena",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "qif_to_dae",
      },
      {
        id: "qifToSysml2",
        label: "Export QIF to SysML v2 Requirements & Verification",
        shortLabel: "Export QIF",
        tooltip: "Export QIF to SysML v2 Requirements & Verification",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "qif_to_sysml2",
      },
      {
        id: "qifToModelica",
        label: "Export QIF to Modelica 3.x Tolerance Model",
        shortLabel: "Export QIF",
        tooltip: "Export QIF to Modelica 3.x Tolerance Model",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "qif_to_modelica",
      },
      {
        id: "qifLint",
        label: "Lint QIF 3.0 Document (ASME Y14.5 & NIST Rules)",
        shortLabel: "Lint QIF",
        tooltip: "Lint QIF 3.0 Document (ASME Y14.5 & NIST Rules)",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 70,
        actionId: "qif_lint",
      },
    ],
  },
  extras: ($) => {
    const comment = $["COMMENT"];
    const pi = $["PROCESSING_INSTRUCTION"];
    return comment && pi ? [/[ \t\r\n]+/, comment, pi] : [/[ \t\r\n]+/];
  },
  rules: xmlRules,

  actions: [
    {
      id: "qif_lint",
      title: "Lint QIF 3.0 Document (ASME Y14.5 & NIST Rules)",
      description: "Runs NIST QIF Rules and ASME Y14.5 GD&T semantic checks (M8101–M8108).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseQif(context.documentText ?? "");
        return lintQifDocument(doc);
      },
    },
    {
      id: "qif_spc",
      title: "Evaluate QIF Statistical Process Control (SPC)",
      description:
        "Computes ASME Y14.5 MMC/LMC bonus tolerances, Cp, Cpk, Pp, Ppk, TUR, and Monte Carlo distributions.",
      category: "simulate",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseQif(context.documentText ?? "");
        return evaluateQifSpc(doc);
      },
    },
    {
      id: "qif_to_dae",
      title: "Lower QIF Tolerances to DAE Arena",
      description: "Lowers nominal dimensions, tolerance zones, bonus tolerances, and deviations into DAEBuilder.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseQif(context.documentText ?? "");
        const arena = lowerQifToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "qif_reconcile_step",
      title: "Reconcile QIF with STEP AP242 Model",
      description: "Validates QIF feature stepEntityId references against STEP AP242 B-rep geometry (M8109).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }, params?: { stepText?: string | undefined }) => {
        const doc = parseQif(context.documentText ?? "");
        return reconcileStepWithQif(params?.stepText ?? "", doc);
      },
    },
    {
      id: "qif_to_sysml2",
      title: "Export QIF to SysML v2 Requirements & Verification",
      description:
        "Projects QIF characteristics and inspection plans to SysML v2 requirement def and verification def.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseQif(context.documentText ?? "");
        return qifToSysML2(doc);
      },
    },
    {
      id: "qif_to_modelica",
      title: "Export QIF to Modelica 3.x Tolerance Model",
      description: "Projects QIF features and SPC tolerance distributions to a parameterized Modelica package.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseQif(context.documentText ?? "");
        return qifToModelica(doc);
      },
    },
  ],
});
