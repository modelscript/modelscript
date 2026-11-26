// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atopile — Formal `.ato` DSL Grammar Specification.
 *
 * Compiled into native WebAssembly GLR parse tables by `@modelscript/dsl`.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const atopileGrammar = language({
  name: "Atopile",
  word: ($) => $.Identifier,
  lsp: {
    folding: ["BlockDef"],
    outline: ["BlockDef", "ImportStmt", "InstanceStmt"],
  },
  conflicts: ($) => [
    [$.InstanceStmt, $.QualifiedRef],
    [$._OptionalUnit, $.Identifier],
  ],
  rules: {
    File: ($) => repeat(choice($.ImportStmt, $.BlockDef, $.Statement, $.Comment)),

    ImportStmt: ($) =>
      choice(
        seq(
          semanticToken("keyword", "from"),
          field("source", $.StringLiteral),
          semanticToken("keyword", "import"),
          field("target", $.Identifier),
        ),
        seq(semanticToken("keyword", "import"), field("target", $.Identifier)),
      ),

    BlockDef: ($) =>
      seq(
        field(
          "kind",
          choice(
            semanticToken("keyword", "module"),
            semanticToken("keyword", "component"),
            semanticToken("keyword", "interface"),
          ),
        ),
        field("name", $.Identifier),
        optional(seq(semanticToken("keyword", "from"), field("base", $.Identifier))),
        ":",
      ),

    Statement: ($) => choice($.SignalStmt, $.PinStmt, $.InstanceStmt, $.ConnectStmt, $.AssignStmt, $.AssertStmt),

    SignalStmt: ($) => seq(semanticToken("keyword", "signal"), field("name", $.Identifier)),

    PinStmt: ($) => seq(semanticToken("keyword", "pin"), field("number", choice($.NumberLiteral, $.Identifier))),

    InstanceStmt: ($) =>
      seq(field("name", $.Identifier), "=", semanticToken("keyword", "new"), field("type", $.Identifier)),

    ConnectStmt: ($) => seq(field("lhs", $.QualifiedRef), choice("~", "~>"), field("rhs", $.QualifiedRef)),

    AssignStmt: ($) =>
      seq(field("lhs", $.QualifiedRef), "=", field("rhs", choice($.PhysicalValue, $.StringLiteral, $.QualifiedRef))),

    AssertStmt: ($) =>
      seq(
        semanticToken("keyword", "assert"),
        field("lhs", $.QualifiedRef),
        field("op", choice(semanticToken("keyword", "within"), "<=", ">=", "<", ">", "==")),
        field("rhs", $.PhysicalValue),
      ),

    QualifiedRef: ($) => seq($.Identifier, repeat(seq(".", choice($.Identifier, $.NumberLiteral)))),

    _OptionalUnit: ($) => optional($.Identifier),

    PhysicalValue: ($) =>
      seq(
        $.NumberLiteral,
        $._OptionalUnit,
        optional(
          choice(
            seq("+/-", $.NumberLiteral, optional("%")),
            seq(semanticToken("keyword", "to"), $.NumberLiteral, $._OptionalUnit),
          ),
        ),
      ),

    StringLiteral: () => semanticToken("string", /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/),

    NumberLiteral: () => semanticToken("number", /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,

    Comment: () => semanticToken("comment", /#[^\n]*/),
  },
});
