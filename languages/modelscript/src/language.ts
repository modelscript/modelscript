// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, def, field, language, optional, prec, repeat, repeat1, seq } from "@modelscript/dsl";
import { modelscriptPolyglotConfig } from "./tgg/index.js";

/**
 * Operator precedence levels for the ModelScript GLR grammar, ordered from
 * lowest binding power (FLWOR queries) to highest (postfix and primary expressions).
 */
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

/**
 * Language definition for ModelScript (`.modelscript`, `.msx`), providing the
 * native grammar, symbol indexing rules, IDE execution actions, and polyglot
 * Triple Graph Grammar (TGG) synchronization rules with Modelica and SysML v2.
 */
export const modelscriptLanguage = language({
  name: "modelscript",
  displayName: "ModelScript",
  fileExtensions: [".modelscript", ".msx"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".modelscript", ".msx"],
    icons: {
      light: "./assets/modelscript/icon-light.png",
      dark: "./assets/modelscript/icon-dark.png",
    },
  },

  // Bi-directional source writeback for in-place symbol value edits
  writeback: {
    operators: ["=", ":="],
  },

  ui: {
    stencils: [
      {
        label: "Resistor",
        className: "Modelica.Electrical.Analog.Basic.Resistor",
        snippet: "  Modelica.Electrical.Analog.Basic.Resistor R_new(R=100);\n",
      },
      {
        label: "Capacitor",
        className: "Modelica.Electrical.Analog.Basic.Capacitor",
        snippet: "  Modelica.Electrical.Analog.Basic.Capacitor C_new(C=1e-3);\n",
      },
      {
        label: "Inductor",
        className: "Modelica.Electrical.Analog.Basic.Inductor",
        snippet: "  Modelica.Electrical.Analog.Basic.Inductor L_new(L=0.1);\n",
      },
      {
        label: "Ground",
        className: "Modelica.Electrical.Analog.Basic.Ground",
        snippet: "  Modelica.Electrical.Analog.Basic.Ground G_new;\n",
      },
      {
        label: "Constant",
        className: "Modelica.Blocks.Sources.Constant",
        snippet: "  Modelica.Blocks.Sources.Constant const_new(k=1.0);\n",
      },
      {
        label: "Integrator",
        className: "Modelica.Blocks.Continuous.Integrator",
        snippet: "  Modelica.Blocks.Continuous.Integrator integ_new(k=1.0);\n",
      },
      {
        label: "3D Shape",
        className: "Modelica.Mechanics.MultiBody.Visualizers.FixedShape",
        snippet:
          '  Modelica.Mechanics.MultiBody.Visualizers.FixedShape shape_new(shapeType="box", length=1.0, width=0.2, height=0.2, color={0, 128, 255});\n',
      },
      {
        label: "3D Arrow",
        className: "Modelica.Mechanics.MultiBody.Visualizers.SignalArrow",
        snippet:
          "  Modelica.Mechanics.MultiBody.Visualizers.SignalArrow arrow_new(diameter=0.04, color={255, 80, 0});\n",
      },
      {
        label: "3D Torus",
        className: "Modelica.Mechanics.MultiBody.Visualizers.Torus",
        snippet: "  Modelica.Mechanics.MultiBody.Visualizers.Torus torus_new(ri=0.5, ro=0.1, color={0, 180, 120});\n",
      },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "addIconRect",
        label: "Add Rectangle",
        shortLabel: "Rect",
        tooltip: "Add Rectangle to Icon",
        icon: "image",
        iconSvg:
          '<rect x="2.25" y="3.5" width="11.5" height="9" rx="1.4" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.35"/>',
        views: ["icon"],
        targets: ["ansatz"],
        placement: "primary",
        order: 11,
        shortcut: "R",
        command: "ansatz:addIconPrimitive:rect",
      },
      {
        id: "addIconEllipse",
        label: "Add Ellipse",
        shortLabel: "Ellipse",
        tooltip: "Add Ellipse to Icon",
        icon: "image",
        iconSvg:
          '<ellipse cx="8" cy="8" rx="5.75" ry="4.75" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.35"/>',
        views: ["icon"],
        targets: ["ansatz"],
        placement: "primary",
        order: 12,
        shortcut: "O",
        command: "ansatz:addIconPrimitive:ellipse",
      },
      {
        id: "addIconLine",
        label: "Add Line",
        shortLabel: "Line",
        tooltip: "Add Line to Icon",
        icon: "image",
        iconSvg:
          '<line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="3" cy="13" r="1.4" fill="currentColor"/><circle cx="13" cy="3" r="1.4" fill="currentColor"/>',
        views: ["icon"],
        targets: ["ansatz"],
        placement: "primary",
        order: 13,
        shortcut: "L",
        command: "ansatz:addIconPrimitive:line",
      },
      {
        id: "addIconPolygon",
        label: "Add Polygon",
        shortLabel: "Polygon",
        tooltip: "Add Polygon to Icon",
        icon: "image",
        iconSvg:
          '<polygon points="8,2.4 13.5,12.6 2.5,12.6" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><circle cx="8" cy="2.4" r="1.15" fill="currentColor"/><circle cx="13.5" cy="12.6" r="1.15" fill="currentColor"/><circle cx="2.5" cy="12.6" r="1.15" fill="currentColor"/>',
        views: ["icon"],
        targets: ["ansatz"],
        placement: "primary",
        order: 14,
        shortcut: "P",
        command: "ansatz:addIconPrimitive:polygon",
      },
      {
        id: "addIconText",
        label: "Add Text",
        shortLabel: "Text",
        tooltip: "Add Text (%name) to Icon",
        icon: "image",
        iconSvg:
          '<path d="M3.2 4V3h9.6v1M8 3v10M5.8 13h4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
        views: ["icon"],
        targets: ["ansatz"],
        placement: "primary",
        order: 15,
        shortcut: "T",
        command: "ansatz:addIconPrimitive:text",
      },
      {
        id: "deleteIconPrimitive",
        label: "Delete Selected Shape",
        shortLabel: "Delete",
        tooltip: "Delete the selected icon shape",
        icon: "tools",
        iconSvg:
          '<path d="M3.5 4.5h9M6 4.5V3h4v1.5M5 4.5v8h6v-8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
        views: ["icon"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 16,
        command: "ansatz:deleteIconPrimitive",
      },
      {
        id: "bringIconForward",
        label: "Bring Shape Forward",
        shortLabel: "Forward",
        tooltip: "Move the selected icon shape forward in draw order",
        icon: "layers",
        views: ["icon"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 17,
        command: "ansatz:reorderIconPrimitive:forward",
      },
      {
        id: "sendIconBackward",
        label: "Send Shape Backward",
        shortLabel: "Backward",
        tooltip: "Move the selected icon shape backward in draw order",
        icon: "layers",
        views: ["icon"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 18,
        command: "ansatz:reorderIconPrimitive:backward",
      },
      {
        id: "runModelscript",
        label: "Run ModelScript",
        shortLabel: "Run ModelScript",
        tooltip: "Run ModelScript",
        icon: "play",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "run_modelscript",
      },
    ],
  },

  // IDE and AI agent actions for executing active ModelScript files
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

  // Indexed CST node kinds mapped to WorkspaceIndex symbol categories
  symbols: {
    StructDeclaration: { name: "name", kind: "Struct", scope: true, icon: "symbol-structure" },
    FunctionDeclaration: { name: "name", kind: "Function", scope: true, icon: "symbol-function" },
    VariableDeclaration: { name: "name", kind: "Variable", scope: false, icon: "symbol-variable" },
  },

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
  },

  // Resolve LR ambiguity between block statements `{}` and object literals `{}`
  conflicts: ($) => [
    [$["BlockStatement"]!, $["ObjectLiteral"]!, $["Statement"]!, $["ObjectField"]!, $["IDENTIFIER"]!],
    [$["ForUpdate"]!, $["PrimaryExpression"]!],
    [$["ForUpdate"]!, $["Expression"]!],
  ],

  extras: () => [/\s+/],

  rules: {
    SourceFile: ($) => repeat(choice($["TopLevelDeclaration"]!, $["_EmptyStatement"]!)),

    TopLevelDeclaration: ($) => choice($["ImportDeclaration"]!, $["StructDeclaration"]!, $["Statement"]!),

    // ── Declarations ─────────────────────────────────────────────────────────

    ImportDeclaration: ($) =>
      seq(
        "import",
        "{",
        field("specifiers", $["ImportSpecifierList"]!),
        "}",
        "from",
        field("source", $["STRING"]!),
        ";",
      ),

    ImportSpecifierList: ($) => seq($["ImportSpecifier"]!, repeat(seq(",", $["ImportSpecifier"]!))),

    ImportSpecifier: ($) =>
      choice(
        seq(field("imported", $["IDENTIFIER"]!), "as", field("local", $["IDENTIFIER"]!)),
        field("name", $["IDENTIFIER"]!),
      ),

    StructDeclaration: ($) =>
      def({
        syntax: seq(
          optional("@unmanaged"),
          "struct",
          field("name", $["IDENTIFIER"]!),
          "{",
          repeat(field("fields", $["StructField"]!)),
          "}",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Struct",
          name: self["name"] ?? "",
        }),
      }),

    StructField: ($) => seq(field("name", $["IDENTIFIER"]!), ":", field("type", $["Type"]!), ";"),

    FunctionDeclaration: ($) =>
      def({
        syntax: seq(
          "function",
          field("name", $["IDENTIFIER"]!),
          "(",
          optional(field("parameters", $["ParameterList"]!)),
          ")",
          optional(seq(":", field("returnType", $["Type"]!))),
          field("body", $["BlockStatement"]!),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Function",
          name: self["name"] ?? "",
        }),
      }),

    ParameterList: ($) => seq($["Parameter"]!, repeat(seq(",", $["Parameter"]!))),

    Parameter: ($) => seq(field("name", $["IDENTIFIER"]!), ":", field("type", $["Type"]!)),

    // ── Types ────────────────────────────────────────────────────────────────

    Type: ($) => choice($["PrimitiveType"]!, $["GenericType"]!, $["CustomType"]!),

    PrimitiveType: () => choice("i32", "u32", "i64", "u64", "f32", "f64", "bool", "string", "usize", "void"),

    GenericType: ($) =>
      seq(field("genericName", choice("Array", "Slice", "ptr")), "<", field("elementType", $["Type"]!), ">"),

    CustomType: ($) => field("name", $["IDENTIFIER"]!),

    // ── Statements ───────────────────────────────────────────────────────────

    Statement: ($) =>
      choice(
        $["BlockStatement"]!,
        $["VariableDeclaration"]!,
        $["FunctionDeclaration"]!,
        $["AssignmentStatement"]!,
        $["ReturnStatement"]!,
        $["IfStatement"]!,
        $["WhileStatement"]!,
        $["ForStatement"]!,
        $["ExpressionStatement"]!,
      ),

    BlockStatement: ($) => seq("{", repeat($["Statement"]!), "}"),

    VariableDeclaration: ($) =>
      def({
        syntax: seq(
          choice("let", "const"),
          field("name", $["IDENTIFIER"]!),
          optional(seq(":", field("type", $["Type"]!))),
          optional(seq("=", field("value", $["Expression"]!))),
          ";",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Variable",
          name: self["name"] ?? "",
        }),
      }),

    AssignmentStatement: ($) =>
      seq(
        field("target", choice($["IDENTIFIER"]!, $["PostfixExpression"]!)),
        field("operator", choice("=", "+=", "-=", "*=", "/=")),
        field("value", $["Expression"]!),
        ";",
      ),

    ForUpdate: ($) =>
      seq(
        field("target", choice($["IDENTIFIER"]!, $["PostfixExpression"]!)),
        field("operator", choice("=", "+=", "-=", "*=", "/=")),
        field("value", $["Expression"]!),
      ),

    ReturnStatement: ($) => seq("return", optional(field("value", $["Expression"]!)), ";"),

    IfStatement: ($) =>
      prec.right(
        PREC.IF,
        choice(
          seq(
            "if",
            "(",
            field("condition", $["Expression"]!),
            ")",
            field("consequence", $["Statement"]!),
            "else",
            field("alternative", $["Statement"]!),
          ),
          seq("if", "(", field("condition", $["Expression"]!), ")", field("consequence", $["Statement"]!)),
        ),
      ),

    WhileStatement: ($) => seq("while", "(", field("condition", $["Expression"]!), ")", field("body", $["Statement"]!)),

    ForStatement: ($) =>
      seq(
        "for",
        "(",
        field(
          "init",
          choice(
            $["VariableDeclaration"]!,
            $["AssignmentStatement"]!,
            $["ExpressionStatement"]!,
            $["_EmptyStatement"]!,
          ),
        ),
        field("condition", optional($["Expression"]!)),
        ";",
        field("update", optional(choice($["ForUpdate"]!, $["Expression"]!))),
        ")",
        field("body", $["Statement"]!),
      ),

    ExpressionStatement: ($) => seq(field("expression", $["Expression"]!), ";"),

    _EmptyStatement: () => ";",

    // ── Expressions ──────────────────────────────────────────────────────────

    Expression: ($) =>
      choice(
        $["FLWORExpression"]!,
        $["BinaryExpression"]!,
        $["UnaryExpression"]!,
        $["NewExpression"]!,
        $["PostfixExpression"]!,
        $["PrimaryExpression"]!,
      ),

    NewExpression: ($) =>
      seq("new", field("constructor", $["IDENTIFIER"]!), "(", optional(field("arguments", $["ArgumentList"]!)), ")"),

    // XQuery-inspired FLWOR comprehension: for ... let ... where ... order by ... return ...
    FLWORExpression: ($) =>
      prec(
        PREC.FLWOR,
        seq(
          repeat1(field("forClauses", $["ForClause"]!)),
          repeat(field("letClauses", $["LetClause"]!)),
          optional(field("whereClause", $["WhereClause"]!)),
          optional(field("orderByClause", $["OrderByClause"]!)),
          field("returnClause", $["ReturnClause"]!),
        ),
      ),

    ForClause: ($) => seq("for", field("variable", $["IDENTIFIER"]!), "in", field("collection", $["Expression"]!)),

    LetClause: ($) =>
      seq("let", field("variable", $["IDENTIFIER"]!), choice(":=", "="), field("value", $["Expression"]!)),

    WhereClause: ($) => seq("where", field("condition", $["Expression"]!)),

    OrderByClause: ($) =>
      seq(
        "order",
        "by",
        field("criteria", $["Expression"]!),
        optional(field("direction", choice("ascending", "descending", "asc", "desc"))),
      ),

    ReturnClause: ($) => prec.right(PREC.FLWOR, seq("return", field("value", $["Expression"]!))),

    BinaryExpression: ($) =>
      choice(
        prec.left(
          PREC.OR,
          seq(field("left", $["Expression"]!), field("operator", "||"), field("right", $["Expression"]!)),
        ),
        prec.left(
          PREC.AND,
          seq(field("left", $["Expression"]!), field("operator", "&&"), field("right", $["Expression"]!)),
        ),
        prec.left(
          PREC.EQUALITY,
          seq(field("left", $["Expression"]!), field("operator", choice("==", "!=")), field("right", $["Expression"]!)),
        ),
        prec.left(
          PREC.RELATIONAL,
          seq(
            field("left", $["Expression"]!),
            field("operator", choice("<", "<=", ">", ">=")),
            field("right", $["Expression"]!),
          ),
        ),
        prec.left(
          PREC.ADDITIVE,
          seq(field("left", $["Expression"]!), field("operator", choice("+", "-")), field("right", $["Expression"]!)),
        ),
        prec.left(
          PREC.MULTIPLICATIVE,
          seq(
            field("left", $["Expression"]!),
            field("operator", choice("*", "/", "%")),
            field("right", $["Expression"]!),
          ),
        ),
      ),

    UnaryExpression: ($) =>
      prec(PREC.UNARY, seq(field("operator", choice("!", "-", "+", "~")), field("operand", $["Expression"]!))),

    PostfixExpression: ($) =>
      choice(
        prec.left(PREC.POSTFIX, seq(field("object", $["Expression"]!), ".", field("property", $["IDENTIFIER"]!))),
        prec.left(
          PREC.POSTFIX,
          seq(field("callee", $["Expression"]!), "(", optional(field("arguments", $["ArgumentList"]!)), ")"),
        ),
        prec.left(PREC.POSTFIX, seq(field("array", $["Expression"]!), "[", field("index", $["Expression"]!), "]")),
      ),

    ArgumentList: ($) => seq($["Argument"]!, repeat(seq(",", $["Argument"]!))),

    Argument: ($) =>
      choice(
        seq(field("name", $["IDENTIFIER"]!), ":", field("value", $["Expression"]!)),
        field("value", $["Expression"]!),
      ),

    PrimaryExpression: ($) =>
      choice(
        $["NUMBER"]!,
        $["STRING"]!,
        $["BOOLEAN"]!,
        $["IDENTIFIER"]!,
        $["ArrayLiteral"]!,
        $["ObjectLiteral"]!,
        $["ParenthesizedExpression"]!,
      ),

    ArrayLiteral: ($) => seq("[", optional(seq($["Expression"]!, repeat(seq(",", $["Expression"]!)))), "]"),

    ObjectLiteral: ($) => seq("{", optional(seq($["ObjectField"]!, repeat(seq(",", $["ObjectField"]!)))), "}"),

    ObjectField: ($) =>
      choice(
        seq(field("key", $["IDENTIFIER"]!), ":", field("value", $["Expression"]!)),
        field("shorthand", $["IDENTIFIER"]!),
      ),

    ParenthesizedExpression: ($) => seq("(", field("expression", $["Expression"]!), ")"),

    // ── Terminals ────────────────────────────────────────────────────────────

    IDENTIFIER: () => /[a-zA-Z_][a-zA-Z0-9_]*/,

    NUMBER: () => /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,

    STRING: () => /"([^"\\]|\\.)*"/,

    BOOLEAN: () => choice("true", "false"),
  },

  // Cross-language type mappings and TGG rules linking ModelScript to Modelica and SysML v2
  polyglot: modelscriptPolyglotConfig,
});

export default modelscriptLanguage;
