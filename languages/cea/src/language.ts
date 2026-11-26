// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Declarative @modelscript/dsl Language & WASM GLR Grammar Specification
 * for NASA CEA (Chemical Equilibrium with Applications) problem decks.
 */

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInCeaLibrarySync } from "./catalog/library-package-adapter.js";
import { CeaErrorCode } from "./errors.js";
import { ceaIndexing } from "./indexing.js";

export const ceaLanguage = language({
  name: "cea",
  fileExtensions: [".cea", ".inp"],
  maturity: "beta",
  indexing: ceaIndexing,
  lsp: {
    fileExtensions: [".cea", ".inp"],
  },
  errorCodes: CeaErrorCode,

  extras: ($) => [/[ \t\r\n]+/, $["Comment"]!],

  rules: {
    Deck: ($) =>
      repeat(
        choice(
          $["ProblemSection"]!,
          $["ReactantsSection"]!,
          $["OnlySection"]!,
          $["OmitSection"]!,
          $["InsertSection"]!,
          $["OutputSection"]!,
          $["EndStatement"]!,
        ),
      ),

    ProblemSection: ($) => seq(choice("problem", "prob", "PROBLEM", "PROB"), repeat($["ProblemItem"]!)),

    ProblemItem: ($) => choice($["ProblemType"]!, $["ProblemMode"]!, $["ProblemAssignment"]!),

    ProblemType: () =>
      choice(
        "hp",
        "tp",
        "uv",
        "tv",
        "sp",
        "sv",
        "rocket",
        "rkt",
        "deton",
        "det",
        "shock",
        "HP",
        "TP",
        "UV",
        "TV",
        "SP",
        "SV",
        "ROCKET",
        "DETON",
        "SHOCK",
      ),

    ProblemMode: () => choice("equilibrium", "eq", "frozen", "fz", "iac", "fac", "EQUILIBRIUM", "FROZEN"),

    ProblemAssignment: ($) =>
      choice(
        seq(field("key", $["ProblemKey"]!), "=", field("value", $["NumberList"]!)),
        seq(choice("case", "CASE"), "=", field("name", choice($["Identifier"]!, $["StringLiteral"]!))),
      ),

    ProblemKey: () =>
      choice(
        "p,bar",
        "p,atm",
        "p,psia",
        "p,mmhg",
        "p,pa",
        "p",
        "t,k",
        "t,c",
        "t,r",
        "t,f",
        "t",
        "o/f",
        "phi",
        "r,eq",
        "pi/pe",
        "pip",
        "supar",
        "subar",
        "mach",
        "u1",
        "tcest,k",
        "nfz",
      ),

    ReactantsSection: ($) => seq(choice("reactants", "reac", "REACTANTS", "REAC"), repeat($["ReactantEntry"]!)),

    ReactantEntry: ($) =>
      seq(
        field("role", choice("fuel", "oxid", "name", "FUEL", "OXID", "NAME")),
        "=",
        field("species", $["SpeciesToken"]!),
        repeat($["ReactantAttribute"]!),
      ),

    ReactantAttribute: ($) =>
      choice(
        seq(
          field("attr", choice("wt%", "wt", "moles", "m", "t(k)", "t,k", "t", "h,kj/mol", "h,cal/mol", "rho")),
          "=",
          field("value", $["NumberLiteral"]!),
        ),
        seq(field("element", $["ElementSymbol"]!), field("count", $["NumberLiteral"]!)),
      ),

    OnlySection: ($) => seq(choice("only", "ONLY"), repeat(choice($["SpeciesToken"]!, ","))),

    OmitSection: ($) => seq(choice("omit", "OMIT"), repeat(choice($["SpeciesToken"]!, ","))),

    InsertSection: ($) => seq(choice("insert", "INSERT"), repeat(choice($["SpeciesToken"]!, ","))),

    OutputSection: ($) => seq(choice("output", "outp", "OUTPUT", "OUTP"), repeat($["OutputOption"]!)),

    OutputOption: ($) =>
      choice(
        "siunits",
        "calories",
        "short",
        "massf",
        "molef",
        "transport",
        "plot",
        seq("trace", "=", field("threshold", $["NumberLiteral"]!)),
      ),

    EndStatement: () => choice("end", "END"),

    NumberList: ($) => seq($["NumberLiteral"]!, repeat(seq(optional(","), $["NumberLiteral"]!))),
    SpeciesToken: () => /[A-Za-z][A-Za-z0-9-]*(?:\([A-Za-z]\))?/,
    ElementSymbol: () => /[A-Z][a-z]?/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:#[^\r\n]*|![^\r\n]*)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInCeaLibrarySync();
