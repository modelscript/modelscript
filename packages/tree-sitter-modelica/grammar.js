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
  conflicts: ($) => [
    [$.Name],
    [$.EquationSection],
    [$._PrimaryExpression, $.FunctionCall],
    [$.ComponentReference],
    [$.ParenthesizedExpression, $.FieldExpression],
    [$.ElseIfEquationClause],
    [$.ElseWhenEquationClause],
  ],
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

    ClassDefinition: ($) =>
      seq(
        optional(field("redeclare", "redeclare")),
        optional(field("final", "final")),
        optional(field("inner", "inner")),
        optional(field("outer", "outer")),
        optional(field("replaceable", "replaceable")),
        optional(field("encapsulated", "encapsulated")),
        field("classPrefixes", $.ClassPrefixes),
        field("classSpecifier", $._ClassSpecifier),
        optional(field("constrainingClause", $.ConstrainingClause)),
        ";",
      ),

    ClassPrefixes: ($) =>
      seq(
        optional(field("partial", "partial")),
        choice(
          field("class", "class"),
          field("model", "model"),
          seq(optional(field("operator", "operator")), field("record", "record")),
          field("block", "block"),
          seq(optional(field("expandable", "expandable")), field("connector", "connector")),
          field("type", "type"),
          field("package", "package"),
          seq(
            optional(field("purity", choice("pure", "impure"))),
            optional(field("operator", "operator")),
            field("function", "function"),
          ),
          field("operator", "operator"),
        ),
      ),

    _ClassSpecifier: ($) => choice($.LongClassSpecifier, $.ShortClassSpecifier, $.DerClassSpecifier),

    LongClassSpecifier: ($) =>
      seq(
        optional(field("extends", "extends")),
        field("identifier", $.IDENT),
        optional(field("classModification", $.ClassModification)),
        optional(field("description", $.Description)),
        optional(field("section", $.InitialElementSection)),
        repeat(field("section", choice($.ElementSection, $.EquationSection, $.AlgorithmSection))),
        optional(field("externalFunctionClause", $.ExternalFunctionClause)),
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
            optional(field("causality", choice("input", "output"))),
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

    DerClassSpecifier: ($) =>
      seq(
        field("identifier", $.IDENT),
        "=",
        "der",
        "(",
        field("typeSpecifier", $.TypeSpecifier),
        ",",
        commaSep1(field("input", $.IDENT)),
        ")",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    EnumerationLiteral: ($) =>
      seq(
        field("identifier", $.IDENT),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    ExternalFunctionClause: ($) =>
      seq(
        "external",
        optional(field("languageSpecification", $.LanguageSpecification)),
        optional(field("externalFunctionCall", $.ExternalFunctionCall)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    LanguageSpecification: ($) => field("language", $.STRING),

    ExternalFunctionCall: ($) =>
      seq(
        optional(seq(field("output", $.ComponentReference), "=")),
        field("functionName", $.IDENT),
        "(",
        optional(field("arguments", $.ExpressionList)),
        ")",
      ),

    InitialElementSection: ($) => repeat1(field("element", $._Element)),

    ElementSection: ($) =>
      seq(field("visibility", choice("protected", "public")), repeat(field("element", $._Element))),

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

    ConstrainingClause: ($) =>
      seq(
        "constrainedby",
        field("typeSpecifier", $.TypeSpecifier),
        optional(field("classModification", $.ClassModification)),
        optional(field("description", $.Description)),
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

    InheritanceModification: ($) =>
      seq("break", choice(field("connectEquation", $.ConnectEquation), field("identifier", $.IDENT))),

    // A.2.4 Component Clause

    ComponentClause: ($) =>
      seq(
        optional(field("redeclare", "redeclare")),
        optional(field("final", "final")),
        optional(field("inner", "inner")),
        optional(field("outer", "outer")),
        optional(field("replaceable", "replaceable")),
        optional(field("flow", choice("flow", "stream"))),
        optional(field("variability", choice("discrete", "parameter", "constant"))),
        optional(field("causality", choice("input", "output"))),
        field("typeSpecifier", $.TypeSpecifier),
        optional(field("arraySubscripts", $.ArraySubscripts)),
        commaSep1(field("componentDeclaration", $.ComponentDeclaration)),
        optional(field("constrainingClause", $.ConstrainingClause)),
        ";",
      ),

    ComponentDeclaration: ($) =>
      seq(
        field("declaration", $.Declaration),
        optional(field("conditionAttribute", $.ConditionAttribute)),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    ConditionAttribute: ($) => seq("if", field("expression", $._Expression)),

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

    ModificationExpression: ($) => choice(field("expression", $._Expression), field("break", "break")),

    ClassModification: ($) => seq("(", commaSep(field("modificationArgument", $._ModificationArgument)), ")"),

    _ModificationArgument: ($) => choice($.ElementModification, $.ElementRedeclaration),

    ElementModification: ($) =>
      seq(
        optional(field("each", "each")),
        optional(field("final", "final")),
        field("name", $.Name),
        optional(field("modification", $.Modification)),
        optional(field("description", $.Description)),
      ),

    ElementRedeclaration: ($) =>
      seq(
        optional(field("redeclare", "redeclare")),
        optional(field("each", "each")),
        optional(field("final", "final")),
        optional(field("replaceable", "replaceable")),
        choice(field("classDefinition", $.ShortClassDefinition), field("componentClause", $.ComponentClause1)),
      ),

    ComponentClause1: ($) =>
      seq(
        optional(field("flow", choice("flow", "stream"))),
        optional(field("variability", choice("discrete", "parameter", "constant"))),
        optional(field("causality", choice("input", "output"))),
        field("typeSpecifier", $.TypeSpecifier),
        field("componentDeclaration", $.ComponentDeclaration1),
        optional(field("constrainingClause", $.ConstrainingClause)),
      ),

    ComponentDeclaration1: ($) =>
      seq(
        field("declaration", $.Declaration),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    ShortClassDefinition: ($) =>
      seq(
        field("classPrefixes", $.ClassPrefixes),
        field("classSpecifier", $.ShortClassSpecifier),
        optional(field("constrainingClause", $.ConstrainingClause)),
      ),

    // A.2.6 Equations

    EquationSection: ($) =>
      seq(optional(field("initial", "initial")), "equation", repeat(field("equation", $._Equation))),

    AlgorithmSection: ($) =>
      seq(optional(field("initial", "initial")), "algorithm", repeat(field("statement", $._Statement))),

    _Equation: ($) =>
      choice($.SimpleEquation, $.ProcedureEquation, $.IfEquation, $.ForEquation, $.ConnectEquation, $.WhenEquation),

    _Statement: ($) =>
      choice(
        $.AssignmentStatement,
        $.ProcedureStatement,
        $.DestructuringAssignmentStatement,
        $.BreakStatement,
        $.ReturnStatement,
        $.IfStatement,
        $.ForStatement,
        $.WhileStatement,
        $.WhenStatement,
      ),

    AssignmentStatement: ($) => seq(field("target", $.ComponentReference), ":=", field("source", $._Expression)),

    ProcedureStatement: ($) =>
      seq(
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    DestructuringAssignmentStatement: ($) =>
      seq(
        "(",
        commaSep(optional(field("expression", $._Expression)), ","),
        ")",
        ":=",
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    SimpleEquation: ($) =>
      seq(
        field("expression1", $._SimpleExpression),
        "=",
        field("expression2", $._Expression),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ProcedureEquation: ($) =>
      seq(
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    IfEquation: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        repeat(field("equation", $._Equation)),
        repeat(field("elseIfEquationClause", $.ElseIfEquationClause)),
        optional(seq("else", repeat(field("elseEquation", $._Equation)))),
        "end",
        "if",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseIfEquationClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", repeat(field("equation", $._Equation))),

    IfStatement: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        repeat(field("statement", $._Statement)),
        repeat(field("elseIfStatementClause", $.ElseIfStatementClause)),
        optional(seq("else", repeat(field("elseStatement", $._Statement)))),
        "end",
        "if",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseIfStatementClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", repeat(field("statement", $._Statement))),

    ForEquation: ($) =>
      seq(
        "for",
        commaSep1(field("forIndex", $.ForIndex)),
        "loop",
        repeat(field("equation", $._Equation)),
        "end",
        "for",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ForStatement: ($) =>
      seq(
        "for",
        commaSep1(field("forIndex", $.ForIndex)),
        "loop",
        repeat(field("statement", $._Statement)),
        "end",
        "for",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ForIndex: ($) => seq(field("identifier", $.IDENT), optional(seq("in", field("expression", $._Expression)))),

    WhileStatement: ($) =>
      seq(
        "while",
        field("condition", $._Expression),
        "loop",
        repeat(field("statement", $._Statement)),
        "end",
        "while",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    WhenEquation: ($) =>
      seq(
        "when",
        field("condition", $._Expression),
        "then",
        repeat(field("equation", $._Equation)),
        repeat(field("elseWhenClause", $.ElseWhenEquationClause)),
        "end",
        "when",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseWhenEquationClause: ($) =>
      seq("elsewhen", field("condition", $._Expression), "then", repeat(field("equation", $._Equation))),

    WhenStatement: ($) =>
      seq(
        "when",
        field("condition", $._Expression),
        "then",
        repeat(field("statement", $._Statement)),
        repeat(field("elseWhenClause", $.ElseWhenStatementClause)),
        "end",
        "when",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseWhenStatementClause: ($) =>
      seq("elsewhen", field("condition", $._Expression), "then", repeat(field("statement", $._Statement))),

    ConnectEquation: ($) =>
      seq(
        "connect",
        "(",
        field("componentReference1", $.ComponentReference),
        ",",
        field("componentReference2", $.ComponentReference),
        ")",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    BreakStatement: ($) =>
      seq(
        "break",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ReturnStatement: ($) =>
      seq(
        "return",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    // A.2.7 Expressions

    _Expression: ($) => choice($.IfElseExpression, $.RangeExpression, $._SimpleExpression),

    IfElseExpression: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        field("thenExpression", $._Expression),
        repeat(field("elseIfExpressionClause", $.ElseIfExpressionClause)),
        "else",
        field("elseExpression", $._Expression),
      ),

    ElseIfExpressionClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", field("thenExpression", $._Expression)),

    RangeExpression: ($) =>
      choice(
        seq(
          field("startExpression", $._SimpleExpression),
          ":",
          field("stepExpression", $._SimpleExpression),
          ":",
          field("stopExpression", $._SimpleExpression),
        ),
        seq(field("startExpression", $._SimpleExpression), ":", field("stopExpression", $._SimpleExpression)),
      ),

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
      choice(
        $._Literal,
        $.FunctionCall,
        $.ComponentReference,
        $.ParenthesizedExpression,
        $.IndexExpression,
        $.FieldExpression,
        $.ArrayConcatenation,
        $.ArrayConstructor,
        $.EndExpression,
      ),

    EndExpression: ($) => "end",

    _Literal: ($) => choice($.UNSIGNED_INTEGER, $.UNSIGNED_REAL, $.BOOLEAN, $.STRING),

    TypeSpecifier: ($) => seq(optional(field("global", ".")), field("name", $.Name)),

    Name: ($) => commaSep1(field("parts", $.IDENT), "."),

    ComponentReference: ($) =>
      seq(optional(field("global", ".")), commaSep1(field("parts", $.ComponentReferencePart), ".")),

    ComponentReferencePart: ($) =>
      seq(field("identifier", $.IDENT), optional(field("arraySubscripts", $.ArraySubscripts))),

    FunctionCall: ($) =>
      seq(
        field("functionReference", choice($.ComponentReference, "der", "initial", "pure")),
        field("functionCallArguments", $.FunctionCallArguments),
      ),

    FunctionCallArguments: ($) =>
      seq(
        "(",
        optional(
          choice(
            field("comprehensionClause", $.ComprehensionClause),
            seq(
              commaSep1(field("positionalArgument", $._FunctionArgument)),
              optional(seq(",", commaSep1(field("namedArgument", $.NamedArgument)))),
            ),
            commaSep1(field("namedArgument", $.NamedArgument)),
          ),
        ),
        ")",
      ),

    ArrayConcatenation: ($) => seq("[", commaSep1(field("expressionList", $.ExpressionList), ";"), "]"),

    ArrayConstructor: ($) =>
      seq(
        "{",
        optional(
          choice(field("comprehensionClause", $.ComprehensionClause), field("expressionList", $.ExpressionList)),
        ),
        "}",
      ),

    ComprehensionClause: ($) =>
      seq(field("expression", $._Expression), "for", commaSep1(field("forIndex", $.ForIndex))),

    NamedArgument: ($) => seq(field("identifier", $.IDENT), "=", field("argument", $._FunctionArgument)),

    _FunctionArgument: ($) => choice($.FunctionPartialApplication, $.ExpressionFunctionArgument),

    FunctionPartialApplication: ($) =>
      seq(
        "function",
        field("typeSpecifier", $.TypeSpecifier),
        "(",
        commaSep(field("namedArgument", $.NamedArgument)),
        ")",
      ),

    ExpressionFunctionArgument: ($) => field("expression", $._Expression),

    ParenthesizedExpression: ($) => seq("(", commaSep(optional(field("expression", $._Expression)), ","), ")"),

    IndexExpression: ($) =>
      seq(
        "(",
        commaSep(optional(field("expression", $._Expression)), ","),
        ")",
        field("arraySubscripts", $.ArraySubscripts),
      ),

    FieldExpression: ($) =>
      seq("(", commaSep(optional(field("expression", $._Expression)), ","), ")", ".", field("identifier", $.IDENT)),

    ExpressionList: ($) => commaSep1(field("expression", $._Expression)),

    ArraySubscripts: ($) => seq("[", commaSep1(field("subscript", $.Subscript)), "]"),

    Subscript: ($) => choice(field("flexible", ":"), field("expression", $._Expression)),

    Description: ($) => commaSep1(field("descriptionString", $.STRING), "+"),

    AnnotationClause: ($) => seq("annotation", field("classModification", $.ClassModification)),

    // A.1 Lexical conventions

    BOOLEAN: ($) => choice("false", "true"),

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
