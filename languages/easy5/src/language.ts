// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { Easy5ErrorCode } from "./lints/index.js";

/**
 * DSL language specification for Boeing / MSC Software EASY5 (.ez5, .ezm, .ezd, .eas).
 */
export const easy5Language = language({
  name: "easy5",
  fileExtensions: [".ez5", ".ezm", ".ezd", ".eas"],
  lsp: {
    fileExtensions: [".ez5", ".ezm", ".ezd", ".eas"],
  },

  errorCodes: Easy5ErrorCode,

  rules: {
    Model: ($) =>
      seq(
        optional($.ModelHeader),
        repeat(choice($.ComponentsSection, $.ConnectionsSection, $.SimulationSection, $.LinearSection, $.Comment)),
      ),

    ModelHeader: ($) =>
      choice(seq("MODEL", ":", field("name", $.Identifier)), seq("TITLE", ":", field("title", $.StringLiteral))),

    ComponentsSection: ($) =>
      seq(choice("COMPONENTS:", "COMPONENTS"), repeat(choice($.ComponentDeclaration, $.Comment))),

    ComponentDeclaration: ($) =>
      seq(
        field("id", $.Identifier),
        optional(seq("TYPE", "=")),
        field("type", choice($.Identifier, $.QualifiedType)),
        repeat($.Attribute),
      ),

    Attribute: ($) =>
      choice(
        seq("TITLE", "=", $.StringLiteral),
        seq("X", "=", $.NumberLiteral),
        seq("Y", "=", $.NumberLiteral),
        seq("XP", ":", repeat($.ParameterAssignment)),
        seq("S0", ":", repeat($.StateAssignment)),
        seq("PORTS", ":", repeat($.PortDeclaration)),
      ),

    ParameterAssignment: ($) =>
      seq(field("name", $.Identifier), "=", field("value", choice($.NumberLiteral, $.ArrayLiteral, $.StringLiteral))),

    StateAssignment: ($) => seq(field("name", $.Identifier), "=", field("value", $.NumberLiteral)),

    PortDeclaration: ($) =>
      seq(field("name", $.Identifier), "=", field("kind", choice("input", "output", "bidirectional"))),

    ConnectionsSection: ($) => seq(choice("CONNECTIONS:", "CONNECTIONS"), repeat(choice($.Connection, $.Comment))),

    Connection: ($) =>
      choice(
        seq(
          field("fromComp", $.Identifier),
          ".",
          field("fromPort", $.Identifier),
          choice("->", "-->", "=>"),
          field("toComp", $.Identifier),
          ".",
          field("toPort", $.Identifier),
        ),
        seq(
          "CONNECT",
          field("fromComp", $.Identifier),
          optional("."),
          field("fromPort", $.Identifier),
          "TO",
          field("toComp", $.Identifier),
          optional("."),
          field("toPort", $.Identifier),
        ),
        seq(
          field("toComp", $.Identifier),
          ".",
          field("toPort", $.Identifier),
          "=",
          field("fromComp", $.Identifier),
          ".",
          field("fromPort", $.Identifier),
        ),
      ),

    SimulationSection: ($) => seq(choice("SIMULATION:", "SIMULATION"), repeat(choice($.ConfigAssignment, $.Comment))),

    LinearSection: ($) => seq(choice("LINEAR:", "LINEAR"), repeat(choice($.ConfigAssignment, $.Comment))),

    ConfigAssignment: ($) =>
      seq(field("key", $.Identifier), "=", field("value", choice($.NumberLiteral, $.StringLiteral, $.Identifier))),

    QualifiedType: ($) => seq($.Identifier, "/", $.Identifier),

    ArrayLiteral: ($) => seq("[", repeat(choice($.NumberLiteral, ",")), "]"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
    Comment: () => /(!|#|--).*|\bC\s+.*/,
  },
});
