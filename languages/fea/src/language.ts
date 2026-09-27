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
        source: ($, v) => $.KeywordCard({ name: v("matName"), parameter: v("modulus") }),
        target: ($, v) => $.AttributeUsage({ declaredName: v("matName"), defaultValue: v("modulus") }),
        where: (v) => [
          tggEq(v("matName"), v("matName")),
          tggEq(v("modulus"), v("modulus")),
          tggComplement(["nu", "rho", "yieldStrength"]),
        ],
      }),
      tggRule({
        name: "FeaBoundaryFixToModelicaFixed",
        sourceLang: "fea",
        targetLang: "modelica",
        source: ($, v) => $.KeywordCard({ name: v("fixName"), parameter: v("nodeId") }),
        target: ($, v) =>
          $.ComponentClause({ name: v("fixName"), typeSpecifier: "Modelica.Mechanics.Translational.Components.Fixed" }),
        where: (v) => [tggEq(v("fixName"), v("fixName")), tggComplement(["nodeId", "dofs"])],
      }),
      tggRule({
        name: "FeaSpringToModelicaSpring",
        sourceLang: "fea",
        targetLang: "modelica",
        source: ($, v) => $.KeywordCard({ name: v("springName"), parameter: v("stiffness") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("springName"),
            typeSpecifier: "Modelica.Mechanics.Translational.Components.Spring",
          }),
        where: (v) => [tggEq(v("springName"), v("springName")), tggComplement(["stiffness", "damping"])],
      }),
      tggRule({
        name: "FeaLoadCaseToSysmlRequirement",
        sourceLang: "fea",
        targetLang: "sysml2",
        source: ($, v) => $.KeywordCard({ name: v("reqName"), parameter: v("limitVal") }),
        target: ($, v) => $.ConstraintUsage({ declaredName: v("reqName") }),
        where: (v) => [tggEq(v("reqName"), v("reqName")), tggComplement(["limitVal", "loadSteps"])],
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
