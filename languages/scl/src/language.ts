// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript IEC 61850 SCL Language Definition.
 */

import { language, xmlRules } from "@modelscript/dsl";
import { validateGooseStreams } from "./analysis/goose-validator.js";
import { lowerSclToDae } from "./dae/scl-to-dae.js";
import { sclIndexing } from "./indexing.js";
import { lintSclDocument } from "./lints/index.js";
import { parseSclXml } from "./parser/scl-parser.js";
import { sclToGridTopology } from "./projections/scl-to-grid.js";
import { sclPolyglotConfig } from "./tgg/index.js";

export const sclLanguage = language({
  polyglot: sclPolyglotConfig,
  name: "scl",
  fileExtensions: [".scd", ".cid", ".icd", ".ssd", ".iid", ".scl"],
  maturity: "beta",
  indexing: sclIndexing,
  lsp: {
    fileExtensions: [".scd", ".cid", ".icd", ".ssd", ".iid", ".scl"],
  },

  ui: {
    toolbarButtons: [
      {
        id: "validateSclGoose",
        label: "Validate IEC 61850 GOOSE Communication Streams",
        shortLabel: "Validate IEC",
        tooltip: "Validate IEC 61850 GOOSE Communication Streams",
        icon: "shield-check",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        actionId: "validate_scl_goose",
      },
      {
        id: "lowerSclDae",
        label: "Lower IEC 61850 Substation to DAE Arena",
        shortLabel: "Lower IEC",
        tooltip: "Lower IEC 61850 Substation to DAE Arena",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 20,
        actionId: "lower_scl_dae",
      },
      {
        id: "projectSclTopology",
        label: "Project Single-Line Diagram (SLD) Topology",
        shortLabel: "Project",
        tooltip: "Project Single-Line Diagram (SLD) Topology",
        icon: "export",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 30,
        actionId: "project_scl_topology",
      },
      {
        id: "lintSclDocument",
        label: "Lint IEC 61850 SCL Document",
        shortLabel: "Lint IEC",
        tooltip: "Lint IEC 61850 SCL Document",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "lint_scl_document",
      },
    ],
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
  extras: ($) => [/[ \t\r\n]+/, $["COMMENT"]!, $["PROCESSING_INSTRUCTION"]!],
  rules: xmlRules,
});

export default sclLanguage;
