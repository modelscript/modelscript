// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { RocetsErrorCode } from "./lints/index.js";

/**
 * DSL language specification for NASA ROCETS (.roc, .rct, .inp).
 */
export const rocetsLanguage = language({
  name: "rocets",
  fileExtensions: [".roc", ".rct", ".inp"],
  lsp: {
    fileExtensions: [".roc", ".rct", ".inp"],
  },

  errorCodes: RocetsErrorCode,

  rules: {
    Model: ($) =>
      seq(
        optional($.ModelHeader),
        repeat(choice($.ComponentsSection, $.ConnectionsSection, $.PropsSection, $.BalanceSection, $.Comment)),
      ),

    ModelHeader: ($) =>
      choice(
        seq(choice("MODEL", "TITLE"), ":", field("name", $.Identifier)),
        seq("ENGINE", ":", field("name", $.Identifier)),
      ),

    ComponentsSection: ($) =>
      seq(
        choice("COMPONENTS:", "COMPONENTS", "MODULES:", "MODULES"),
        repeat(choice($.ComponentDeclaration, $.Comment)),
      ),

    ComponentDeclaration: ($) =>
      seq(
        field("id", $.Identifier),
        optional(seq(choice("TYPE", "MODULE"), "=")),
        field("type", choice($.Identifier, $.QualifiedType)),
        repeat($.Attribute),
      ),

    Attribute: ($) =>
      choice(
        seq("TITLE", "=", $.StringLiteral),
        seq("FLUID", "=", $.Identifier),
        seq("X", "=", $.NumberLiteral),
        seq("Y", "=", $.NumberLiteral),
        seq("PARAMS", ":", repeat($.ParameterAssignment)),
        seq("XP", ":", repeat($.ParameterAssignment)),
        seq("S0", ":", repeat($.StateAssignment)),
        seq("PORTS", ":", repeat($.PortDeclaration)),
      ),

    ParameterAssignment: ($) =>
      seq(field("key", $.Identifier), "=", field("value", choice($.NumberLiteral, $.StringLiteral, $.ArrayLiteral))),

    StateAssignment: ($) => seq(field("state", $.Identifier), "=", field("value", $.NumberLiteral)),

    PortDeclaration: ($) =>
      seq(
        field("name", $.Identifier),
        optional(seq("(", choice("IN", "OUT", "BI"), ")")),
        optional(seq("FLUID", "=", field("fluid", $.Identifier))),
      ),

    ConnectionsSection: ($) =>
      seq(
        choice("CONNECTIONS:", "CONNECTIONS", "STREAMS:", "STREAMS"),
        repeat(choice($.ConnectionStatement, $.Comment)),
      ),

    ConnectionStatement: ($) =>
      seq(
        field("fromComponent", $.Identifier),
        ".",
        field("fromPort", $.Identifier),
        choice("->", "TO", "=>"),
        field("toComponent", $.Identifier),
        ".",
        field("toPort", $.Identifier),
        optional(seq("FLUID", "=", field("fluid", $.Identifier))),
      ),

    PropsSection: ($) =>
      seq(choice("PROPELLANTS:", "PROPS:", "FLUIDS:"), repeat(choice($.PropellantDeclaration, $.Comment))),

    PropellantDeclaration: ($) =>
      seq(
        field("name", $.Identifier),
        choice("LOX", "LH2", "LCH4", "RP1", "GH2", "GOX", "COMBUSTION_GAS", "HELIUM", "NITROGEN"),
      ),

    BalanceSection: ($) => seq(choice("BALANCE:", "CONTROL:", "DESIGN:"), repeat($.ParameterAssignment)),

    QualifiedType: ($) => seq($.Identifier, "/", $.Identifier),
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    ArrayLiteral: ($) => seq("[", repeat(seq($.NumberLiteral, optional(","))), "]"),
    Comment: () => /(?:\/\/.*|\/\*[\s\S]*?\*\/|#.*|\*.*|\$.*)/,
  },
});
