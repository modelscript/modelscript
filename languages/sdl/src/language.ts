// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInSdlLibrarySync } from "./catalog/library-package-adapter.js";
import { SdlErrorCode } from "./errors.js";
import { sdlIndexing } from "./indexing.js";

/**
 * DSL language specification for ITU-T Z.100 SDL-88 (.sdl, .pr, .sdl88).
 */
export const sdlLanguage = language({
  name: "sdl",
  fileExtensions: [".sdl", ".pr", ".sdl88"],
  maturity: "beta",
  indexing: sdlIndexing,
  lsp: {
    fileExtensions: [".sdl", ".pr", ".sdl88"],
  },
  errorCodes: SdlErrorCode,

  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!],

  rules: {
    Specification: ($) => repeat($["SystemDef"]!),

    SystemDef: ($) =>
      seq(
        "SYSTEM",
        field("name", $["Identifier"]!),
        ";",
        repeat(choice($["SignalDef"]!, $["ChannelDef"]!, $["BlockDef"]!)),
        "ENDSYSTEM",
        optional($["Identifier"]!),
        ";",
      ),

    SignalDef: ($) => seq("SIGNAL", $["SignalItem"]!, repeat(seq(",", $["SignalItem"]!)), ";"),

    SignalItem: ($) =>
      seq(
        field("name", $["Identifier"]!),
        optional(seq("(", $["Identifier"]!, repeat(seq(",", $["Identifier"]!)), ")")),
      ),

    ChannelDef: ($) =>
      seq(
        "CHANNEL",
        field("name", $["Identifier"]!),
        optional("NODELAY"),
        repeat($["ChannelPath"]!),
        "ENDCHANNEL",
        optional($["Identifier"]!),
        ";",
      ),

    ChannelPath: ($) =>
      seq(
        "FROM",
        field("from", $["Identifier"]!),
        "TO",
        field("to", $["Identifier"]!),
        "WITH",
        $["Identifier"]!,
        repeat(seq(",", $["Identifier"]!)),
        ";",
      ),

    BlockDef: ($) =>
      seq(
        "BLOCK",
        field("name", $["Identifier"]!),
        ";",
        repeat(choice($["SignalDef"]!, $["SignalRouteDef"]!, $["ConnectDef"]!, $["ProcessDef"]!)),
        "ENDBLOCK",
        optional($["Identifier"]!),
        ";",
      ),

    SignalRouteDef: ($) => seq("SIGNALROUTE", field("name", $["Identifier"]!), repeat($["ChannelPath"]!)),

    ConnectDef: ($) =>
      seq(
        "CONNECT",
        field("channel", $["Identifier"]!),
        "AND",
        $["Identifier"]!,
        repeat(seq(",", $["Identifier"]!)),
        ";",
      ),

    ProcessDef: ($) =>
      seq(
        "PROCESS",
        field("name", $["Identifier"]!),
        optional(seq("(", $["NumberLiteral"]!, optional(seq(",", $["NumberLiteral"]!)), ")")),
        ";",
        repeat(choice($["DclDef"]!, $["TimerDef"]!, $["StartDef"]!, $["StateDef"]!)),
        "ENDPROCESS",
        optional($["Identifier"]!),
        ";",
      ),

    DclDef: ($) =>
      seq(
        "DCL",
        field("name", $["Identifier"]!),
        repeat(seq(",", $["Identifier"]!)),
        field("sort", $["Identifier"]!),
        optional(seq(":=", $["Expr"]!)),
        ";",
      ),

    TimerDef: ($) => seq("TIMER", field("name", $["Identifier"]!), repeat(seq(",", $["Identifier"]!)), ";"),

    StartDef: ($) => seq("START", ";", $["Transition"]!),

    StateDef: ($) =>
      seq(
        "STATE",
        field("name", choice($["Identifier"]!, "*")),
        repeat(seq(",", $["Identifier"]!)),
        ";",
        repeat($["InputDef"]!),
        optional(seq("ENDSTATE", optional($["Identifier"]!), ";")),
      ),

    InputDef: ($) =>
      seq(
        "INPUT",
        field("signal", $["Identifier"]!),
        optional(seq("(", $["Identifier"]!, repeat(seq(",", $["Identifier"]!)), ")")),
        ";",
        $["Transition"]!,
      ),

    Transition: ($) =>
      seq(
        repeat(choice($["OutputAction"]!, $["TaskAction"]!, $["SetAction"]!, $["ResetAction"]!, $["DecisionAction"]!)),
        optional($["Terminator"]!),
      ),

    OutputAction: ($) =>
      seq(
        "OUTPUT",
        field("signal", $["Identifier"]!),
        optional(seq("(", $["Expr"]!, repeat(seq(",", $["Expr"]!)), ")")),
        optional(seq("TO", $["Identifier"]!)),
        optional(seq("VIA", $["Identifier"]!)),
        ";",
      ),

    TaskAction: ($) => seq("TASK", $["Assignment"]!, repeat(seq(",", $["Assignment"]!)), ";"),

    Assignment: ($) => seq(field("target", $["Identifier"]!), ":=", field("value", $["Expr"]!)),

    SetAction: ($) => seq("SET", "(", $["Expr"]!, ",", field("timer", $["Identifier"]!), ")", ";"),

    ResetAction: ($) => seq("RESET", "(", field("timer", $["Identifier"]!), ")", ";"),

    DecisionAction: ($) => seq("DECISION", $["Expr"]!, ";", repeat($["DecisionBranch"]!), "ENDDECISION", ";"),

    DecisionBranch: ($) => seq(choice(seq("(", $["Expr"]!, ")"), "ELSE"), ":", $["Transition"]!),

    Terminator: ($) => choice(seq("NEXTSTATE", field("target", choice($["Identifier"]!, "-")), ";"), seq("STOP", ";")),

    Expr: ($) =>
      seq(
        $["Atom"]!,
        repeat(seq(choice("+", "-", "*", "/", "MOD", "=", "/=", "<", "<=", ">", ">=", "AND", "OR"), $["Atom"]!)),
      ),

    Atom: ($) =>
      choice(
        $["NumberLiteral"]!,
        $["StringLiteral"]!,
        "NOW",
        "TRUE",
        "FALSE",
        seq("NOT", $["Atom"]!),
        seq("(", $["Expr"]!, ")"),
        $["Identifier"]!,
      ),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /'[^']*'|"[^"]*"/,
    Comment: () => /\/\*([^*]|\*+[^*/])*\*+\//,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInSdlLibrarySync();
