// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, def, field, language, optional, prec, repeat, repeat1, seq, tggEq, tggRule } from "@modelscript/dsl";

const PREC = {
  FLWOR: 1,
  CONDITIONAL: 2,
  OR: 3,
  AND: 4,
  EQUALITY: 5,
  RELATIONAL: 6,
  ADDITIVE: 7,
  MULTIPLICATIVE: 8,
  UNARY: 9,
  POSTFIX: 10,
  PRIMARY: 11,
  IF: 1,
} as const;

export const modelscriptLanguage = language({
  name: "modelscript",
  displayName: "ModelScript",
  fileExtensions: [".modelscript", ".msx"],
  lsp: {
    fileExtensions: [".modelscript", ".msx"],
  },

  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startByte != null && entry?.endByte != null && entry.endByte >= entry.startByte) {
      return { startByte: entry.startByte, endByte: entry.endByte, newText: newValue.trim() };
    }
    return null;
  },

  actions: [
    {
      id: "run_modelscript",
      title: "Run ModelScript",
      description: "Executes the active ModelScript (.modelscript, .msx) script and outputs results.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "modelscript_run",
          displayName: "Run ModelScript Script",
          modelDescription: "Executes ModelScript code containing algorithms or polyglot model queries.",
        },
      },
    },
  ],

  symbols: {
    StructDeclaration: { name: "name", kind: "Struct", scope: true, icon: "symbol-structure" },
    FunctionDeclaration: { name: "name", kind: "Function", scope: true, icon: "symbol-function" },
    VariableDeclaration: { name: "name", kind: "Variable", scope: false, icon: "symbol-variable" },
  },

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
  },

  conflicts: ($) => [[$.BlockStatement, $.ObjectLiteral]],

  extras: () => [/\s+/],

  rules: {
    SourceFile: ($) => repeat(choice($.TopLevelDeclaration, $._EmptyStatement)),

    TopLevelDeclaration: ($) => choice($.ImportDeclaration, $.StructDeclaration, $.Statement),

    // ── Declarations ─────────────────────────────────────────────────────────

    ImportDeclaration: ($) =>
      seq("import", "{", field("specifiers", $.ImportSpecifierList), "}", "from", field("source", $.STRING), ";"),

    ImportSpecifierList: ($) => seq($.ImportSpecifier, repeat(seq(",", $.ImportSpecifier))),

    ImportSpecifier: ($) =>
      choice(seq(field("imported", $.IDENTIFIER), "as", field("local", $.IDENTIFIER)), field("name", $.IDENTIFIER)),

    StructDeclaration: ($) =>
      def({
        syntax: seq(
          optional("@unmanaged"),
          "struct",
          field("name", $.IDENTIFIER),
          "{",
          repeat(field("fields", $.StructField)),
          "}",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Struct",
          name: self.name ?? "",
        }),
      }),

    StructField: ($) => seq(field("name", $.IDENTIFIER), ":", field("type", $.Type), ";"),

    FunctionDeclaration: ($) =>
      def({
        syntax: seq(
          "function",
          field("name", $.IDENTIFIER),
          "(",
          optional(field("parameters", $.ParameterList)),
          ")",
          optional(seq(":", field("returnType", $.Type))),
          field("body", $.BlockStatement),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Function",
          name: self.name ?? "",
        }),
      }),

    ParameterList: ($) => seq($.Parameter, repeat(seq(",", $.Parameter))),

    Parameter: ($) => seq(field("name", $.IDENTIFIER), ":", field("type", $.Type)),

    // ── Types ────────────────────────────────────────────────────────────────

    Type: ($) => choice($.PrimitiveType, $.GenericType, $.CustomType),

    PrimitiveType: () => choice("i32", "u32", "i64", "u64", "f32", "f64", "bool", "string", "usize", "void"),

    GenericType: ($) =>
      seq(field("genericName", choice("Array", "Slice", "ptr")), "<", field("elementType", $.Type), ">"),

    CustomType: ($) => field("name", $.IDENTIFIER),

    // ── Statements ───────────────────────────────────────────────────────────

    Statement: ($) =>
      choice(
        $.BlockStatement,
        $.VariableDeclaration,
        $.FunctionDeclaration,
        $.AssignmentStatement,
        $.ReturnStatement,
        $.IfStatement,
        $.WhileStatement,
        $.ForStatement,
        $.ExpressionStatement,
      ),

    BlockStatement: ($) => seq("{", repeat($.Statement), "}"),

    VariableDeclaration: ($) =>
      def({
        syntax: seq(
          choice("let", "const"),
          field("name", $.IDENTIFIER),
          optional(seq(":", field("type", $.Type))),
          optional(seq("=", field("value", $.Expression))),
          ";",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Variable",
          name: self.name ?? "",
        }),
      }),

    AssignmentStatement: ($) =>
      seq(
        field("target", choice($.IDENTIFIER, $.PostfixExpression)),
        field("operator", choice("=", "+=", "-=", "*=", "/=")),
        field("value", $.Expression),
        ";",
      ),

    ReturnStatement: ($) => seq("return", optional(field("value", $.Expression)), ";"),

    IfStatement: ($) =>
      prec.right(
        PREC.IF,
        seq(
          "if",
          "(",
          field("condition", $.Expression),
          ")",
          field("consequence", $.Statement),
          optional(seq("else", field("alternative", $.Statement))),
        ),
      ),

    WhileStatement: ($) => seq("while", "(", field("condition", $.Expression), ")", field("body", $.Statement)),

    ForStatement: ($) =>
      seq(
        "for",
        "(",
        field("init", choice($.VariableDeclaration, $.ExpressionStatement, $._EmptyStatement)),
        field("condition", optional($.Expression)),
        ";",
        field("update", optional($.Expression)),
        ")",
        field("body", $.Statement),
      ),

    ExpressionStatement: ($) => seq(field("expression", $.Expression), ";"),

    _EmptyStatement: () => ";",

    // ── Expressions ──────────────────────────────────────────────────────────

    Expression: ($) =>
      choice(
        $.FLWORExpression,
        $.BinaryExpression,
        $.UnaryExpression,
        $.NewExpression,
        $.PostfixExpression,
        $.PrimaryExpression,
      ),

    NewExpression: ($) =>
      seq("new", field("constructor", $.IDENTIFIER), "(", optional(field("arguments", $.ArgumentList)), ")"),

    FLWORExpression: ($) =>
      prec(
        PREC.FLWOR,
        seq(
          repeat1(field("forClauses", $.ForClause)),
          repeat(field("letClauses", $.LetClause)),
          optional(field("whereClause", $.WhereClause)),
          optional(field("orderByClause", $.OrderByClause)),
          field("returnClause", $.ReturnClause),
        ),
      ),

    ForClause: ($) => seq("for", field("variable", $.IDENTIFIER), "in", field("collection", $.Expression)),

    LetClause: ($) => seq("let", field("variable", $.IDENTIFIER), choice(":=", "="), field("value", $.Expression)),

    WhereClause: ($) => seq("where", field("condition", $.Expression)),

    OrderByClause: ($) =>
      seq(
        "order",
        "by",
        field("criteria", $.Expression),
        optional(field("direction", choice("ascending", "descending", "asc", "desc"))),
      ),

    ReturnClause: ($) => seq("return", field("value", $.Expression)),

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
      ),

    UnaryExpression: ($) =>
      prec(PREC.UNARY, seq(field("operator", choice("!", "-", "+", "~")), field("operand", $.Expression))),

    PostfixExpression: ($) =>
      choice(
        prec.left(PREC.POSTFIX, seq(field("object", $.Expression), ".", field("property", $.IDENTIFIER))),
        prec.left(
          PREC.POSTFIX,
          seq(field("callee", $.Expression), "(", optional(field("arguments", $.ArgumentList)), ")"),
        ),
        prec.left(PREC.POSTFIX, seq(field("array", $.Expression), "[", field("index", $.Expression), "]")),
      ),

    ArgumentList: ($) => seq($.Argument, repeat(seq(",", $.Argument))),

    Argument: ($) =>
      choice(seq(field("name", $.IDENTIFIER), ":", field("value", $.Expression)), field("value", $.Expression)),

    PrimaryExpression: ($) =>
      choice($.NUMBER, $.STRING, $.BOOLEAN, $.IDENTIFIER, $.ArrayLiteral, $.ObjectLiteral, $.ParenthesizedExpression),

    ArrayLiteral: ($) => seq("[", optional(seq($.Expression, repeat(seq(",", $.Expression)))), "]"),

    ObjectLiteral: ($) => seq("{", optional(seq($.ObjectField, repeat(seq(",", $.ObjectField)))), "}"),

    ObjectField: ($) =>
      choice(seq(field("key", $.IDENTIFIER), ":", field("value", $.Expression)), field("shorthand", $.IDENTIFIER)),

    ParenthesizedExpression: ($) => seq("(", field("expression", $.Expression), ")"),

    // ── Terminals ────────────────────────────────────────────────────────────

    IDENTIFIER: () => /[a-zA-Z_][a-zA-Z0-9_]*/,

    NUMBER: () => /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,

    STRING: () => /"([^"\\]|\\.)*"/,

    BOOLEAN: () => choice("true", "false"),
  },

  polyglot: {
    languages: ["modelica", "sysml2"],
    typeMaps: {
      modelica: {
        i32: "Integer",
        u32: "Integer",
        i64: "Integer",
        f64: "Real",
        bool: "Boolean",
        string: "String",
      },
      sysml2: {
        i32: "KerML::Integer",
        u32: "KerML::Integer",
        f64: "ISQ::Real",
        bool: "KerML::Boolean",
        string: "KerML::String",
      },
    },
    rules: [
      tggRule({
        name: "ModelScriptStructToModelicaRecord",
        sourceLang: "modelscript",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.StructDeclaration({ name: v("name") }),
        target: ($, v) => $.ClassDefinition({ name: v("name"), classKind: "record" }),
        where: (v) => [tggEq(v("name"), v("name"))],
      }),
      tggRule({
        name: "ModelScriptParamToModelicaMod",
        sourceLang: "modelscript",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.VariableDeclaration({ name: v("paramName"), value: v("paramVal") }),
        target: ($, v) => $.ComponentClause({ name: v("paramName"), modification: v("paramVal") }),
        where: (v) => [tggEq(v("paramName"), v("paramName")), tggEq(v("paramVal"), v("paramVal"))],
      }),
    ],
  },
});

export default modelscriptLanguage;
