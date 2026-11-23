// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { buildKenoCadAssembly } from "./cad/keno-geometry.js";
import { registerBuiltInScaleLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerScaleToDae } from "./dae/scale-to-dae.js";
import { scaleDeckGrammar } from "./grammar/scale-grammar.js";
import { scaleIndexing } from "./indexing.js";
import { lintScale } from "./lints/index.js";
import { parseScale } from "./parser/scale-parser.js";
import { scaleToMcnp } from "./projections/scale-to-mcnp.js";
import { scaleToModelica } from "./projections/scale-to-modelica.js";
import { solveScaleDeck, type BatemanMethod } from "./solver/bateman-solver.js";

/**
 * ModelScript ORNL SCALE / KENO V.a-VI / ORIGEN (.scale, .scl, .keno, .origen) Language Definition.
 */
export const scaleLanguage = language({
  name: "scale",
  fileExtensions: [".scale", ".scl", ".keno", ".origen"],
  maturity: "beta",
  indexing: scaleIndexing,
  lsp: {
    fileExtensions: [".scale", ".scl", ".keno", ".origen"],
    folding: scaleDeckGrammar.lsp?.folding,
    outline: scaleDeckGrammar.lsp?.outline,
  },
  word: scaleDeckGrammar.word,
  extras: scaleDeckGrammar.extras,
  rules: scaleDeckGrammar.rules,

  writeback: {
    operators: ["="],
  },

  actions: [
    {
      id: "lint_scale",
      title: "Lint SCALE Deck",
      description: "Validates SCALE sequences, compositions, KENO geometry units/arrays, and ORIGEN depletion steps.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintScale(parseScale(text));
      },
    },
    {
      id: "scale_solve_bateman",
      title: "Solve ORIGEN Bateman Depletion",
      description: "Solves Bateman isotope transmutation/decay ODEs and computes nuclide inventory and decay heat.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; method?: BatemanMethod | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        return solveScaleDeck(parseScale(text), params?.method ?? "expm");
      },
    },
    {
      id: "scale_to_dae",
      title: "Lower SCALE to DAE",
      description: "Lowers ORIGEN Bateman depletion ODEs directly into ModelScript DAEBuilder linear memory.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const deck = parseScale(text);
        const dae = lowerScaleToDae(deck);
        return {
          modelName: deck.title || "ScaleBatemanDepletion",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "scale_build_keno_cad",
      title: "Build KENO CSG Geometry",
      description: "Compiles KENO units, concentric media regions, and array lattices into @modelscript/cad Assembly.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        return buildKenoCadAssembly(parseScale(text));
      },
    },
    {
      id: "scale_to_modelica",
      title: "Project SCALE to Modelica",
      description: "Exports ORIGEN Bateman depletion equations as a Modelica 3.x simulation model.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return scaleToModelica(parseScale(text), params?.modelName);
      },
    },
    {
      id: "scale_to_mcnp",
      title: "Project SCALE to MCNP",
      description: "Exports SCALE/KENO geometry and compositions as an MCNP criticality input deck.",
      category: "export",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return scaleToMcnp(parseScale(text));
      },
    },
  ],
});

export default scaleLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInScaleLibrarySync();
