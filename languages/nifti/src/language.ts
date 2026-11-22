// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nifti — Language Definition.
 *
 * Registers NIfTI-1/2 (.nii) and NRRD (.nrrd, .nhdr) file extensions,
 * volumetric medical imaging linting (M9501–M9510), RAS isosurface mesh extraction,
 * linear-memory compartmental DAEBuilder lowering, and OpenSCAD / STEP projections.
 */

import { choice, field, jsonRules, language, optional, repeat, seq } from "@modelscript/dsl";
import { indexNiftiFile } from "./indexing.js";
import { lintNiftiDocument } from "./lints/rules.js";
import { extractIsoSurfaceMesh, lowerNiftiToDae } from "./mesh/index.js";
import { parseNifti } from "./parser/index.js";
import { niftiToScad, niftiToStep } from "./projections/index.js";
import { niftiPolyglotConfig } from "./tgg/index.js";

export const niftiLanguage = language({
  polyglot: niftiPolyglotConfig,
  name: "nifti",
  fileExtensions: [".nii.json", ".nii.gz", ".nii", ".nrrd", ".nhdr"],
  maturity: "beta",
  word: ($) => $["Identifier"]!,
  extras: () => [/[ \t\r\n]+/, /(?:#|\/\/)[^\r\n]*/, /<!--([^-]|-[^-]|--[^>])*-->/, /<\?([^?]|\?+[^?>])*\?+>/],
  lsp: {
    fileExtensions: [".nii.json", ".nii.gz", ".nii", ".nrrd", ".nhdr"],
    folding: ["JsonObject", "JsonArray", "NrrdDocument", "DslDocument"],
    outline: ["JsonPair", "NrrdDocument", "DslStatement"],
  },
  indexing: {
    indexFile: indexNiftiFile,
  },
  rules: {
    ...jsonRules,

    Document: ($) => optional(choice($["JsonValue"]!, $["NrrdDocument"]!, $["XmlElement"]!, $["DslDocument"]!)),

    NrrdDocument: ($) => seq(field("magic", $["NrrdMagic"]!), repeat(choice($["NrrdField"]!, $["NumberVal"]!))),

    NrrdMagic: () => /NRRD000[0-9]/i,
    NrrdField: () => /[A-Za-z][A-Za-z0-9_ -]*:=?[^\r\n]*/,

    XmlElement: ($) =>
      choice(
        $["EmptyTag"]!,
        seq(
          $["StartTag"]!,
          repeat(choice($["XmlElement"]!, $["Identifier"]!, $["NumberVal"]!, $["JsonString"]!)),
          $["CloseTag"]!,
        ),
      ),

    EmptyTag: () =>
      /<[A-Za-z_:][A-Za-z0-9_.:-]*([ \t\r\n]+[A-Za-z_:][A-Za-z0-9_.:-]*[ \t\r\n]*=[ \t\r\n]*("[^"]*"|'[^']*'))*[ \t\r\n]*\/>/,
    StartTag: () =>
      /<[A-Za-z_:][A-Za-z0-9_.:-]*([ \t\r\n]+[A-Za-z_:][A-Za-z0-9_.:-]*[ \t\r\n]*=[ \t\r\n]*("[^"]*"|'[^']*'))*[ \t\r\n]*>/,
    CloseTag: () => /<\/[A-Za-z_:][A-Za-z0-9_.:-]*[ \t\r\n]*>/,

    DslDocument: ($) => seq($["DslStatement"]!, repeat($["DslStatement"]!)),

    DslStatement: ($) =>
      seq(
        field(
          "keyword",
          choice("NIFTI", "VOLUME", "DIM", "PIXDIM", "SPACING", "QFORM", "SFORM", "SCALING", "LABEL", "ROI", "VOXELS"),
        ),
        repeat(choice($["DslAssign"]!, $["DslAtom"]!)),
      ),

    DslAssign: ($) => seq(field("key", $["Identifier"]!), "=", field("value", $["DslValue"]!)),
    DslValue: ($) => choice($["JsonString"]!, $["NumberVal"]!, $["JsonBoolean"]!, $["Identifier"]!, $["JsonArray"]!),
    DslAtom: ($) => choice($["NumberVal"]!, $["JsonString"]!, $["Identifier"]!),

    NumberVal: ($) => choice($["JsonNumber"]!, /\+(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/),
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
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
        id: "niftiExtractMesh",
        label: "Extract RAS Anatomical Isosurface Mesh",
        shortLabel: "Extract RAS",
        tooltip: "Extract RAS Anatomical Isosurface Mesh",
        icon: "layers",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "nifti_extract_mesh",
      },
      {
        id: "niftiToDae",
        label: "Lower NIfTI Compartmental Tracer Model to DAE Arena",
        shortLabel: "Lower NIfTI",
        tooltip: "Lower NIfTI Compartmental Tracer Model to DAE Arena",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "nifti_to_dae",
      },
      {
        id: "niftiToScad",
        label: "Export NIfTI Segmentation to OpenSCAD (.scad)",
        shortLabel: "Export NIfTI",
        tooltip: "Export NIfTI Segmentation to OpenSCAD (.scad)",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "nifti_to_scad",
      },
      {
        id: "niftiToStep",
        label: "Export NIfTI Segmentation to STEP AP242 (.stp)",
        shortLabel: "Export NIfTI",
        tooltip: "Export NIfTI Segmentation to STEP AP242 (.stp)",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "nifti_to_step",
      },
      {
        id: "niftiLint",
        label: "Lint NIfTI / NRRD Volumetric Medical Image",
        shortLabel: "Lint NIfTI",
        tooltip: "Lint NIfTI / NRRD Volumetric Medical Image",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 60,
        actionId: "nifti_lint",
      },
    ],
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
