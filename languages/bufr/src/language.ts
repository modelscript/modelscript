// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInBufrLibrarySync } from "./catalog/library-package-adapter.js";
import { BufrErrorCode } from "./errors.js";
import { bufrIndexing } from "./indexing.js";

/**
 * DSL language specification for WMO BUFR (FM 94 BUFR — Binary Universal Form
 * for the Representation of Meteorological Data, 1988).
 */
export const bufrLanguage = language({
  name: "bufr",
  fileExtensions: [".bufr", ".bfr", ".bufr.txt"],
  maturity: "beta",
  indexing: bufrIndexing,
  lsp: {
    fileExtensions: [".bufr", ".bfr", ".bufr.txt"],
  },
  ui: {
    panels: [
      {
        id: "bufrSounding",
        viewType: "modelscript.bufrSounding",
        title: "WMO BUFR Sounding & Station Viewer",
        shortTitle: "BUFR",
        selector: ["*.bufr", "*.bfr", "*.bufr.txt"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/BufrPanel.tsx",
        artifactViewTypes: ["bufr", "bfr"],
      },
    ],
  },

  errorCodes: BufrErrorCode,

  rules: {
    BufrDocument: ($) =>
      repeat(
        choice(
          $["BufrHeader"]!,
          $["SectionHeader"]!,
          $["DescriptorsHeader"]!,
          $["TableBHeader"]!,
          $["TableDHeader"]!,
          $["TableDEntry"]!,
          $["SubsetHeader"]!,
          $["ObservationAssignment"]!,
          $["Assignment"]!,
          $["Descriptor"]!,
          $["EndMarker"]!,
        ),
      ),

    BufrHeader: ($) =>
      seq(
        "BUFR",
        optional(seq("EDITION", field("edition", $["NumberLiteral"]!))),
        optional(seq("NAME", field("name", $["Identifier"]!))),
      ),

    SectionHeader: ($) => seq("SECTION", field("number", $["NumberLiteral"]!)),

    DescriptorsHeader: () => seq("DESCRIPTORS", optional(":")),

    TableBHeader: () => "TABLE_B",

    TableDHeader: () => "TABLE_D",

    TableDEntry: ($) =>
      seq(
        field("descriptor", $["Descriptor"]!),
        "=",
        "[",
        repeat(seq($["Descriptor"]!, optional(","))),
        "]",
        optional($["StringLiteral"]!),
      ),

    SubsetHeader: ($) => seq("SUBSET", optional(field("index", $["NumberLiteral"]!)), optional(":")),

    ObservationAssignment: ($) =>
      seq(
        field("descriptor", $["Descriptor"]!),
        "=",
        field("value", choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!)),
      ),

    Assignment: ($) =>
      seq(
        field("key", $["Identifier"]!),
        "=",
        field("value", choice($["NumberLiteral"]!, $["StringLiteral"]!, $["BooleanLiteral"]!, $["Identifier"]!)),
      ),

    EndMarker: () => "7777",

    Descriptor: () => /[0-9]+-[0-9]+-[0-9]+/,
    BooleanLiteral: () => choice("true", "false", "TRUE", "FALSE"),
    NumberLiteral: () => /-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
  },

  extras: () => [/[ \t\r\n]+/, /#[^\r\n]*/],
});

registerBuiltInBufrLibrarySync();
