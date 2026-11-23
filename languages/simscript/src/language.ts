// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInSimscriptLibrarySync } from "./catalog/library-package-adapter.js";
import { SimscriptErrorCode } from "./errors.js";
import { simscriptIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for SIMSCRIPT II.5
 * (RAND Discrete-Event Simulation Language, 1962-1968).
 */
export const simscriptLanguage = language({
  name: "simscript",
  fileExtensions: [".sim", ".simscript", ".s25"],
  maturity: "beta",
  indexing: simscriptIndexing,
  lsp: {
    fileExtensions: [".sim", ".simscript", ".s25"],
  },
  errorCodes: SimscriptErrorCode,

  rules: {
    Program: ($) =>
      repeat(
        choice(
          $["PreambleSection"]!,
          $["MainSection"]!,
          $["ProcessSection"]!,
          $["EventSection"]!,
          $["RoutineSection"]!,
          $["Comment"]!,
        ),
      ),

    PreambleSection: ($) =>
      seq(
        "PREAMBLE",
        repeat(
          choice(
            $["PreambleGroupHeader"]!,
            $["EveryDeclaration"]!,
            $["IncludeDeclaration"]!,
            $["DefineDeclaration"]!,
            $["TallyDeclaration"]!,
            $["AccumulateDeclaration"]!,
            $["Comment"]!,
          ),
        ),
        "END",
      ),

    PreambleGroupHeader: () =>
      choice(
        seq("TEMPORARY", "ENTITIES"),
        seq("PERMANENT", "ENTITIES"),
        "PROCESSES",
        "RESOURCES",
        seq("EVENT", "NOTICES"),
      ),

    EveryDeclaration: ($) =>
      seq(
        "EVERY",
        field("name", $["Identifier"]!),
        repeat(choice($["HasClause"]!, $["OwnsClause"]!, $["BelongsToClause"]!)),
      ),

    HasClause: ($) => seq("HAS", $["Identifier"]!),

    OwnsClause: ($) => seq("OWNS", $["Identifier"]!),

    BelongsToClause: ($) => seq("BELONGS", "TO", $["Identifier"]!),

    IncludeDeclaration: ($) => seq("INCLUDE", field("name", $["Identifier"]!)),

    DefineDeclaration: ($) =>
      seq(
        "DEFINE",
        field("name", $["Identifier"]!),
        "AS",
        optional(choice("A", "AN")),
        choice("REAL", "INTEGER", "ALPHA", "TEXT", "FIFO", "LIFO", "RANKED"),
        choice("VARIABLE", "VARIABLES", "ARRAY", "SET"),
      ),

    TallyDeclaration: ($) =>
      seq(
        "TALLY",
        field("stat", $["Identifier"]!),
        "AS",
        optional("THE"),
        choice("MEAN", "MAX", "MIN", "NUMBER", "SUM", "STD.DEV"),
        "OF",
        field("target", $["Identifier"]!),
      ),

    AccumulateDeclaration: ($) =>
      seq(
        "ACCUMULATE",
        field("stat", $["Identifier"]!),
        "AS",
        optional("THE"),
        choice("MEAN", "MAX", "MIN", "STD.DEV"),
        "OF",
        field("target", $["Identifier"]!),
      ),

    MainSection: ($) => seq("MAIN", repeat(choice($["Statement"]!, $["Comment"]!)), "END"),

    ProcessSection: ($) =>
      seq("PROCESS", field("name", $["Identifier"]!), repeat(choice($["Statement"]!, $["Comment"]!)), "END"),

    EventSection: ($) =>
      seq("EVENT", field("name", $["Identifier"]!), repeat(choice($["Statement"]!, $["Comment"]!)), "END"),

    RoutineSection: ($) =>
      seq("ROUTINE", field("name", $["Identifier"]!), repeat(choice($["Statement"]!, $["Comment"]!)), "END"),

    Statement: ($) =>
      choice(
        $["StartSimulationStmt"]!,
        $["CreateStmt"]!,
        $["DestroyStmt"]!,
        $["ActivateStmt"]!,
        $["ScheduleStmt"]!,
        $["WorkStmt"]!,
        $["WaitStmt"]!,
        $["RequestStmt"]!,
        $["RelinquishStmt"]!,
        $["FileStmt"]!,
        $["RemoveStmt"]!,
        $["LetStmt"]!,
        $["ReturnStmt"]!,
        $["StopStmt"]!,
      ),

    StartSimulationStmt: () => seq("START", "SIMULATION"),

    CreateStmt: ($) =>
      seq(
        "CREATE",
        optional(choice("A", "AN", "EVERY")),
        field("entity", $["Identifier"]!),
        optional(seq("(", $["NumberLiteral"]!, ")")),
      ),

    DestroyStmt: ($) => seq("DESTROY", optional(choice("THIS", "THE")), field("entity", $["Identifier"]!)),

    ActivateStmt: ($) =>
      seq(
        "ACTIVATE",
        optional(choice("A", "AN")),
        field("process", $["Identifier"]!),
        choice("NOW", seq("IN", $["Expr"]!, optional($["TimeUnit"]!))),
      ),

    ScheduleStmt: ($) =>
      seq(
        "SCHEDULE",
        optional(choice("A", "AN")),
        field("event", $["Identifier"]!),
        choice("NOW", seq("IN", $["Expr"]!, optional($["TimeUnit"]!))),
      ),

    WorkStmt: ($) => seq("WORK", $["Expr"]!, optional($["TimeUnit"]!)),

    WaitStmt: ($) => seq("WAIT", $["Expr"]!, optional($["TimeUnit"]!)),

    RequestStmt: ($) =>
      seq(
        "REQUEST",
        field("quantity", $["NumberLiteral"]!),
        field("resource", $["Identifier"]!),
        optional(seq("WITH", "PRIORITY", $["NumberLiteral"]!)),
      ),

    RelinquishStmt: ($) =>
      seq("RELINQUISH", field("quantity", $["NumberLiteral"]!), field("resource", $["Identifier"]!)),

    FileStmt: ($) =>
      seq(
        "FILE",
        optional(choice("THIS", "THE")),
        field("entity", $["Identifier"]!),
        "IN",
        field("set", $["Identifier"]!),
      ),

    RemoveStmt: ($) =>
      seq(
        "REMOVE",
        optional(choice("FIRST", "LAST")),
        field("entity", $["Identifier"]!),
        "FROM",
        field("set", $["Identifier"]!),
      ),

    LetStmt: ($) => seq("LET", field("target", $["Identifier"]!), "=", field("value", $["Expr"]!)),

    ReturnStmt: () => "RETURN",

    StopStmt: () => "STOP",

    TimeUnit: () => choice("DAYS", "HOURS", "MINUTES", "SECONDS", "UNITS"),

    Expr: ($) => choice($["CallExpr"]!, $["NumberLiteral"]!, $["Identifier"]!),

    CallExpr: ($) =>
      seq(
        field("callee", $["Identifier"]!),
        "(",
        optional(seq($["NumberLiteral"]!, repeat(seq(",", $["NumberLiteral"]!)))),
        ")",
      ),

    Identifier: () => /[A-Za-z][A-Za-z0-9._]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    Comment: () => /''[^\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInSimscriptLibrarySync();
