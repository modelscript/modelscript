// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Language Definition.
 *
 * Registers DICOM-RT (.dcm.xml, .rtplan, .rtstruct, .rtdose, .dicom-rt) file extensions,
 * clinical safety & physics linting (M9201–M9210), DVH/BED/EQD2 dosimetric evaluation,
 * linear-memory DAEBuilder lowering, and OpenSCAD / SysML v2 projections.
 */

import { language } from "@modelscript/dsl";
import { lowerDicomRtToDae } from "./dae/index.js";
import { evaluateDicomRtDosimetry } from "./dosimetry/index.js";
import { canIndexDicomRt, indexDicomRtDocument } from "./indexing.js";
import { lintDicomRtDocument } from "./lints/rules.js";
import { parseDicomRt } from "./parser/index.js";
import { dicomRtToScad, dicomRtToSysML2 } from "./projections/index.js";

export const dicomRtLanguage = language({
  name: "dicom-rt",
  fileExtensions: [".dcm.json", ".dcm.xml", ".rtplan", ".rtstruct", ".rtdose", ".dicom-rt"],
  maturity: "experimental",
  indexing: {
    indexFile: indexDicomRtDocument,
    canIndex: canIndexDicomRt,
  },
  lsp: {
    fileExtensions: [".dcm.json", ".dcm.xml", ".rtplan", ".rtstruct", ".rtdose", ".dicom-rt"],
  },
  rules: {
    Root: () => "dicom-rt",
  },

  actions: [
    {
      id: "dicom_rt_lint",
      title: "Lint DICOM-RT Treatment Plan (QUANTEC & AAPM TG-263 Rules)",
      description: "Runs clinical radiotherapy physics and safety checks (M9201–M9210).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseDicomRt(context.documentText ?? "");
        return lintDicomRtDocument(doc);
      },
    },
    {
      id: "dicom_rt_dosimetry",
      title: "Evaluate DICOM-RT Clinical Dosimetry & Radiobiology",
      description: "Computes DVH metrics (D98%, D95%, D50%, D2%, V20Gy), CI, HI, BED, and EQD2.",
      category: "simulate",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseDicomRt(context.documentText ?? "");
        return evaluateDicomRtDosimetry(doc);
      },
    },
    {
      id: "dicom_rt_to_dae",
      title: "Lower DICOM-RT Linac Kinematics & LQ Survival to DAE Arena",
      description:
        "Lowers gantry/collimator rotation, MLC aperture area, dose rate, and LQ cell survival ODEs into DAEBuilder.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseDicomRt(context.documentText ?? "");
        const arena = lowerDicomRtToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "dicom_rt_to_scad",
      title: "Export DICOM-RT Contours & Beams to OpenSCAD 3D CSG",
      description: "Projects RTSTRUCT ROI contour polygons and RTPLAN beam cones to OpenSCAD 3D geometry.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseDicomRt(context.documentText ?? "");
        return dicomRtToScad(doc);
      },
    },
    {
      id: "dicom_rt_to_sysml2",
      title: "Export DICOM-RT Clinical Constraints to SysML v2",
      description:
        "Projects clinical dose prescriptions, QUANTEC OAR limits, and linac parameters to SysML v2 requirements.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseDicomRt(context.documentText ?? "");
        return dicomRtToSysML2(doc);
      },
    },
  ],
});
