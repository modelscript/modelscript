// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Formal DSL Grammar Specification for DOE-2.1E / DOE-2.2 BDL.
 *
 * Declarative Building Description Language (BDL) grammar defined via @modelscript/dsl,
 * compiled into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const doe2Grammar = language({
  name: "Doe2Bdl",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  lsp: {
    folding: ["NamedCommand", "SectionCommand", "EnvelopeCommand", "ScheduleCommand"],
    outline: [
      "SectionCommand",
      "MaterialCommand",
      "LayersCommand",
      "ConstructionCommand",
      "GlassTypeCommand",
      "ScheduleCommand",
      "SpaceCommand",
      "EnvelopeCommand",
      "ZoneCommand",
      "SystemCommand",
      "PlantCommand",
      "NamedCommand",
    ],
  },
  conflicts: ($) => [[$.ScheduleClause, $.TupleValue]],
  rules: {
    Document: ($) => repeat(choice($.Statement, $.CommentLine)),

    Statement: ($) =>
      choice(
        $.SectionCommand,
        $.ControlCommand,
        $.MaterialCommand,
        $.LayersCommand,
        $.ConstructionCommand,
        $.GlassTypeCommand,
        $.ScheduleCommand,
        $.SpaceCommand,
        $.EnvelopeCommand,
        $.ZoneCommand,
        $.SystemCommand,
        $.PlantCommand,
        $.NamedCommand,
        $.UnnamedCommand,
      ),

    SectionCommand: ($) =>
      seq(
        semanticToken("keyword", choice("INPUT", "input")),
        field(
          "section",
          semanticToken(
            "type",
            choice("LOADS", "loads", "SYSTEMS", "systems", "PLANT", "plant", "ECONOMICS", "economics"),
          ),
        ),
        repeat($.ParamItem),
        "..",
      ),

    ControlCommand: ($) =>
      seq(
        semanticToken(
          "keyword",
          choice(
            "TITLE",
            "title",
            "RUN-PERIOD",
            "run-period",
            "BUILDING-LOCATION",
            "building-location",
            "COMPUTE",
            "compute",
            "STOP",
            "stop",
            "END",
            "end",
          ),
        ),
        repeat($.ParamItem),
        "..",
      ),

    MaterialCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken("keyword", choice("MATERIAL", "material")),
        repeat($.ParamItem),
        "..",
      ),

    LayersCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken("keyword", choice("LAYERS", "layers")),
        repeat($.ParamItem),
        "..",
      ),

    ConstructionCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken("keyword", choice("CONSTRUCTION", "construction")),
        repeat($.ParamItem),
        "..",
      ),

    GlassTypeCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken("keyword", choice("GLASS-TYPE", "glass-type")),
        repeat($.ParamItem),
        "..",
      ),

    ScheduleCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken(
          "keyword",
          choice(
            "DAY-SCHEDULE",
            "day-schedule",
            "DAY-SCHEDULE-PD",
            "day-schedule-pd",
            "WEEK-SCHEDULE",
            "week-schedule",
            "WEEK-SCHEDULE-PD",
            "week-schedule-pd",
            "SCHEDULE",
            "schedule",
            "SCHEDULE-PD",
            "schedule-pd",
          ),
        ),
        repeat($.ParamItem),
        "..",
      ),

    SpaceCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken("keyword", choice("SPACE", "space")),
        repeat($.ParamItem),
        "..",
      ),

    EnvelopeCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken(
          "keyword",
          choice(
            "EXTERIOR-WALL",
            "exterior-wall",
            "ROOF",
            "roof",
            "UNDERGROUND-WALL",
            "underground-wall",
            "WINDOW",
            "window",
            "DOOR",
            "door",
          ),
        ),
        repeat($.ParamItem),
        "..",
      ),

    ZoneCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken("keyword", choice("ZONE", "zone")),
        repeat($.ParamItem),
        "..",
      ),

    SystemCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken("keyword", choice("SYSTEM", "system")),
        repeat($.ParamItem),
        "..",
      ),

    PlantCommand: ($) =>
      seq(
        field("name", $.ObjectName),
        "=",
        semanticToken("keyword", choice("PLANT-EQUIPMENT", "plant-equipment")),
        repeat($.ParamItem),
        "..",
      ),

    NamedCommand: ($) =>
      seq(field("name", $.ObjectName), "=", field("command", $.Identifier), repeat($.ParamItem), ".."),

    UnnamedCommand: ($) => seq(field("command", $.Identifier), repeat($.ParamItem), ".."),

    ParamItem: ($) => choice($.KeywordAssign, $.ScheduleClause, $.Value),

    KeywordAssign: ($) => seq(field("key", $.Identifier), "=", field("value", $.Value), optional(",")),

    ScheduleClause: ($) =>
      seq("(", field("start", $.Value), ",", field("end", $.Value), ")", field("value", $.Value), optional(",")),

    Value: ($) => choice($.TupleValue, $.NumberLiteral, $.StringLiteral, $.Identifier),

    TupleValue: ($) => seq("(", optional(seq($.Value, repeat(seq(optional(","), $.Value)))), ")"),

    ObjectName: ($) => choice($.StringLiteral, $.Identifier),

    CommentLine: () => /\$.*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_/-]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
  },
});
