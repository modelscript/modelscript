// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/three-mf — Language Definition.
 *
 * Registers ISO/ASTM 52915 3MF (.3mf) file extension,
 * 2-manifold mesh & clinical surgical guide linting (M9701–M9710),
 * topology verification, DAE lowering, and STEP AP242 / OpenSCAD projections.
 */

import { language } from "@modelscript/dsl";
import { indexThreeMfFile } from "./indexing.js";
import { lintThreeMfDocument } from "./lints/rules.js";
import { parseThreeMf } from "./parser/index.js";
import { threeMfToScad, threeMfToStep } from "./projections/index.js";
import { lowerThreeMfToDae, verifyMeshTopology } from "./topology/index.js";

export const threeMfLanguage = language({
  name: "three-mf",
  fileExtensions: [".3mf"],
  maturity: "experimental",
  indexing: {
    indexFile: indexThreeMfFile,
  },
  lsp: {
    fileExtensions: [".3mf"],
  },
  rules: {
    Root: () => "three-mf",
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
