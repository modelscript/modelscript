// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, prec, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInApdlLibrarySync } from "./catalog/library-package-adapter.js";
import { ApdlErrorCode } from "./errors.js";
import { apdlIndexing } from "./indexing.js";

const PREC = {
  ADDITIVE: 1,
  MULTIPLICATIVE: 2,
  POWER: 3,
  UNARY: 4,
} as const;

/**
 * Declarative `@modelscript/dsl` language definition for ANSYS APDL (`.apdl`, `.mac`, `.ans`, `.cdb`).
 *
 * Covers APDL processors (`/PREP7`, `/SOLU`, `/POST1`, `/TITLE`, `/UNITS`, `FINISH`),
 * element/material/section/geometry/mesh/BC commands (`ET`, `MP`, `R`, `SECTYPE`, `SECDATA`,
 * `K`, `L`, `A`, `V`, `N`, `E`, `TYPE`, `MAT`, `REAL`, `ESIZE`, `LMESH`, `D`, `F`, `SF`,
 * `ANTYPE`, `SOLVE`), parametric macros (`*SET`, `*DIM`, `*DO`/`*ENDDO`, `*IF`/`*ELSE`/`*ENDIF`,
 * `*GET`, `param = expr`), and `!` comments.
 */
export const apdlLanguage = language({
  name: "apdl",
  fileExtensions: [".apdl", ".mac", ".ans", ".cdb"],
  maturity: "beta",
  indexing: apdlIndexing,
  lsp: {
    fileExtensions: [".apdl", ".mac", ".ans", ".cdb"],
  },
  errorCodes: ApdlErrorCode,

  primitives: {
    lineComment: "!",
  },

  extras: () => [/[ \t\r\n]+/, /![^\r\n]*/],

  conflicts: ($) => [[$["_OptionalArgument"]!, $["Identifier"]!]],

  rules: {
    Program: ($) => repeat(choice($["Statement"]!, $["Comment"]!)),

    Statement: ($) =>
      choice($["ProcessorCommand"]!, $["MacroCommand"]!, $["AssignmentStatement"]!, $["CommandStatement"]!),

    ProcessorCommand: ($) => seq(field("processor", $["SlashCommand"]!), repeat(seq(",", $["_OptionalArgument"]!))),

    MacroCommand: ($) => seq(field("macro", $["StarCommand"]!), repeat(seq(",", $["_OptionalArgument"]!))),

    AssignmentStatement: ($) => seq(field("target", $["LValue"]!), "=", field("value", $["Expression"]!)),

    LValue: ($) => seq(field("name", $["Identifier"]!), optional(seq("(", $["Expression"]!, ")"))),

    CommandStatement: ($) => seq(field("command", $["Identifier"]!), repeat(seq(",", $["_OptionalArgument"]!))),

    _OptionalArgument: ($) => optional($["Argument"]!),

    Argument: ($) => choice($["Expression"]!, $["StringLiteral"]!),

    Expression: ($) =>
      choice(
        $["BinaryExpression"]!,
        $["UnaryExpression"]!,
        $["CallExpression"]!,
        $["ParenthesizedExpression"]!,
        $["NumberLiteral"]!,
        $["Identifier"]!,
      ),

    BinaryExpression: ($) =>
      choice(
        prec.left(PREC.ADDITIVE, seq($["Expression"]!, "+", $["Expression"]!)),
        prec.left(PREC.ADDITIVE, seq($["Expression"]!, "-", $["Expression"]!)),
        prec.left(PREC.MULTIPLICATIVE, seq($["Expression"]!, "*", $["Expression"]!)),
        prec.left(PREC.MULTIPLICATIVE, seq($["Expression"]!, "/", $["Expression"]!)),
        prec.right(PREC.POWER, seq($["Expression"]!, "**", $["Expression"]!)),
      ),

    UnaryExpression: ($) =>
      choice(prec(PREC.UNARY, seq("-", $["Expression"]!)), prec(PREC.UNARY, seq("+", $["Expression"]!))),

    CallExpression: ($) =>
      seq(
        field("callee", $["Identifier"]!),
        "(",
        optional(seq($["Expression"]!, repeat(seq(",", $["Expression"]!)))),
        ")",
      ),

    ParenthesizedExpression: ($) => seq("(", $["Expression"]!, ")"),

    SlashCommand: () => /\/[A-Za-z][A-Za-z0-9_]*/,
    StarCommand: () => /\*[A-Za-z][A-Za-z0-9_]*/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /\d+(?:\.\d+)?(?:[eEdD][+-]?\d+)?|\.\d+(?:[eEdD][+-]?\d+)?/,
    StringLiteral: () => /'[^']*'|"[^"]*"/,
    Comment: () => /![^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInApdlLibrarySync();
