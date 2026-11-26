// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInVerilogLibrarySync } from "./catalog/library-package-adapter.js";
import { VerilogErrorCode } from "./errors.js";
import { verilogIndexing } from "./indexing.js";

/**
 * Declarative `@modelscript/dsl` language specification for IEEE 1364 Verilog (.v, .vh, .vl).
 *
 * Compiled via `buildParser` to a native WebAssembly GLR parser (`dist/parser.wasm`).
 */
export const verilogLanguage = language({
  name: "verilog",
  fileExtensions: [".v", ".vh", ".vl"],
  maturity: "beta",
  indexing: verilogIndexing,
  lsp: {
    fileExtensions: [".v", ".vh", ".vl"],
  },
  errorCodes: VerilogErrorCode,

  conflicts: ($) => [[$["_OptionalElse"]!], [$["_OptionalTernary"]!, $["BinaryOp"]!]],

  rules: {
    SourceFile: ($) => repeat(choice($["ModuleDeclaration"]!, $["Comment"]!)),

    ModuleDeclaration: ($) =>
      seq(
        choice("module", "macromodule"),
        field("name", $["Identifier"]!),
        optional($["ParamPortList"]!),
        optional($["PortList"]!),
        ";",
        repeat($["ModuleItem"]!),
        "endmodule",
      ),

    ParamPortList: ($) => seq("#", "(", optional(seq($["ParamPortItem"]!, repeat(seq(",", $["ParamPortItem"]!)))), ")"),

    ParamPortItem: ($) =>
      seq(
        optional(choice("parameter", "localparam")),
        optional($["Range"]!),
        field("name", $["Identifier"]!),
        "=",
        field("value", $["Expression"]!),
      ),

    PortList: ($) => seq("(", optional(seq($["PortItem"]!, repeat(seq(",", $["PortItem"]!)))), ")"),

    PortItem: ($) =>
      choice(
        seq(
          field("direction", choice("input", "output", "inout")),
          optional(choice("wire", "reg", "tri", "integer")),
          optional("signed"),
          optional($["Range"]!),
          field("name", $["Identifier"]!),
        ),
        field("name", $["Identifier"]!),
      ),

    Range: ($) => seq("[", field("msb", $["Expression"]!), ":", field("lsb", $["Expression"]!), "]"),

    ModuleItem: ($) =>
      choice(
        $["PortDeclaration"]!,
        $["NetDeclaration"]!,
        $["ParamDeclaration"]!,
        $["ContinuousAssign"]!,
        $["AlwaysBlock"]!,
        $["InitialBlock"]!,
        $["GateInstantiation"]!,
        $["ModuleInstantiation"]!,
        $["Comment"]!,
      ),

    PortDeclaration: ($) =>
      seq(
        field("direction", choice("input", "output", "inout")),
        optional(choice("wire", "reg", "tri", "integer")),
        optional("signed"),
        optional($["Range"]!),
        $["Identifier"]!,
        repeat(seq(",", $["Identifier"]!)),
        ";",
      ),

    NetDeclaration: ($) =>
      seq(
        field("kind", choice("wire", "reg", "tri", "integer")),
        optional("signed"),
        optional($["Range"]!),
        $["NetDeclItem"]!,
        repeat(seq(",", $["NetDeclItem"]!)),
        ";",
      ),

    NetDeclItem: ($) =>
      seq(field("name", $["Identifier"]!), optional($["Range"]!), optional(seq("=", $["Expression"]!))),

    ParamDeclaration: ($) =>
      seq(
        choice("parameter", "localparam"),
        optional($["Range"]!),
        $["ParamAssign"]!,
        repeat(seq(",", $["ParamAssign"]!)),
        ";",
      ),

    ParamAssign: ($) => seq(field("name", $["Identifier"]!), "=", field("value", $["Expression"]!)),

    ContinuousAssign: ($) => seq("assign", field("lhs", $["Expression"]!), "=", field("rhs", $["Expression"]!), ";"),

    AlwaysBlock: ($) => seq("always", optional($["SensitivitySpec"]!), field("body", $["Statement"]!)),

    InitialBlock: ($) => seq("initial", field("body", $["Statement"]!)),

    SensitivitySpec: ($) =>
      seq(
        "@",
        choice(
          "*",
          seq("(", choice("*", seq($["SensitivityItem"]!, repeat(seq(choice("or", ","), $["SensitivityItem"]!)))), ")"),
        ),
      ),

    SensitivityItem: ($) =>
      choice(
        seq("posedge", field("signal", $["Identifier"]!)),
        seq("negedge", field("signal", $["Identifier"]!)),
        field("signal", $["Identifier"]!),
      ),

    Statement: ($) =>
      choice(
        $["BlockStatement"]!,
        $["IfStatement"]!,
        $["CaseStatement"]!,
        $["BlockingAssign"]!,
        $["NonBlockingAssign"]!,
        ";",
      ),

    BlockStatement: ($) => seq("begin", optional(seq(":", $["Identifier"]!)), repeat($["Statement"]!), "end"),

    IfStatement: ($) =>
      seq(
        "if",
        "(",
        field("condition", $["Expression"]!),
        ")",
        field("consequent", $["Statement"]!),
        $["_OptionalElse"]!,
      ),

    _OptionalElse: ($) => optional(seq("else", field("alternate", $["Statement"]!))),

    CaseStatement: ($) =>
      seq(
        choice("case", "casex", "casez"),
        "(",
        field("expression", $["Expression"]!),
        ")",
        repeat($["CaseItem"]!),
        "endcase",
      ),

    CaseItem: ($) =>
      choice(
        seq("default", optional(":"), $["Statement"]!),
        seq($["Expression"]!, repeat(seq(",", $["Expression"]!)), ":", $["Statement"]!),
      ),

    BlockingAssign: ($) => seq(field("lhs", $["Expression"]!), "=", field("rhs", $["Expression"]!), ";"),

    NonBlockingAssign: ($) => seq(field("lhs", $["Expression"]!), "<=", field("rhs", $["Expression"]!), ";"),

    GateInstantiation: ($) =>
      seq(
        field(
          "gateType",
          choice("and", "nand", "or", "nor", "xor", "xnor", "buf", "not", "bufif0", "bufif1", "notif0", "notif1"),
        ),
        optional(field("instanceName", $["Identifier"]!)),
        "(",
        $["Expression"]!,
        repeat(seq(",", $["Expression"]!)),
        ")",
        ";",
      ),

    ModuleInstantiation: ($) =>
      seq(
        field("moduleType", $["Identifier"]!),
        field("instanceName", $["Identifier"]!),
        "(",
        optional(seq($["PortConnection"]!, repeat(seq(",", $["PortConnection"]!)))),
        ")",
        ";",
      ),

    PortConnection: ($) =>
      choice(
        seq(".", field("port", $["Identifier"]!), "(", field("expr", $["Expression"]!), ")"),
        field("expr", $["Expression"]!),
      ),

    Expression: ($) => seq($["UnaryExpr"]!, repeat(seq($["BinaryOp"]!, $["UnaryExpr"]!)), $["_OptionalTernary"]!),

    _OptionalTernary: ($) => optional(seq("?", $["Expression"]!, ":", $["Expression"]!)),

    UnaryExpr: ($) => choice(seq(choice("~", "!", "-", "+", "&", "|", "^"), $["PrimaryExpr"]!), $["PrimaryExpr"]!),

    PrimaryExpr: ($) =>
      choice(
        $["SizedNumber"]!,
        $["NumberLiteral"]!,
        seq($["Identifier"]!, optional(seq("[", $["Expression"]!, optional(seq(":", $["Expression"]!)), "]"))),
        seq("{", $["Expression"]!, repeat(seq(",", $["Expression"]!)), "}"),
        seq("(", $["Expression"]!, ")"),
      ),

    BinaryOp: () =>
      choice(
        "===",
        "!==",
        "<<<",
        ">>>",
        "==",
        "!=",
        "<=",
        ">=",
        "&&",
        "||",
        "<<",
        ">>",
        "+",
        "-",
        "*",
        "/",
        "%",
        "&",
        "|",
        "^",
        "<",
        ">",
      ),

    SizedNumber: () => /\d*'[sS]?[bBoOdDhH][0-9a-fA-FxXzZ?_]+/,
    NumberLiteral: () => /\d[\d_]*/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_$]*/,
    Comment: () => /(?:\/\/[^\n]*|\/\*([^*]|\*+[^*/])*\*+\/)/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInVerilogLibrarySync();
