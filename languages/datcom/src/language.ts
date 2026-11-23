// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInDatcomLibrarySync } from "./catalog/library-package-adapter.js";
import { DatcomErrorCode } from "./errors.js";
import { datcomIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for USAF Stability and Control Digital DATCOM
 * (`.dcm`, `.datcom`, `.dat`, `.inp`).
 */
export const datcomLanguage = language({
  name: "datcom",
  fileExtensions: [".dcm", ".datcom", ".dat", ".inp"],
  maturity: "beta",
  indexing: datcomIndexing,
  lsp: {
    fileExtensions: [".dcm", ".datcom"],
  },
  errorCodes: DatcomErrorCode,

  rules: {
    Deck: ($) => repeat(choice($["NamelistBlock"]!, $["ControlCard"]!, $["Comment"]!)),

    NamelistBlock: ($) => seq(field("group", $["NamelistHeader"]!), repeat($["NamelistEntry"]!), choice("$END", "$")),

    NamelistHeader: () =>
      choice(
        "$FLTCON",
        "$OPTINS",
        "$SYNTHS",
        "$BODY",
        "$WGPLNF",
        "$HTPLNF",
        "$VTPLNF",
        "$VFPLNF",
        "$SYMFLP",
        "$ASYFLP",
        "$WGSCHR",
      ),

    NamelistEntry: ($) =>
      seq(
        field("key", $["Identifier"]!),
        optional(seq("(", field("index", $["IntegerLiteral"]!), ")")),
        "=",
        field("value", $["ValueList"]!),
        optional(","),
      ),

    ValueList: ($) => seq($["ScalarValue"]!, repeat(seq(",", $["ScalarValue"]!))),

    ScalarValue: ($) => choice($["BooleanLiteral"]!, $["RepeatValue"]!, $["NumberLiteral"]!, $["StringLiteral"]!),

    RepeatValue: ($) => seq($["IntegerLiteral"]!, "*", $["NumberLiteral"]!),

    ControlCard: ($) =>
      choice($["CaseIdCard"]!, $["DimCard"]!, $["DerivCard"]!, $["NacaCard"]!, $["NextCaseCard"]!, $["FlagCard"]!),

    CaseIdCard: ($) => seq("CASEID", field("title", repeat(choice($["Identifier"]!, $["NumberLiteral"]!)))),

    DimCard: () => seq("DIM", choice("FT", "IN", "M", "CM")),

    DerivCard: () => seq("DERIV", choice("DEG", "RAD")),

    NacaCard: () => /NACA-[WHVF]-[456]-[A-Za-z0-9]+/,

    NextCaseCard: () => seq("NEXT", "CASE"),

    FlagCard: () => choice("DAMP", "BUILD", "PLOT", "SAVE", "PART", "TRIM"),

    BooleanLiteral: () => /\.(?:TRUE|FALSE|T|F)\./,
    IntegerLiteral: () => /\d+/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    StringLiteral: () => /'[^']*'|"[^"]*"/,
    Identifier: () => /[A-Za-z][A-Za-z0-9_]*/,
    Comment: () => /(?:\*.*|!.*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInDatcomLibrarySync();
