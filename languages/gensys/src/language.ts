// SPDX-License-Identifier: AGPL-3.0-or-later

import { language } from "@modelscript/dsl";
import { gensysDeckGrammar } from "./grammar/gensys-grammar.js";

/**
 * DSL language specification for GENSYS railway vehicle models and track geometry.
 */
export const gensysLanguage = language({
  name: "gensys",
  fileExtensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel"],
    folding: gensysDeckGrammar.lsp?.folding,
    outline: gensysDeckGrammar.lsp?.outline,
  },
  word: gensysDeckGrammar.word,
  extras: gensysDeckGrammar.extras,
  conflicts: gensysDeckGrammar.conflicts,
  rules: gensysDeckGrammar.rules,
});

export default gensysLanguage;
