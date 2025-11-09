/**
 * @file Modelica grammar for tree-sitter
 * @author Mohamad Omar Nachawati <mnachawa@gmail.com>
 * @license AGPL-3.0-or-later
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "modelica",
  extras: ($) => [/\s/, $.BLOCK_COMMENT, $.LINE_COMMENT],
  conflicts: ($) => [[$.Name]],
  word: ($) => $.IDENT,
  rules: {
    StoredDefinition: ($) =>
      seq(
        optional($.BOM),
        optional(field("withinDirective", $.WithinDirective)),
        repeat(field("classDefinition", $.ClassDefinition)),
      ),

    WithinDirective: ($) => seq("within", optional(field("packageName", $.Name)), ";"),

    ClassDefinition: ($) => seq(field("classKind", $.ClassKind), field("classSpecifier", $._ClassSpecifier), ";"),

    ClassKind: ($) => choice(field("class", "class"), field("package", "package")),

    _ClassSpecifier: ($) => $.LongClassSpecifier,

    LongClassSpecifier: ($) =>
      seq(
        choice(field("identifier", $.IDENT)),
        optional(field("section", $.InitialElementSection)),
        repeat(field("section", choice($.ElementSection, $.EquationSection))),
        "end",
        field("endIdentifier", $.IDENT),
      ),

    InitialElementSection: ($) => repeat1(field("element", $._Element)),

    ElementSection: ($) =>
      seq(choice(field("protected", "protected"), field("public", "public")), repeat(field("element", $._Element))),

    _Element: ($) => choice($.ClassDefinition, $.ComponentClause, $.ExtendsClause, $._ImportClause),

    _ImportClause: ($) => choice($.SimpleImportClause, $.CompoundImportClause, $.UnqualifiedImportClause),

    SimpleImportClause: ($) =>
      seq("import", optional(seq(field("shortName", $.IDENT), "=")), field("packageName", $.Name), ";"),

    CompoundImportClause: ($) =>
      seq("import", field("packageName", $.Name), ".", "{", commaSep1(field("importName", $.IDENT)), "}", ";"),

    UnqualifiedImportClause: ($) => seq("import", field("packageName", $.Name), ".", "*", ";"),

    ExtendsClause: ($) => seq("extends", field("typeSpecifier", $.TypeSpecifier), ";"),

    ComponentClause: ($) =>
      seq(
        field("typeSpecifier", $.TypeSpecifier),
        commaSep1(field("componentDeclaration", $.ComponentDeclaration)),
        ";",
      ),

    ComponentDeclaration: ($) => seq(field("declaration", $.Declaration)),

    Declaration: ($) => seq(field("identifier", $.IDENT)),

    EquationSection: ($) => seq("equation", repeat(field("equation", $._Equation))),

    _Equation: ($) => choice($.SimpleEquation),

    SimpleEquation: ($) =>
      seq(field("expression1", $._SimpleExpression), "=", field("expression2", $._Expression), ";"),

    _Expression: ($) => choice($._SimpleExpression),

    _SimpleExpression: ($) => choice($._PrimaryExpression),

    _PrimaryExpression: ($) => choice($._Literal, $.ComponentReference),

    _Literal: ($) => choice($._UnsignedNumberLiteral),

    _UnsignedNumberLiteral: ($) => choice($.UNSIGNED_INTEGER, $.UNSIGNED_REAL),

    TypeSpecifier: ($) => seq(optional(field("global", ".")), field("name", $.Name)),

    Name: ($) => commaSep1(field("component", $.IDENT), "."),

    ComponentReference: ($) =>
      seq(optional(field("global", ".")), commaSep1(field("component", $.ComponentReferenceComponent), ".")),

    ComponentReferenceComponent: ($) => seq(field("identifier", $.IDENT)),

    IDENT: ($) =>
      token(
        choice(
          seq(/[_a-zA-Z]/, repeat(choice(/[0-9]/, /[_a-zA-Z]/))),
          seq(
            "'",
            repeat(
              choice(
                /[_a-zA-Z]/,
                /[0-9]/,
                "!",
                "#",
                "$",
                "%",
                "&",
                "(",
                ")",
                "*",
                "+",
                ",",
                "-",
                ".",
                "/",
                ":",
                ";",
                "<",
                ">",
                "=",
                "?",
                "@",
                "[",
                "]",
                "^",
                "{",
                "}",
                "|",
                "~",
                " ",
                '"',
                seq("\\", choice("'", '"', "?", "\\", "a", "b", "f", "n", "r", "t", "v")),
              ),
            ),
            "'",
          ),
        ),
      ),

    STRING: ($) =>
      token(
        seq(
          '"',
          repeat(choice(/[^"\\]/, seq("\\", choice("'", '"', "?", "\\", "a", "b", "f", "n", "r", "t", "v")))),
          '"',
        ),
      ),

    UNSIGNED_INTEGER: ($) => /[0-9]+/,

    UNSIGNED_REAL: ($) =>
      token(
        choice(
          seq(/[0-9]+/, ".", optional(/[0-9]+/)),
          seq(/[0-9]+/, optional(seq(".", optional(/[0-9]+/))), choice("e", "E"), optional(choice("+", "-")), /[0-9]+/),
          seq(".", /[0-9]+/, optional(seq(choice("e", "E"), optional(choice("+", "-")), /[0-9]+/))),
        ),
      ),

    // https://stackoverflow.com/questions/13014947/regex-to-match-a-c-style-multiline-comment/36328890#36328890
    BLOCK_COMMENT: ($) => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

    LINE_COMMENT: ($n) => token(seq("//", /[^\r\n]*/)),

    BOM: ($) => /\u00EF\u00BB\u00BF/,
  },
});

/**
 * Rule template to match zero or more rules delimited by a separator
 *
 * @param {RuleOrLiteral} rule
 * @param {RuleOrLiteral} sep
 * @return {ChoiceRule}
 */
function commaSep(rule, sep = ",") {
  return optional(commaSep1(rule, sep));
}

/**
 * Rule template to match one or more rules delimited by a separator
 *
 * @param {RuleOrLiteral} rule
 * @param {RuleOrLiteral} sep
 * @return {SeqRule}
 */
function commaSep1(rule, sep = ",") {
  return seq(rule, repeat(seq(sep, rule)));
}
