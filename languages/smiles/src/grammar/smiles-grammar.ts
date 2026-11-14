// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Formal DSL Grammar Specification.
 *
 * Declarative SMILES/SMARTS & MDL Molfile/SDF grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";

export const smilesGrammar = language({
  name: "Smiles",
  word: ($) => $.Identifier,
  extras: ($) => [/[ \t\r\n]+/, $.CommentLine],
  conflicts: ($) => [[$.MoleculeEntry]],
  lsp: {
    folding: ["MoleculeEntry", "MolfileRecord"],
    outline: ["MoleculeEntry", "MolfileRecord"],
  },
  rules: {
    Document: ($) => repeat(choice($.Record, $.CommentLine)),

    Record: ($) => choice($.MoleculeEntry, $.MolfileRecord),

    MoleculeEntry: ($) =>
      seq(
        field("smiles", choice($.SmilesPattern, $.Identifier)),
        optional(field("name", choice($.Identifier, $.SmilesPattern))),
      ),

    MolfileRecord: ($) =>
      seq(field("counts", $.CountsLine), repeat(choice($.SmilesPattern, $.Identifier)), $.MolfileEndLine),

    CountsLine: () => /.*(V2000|V3000)[^\r\n]*/,
    MolfileEndLine: () => /M\s+END[^\r\n]*/,

    SmilesPattern: () => /[A-Za-z0-9@+\-[\]()/\\#=.:%*]+/,

    CommentLine: () => /#[^\r\n]*/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_\-.]*/,
  },
});
