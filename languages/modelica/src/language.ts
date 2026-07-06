import { choice, field, language, optional, prec, repeat, semanticToken, seq, token } from "@modelscript/language";

const PRECEDENCE = {
  if_exp: 1,
  range: 2,
  or: 3,
  and: 4,
  not: 5,
  relational: 6,
  add: 7,
  unary: 8,
  mul: 9,
  exp: 10,
};

export const modelicaLanguage = language({
  name: "Modelica",

  word: "identifier",

  inline: ["element_list", "component_list", "statement_or_procedure", "composition"],

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    multiWordKeywords: ["end if", "end for", "end while", "end when"],
  },

  reserved: {
    keyword: () =>
      [
        "algorithm",
        "and",
        "annotation",
        "block",
        "break",
        "class",
        "connect",
        "connector",
        "constant",
        "constrainedby",
        "der",
        "discrete",
        "each",
        "else",
        "elseif",
        "elsewhen",
        "encapsulated",
        "end",
        "enumeration",
        "equation",
        "expandable",
        "extends",
        "external",
        "false",
        "final",
        "flow",
        "for",
        "function",
        "if",
        "import",
        "impure",
        "in",
        "initial",
        "inner",
        "input",
        "loop",
        "model",
        "not",
        "operator",
        "or",
        "outer",
        "output",
        "package",
        "parameter",
        "partial",
        "protected",
        "public",
        "pure",
        "record",
        "redeclare",
        "replaceable",
        "return",
        "stream",
        "then",
        "time",
        "true",
        "type",
        "when",
        "while",
        "within",
      ].map((kw) => token(kw)),
  },

  lsp: {
    fileExtension: ".mo",
    folding: [
      "class_definition",
      "equation_section",
      "algorithm_section",
      "if_equation",
      "if_statement",
      "for_equation",
      "for_statement",
      "while_statement",
      "when_equation",
      "when_statement",
    ],
    outline: [
      "class_definition",
      "component_declaration",
      "short_class_specifier",
      "long_class_specifier",
      "der_class_specifier",
    ],
  },

  rules: {
    program: ($) => $.stored_definition,

    // A.2.1 Stored Definition – Within
    stored_definition: ($) => seq(optional($.within_clause), repeat(seq(optional("final"), $.class_definition, ";"))),
    within_clause: ($) => seq("within", optional($.name), ";"),

    // A.2.2 Class Definition
    class_definition: ($) => seq(optional("encapsulated"), $.class_prefixes, $.class_specifier),

    class_prefixes: () =>
      seq(
        optional("partial"),
        choice(
          "class",
          "model",
          seq(optional("operator"), "record"),
          "block",
          seq(optional("expandable"), "connector"),
          "type",
          "package",
          seq(optional(choice("pure", "impure")), optional("operator"), "function"),
          "operator",
        ),
      ),

    class_specifier: ($) => choice($.long_class_specifier, $.short_class_specifier, $.der_class_specifier),

    long_class_specifier: ($) =>
      choice(
        seq(
          semanticToken("class", field("name", $.identifier), ["declaration"]),
          $.description_string,
          $.composition,
          "end",
          $.identifier,
        ),
        seq(
          "extends",
          semanticToken("class", field("name", $.identifier), ["declaration"]),
          optional($.class_modification),
          $.description_string,
          $.composition,
          "end",
          $.identifier,
        ),
      ),

    short_class_specifier: ($) =>
      choice(
        seq(
          semanticToken("class", field("name", $.identifier), ["declaration"]),
          "=",
          $.base_prefix,
          $.type_specifier,
          optional($.array_subscripts),
          optional($.class_modification),
          $.description,
        ),
        seq(
          semanticToken("class", field("name", $.identifier), ["declaration"]),
          "=",
          "enumeration",
          "(",
          choice(optional($.enum_list), ":"),
          ")",
          $.description,
        ),
      ),

    der_class_specifier: ($) =>
      seq(
        semanticToken("class", field("name", $.identifier), ["declaration"]),
        "=",
        "der",
        "(",
        $.type_specifier,
        ",",
        $.identifier,
        repeat(seq(",", $.identifier)),
        ")",
        $.description,
      ),

    base_prefix: () => optional(choice("input", "output")),

    enum_list: ($) => seq($.enumeration_literal, repeat(seq(",", $.enumeration_literal))),

    enumeration_literal: ($) => seq(semanticToken("enumMember", $.identifier, ["declaration"]), $.description),

    composition: ($) =>
      seq(
        $.element_list,
        repeat(
          choice(
            seq("public", $.element_list),
            seq("protected", $.element_list),
            $.equation_section,
            $.algorithm_section,
          ),
        ),
        optional(
          seq(
            "external",
            optional($.language_specification),
            optional($.external_function_call),
            optional($.annotation_clause),
            ";",
          ),
        ),
        optional(seq($.annotation_clause, ";")),
      ),

    language_specification: ($) => $.string_literal,

    external_function_call: ($) =>
      seq(optional(seq($.component_reference, "=")), $.identifier, "(", optional($.expression_list), ")"),

    element_list: ($) => repeat(seq($.element, ";")),

    element: ($) =>
      choice(
        $.import_clause,
        $.extends_clause,
        seq(
          optional("redeclare"),
          optional("final"),
          optional("inner"),
          optional("outer"),
          choice(
            $.class_definition,
            $.component_clause,
            seq(
              "replaceable",
              choice($.class_definition, $.component_clause),
              optional(seq($.constraining_clause, $.description)),
            ),
          ),
        ),
      ),

    import_clause: ($) =>
      seq(
        "import",
        choice(
          seq($.identifier, "=", $.name),
          seq($.name, optional(choice(".*", seq(".", choice("*", seq("{", $.import_list, "}")))))),
        ),
        $.description,
      ),

    import_list: ($) => seq($.identifier, repeat(seq(",", $.identifier))),

    // A.2.3 Extends
    extends_clause: ($) =>
      seq("extends", $.type_specifier, optional($.class_or_inheritance_modification), optional($.annotation_clause)),

    constraining_clause: ($) => seq("constrainedby", $.type_specifier, optional($.class_modification)),

    class_or_inheritance_modification: ($) => seq("(", optional($.argument_or_inheritance_modification_list), ")"),

    argument_or_inheritance_modification_list: ($) =>
      seq(
        choice($.argument, $.inheritance_modification),
        repeat(seq(",", choice($.argument, $.inheritance_modification))),
      ),

    inheritance_modification: ($) => seq("break", choice($.connect_equation, $.identifier)),

    // A.2.4 Component Clause
    component_clause: ($) => seq($.type_prefix, $.type_specifier, optional($.array_subscripts), $.component_list),

    type_prefix: () =>
      seq(
        optional(choice("flow", "stream")),
        optional(choice("discrete", "parameter", "constant")),
        optional(choice("input", "output")),
      ),

    component_list: ($) => seq($.component_declaration, repeat(seq(",", $.component_declaration))),

    component_declaration: ($) => seq($.declaration, optional($.condition_attribute), $.description),

    condition_attribute: ($) => seq("if", $.expression),

    declaration: ($) =>
      seq(
        semanticToken("variable", $.identifier, ["declaration"]),
        optional($.array_subscripts),
        optional($.modification),
      ),

    // A.2.5 Modification
    modification: ($) =>
      choice(
        seq($.class_modification, optional(seq("=", $.modification_expression))),
        seq("=", $.modification_expression),
      ),

    modification_expression: ($) => choice($.expression, "break"),

    class_modification: ($) => seq("(", optional($.argument_list), ")"),

    argument_list: ($) => seq($.argument, repeat(seq(",", $.argument))),

    argument: ($) => choice($.element_modification_or_replaceable, $.element_redeclaration),

    element_modification_or_replaceable: ($) =>
      seq(optional("each"), optional("final"), choice($.element_modification, $.element_replaceable)),

    element_modification: ($) => seq($.name, optional($.modification), $.description_string),

    element_redeclaration: ($) =>
      seq(
        "redeclare",
        optional("each"),
        optional("final"),
        choice($.short_class_definition, $.component_clause1, $.element_replaceable),
      ),

    element_replaceable: ($) =>
      seq("replaceable", choice($.short_class_definition, $.component_clause1), optional($.constraining_clause)),

    component_clause1: ($) => seq($.type_prefix, $.type_specifier, $.component_declaration1),

    component_declaration1: ($) => seq($.declaration, $.description),

    short_class_definition: ($) => seq($.class_prefixes, $.short_class_specifier),

    // A.2.6 Equations
    equation_section: ($) => seq(optional("initial"), "equation", repeat(seq($.some_equation, ";"))),

    algorithm_section: ($) => seq(optional("initial"), "algorithm", repeat(seq($.statement, ";"))),

    some_equation: ($) =>
      seq(
        choice($.equation_or_procedure, $.if_equation, $.for_equation, $.connect_equation, $.when_equation),
        $.description,
      ),

    // GLR parsers handle this without needing left-factoring!
    equation_or_procedure: ($) => choice($.simple_equation, $.function_call),

    simple_equation: ($) => seq($.expression, "=", $.expression),

    statement: ($) =>
      seq(
        choice(
          $.statement_or_procedure,
          seq("(", $.output_expression_list, ")", ":=", $.function_call),
          "break",
          "return",
          $.if_statement,
          $.for_statement,
          $.while_statement,
          $.when_statement,
        ),
        $.description,
      ),

    statement_or_procedure: ($) =>
      choice(
        $.function_call,
        seq($.component_reference, ":=", $.expression),
        seq("der", "(", $.component_reference, ")", ":=", $.expression),
      ),

    function_call: ($) => seq(semanticToken("function", $.component_reference), $.function_call_args),

    if_equation: ($) =>
      seq(
        "if",
        $.expression,
        "then",
        repeat(seq($.some_equation, ";")),
        repeat(seq("elseif", $.expression, "then", repeat(seq($.some_equation, ";")))),
        optional(seq("else", repeat(seq($.some_equation, ";")))),
        "end",
        "if",
      ),

    if_statement: ($) =>
      seq(
        "if",
        $.expression,
        "then",
        repeat(seq($.statement, ";")),
        repeat(seq("elseif", $.expression, "then", repeat(seq($.statement, ";")))),
        optional(seq("else", repeat(seq($.statement, ";")))),
        "end",
        "if",
      ),

    for_equation: ($) => seq("for", $.for_indices, "loop", repeat(seq($.some_equation, ";")), "end", "for"),

    for_statement: ($) => seq("for", $.for_indices, "loop", repeat(seq($.statement, ";")), "end", "for"),

    for_indices: ($) => seq($.for_index, repeat(seq(",", $.for_index))),

    for_index: ($) => seq($.identifier, optional(seq("in", $.expression))),

    while_statement: ($) => seq("while", $.expression, "loop", repeat(seq($.statement, ";")), "end", "while"),

    when_equation: ($) =>
      seq(
        "when",
        $.expression,
        "then",
        repeat(seq($.some_equation, ";")),
        repeat(seq("elsewhen", $.expression, "then", repeat(seq($.some_equation, ";")))),
        "end",
        "when",
      ),

    when_statement: ($) =>
      seq(
        "when",
        $.expression,
        "then",
        repeat(seq($.statement, ";")),
        repeat(seq("elsewhen", $.expression, "then", repeat(seq($.statement, ";")))),
        "end",
        "when",
      ),

    connect_equation: ($) => seq("connect", "(", $.component_reference, ",", $.component_reference, ")"),

    // A.2.7 Expressions (Flattened for AST efficiency)
    expression: ($) =>
      choice(
        $.primary,

        // if expression
        prec(
          PRECEDENCE.if_exp,
          seq(
            "if",
            $.expression,
            "then",
            $.expression,
            repeat(seq("elseif", $.expression, "then", $.expression)),
            "else",
            $.expression,
          ),
        ),

        // range (:)
        prec(PRECEDENCE.range, seq($.expression, ":", $.expression, optional(seq(":", $.expression)))),

        // logical or
        prec.left(PRECEDENCE.or, seq(field("left", $.expression), "or", field("right", $.expression))),

        // logical and
        prec.left(PRECEDENCE.and, seq(field("left", $.expression), "and", field("right", $.expression))),

        // logical not
        prec(PRECEDENCE.not, seq("not", field("operand", $.expression))),

        // relation
        prec.left(
          PRECEDENCE.relational,
          seq(field("left", $.expression), choice("<", "<=", ">", ">=", "==", "<>"), field("right", $.expression)),
        ),

        // add/sub
        prec.left(
          PRECEDENCE.add,
          seq(field("left", $.expression), choice("+", "-", ".+", ".-"), field("right", $.expression)),
        ),

        // unary add/sub
        prec(PRECEDENCE.unary, seq(choice("+", "-", ".+", ".-"), field("operand", $.expression))),

        // mul/div
        prec.left(
          PRECEDENCE.mul,
          seq(field("left", $.expression), choice("*", "/", ".*", "./"), field("right", $.expression)),
        ),

        // exp
        prec.right(PRECEDENCE.exp, seq(field("left", $.expression), choice("^", ".^"), field("right", $.expression))),
      ),

    primary: ($) =>
      choice(
        $.unsigned_number,
        $.string_literal,
        "false",
        "true",
        "time",
        seq(choice($.component_reference, "der", "initial", "pure"), $.function_call_args),
        $.component_reference,
        seq("(", $.output_expression_list, ")", optional(choice($.array_subscripts, seq(".", $.identifier)))),
        seq("[", $.expression_list, repeat(seq(";", $.expression_list)), "]"),
        seq("{", $.array_arguments, "}"),
        "end",
      ),

    unsigned_number: ($) => seq(choice($.unsigned_integer, $.unsigned_real), optional($.unit_of_measurement)),

    unit_of_measurement: ($) => $.identifier, // Maps to Q-IDENT, handled in tokenizer

    type_specifier: ($) => semanticToken("type", seq(optional("."), $.name)),

    name: ($) => seq($.identifier, repeat(seq(".", $.identifier))),

    component_reference: ($) =>
      seq(
        optional("."),
        semanticToken("variable", $.identifier),
        optional($.array_subscripts),
        repeat(seq(".", semanticToken("variable", $.identifier), optional($.array_subscripts))),
      ),

    result_reference: ($) =>
      choice(
        $.component_reference,
        "time",
        seq("der", "(", choice($.component_reference, "time"), optional(seq(",", $.unsigned_integer)), ")"),
      ),

    function_call_args: ($) => seq("(", optional($.function_arguments), ")"),

    function_arguments: ($) =>
      choice(
        seq($.expression, optional(choice(seq(",", $.function_arguments_non_first), seq("for", $.for_indices)))),
        seq($.function_partial_application, optional(seq(",", $.function_arguments_non_first))),
        $.named_arguments,
      ),

    function_arguments_non_first: ($) =>
      choice(seq($.function_argument, optional(seq(",", $.function_arguments_non_first))), $.named_arguments),

    array_arguments: ($) =>
      seq($.expression, optional(choice(seq(",", $.array_arguments_non_first), seq("for", $.for_indices)))),

    array_arguments_non_first: ($) => seq($.expression, optional(seq(",", $.array_arguments_non_first))),

    named_arguments: ($) => seq($.named_argument, optional(seq(",", $.named_arguments))),

    named_argument: ($) => seq($.identifier, "=", $.function_argument),

    function_argument: ($) => choice($.function_partial_application, $.expression),

    function_partial_application: ($) => seq("function", $.type_specifier, "(", optional($.named_arguments), ")"),

    output_expression_list: ($) => seq(optional($.expression), repeat(seq(",", optional($.expression)))),

    expression_list: ($) => seq($.expression, repeat(seq(",", $.expression))),

    array_subscripts: ($) => seq("[", $.subscript, repeat(seq(",", $.subscript)), "]"),

    subscript: ($) => choice(":", $.expression),

    description: ($) => seq($.description_string, optional($.annotation_clause)),

    description_string: ($) => optional(seq($.string_literal, repeat(seq("+", $.string_literal)))),

    annotation_clause: ($) => seq("annotation", $.class_modification),

    // Tokens
    identifier: () => token(/([a-zA-Z_]\w*|'([^'\\]|\\.)*')/),
    string_literal: () => semanticToken("string", token(/"([^"\\]|\\.)*"/)),
    unsigned_integer: () => semanticToken("number", token(/\d+/)),
    unsigned_real: () =>
      semanticToken("number", token(/\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+/)),
  },

  extras: () => [/\s+/, /\/\/.*/],
});
