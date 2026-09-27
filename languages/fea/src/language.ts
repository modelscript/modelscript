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
  tggEq,
  tggRule,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";

const PREC = {
  ASSIGNMENT: 1,
  CONDITIONAL: 2,
  ADDITIVE: 3,
  MULTIPLICATIVE: 4,
  EXPONENTIATION: 5,
  UNARY: 6,
  PRIMARY: 7,
} as const;

export const feaLanguage = language({
  name: "fea",

  polyglot: {
    languages: ["sysml2", "modelica"],
    rules: [
      tggRule({
        name: "FeaMaterialToSysmlAttribute",
        sourceLang: "fea",
        targetLang: "sysml2",
        priority: 5,
        source: ($, v) => $.KeywordCard({ name: "MATERIAL", parameter: v("modulus") }),
        target: ($, v) => $.AttributeUsage({ declaredName: "material", defaultValue: v("modulus") }),
        where: (v) => [tggEq(v("modulus"), v("modulus")), tggComplement(["nu", "rho", "yieldStrength"])],
      }),
      tggRule({
        name: "FeaBoundaryFixToModelicaFixed",
        sourceLang: "fea",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.KeywordCard({ name: "BOUNDARY", parameter: v("nodeId") }),
        target: ($, v) =>
          $.ComponentClause({
            name: "fixedBoundary",
            typeSpecifier: "Modelica.Mechanics.Translational.Components.Fixed",
          }),
        where: (v) => [tggComplement(["nodeId", "dofs"])],
      }),
      tggRule({
        name: "FeaSpringToModelicaSpring",
        sourceLang: "fea",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.KeywordCard({ name: "SPRING", parameter: v("stiffness") }),
        target: ($, v) =>
          $.ComponentClause({
            name: "springComponent",
            typeSpecifier: "Modelica.Mechanics.Translational.Components.Spring",
          }),
        where: (v) => [tggComplement(["stiffness", "damping"])],
      }),
      tggRule({
        name: "FeaLoadCaseToSysmlRequirement",
        sourceLang: "fea",
        targetLang: "sysml2",
        priority: 0,
        source: ($, v) => $.KeywordCard({ name: "LOADCASE", parameter: v("limitVal") }),
        target: ($, v) => $.ConstraintUsage({ declaredName: "loadCase" }),
        where: (v) => [tggComplement(["limitVal", "loadSteps"])],
      }),
    ],
  },

  primitives: {
    lineComment: "**",
  },

  extras: () => [/[ \t\r]+/],

  rules: {
    SourceFile: ($) =>
      def({
        syntax: repeat(choice($.CommentLine, $.KeywordCard, $.DataLine, $._newline)),
        symbol: () => ({
          kind: "Class",
          name: "FeaDeck",
        }),
        queries: {
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
          resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
            return db.symbol(self.id);
          },
        },
      }),

    CommentLine: ($) => seq(choice("**", "$", "#"), /.*/, $._newline),

    _newline: () => /\n/,

    KeywordCard: ($) =>
      def({
        syntax: seq(
          "*",
          field("name", $.IDENTIFIER),
          repeat(seq(",", choice($.ParameterAssignment, $.OptionFlag))),
          choice($._newline, optional(/\r?\n/)),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Section",
          name: self.name ?? "KEYWORD",
        }),
      }),

    ParameterAssignment: ($) =>
      seq(
        field("param", $.IDENTIFIER),
        "=",
        field("value", choice($.IDENTIFIER, $.NUMBER, $.STRING, $.EmbeddedExpression)),
      ),

    OptionFlag: ($) => field("flag", $.IDENTIFIER),

    DataLine: ($) =>
      seq(
        choice($.DataItem, $.EmbeddedExpression),
        repeat(seq(",", choice($.DataItem, $.EmbeddedExpression))),
        choice($._newline, optional(/\r?\n/)),
      ),

    DataItem: ($) => choice($.NUMBER, $.IDENTIFIER, $.STRING),

    EmbeddedExpression: ($) =>
      def({
        syntax: seq("{{", field("expr", $.Expression), "}}"),
        symbol: (self: Record<string, string>) => ({
          kind: "ExpressionBinding",
          name: self.expr ?? "",
        }),
      }),

    Expression: ($) => choice($.BinaryExpression, $.UnaryExpression, $.PrimaryExpression),

    BinaryExpression: ($) =>
      choice(
        prec.left(PREC.ADDITIVE, seq($.Expression, choice("+", "-"), $.Expression)),
        prec.left(PREC.MULTIPLICATIVE, seq($.Expression, choice("*", "/"), $.Expression)),
        prec.right(PREC.EXPONENTIATION, seq($.Expression, "^", $.Expression)),
      ),

    UnaryExpression: ($) => prec(PREC.UNARY, seq(choice("+", "-"), $.Expression)),

    PrimaryExpression: ($) => choice($.QualifiedIdentifier, $.NUMBER, $.STRING, seq("(", $.Expression, ")")),

    QualifiedIdentifier: ($) => seq($.IDENTIFIER, repeat(seq(".", $.IDENTIFIER))),

    IDENTIFIER: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NUMBER: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    STRING: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
  },
});
