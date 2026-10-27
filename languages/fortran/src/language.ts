// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, def, field, language, optional, prec, repeat, seq, tggEq, tggRule } from "@modelscript/dsl";

/**
 * Precedence levels for Fortran arithmetic, relational, and logical expressions.
 */
export const FORTRAN_PREC = {
  ASSIGN: 1,
  OR: 2,
  AND: 3,
  NOT: 4,
  EQUALITY: 5,
  RELATIONAL: 6,
  ADDITIVE: 7,
  MULTIPLICATIVE: 8,
  POWER: 9,
  UNARY: 10,
  CALL: 11,
  PRIMARY: 12,
} as const;

/**
 * WebAssembly GLR Language definition for Fortran 77/90 engineering subroutines and scripts.
 */
export const fortranLanguage = language({
  name: "fortran",
  fileExtensions: [".f", ".for", ".f77", ".f90"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".f", ".for", ".f77", ".f90"],
    icons: {
      light: "./assets/fortran/icon-light.png",
      dark: "./assets/fortran/icon-dark.png",
    },
  },

  polyglot: {
    languages: ["modelica"],
    rules: [
      tggRule({
        name: "FortranSubroutineToModelicaFunction",
        sourceLang: "fortran",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.SubroutineDeclaration({ name: v("subName") }),
        target: ($, v) => $.FunctionDefinition({ declaredName: v("subName") }),
        where: (v) => [tggEq(v("subName"), v("subName"))],
      }),
      tggRule({
        name: "FortranAssignToModelicaEquation",
        sourceLang: "fortran",
        targetLang: "modelica",
        priority: 5,
        source: ($, v) => $.AssignmentStatement({ target: v("lhs"), value: v("rhs") }),
        target: ($, v) => $.EqualityEquation({ left: v("lhs"), right: v("rhs") }),
        where: (v) => [tggEq(v("lhs"), v("lhs")), tggEq(v("rhs"), v("rhs"))],
      }),
    ],
  },

  primitives: {
    lineComment: "!",
  },

  conflicts: ($) => [
    [$["BlockIfStatement"]!, $["InlineIfStatement"]!],
    [$["ArrayOrCallRef"]!, $["Target"]!],
  ],

  extras: () => [/[ \t\r\n]+/],

  rules: {
    SourceFile: ($) => repeat(choice($["ProgramUnit"]!, $["Statement"]!, $["_EmptyStatement"]!)),

    _EmptyStatement: () => ";",

    // ── Program Units ────────────────────────────────────────────────────────

    ProgramUnit: ($) => choice($["SubroutineDeclaration"]!, $["FunctionDeclaration"]!, $["ModuleDeclaration"]!),

    SubroutineDeclaration: ($) =>
      def({
        syntax: seq(
          $["SUBROUTINE_KEYWORD"]!,
          field("name", $["IDENTIFIER"]!),
          optional(seq("(", optional(field("parameters", $["ParameterList"]!)), ")")),
          repeat($["Statement"]!),
          $["END_SUBROUTINE"]!,
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Subroutine",
          name: self["name"] ?? "",
        }),
      }),

    FunctionDeclaration: ($) =>
      def({
        syntax: seq(
          optional(field("returnType", $["TYPE_SPECIFIER"]!)),
          $["FUNCTION_KEYWORD"]!,
          field("name", $["IDENTIFIER"]!),
          optional(seq("(", optional(field("parameters", $["ParameterList"]!)), ")")),
          repeat($["Statement"]!),
          $["END_FUNCTION"]!,
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Function",
          name: self["name"] ?? "",
        }),
      }),

    ModuleDeclaration: ($) =>
      def({
        syntax: seq($["MODULE_KEYWORD"]!, field("name", $["IDENTIFIER"]!), repeat($["Statement"]!), $["END_MODULE"]!),
        symbol: (self: Record<string, string>) => ({
          kind: "Module",
          name: self["name"] ?? "",
        }),
      }),

    ParameterList: ($) => seq($["IDENTIFIER"]!, repeat(seq(",", $["IDENTIFIER"]!))),

    // ── Statements ───────────────────────────────────────────────────────────

    Statement: ($) =>
      choice(
        $["DeclarationStatement"]!,
        $["CommonStatement"]!,
        $["ParameterStatement"]!,
        $["DimensionStatement"]!,
        $["ImplicitStatement"]!,
        $["AssignmentStatement"]!,
        $["BlockIfStatement"]!,
        $["InlineIfStatement"]!,
        $["DoStatement"]!,
        $["CallStatement"]!,
        $["ReturnStatement"]!,
        $["ContinueStatement"]!,
      ),

    DeclarationStatement: ($) =>
      seq(
        field("type", $["TYPE_SPECIFIER"]!),
        optional(seq("(", field("kind", $["Expression"]!), ")")),
        optional("::"),
        field("declarators", $["DeclaratorList"]!),
      ),

    DeclaratorList: ($) => seq($["Declarator"]!, repeat(seq(",", $["Declarator"]!))),

    Declarator: ($) =>
      seq(
        field("name", $["IDENTIFIER"]!),
        optional(seq("(", field("dimensions", $["DimensionList"]!), ")")),
        optional(seq("=", field("init", $["Expression"]!))),
      ),

    DimensionList: ($) => seq($["Expression"]!, repeat(seq(",", $["Expression"]!))),

    DimensionStatement: ($) => seq($["DIMENSION_KEYWORD"]!, $["DeclaratorList"]!),

    CommonStatement: ($) =>
      def({
        syntax: seq(
          $["COMMON_KEYWORD"]!,
          "/",
          field("name", $["IDENTIFIER"]!),
          "/",
          field("variables", $["IdentifierList"]!),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "CommonBlock",
          name: self["name"] ?? "BLANK_COMMON",
        }),
      }),

    ParameterStatement: ($) =>
      seq($["PARAMETER_KEYWORD"]!, "(", field("assignments", $["ParameterAssignmentList"]!), ")"),

    ParameterAssignmentList: ($) => seq($["ParameterAssignment"]!, repeat(seq(",", $["ParameterAssignment"]!))),

    ParameterAssignment: ($) => seq(field("name", $["IDENTIFIER"]!), "=", field("value", $["Expression"]!)),

    ImplicitStatement: ($) =>
      seq(
        $["IMPLICIT_KEYWORD"]!,
        choice($["NONE_KEYWORD"]!, seq($["TYPE_SPECIFIER"]!, "(", /[A-Za-z]/, "-", /[A-Za-z]/, ")")),
      ),

    IdentifierList: ($) => seq($["IDENTIFIER"]!, repeat(seq(",", $["IDENTIFIER"]!))),

    // ── Assignments & Procedural Statements ──────────────────────────────────

    AssignmentStatement: ($) => seq(field("target", $["Target"]!), "=", field("value", $["Expression"]!)),

    Target: ($) => choice($["StateRef"]!, $["PortRef"]!, $["ArrayOrCallRef"]!, $["IDENTIFIER"]!),

    StateRef: ($) => seq(field("array", $["STATE_ARRAY"]!), "(", field("index", $["Expression"]!), ")"),

    PortRef: ($) => choice(field("name", $["PORT_IDENTIFIER"]!), field("dim", $["DIM_DIRECTIVE"]!)),

    BlockIfStatement: ($) =>
      seq(
        $["IF_KEYWORD"]!,
        "(",
        field("condition", $["Expression"]!),
        ")",
        $["THEN_KEYWORD"]!,
        repeat($["Statement"]!),
        repeat($["ElseIfClause"]!),
        optional($["ElseClause"]!),
        $["END_IF"]!,
      ),

    ElseIfClause: ($) =>
      seq($["ELSE_IF"]!, "(", field("condition", $["Expression"]!), ")", $["THEN_KEYWORD"]!, repeat($["Statement"]!)),

    ElseClause: ($) => seq($["ELSE_KEYWORD"]!, repeat($["Statement"]!)),

    InlineIfStatement: ($) =>
      prec.right(
        1,
        seq($["IF_KEYWORD"]!, "(", field("condition", $["Expression"]!), ")", field("action", $["InlineAction"]!)),
      ),

    InlineAction: ($) =>
      choice($["AssignmentStatement"]!, $["CallStatement"]!, $["ReturnStatement"]!, $["ContinueStatement"]!),

    DoStatement: ($) =>
      seq(
        $["DO_KEYWORD"]!,
        optional(field("label", $["NUMBER"]!)),
        field("variable", $["IDENTIFIER"]!),
        "=",
        field("start", $["Expression"]!),
        ",",
        field("end", $["Expression"]!),
        optional(seq(",", field("step", $["Expression"]!))),
        repeat($["Statement"]!),
        $["END_DO"]!,
      ),

    CallStatement: ($) =>
      seq(
        $["CALL_KEYWORD"]!,
        field("subroutine", $["IDENTIFIER"]!),
        optional(seq("(", optional(field("arguments", $["ArgumentList"]!)), ")")),
      ),

    ReturnStatement: ($) => $["RETURN_KEYWORD"]!,

    ContinueStatement: ($) => seq(optional(field("label", $["NUMBER"]!)), $["CONTINUE_KEYWORD"]!),

    ArgumentList: ($) => seq($["Expression"]!, repeat(seq(",", $["Expression"]!))),

    // ── Expressions ──────────────────────────────────────────────────────────

    Expression: ($) => choice($["BinaryExpression"]!, $["UnaryExpression"]!, $["PrimaryExpression"]!),

    BinaryExpression: ($) =>
      choice(
        prec.left(
          FORTRAN_PREC.OR,
          seq(field("left", $["Expression"]!), $["LOGICAL_OR"]!, field("right", $["Expression"]!)),
        ),
        prec.left(
          FORTRAN_PREC.AND,
          seq(field("left", $["Expression"]!), $["LOGICAL_AND"]!, field("right", $["Expression"]!)),
        ),
        prec.left(
          FORTRAN_PREC.EQUALITY,
          seq(field("left", $["Expression"]!), $["EQUALITY_OP"]!, field("right", $["Expression"]!)),
        ),
        prec.left(
          FORTRAN_PREC.RELATIONAL,
          seq(field("left", $["Expression"]!), $["RELATIONAL_OP"]!, field("right", $["Expression"]!)),
        ),
        prec.left(
          FORTRAN_PREC.ADDITIVE,
          seq(field("left", $["Expression"]!), choice("+", "-"), field("right", $["Expression"]!)),
        ),
        prec.left(
          FORTRAN_PREC.MULTIPLICATIVE,
          seq(field("left", $["Expression"]!), choice("*", "/"), field("right", $["Expression"]!)),
        ),
        prec.right(
          FORTRAN_PREC.POWER,
          seq(field("left", $["Expression"]!), $["POWER_OP"]!, field("right", $["Expression"]!)),
        ),
      ),

    UnaryExpression: ($) =>
      prec(FORTRAN_PREC.UNARY, seq(choice("+", "-", $["LOGICAL_NOT"]!), field("operand", $["Expression"]!))),

    PrimaryExpression: ($) =>
      choice(
        $["StateRef"]!,
        $["PortRef"]!,
        $["ArrayOrCallRef"]!,
        $["SPECIAL_CONSTANT"]!,
        $["NUMBER"]!,
        $["STRING"]!,
        $["BOOLEAN"]!,
        $["IDENTIFIER"]!,
        seq("(", field("expr", $["Expression"]!), ")"),
      ),

    ArrayOrCallRef: ($) =>
      prec(
        FORTRAN_PREC.CALL,
        seq(field("callee", $["IDENTIFIER"]!), "(", optional(field("arguments", $["ArgumentList"]!)), ")"),
      ),

    // ── Lexical Terminals ────────────────────────────────────────────────────

    SUBROUTINE_KEYWORD: () => /[Ss][Uu][Bb][Rr][Oo][Uu][Tt][Ii][Nn][Ee]/,
    FUNCTION_KEYWORD: () => /[Ff][Uu][Nn][Cc][Tt][Ii][Oo][Nn]/,
    MODULE_KEYWORD: () => /[Mm][Oo][Dd][Uu][Ll][Ee]/,
    END_SUBROUTINE: () => /[Ee][Nn][Dd](?:\s+[Ss][Uu][Bb][Rr][Oo][Uu][Tt][Ii][Nn][Ee])?/,
    END_FUNCTION: () => /[Ee][Nn][Dd](?:\s+[Ff][Uu][Nn][Cc][Tt][Ii][Oo][Nn])?/,
    END_MODULE: () => /[Ee][Nn][Dd](?:\s+[Mm][Oo][Dd][Uu][Ll][Ee])?/,
    IF_KEYWORD: () => /[Ii][Ff]/,
    THEN_KEYWORD: () => /[Tt][Hh][Ee][Nn]/,
    END_IF: () => /[Ee][Nn][Dd]\s*[Ii][Ff]/,
    ELSE_IF: () => /[Ee][Ll][Ss][Ee]\s*[Ii][Ff]/,
    ELSE_KEYWORD: () => /[Ee][Ll][Ss][Ee]/,
    DO_KEYWORD: () => /[Dd][Oo]/,
    END_DO: () => /[Ee][Nn][Dd]\s*[Dd][Oo]/,
    CALL_KEYWORD: () => /[Cc][Aa][Ll][Ll]/,
    RETURN_KEYWORD: () => /[Rr][Ee][Tt][Uu][Rr][Nn]/,
    CONTINUE_KEYWORD: () => /[Cc][Oo][Nn][Tt][Ii][Nn][Uu][Ee]/,
    COMMON_KEYWORD: () => /[Cc][Oo][Mm][Mm][Oo][Nn]/,
    PARAMETER_KEYWORD: () => /[Pp][Aa][Rr][Aa][Mm][Ee][Tt][Ee][Rr]/,
    DIMENSION_KEYWORD: () => /[Dd][Ii][Mm][Ee][Nn][Ss][Ii][Oo][Nn]/,
    IMPLICIT_KEYWORD: () => /[Ii][Mm][Pp][Ll][Ii][Cc][Ii][Tt]/,
    NONE_KEYWORD: () => /[Nn][Oo][Nn][Ee]/,

    TYPE_SPECIFIER: () =>
      /(?:[Rr][Ee][Aa][Ll]|[Ii][Nn][Tt][Ee][Gg][Ee][Rr]|[Dd][Oo][Uu][Bb][Ll][Ee]\s+[Pp][Rr][Ee][Cc][Ii][Ss][Ii][Oo][Nn]|[Ll][Oo][Gg][Ii][Cc][Aa][Ll]|[Cc][Oo][Mm][Pp][Ll][Ee][Xx]|[Cc][Hh][Aa][Rr][Aa][Cc][Tt][Ee][Rr])/,

    STATE_ARRAY: () => /(?:[Ss][Tt][Oo][Rr][Ff]|[Ss][Tt][Oo][Rr][Ii])/,

    SPECIAL_CONSTANT: () => /(?:[Tt][Ii][Mm][Ee]|[Dd][Ee][Ll][Tt]|[Ff][Ii][Rr][Ss][Tt][Ss][Tt][Ee][Pp])/,

    LOGICAL_OR: () => /(?:\.[Oo][Rr]\.|\|\|)/,
    LOGICAL_AND: () => /(?:\.[Aa][Nn][Dd]\.|&&)/,
    EQUALITY_OP: () => /(?:\.[Ee][Qq]\.|\.[Nn][Ee]\.|==|\/=|!=)/,
    RELATIONAL_OP: () => /(?:\.[Ll][Tt]\.|\.[Ll][Ee]\.|\.[Gg][Tt]\.|\.[Gg][Ee]\.|<=|>=|<|>)/,
    LOGICAL_NOT: () => /(?:\.[Nn][Oo][Tt]\.|!)/,
    POWER_OP: () => /(?:\*\*|\^)/,

    IDENTIFIER: () => /[A-Za-z_][A-Za-z0-9_]*/,

    PORT_IDENTIFIER: () => /\$[A-Za-z_][A-Za-z0-9_]*/,

    DIM_DIRECTIVE: () => /\$#DIM\([A-Za-z_][A-Za-z0-9_]*\)/,

    NUMBER: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,

    STRING: () => /'([^']|'')*'|"[^"]*"/,

    BOOLEAN: () => /\.(?:TRUE|FALSE|true|false)\./,
  },
});

export default fortranLanguage;
