// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Formal DSL Grammar Specification.
 *
 * Declarative EnergyPlus IDF building model grammar defined via @modelscript/dsl,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, repeat, semanticToken, seq } from "@modelscript/dsl";

export const energyPlusGrammar = language({
  name: "EnergyPlusIdf",
  word: ($) => $.Identifier,
  extras: ($) => [/\s+/, $.CommentLine],
  lsp: {
    folding: ["IdfObject"],
    outline: ["BuildingObject", "ZoneObject", "MaterialObject", "ConstructionObject", "SurfaceObject", "IdfObject"],
  },
  rules: {
    Document: ($) => repeat(choice($.Statement, $.CommentLine)),

    Statement: ($) =>
      choice($.BuildingObject, $.ZoneObject, $.MaterialObject, $.ConstructionObject, $.SurfaceObject, $.IdfObject),

    BuildingObject: ($) =>
      seq(
        semanticToken("keyword", choice("Building", "BUILDING", "building")),
        ",",
        field("name", $.FieldValue),
        repeat(seq(",", field("field", $.FieldValue))),
        ";",
      ),

    ZoneObject: ($) =>
      seq(
        semanticToken("keyword", choice("Zone", "ZONE", "zone")),
        ",",
        field("name", $.FieldValue),
        repeat(seq(",", field("field", $.FieldValue))),
        ";",
      ),

    MaterialObject: ($) =>
      seq(
        semanticToken("keyword", choice("Material", "MATERIAL", "material", "Material:NoMass", "MATERIAL:NOMASS")),
        ",",
        field("name", $.FieldValue),
        repeat(seq(",", field("field", $.FieldValue))),
        ";",
      ),

    ConstructionObject: ($) =>
      seq(
        semanticToken("keyword", choice("Construction", "CONSTRUCTION", "construction")),
        ",",
        field("name", $.FieldValue),
        repeat(seq(",", field("field", $.FieldValue))),
        ";",
      ),

    SurfaceObject: ($) =>
      seq(
        semanticToken(
          "keyword",
          choice(
            "BuildingSurface:Detailed",
            "BUILDINGSURFACE:DETAILED",
            "FenestrationSurface:Detailed",
            "FENESTRATIONSURFACE:DETAILED",
            "InternalMass",
            "INTERNALMASS",
          ),
        ),
        ",",
        field("name", $.FieldValue),
        repeat(seq(",", field("field", $.FieldValue))),
        ";",
      ),

    IdfObject: ($) => seq(field("objectType", $.ObjectIdentifier), repeat(seq(",", field("field", $.FieldValue))), ";"),

    FieldValue: ($) => choice($.NumberLiteral, $.StringLiteral, $.Identifier),

    ObjectIdentifier: () => /[a-zA-Z_][a-zA-Z0-9_:.-]*/,
    CommentLine: () => /([!].*)/,
    Identifier: () => /[a-zA-Z_][a-zA-Z0-9_.-]*/,
    NumberLiteral: () => /[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
  },
});
