/**
 * @file Modelica grammar for tree-sitter
 * @author Mohamad Omar Nachawati <mnachawa@gmail.com>
 * @license AGPL-3.0-or-later
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  LOGICAL_OR: 4,
  LOGICAL_AND: 5,
  UNARY_NEGATION: 6,
  RELATIONAL: 7,
  ADDITIVE: 8,
  ADDITIVE_UNARY: 9,
  MULTIPLICATIVE: 10,
  EXPONENTIATION: 11,
};

module.exports = grammar({
  name: "modelica",
  extras: ($) => [/\s/, $.BLOCK_COMMENT, $.LINE_COMMENT],
  conflicts: ($) => [[$.Name]],
  word: ($) => $.IDENT,
  rules: {
    // A.2.1 Stored Definition – Within

    StoredDefinition: ($) =>
      seq(
        optional($.BOM),
        optional(field("withinDirective", $.WithinDirective)),
        repeat(field("classDefinition", $.ClassDefinition)),
      ),

    WithinDirective: ($) => seq("within", optional(field("packageName", $.Name)), ";"),

    // A.2.2 Class Definition

    ClassDefinition: ($) => seq(field("classKind", $.ClassKind), field("classSpecifier", $._ClassSpecifier), ";"),

    ClassKind: ($) =>
      choice(
        field("block", "block"),
        field("class", "class"),
        field("model", "model"),
        field("package", "package"),
        field("record", "record"),
        field("type", "type"),
      ),

    _ClassSpecifier: ($) => choice($.LongClassSpecifier, $.ShortClassSpecifier),

    LongClassSpecifier: ($) =>
      seq(
        choice(field("identifier", $.IDENT)),
        optional(field("description", $.Description)),
        optional(field("section", $.InitialElementSection)),
        repeat(field("section", choice($.ElementSection, $.EquationSection))),
        optional(seq(field("annotationClause", $.AnnotationClause), ";")),
        "end",
        field("endIdentifier", $.IDENT),
      ),

    ShortClassSpecifier: ($) =>
      seq(
        field("identifier", $.IDENT),
        "=",
        choice(
          seq(
            field("typeSpecifier", $.TypeSpecifier),
            optional(field("arraySubscripts", $.ArraySubscripts)),
            optional(field("classModification", $.ClassModification)),
          ),
          seq(
            field("enumeration", "enumeration"),
            "(",
            optional(
              choice(
                commaSep1(field("enumerationLiteral", $.EnumerationLiteral)),
                field("unspecifiedEnumeration", ":"),
              ),
            ),
            ")",
          ),
        ),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    EnumerationLiteral: ($) =>
      seq(
        field("identifier", $.IDENT),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    InitialElementSection: ($) => repeat1(field("element", $._Element)),

    ElementSection: ($) =>
      seq(choice(field("protected", "protected"), field("public", "public")), repeat(field("element", $._Element))),

    _Element: ($) => choice($.ClassDefinition, $.ComponentClause, $.ExtendsClause, $._ImportClause),

    _ImportClause: ($) => choice($.SimpleImportClause, $.CompoundImportClause, $.UnqualifiedImportClause),

    SimpleImportClause: ($) =>
      seq(
        "import",
        optional(seq(field("shortName", $.IDENT), "=")),
        field("packageName", $.Name),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    CompoundImportClause: ($) =>
      seq(
        "import",
        field("packageName", $.Name),
        ".",
        "{",
        commaSep1(field("importName", $.IDENT)),
        "}",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    UnqualifiedImportClause: ($) =>
      seq(
        "import",
        field("packageName", $.Name),
        ".",
        "*",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    // A.2.3 Extends

    ExtendsClause: ($) =>
      seq(
        "extends",
        field("typeSpecifier", $.TypeSpecifier),
        optional(field("classOrInheritanceModification", $.ClassOrInheritanceModification)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ClassOrInheritanceModification: ($) =>
      seq(
        "(",
        commaSep(
          field(
            "modificationArgumentOrInheritanceModification",
            choice($._ModificationArgument, $.InheritanceModification),
          ),
        ),
        ")",
      ),

    InheritanceModification: ($) => seq("break", choice(field("identifier", $.IDENT))),

    // A.2.4 Component Clause

    ComponentClause: ($) =>
      seq(
        field("typeSpecifier", $.TypeSpecifier),
        optional(field("arraySubscripts", $.ArraySubscripts)),
        commaSep1(field("componentDeclaration", $.ComponentDeclaration)),
        ";",
      ),

    ComponentDeclaration: ($) =>
      seq(
        field("declaration", $.Declaration),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    Declaration: ($) =>
      seq(
        field("identifier", $.IDENT),
        optional(field("arraySubscripts", $.ArraySubscripts)),
        optional(field("modification", $.Modification)),
      ),

    // A.2.5 Modification

    Modification: ($) =>
      choice(
        seq(
          field("classModification", $.ClassModification),
          optional(seq("=", field("modificationExpression", $.ModificationExpression))),
        ),
        seq("=", field("modificationExpression", $.ModificationExpression)),
      ),

    ModificationExpression: ($) => choice(field("expression", $._Expression)),

    ClassModification: ($) => seq("(", commaSep(field("modificationArgument", $._ModificationArgument)), ")"),

    _ModificationArgument: ($) => choice($.ElementModification),

    ElementModification: ($) =>
      seq(
        optional(field("each", "each")),
        field("name", $.Name),
        optional(field("modification", $.Modification)),
        optional(field("description", $.Description)),
      ),

    // A.2.6 Equations

    EquationSection: ($) => seq("equation", repeat(field("equation", $._Equation))),

    _Equation: ($) => choice($.SimpleEquation),

    SimpleEquation: ($) =>
      seq(
        field("expression1", $._SimpleExpression),
        "=",
        field("expression2", $._Expression),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    // A.2.7 Expressions

    _Expression: ($) => choice($._SimpleExpression),

    _SimpleExpression: ($) => choice($.UnaryExpression, $.BinaryExpression, $._PrimaryExpression),

    UnaryExpression: ($) =>
      choice(
        prec(PREC.UNARY_NEGATION, unaryExp("not", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp("+", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp("-", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp(".+", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp(".-", $._SimpleExpression)),
      ),

    BinaryExpression: ($) =>
      choice(
        prec.left(PREC.LOGICAL_OR, binaryExp("or", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.LOGICAL_AND, binaryExp("and", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("<", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("<=", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp(">", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp(">=", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("==", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("<>", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp("+", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp("-", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp(".+", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp(".-", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp("*", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp("/", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp(".*", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp("./", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.EXPONENTIATION, binaryExp("^", $._PrimaryExpression, $._PrimaryExpression)),
        prec.right(PREC.EXPONENTIATION, binaryExp(".^", $._PrimaryExpression, $._PrimaryExpression)),
      ),

    _PrimaryExpression: ($) =>
      choice($._Literal, $.ComponentReference, $.ParenthesizedExpression, $.ArrayConcatenation, $.ArrayConstructor),

    _Literal: ($) => choice($._UnsignedNumberLiteral, $.BOOLEAN, $.STRING),

    _UnsignedNumberLiteral: ($) => choice($.UNSIGNED_INTEGER, $.UNSIGNED_REAL),

    BOOLEAN: ($) => choice("false", "true"),

    TypeSpecifier: ($) => seq(optional(field("global", ".")), field("name", $.Name)),

    Name: ($) => commaSep1(field("component", $.IDENT), "."),

    ComponentReference: ($) =>
      seq(optional(field("global", ".")), commaSep1(field("component", $.ComponentReferenceComponent), ".")),

    ComponentReferenceComponent: ($) =>
      seq(field("identifier", $.IDENT), optional(field("arraySubscripts", $.ArraySubscripts))),

    ArrayConcatenation: ($) => seq("[", commaSep1(field("expressionList", $.ExpressionList), ";"), "]"),

    ArrayConstructor: ($) => seq("{", optional(choice(field("expressionList", $.ExpressionList))), "}"),

    ParenthesizedExpression: ($) => seq("(", commaSep(optional(field("expression", $._Expression)), ","), ")"),

    ExpressionList: ($) => commaSep1(field("expression", $._Expression)),

    ArraySubscripts: ($) => seq("[", commaSep1(field("subscript", $.Subscript)), "]"),

    Subscript: ($) => choice(field("flexible", ":"), field("expression", $._Expression)),

    Description: ($) => commaSep1(field("descriptionString", $.STRING), "+"),

    AnnotationClause: ($) => seq("annotation", field("classModification", $.ClassModification)),

    // A.1 Lexical conventions

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

/**
 * Rule template to match unary expressions
 *
 * @param {RuleOrLiteral} operator
 * @param {RuleOrLiteral} operand
 * @return {SeqRule}
 */
function unaryExp(operator, operand) {
  return seq(field("operator", operator), field("operand", operand));
}

/**
 * Rule template to match binary expressions
 *
 * @param {RuleOrLiteral} operator
 * @param {RuleOrLiteral} operand1
 * @param {RuleOrLiteral} operand2
 * @return {SeqRule}
 */

function binaryExp(operator, operand1, operand2) {
  return seq(field("operand1", operand1), field("operator", operator), field("operand2", operand2));
}
