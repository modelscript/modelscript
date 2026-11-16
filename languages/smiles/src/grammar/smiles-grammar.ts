// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Formal DSL Grammar Specification.
 *
 * Declarative SMILES/SMARTS & MDL Molfile/SDF grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, repeat } from "@modelscript/dsl";

export const smilesGrammar = language({
  name: "Smiles",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  lsp: {
    folding: ["MoleculeEntry", "MolfileRecord"],
    outline: ["MoleculeEntry", "MolfileRecord"],
  },
  rules: {
    Document: ($) => repeat($.Record),

    Record: ($) => choice($.SdfDelimiter, $.SdfDataHeader, $.MolfileRecord, $.MoleculeEntry),

    MoleculeEntry: ($) => field("smiles", choice($.SmilesPattern, $.Identifier, $.QuotedString)),

    MolfileRecord: () => /M[ \t]+(END|CHG|ISO|RAD|RGP|V30)[^\r\n]*/,
    SdfDataHeader: () => />[ \t]*<[^>\r\n]+>[^\r\n]*/,
    SdfDelimiter: () => /\$\$\$\$/,
    QuotedString: () => /"[^"\r\n]*"|'[^'\r\n]*'/,

    SmilesPattern: () => /[A-Za-z0-9@+\-[\]()/\\#=.:%*,~&!;]+/,

    CommentLine: () => /(#|\/\/)[^\r\n]*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_\-.]*/,
  },
});
