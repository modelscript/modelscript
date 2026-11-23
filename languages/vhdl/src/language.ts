// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
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
  },
  errorCodes: VhdlErrorCode,

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

    LibraryClause: ($) => seq("library", field("name", $["Identifier"]!), repeat(seq(",", $["Identifier"]!)), ";"),

    UseClause: ($) => seq("use", field("item", $["SelectedName"]!), repeat(seq(",", $["SelectedName"]!)), ";"),

    SelectedName: ($) => seq($["Identifier"]!, repeat(seq(".", choice($["Identifier"]!, "all")))),

    EntityDeclaration: ($) =>
      seq(
        "entity",
        field("name", $["Identifier"]!),
        "is",
        optional($["GenericClause"]!),
        optional($["PortClause"]!),
        "end",
        optional("entity"),
        optional(field("endName", $["Identifier"]!)),
        ";",
      ),

    GenericClause: ($) => seq("generic", "(", $["GenericDecl"]!, repeat(seq(";", $["GenericDecl"]!)), ")", ";"),

    GenericDecl: ($) =>
      seq(
        optional("constant"),
        field("name", $["Identifier"]!),
        repeat(seq(",", $["Identifier"]!)),
        ":",
        field("type", $["TypeIndication"]!),
        optional(seq(":=", field("default", $["Expression"]!))),
      ),

    PortClause: ($) => seq("port", "(", $["PortDecl"]!, repeat(seq(";", $["PortDecl"]!)), ")", ";"),

    PortDecl: ($) =>
      seq(
        optional("signal"),
        field("name", $["Identifier"]!),
        repeat(seq(",", $["Identifier"]!)),
        ":",
        optional(field("mode", choice("in", "out", "inout", "buffer", "linkage"))),
        field("type", $["TypeIndication"]!),
        optional(seq(":=", field("default", $["Expression"]!))),
      ),

    TypeIndication: ($) =>
      seq(
        field("base", $["Identifier"]!),
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
        field("name", $["Identifier"]!),
        "of",
        field("entity", $["Identifier"]!),
        "is",
        repeat($["ArchDeclItem"]!),
        "begin",
        repeat($["ConcurrentStmt"]!),
        "end",
        optional("architecture"),
        optional(field("endName", $["Identifier"]!)),
        ";",
      ),

    PackageDeclaration: ($) =>
      seq(
        "package",
        field("name", $["Identifier"]!),
        "is",
        repeat($["ArchDeclItem"]!),
        "end",
        optional("package"),
        optional(field("endName", $["Identifier"]!)),
        ";",
      ),

    PackageBody: ($) =>
      seq(
        "package",
        "body",
        field("name", $["Identifier"]!),
        "is",
        repeat($["ArchDeclItem"]!),
        "end",
        optional(seq("package", "body")),
        optional(field("endName", $["Identifier"]!)),
        ";",
      ),

    ArchDeclItem: ($) =>
      choice($["SignalDecl"]!, $["ConstantDecl"]!, $["TypeDecl"]!, $["ComponentDecl"]!, $["Comment"]!),

    SignalDecl: ($) =>
      seq(
        "signal",
        field("name", $["Identifier"]!),
        repeat(seq(",", $["Identifier"]!)),
        ":",
        field("type", $["TypeIndication"]!),
        optional(seq(":=", field("init", $["Expression"]!))),
        ";",
      ),

    VariableDecl: ($) =>
      seq(
        "variable",
        field("name", $["Identifier"]!),
        repeat(seq(",", $["Identifier"]!)),
        ":",
        field("type", $["TypeIndication"]!),
        optional(seq(":=", field("init", $["Expression"]!))),
        ";",
      ),

    ConstantDecl: ($) =>
      seq(
        "constant",
        field("name", $["Identifier"]!),
        repeat(seq(",", $["Identifier"]!)),
        ":",
        field("type", $["TypeIndication"]!),
        ":=",
        field("value", $["Expression"]!),
        ";",
      ),

    TypeDecl: ($) =>
      seq(
        choice("type", "subtype"),
        field("name", $["Identifier"]!),
        "is",
        choice(seq("(", $["Identifier"]!, repeat(seq(",", $["Identifier"]!)), ")"), $["TypeIndication"]!),
        ";",
      ),

    ComponentDecl: ($) =>
      seq(
        "component",
        field("name", $["Identifier"]!),
        optional("is"),
        optional($["GenericClause"]!),
        optional($["PortClause"]!),
        "end",
        "component",
        optional($["Identifier"]!),
        ";",
      ),

    ConcurrentStmt: ($) =>
      choice($["ProcessStmt"]!, $["SelectedSignalAssign"]!, $["ComponentInst"]!, $["CondSignalAssign"]!, $["Comment"]!),

    ProcessStmt: ($) =>
      seq(
        optional(seq(field("label", $["Identifier"]!), ":")),
        "process",
        optional(seq("(", $["Identifier"]!, repeat(seq(",", $["Identifier"]!)), ")")),
        optional("is"),
        repeat(choice($["VariableDecl"]!, $["ConstantDecl"]!, $["Comment"]!)),
        "begin",
        repeat($["SeqStmt"]!),
        "end",
        "process",
        optional($["Identifier"]!),
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
        field("label", $["Identifier"]!),
        ":",
        optional("component"),
        field("component", $["Identifier"]!),
        optional($["GenericMapAspect"]!),
        optional($["PortMapAspect"]!),
        ";",
      ),

    GenericMapAspect: ($) => seq("generic", "map", "(", $["AssocElement"]!, repeat(seq(",", $["AssocElement"]!)), ")"),

    PortMapAspect: ($) => seq("port", "map", "(", $["AssocElement"]!, repeat(seq(",", $["AssocElement"]!)), ")"),

    AssocElement: ($) =>
      choice(
        seq(field("formal", $["Identifier"]!), "=>", field("actual", $["Expression"]!)),
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
        field("iterator", $["Identifier"]!),
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
      seq(
        optional(choice("not", "-", "+")),
        $["PrimaryExpr"]!,
        repeat(seq(choice("+", "-", "&", "*", "/"), $["PrimaryExpr"]!)),
      ),

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
    NumberLiteral: () => /\d+(?:\.\d+)?/,
    CharLiteral: () => /'[^']'/,
    BitStringLiteral: () => /[BbOoXx]?"[^"]*"/,
    Comment: () => /--[^\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInVhdlLibrarySync();
