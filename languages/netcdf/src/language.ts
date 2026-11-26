// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInNetcdfLibrarySync } from "./catalog/library-package-adapter.js";
import { NetcdfErrorCode } from "./errors.js";
import { netcdfIndexing } from "./indexing.js";

/**
 * DSL language specification for Unidata NetCDF Classic v1/v2 & CDL (.cdl, .nc, .cdf).
 */
export const netcdfLanguage = language({
  name: "netcdf",
  fileExtensions: [".cdl", ".nc", ".cdf"],
  maturity: "beta",
  indexing: netcdfIndexing,
  lsp: {
    fileExtensions: [".cdl", ".nc", ".cdf"],
  },
  ui: {
    panels: [
      {
        id: "netcdfViewer",
        viewType: "modelscript.netcdfViewer",
        title: "NetCDF Classic & CDL Heatmap Inspector",
        shortTitle: "NetCDF",
        selector: ["*.cdl", "*.nc", "*.cdf"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/NetcdfPanel.tsx",
        artifactViewTypes: ["netcdf", "cdl"],
      },
    ],
  },

  errorCodes: NetcdfErrorCode,

  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!],

  conflicts: ($) => [[$["VariablesSection"]!, $["GlobalAttribute"]!]],

  rules: {
    NetcdfDocument: ($) =>
      seq(
        "netcdf",
        field("name", $["Identifier"]!),
        "{",
        repeat(choice($["DimensionsSection"]!, $["VariablesSection"]!, $["DataSection"]!, $["GlobalAttribute"]!)),
        "}",
      ),

    DimensionsSection: ($) => seq("dimensions:", repeat($["DimensionDecl"]!)),

    DimensionDecl: ($) =>
      seq(field("name", $["Identifier"]!), "=", field("size", choice("UNLIMITED", $["NumberLiteral"]!)), ";"),

    VariablesSection: ($) =>
      seq("variables:", repeat(choice($["VariableDecl"]!, $["VariableAttribute"]!, $["GlobalAttribute"]!))),

    VariableDecl: ($) =>
      seq(field("type", $["DataType"]!), field("name", $["Identifier"]!), optional($["DimensionList"]!), ";"),

    DimensionList: ($) => seq("(", $["Identifier"]!, repeat(seq(",", $["Identifier"]!)), ")"),

    VariableAttribute: ($) =>
      seq(field("variable", $["Identifier"]!), ":", field("attribute", $["Identifier"]!), "=", $["ValueList"]!, ";"),

    GlobalAttribute: ($) => seq(":", field("attribute", $["Identifier"]!), "=", $["ValueList"]!, ";"),

    DataSection: ($) => seq("data:", repeat($["DataAssignment"]!)),

    DataAssignment: ($) => seq(field("variable", $["Identifier"]!), "=", $["ValueList"]!, ";"),

    ValueList: ($) => seq($["ValueAtom"]!, repeat(seq(",", $["ValueAtom"]!))),

    ValueAtom: ($) => choice($["NumberLiteral"]!, $["StringLiteral"]!, "_", "NaN", "Inf"),

    DataType: () => choice("byte", "char", "short", "int", "long", "float", "double"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[bBsSlLfFdD]?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:\/\/[^\n]*|\/\*([^*]|\*+[^*/])*\*+\/)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInNetcdfLibrarySync();
