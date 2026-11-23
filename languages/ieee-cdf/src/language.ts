// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInIeeeCdfLibrarySync } from "./catalog/library-package-adapter.js";
import { IeeeCdfErrorCode } from "./errors.js";
import { ieeeCdfIndexing } from "./indexing.js";

/**
 * DSL language specification for IEEE Common Data Format (1973) & BPA IPF (1970s) power-flow decks.
 */
export const ieeeCdfLanguage = language({
  name: "ieee-cdf",
  fileExtensions: [".cdf", ".ieee", ".bpa", ".ipf"],
  maturity: "beta",
  indexing: ieeeCdfIndexing,
  lsp: {
    fileExtensions: [".cdf", ".ieee", ".bpa", ".ipf"],
  },
  errorCodes: IeeeCdfErrorCode,

  rules: {
    Document: ($) =>
      repeat(
        choice(
          $["BusDataSection"]!,
          $["BranchDataSection"]!,
          $["LossZonesSection"]!,
          $["InterchangeSection"]!,
          $["TieLinesSection"]!,
          $["EndOfData"]!,
          $["BpaCard"]!,
          $["DataToken"]!,
        ),
      ),

    BusDataSection: ($) =>
      seq(field("header", seq("BUS", "DATA", "FOLLOWS")), repeat($["DataToken"]!), field("terminator", "-999")),

    BranchDataSection: ($) =>
      seq(field("header", seq("BRANCH", "DATA", "FOLLOWS")), repeat($["DataToken"]!), field("terminator", "-999")),

    LossZonesSection: ($) =>
      seq(
        field("header", seq("LOSS", "ZONES", "FOLLOWS")),
        repeat($["DataToken"]!),
        field("terminator", choice("-99", "-999")),
      ),

    InterchangeSection: ($) =>
      seq(
        field("header", seq("INTERCHANGE", "DATA", "FOLLOWS")),
        repeat($["DataToken"]!),
        field("terminator", choice("-9", "-999")),
      ),

    TieLinesSection: ($) =>
      seq(field("header", seq("TIE", "LINES", "FOLLOWS")), repeat($["DataToken"]!), field("terminator", "-999")),

    EndOfData: () => seq("END", "OF", "DATA"),

    BpaCard: ($) =>
      choice(
        seq(field("cardType", choice("BS", "BQ", "BE")), repeat($["BpaField"]!)),
        seq(field("cardType", choice("B", "L", "T", "E", "R")), repeat($["BpaField"]!)),
        $["BpaComment"]!,
      ),

    BpaField: ($) =>
      choice(
        seq(field("key", $["Identifier"]!), "=", field("value", choice($["NumberLiteral"]!, $["Identifier"]!))),
        $["NumberLiteral"]!,
        $["Identifier"]!,
      ),

    DataToken: ($) =>
      choice(
        $["NumberLiteral"]!,
        $["DateLiteral"]!,
        $["StringLiteral"]!,
        $["Identifier"]!,
        seq("(", optional($["Identifier"]!), ")"),
      ),

    DateLiteral: () => /\d{2}\/\d{2}\/\d{2,4}/,
    NumberLiteral: () => /[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_/-]*/,
    BpaComment: () => /(?:C[ \t].*|\/\/.*|#.*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInIeeeCdfLibrarySync();
