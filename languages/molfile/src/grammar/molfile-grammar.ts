// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/molfile — Formal DSL Grammar Specification.
 *
 * Declarative MDL Molfile (V2000 / V3000) & Structure-Data File (SDF) grammar
 * defined via `@modelscript/dsl` combinators, compiling to a native WebAssembly
 * GLR parser (`dist/parser.wasm`) and linear-memory CST.
 */

import { choice, field, language, repeat } from "@modelscript/dsl";

export const molfileGrammar = language({
  name: "Molfile",
  word: ($) => $.Identifier,
  extras: () => [/[ \t\r\n]+/],
  lsp: {
    folding: ["V3000Directive", "SdfDataHeader"],
    outline: ["SdfDataHeader", "PropertyEndLine", "SdfDelimiter"],
  },
  rules: {
    Document: ($) => repeat($.Item),

    Item: ($) =>
      choice(
        $.SdfDelimiter,
        $.SdfDataHeader,
        $.V3000BeginCtab,
        $.V3000EndCtab,
        $.V3000CountsLine,
        $.V3000BeginAtom,
        $.V3000EndAtom,
        $.V3000BeginBond,
        $.V3000EndBond,
        $.V3000Directive,
        $.PropertyChgLine,
        $.PropertyIsoLine,
        $.PropertyRadLine,
        $.PropertyEndLine,
        $.VersionTag,
        $.AtomOrFieldToken,
      ),

    AtomOrFieldToken: ($) => field("token", choice($.NumberToken, $.Identifier, $.PunctToken)),

    // SDF multi-record delimiter and data item header
    SdfDelimiter: () => /\$\$\$\$/,
    SdfDataHeader: () => />[ \t]*<[^>\r\n]+>[^\r\n]*/,

    // MDL V3000 CTAB directives
    V3000BeginCtab: () => /M[ \t]+V30[ \t]+BEGIN[ \t]+CTAB[^\r\n]*/,
    V3000EndCtab: () => /M[ \t]+V30[ \t]+END[ \t]+CTAB[^\r\n]*/,
    V3000CountsLine: () => /M[ \t]+V30[ \t]+COUNTS[^\r\n]*/,
    V3000BeginAtom: () => /M[ \t]+V30[ \t]+BEGIN[ \t]+ATOM[^\r\n]*/,
    V3000EndAtom: () => /M[ \t]+V30[ \t]+END[ \t]+ATOM[^\r\n]*/,
    V3000BeginBond: () => /M[ \t]+V30[ \t]+BEGIN[ \t]+BOND[^\r\n]*/,
    V3000EndBond: () => /M[ \t]+V30[ \t]+END[ \t]+BOND[^\r\n]*/,
    V3000Directive: () => /M[ \t]+V30[^\r\n]*/,

    // MDL V2000 property block lines
    PropertyChgLine: () => /M[ \t]+CHG[^\r\n]*/,
    PropertyIsoLine: () => /M[ \t]+ISO[^\r\n]*/,
    PropertyRadLine: () => /M[ \t]+RAD[^\r\n]*/,
    PropertyEndLine: () => /M[ \t]+END[ \t]*/,

    // Counts line version tag
    VersionTag: () => /V2000|V3000/,

    // Coordinates, counts, element symbols, and general header/data tokens
    NumberToken: () => /[+-]?[0-9]+(\.[0-9]+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_\-.]*/,
    PunctToken: () => /[^ \t\r\nA-Za-z0-9_]+/,
  },
});
