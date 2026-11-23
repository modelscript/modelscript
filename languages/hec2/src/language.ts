// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq, type ActionExecutionContext } from "@modelscript/dsl";
import { registerBuiltInHec2LibrarySync } from "./catalog/library-package-adapter.js";
import { lowerHec2ToDae } from "./dae/hec2-to-dae.js";
import { Hec2ErrorCode } from "./errors.js";
import { hec2Indexing } from "./indexing.js";
import { lintHec2Deck } from "./lints/index.js";
import { parseHec2Deck } from "./parser/hec2-parser.js";
import { solveHec2Profile } from "./solver/standard-step.js";

/**
 * Formal `@modelscript/dsl` language specification for USACE HEC-2 Water Surface Profiles
 * card decks (`.hc2`, `.hec2`, `.dat`, `.inp`).
 *
 * Compiles to native WebAssembly GLR parser (`dist/parser.wasm`) via `build-language-parser.js`.
 */
export const hec2Language = language({
  name: "hec2",
  fileExtensions: [".hc2", ".hec2", ".dat", ".inp"],
  maturity: "beta",
  indexing: hec2Indexing,
  lsp: {
    fileExtensions: [".hc2", ".hec2", ".dat", ".inp"],
  },
  errorCodes: Hec2ErrorCode,

  rules: {
    Deck: ($) =>
      repeat(
        choice(
          $["TitleCard"]!,
          $["JobCard"]!,
          $["ManningCard"]!,
          $["DischargeCard"]!,
          $["CrossSectionCard"]!,
          $["GroundProfileCard"]!,
          $["BridgeCard"]!,
          $["EndCard"]!,
          $["CommentCard"]!,
        ),
      ),

    TitleCard: ($) =>
      seq(
        field("code", choice("T1", "T2", "T3")),
        repeat(choice($["Identifier"]!, $["NumberLiteral"]!, $["Punctuation"]!)),
      ),

    JobCard: ($) => seq(field("code", choice("J1", "J2", "J3", "J4", "J5", "J6")), repeat($["FieldItem"]!)),

    ManningCard: ($) => seq(field("code", choice("NC", "NH", "NV")), repeat($["FieldItem"]!)),

    DischargeCard: ($) => seq(field("code", "QT"), repeat($["FieldItem"]!)),

    CrossSectionCard: ($) => seq(field("code", choice("X1", "X2", "X3", "X4", "X5")), repeat($["FieldItem"]!)),

    GroundProfileCard: ($) => seq(field("code", "GR"), repeat($["FieldItem"]!)),

    BridgeCard: ($) => seq(field("code", choice("SB", "BT", "CI")), repeat($["FieldItem"]!)),

    EndCard: () => field("code", choice("EJ", "ER")),

    FieldItem: ($) => seq(optional(","), $["NumberLiteral"]!),

    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_/-]*/,
    Punctuation: () => /[,:;=()]+/,
    CommentCard: () => /(?:C [^\r\n]*|\*[^\r\n]*|![^\r\n]*)/,
  },

  actions: [
    {
      id: "hec2_lint",
      title: "Lint HEC-2 Card Deck",
      description: "Validates HEC-2 card syntax, Manning roughness, GR monotonicity, bank stations, and reach lengths.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const deck = parseHec2Deck(context.documentText || "");
        return lintHec2Deck(deck);
      },
    },
    {
      id: "hec2_solve_profile",
      title: "Solve HEC-2 Water Surface Profile",
      description: "Runs 1D Standard Step gradually-varied open-channel backwater profile solver.",
      category: "simulate",
      execute: async (context: ActionExecutionContext) => {
        const deck = parseHec2Deck(context.documentText || "");
        return solveHec2Profile(deck);
      },
    },
    {
      id: "hec2_to_dae",
      title: "Lower HEC-2 to DAE Arena",
      description: "Compiles steady 1D Saint-Venant energy & continuity equations directly into DAEBuilder.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const deck = parseHec2Deck(context.documentText || "");
        const arena = lowerHec2ToDae(deck);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
  ],
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInHec2LibrarySync();
