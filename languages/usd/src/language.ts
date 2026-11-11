// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, seq } from "@modelscript/dsl";
import { lowerUsdToDae } from "./dae/usd-to-dae.js";
import { indexUsdFile } from "./indexing.js";
import { lintUsdStage } from "./lints/index.js";
import { parseUsd } from "./parser/index.js";

/**
 * DSL language specification for OpenUSD (.usd, .usda, .usdc, .usdz) scene description.
 */
export const usdLanguage = language({
  name: "usd",
  fileExtensions: [".usd", ".usda", ".usdc", ".usdz"],
  maturity: "beta",
  indexing: {
    indexFile: indexUsdFile,
  },
  lsp: {
    fileExtensions: [".usd", ".usda", ".usdc", ".usdz"],
  },

  actions: [
    {
      id: "usd_lint",
      title: "Lint OpenUSD Stage",
      description: "Validates OpenUSD UsdPhysics rigid bodies, joints, mass tensors, and scene hierarchy.",
      category: "verify",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const stage = parseUsd(text);
        return lintUsdStage(stage);
      },
    },
    {
      id: "usd_to_dae",
      title: "Lower UsdPhysics Stage to DAE",
      description:
        "Lowers OpenUSD UsdPhysics rigid bodies and joints into ModelScript's linear-memory DAEBuilder arena.",
      category: "transform",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const stage = parseUsd(text);
        const dae = lowerUsdToDae(stage);
        return {
          modelName: stage.metadata.defaultPrim || "UsdPhysicsStage",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
  ],

  rules: {
    Stage: ($) => seq(choice($.Header, ""), repeat(choice($.PrimDef, $.Comment, $.MetadataAssignment))),

    Header: () => /#usda\s+[0-9]+\.[0-9]+/,

    MetadataAssignment: ($) => seq($.Identifier, "=", choice($.StringLiteral, $.NumberLiteral, $.Identifier)),

    PrimDef: ($) =>
      seq(
        choice("def", "over", "class"),
        $.Identifier,
        $.StringLiteral,
        choice(seq("(", repeat(choice($.MetadataItem, $.Comment)), ")"), ""),
        "{",
        repeat(choice($.PrimDef, $.AttributeDef, $.RelationshipDef, $.Comment)),
        "}",
      ),

    AttributeDef: ($) =>
      seq(
        choice("uniform", ""),
        $.TypeIdentifier,
        $.Identifier,
        choice(seq("=", $.Value), seq(".timeSamples", "=", "{", repeat($.TimeSample), "}")),
      ),

    RelationshipDef: ($) =>
      seq("rel", $.Identifier, "=", choice($.PathReference, seq("[", repeat($.PathReference), "]"))),

    MetadataItem: ($) => seq(choice("prepend", "append", ""), $.Identifier, "=", $.Value),

    TimeSample: ($) => seq($.NumberLiteral, ":", $.Value, choice(",", "")),

    Value: ($) =>
      choice(
        $.StringLiteral,
        $.NumberLiteral,
        $.BooleanLiteral,
        $.PathReference,
        $.TupleValue,
        $.ArrayValue,
        $.Identifier,
      ),

    TupleValue: ($) => seq("(", repeat(choice($.NumberLiteral, $.StringLiteral, $.Identifier, ",")), ")"),
    ArrayValue: ($) => seq("[", repeat(choice($.Value, ",")), "]"),

    PathReference: () => /<[^>]+>/,
    TypeIdentifier: () => /[A-Za-z_][A-Za-z0-9_:[\]]*/,
    Identifier: () => /[A-Za-z_:][A-Za-z0-9_:-]*/,
    StringLiteral: () => /"[^"]*"|'[^']*'/,
    NumberLiteral: () => /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/,
    BooleanLiteral: () => choice("true", "false"),
    Comment: () => /#[^\n]*/,
  },
});

export default usdLanguage;
