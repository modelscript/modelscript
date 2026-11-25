// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInAsn1LibrarySync } from "./catalog/library-package-adapter.js";
import { Asn1ErrorCode } from "./errors.js";
import { asn1Indexing } from "./indexing.js";

/**
 * DSL language specification for ISO/ITU-T X.208 / X.680 ASN.1 (.asn, .asn1, .mib).
 */
export const asn1Language = language({
  name: "asn1",
  fileExtensions: [".asn", ".asn1", ".mib"],
  maturity: "beta",
  indexing: asn1Indexing,
  lsp: {
    fileExtensions: [".asn", ".asn1", ".mib"],
  },
  ui: {
    panels: [
      {
        id: "asn1Editor",
        viewType: "modelscript.asn1Editor",
        title: "ASN.1 Schema & BER/DER TLV Inspector",
        shortTitle: "ASN.1",
        selector: ["*.asn", "*.asn1", "*.mib"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/Asn1Panel.tsx",
        artifactViewTypes: ["asn1", "asn"],
      },
    ],
  },

  errorCodes: Asn1ErrorCode,

  rules: {
    ModuleDefinition: ($) =>
      seq(
        repeat($["Comment"]!),
        field("name", $["Identifier"]!),
        optional($["OidValue"]!),
        "DEFINITIONS",
        optional($["TagDefault"]!),
        optional(seq("EXTENSIBILITY", "IMPLIED")),
        "::=",
        "BEGIN",
        optional($["ExportsClause"]!),
        optional($["ImportsClause"]!),
        repeat(choice($["TypeAssignment"]!, $["ValueAssignment"]!, $["Comment"]!)),
        "END",
        repeat($["Comment"]!),
      ),

    TagDefault: () => choice(seq("AUTOMATIC", "TAGS"), seq("EXPLICIT", "TAGS"), seq("IMPLICIT", "TAGS")),

    ExportsClause: ($) => seq("EXPORTS", choice("ALL", seq($["Identifier"]!, repeat(seq(",", $["Identifier"]!)))), ";"),

    ImportsClause: ($) => seq("IMPORTS", repeat($["SymbolsFromModule"]!), ";"),

    SymbolsFromModule: ($) =>
      seq(
        $["Identifier"]!,
        repeat(seq(",", $["Identifier"]!)),
        "FROM",
        field("fromModule", $["Identifier"]!),
        optional($["OidValue"]!),
      ),

    TypeAssignment: ($) => seq(field("name", $["Identifier"]!), "::=", field("type", $["TypeExpr"]!)),

    ValueAssignment: ($) =>
      seq(
        field("name", $["Identifier"]!),
        field("type", $["TypeExpr"]!),
        "::=",
        field("value", choice($["OidValue"]!, $["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!)),
      ),

    TypeExpr: ($) =>
      choice(
        $["TaggedType"]!,
        $["SequenceOfType"]!,
        $["SetOfType"]!,
        $["SequenceType"]!,
        $["SetType"]!,
        $["ChoiceType"]!,
        $["EnumeratedType"]!,
        $["PrimitiveType"]!,
        $["TypeReference"]!,
      ),

    TaggedType: ($) => seq($["Tag"]!, optional(choice("EXPLICIT", "IMPLICIT")), $["TypeExpr"]!),

    Tag: ($) =>
      seq("[", optional(choice("UNIVERSAL", "APPLICATION", "PRIVATE")), field("tagNumber", $["NumberLiteral"]!), "]"),

    SequenceType: ($) => seq("SEQUENCE", "{", optional($["ComponentList"]!), "}"),

    SetType: ($) => seq("SET", "{", optional($["ComponentList"]!), "}"),

    ChoiceType: ($) => seq("CHOICE", "{", optional($["ComponentList"]!), "}"),

    SequenceOfType: ($) => seq("SEQUENCE", optional($["Constraint"]!), "OF", $["TypeExpr"]!),

    SetOfType: ($) => seq("SET", optional($["Constraint"]!), "OF", $["TypeExpr"]!),

    ComponentList: ($) => seq($["ComponentItem"]!, repeat(seq(",", $["ComponentItem"]!))),

    ComponentItem: ($) =>
      choice(
        "...",
        seq(
          field("name", $["Identifier"]!),
          field("type", $["TypeExpr"]!),
          optional(
            choice(
              "OPTIONAL",
              seq("DEFAULT", choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!, $["OidValue"]!)),
            ),
          ),
        ),
      ),

    EnumeratedType: ($) => seq("ENUMERATED", "{", optional($["NamedNumberList"]!), "}"),

    NamedNumberList: ($) => seq($["NamedNumberItem"]!, repeat(seq(",", $["NamedNumberItem"]!))),

    NamedNumberItem: ($) =>
      choice("...", seq(field("name", $["Identifier"]!), optional(seq("(", $["NumberLiteral"]!, ")")))),

    PrimitiveType: ($) =>
      seq(
        choice(
          "BOOLEAN",
          "REAL",
          "NULL",
          seq("OCTET", "STRING"),
          seq("OBJECT", "IDENTIFIER"),
          "UTF8String",
          "IA5String",
          "PrintableString",
          "VisibleString",
          "NumericString",
          "UTCTime",
          "GeneralizedTime",
          seq("INTEGER", optional(seq("{", optional($["NamedNumberList"]!), "}"))),
          seq("BIT", "STRING", optional(seq("{", optional($["NamedNumberList"]!), "}"))),
        ),
        optional($["Constraint"]!),
      ),

    TypeReference: ($) => seq(field("ref", $["Identifier"]!), optional($["Constraint"]!)),

    Constraint: ($) => seq("(", choice(seq("SIZE", "(", $["BoundExpr"]!, ")"), $["BoundExpr"]!), ")"),

    BoundExpr: ($) => seq(choice("MIN", $["NumberLiteral"]!), optional(seq("..", choice("MAX", $["NumberLiteral"]!)))),

    OidValue: ($) =>
      seq(
        "{",
        repeat(choice(seq($["Identifier"]!, "(", $["NumberLiteral"]!, ")"), $["NumberLiteral"]!, $["Identifier"]!)),
        "}",
      ),

    Identifier: () => /[A-Za-z][A-Za-z0-9_-]*/,
    NumberLiteral: () => /-?\d+(?:\.\d+)?/,
    StringLiteral: () => /"[^"]*"|'[^']*'[BH]?/,
    Comment: () => /(?:--[^\n]*|\/\*([^*]|\*+[^*/])*\*+\/)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInAsn1LibrarySync();
