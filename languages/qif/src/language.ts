// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Language Definition.
 *
 * Registers ISO 23952 / ANSI DMSC Quality Information Framework (.qif, .qif.xml)
 * file extensions, NIST QIF Rules & ASME Y14.5 linting, SPC evaluation,
 * linear-memory DAE lowering, STEP AP242 reconciliation, and SysML v2 / Modelica projections.
 */

import { language } from "@modelscript/dsl";
import { lintQifDocument } from "./lints/rules.js";
import { parseQif } from "./parser/index.js";
import { qifToModelica, qifToSysML2 } from "./projections/index.js";
import { evaluateQifSpc, lowerQifToDae } from "./spc/index.js";
import { reconcileStepWithQif } from "./step-bridge/index.js";

export const qifLanguage = language({
  name: "qif",
  fileExtensions: [".qif", ".qif.xml"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".qif", ".qif.xml"],
  },
  rules: {
    Root: () => "qif",
  },

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
