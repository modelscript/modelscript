import type { CodeGraph, u16, u32 } from "@modelscript/language";
import {
  choice,
  domain,
  field,
  language,
  optional,
  prec,
  repeat,
  semanticToken,
  seq,
  tggDefaultVal,
  tggEq,
  tggFormatUri,
  tggRule,
  tggTypeMap,
  token,
} from "@modelscript/language";
import { modelicaFlattenerWasmCode } from "./flattener-wasm.js";
import { getDottedVariableType, getVariableTypeInClass } from "./lints/helpers.js";
import { allModelicaLints } from "./lints/index.js";
import { modelicaFlatteningPasses } from "./pipelines/flatten.js";

export { allModelicaLints, modelicaFlatteningPasses };

const PRECEDENCE = {
  if_exp: 1,
  range: 2,
  or: 3,
  and: 4,
  not: 9,
  relational: 6,
  add: 7,
  mul: 8,
  unary: 9,
  exp: 10,
  postfix_transpose: 11,
};

export const modelicaLanguage = language({
  name: "Modelica",

  mcp: {
    serverName: "modelica-mcp",
    serverVersion: "1.0.0",
    tools: [
      {
        name: "modelica_load",
        description: "Load Modelica libraries from file system paths.",
        category: "ast",
        inputSchema: {
          paths: { type: "array", description: "File or directory paths", required: true, items: { type: "string" } },
        },
      },
      {
        name: "modelica_parse",
        description: "Parse inline Modelica source code and return a summary of classes and components.",
        category: "ast",
        inputSchema: {
          code: { type: "string", description: "Modelica source code", required: true },
        },
      },
      {
        name: "modelica_flatten",
        description: "Flatten a Modelica class to its DAE form.",
        category: "transformation",
        inputSchema: {
          name: { type: "string", description: "Fully qualified class name", required: true },
        },
      },
      {
        name: "modelica_simulate",
        description: "Flatten and simulate a Modelica model, returning time-series results.",
        category: "simulation",
        inputSchema: {
          name: { type: "string", description: "Fully qualified class name", required: true },
          startTime: { type: "number", description: "Simulation start time", default: 0 },
          stopTime: { type: "number", description: "Simulation stop time", default: 10 },
          interval: { type: "number", description: "Output interval" },
          solver: {
            type: "string",
            description: "ODE solver",
            enum: ["rk4", "dopri5", "bdf", "auto"],
            default: "dopri5",
          },
          format: { type: "string", description: "Output format", enum: ["json", "csv"], default: "json" },
        },
      },
      {
        name: "modelica_doe",
        description: "Run a Design of Experiments on a Modelica model across parameter ranges.",
        category: "simulation",
        inputSchema: {
          name: { type: "string", description: "Fully qualified class name", required: true },
          inputs: { type: "object", description: "Parameter ranges mapping", required: true },
          outputs: { type: "array", description: "Output variable names", required: true, items: { type: "string" } },
          strategy: {
            type: "string",
            enum: ["full-factorial", "latin-hypercube", "sobol", "central-composite"],
            default: "sobol",
          },
          numSamples: { type: "number", description: "Number of samples", default: 50 },
          stopTime: { type: "number", description: "Simulation stop time", default: 10 },
        },
      },
      {
        name: "modelica_sensitivity",
        description: "Run a One-At-a-Time sensitivity analysis on a Modelica model.",
        category: "simulation",
        inputSchema: {
          name: { type: "string", description: "Fully qualified class name", required: true },
          parameters: { type: "object", description: "Parameters to perturb", required: true },
          outputs: { type: "array", description: "Output variable names", required: true, items: { type: "string" } },
          stopTime: { type: "number", description: "Simulation stop time", default: 10 },
        },
      },
      {
        name: "modelica_query",
        description: "Introspect a Modelica class definition, components, extends hierarchy, and equations.",
        category: "query",
        inputSchema: {
          name: { type: "string", description: "Fully qualified class name", required: true },
        },
      },
    ],
    resources: [
      {
        uriTemplate: "modelica://workspace/{className}/ast",
        name: "Modelica AST Resource",
        mimeType: "application/json",
        description: "Abstract Syntax Tree of a loaded Modelica class",
      },
      {
        uriTemplate: "modelica://workspace/{className}/dae",
        name: "Modelica DAE Resource",
        mimeType: "text/plain",
        description: "Flattened DAE equations of a Modelica model",
      },
    ],
    prompts: [
      {
        name: "modelica_optimize_parameters",
        description: "Optimize parameters of a Modelica model to match target dynamics",
        arguments: [
          { name: "className", description: "Modelica class to optimize", required: true },
          { name: "objective", description: "Optimization objective metric", required: true },
        ],
        template: (args: Record<string, string>) =>
          `Optimize parameters for ${args.className} targeting objective: ${args.objective}`,
      },
    ],
  },

  runtimeFiles: [{ filename: "flattener.ts", content: modelicaFlattenerWasmCode }],

  word: ($) => $.identifier,

  conflicts: ($) => [
    [$.name],
    [$.class_prefixes],
    [$.component_reference, $.identifier],
    [$.external_function_call, $.identifier],
    [$.primary, $.output_expression_list],
    [$.equation_section, $.primary],
    [$.expression],
    [$.some_equation],
    [$.if_equation],
    [$.if_statement],
    [$.when_equation],
    [$.when_statement],
    [$.for_equation],
    [$.for_statement],
  ],

  inline: ["element_list", "component_list", "statement_or_procedure"],

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
    multiWordKeywords: ["end if", "end for", "end while", "end when"],
  },

  reserved: {
    keyword: () =>
      [
        "algorithm",
        "and",
        "annotation",
        "backSample",
        "block",
        "break",
        "class",
        "Clock",
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
        "hold",
        "if",
        "import",
        "impure",
        "in",
        "initial",
        "inner",
        "input",
        "interval",
        "loop",
        "model",
        "noClock",
        "not",
        "operator",
        "or",
        "outer",
        "output",
        "package",
        "parameter",
        "partial",
        "previous",
        "protected",
        "public",
        "pure",
        "record",
        "redeclare",
        "replaceable",
        "return",
        "sample",
        "shiftSample",
        "stream",
        "subSample",
        "superSample",
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
    icons: {
      light: "./assets/icon-light.png",
      dark: "./assets/icon-dark.png",
    },
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
    outline: ["component_declaration", "short_class_specifier", "long_class_specifier", "der_class_specifier"],
  },

  symbols: {
    class_definition: { name: "name", kind: "Class", scope: true },
    component_declaration: { name: "declaration.name", kind: "Component", scope: false },
    extends_clause: { name: "type_specifier", kind: "Extends", scope: false },
    connect_equation: { name: "lhs", kind: "ConnectEquation", scope: false },
  },

  lints: allModelicaLints,

  domains: {
    dae: domain.dae({
      indexReduction: "pantelides",
      tearing: "cellier",
      dualAD: true,
      warmStart: true,
      homotopy: true,
    }),
    simulation: domain.simulation({
      solver: "cvode",
      startTime: 0,
      stopTime: 10,
      stepSize: 0.001,
      tolerance: 1e-6,
    }),
    reasoner: domain.reasoner({
      expressivity: "OWL2RL",
      datalogFixpoint: "semi-naive",
    }),
    workspace: domain.workspace({
      incrementalQueries: true,
      memoization: "salsa",
    }),
    bounds: domain.octagon(),
  },

  diagram: {
    nodes: {
      component_declaration: {
        role: "node",
        label: "name",
        shape: "rect",
        spatial: {
          schema: "modelica",
          annotationField: "description",
          originField: "origin",
          extentField: "extent",
          rotationField: "rotation",
          invertY: true,
          autoLayout: "elk",
        },
        style: {
          stroke: "#2563eb",
          fill: "#eff6ff",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
      },
      class_definition: {
        role: "group",
        label: "name",
        shape: "package",
        style: {
          stroke: "#475569",
          fill: "#f8fafc",
          strokeWidth: 1,
        },
      },
    },
    edges: {
      connect_equation: {
        source: "from",
        target: "to",
        style: {
          stroke: "#2563eb",
          strokeWidth: 2,
          router: "manhattan",
          connector: "rounded",
        },
      },
    },
  },

  pipelines: {
    flatten: {
      label: "Modelica In-DSL Physical Flattening Pipeline",
      target: "dae",
      passes: modelicaFlatteningPasses,
    },
  },

  rules: {
    program: ($) => $.stored_definition,

    // A.2.1 Stored Definition – Within
    stored_definition: ($) => seq(optional($.within_clause), repeat(seq(optional("final"), $.class_definition, ";"))),
    within_clause: ($) => seq("within", optional($.name), ";"),

    // A.2.2 Class Definition
    class_definition: ($) =>
      seq(optional("encapsulated"), $.class_prefixes, field("class_specifier", $.class_specifier)),

    class_prefixes: () =>
      seq(
        optional("partial"),
        choice(
          "class",
          "model",
          "block",
          "type",
          "package",
          seq(optional("expandable"), "connector"),
          seq(optional(choice("pure", "impure")), "function"),
          seq("operator", optional(choice("record", "function"))),
          "record",
        ),
      ),

    class_specifier: ($) => choice($.long_class_specifier, $.short_class_specifier, $.der_class_specifier),

    long_class_specifier: ($) =>
      choice(
        seq(
          semanticToken("class", field("name", $.identifier), ["declaration"]),
          field("description", $.description_string),
          field("composition", $.composition),
          "end",
          optional(semanticToken("class", field("end_name", $.identifier), ["declaration"])),
        ),
        seq(
          "extends",
          semanticToken("class", field("name", $.identifier), ["declaration"]),
          optional($.class_modification),
          field("description", $.description_string),
          field("composition", $.composition),
          "end",
          optional(semanticToken("class", field("end_name", $.identifier), ["declaration"])),
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
        optional(seq($.external_clause, ";")),
        optional(seq($.annotation_clause, ";")),
      ),

    external_clause: ($) =>
      seq(
        "external",
        optional($.language_specification),
        optional($.external_function_call),
        optional($.annotation_clause),
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
      seq(
        "extends",
        field("type_specifier", $.type_specifier),
        optional($.class_or_inheritance_modification),
        optional($.annotation_clause),
      ),

    constraining_clause: ($) => seq("constrainedby", $.type_specifier, optional($.class_modification)),

    class_or_inheritance_modification: ($) => seq("(", optional($.argument_or_inheritance_modification_list), ")"),

    argument_or_inheritance_modification_list: ($) =>
      seq(
        choice($.argument, $.inheritance_modification),
        repeat(seq(",", choice($.argument, $.inheritance_modification))),
      ),

    inheritance_modification: ($) => seq("break", choice($.connect_equation, $.identifier)),

    // A.2.4 Component Clause
    component_clause: ($) =>
      choice(
        seq(
          field("type_prefix", $.type_prefix),
          field("type_specifier", $.type_specifier),
          optional($.array_subscripts),
          $.component_list,
        ),
        seq(field("type_specifier", $.type_specifier), optional($.array_subscripts), $.component_list),
      ),

    type_prefix: () =>
      choice(
        seq(
          choice("flow", "stream"),
          optional(choice("discrete", "parameter", "constant")),
          optional(choice("input", "output")),
        ),
        seq(choice("discrete", "parameter", "constant"), optional(choice("input", "output"))),
        choice("input", "output"),
      ),

    component_list: ($) => seq($.component_declaration, repeat(seq(",", $.component_declaration))),

    component_declaration: ($) =>
      seq(field("declaration", $.declaration), optional($.condition_attribute), field("description", $.description)),

    condition_attribute: ($) => seq("if", $.expression),

    declaration: ($) =>
      seq(
        semanticToken("property", field("name", $.identifier)),
        optional(field("array_subscripts", $.array_subscripts)),
        optional(field("modification", $.modification)),
      ),

    // A.2.5 Modification
    modification: ($) =>
      choice(
        seq(
          field("class_modification", $.class_modification),
          optional(seq("=", field("modification_expression", $.modification_expression))),
        ),
        seq("=", field("modification_expression", $.modification_expression)),
      ),

    modification_expression: ($) => choice($.expression, "break"),

    class_modification: ($) => seq("(", optional($.argument_list), ")"),

    argument_list: ($) => seq($.argument, repeat(seq(",", $.argument))),

    argument: ($) => choice($.element_modification_or_replaceable, $.element_redeclaration),

    element_modification_or_replaceable: ($) =>
      seq(optional("each"), optional("final"), choice($.element_modification, $.element_replaceable)),

    element_modification: ($) =>
      seq(field("name", $.name), optional(field("modification", $.modification)), $.description_string),

    element_redeclaration: ($) =>
      seq(
        "redeclare",
        optional("each"),
        optional("final"),
        choice($.short_class_definition, $.component_clause1, $.element_replaceable),
      ),

    element_replaceable: ($) =>
      seq("replaceable", choice($.short_class_definition, $.component_clause1), optional($.constraining_clause)),

    component_clause1: ($) =>
      choice(
        seq(field("type_prefix", $.type_prefix), field("type_specifier", $.type_specifier), $.component_declaration1),
        seq(field("type_specifier", $.type_specifier), $.component_declaration1),
      ),

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

    simple_equation: ($) => seq(field("lhs", $.expression), "=", field("rhs", $.expression)),

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

    statement_or_procedure: ($) => choice($.function_call, $.assignment_statement),

    assignment_statement: ($) =>
      choice(
        seq(field("target", $.component_reference), ":=", field("value", $.expression)),
        seq("der", "(", field("target", $.component_reference), ")", ":=", field("value", $.expression)),
      ),

    function_call: ($) =>
      seq(field("name", semanticToken("function", $.component_reference)), field("args", $.function_call_args)),

    if_equation: ($) =>
      seq(
        "if",
        field("condition", $.expression),
        "then",
        field("body", repeat(seq($.some_equation, ";"))),
        repeat(
          seq(
            "elseif",
            field("elseCondition", $.expression),
            "then",
            field("elseBody", repeat(seq($.some_equation, ";"))),
          ),
        ),
        optional(seq("else", field("finalBody", repeat(seq($.some_equation, ";"))))),
        "end if",
      ),

    if_statement: ($) =>
      seq(
        "if",
        field("condition", $.expression),
        "then",
        field("body", repeat(seq($.statement, ";"))),
        repeat(
          seq("elseif", field("elseCondition", $.expression), "then", field("elseBody", repeat(seq($.statement, ";")))),
        ),
        optional(seq("else", field("finalBody", repeat(seq($.statement, ";"))))),
        "end if",
      ),

    for_equation: ($) =>
      seq("for", field("indices", $.for_indices), "loop", field("body", repeat(seq($.some_equation, ";"))), "end for"),

    for_statement: ($) =>
      seq("for", field("indices", $.for_indices), "loop", field("body", repeat(seq($.statement, ";"))), "end for"),

    for_indices: ($) => seq($.for_index, repeat(seq(",", $.for_index))),

    for_index: ($) => seq(field("variable", $.identifier), optional(seq("in", field("range", $.expression)))),

    while_statement: ($) =>
      seq("while", field("condition", $.expression), "loop", field("body", repeat(seq($.statement, ";"))), "end while"),

    when_equation: ($) =>
      seq(
        "when",
        field("condition", $.expression),
        "then",
        field("body", repeat(seq($.some_equation, ";"))),
        repeat(
          seq(
            "elsewhen",
            field("elseCondition", $.expression),
            "then",
            field("elseBody", repeat(seq($.some_equation, ";"))),
          ),
        ),
        "end when",
      ),

    when_statement: ($) =>
      seq(
        "when",
        field("condition", $.expression),
        "then",
        field("body", repeat(seq($.statement, ";"))),
        repeat(
          seq(
            "elsewhen",
            field("elseCondition", $.expression),
            "then",
            field("elseBody", repeat(seq($.statement, ";"))),
          ),
        ),
        "end when",
      ),

    connect_equation: ($) =>
      seq("connect", "(", field("lhs", $.component_reference), ",", field("rhs", $.component_reference), ")"),

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
        prec.left(PRECEDENCE.range, seq($.expression, ":", $.expression)),

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

        // postfix transpose (')
        prec(PRECEDENCE.postfix_transpose, seq(field("operand", $.primary), "'")),
      ),

    primary: ($) =>
      choice(
        $.unsigned_number,
        $.string_literal,
        "false",
        "true",
        "time",
        seq($.component_reference, $.function_call_args),
        seq("der", "(", $.expression_list, ")"),
        seq("initial", "(", ")"),
        seq("pure", "(", optional($.function_arguments), ")"),
        $.component_reference,
        seq(
          "(",
          choice($.expression, $.output_expression_list),
          ")",
          optional(choice($.array_subscripts, seq(".", $.identifier))),
        ),
        seq("[", $.expression_list, repeat(seq(";", $.expression_list)), "]"),
        seq("{", $.array_arguments, "}"),
      ),

    unsigned_number: ($) => choice($.unsigned_integer, $.unsigned_real),

    type_specifier: ($) =>
      choice(
        seq(".", semanticToken("class", $.name, ["declaration"])),
        semanticToken("class", $.name, ["declaration"]),
      ),

    name: ($) => seq($.identifier, repeat(seq(".", $.identifier))),

    component_reference: ($) =>
      choice(
        seq(
          semanticToken("property", $.identifier),
          optional($.array_subscripts),
          repeat(seq(".", semanticToken("property", $.identifier), optional($.array_subscripts))),
        ),
        seq(
          ".",
          semanticToken("property", $.identifier),
          optional($.array_subscripts),
          repeat(seq(".", semanticToken("property", $.identifier), optional($.array_subscripts))),
        ),
      ),

    result_reference: ($) =>
      choice(
        $.component_reference,
        "time",
        seq("der", "(", choice($.component_reference, "time"), optional(seq(",", $.unsigned_integer)), ")"),
      ),

    function_call_args: ($) => choice(seq("(", ")"), seq("(", $.function_arguments, ")")),

    function_arguments: ($) =>
      choice(
        $.expression_list,
        seq($.expression, "for", $.for_indices),
        seq($.function_partial_application, optional(seq(",", $.function_arguments_non_first))),
        $.named_arguments,
      ),

    function_arguments_non_first: ($) =>
      choice(seq($.function_argument, optional(seq(",", $.function_arguments_non_first))), $.named_arguments),

    array_arguments: ($) =>
      seq($.expression, optional(choice(seq(",", $.array_arguments_non_first), seq("for", $.for_indices)))),

    array_arguments_non_first: ($) => seq($.expression, optional(seq(",", $.array_arguments_non_first))),

    named_arguments: ($) => seq($.named_argument, optional(seq(",", $.named_arguments))),

    named_argument: ($) => seq(semanticToken("property", $.identifier), "=", $.function_argument),

    function_argument: ($) => choice($.function_partial_application, $.expression),

    function_partial_application: ($) => seq("function", $.type_specifier, "(", optional($.named_arguments), ")"),

    output_expression_list: ($) =>
      choice(seq(), seq(optional($.expression), ",", optional($.expression), repeat(seq(",", optional($.expression))))),

    expression_list: ($) => seq($.expression, repeat(seq(",", $.expression))),

    array_subscripts: ($) => seq("[", $.subscript, repeat(seq(",", $.subscript)), "]"),

    subscript: ($) => choice(field("flexible", ":"), field("expression", $.expression)),

    description: ($) => seq($.description_string, optional($.annotation_clause)),

    description_string: ($) => optional(seq($.string_literal, repeat(seq("+", $.string_literal)))),

    annotation_clause: ($) => seq("annotation", $.class_modification),

    // Tokens
    identifier: () => token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    string_literal: () => semanticToken("string", token(/"[^"]*"/)),
    unsigned_integer: () => semanticToken("number", token(/\d+/)),
    unsigned_real: () =>
      semanticToken("number", token(/\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+/)),
  },

  queries: {
    resolveComponentTypeInClass: (db: CodeGraph, classNode: u32, identNode: u32, $: Record<string, u16>): u16 => {
      return getVariableTypeInClass(db, classNode, identNode, $);
    },

    resolveDottedType: (db: CodeGraph, enclosingClass: u32, compRefNode: u32, $: Record<string, u16>): u16 => {
      return getDottedVariableType(db, enclosingClass, compRefNode, $);
    },

    resolveEnclosingClass: (db: CodeGraph, node: u32, $: Record<string, u16>): u32 => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.class_definition) {
          return anc;
        }
      }
      return 0;
    },
  },

  extras: () => [/\s+/],

  polyglot: {
    languages: ["sysml2", "owl2"],
    rules: [
      tggRule({
        name: "ModelicaModelToSysmlBlock",
        source: ($, v) => $.ClassDefinition({ name: v("className") }),
        target: ($, v) => $.BlockDefinition({ declaredName: v("className") }),
        where: (v) => [tggEq(v("className"), v("className")), tggDefaultVal(v("isAbstract"), false)],
      }),
      tggRule({
        name: "ModelicaComponentToSysmlPart",
        source: ($, v) => $.ComponentClause({ name: v("compName"), typeSpecifier: v("typeName") }),
        target: ($, v) => $.PartUsage({ declaredName: v("compName"), declaredType: v("typeName") }),
        where: (v) => [tggEq(v("compName"), v("compName")), tggTypeMap(v("typeName"), v("typeName"), "sysml2")],
      }),
      tggRule({
        name: "ModelicaConnectToSysmlConnection",
        source: ($, v) => $.ConnectClause({ name: v("connName") }),
        target: ($, v) => $.ConnectionUsage({ declaredName: v("connName") }),
        where: (v) => [tggEq(v("connName"), v("connName"))],
      }),
      tggRule({
        name: "ModelicaEquationToSysmlConstraint",
        source: ($, v) => $.EquationClause({ name: v("eqName") }),
        target: ($, v) => $.ConstraintUsage({ declaredName: v("eqName") }),
        where: (v) => [tggEq(v("eqName"), v("eqName"))],
      }),
      tggRule({
        name: "ModelicaToOWL2Class",
        source: ($, v) => $.ClassDefinition({ name: v("className") }),
        target: ($, v) => $.ClassDeclaration({ iri: v("iri") }),
        where: (v) => [tggFormatUri(v("className"), "mo:", v("iri"))],
      }),
    ],
  },
});

export default modelicaLanguage;
