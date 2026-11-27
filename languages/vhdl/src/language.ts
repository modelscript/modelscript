// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";
import { registerBuiltInVhdlLibrarySync } from "./catalog/library-package-adapter.js";
import { VhdlErrorCode } from "./errors.js";
import { vhdlIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for VHDL (IEEE 1076-1987 / 1993).
 *
 * Compiles to a native WebAssembly GLR parser (`dist/parser.wasm`) via
 * `node ../../scripts/build/build-language-parser.js`.
 */
export const vhdlLanguage = language({
  name: "vhdl",
  fileExtensions: [".vhd", ".vhdl"],
  maturity: "beta",
  indexing: vhdlIndexing,
  lsp: {
    fileExtensions: [".vhd", ".vhdl"],
    folding: [
      "EntityDeclaration",
      "ArchitectureBody",
      "PackageDeclaration",
      "PackageBody",
      "ComponentDecl",
      "ProcessStmt",
      "IfStmt",
      "CaseStmt",
      "ForLoopStmt",
      { rule: "Comment", kind: "comment", defaultCollapsed: true },
    ],
    outline: [
      "EntityDeclaration",
      "ArchitectureBody",
      "PackageDeclaration",
      "PackageBody",
      "ComponentDecl",
      "SignalDecl",
      "ConstantDecl",
      "TypeDecl",
      "ProcessStmt",
      "ComponentInst",
    ],
  },
  errorCodes: VhdlErrorCode,

  conflicts: ($) => [[$["_UnarySign"]!, $["Identifier"]!]],

  rules: {
    DesignFile: ($) =>
      repeat(
        choice(
          $["LibraryClause"]!,
          $["UseClause"]!,
          $["EntityDeclaration"]!,
          $["ArchitectureBody"]!,
          $["PackageDeclaration"]!,
          $["PackageBody"]!,
          $["Comment"]!,
        ),
      ),

    LibraryClause: ($) =>
      seq(
        "library",
        semanticToken("namespace", field("name", $["Identifier"]!)),
        repeat(seq(",", semanticToken("namespace", $["Identifier"]!))),
        ";",
      ),

    UseClause: ($) => seq("use", field("item", $["SelectedName"]!), repeat(seq(",", $["SelectedName"]!)), ";"),

    SelectedName: ($) => seq($["Identifier"]!, repeat(seq(".", choice($["Identifier"]!, "all")))),

    EntityDeclaration: ($) =>
      seq(
        "entity",
        semanticToken("class", field("name", $["Identifier"]!), ["declaration"]),
        "is",
        optional($["GenericClause"]!),
        optional($["PortClause"]!),
        "end",
        optional("entity"),
        optional(semanticToken("class", field("endName", $["Identifier"]!))),
        ";",
      ),

    GenericClause: ($) => seq("generic", "(", $["GenericDecl"]!, repeat(seq(";", $["GenericDecl"]!)), ")", ";"),

    GenericDecl: ($) =>
      seq(
        optional("constant"),
        semanticToken("parameter", field("name", $["Identifier"]!), ["declaration", "readonly"]),
        repeat(seq(",", semanticToken("parameter", $["Identifier"]!, ["declaration", "readonly"]))),
        ":",
        field("type", $["TypeIndication"]!),
        optional(seq(":=", field("default", $["Expression"]!))),
      ),

    PortClause: ($) => seq("port", "(", $["PortDecl"]!, repeat(seq(";", $["PortDecl"]!)), ")", ";"),

    PortDecl: ($) =>
      seq(
        optional("signal"),
        semanticToken("parameter", field("name", $["Identifier"]!), ["declaration"]),
        repeat(seq(",", semanticToken("parameter", $["Identifier"]!, ["declaration"]))),
        ":",
        optional(field("mode", choice("in", "out", "inout", "buffer", "linkage"))),
        field("type", $["TypeIndication"]!),
        optional(seq(":=", field("default", $["Expression"]!))),
      ),

    TypeIndication: ($) =>
      seq(
        semanticToken("type", field("base", $["Identifier"]!)),
        optional(choice(seq("(", $["RangeSpec"]!, ")"), seq("range", $["RangeSpec"]!))),
      ),

    RangeSpec: ($) =>
      seq(
        field("left", $["SimpleExpr"]!),
        field("direction", choice("downto", "to")),
        field("right", $["SimpleExpr"]!),
      ),

    ArchitectureBody: ($) =>
      seq(
        "architecture",
        semanticToken("class", field("name", $["Identifier"]!), ["declaration"]),
        "of",
        semanticToken("class", field("entity", $["Identifier"]!)),
        "is",
        repeat($["ArchDeclItem"]!),
        "begin",
        repeat($["ConcurrentStmt"]!),
        "end",
        optional("architecture"),
        optional(semanticToken("class", field("endName", $["Identifier"]!))),
        ";",
      ),

    PackageDeclaration: ($) =>
      seq(
        "package",
        semanticToken("namespace", field("name", $["Identifier"]!), ["declaration"]),
        "is",
        repeat($["ArchDeclItem"]!),
        "end",
        optional("package"),
        optional(semanticToken("namespace", field("endName", $["Identifier"]!))),
        ";",
      ),

    PackageBody: ($) =>
      seq(
        "package",
        "body",
        semanticToken("namespace", field("name", $["Identifier"]!), ["declaration"]),
        "is",
        repeat($["ArchDeclItem"]!),
        "end",
        optional(seq("package", "body")),
        optional(semanticToken("namespace", field("endName", $["Identifier"]!))),
        ";",
      ),

    ArchDeclItem: ($) =>
      choice($["SignalDecl"]!, $["ConstantDecl"]!, $["TypeDecl"]!, $["ComponentDecl"]!, $["Comment"]!),

    SignalDecl: ($) =>
      seq(
        "signal",
        semanticToken("parameter", field("name", $["Identifier"]!), ["declaration"]),
        repeat(seq(",", semanticToken("parameter", $["Identifier"]!, ["declaration"]))),
        ":",
        field("type", $["TypeIndication"]!),
        optional(seq(":=", field("init", $["Expression"]!))),
        ";",
      ),

    VariableDecl: ($) =>
      seq(
        "variable",
        semanticToken("variable", field("name", $["Identifier"]!), ["declaration"]),
        repeat(seq(",", semanticToken("variable", $["Identifier"]!, ["declaration"]))),
        ":",
        field("type", $["TypeIndication"]!),
        optional(seq(":=", field("init", $["Expression"]!))),
        ";",
      ),

    ConstantDecl: ($) =>
      seq(
        "constant",
        semanticToken("variable", field("name", $["Identifier"]!), ["declaration", "readonly"]),
        repeat(seq(",", semanticToken("variable", $["Identifier"]!, ["declaration", "readonly"]))),
        ":",
        field("type", $["TypeIndication"]!),
        ":=",
        field("value", $["Expression"]!),
        ";",
      ),

    TypeDecl: ($) =>
      seq(
        choice("type", "subtype"),
        semanticToken("type", field("name", $["Identifier"]!), ["declaration"]),
        "is",
        choice(
          seq(
            "(",
            semanticToken("enumMember", $["Identifier"]!, ["declaration"]),
            repeat(seq(",", semanticToken("enumMember", $["Identifier"]!, ["declaration"]))),
            ")",
          ),
          $["TypeIndication"]!,
        ),
        ";",
      ),

    ComponentDecl: ($) =>
      seq(
        "component",
        semanticToken("class", field("name", $["Identifier"]!), ["declaration"]),
        optional("is"),
        optional($["GenericClause"]!),
        optional($["PortClause"]!),
        "end",
        "component",
        optional(semanticToken("class", $["Identifier"]!)),
        ";",
      ),

    ConcurrentStmt: ($) =>
      choice($["ProcessStmt"]!, $["SelectedSignalAssign"]!, $["ComponentInst"]!, $["CondSignalAssign"]!, $["Comment"]!),

    ProcessStmt: ($) =>
      seq(
        optional(seq(semanticToken("function", field("label", $["Identifier"]!), ["declaration"]), ":")),
        "process",
        optional(seq("(", $["Identifier"]!, repeat(seq(",", $["Identifier"]!)), ")")),
        optional("is"),
        repeat(choice($["VariableDecl"]!, $["ConstantDecl"]!, $["Comment"]!)),
        "begin",
        repeat($["SeqStmt"]!),
        "end",
        "process",
        optional(semanticToken("function", $["Identifier"]!)),
        ";",
      ),

    CondSignalAssign: ($) =>
      seq(
        field("target", $["Target"]!),
        "<=",
        $["Expression"]!,
        repeat(seq("when", $["Expression"]!, "else", $["Expression"]!)),
        ";",
      ),

    SelectedSignalAssign: ($) =>
      seq(
        "with",
        field("selector", $["Expression"]!),
        "select",
        field("target", $["Target"]!),
        "<=",
        $["Expression"]!,
        "when",
        choice($["PrimaryExpr"]!, "others"),
        repeat(seq(",", $["Expression"]!, "when", choice($["PrimaryExpr"]!, "others"))),
        ";",
      ),

    ComponentInst: ($) =>
      seq(
        semanticToken("variable", field("label", $["Identifier"]!), ["declaration"]),
        ":",
        optional("component"),
        semanticToken("type", field("component", $["Identifier"]!)),
        optional($["GenericMapAspect"]!),
        optional($["PortMapAspect"]!),
        ";",
      ),

    GenericMapAspect: ($) => seq("generic", "map", "(", $["AssocElement"]!, repeat(seq(",", $["AssocElement"]!)), ")"),

    PortMapAspect: ($) => seq("port", "map", "(", $["AssocElement"]!, repeat(seq(",", $["AssocElement"]!)), ")"),

    AssocElement: ($) =>
      choice(
        seq(semanticToken("property", field("formal", $["Identifier"]!)), "=>", field("actual", $["Expression"]!)),
        field("actual", $["Expression"]!),
      ),

    SeqStmt: ($) =>
      choice(
        $["SeqSignalAssign"]!,
        $["SeqVarAssign"]!,
        $["IfStmt"]!,
        $["CaseStmt"]!,
        $["ForLoopStmt"]!,
        $["NullStmt"]!,
        $["Comment"]!,
      ),

    SeqSignalAssign: ($) => seq(field("target", $["Target"]!), "<=", field("value", $["Expression"]!), ";"),
    SeqVarAssign: ($) => seq(field("target", $["Target"]!), ":=", field("value", $["Expression"]!), ";"),

    IfStmt: ($) =>
      seq(
        "if",
        field("condition", $["Expression"]!),
        "then",
        repeat($["SeqStmt"]!),
        repeat(seq("elsif", $["Expression"]!, "then", repeat($["SeqStmt"]!))),
        optional(seq("else", repeat($["SeqStmt"]!))),
        "end",
        "if",
        ";",
      ),

    CaseStmt: ($) =>
      seq(
        "case",
        field("expr", $["Expression"]!),
        "is",
        repeat(
          seq(
            "when",
            choice($["PrimaryExpr"]!, "others"),
            repeat(seq("|", choice($["PrimaryExpr"]!, "others"))),
            "=>",
            repeat($["SeqStmt"]!),
          ),
        ),
        "end",
        "case",
        ";",
      ),

    ForLoopStmt: ($) =>
      seq(
        "for",
        semanticToken("variable", field("iterator", $["Identifier"]!), ["declaration"]),
        "in",
        $["RangeSpec"]!,
        "loop",
        repeat($["SeqStmt"]!),
        "end",
        "loop",
        ";",
      ),

    NullStmt: () => seq("null", ";"),

    Target: ($) =>
      seq(field("name", $["Identifier"]!), optional(seq("(", choice($["RangeSpec"]!, $["SimpleExpr"]!), ")"))),

    Expression: ($) =>
      seq(
        $["SimpleExpr"]!,
        repeat(
          seq(choice("and", "or", "nand", "nor", "xor", "xnor", "=", "/=", "<", "<=", ">", ">="), $["SimpleExpr"]!),
        ),
      ),

    SimpleExpr: ($) =>
      seq($["_UnarySign"]!, $["PrimaryExpr"]!, repeat(seq(choice("+", "-", "&", "*", "/"), $["PrimaryExpr"]!))),

    _UnarySign: () => optional(choice("not", "-", "+")),

    PrimaryExpr: ($) =>
      choice(
        $["BitStringLiteral"]!,
        $["CharLiteral"]!,
        $["NumberLiteral"]!,
        seq("(", "others", "=>", $["PrimaryExpr"]!, ")"),
        seq("(", $["Expression"]!, ")"),
        seq($["Identifier"]!, "'", $["Identifier"]!),
        seq($["Identifier"]!, "(", $["Expression"]!, repeat(seq(",", $["Expression"]!)), ")"),
        $["Identifier"]!,
      ),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => semanticToken("number", /\d+(?:\.\d+)?/),
    CharLiteral: () => semanticToken("string", /'[^']'/),
    BitStringLiteral: () => semanticToken("string", /[BbOoXx]?"[^"]*"/),
    Comment: () => semanticToken("comment", /--[^\n]*/),
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInVhdlLibrarySync();
