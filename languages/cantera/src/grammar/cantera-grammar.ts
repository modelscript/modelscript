// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Formal DSL Grammar Specification.
 *
 * Declarative Cantera chemical kinetics & thermochemistry grammar supporting both
 * modern YAML (.yaml) and legacy CTI (.cti) specifications defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, repeat1, seq } from "@modelscript/dsl";

export const canteraGrammar = language({
  name: "Cantera",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: ["CtiDirective", "YamlSection", "YamlSequenceItem"],
    outline: ["CtiDirective", "YamlSection"],
  },
  rules: {
    MechanismFile: ($) => optional(choice($.YamlDocument, $.CtiDocument)),

    YamlDocument: ($) => repeat1(choice($.DocMarker, $.YamlSection, $.YamlSequenceItem)),

    CtiDocument: ($) => repeat1($.CtiDirective),

    // Legacy CTI directive: ideal_gas(...), species(...), reaction(...)
    CtiDirective: ($) => seq(field("directiveName", $.Identifier), "(", $.GroupBody, ")"),

    // Modern Cantera YAML key-value / block-header entries
    YamlSection: ($) =>
      choice(seq(field("sectionKey", $.YamlKey), field("value", $.LineValue)), field("sectionKey", $.YamlKey)),

    YamlSequenceItem: ($) => choice(seq("-", $.YamlSection), seq("-", $.LineValue)),

    LineValue: ($) => repeat1($.ValueAtom),

    ValueAtom: ($) =>
      choice(
        $.YamlMapping,
        $.ListLiteral,
        $.TupleLiteral,
        $.StringLiteral,
        $.NumberLiteral,
        $.Identifier,
        $.ReactionOp,
      ),

    // YAML flow mapping: {A: 1.2e+17, b: -1.0, Ea: 0.0}
    YamlMapping: ($) => seq("{", $.GroupBody, "}"),

    ListLiteral: ($) => seq("[", $.GroupBody, "]"),

    TupleLiteral: ($) => seq("(", $.GroupBody, ")"),

    GroupBody: ($) => repeat(choice($.ValueAtom, $.YamlKey, ":", ",", "=", "-")),

    // Terminals
    DocMarker: () => /---|\.\.\./,
    YamlKey: () => /[a-zA-Z_][a-zA-Z0-9_.+-]*:/,
    ReactionOp: () => /<=>|<=|=>|<->|->|\+|\//,
    CommentLine: () => /(?:#|\/\/)[^\r\n]*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.+-]*/,
    StringLiteral: () => /"([^"\\\r\n]|\\.)*"|'([^'\\\r\n]|\\.)*'/,
    NumberLiteral: () => /[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?/,
  },
});
