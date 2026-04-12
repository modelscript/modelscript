module.exports = grammar({
  name: "modelica",
  extras: ($) => [/\s/, $.BLOCK_COMMENT, $.LINE_COMMENT],
  conflicts: ($) => [
    [$.Name],
    [$.EquationSection],
    [$.ElseIfEquationClause],
    [$.ElseWhenEquationClause],
    [$.ElementSection],
    [$.InitialElementSection],
    [$.AlgorithmSection],
    [$.Name, $.ComponentReferencePart],
  ],
  word: ($) => $.IDENT,
  rules: {
    StoredDefinition: ($) =>
      seq(
        optional($.BOM),
        optional(field("withinDirective", $.WithinDirective)),
        repeat(
          choice(
            field("classDefinition", $.ClassDefinition),
            field("componentClause", $.ComponentClause),
            field("statement", $._Statement),
          ),
        ),
      ),
    WithinDirective: ($) => seq("within", optional(field("packageName", $.Name)), ";"),
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
          field("optimization", "optimization"),
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
                seq(
                  field("enumerationLiteral", $.EnumerationLiteral),
                  repeat(seq(",", field("enumerationLiteral", $.EnumerationLiteral))),
                ),
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
        seq(field("input", $.IDENT), repeat(seq(",", field("input", $.IDENT)))),
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
    InitialElementSection: ($) => seq(repeat1(field("element", $._Element))),
    ElementSection: ($) =>
      seq(field("visibility", choice("protected", "public")), repeat(field("element", $._Element))),
    _Element: ($) =>
      choice($.ClassDefinition, $.ComponentClause, $.ExtendsClause, $._ImportClause, $.ElementAnnotation),
    ElementAnnotation: ($) => prec(-1, seq($.AnnotationClause, ";")),
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
        seq(field("importName", $.IDENT), repeat(seq(",", field("importName", $.IDENT)))),
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
        optional(
          seq(
            field(
              "modificationArgumentOrInheritanceModification",
              choice($._ModificationArgument, $.InheritanceModification),
            ),
            repeat(
              seq(
                ",",
                field(
                  "modificationArgumentOrInheritanceModification",
                  choice($._ModificationArgument, $.InheritanceModification),
                ),
              ),
            ),
          ),
        ),
        ")",
      ),
    InheritanceModification: ($) =>
      seq("break", choice(field("connectEquation", $.ConnectEquation), field("identifier", $.IDENT))),
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
        seq(
          field("componentDeclaration", $.ComponentDeclaration),
          repeat(seq(",", field("componentDeclaration", $.ComponentDeclaration))),
        ),
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
    ConditionAttribute: ($) => seq("if", field("condition", $._Expression)),
    Declaration: ($) =>
      seq(
        field("identifier", $.IDENT),
        optional(field("arraySubscripts", $.ArraySubscripts)),
        optional(field("modification", $.Modification)),
      ),
    Modification: ($) =>
      choice(
        seq(
          field("classModification", $.ClassModification),
          optional(seq("=", field("modificationExpression", $.ModificationExpression))),
        ),
        seq("=", field("modificationExpression", $.ModificationExpression)),
      ),
    ModificationExpression: ($) => choice(field("expression", $._Expression), field("break", "break")),
    ClassModification: ($) =>
      seq(
        "(",
        optional(
          seq(
            field("modificationArgument", $._ModificationArgument),
            repeat(seq(",", field("modificationArgument", $._ModificationArgument))),
          ),
        ),
        ")",
      ),
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
    EquationSection: ($) =>
      seq(
        optional(field("initial", "initial")),
        "equation",
        repeat(field("equation", $._Equation)),
        optional(seq(field("annotationClause", $.AnnotationClause), ";")),
      ),
    AlgorithmSection: ($) =>
      seq(
        optional(field("initial", "initial")),
        "algorithm",
        repeat(field("statement", $._Statement)),
        optional(seq(field("annotationClause", $.AnnotationClause), ";")),
      ),
    _Equation: ($) =>
      choice($.SimpleEquation, $.SpecialEquation, $.IfEquation, $.ForEquation, $.ConnectEquation, $.WhenEquation),
    _Statement: ($) =>
      choice(
        $.SimpleAssignmentStatement,
        $.ProcedureCallStatement,
        $.ComplexAssignmentStatement,
        $.BreakStatement,
        $.ReturnStatement,
        $.IfStatement,
        $.ForStatement,
        $.WhileStatement,
        $.WhenStatement,
      ),
    SimpleAssignmentStatement: ($) =>
      seq(
        field("target", $.ComponentReference),
        choice(":=", "="),
        field("source", $._Expression),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),
    ProcedureCallStatement: ($) =>
      seq(
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),
    ComplexAssignmentStatement: ($) =>
      seq(
        field("outputExpressionList", $.OutputExpressionList),
        choice(":=", "="),
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
    SpecialEquation: ($) =>
      seq(
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
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
        seq(field("forIndex", $.ForIndex), repeat(seq(",", field("forIndex", $.ForIndex)))),
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
        seq(field("forIndex", $.ForIndex), repeat(seq(",", field("forIndex", $.ForIndex)))),
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
        repeat(field("elseWhenEquationClause", $.ElseWhenEquationClause)),
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
        repeat(field("elseWhenStatementClause", $.ElseWhenStatementClause)),
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
    _Expression: ($) => choice($.IfElseExpression, $.RangeExpression, $._SimpleExpression),
    IfElseExpression: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        field("expression", $._Expression),
        repeat(field("elseIfExpressionClause", $.ElseIfExpressionClause)),
        "else",
        field("elseExpression", $._Expression),
      ),
    ElseIfExpressionClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", field("expression", $._Expression)),
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
        prec(6, seq(field("operator", "not"), field("operand", $._SimpleExpression))),
        prec(9, seq(field("operator", "+"), field("operand", $._SimpleExpression))),
        prec(9, seq(field("operator", "-"), field("operand", $._SimpleExpression))),
        prec(9, seq(field("operator", ".+"), field("operand", $._SimpleExpression))),
        prec(9, seq(field("operator", ".-"), field("operand", $._SimpleExpression))),
      ),
    BinaryExpression: ($) =>
      choice(
        prec.left(
          4,
          seq(field("operand1", $._SimpleExpression), field("operator", "or"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          5,
          seq(field("operand1", $._SimpleExpression), field("operator", "and"), field("operand2", $._SimpleExpression)),
        ),
        prec.right(
          7,
          seq(field("operand1", $._SimpleExpression), field("operator", "<"), field("operand2", $._SimpleExpression)),
        ),
        prec.right(
          7,
          seq(field("operand1", $._SimpleExpression), field("operator", "<="), field("operand2", $._SimpleExpression)),
        ),
        prec.right(
          7,
          seq(field("operand1", $._SimpleExpression), field("operator", ">"), field("operand2", $._SimpleExpression)),
        ),
        prec.right(
          7,
          seq(field("operand1", $._SimpleExpression), field("operator", ">="), field("operand2", $._SimpleExpression)),
        ),
        prec.right(
          7,
          seq(field("operand1", $._SimpleExpression), field("operator", "=="), field("operand2", $._SimpleExpression)),
        ),
        prec.right(
          7,
          seq(field("operand1", $._SimpleExpression), field("operator", "<>"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          8,
          seq(field("operand1", $._SimpleExpression), field("operator", "+"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          8,
          seq(field("operand1", $._SimpleExpression), field("operator", "-"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          8,
          seq(field("operand1", $._SimpleExpression), field("operator", ".+"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          8,
          seq(field("operand1", $._SimpleExpression), field("operator", ".-"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          10,
          seq(field("operand1", $._SimpleExpression), field("operator", "*"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          10,
          seq(field("operand1", $._SimpleExpression), field("operator", "/"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          10,
          seq(field("operand1", $._SimpleExpression), field("operator", ".*"), field("operand2", $._SimpleExpression)),
        ),
        prec.left(
          10,
          seq(field("operand1", $._SimpleExpression), field("operator", "./"), field("operand2", $._SimpleExpression)),
        ),
        prec.right(
          11,
          seq(field("operand1", $._PrimaryExpression), field("operator", "^"), field("operand2", $._PrimaryExpression)),
        ),
        prec.right(
          11,
          seq(
            field("operand1", $._PrimaryExpression),
            field("operator", ".^"),
            field("operand2", $._PrimaryExpression),
          ),
        ),
      ),
    _PrimaryExpression: ($) =>
      choice(
        $._Literal,
        $.FunctionCall,
        $.ComponentReference,
        $.MemberAccessExpression,
        $.OutputExpressionList,
        $.ArrayConcatenation,
        $.ArrayConstructor,
        $.EndExpression,
      ),
    EndExpression: ($) => "end",
    _Literal: ($) => choice($.UNSIGNED_INTEGER, $.UNSIGNED_REAL, $.BOOLEAN, $.STRING),
    TypeSpecifier: ($) => seq(optional(field("global", ".")), field("name", $.Name)),
    Name: ($) => seq(field("part", $.IDENT), repeat(seq(".", field("part", $.IDENT)))),
    ComponentReference: ($) =>
      seq(
        optional(field("global", ".")),
        seq(field("part", $.ComponentReferencePart), repeat(seq(".", field("part", $.ComponentReferencePart)))),
      ),
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
              seq(field("argument", $.FunctionArgument), repeat(seq(",", field("argument", $.FunctionArgument)))),
              optional(
                seq(
                  ",",
                  seq(
                    field("namedArgument", $.NamedArgument),
                    repeat(seq(",", field("namedArgument", $.NamedArgument))),
                  ),
                ),
              ),
            ),
            seq(field("namedArgument", $.NamedArgument), repeat(seq(",", field("namedArgument", $.NamedArgument)))),
          ),
        ),
        ")",
      ),
    ArrayConcatenation: ($) =>
      seq(
        "[",
        seq(field("expressionList", $.ExpressionList), repeat(seq(";", field("expressionList", $.ExpressionList)))),
        "]",
      ),
    ArrayConstructor: ($) =>
      seq(
        "{",
        optional(
          choice(field("comprehensionClause", $.ComprehensionClause), field("expressionList", $.ExpressionList)),
        ),
        "}",
      ),
    ComprehensionClause: ($) =>
      seq(
        field("expression", $._Expression),
        "for",
        seq(field("forIndex", $.ForIndex), repeat(seq(",", field("forIndex", $.ForIndex)))),
      ),
    NamedArgument: ($) => seq(field("identifier", $.IDENT), "=", field("argument", $.FunctionArgument)),
    FunctionArgument: ($) =>
      choice(field("expression", $._Expression), field("functionPartialApplication", $.FunctionPartialApplication)),
    FunctionPartialApplication: ($) =>
      seq(
        "function",
        field("typeSpecifier", $.TypeSpecifier),
        "(",
        optional(
          seq(field("namedArgument", $.NamedArgument), repeat(seq(",", field("namedArgument", $.NamedArgument)))),
        ),
        ")",
      ),
    MemberAccessExpression: ($) =>
      seq(
        field("outputExpressionList", $.OutputExpressionList),
        choice(field("arraySubscripts", $.ArraySubscripts), seq(".", field("identifier", $.IDENT))),
      ),
    OutputExpressionList: ($) =>
      seq(
        "(",
        optional(
          seq(optional(field("output", $._Expression)), repeat(seq(",", optional(field("output", $._Expression))))),
        ),
        ")",
      ),
    ExpressionList: ($) =>
      seq(field("expression", $._Expression), repeat(seq(",", field("expression", $._Expression)))),
    ArraySubscripts: ($) =>
      seq("[", seq(field("subscript", $.Subscript), repeat(seq(",", field("subscript", $.Subscript)))), "]"),
    Subscript: ($) => choice(field("flexible", ":"), field("expression", $._Expression)),
    Description: ($) =>
      seq(field("descriptionString", $.STRING), repeat(seq("+", field("descriptionString", $.STRING)))),
    AnnotationClause: ($) => seq("annotation", field("classModification", $.ClassModification)),
    BOOLEAN: ($) => choice("false", "true"),
    IDENT: ($) =>
      token(
        choice(
          seq(
            /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
            repeat(
              choice(
                /[0-9]/,
                /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
              ),
            ),
          ),
          seq(
            "'",
            repeat(
              choice(
                /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
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
    BLOCK_COMMENT: ($) => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
    LINE_COMMENT: ($) => token(seq("//", /[^\r\n]*/)),
    BOM: ($) => /\u00EF\u00BB\u00BF/,
  },
});
