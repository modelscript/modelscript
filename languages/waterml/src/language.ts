// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript OGC WaterML 2.0 / TimeseriesML Language Definition.
 */

import { language } from "@modelscript/dsl";
import { fitRatingCurve } from "./analysis/rating-curve.js";
import { lowerWaterMlToDae } from "./dae/waterml-to-dae.js";
import { canIndexWaterMlFile, indexWaterMlFile } from "./indexing.js";
import { lintWaterMlDocument } from "./lints/index.js";
import { parseWaterMl } from "./parser/waterml-parser.js";
import { writeWaterMlXml } from "./parser/waterml-writer.js";
import { projectWaterMlToEpanet, projectWaterMlToHecRas } from "./projections/waterml-to-boundary.js";

export const watermlLanguage = language({
  name: "waterml",
  fileExtensions: [".waterml", ".wml2", ".xml", ".json"],
  maturity: "beta",
  indexing: {
    indexFile: indexWaterMlFile,
    canIndex: canIndexWaterMlFile,
  },
  lsp: {
    fileExtensions: [".waterml", ".wml2", ".xml", ".json"],
  },

  actions: [
    {
      id: "fit_waterml_rating_curve",
      title: "Fit Hydrologic Rating Curve",
      description: "Fits power-law Q = a*(h - h0)^b against stage and discharge observation pairs.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(graph-line)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "waterml_fit_rating_curve",
          displayName: "Fit Stage-Discharge Rating Curve",
          modelDescription: "Optimizes power-law rating equation parameters (a, h0, b) with RMSE and residual metrics.",
        },
      },
      execute: async (
        ctx,
        params?: {
          pairs?: Array<{ stageM: number; dischargeM3S: number }> | undefined;
          documentText?: string | undefined;
        },
      ) => {
        if (params?.pairs && params.pairs.length > 0) {
          return fitRatingCurve(params.pairs);
        }
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseWaterMl(text);
        if (doc.timeSeriesList.length < 2) return null;
        // Combine first two series as stage and discharge
        const s1 = doc.timeSeriesList[0]!;
        const s2 = doc.timeSeriesList[1]!;
        const pairs: Array<{ stageM: number; dischargeM3S: number }> = [];
        const n = Math.min(s1.points.length, s2.points.length);
        for (let i = 0; i < n; i++) {
          pairs.push({ stageM: s1.points[i]!.value, dischargeM3S: s2.points[i]!.value });
        }
        return fitRatingCurve(pairs);
      },
    },
    {
      id: "project_waterml_hecras",
      title: "Project to HEC-RAS Flow Hydrograph",
      description: "Generates HEC-RAS unsteady flow (.u01) boundary hydrograph from streamflow observations.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined; river?: string; reach?: string }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseWaterMl(text);
        if (doc.timeSeriesList.length === 0) return null;
        return projectWaterMlToHecRas(doc.timeSeriesList[0]!, {
          river: params?.river,
          reach: params?.reach,
        });
      },
    },
    {
      id: "project_waterml_epanet",
      title: "Project to EPANET Patterns",
      description: "Generates EPANET [PATTERNS] block from telemetry observations.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined; patternId?: string }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseWaterMl(text);
        if (doc.timeSeriesList.length === 0) return null;
        return projectWaterMlToEpanet(doc.timeSeriesList[0]!, params?.patternId);
      },
    },
    {
      id: "lower_waterml_dae",
      title: "Lower WaterML Timeseries to DAE Arena",
      description: "Compiles hydrologic timeseries into zero-GC linear memory DAEBuilder arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const doc = parseWaterMl(text);
        const dae = lowerWaterMlToDae(doc);
        return {
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
        };
      },
    },
    {
      id: "lint_waterml_document",
      title: "Lint WaterML 2.0 Document",
      description: "Validates schema, timestamp monotonicity, and observation non-negativity.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const doc = parseWaterMl(text);
        return lintWaterMlDocument(doc);
      },
    },
    {
      id: "export_waterml_xml",
      title: "Export OGC WaterML 2.0 XML",
      description: "Serializes WaterMlDocument into standard XML.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseWaterMl(text);
        return writeWaterMlXml(doc);
      },
    },
  ],
});
