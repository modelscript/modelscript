// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInHdf4LibrarySync } from "./catalog/library-package-adapter.js";
import { Hdf4ErrorCode } from "./errors.js";
import { hdf4Indexing } from "./indexing.js";

/**
 * DSL language specification for NCSA HDF4 (.hdf, .h4, .hdf4, .eos).
 */
export const hdf4Language = language({
  name: "hdf4",
  fileExtensions: [".hdf", ".h4", ".hdf4", ".eos"],
  maturity: "beta",
  indexing: hdf4Indexing,
  lsp: {
    fileExtensions: [".hdf", ".h4", ".hdf4", ".eos"],
  },
  ui: {
    panels: [
      {
        id: "hdf4Viewer",
        viewType: "modelscript.hdf4Viewer",
        title: "HDF4 Hierarchy & SDS Heatmap Viewer",
        shortTitle: "HDF4",
        selector: ["*.hdf", "*.h4", "*.hdf4", "*.eos"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/Hdf4Panel.tsx",
        artifactViewTypes: ["hdf4", "hdf", "h4"],
      },
    ],
  },

  errorCodes: Hdf4ErrorCode,

  extras: ($) => [/\s+/, $["Comment"]!],

  rules: {
    Hdf4File: ($) =>
      seq(
        repeat(
          choice(
            $["Hdf4Header"]!,
            $["SdsBlock"]!,
            $["VgroupBlock"]!,
            $["VdataBlock"]!,
            $["Raster8Block"]!,
            $["PaletteBlock"]!,
            $["AttrStatement"]!,
          ),
        ),
        optional("END"),
      ),

    Hdf4Header: ($) =>
      seq("HDF4", field("name", choice($["Identifier"]!, $["StringLiteral"]!)), repeat($["KeyValue"]!)),

    SdsBlock: ($) =>
      seq(
        "SDS",
        field("name", choice($["Identifier"]!, $["StringLiteral"]!)),
        repeat($["KeyValue"]!),
        repeat(choice($["DimStatement"]!, $["AttrStatement"]!, $["DataStatement"]!)),
        "END",
      ),

    VgroupBlock: ($) =>
      seq(
        "VGROUP",
        field("name", choice($["Identifier"]!, $["StringLiteral"]!)),
        repeat($["KeyValue"]!),
        repeat(choice($["MemberStatement"]!, $["AttrStatement"]!)),
        "END",
      ),

    VdataBlock: ($) =>
      seq(
        "VDATA",
        field("name", choice($["Identifier"]!, $["StringLiteral"]!)),
        repeat($["KeyValue"]!),
        repeat(choice($["FieldStatement"]!, $["AttrStatement"]!, $["DataStatement"]!)),
        "END",
      ),

    Raster8Block: ($) =>
      seq(
        "RASTER8",
        field("name", choice($["Identifier"]!, $["StringLiteral"]!)),
        repeat($["KeyValue"]!),
        repeat(choice($["AttrStatement"]!, $["DataStatement"]!)),
        "END",
      ),

    PaletteBlock: ($) =>
      seq(
        "PALETTE",
        field("name", choice($["Identifier"]!, $["StringLiteral"]!)),
        repeat($["KeyValue"]!),
        repeat($["DataStatement"]!),
        "END",
      ),

    DimStatement: ($) =>
      seq("DIM", field("name", $["Identifier"]!), "=", field("size", $["NumberLiteral"]!), repeat($["KeyValue"]!)),

    FieldStatement: ($) =>
      seq(
        "FIELD",
        field("name", $["Identifier"]!),
        ":",
        field("dataType", $["Identifier"]!),
        optional(seq("[", $["NumberLiteral"]!, "]")),
      ),

    AttrStatement: ($) =>
      seq(
        "ATTR",
        field("name", $["Identifier"]!),
        "=",
        field("value", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["ArrayLiteral"]!, $["Identifier"]!)),
      ),

    MemberStatement: ($) =>
      seq(
        "MEMBER",
        field("kind", choice("SDS", "VGROUP", "VDATA", "RASTER8", "PALETTE", "TAGREF")),
        field("name", choice($["Identifier"]!, $["StringLiteral"]!)),
        repeat($["KeyValue"]!),
      ),

    DataStatement: ($) => seq("DATA", optional("="), field("values", $["ArrayLiteral"]!)),

    KeyValue: ($) =>
      seq(
        field("key", $["Identifier"]!),
        "=",
        field("value", choice($["StringLiteral"]!, $["NumberLiteral"]!, $["ArrayLiteral"]!, $["Identifier"]!)),
      ),

    ArrayLiteral: ($) =>
      seq("[", repeat(seq(choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!), optional(","))), "]"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /#[^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInHdf4LibrarySync();
