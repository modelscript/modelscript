// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInTrnsysLibrarySync } from "./catalog/library-package-adapter.js";
import { TrnsysErrorCode } from "./errors.js";
import { trnsysIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for TRNSYS (`.dck` Deck, 1975).
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm` + `src-gen/bindings.{js,d.ts}`).
 */
export const trnsysLanguage = language({
  name: "trnsys",
  fileExtensions: [".dck", ".trd"],
  maturity: "beta",
  indexing: trnsysIndexing,
  lsp: {
    fileExtensions: [".dck", ".trd"],
  },
  errorCodes: TrnsysErrorCode,

  rules: {
    Deck: ($) =>
      repeat(
        choice(
          $["VersionCard"]!,
          $["SimulationCard"]!,
          $["TolerancesCard"]!,
          $["LimitsCard"]!,
          $["DfqCard"]!,
          $["WidthCard"]!,
          $["ListCard"]!,
          $["MapCard"]!,
          $["ConstantsCard"]!,
          $["EquationsCard"]!,
          $["UnitCard"]!,
          $["ParametersCard"]!,
          $["InputsCard"]!,
          $["DerivativesCard"]!,
          $["AssignCard"]!,
          $["EndCard"]!,
          $["Comment"]!,
        ),
      ),

    VersionCard: ($) => seq("VERSION", field("version", $["NumberLiteral"]!)),

    SimulationCard: ($) =>
      seq(
        "SIMULATION",
        field("tStart", $["ValueToken"]!),
        field("tStop", $["ValueToken"]!),
        field("dt", $["ValueToken"]!),
      ),

    TolerancesCard: ($) =>
      seq("TOLERANCES", field("integration", $["NumberLiteral"]!), field("convergence", $["NumberLiteral"]!)),

    LimitsCard: ($) =>
      seq(
        "LIMITS",
        field("maxIterations", $["NumberLiteral"]!),
        field("maxWarnings", $["NumberLiteral"]!),
        optional(field("traceLimit", $["NumberLiteral"]!)),
      ),

    DfqCard: ($) => seq("DFQ", field("method", $["NumberLiteral"]!)),

    WidthCard: ($) => seq("WIDTH", field("columns", $["NumberLiteral"]!)),

    ListCard: () => choice("LIST", "NOLIST"),

    MapCard: () => "MAP",

    ConstantsCard: ($) => seq("CONSTANTS", field("count", $["NumberLiteral"]!), repeat($["Assignment"]!)),

    EquationsCard: ($) => seq("EQUATIONS", field("count", $["NumberLiteral"]!), repeat($["Assignment"]!)),

    Assignment: ($) => seq(field("name", $["Identifier"]!), "=", field("expression", $["Expression"]!)),

    Expression: ($) => seq($["ExprAtom"]!, repeat(seq(choice("+", "-", "*", "/", "^"), $["ExprAtom"]!))),

    ExprAtom: ($) =>
      choice(
        seq("(", $["Expression"]!, ")"),
        seq($["Identifier"]!, "(", optional(seq($["Expression"]!, repeat(seq(",", $["Expression"]!)))), ")"),
        $["NumberLiteral"]!,
        $["Identifier"]!,
      ),

    UnitCard: ($) =>
      seq(
        "UNIT",
        field("unitNumber", $["NumberLiteral"]!),
        "TYPE",
        field("typeNumber", $["NumberLiteral"]!),
        optional(field("label", $["Identifier"]!)),
      ),

    ParametersCard: ($) => seq("PARAMETERS", field("count", $["NumberLiteral"]!), repeat($["ValueToken"]!)),

    InputsCard: ($) =>
      seq("INPUTS", field("count", $["NumberLiteral"]!), repeat(choice($["InputConnection"]!, $["ValueToken"]!))),

    InputConnection: ($) =>
      seq(field("sourceUnit", $["NumberLiteral"]!), ",", field("outputIndex", $["NumberLiteral"]!)),

    DerivativesCard: ($) => seq("DERIVATIVES", field("count", $["NumberLiteral"]!), repeat($["ValueToken"]!)),

    AssignCard: ($) =>
      seq(
        "ASSIGN",
        field("filename", choice($["StringLiteral"]!, $["Identifier"]!)),
        field("logicalUnit", $["NumberLiteral"]!),
      ),

    EndCard: () => "END",

    ValueToken: ($) => choice($["NumberLiteral"]!, $["Identifier"]!),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:![^\r\n]*|\*[^\r\n]*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInTrnsysLibrarySync();
