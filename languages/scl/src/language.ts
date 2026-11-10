// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript IEC 61850 SCL Language Definition.
 */

import { language } from "@modelscript/dsl";
import { validateGooseStreams } from "./analysis/goose-validator.js";
import { lowerSclToDae } from "./dae/scl-to-dae.js";
import { lintSclDocument } from "./lints/index.js";
import { parseSclXml } from "./parser/scl-parser.js";
import { sclToGridTopology } from "./projections/scl-to-grid.js";

export const sclLanguage = language({
  name: "scl",
  fileExtensions: [".scd", ".cid", ".icd", ".ssd", ".iid", ".scl"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".scd", ".cid", ".icd", ".ssd", ".iid", ".scl"],
  },

  actions: [
    {
      id: "validate_scl_goose",
      title: "Validate IEC 61850 GOOSE Communication Streams",
      description: "Audits publisher-to-subscriber dataflow integrity, datasets, and Type 1A trip latency compliance.",
      category: "verify",
      ui: {
        editorTitle: {
          icon: "$(check-all)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "scl_validate_goose",
          displayName: "Validate IEC 61850 GOOSE Streams",
          modelDescription:
            "Validates publisher-to-subscriber GOOSE and Sampled Values communication stream bindings and latencies in an SCL file.",
        },
      },
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseSclXml(text);
        return validateGooseStreams(doc);
      },
    },
    {
      id: "lower_scl_dae",
      title: "Lower IEC 61850 Substation to DAE Arena",
      description:
        "Compiles substation single-line topology, breaker switch states, and protection relay logic into linear memory DAE arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const doc = parseSclXml(text);
        const dae = lowerSclToDae(doc);
        return {
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
        };
      },
    },
    {
      id: "project_scl_topology",
      title: "Project Single-Line Diagram (SLD) Topology",
      description:
        "Extracts node-breaker electrical bus-branch topology from Substation, VoltageLevel, and Bay definitions.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseSclXml(text);
        return sclToGridTopology(doc);
      },
    },
    {
      id: "lint_scl_document",
      title: "Lint IEC 61850 SCL Document",
      description: "Checks SCL document for schema compliance, mandatory logical nodes, and communication bindings.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const doc = parseSclXml(text);
        return lintSclDocument(doc);
      },
    },
  ],
});
