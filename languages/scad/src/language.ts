// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  field,
  language,
  optional,
  prec,
  repeat,
  seq,
  tggComplement,
  tggDefaultVal,
  tggEq,
  tggRule,
} from "@modelscript/dsl";
import { scadWriteback } from "./writeback.js";

const PREC = {
  CONDITIONAL: 1,
  OR: 2,
  AND: 3,
  EQUALITY: 4,
  RELATIONAL: 5,
  ADDITIVE: 6,
  MULTIPLICATIVE: 7,
  POWER: 8,
  UNARY: 9,
  POSTFIX: 10,
  PRIMARY: 11,
} as const;

export const scadLanguage = language({
  name: "scad",
  fileExtensions: [".scad"],
  lsp: {
    fileExtensions: [".scad"],
    icons: {
      light: "./assets/scad/icon-light.png",
      dark: "./assets/scad/icon-dark.png",
    },
  },

  writeback: scadWriteback,

  actions: [
    {
      id: "preview_csg",
      title: "Preview 3D CSG Model",
      description: "Evaluates constructive solid geometry boolean trees and renders 3D polygonal meshes.",
      category: "geometry",
      ui: {
        editorTitle: {
          icon: "$(package)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "scad_preview_csg",
          displayName: "Preview OpenSCAD CSG Model",
          modelDescription: "Evaluates CSG booleans and renders 3D geometry from OpenSCAD source.",
        },
      },
    },
    {
      id: "export_step",
      title: "Export Shape to STEP CAD (.step)",
      description: "Converts OpenSCAD boundary representations into standard ISO 10303 STEP solid bodies.",
      category: "export",
      ui: {
        editorTitle: {
          icon: "$(export)",
          group: "navigation@2",
        },
        editorContextMenu: {
          group: "2_transform@1",
        },
        explorerContextMenu: {
          group: "modelscript_convert@1",
        },
        languageModelTool: {
          name: "scad_export_step",
          displayName: "Export OpenSCAD to STEP CAD",
          modelDescription: "Converts OpenSCAD shapes into standard STEP CAD (.step) solid geometry.",
        },
      },
    },
  ],

  polyglot: {
    languages: ["sysml2", "step", "modelica"],
    rules: [
      tggRule({
        name: "ScadModuleToSysmlPart",
        sourceLang: "scad",
        targetLang: "sysml2",
        source: ($, v) => $.ModuleDeclaration({ name: v("modName") }),
        target: ($, v) => $.PartDefinition({ declaredName: v("modName") }),
        where: (v) => [tggEq(v("modName"), v("modName")), tggComplement(["parameters", "body"])],
      }),
      tggRule({
        name: "ScadTagPortToSysmlPort",
        sourceLang: "scad",
        targetLang: "sysml2",
        source: ($, v) => $.TagPortOp({ args: v("portName") }),
        target: ($, v) => $.PortUsage({ declaredName: v("portName") }),
        where: (v) => [tggEq(v("portName"), v("portName")), tggComplement(["transformStack"])],
      }),
      tggRule({
        name: "ScadVariableToSysmlAttribute",
        sourceLang: "scad",
        targetLang: "sysml2",
        source: ($, v) => $.VariableDeclaration({ name: v("varName"), value: v("val") }),
        target: ($, v) => $.AttributeUsage({ declaredName: v("varName"), defaultValue: v("val") }),
        where: (v) => [tggEq(v("varName"), v("varName")), tggEq(v("val"), v("val"))],
      }),
      tggRule({
        name: "ScadSolidToStepProduct",
        sourceLang: "scad",
        targetLang: "step",
        source: ($, v) => $.CubePrimitive({ args: v("dims") }),
        target: ($, v) => $.ProductDefinition({ name: v("dims") }),
        where: (v) => [tggEq(v("dims"), v("dims")), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadCylinderToStepProduct",
        sourceLang: "scad",
        targetLang: "step",
        priority: 10,
        source: ($, v) => $.CylinderPrimitive({ args: v("dims") }),
        target: ($, v) => $.ProductDefinition({ name: v("dims"), description: "CylinderSolid" }),
        where: (v) => [tggEq(v("dims"), v("dims")), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadSphereToStepProduct",
        sourceLang: "scad",
        targetLang: "step",
        priority: 5,
        source: ($, v) => $.SpherePrimitive({ args: v("dims") }),
        target: ($, v) => $.ProductDefinition({ name: v("dims"), description: "SphereSolid" }),
        where: (v) => [tggEq(v("dims"), v("dims")), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadBooleanOpToStepComposite",
        sourceLang: "scad",
        targetLang: "step",
        priority: 15,
        source: ($, v) => $.BooleanOp({ op: v("opName"), body: v("children") }),
        target: ($, v) => $.ProductDefinition({ name: v("opName"), description: "CSGComposite" }),
        where: (v) => [tggEq(v("opName"), v("opName")), tggComplement(["children"])],
      }),
      tggRule({
        name: "ScadTagPortToModelicaFrame",
        sourceLang: "scad",
        targetLang: "modelica",
        source: ($, v) => $.TagPortOp({ args: v("portName") }),
        target: ($, v) =>
          $.ComponentClause({ name: v("portName"), typeSpecifier: "Modelica.Mechanics.MultiBody.Interfaces.Frame_a" }),
        where: (v) => [tggEq(v("portName"), v("portName")), tggComplement(["transformStack"])],
      }),
      tggRule({
        name: "ScadCubeToMultiBodyShape",
        sourceLang: "scad",
        targetLang: "modelica",
        priority: 5,
        source: ($, v) => $.CubePrimitive({ args: v("dims") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("shapeName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Visualizers.Advanced.Shape",
          }),
        where: (v) => [tggDefaultVal(v("shapeName"), "boxVisualizer"), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadCylinderToMultiBodyShape",
        sourceLang: "scad",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.CylinderPrimitive({ args: v("dims") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("shapeName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Visualizers.Advanced.Shape",
          }),
        where: (v) => [tggDefaultVal(v("shapeName"), "cylinderVisualizer"), tggComplement(["transforms", "color"])],
      }),
      tggRule({
        name: "ScadSphereToMultiBodyShape",
        sourceLang: "scad",
        targetLang: "modelica",
        priority: 5,
        source: ($, v) => $.SpherePrimitive({ args: v("dims") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("shapeName"),
            typeSpecifier: "Modelica.Mechanics.MultiBody.Visualizers.Advanced.Shape",
          }),
        where: (v) => [tggDefaultVal(v("shapeName"), "sphereVisualizer"), tggComplement(["transforms", "color"])],
      }),
    ],
  },

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
  },

  extras: () => [/\s+/],

  rules: {
    SourceFile: ($) => repeat($.Statement),

    Statement: ($) =>
      choice(
        $.VariableDeclaration,
        $.ModuleDeclaration,
        $.FunctionDeclaration,
        $.IfStatement,
        $.ForStatement,
        $.BlockStatement,
        $.PrefixSolid,
        $.ChainedSolidStatement,
        $._EmptyStatement,
      ),

    _EmptyStatement: () => ";",

    BlockStatement: ($) => seq("{", repeat($.Statement), "}"),

    VariableDeclaration: ($) =>
      def({
        syntax: seq(field("name", $.IDENTIFIER), "=", field("value", $.Expression), ";"),
        symbol: (self: Record<string, string>) => ({
          kind: "Variable",
          name: self.name ?? "",
        }),
      }),

    ModuleDeclaration: ($) =>
      def({
        syntax: seq(
          "module",
          field("name", $.IDENTIFIER),
          "(",
          optional(field("parameters", $.ParameterList)),
          ")",
          field("body", $.Statement),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Module",
          name: self.name ?? "",
          exports: ["body"],
        }),
      }),

    FunctionDeclaration: ($) =>
      def({
        syntax: seq(
          "function",
          field("name", $.IDENTIFIER),
          "(",
          optional(field("parameters", $.ParameterList)),
          ")",
          "=",
          field("body", $.Expression),
          ";",
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Function",
          name: self.name ?? "",
        }),
      }),

    IfStatement: ($) =>
      prec.right(
        seq(
          "if",
          "(",
          field("condition", $.Expression),
          ")",
          field("consequence", $.Statement),
          optional(seq("else", field("alternative", $.Statement))),
        ),
      ),

    ForStatement: ($) =>
      seq("for", "(", field("var", $.IDENTIFIER), "=", field("range", $.Expression), ")", field("body", $.Statement)),

    ParameterList: ($) => seq($.Parameter, repeat(seq(",", $.Parameter))),

    Parameter: ($) => seq(field("name", $.IDENTIFIER), optional(seq("=", field("default", $.Expression)))),

    ArgumentList: ($) => seq($.Argument, repeat(seq(",", $.Argument))),

    Argument: ($) =>
      choice(seq(field("name", $.IDENTIFIER), "=", field("value", $.Expression)), field("value", $.Expression)),

    // ── Solid Statements & Hybrid Chaining ─────────────────────────────────

    PrefixSolid: ($) =>
      seq(
        field("operator", choice($.TransformOp, $.BooleanOp, $.TagPortOp, $.LinearExtrudeOp)),
        field("child", $.Statement),
      ),

    TransformOp: ($) =>
      choice(
        seq("translate", "(", optional(field("args", $.ArgumentList)), ")"),
        seq("rotate", "(", optional(field("args", $.ArgumentList)), ")"),
        seq("scale", "(", optional(field("args", $.ArgumentList)), ")"),
        seq("mirror", "(", optional(field("args", $.ArgumentList)), ")"),
        seq("color", "(", optional(field("args", $.ArgumentList)), ")"),
      ),

    LinearExtrudeOp: ($) => seq("linear_extrude", "(", optional(field("args", $.ArgumentList)), ")"),

    BooleanOp: () => choice(seq("union", "(", ")"), seq("difference", "(", ")"), seq("intersection", "(", ")")),

    TagPortOp: ($) =>
      def({
        syntax: seq("tag_port", "(", field("args", $.ArgumentList), ")"),
        symbol: (self: Record<string, string>) => ({
          kind: "TaggedPort",
          name: self.args ?? "",
        }),
      }),

    ChainedSolidStatement: ($) => seq(field("solid", $.ChainedSolid), ";"),

    ChainedSolid: ($) => seq(field("receiver", $.PrimarySolid), repeat(field("method", $.MethodCall))),

    MethodCall: ($) => seq(".", field("name", $.MethodName), "(", optional(field("args", $.ArgumentList)), ")"),

    MethodName: ($) => choice($.IDENTIFIER, "translate", "rotate", "scale", "mirror", "color", "fillet", "chamfer"),

    PrimarySolid: ($) =>
      choice(
        $.CubePrimitive,
        $.CylinderPrimitive,
        $.SpherePrimitive,
        $.PolyhedronPrimitive,
        $.PolygonPrimitive,
        $.CirclePrimitive,
        $.SquarePrimitive,
        $.ModuleInstantiation,
      ),

    CubePrimitive: ($) => seq("cube", "(", optional(field("args", $.ArgumentList)), ")"),

    CylinderPrimitive: ($) => seq("cylinder", "(", optional(field("args", $.ArgumentList)), ")"),

    SpherePrimitive: ($) => seq("sphere", "(", optional(field("args", $.ArgumentList)), ")"),

    PolyhedronPrimitive: ($) => seq("polyhedron", "(", optional(field("args", $.ArgumentList)), ")"),

    PolygonPrimitive: ($) => seq("polygon", "(", optional(field("args", $.ArgumentList)), ")"),

    CirclePrimitive: ($) => seq("circle", "(", optional(field("args", $.ArgumentList)), ")"),

    SquarePrimitive: ($) => seq("square", "(", optional(field("args", $.ArgumentList)), ")"),

    ModuleInstantiation: ($) => seq(field("name", $.IDENTIFIER), "(", optional(field("args", $.ArgumentList)), ")"),

    // ── Expressions ────────────────────────────────────────────────────────

    Expression: ($) =>
      choice($.ConditionalExpression, $.BinaryExpression, $.UnaryExpression, $.PostfixExpression, $.PrimaryExpression),

    ConditionalExpression: ($) =>
      prec.right(
        PREC.CONDITIONAL,
        seq(
          field("condition", $.Expression),
          "?",
          field("consequence", $.Expression),
          ":",
          field("alternative", $.Expression),
        ),
      ),

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
        prec.right(PREC.POWER, seq(field("left", $.Expression), field("operator", "^"), field("right", $.Expression))),
      ),

    UnaryExpression: ($) =>
      prec(PREC.UNARY, seq(field("operator", choice("!", "-", "+")), field("operand", $.Expression))),

    PostfixExpression: ($) =>
      choice(
        prec(PREC.POSTFIX, seq(field("operand", $.Expression), "[", field("index", $.Expression), "]")),
        prec(
          PREC.POSTFIX,
          seq(field("function", $.Expression), "(", optional(field("arguments", $.ArgumentList)), ")"),
        ),
      ),

    PrimaryExpression: ($) =>
      choice(
        $.NUMBER,
        $.STRING,
        $.BOOLEAN,
        $.UNDEF,
        $.IDENTIFIER,
        $.VectorLiteral,
        $.RangeLiteral,
        $.ParenthesizedExpression,
      ),

    ParenthesizedExpression: ($) => seq("(", field("expression", $.Expression), ")"),

    VectorLiteral: ($) => seq("[", optional(seq($.Expression, repeat(seq(",", $.Expression)))), "]"),

    RangeLiteral: ($) =>
      seq(
        "[",
        field("start", $.Expression),
        ":",
        choice(seq(field("step", $.Expression), ":", field("end", $.Expression)), field("end", $.Expression)),
        "]",
      ),

    // ── Terminals ──────────────────────────────────────────────────────────

    IDENTIFIER: () => /\$?[a-zA-Z_][a-zA-Z0-9_]*/,

    NUMBER: () => /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,

    STRING: () => /"([^"\\]|\\.)*"/,

    BOOLEAN: () => choice("true", "false"),

    UNDEF: () => "undef",
  },
});

export default scadLanguage;
