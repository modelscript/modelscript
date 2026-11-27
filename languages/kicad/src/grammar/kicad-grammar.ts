// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Formal S-Expression Grammar Specification.
 *
 * Unified KiCad 6/7/8/9 S-expression grammar covering `.kicad_pcb`,
 * `.kicad_sch`, `.kicad_sym`, and `.kicad_mod`, compiled into native
 * WebAssembly GLR parse tables by `@modelscript/dsl`.
 */

import { choice, field, language, repeat, semanticToken, seq } from "@modelscript/dsl";

export const kicadGrammar = language({
  name: "KiCad",
  word: ($) => $.Symbol,
  lsp: {
    folding: ["SExpr"],
    outline: ["SExpr"],
  },
  rules: {
    Document: ($) => repeat($.SExpr),

    SExpr: ($) => seq("(", field("head", $.HeadSymbol), repeat(field("item", $.Item)), ")"),

    HeadSymbol: ($) => semanticToken("function", $.Symbol),

    Item: ($) => choice($.SExpr, $.StringLiteral, $.NumberLiteral, semanticToken("parameter", $.Symbol)),

    StringLiteral: () => semanticToken("string", /"(?:[^"\\]|\\.)*"/),

    NumberLiteral: () => semanticToken("number", /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/),

    Symbol: () => /[^\s()"]+/,
  },
});
