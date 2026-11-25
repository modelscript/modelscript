// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, repeat1, seq } from "@modelscript/dsl";
import { registerBuiltInUsgsDemLibrarySync } from "./catalog/library-package-adapter.js";
import { UsgsDemErrorCode } from "./errors.js";
import { usgsDemIndexing } from "./indexing.js";

/**
 * DSL language specification for USGS Digital Elevation Model (DEM) ASCII Terrain Format.
 *
 * Supports both keyword-tagged free-format ASCII DEM (`TYPE_A`, `TYPE_B`, `TYPE_C`)
 * and classic numeric/fixed-column 1024-byte USGS DEM record streams.
 */
export const usgsDemLanguage = language({
  name: "usgs-dem",
  fileExtensions: [".dem", ".usgs-dem"],
  maturity: "beta",
  indexing: usgsDemIndexing,
  lsp: {
    fileExtensions: [".dem", ".usgs-dem"],
  },
  ui: {
    panels: [
      {
        id: "usgsDemViewer",
        viewType: "modelscript.usgsDemViewer",
        title: "USGS DEM Elevation Map & Terrain Analyzer",
        shortTitle: "USGS DEM",
        selector: ["*.dem", "*.usgs-dem"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/UsgsDemPanel.tsx",
        artifactViewTypes: ["usgs-dem", "dem"],
      },
    ],
  },

  errorCodes: UsgsDemErrorCode,

  extras: ($) => [/\s+/, $["Comment"]!],

  rules: {
    DemFile: ($) => choice($["FreeFormatDem"]!, $["FixedFormatDem"]!),

    FreeFormatDem: ($) => repeat1(choice($["TypeARecord"]!, $["TypeBRecord"]!, $["TypeCRecord"]!, $["Comment"]!)),

    TypeARecord: ($) => seq("TYPE_A", optional(field("name", $["StringLiteral"]!)), repeat($["HeaderAttribute"]!)),

    HeaderAttribute: ($) =>
      seq(
        field("key", $["Identifier"]!),
        "=",
        field("value", choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!)),
      ),

    TypeBRecord: ($) => seq("TYPE_B", repeat1($["NumberLiteral"]!), optional(seq(":", repeat($["NumberLiteral"]!)))),

    TypeCRecord: ($) => seq("TYPE_C", repeat1($["NumberLiteral"]!)),

    FixedFormatDem: ($) => repeat1(choice($["NumberLiteral"]!, $["Identifier"]!, $["StringLiteral"]!)),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_.-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:#.*|\/\/.*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInUsgsDemLibrarySync();
