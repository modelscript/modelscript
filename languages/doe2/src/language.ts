// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Language Definition.
 *
 * Registers DOE-2.1E / DOE-2.2 BDL (.inp, .bdl) file extensions, native WASM GLR
 * grammar, workspace indexing, pre-flight linter, DAE lowering, and polyglot exports.
 */

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInDoe2LibrarySync } from "./catalog/library-package-adapter.js";
import { lowerDoe2ToDae } from "./dae/index.js";
import { doe2Grammar } from "./grammar/doe2-grammar.js";
import { canIndexDoe2, indexDoe2Document } from "./indexing.js";
import { lintDoe2 } from "./lints/index.js";
import { parseDoe2 } from "./parser/index.js";
import { doe2ToEnergyPlusIdf, doe2ToModelica } from "./projections/index.js";

export const doe2Language = language({
  name: "doe2",
  fileExtensions: [".inp", ".bdl"],
  maturity: "beta",
  indexing: {
    indexFile: indexDoe2Document,
    canIndex: canIndexDoe2,
  },
  lsp: {
    fileExtensions: [".inp", ".bdl"],
    folding: doe2Grammar.lsp?.folding,
    outline: doe2Grammar.lsp?.outline,
  },
  word: doe2Grammar.word,
  extras: doe2Grammar.extras,
  conflicts: doe2Grammar.conflicts,
  rules: doe2Grammar.rules,

  actions: [
    {
      id: "doe2_lint",
      title: "Lint DOE-2 BDL Input Deck",
      description: "Validates DOE-2.1E/2.2 syntax, '..' terminators, object references, and physical bounds.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseDoe2(context.documentText || "");
        return lintDoe2(doc);
      },
    },
    {
      id: "doe2_to_dae",
      title: "Lower DOE-2 Building to DAE Arena",
      description: "Lowers DOE-2 multi-layer envelope U-values and zone RC ODEs to ModelScript DAEBuilder.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseDoe2(context.documentText || "");
        const arena = lowerDoe2ToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "doe2_to_energyplus",
      title: "Export DOE-2 BDL to EnergyPlus IDF",
      description: "Projects DOE-2 materials, constructions, spaces, and zones to SI EnergyPlus IDF.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseDoe2(context.documentText || "");
        return doe2ToEnergyPlusIdf(doc);
      },
    },
    {
      id: "doe2_to_modelica",
      title: "Export DOE-2 BDL to Modelica Thermal Network",
      description: "Translates DOE-2 thermal zones and envelope conductances into Modelica.Thermal components.",
      category: "export",
      execute: async (context: ActionExecutionContext) => {
        const doc = parseDoe2(context.documentText || "");
        return doe2ToModelica(doc);
      },
    },
  ],
});

registerBuiltInDoe2LibrarySync();

export default doe2Language;
