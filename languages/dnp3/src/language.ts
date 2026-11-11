// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript IEEE 1815 / DNP3 Language Definition.
 */

import { language } from "@modelscript/dsl";
import { processTelemetryStream } from "./analysis/telemetry-processor.js";
import { lowerDnp3ToDae } from "./dae/dnp3-to-dae.js";
import { canIndexDnp3, indexDnp3Document } from "./indexing.js";
import { lintDnp3Profile } from "./lints/index.js";
import { parseDnp3 } from "./parser/dnp3-parser.js";
import { writeDnp3Xml } from "./parser/dnp3-writer.js";

export const dnp3Language = language({
  name: "dnp3",
  fileExtensions: [".dnp3", ".xml", ".json"],
  maturity: "beta",
  indexing: {
    indexFile: indexDnp3Document,
    canIndex: canIndexDnp3,
  },
  lsp: {
    fileExtensions: [".dnp3", ".xml", ".json"],
  },

  actions: [
    {
      id: "process_dnp3_telemetry",
      title: "Process DNP3 Telemetry Stream",
      description:
        "Applies deadband thresholding, engineering unit transformation, and evaluates reconstruction residual.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "dnp3_process_telemetry",
          displayName: "Process DNP3 Telemetry Stream",
          modelDescription:
            "Filters raw telemetry samples via DNP3 analog deadband, returning event counts, RMSE, and residuals.",
        },
      },
      execute: async (
        ctx,
        params?: {
          samples?: number[] | undefined;
          documentText?: string | undefined;
          analogIndex?: number | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const profile = parseDnp3(text);
        if (profile.analogInputs.length === 0) return null;
        const aiIdx = params?.analogIndex ?? 0;
        const ai = profile.analogInputs.find((a) => a.index === aiIdx) || profile.analogInputs[0]!;
        const samples = params?.samples ?? [100, 102, 105, 110, 112, 120];
        return processTelemetryStream(samples, ai);
      },
    },
    {
      id: "lower_dnp3_dae",
      title: "Lower DNP3 Point Map to DAE Arena",
      description: "Compiles binary and analog SCADA points into zero-GC linear memory DAEBuilder arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const profile = parseDnp3(text);
        const dae = lowerDnp3ToDae(profile);
        return {
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
        };
      },
    },
    {
      id: "lint_dnp3_profile",
      title: "Lint DNP3 Device Profile",
      description: "Checks point index uniqueness, station addressing, and analog scaling validity.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const profile = parseDnp3(text);
        return lintDnp3Profile(profile);
      },
    },
    {
      id: "export_dnp3_xml",
      title: "Export IEEE 1815 XML Device Profile",
      description: "Serializes DNP3 device point map into standard IEEE 1815 XML format.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const profile = parseDnp3(text);
        return writeDnp3Xml(profile);
      },
    },
  ],
});
