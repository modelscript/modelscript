// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInGaussianLibrarySync } from "./catalog/library-package-adapter.js";
import { GaussianErrorCode } from "./errors.js";
import { gaussianIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for Gaussian Input (`.gjf`, `.com`).
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm` + `src-gen/bindings.{js,d.ts}`)
 * supporting Link0 commands, Route sections, Title sections, Charge/Multiplicity,
 * Cartesian & Z-matrix coordinates (including dummy atoms `X`), Variables/Constants blocks,
 * `--Link1--` multi-step jobs, and `!` comments.
 */
export const gaussianLanguage = language({
  name: "gaussian",
  fileExtensions: [".gjf", ".com"],
  maturity: "beta",
  indexing: gaussianIndexing,
  lsp: {
    fileExtensions: [".gjf", ".com"],
  },
  errorCodes: GaussianErrorCode,

  extras: ($) => [/\s/, $["Comment"]!],

  rules: {
    Document: ($) => seq($["JobStep"]!, repeat(seq($["Link1Separator"]!, $["JobStep"]!))),

    JobStep: ($) =>
      seq(
        repeat($["Link0Command"]!),
        optional($["RouteSection"]!),
        optional($["ChargeMultiplicity"]!),
        repeat($["AtomSpec"]!),
        repeat(
          choice(
            seq($["VariablesHeader"]!, repeat($["VariableAssignment"]!)),
            seq($["ConstantsHeader"]!, repeat($["VariableAssignment"]!)),
          ),
        ),
      ),

    Link1Separator: () => /--[Ll][Ii][Nn][Kk]1--/,

    Link0Command: ($) =>
      seq(field("directive", $["Link0Directive"]!), optional(seq("=", field("value", $["Link0Value"]!)))),

    Link0Directive: () => /%[A-Za-z][A-Za-z0-9_]*/,
    Link0Value: () => /[^\s!=]+/,

    RouteSection: ($) => seq(field("prefix", $["RoutePrefix"]!), repeat(choice($["MethodBasis"]!, $["RouteKeyword"]!))),

    RoutePrefix: () => /#[pPnNtT]?/,

    MethodBasis: ($) => seq(field("method", $["Identifier"]!), "/", field("basis", $["BasisToken"]!)),

    RouteKeyword: ($) =>
      seq(
        field("name", $["Identifier"]!),
        optional(seq("=", field("options", choice($["OptionGroup"]!, $["Identifier"]!)))),
        optional(field("parenOptions", $["OptionGroup"]!)),
      ),

    OptionGroup: ($) => seq("(", $["OptionItem"]!, repeat(seq(",", $["OptionItem"]!)), ")"),

    OptionItem: ($) => seq($["Identifier"]!, optional(seq("=", choice($["Identifier"]!, $["NumberLiteral"]!)))),

    ChargeMultiplicity: ($) => seq(field("charge", $["IntegerLiteral"]!), field("multiplicity", $["IntegerLiteral"]!)),

    AtomSpec: ($) =>
      choice(
        // Cartesian: Element X Y Z
        seq(
          field("element", $["ElementSymbol"]!),
          field("x", $["CoordValue"]!),
          field("y", $["CoordValue"]!),
          field("z", $["CoordValue"]!),
        ),
        // Z-Matrix atom >= 4: Element rRef rVal aRef aVal dRef dVal
        seq(
          field("element", $["ElementSymbol"]!),
          field("bondRef", $["IntegerLiteral"]!),
          field("bondLength", $["CoordValue"]!),
          field("angleRef", $["IntegerLiteral"]!),
          field("bondAngle", $["CoordValue"]!),
          field("dihedralRef", $["IntegerLiteral"]!),
          field("dihedralAngle", $["CoordValue"]!),
        ),
        // Z-Matrix atom 3: Element rRef rVal aRef aVal
        seq(
          field("element", $["ElementSymbol"]!),
          field("bondRef", $["IntegerLiteral"]!),
          field("bondLength", $["CoordValue"]!),
          field("angleRef", $["IntegerLiteral"]!),
          field("bondAngle", $["CoordValue"]!),
        ),
        // Z-Matrix atom 2: Element rRef rVal
        seq(
          field("element", $["ElementSymbol"]!),
          field("bondRef", $["IntegerLiteral"]!),
          field("bondLength", $["CoordValue"]!),
        ),
        // Z-Matrix atom 1: Element
        field("element", $["ElementSymbol"]!),
      ),

    CoordValue: ($) => choice($["NumberLiteral"]!, $["Identifier"]!),

    VariablesHeader: () => /[Vv][Aa][Rr][Ii][Aa][Bb][Ll][Ee][Ss]\s*:/,
    ConstantsHeader: () => /[Cc][Oo][Nn][Ss][Tt][Aa][Nn][Tt][Ss]\s*:/,

    VariableAssignment: ($) => seq(field("name", $["Identifier"]!), optional("="), field("value", $["NumberLiteral"]!)),

    ElementSymbol: () => /[A-Z][a-z]?/,
    BasisToken: () => /[A-Za-z0-9][A-Za-z0-9\-+*,()]*/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_\-+]*/,
    IntegerLiteral: () => /[+-]?\d+/,
    NumberLiteral: () => /[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eEdD][+-]?\d+)?/,
    Comment: () => /![^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInGaussianLibrarySync();
