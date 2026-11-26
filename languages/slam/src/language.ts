// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInSlamLibrarySync } from "./catalog/library-package-adapter.js";
import { SlamErrorCode } from "./errors.js";
import { slamIndexing } from "./indexing.js";

/**
 * Formal `@modelscript/dsl` language specification for SLAM II
 * (Simulation Language for Alternative Modeling, Pritsker & Pegden 1979).
 */
export const slamLanguage = language({
  name: "slam",
  fileExtensions: [".slam", ".slm"],
  maturity: "beta",
  indexing: slamIndexing,
  lsp: {
    fileExtensions: [".slam", ".slm"],
  },
  errorCodes: SlamErrorCode,

  conflicts: ($) => [[$["_OptArgValue"]!, $["Identifier"]!, $["StateRef"]!]],

  rules: {
    Model: ($) =>
      repeat(
        choice(
          $["GenStatement"]!,
          $["LimitsStatement"]!,
          $["ContinuousStatement"]!,
          $["IntlcStatement"]!,
          $["InitializeStatement"]!,
          $["NetworkStatement"]!,
          $["EndNetworkStatement"]!,
          $["FinStatement"]!,
          $["StateEquation"]!,
          $["NetworkNode"]!,
          $["Comment"]!,
        ),
      ),

    GenStatement: ($) =>
      seq(
        "GEN",
        ",",
        field("analyst", $["ArgToken"]!),
        optional(
          seq(
            ",",
            field("project", $["ArgToken"]!),
            optional(seq(",", $["ArgToken"]!, optional(seq(",", $["NumberLiteral"]!)))),
          ),
        ),
        optional(";"),
      ),

    LimitsStatement: ($) =>
      seq(
        "LIMITS",
        ",",
        field("mfil", $["NumberLiteral"]!),
        optional(
          seq(",", field("matr", $["NumberLiteral"]!), optional(seq(",", field("mnentries", $["NumberLiteral"]!)))),
        ),
        optional(";"),
      ),

    ContinuousStatement: ($) =>
      seq(
        "CONTINUOUS",
        ",",
        field("nneqd", $["NumberLiteral"]!),
        optional(seq(",", field("nneqs", $["NumberLiteral"]!), repeat(seq(",", $["_OptArgValue"]!)))),
        optional(";"),
      ),

    _OptArgValue: ($) => optional($["ArgValue"]!),

    IntlcStatement: ($) => seq("INTLC", ",", $["Assignment"]!, repeat(seq(",", $["Assignment"]!)), optional(";")),

    InitializeStatement: ($) =>
      seq(
        "INITIALIZE",
        ",",
        field("ttbeg", $["NumberLiteral"]!),
        optional(seq(",", field("ttfin", $["NumberLiteral"]!))),
        optional(";"),
      ),

    NetworkStatement: () => seq("NETWORK", optional(";")),
    EndNetworkStatement: () => seq("ENDNETWORK", optional(";")),
    FinStatement: () => seq("FIN", optional(";")),

    StateEquation: ($) => seq(field("lhs", $["StateRef"]!), "=", field("rhs", $["Expr"]!), optional(";")),

    NetworkNode: ($) =>
      seq(
        optional(seq(field("label", $["Identifier"]!), optional(":"))),
        choice(
          $["CreateNode"]!,
          $["QueueNode"]!,
          $["ActivityNode"]!,
          $["AssignNode"]!,
          $["AwaitNode"]!,
          $["FreeNode"]!,
          $["ResourceNode"]!,
          $["GateNode"]!,
          $["OpenNode"]!,
          $["CloseNode"]!,
          $["ColctNode"]!,
          $["DetectNode"]!,
          $["TerminateNode"]!,
        ),
        optional(";"),
      ),

    CreateNode: ($) => seq("CREATE", repeat(seq(",", $["_OptArgValue"]!))),
    QueueNode: ($) => seq("QUEUE", optional(seq("(", $["NumberLiteral"]!, ")")), repeat(seq(",", $["_OptArgValue"]!))),
    ActivityNode: ($) =>
      seq(choice("ACTIVITY", "ACT"), optional(seq("/", $["NumberLiteral"]!)), repeat(seq(",", $["_OptArgValue"]!))),
    AssignNode: ($) => seq("ASSIGN", repeat(seq(",", choice($["Assignment"]!, $["NumberLiteral"]!)))),
    AwaitNode: ($) => seq("AWAIT", optional(seq("(", $["NumberLiteral"]!, ")")), repeat(seq(",", $["_OptArgValue"]!))),
    FreeNode: ($) => seq("FREE", repeat(seq(",", $["_OptArgValue"]!))),
    ResourceNode: ($) =>
      seq(
        "RESOURCE",
        optional(seq("/", $["Identifier"]!, optional(seq("(", $["NumberLiteral"]!, ")")))),
        repeat(seq(",", $["_OptArgValue"]!)),
      ),
    GateNode: ($) => seq("GATE", optional(seq("/", $["Identifier"]!)), repeat(seq(",", $["_OptArgValue"]!))),
    OpenNode: ($) => seq("OPEN", repeat(seq(",", $["_OptArgValue"]!))),
    CloseNode: ($) => seq("CLOSE", repeat(seq(",", $["_OptArgValue"]!))),
    ColctNode: ($) => seq("COLCT", repeat(seq(",", $["_OptArgValue"]!))),
    DetectNode: ($) => seq("DETECT", repeat(seq(",", $["_OptArgValue"]!))),
    TerminateNode: ($) => seq(choice("TERMINATE", "TERM"), optional(seq(",", $["NumberLiteral"]!))),

    Assignment: ($) => seq(field("target", choice($["StateRef"]!, $["Identifier"]!)), "=", field("value", $["Expr"]!)),

    StateRef: ($) => seq(choice("DD", "SS", "XX", "ATRIB"), "(", $["NumberLiteral"]!, ")"),

    ArgValue: ($) => choice($["Expr"]!, $["StringLiteral"]!),

    ArgToken: ($) => choice($["StringLiteral"]!, $["Identifier"]!, $["NumberLiteral"]!),

    Expr: ($) => seq($["Term"]!, repeat(seq(choice("+", "-"), $["Term"]!))),
    Term: ($) => seq($["Factor"]!, repeat(seq(choice("*", "/"), $["Factor"]!))),
    Factor: ($) =>
      choice(
        $["StateRef"]!,
        $["FunctionCall"]!,
        $["NumberLiteral"]!,
        $["Identifier"]!,
        seq("-", $["Factor"]!),
        seq("(", $["Expr"]!, ")"),
      ),

    FunctionCall: ($) =>
      seq(field("callee", $["Identifier"]!), "(", optional(seq($["Expr"]!, repeat(seq(",", $["Expr"]!)))), ")"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /'[^']*'|"[^"]*"/,
    Comment: () => /;[^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInSlamLibrarySync();
