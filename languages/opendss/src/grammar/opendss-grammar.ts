// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendss — Formal DSL Grammar Specification.
 *
 * Declarative OpenDSS distribution grid grammar defined via @modelscript/dsl language combinators,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, repeat, semanticToken, seq } from "@modelscript/dsl";

export const openDssGrammar = language({
  name: "OpenDssDeck",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  lsp: {
    folding: ["CircuitDef", "ElementDef"],
    outline: ["CircuitDef", "ElementDef", "CommandDirective"],
  },
  rules: {
    Deck: ($) => repeat(choice($.Statement, $.CommentLine)),

    Statement: ($) => choice($.CircuitDef, $.ElementDef, $.EditDirective, $.SetDirective, $.CommandDirective),

    CircuitDef: ($) =>
      seq(
        semanticToken("keyword", choice("New", "new")),
        semanticToken("type", choice("Circuit", "circuit")),
        ".",
        field("name", $.Identifier),
        repeat($.PropertyAssignment),
      ),

    ElementDef: ($) =>
      seq(
        semanticToken("keyword", choice("New", "new")),
        field("elementClass", $.ElementClass),
        ".",
        field("name", $.Identifier),
        repeat($.PropertyAssignment),
      ),

    EditDirective: ($) =>
      seq(
        semanticToken("keyword", choice("Edit", "edit")),
        field("elementClass", $.ElementClass),
        ".",
        field("name", $.Identifier),
        repeat($.PropertyAssignment),
      ),

    ElementClass: () =>
      choice(
        "Line",
        "line",
        "LineCode",
        "linecode",
        "Transformer",
        "transformer",
        "Load",
        "load",
        "LoadShape",
        "loadshape",
        "Capacitor",
        "capacitor",
        "Generator",
        "generator",
        "PVSystem",
        "pvsystem",
        "Storage",
        "storage",
        "Reactor",
        "reactor",
        "Monitor",
        "monitor",
        "EnergyMeter",
        "energymeter",
        "Relay",
        "relay",
        "Recloser",
        "recloser",
        "Fuse",
        "fuse",
      ),

    PropertyAssignment: ($) =>
      seq(
        field("key", $.Identifier),
        "=",
        field("value", choice($.MatrixLiteral, $.ArrayLiteral, $.NumberLiteral, $.StringLiteral, $.Identifier)),
      ),

    ArrayLiteral: ($) =>
      choice(
        seq("[", repeat(field("item", choice($.NumberLiteral, $.StringLiteral, $.Identifier))), "]"),
        seq("(", repeat(field("item", choice($.NumberLiteral, $.StringLiteral, $.Identifier))), ")"),
      ),

    MatrixLiteral: ($) => seq("|", repeat(choice($.NumberLiteral, "|")), "|"),

    SetDirective: ($) =>
      seq(
        semanticToken("keyword", choice("Set", "set")),
        field("key", $.Identifier),
        "=",
        field("value", choice($.NumberLiteral, $.StringLiteral, $.Identifier)),
      ),

    CommandDirective: ($) =>
      choice(
        seq(semanticToken("keyword", choice("Solve", "solve"))),
        seq(semanticToken("keyword", choice("Clear", "clear"))),
        seq(
          semanticToken("keyword", choice("Redirect", "redirect")),
          field("path", choice($.StringLiteral, $.Identifier)),
        ),
        seq(
          semanticToken("keyword", choice("Compile", "compile")),
          field("path", choice($.StringLiteral, $.Identifier)),
        ),
        seq(
          semanticToken("keyword", choice("BusCoords", "buscoords")),
          field("path", choice($.StringLiteral, $.Identifier)),
        ),
      ),

    CommentLine: () => /([!].*|\/\/.*)/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
  },
});
