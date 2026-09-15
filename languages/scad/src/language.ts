// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, def, field, language, optional, prec, repeat, seq } from "@modelscript/dsl";

const PREC = {
  CONDITIONAL: 1,
  OR: 2,
  AND: 3,
  EQUALITY: 4,
  RELATIONAL: 5,
  ADDITIVE: 6,
  MULTIPLICATIVE: 7,
  POWER: 8,
  UNARY: 9,
  POSTFIX: 10,
  PRIMARY: 11,
} as const;

export const scadLanguage = language({
  name: "scad",

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
  },

  extras: () => [/\s+/],

  rules: {
    SourceFile: ($) => repeat($.Statement),

    Statement: ($) =>
      choice(
        $.VariableDeclaration,
        $.ModuleDeclaration,
        $.FunctionDeclaration,
        $.IfStatement,
        $.ForStatement,
        $.BlockStatement,
        $.PrefixSolid,
        $.ChainedSolidStatement,
        $._EmptyStatement,
      ),

    _EmptyStatement: () => ";",

    BlockStatement: ($) => seq("{", repeat($.Statement), "}"),

    VariableDeclaration: ($) =>
      def({
        syntax: seq(field("name", $.IDENTIFIER), "=", field("value", $.Expression), ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "Variable",
          name: self.name ?? "",
        }),
      }),

    ModuleDeclaration: ($) =>
      def({
        syntax: seq(
          "module",
          field("name", $.IDENTIFIER),
          "(",
          optional(field("parameters", $.ParameterList)),
          ")",
          field("body", $.Statement),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Module",
          name: self.name ?? "",
          exports: ["body"],
        }),
      }),

    FunctionDeclaration: ($) =>
      def({
        syntax: seq(
          "function",
          field("name", $.IDENTIFIER),
          "(",
          optional(field("parameters", $.ParameterList)),
          ")",
          "=",
          field("body", $.Expression),
          ";",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Function",
          name: self.name ?? "",
        }),
      }),

    IfStatement: ($) =>
      prec.right(
        seq(
          "if",
          "(",
          field("condition", $.Expression),
          ")",
          field("consequence", $.Statement),
          optional(seq("else", field("alternative", $.Statement))),
        ),
      ),

    ForStatement: ($) =>
      seq("for", "(", field("var", $.IDENTIFIER), "=", field("range", $.Expression), ")", field("body", $.Statement)),

    ParameterList: ($) => seq($.Parameter, repeat(seq(",", $.Parameter))),

    Parameter: ($) => seq(field("name", $.IDENTIFIER), optional(seq("=", field("default", $.Expression)))),

    ArgumentList: ($) => seq($.Argument, repeat(seq(",", $.Argument))),

    Argument: ($) =>
      choice(seq(field("name", $.IDENTIFIER), "=", field("value", $.Expression)), field("value", $.Expression)),

    // ── Solid Statements & Hybrid Chaining ─────────────────────────────────

    PrefixSolid: ($) =>
      seq(field("operator", choice($.TransformOp, $.BooleanOp, $.TagPortOp)), field("child", $.Statement)),

    TransformOp: ($) =>
      choice(
        seq("translate", "(", optional(field("args", $.ArgumentList)), ")"),
        seq("rotate", "(", optional(field("args", $.ArgumentList)), ")"),
        seq("scale", "(", optional(field("args", $.ArgumentList)), ")"),
        seq("mirror", "(", optional(field("args", $.ArgumentList)), ")"),
        seq("color", "(", optional(field("args", $.ArgumentList)), ")"),
      ),

    BooleanOp: ($) => choice(seq("union", "(", ")"), seq("difference", "(", ")"), seq("intersection", "(", ")")),

    TagPortOp: ($) =>
      def({
        syntax: seq("tag_port", "(", field("args", $.ArgumentList), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "TaggedPort",
          name: self.args ?? "",
        }),
      }),

    ChainedSolidStatement: ($) => seq(field("solid", $.ChainedSolid), ";"),

    ChainedSolid: ($) => seq(field("receiver", $.PrimarySolid), repeat(field("method", $.MethodCall))),

    MethodCall: ($) => seq(".", field("name", $.MethodName), "(", optional(field("args", $.ArgumentList)), ")"),

    MethodName: ($) => choice($.IDENTIFIER, "translate", "rotate", "scale", "mirror", "color", "fillet", "chamfer"),

    PrimarySolid: ($) =>
      choice($.CubePrimitive, $.CylinderPrimitive, $.SpherePrimitive, $.PolyhedronPrimitive, $.ModuleInstantiation),

    CubePrimitive: ($) => seq("cube", "(", optional(field("args", $.ArgumentList)), ")"),

    CylinderPrimitive: ($) => seq("cylinder", "(", optional(field("args", $.ArgumentList)), ")"),

    SpherePrimitive: ($) => seq("sphere", "(", optional(field("args", $.ArgumentList)), ")"),

    PolyhedronPrimitive: ($) => seq("polyhedron", "(", optional(field("args", $.ArgumentList)), ")"),

    ModuleInstantiation: ($) => seq(field("name", $.IDENTIFIER), "(", optional(field("args", $.ArgumentList)), ")"),

    // ── Expressions ────────────────────────────────────────────────────────

    Expression: ($) =>
      choice($.ConditionalExpression, $.BinaryExpression, $.UnaryExpression, $.PostfixExpression, $.PrimaryExpression),

    ConditionalExpression: ($) =>
      prec.right(
        PREC.CONDITIONAL,
        seq(
          field("condition", $.Expression),
          "?",
          field("consequence", $.Expression),
          ":",
          field("alternative", $.Expression),
        ),
      ),

    BinaryExpression: ($) =>
      choice(
        prec.left(PREC.OR, seq(field("left", $.Expression), field("operator", "||"), field("right", $.Expression))),
        prec.left(PREC.AND, seq(field("left", $.Expression), field("operator", "&&"), field("right", $.Expression))),
        prec.left(
          PREC.EQUALITY,
          seq(field("left", $.Expression), field("operator", choice("==", "!=")), field("right", $.Expression)),
        ),
        prec.left(
          PREC.RELATIONAL,
          seq(
            field("left", $.Expression),
            field("operator", choice("<", "<=", ">", ">=")),
            field("right", $.Expression),
          ),
        ),
        prec.left(
          PREC.ADDITIVE,
          seq(field("left", $.Expression), field("operator", choice("+", "-")), field("right", $.Expression)),
        ),
        prec.left(
          PREC.MULTIPLICATIVE,
          seq(field("left", $.Expression), field("operator", choice("*", "/", "%")), field("right", $.Expression)),
        ),
        prec.right(PREC.POWER, seq(field("left", $.Expression), field("operator", "^"), field("right", $.Expression))),
      ),

    UnaryExpression: ($) =>
      prec(PREC.UNARY, seq(field("operator", choice("!", "-", "+")), field("operand", $.Expression))),

    PostfixExpression: ($) =>
      choice(
        prec(PREC.POSTFIX, seq(field("operand", $.Expression), "[", field("index", $.Expression), "]")),
        prec(
          PREC.POSTFIX,
          seq(field("function", $.Expression), "(", optional(field("arguments", $.ArgumentList)), ")"),
        ),
      ),

    PrimaryExpression: ($) =>
      choice(
        $.NUMBER,
        $.STRING,
        $.BOOLEAN,
        $.UNDEF,
        $.IDENTIFIER,
        $.VectorLiteral,
        $.RangeLiteral,
        $.ParenthesizedExpression,
      ),

    ParenthesizedExpression: ($) => seq("(", field("expression", $.Expression), ")"),

    VectorLiteral: ($) => seq("[", optional(seq($.Expression, repeat(seq(",", $.Expression)))), "]"),

    RangeLiteral: ($) =>
      seq(
        "[",
        field("start", $.Expression),
        ":",
        choice(seq(field("step", $.Expression), ":", field("end", $.Expression)), field("end", $.Expression)),
        "]",
      ),

    // ── Terminals ──────────────────────────────────────────────────────────

    IDENTIFIER: () => /\$?[a-zA-Z_][a-zA-Z0-9_]*/,

    NUMBER: () => /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,

    STRING: () => /"([^"\\]|\\.)*"/,

    BOOLEAN: () => choice("true", "false"),

    UNDEF: () => "undef",
  },
});

export default scadLanguage;
