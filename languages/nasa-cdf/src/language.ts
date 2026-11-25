// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Formal DSL Language Specification & WASM GLR Grammar.
 *
 * Defines the declarative `@modelscript/dsl` grammar for NASA CDF Skeleton Tables (`.skt`),
 * compiling into native WebAssembly GLR parse tables (`dist/parser.wasm`), and registers
 * the interactive `NasaCdfPanel` React viewer/editor panel.
 */

import { choice, field, language, optional, repeat, seq, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInNasaCdfLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerNasaCdfToDae } from "./dae/cdf-to-dae.js";
import { renderNasaCdfStripChartSvg } from "./diagram/strip-chart.js";
import { NasaCdfErrorCode } from "./errors.js";
import { nasaCdfIndexing } from "./indexing.js";
import { lintNasaCdf } from "./lints/index.js";
import { parseCdfSkeleton } from "./parser/skt-parser.js";
import { nasaCdfToCcsds, nasaCdfToCsv, nasaCdfToFits } from "./projections/index.js";
import { analyzeNasaCdfTelemetry } from "./solver/statistics.js";

registerBuiltInNasaCdfLibrarySync();

export const nasaCdfLanguage = language({
  name: "nasa-cdf",
  fileExtensions: [".skt", ".cdf"],
  maturity: "beta",
  indexing: nasaCdfIndexing,
  lsp: {
    fileExtensions: [".skt", ".cdf"],
    outline: [
      "HeaderSection",
      "GlobalAttributesSection",
      "VariableAttributesSection",
      "VariablesSection",
      "EndSection",
    ],
  },
  ui: {
    panels: [
      {
        id: "nasaCdfEditor",
        viewType: "modelscript.nasaCdfEditor",
        title: "NASA CDF Telemetry Strip-Chart & ISTP Inspector",
        shortTitle: "NASA CDF",
        selector: ["*.skt", "*.cdf"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/NasaCdfPanel.tsx",
        artifactViewTypes: ["nasa-cdf", "cdf", "skt"],
      },
    ],
  },
  errorCodes: NasaCdfErrorCode,
  extras: () => [/[ \t\r\n]+/, /![^\r\n]*/],

  rules: {
    SkeletonDocument: ($) =>
      seq(
        optional($["HeaderSection"]!),
        optional($["GlobalAttributesSection"]!),
        optional($["VariableAttributesSection"]!),
        optional($["VariablesSection"]!),
        optional($["EndSection"]!),
      ),

    HeaderSection: ($) => seq("#header", repeat($["HeaderEntry"]!)),

    HeaderEntry: ($) =>
      choice(
        seq("CDF", "NAME", ":", field("fileName", choice($["StringLiteral"]!, $["FilePathToken"]!))),
        seq("FILE", "NAME", ":", field("fileName", choice($["StringLiteral"]!, $["FilePathToken"]!))),
        seq("DATA", "ENCODING", ":", field("encoding", $["Identifier"]!)),
        seq("ENCODING", ":", field("encoding", $["Identifier"]!)),
        seq("MAJORITY", ":", field("majority", $["MajorityKeyword"]!)),
        seq("FORMAT", ":", field("format", choice("SINGLE", "MULTI"))),
        seq("VERSION", ":", field("version", $["VersionLiteral"]!)),
        seq("COMPRESSION", ":", field("compression", $["Identifier"]!)),
        seq("CHECKSUM", ":", field("checksum", $["Identifier"]!)),
      ),

    GlobalAttributesSection: ($) => seq("#GLOBALattributes", repeat($["GlobalAttributeDecl"]!)),

    GlobalAttributeDecl: ($) => seq(field("name", $["StringLiteral"]!), repeat($["GlobalAttributeEntry"]!)),

    GlobalAttributeEntry: ($) =>
      seq(
        field("entryNumber", $["IntegerLiteral"]!),
        ":",
        field("dataType", $["CdfDataType"]!),
        field("values", $["ValueList"]!),
      ),

    VariableAttributesSection: ($) => seq("#VARIABLEattributes", repeat(field("attributeName", $["StringLiteral"]!))),

    VariablesSection: ($) => seq(choice("#variables", "#zVariables"), repeat($["VariableBlock"]!)),

    VariableBlock: ($) =>
      seq($["VariableHeader"]!, repeat(choice($["VariableAttributeBinding"]!, $["RecordAssignment"]!)), optional(".")),

    VariableHeader: ($) =>
      seq(
        field("name", $["StringLiteral"]!),
        field("dataType", $["CdfDataType"]!),
        field("numElements", $["IntegerLiteral"]!),
        field("numDims", $["IntegerLiteral"]!),
        ":",
        "[",
        optional(seq($["IntegerLiteral"]!, repeat(seq(",", $["IntegerLiteral"]!)))),
        "]",
        field("recVariance", $["VarianceFlag"]!),
        repeat($["VarianceFlag"]!),
      ),

    VariableAttributeBinding: ($) =>
      seq(
        field("attributeName", $["StringLiteral"]!),
        field("dataType", $["CdfDataType"]!),
        field("values", $["ValueList"]!),
      ),

    RecordAssignment: ($) =>
      seq(
        "[",
        field("recordIndex", $["IntegerLiteral"]!),
        "]",
        "=",
        field("value", choice($["ValueList"]!, $["ScalarLiteral"]!)),
      ),

    EndSection: () => "#end",

    ValueList: ($) =>
      seq("{", optional(seq($["ScalarLiteral"]!, repeat(seq(optional(","), $["ScalarLiteral"]!)))), "}"),

    ScalarLiteral: ($) => choice($["StringLiteral"]!, $["NumberLiteral"]!),

    CdfDataType: () =>
      choice(
        "CDF_INT1",
        "CDF_INT2",
        "CDF_INT4",
        "CDF_INT8",
        "CDF_UINT1",
        "CDF_UINT2",
        "CDF_UINT4",
        "CDF_REAL4",
        "CDF_REAL8",
        "CDF_FLOAT",
        "CDF_DOUBLE",
        "CDF_BYTE",
        "CDF_CHAR",
        "CDF_UCHAR",
        "CDF_EPOCH",
        "CDF_EPOCH16",
        "CDF_TIME_TT2000",
      ),

    MajorityKeyword: () => choice("ROW_MAJOR", "COLUMN_MAJOR"),
    VarianceFlag: () => choice("T", "F"),
    VersionLiteral: () => /[0-9]+\.[0-9]+(?:\.[0-9]+)?/,
    IntegerLiteral: () => /[0-9]+/,
    NumberLiteral: () => /[+-]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][+-]?[0-9]+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_-]*/,
    FilePathToken: () => /[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/,
  },

  actions: [
    {
      id: "nasa_cdf_lint",
      title: "Lint NASA CDF / ISTP Compliance",
      description:
        "Validates skeleton table structure, CDF data types, ISTP metadata, valid bounds, and epoch monotonicity.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseCdfSkeleton(context.documentText || "", context["documentUri"] as string | undefined);
        return lintNasaCdf(doc);
      },
    },
    {
      id: "nasa_cdf_analyze",
      title: "Analyze Space-Physics Telemetry Statistics",
      description: "Computes per-channel statistics and magnetic field magnitude |B| = sqrt(Bx^2 + By^2 + Bz^2).",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseCdfSkeleton(context.documentText || "", context["documentUri"] as string | undefined);
        return analyzeNasaCdfTelemetry(doc);
      },
    },
    {
      id: "nasa_cdf_to_dae",
      title: "Lower NASA CDF Telemetry Balance to DAE Arena",
      description: "Lowers magnetometer and solar-wind plasma balance equations directly into DAEBuilder.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseCdfSkeleton(context.documentText || "", context["documentUri"] as string | undefined);
        const arena = lowerNasaCdfToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "nasa_cdf_to_csv",
      title: "Export NASA CDF Telemetry to CSV",
      description: "Projects CDF variables and ISO-8601 epoch timestamps to RFC-4180 CSV.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseCdfSkeleton(context.documentText || "", context["documentUri"] as string | undefined);
        return nasaCdfToCsv(doc);
      },
    },
    {
      id: "nasa_cdf_to_fits",
      title: "Export NASA CDF Dataset to FITS 4.0 Header",
      description: "Projects CDF metadata and variables to FITS 4.0 BINTABLE 80-character header cards.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseCdfSkeleton(context.documentText || "", context["documentUri"] as string | undefined);
        return nasaCdfToFits(doc);
      },
    },
    {
      id: "nasa_cdf_to_ccsds",
      title: "Export NASA CDF Telemetry to CCSDS KVN",
      description: "Generates interoperable CCSDS TDM KVN metadata and channel statistics.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseCdfSkeleton(context.documentText || "", context["documentUri"] as string | undefined);
        return nasaCdfToCcsds(doc);
      },
    },
    {
      id: "nasa_cdf_strip_chart_svg",
      title: "Render Multi-Channel Telemetry Strip Chart SVG",
      description: "Generates a deterministic SVG multi-channel time-series strip chart.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseCdfSkeleton(context.documentText || "", context["documentUri"] as string | undefined);
        return renderNasaCdfStripChartSvg(doc);
      },
    },
  ],
});
