// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nifti — Language Definition.
 *
 * Registers NIfTI-1/2 (.nii) and NRRD (.nrrd, .nhdr) file extensions,
 * volumetric medical imaging linting (M9501–M9510), RAS isosurface mesh extraction,
 * linear-memory compartmental DAEBuilder lowering, and OpenSCAD / STEP projections.
 */

import { language } from "@modelscript/dsl";
import { indexNiftiFile } from "./indexing.js";
import { lintNiftiDocument } from "./lints/rules.js";
import { extractIsoSurfaceMesh, lowerNiftiToDae } from "./mesh/index.js";
import { parseNifti } from "./parser/index.js";
import { niftiToScad, niftiToStep } from "./projections/index.js";

export const niftiLanguage = language({
  name: "nifti",
  fileExtensions: [".nii.json", ".nii.gz", ".nii", ".nrrd", ".nhdr"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".nii.json", ".nii.gz", ".nii", ".nrrd", ".nhdr"],
  },
  indexing: {
    indexFile: indexNiftiFile,
  },
  rules: {
    Root: () => "nifti",
  },

  actions: [
    {
      id: "nifti_lint",
      title: "Lint NIfTI / NRRD Volumetric Medical Image",
      description:
        "Runs NIfTI-1/2 and NRRD spatial affine, quaternion, spacing, and segmentation checks (M9501–M9510).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseNifti(context.documentText ?? "");
        return lintNiftiDocument(doc);
      },
    },
    {
      id: "nifti_extract_mesh",
      title: "Extract RAS Anatomical Isosurface Mesh",
      description: "Transforms voxels via 4x4 RAS affine matrix and extracts 3D surface triangulation and volumes.",
      category: "simulate",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseNifti(context.documentText ?? "");
        return extractIsoSurfaceMesh(doc);
      },
    },
    {
      id: "nifti_to_dae",
      title: "Lower NIfTI Compartmental Tracer Model to DAE Arena",
      description: "Lowers ROI volumes, diffusion coefficients, and tracer clearance kinetics into DAEBuilder.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseNifti(context.documentText ?? "");
        const arena = lowerNiftiToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "nifti_to_scad",
      title: "Export NIfTI Segmentation to OpenSCAD (.scad)",
      description: "Projects extracted anatomical surface mesh to an OpenSCAD polyhedron module.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseNifti(context.documentText ?? "");
        return niftiToScad(doc);
      },
    },
    {
      id: "nifti_to_step",
      title: "Export NIfTI Segmentation to STEP AP242 (.stp)",
      description: "Projects extracted anatomical surface mesh to ISO 10303-21 STEP B-Rep geometry.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseNifti(context.documentText ?? "");
        return niftiToStep(doc);
      },
    },
  ],
});
