// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, def, field, language, optional, prec, repeat, seq, tggEq, tggRule, token } from "@modelscript/dsl";

/**
 * Precedence levels for C arithmetic, relational, logical, and bitwise operators.
 */
export const C_PREC = {
  COMMA: 1,
  ASSIGN: 2,
  CONDITIONAL: 3,
  LOGICAL_OR: 4,
  LOGICAL_AND: 5,
  BITWISE_OR: 6,
  BITWISE_XOR: 7,
  BITWISE_AND: 8,
  EQUALITY: 9,
  RELATIONAL: 10,
  SHIFT: 11,
  ADDITIVE: 12,
  MULTIPLICATIVE: 13,
  UNARY: 14,
  POSTFIX: 15,
  PRIMARY: 16,
} as const;

/**
 * WebAssembly GLR Language definition for ANSI C / C99.
 */
export const cLanguage = language({
  name: "c",
  fileExtensions: [".c", ".h"],
  lsp: {
    fileExtensions: [".c", ".h"],
    icons: {
      light: "./assets/c/icon-light.png",
      dark: "./assets/c/icon-dark.png",
    },
  },

  polyglot: {
    languages: ["modelica"],
    rules: [
      tggRule({
        name: "CFunctionToModelicaFunction",
        sourceLang: "c",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.FunctionDefinition({ name: v("fnName") }),
        target: ($, v) => $.FunctionDefinition({ declaredName: v("fnName") }),
        where: (v) => [tggEq(v("fnName"), v("fnName"))],
      }),
      tggRule({
        name: "CStructToModelicaRecord",
        sourceLang: "c",
        targetLang: "modelica",
        priority: 8,
        source: ($, v) => $.StructSpecifier({ name: v("structName") }),
        target: ($, v) => $.RecordDefinition({ declaredName: v("structName") }),
        where: (v) => [tggEq(v("structName"), v("structName"))],
      }),
    ],
  },

  symbols: {
    FunctionDefinition: { name: "name", kind: "Function", scope: true, icon: "symbol-function" },
    StructSpecifier: { name: "name", kind: "Struct", scope: true, icon: "symbol-structure" },
    VariableDeclarator: { name: "name", kind: "Variable", scope: false, icon: "symbol-variable" },
  },

  primitives: {
    lineComment: "//",
    nestedComment: { open: "/*", close: "*/" },
  },

  reserved: {
    keyword: () =>
      [
        "auto",
        "break",
        "case",
        "const",
        "continue",
        "default",
        "do",
        "else",
        "enum",
        "extern",
        "for",
        "goto",
        "if",
        "inline",
        "register",
        "restrict",
        "return",
        "sizeof",
        "static",
        "struct",
        "switch",
        "typedef",
        "union",
        "volatile",
        "while",
        "FIRST_STEP",
        "DT",
        "TIME",
      ].map((k) => token(k)),

    type: () =>
      [
        "void",
        "char",
        "short",
        "int",
        "long",
        "float",
        "double",
        "signed",
        "unsigned",
        "_Bool",
        "_Complex",
        "_Imaginary",
        "bool",
        "size_t",
        "uint8_t",
        "uint16_t",
        "uint32_t",
        "uint64_t",
        "int8_t",
        "int16_t",
        "int32_t",
        "int64_t",
        "float32_t",
        "float64_t",
      ].map((t) => token(t)),

    operator: () =>
      [
        "+",
        "-",
        "*",
        "/",
        "%",
        "++",
        "--",
        "==",
        "!=",
        "<",
        ">",
        "<=",
        ">=",
        "&&",
        "||",
        "!",
        "&",
        "|",
        "^",
        "~",
        "<<",
        ">>",
        "=",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "<<=",
        ">>=",
        "&=",
        "^=",
        "|=",
        "->",
      ].map((o) => token(o)),
  },

  conflicts: ($) => [
    [$["FunctionDeclarator"]!, $["CallExpression"]!],
    [$["TypeSpecifier"]!, $["IDENTIFIER"]!],
    [$["VariableDeclarator"]!, $["ArrayDeclarator"]!],
    [$["Declaration"]!, $["ExpressionStatement"]!],
    [$["Declaration"]!, $["Statement"]!],
    [$["UnaryExpression"]!, $["PostfixExpression"]!],
    [
      $["AssignmentExpression"]!,
      $["BinaryExpression"]!,
      $["UnaryExpression"]!,
      $["PostfixExpression"]!,
      $["PrimaryExpression"]!,
    ],
  ],

  extras: () => [/[ \t\r\n]+/, /\/\/[^\n]*/, /\/\*[\s\S]*?\*\//],

  rules: {
    SourceFile: ($) => repeat(choice($["FunctionDefinition"]!, $["Declaration"]!, $["_EmptyStatement"]!)),

    _EmptyStatement: () => ";",

    // ── Declarations & Types ─────────────────────────────────────────────────

    Declaration: ($) =>
      seq(
        optional(field("storage", $["StorageClassSpecifier"]!)),
        field("type", $["TypeSpecifier"]!),
        optional(field("declarators", $["InitDeclaratorList"]!)),
        ";",
      ),

    StorageClassSpecifier: () => choice("typedef", "extern", "static", "auto", "register"),

    TypeSpecifier: ($) =>
      choice($["PrimitiveType"]!, $["StructSpecifier"]!, $["UnionSpecifier"]!, $["EnumSpecifier"]!, $["TypedefName"]!),

    PrimitiveType: () =>
      choice(
        "void",
        "char",
        "short",
        "int",
        "long",
        "float",
        "double",
        "signed",
        "unsigned",
        "_Bool",
        "_Complex",
        seq("unsigned", choice("char", "short", "int", "long")),
        seq("signed", choice("char", "short", "int", "long")),
        seq("long", "long"),
        seq("unsigned", "long", "long"),
        seq("long", "double"),
      ),

    TypedefName: ($) => field("name", $["IDENTIFIER"]!),

    StructSpecifier: ($) =>
      def({
        syntax: seq(
          "struct",
          choice(
            seq(field("name", $["IDENTIFIER"]!), optional(field("body", $["StructDeclarationList"]!))),
            field("body", $["StructDeclarationList"]!),
          ),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Struct",
          name: self["name"] ?? "anonymous_struct",
        }),
      }),

    UnionSpecifier: ($) =>
      seq(
        "union",
        choice(
          seq(field("name", $["IDENTIFIER"]!), optional(field("body", $["StructDeclarationList"]!))),
          field("body", $["StructDeclarationList"]!),
        ),
      ),

    StructDeclarationList: ($) => seq("{", repeat($["StructFieldDeclaration"]!), "}"),

    StructFieldDeclaration: ($) =>
      seq(field("type", $["TypeSpecifier"]!), field("declarators", $["StructDeclaratorList"]!), ";"),

    StructDeclaratorList: ($) => seq($["Declarator"]!, repeat(seq(",", $["Declarator"]!))),

    EnumSpecifier: ($) =>
      seq(
        "enum",
        choice(
          seq(field("name", $["IDENTIFIER"]!), optional(field("body", $["EnumeratorList"]!))),
          field("body", $["EnumeratorList"]!),
        ),
      ),

    EnumeratorList: ($) => seq("{", $["Enumerator"]!, repeat(seq(",", $["Enumerator"]!)), optional(","), "}"),

    Enumerator: ($) => seq(field("name", $["IDENTIFIER"]!), optional(seq("=", field("value", $["Expression"]!)))),

    InitDeclaratorList: ($) => seq($["InitDeclarator"]!, repeat(seq(",", $["InitDeclarator"]!))),

    InitDeclarator: ($) =>
      seq(
        field("declarator", $["Declarator"]!),
        optional(seq("=", field("initializer", choice($["InitializerList"]!, $["Expression"]!)))),
      ),

    InitializerList: ($) =>
      seq(
        "{",
        choice($["InitializerList"]!, $["Expression"]!),
        repeat(seq(",", choice($["InitializerList"]!, $["Expression"]!))),
        optional(","),
        "}",
      ),

    Declarator: ($) =>
      seq(repeat("*"), choice($["FunctionDeclarator"]!, $["ArrayDeclarator"]!, $["VariableDeclarator"]!)),

    VariableDeclarator: ($) => field("name", $["IDENTIFIER"]!),

    ArrayDeclarator: ($) =>
      seq(field("name", $["IDENTIFIER"]!), repeat(seq("[", optional(field("size", $["Expression"]!)), "]"))),

    FunctionDeclarator: ($) =>
      seq(field("name", $["IDENTIFIER"]!), "(", optional(field("parameters", $["ParameterList"]!)), ")"),

    ParameterList: ($) =>
      seq($["ParameterDeclaration"]!, repeat(seq(",", $["ParameterDeclaration"]!)), optional(seq(",", "..."))),

    ParameterDeclaration: ($) =>
      seq(field("type", $["TypeSpecifier"]!), optional(field("declarator", $["Declarator"]!))),

    // ── Functions ────────────────────────────────────────────────────────────

    FunctionDefinition: ($) =>
      def({
        syntax: seq(
          optional(field("storage", $["StorageClassSpecifier"]!)),
          field("returnType", $["TypeSpecifier"]!),
          field("declarator", $["FunctionDeclarator"]!),
          field("body", $["CompoundStatement"]!),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Function",
          name: self["declarator"] ?? "",
        }),
      }),

    // ── Statements ───────────────────────────────────────────────────────────

    Statement: ($) =>
      choice(
        $["CompoundStatement"]!,
        $["ExpressionStatement"]!,
        $["IfStatement"]!,
        $["WhileStatement"]!,
        $["DoWhileStatement"]!,
        $["ForStatement"]!,
        $["ReturnStatement"]!,
        $["BreakStatement"]!,
        $["ContinueStatement"]!,
      ),

    CompoundStatement: ($) => seq("{", repeat(choice($["Declaration"]!, $["Statement"]!)), "}"),

    ExpressionStatement: ($) => seq(optional(field("expr", $["Expression"]!)), ";"),

    IfStatement: ($) =>
      prec.right(
        seq(
          "if",
          "(",
          field("condition", $["Expression"]!),
          ")",
          field("consequence", $["Statement"]!),
          optional(seq("else", field("alternative", $["Statement"]!))),
        ),
      ),

    WhileStatement: ($) => seq("while", "(", field("condition", $["Expression"]!), ")", field("body", $["Statement"]!)),

    DoWhileStatement: ($) =>
      seq("do", field("body", $["Statement"]!), "while", "(", field("condition", $["Expression"]!), ")", ";"),

    ForStatement: ($) =>
      seq(
        "for",
        "(",
        field("init", choice($["Declaration"]!, $["ExpressionStatement"]!)),
        optional(field("condition", $["Expression"]!)),
        ";",
        optional(field("step", $["Expression"]!)),
        ")",
        field("body", $["Statement"]!),
      ),

    ReturnStatement: ($) => seq("return", optional(field("value", $["Expression"]!)), ";"),

    BreakStatement: () => seq("break", ";"),

    ContinueStatement: () => seq("continue", ";"),

    // ── Expressions ──────────────────────────────────────────────────────────

    Expression: ($) =>
      choice(
        $["AssignmentExpression"]!,
        $["BinaryExpression"]!,
        $["UnaryExpression"]!,
        $["PostfixExpression"]!,
        $["PrimaryExpression"]!,
      ),

    AssignmentExpression: ($) =>
      prec.right(
        C_PREC.ASSIGN,
        seq(
          field("left", $["UnaryExpression"]!),
          field("operator", choice("=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=")),
          field("right", $["Expression"]!),
        ),
      ),

    BinaryExpression: ($) =>
      choice(
        prec.left(C_PREC.LOGICAL_OR, seq(field("left", $["Expression"]!), "||", field("right", $["Expression"]!))),
        prec.left(C_PREC.LOGICAL_AND, seq(field("left", $["Expression"]!), "&&", field("right", $["Expression"]!))),
        prec.left(C_PREC.BITWISE_OR, seq(field("left", $["Expression"]!), "|", field("right", $["Expression"]!))),
        prec.left(C_PREC.BITWISE_XOR, seq(field("left", $["Expression"]!), "^", field("right", $["Expression"]!))),
        prec.left(C_PREC.BITWISE_AND, seq(field("left", $["Expression"]!), "&", field("right", $["Expression"]!))),
        prec.left(
          C_PREC.EQUALITY,
          seq(field("left", $["Expression"]!), choice("==", "!="), field("right", $["Expression"]!)),
        ),
        prec.left(
          C_PREC.RELATIONAL,
          seq(field("left", $["Expression"]!), choice("<", "<=", ">", ">="), field("right", $["Expression"]!)),
        ),
        prec.left(
          C_PREC.SHIFT,
          seq(field("left", $["Expression"]!), choice("<<", ">>"), field("right", $["Expression"]!)),
        ),
        prec.left(
          C_PREC.ADDITIVE,
          seq(field("left", $["Expression"]!), choice("+", "-"), field("right", $["Expression"]!)),
        ),
        prec.left(
          C_PREC.MULTIPLICATIVE,
          seq(field("left", $["Expression"]!), choice("*", "/", "%"), field("right", $["Expression"]!)),
        ),
      ),

    UnaryExpression: ($) =>
      choice(
        prec.right(C_PREC.UNARY, seq(choice("-", "+", "!", "~", "*", "&"), field("operand", $["Expression"]!))),
        prec.right(C_PREC.UNARY, seq(choice("++", "--"), field("operand", $["UnaryExpression"]!))),
        prec.right(C_PREC.UNARY, seq("sizeof", "(", field("type", choice($["TypeSpecifier"]!, $["Expression"]!)), ")")),
        $["PostfixExpression"]!,
      ),

    PostfixExpression: ($) =>
      choice(
        $["CallExpression"]!,
        $["SubscriptExpression"]!,
        $["MemberExpression"]!,
        $["PointerMemberExpression"]!,
        $["PostfixIncrement"]!,
        $["PrimaryExpression"]!,
      ),

    CallExpression: ($) =>
      prec(
        C_PREC.POSTFIX,
        seq(field("callee", $["PrimaryExpression"]!), "(", optional(field("arguments", $["ArgumentList"]!)), ")"),
      ),

    ArgumentList: ($) => seq($["Expression"]!, repeat(seq(",", $["Expression"]!))),

    SubscriptExpression: ($) =>
      prec(C_PREC.POSTFIX, seq(field("array", $["PrimaryExpression"]!), "[", field("index", $["Expression"]!), "]")),

    MemberExpression: ($) =>
      prec(C_PREC.POSTFIX, seq(field("target", $["PrimaryExpression"]!), ".", field("field", $["IDENTIFIER"]!))),

    PointerMemberExpression: ($) =>
      prec(C_PREC.POSTFIX, seq(field("target", $["PrimaryExpression"]!), "->", field("field", $["IDENTIFIER"]!))),

    PostfixIncrement: ($) => prec(C_PREC.POSTFIX, seq(field("operand", $["PrimaryExpression"]!), choice("++", "--"))),

    PrimaryExpression: ($) =>
      choice(
        field("name", $["IDENTIFIER"]!),
        field("number", $["NUMBER"]!),
        field("string", $["STRING_LITERAL"]!),
        field("char", $["CHAR_LITERAL"]!),
        seq("(", field("expression", $["Expression"]!), ")"),
      ),

    // ── Lexical Terminals ────────────────────────────────────────────────────

    IDENTIFIER: () => /[A-Za-z_][A-Za-z0-9_]*/,

    NUMBER: () => /[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?[fFlLuU]*/,

    STRING_LITERAL: () => /"(?:[^"\\]|\\.)*"/,

    CHAR_LITERAL: () => /'(?:[^'\\]|\\.)*'/,
  },
});
