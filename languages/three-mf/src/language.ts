// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — Language Definition.
 *
 * Registers ISO/ASTM 52915 3MF (.3mf) file extension,
 * 2-manifold mesh & clinical surgical guide linting (M9701–M9710),
 * topology verification, DAE lowering, and STEP AP242 / OpenSCAD projections.
 */

import { language, xmlRules } from "@modelscript/dsl";
import { indexThreeMfFile } from "./indexing.js";
import { lintThreeMfDocument } from "./lints/rules.js";
import { parseThreeMf } from "./parser/index.js";
import { threeMfToScad, threeMfToStep } from "./projections/index.js";
import { threeMfPolyglotConfig } from "./tgg/index.js";
import { lowerThreeMfToDae, verifyMeshTopology } from "./topology/index.js";

export const threeMfLanguage = language({
  polyglot: threeMfPolyglotConfig,
  name: "three-mf",
  fileExtensions: [".3mf"],
  maturity: "experimental",
  indexing: {
    indexFile: indexThreeMfFile,
  },
  lsp: {
    fileExtensions: [".3mf"],
  },
  extras: ($) => {
    const comment = $["COMMENT"];
    const pi = $["PROCESSING_INSTRUCTION"];
    return comment && pi ? [/[ \t\r\n]+/, comment, pi] : [/[ \t\r\n]+/];
  },
  rules: xmlRules,

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
        id: "threeMfTopology",
        label: "Verify 3MF Mesh Topology & Euler Characteristic",
        shortLabel: "Verify 3MF",
        tooltip: "Verify 3MF Mesh Topology & Euler Characteristic",
        icon: "stack",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "three_mf_topology",
      },
      {
        id: "threeMfToDae",
        label: "Lower 3MF Model to DAE Arena",
        shortLabel: "Lower 3MF",
        tooltip: "Lower 3MF Model to DAE Arena",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "three_mf_to_dae",
      },
      {
        id: "threeMfToStep",
        label: "Export 3MF Mesh to ISO 10303-21 STEP AP242",
        shortLabel: "Export 3MF",
        tooltip: "Export 3MF Mesh to ISO 10303-21 STEP AP242",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "three_mf_to_step",
      },
      {
        id: "threeMfToScad",
        label: "Export 3MF Surgical Guide to OpenSCAD (.scad)",
        shortLabel: "Export 3MF",
        tooltip: "Export 3MF Surgical Guide to OpenSCAD (.scad)",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "three_mf_to_scad",
      },
      {
        id: "threeMfLint",
        label: "Lint 3MF Surgical Guide & Mesh Topology",
        shortLabel: "Lint 3MF",
        tooltip: "Lint 3MF Surgical Guide & Mesh Topology",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 60,
        actionId: "three_mf_lint",
      },
    ],
  },
  actions: [
    {
      id: "three_mf_lint",
      title: "Lint 3MF Surgical Guide & Mesh Topology",
      description: "Runs 2-manifold mesh topology, wall thickness, and biocompatibility checks (M9701–M9710).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseThreeMf(context.documentText ?? "");
        return lintThreeMfDocument(doc);
      },
    },
    {
      id: "three_mf_topology",
      title: "Verify 3MF Mesh Topology & Euler Characteristic",
      description: "Computes Euler characteristic (V - E + F), signed volume, surface area, and manifold status.",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseThreeMf(context.documentText ?? "");
        return verifyMeshTopology(doc);
      },
    },
    {
      id: "three_mf_to_dae",
      title: "Lower 3MF Model to DAE Arena",
      description: "Lowers mesh volumes, surface areas, Euler characteristics, and wall thicknesses into DAEBuilder.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseThreeMf(context.documentText ?? "");
        const arena = lowerThreeMfToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "three_mf_to_step",
      title: "Export 3MF Mesh to ISO 10303-21 STEP AP242",
      description: "Projects 3MF mesh vertices and triangles to a STEP AP242 CLOSED_SHELL faceted B-rep model.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseThreeMf(context.documentText ?? "");
        return threeMfToStep(doc);
      },
    },
    {
      id: "three_mf_to_scad",
      title: "Export 3MF Surgical Guide to OpenSCAD (.scad)",
      description: "Projects 3MF mesh polyhedrons and surgical drill sleeves to OpenSCAD CSG.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseThreeMf(context.documentText ?? "");
        return threeMfToScad(doc);
      },
    },
  ],
});
