// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, prec, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInEsterelLibrarySync } from "./catalog/library-package-adapter.js";
import { EsterelErrorCode } from "./errors.js";
import { esterelIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` specification for Esterel (.strl, .esterel).
 */
export const esterelLanguage = language({
  name: "esterel",
  fileExtensions: [".strl", ".esterel"],
  maturity: "beta",
  indexing: esterelIndexing,
  lsp: {
    fileExtensions: [".strl", ".esterel"],
  },
  errorCodes: EsterelErrorCode,

  rules: {
    Program: ($) => repeat(choice($["ModuleDecl"]!, $["Comment"]!)),

    ModuleDecl: ($) =>
      seq(
        "module",
        field("name", $["Identifier"]!),
        ":",
        repeat(choice($["InterfaceDecl"]!, $["Comment"]!)),
        optional(field("body", $["Statement"]!)),
        "end",
        "module",
        optional("."),
      ),

    InterfaceDecl: ($) => choice($["SignalInterfaceDecl"]!, $["RelationDecl"]!),

    SignalInterfaceDecl: ($) =>
      seq(
        field("direction", choice("input", "output", "inputoutput", "sensor")),
        $["SignalItem"]!,
        repeat(seq(",", $["SignalItem"]!)),
        ";",
      ),

    SignalItem: ($) =>
      seq(
        field("name", $["Identifier"]!),
        optional(seq(":=", $["LiteralValue"]!)),
        optional(seq(":", field("type", $["Identifier"]!))),
      ),

    RelationDecl: ($) => seq("relation", $["RelationItem"]!, repeat(seq(",", $["RelationItem"]!)), ";"),

    RelationItem: ($) =>
      choice(
        seq($["Identifier"]!, "#", $["Identifier"]!, repeat(seq("#", $["Identifier"]!))),
        seq($["Identifier"]!, "=>", $["Identifier"]!),
      ),

    Statement: ($) => choice($["ParallelStmt"]!, $["SequenceStmt"]!, $["AtomicStmt"]!),

    ParallelStmt: ($) => prec.left(1, seq($["Statement"]!, "||", $["Statement"]!)),

    SequenceStmt: ($) => prec.left(2, seq($["Statement"]!, ";", $["Statement"]!)),

    AtomicStmt: ($) =>
      choice(
        $["GroupStmt"]!,
        $["NothingStmt"]!,
        $["PauseStmt"]!,
        $["HaltStmt"]!,
        $["EmitStmt"]!,
        $["SustainStmt"]!,
        $["PresentStmt"]!,
        $["AwaitStmt"]!,
        $["LoopStmt"]!,
        $["EveryStmt"]!,
        $["AbortStmt"]!,
        $["SuspendStmt"]!,
        $["TrapStmt"]!,
        $["ExitStmt"]!,
        $["LocalSignalStmt"]!,
        $["RunStmt"]!,
      ),

    GroupStmt: ($) => choice(seq("[", $["Statement"]!, "]"), seq("(", $["Statement"]!, ")")),

    NothingStmt: () => "nothing",
    PauseStmt: () => "pause",
    HaltStmt: () => "halt",

    EmitStmt: ($) => seq("emit", field("signal", $["Identifier"]!), optional(seq("(", $["LiteralValue"]!, ")"))),

    SustainStmt: ($) => seq("sustain", field("signal", $["Identifier"]!), optional(seq("(", $["LiteralValue"]!, ")"))),

    PresentStmt: ($) =>
      seq(
        "present",
        field("condition", $["SignalExpr"]!),
        optional(seq("then", field("thenBranch", $["Statement"]!))),
        optional(seq("else", field("elseBranch", $["Statement"]!))),
        "end",
        optional("present"),
      ),

    AwaitStmt: ($) =>
      seq(
        "await",
        optional("immediate"),
        optional($["NumberLiteral"]!),
        field("trigger", $["SignalExpr"]!),
        optional(seq("do", field("body", $["Statement"]!), "end", optional("await"))),
      ),

    LoopStmt: ($) =>
      seq(
        "loop",
        field("body", $["Statement"]!),
        choice(seq("each", field("reset", $["SignalExpr"]!)), seq("end", optional("loop"))),
      ),

    EveryStmt: ($) =>
      seq(
        "every",
        optional("immediate"),
        field("trigger", $["SignalExpr"]!),
        "do",
        field("body", $["Statement"]!),
        "end",
        optional("every"),
      ),

    AbortStmt: ($) =>
      seq(
        optional("weak"),
        "abort",
        field("body", $["Statement"]!),
        "when",
        optional("immediate"),
        optional($["NumberLiteral"]!),
        field("trigger", $["SignalExpr"]!),
        choice(seq("do", field("handler", $["Statement"]!), "end", optional("abort")), seq("end", optional("abort"))),
      ),

    SuspendStmt: ($) =>
      seq(
        "suspend",
        field("body", $["Statement"]!),
        "when",
        optional("immediate"),
        field("trigger", $["SignalExpr"]!),
        "end",
        optional("suspend"),
      ),

    TrapStmt: ($) =>
      seq(
        "trap",
        $["Identifier"]!,
        repeat(seq(",", $["Identifier"]!)),
        "in",
        field("body", $["Statement"]!),
        repeat(seq("handle", $["Identifier"]!, "do", $["Statement"]!)),
        "end",
        optional("trap"),
      ),

    ExitStmt: ($) => seq("exit", field("trap", $["Identifier"]!)),

    LocalSignalStmt: ($) =>
      seq(
        "signal",
        $["SignalItem"]!,
        repeat(seq(",", $["SignalItem"]!)),
        "in",
        field("body", $["Statement"]!),
        "end",
        optional("signal"),
      ),

    RunStmt: ($) =>
      seq(
        "run",
        field("module", $["Identifier"]!),
        optional(
          seq("[", repeat(seq(optional("signal"), $["Identifier"]!, "/", $["Identifier"]!, optional(","))), "]"),
        ),
      ),

    SignalExpr: ($) =>
      choice(
        prec.left(1, seq($["SignalExpr"]!, "or", $["SignalExpr"]!)),
        prec.left(2, seq($["SignalExpr"]!, "and", $["SignalExpr"]!)),
        prec.right(3, seq("not", $["SignalExpr"]!)),
        seq("(", $["SignalExpr"]!, ")"),
        "tick",
        $["Identifier"]!,
      ),

    LiteralValue: ($) => choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!),
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
    Comment: () => /%(?:\{([^}]|\}+[^}%])*\}+%|[^\n]*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInEsterelLibrarySync();
