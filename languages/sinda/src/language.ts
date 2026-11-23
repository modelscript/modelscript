// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInSindaLibrarySync } from "./catalog/library-package-adapter.js";
import { SindaErrorCode } from "./errors.js";
import { sindaIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for NASA SINDA / SINDA-FLUINT
 * (Systems Improved Numerical Differencing Analyzer, `.sin`, `.sinda`, `.sdo`).
 */
export const sindaLanguage = language({
  name: "sinda",
  fileExtensions: [".sin", ".sinda", ".sdo"],
  maturity: "beta",
  indexing: sindaIndexing,
  lsp: {
    fileExtensions: [".sin", ".sinda", ".sdo"],
  },
  errorCodes: SindaErrorCode,

  rules: {
    SindaDeck: ($) =>
      seq(
        repeat(
          choice(
            $["OptionsBlock"]!,
            $["NodeDataBlock"]!,
            $["ConductorDataBlock"]!,
            $["ConstantsDataBlock"]!,
            $["ArrayDataBlock"]!,
            $["SourceDataBlock"]!,
            $["ExecutionBlock"]!,
            $["Variables1Block"]!,
            $["Variables2Block"]!,
            $["OutputCallsBlock"]!,
            $["Comment"]!,
          ),
        ),
        optional($["EndOfData"]!),
      ),

    OptionsBlock: ($) => seq("HEADER", "OPTIONS", "DATA", repeat(choice($["OptionEntry"]!, $["Comment"]!))),

    OptionEntry: ($) =>
      choice(
        seq("TITLE", optional("="), field("value", choice($["StringLiteral"]!, $["Identifier"]!))),
        seq(
          field("key", $["Identifier"]!),
          "=",
          field("value", choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!)),
        ),
      ),

    NodeDataBlock: ($) =>
      seq(
        "HEADER",
        "NODE",
        "DATA",
        optional(seq(",", field("submodel", $["Identifier"]!))),
        repeat(choice($["NodeRecord"]!, $["Comment"]!)),
      ),

    NodeRecord: ($) =>
      seq(
        field("nodeId", $["SignedInteger"]!),
        optional(","),
        field("initialTemp", $["NumberLiteral"]!),
        optional(seq(optional(","), field("capacitance", $["NumberLiteral"]!))),
      ),

    ConductorDataBlock: ($) =>
      seq(
        "HEADER",
        "CONDUCTOR",
        "DATA",
        optional(seq(",", field("submodel", $["Identifier"]!))),
        repeat(choice($["ConductorRecord"]!, $["Comment"]!)),
      ),

    ConductorRecord: ($) =>
      seq(
        field("conductorId", $["SignedInteger"]!),
        optional(","),
        field("nodeI", $["SignedInteger"]!),
        optional(","),
        field("nodeJ", $["SignedInteger"]!),
        optional(","),
        field("conductance", $["NumberLiteral"]!),
      ),

    ConstantsDataBlock: ($) =>
      seq(
        "HEADER",
        "CONSTANTS",
        "DATA",
        optional(seq(",", field("submodel", $["Identifier"]!))),
        repeat(choice($["ConstantAssignment"]!, $["Comment"]!)),
      ),

    ConstantAssignment: ($) =>
      seq(field("name", $["Identifier"]!), "=", field("value", $["NumberLiteral"]!), optional(",")),

    ArrayDataBlock: ($) =>
      seq(
        "HEADER",
        "ARRAY",
        "DATA",
        optional(seq(",", field("submodel", $["Identifier"]!))),
        repeat(choice($["ArrayRecord"]!, $["Comment"]!)),
      ),

    ArrayRecord: ($) => seq(field("arrayId", $["SignedInteger"]!), repeat(seq(optional(","), $["NumberLiteral"]!))),

    SourceDataBlock: ($) =>
      seq(
        "HEADER",
        "SOURCE",
        "DATA",
        optional(seq(",", field("submodel", $["Identifier"]!))),
        repeat(choice($["SourceRecord"]!, $["Comment"]!)),
      ),

    SourceRecord: ($) =>
      seq(field("nodeId", $["SignedInteger"]!), optional(","), field("heatLoad", $["NumberLiteral"]!)),

    ExecutionBlock: ($) => seq("HEADER", "EXECUTION", repeat(choice($["ExecutionCall"]!, $["Comment"]!))),

    ExecutionCall: ($) =>
      seq(optional("CALL"), field("routine", $["Identifier"]!), optional(seq("(", optional($["ArgList"]!), ")"))),

    ArgList: ($) =>
      seq(
        choice($["Identifier"]!, $["NumberLiteral"]!),
        repeat(seq(",", choice($["Identifier"]!, $["NumberLiteral"]!))),
      ),

    Variables1Block: ($) =>
      seq(
        "HEADER",
        "VARIABLES",
        "1",
        optional(seq(",", field("submodel", $["Identifier"]!))),
        repeat(choice($["VariableStatement"]!, $["Comment"]!)),
      ),

    Variables2Block: ($) =>
      seq(
        "HEADER",
        "VARIABLES",
        "2",
        optional(seq(",", field("submodel", $["Identifier"]!))),
        repeat(choice($["VariableStatement"]!, $["Comment"]!)),
      ),

    VariableStatement: ($) =>
      seq(field("lhs", $["Identifier"]!), "=", field("rhs", choice($["NumberLiteral"]!, $["Identifier"]!))),

    OutputCallsBlock: ($) =>
      seq(
        "HEADER",
        "OUTPUT",
        "CALLS",
        optional(seq(",", field("submodel", $["Identifier"]!))),
        repeat(choice($["ExecutionCall"]!, $["Comment"]!)),
      ),

    EndOfData: () => seq("END", "OF", "DATA"),

    SignedInteger: () => /[+-]?\d+/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:\$[^\r\n]*|C[ \t][^\r\n]*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInSindaLibrarySync();
