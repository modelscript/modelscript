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

export const cfdLanguage = language({
  name: "cfd",

  polyglot: {
    languages: ["modelica", "sysml2"],
    rules: [
      tggRule({
        name: "CfdInletToModelicaFluidPort",
        sourceLang: "cfd",
        targetLang: "modelica",
        source: ($, v) => $.Directive({ key: v("markerKey"), value: v("markerVal") }),
        target: ($, v) =>
          $.ComponentClause({ name: v("markerKey"), typeSpecifier: "Modelica.Fluid.Interfaces.FluidPort_a" }),
        where: (v) => [tggEq(v("markerKey"), v("markerKey")), tggComplement(["dialect", "meshFilename", "options"])],
      }),
      tggRule({
        name: "CfdHeatFluxToModelicaHeatPort",
        sourceLang: "cfd",
        targetLang: "modelica",
        source: ($, v) => $.Directive({ key: v("markerKey"), value: v("markerVal") }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("markerKey"),
            typeSpecifier: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a",
          }),
        where: (v) => [tggEq(v("markerKey"), v("markerKey")), tggComplement(["dialect", "meshFilename", "options"])],
      }),
      tggRule({
        name: "CfdMarkerToSysmlPort",
        sourceLang: "cfd",
        targetLang: "sysml2",
        source: ($, v) => $.Directive({ key: v("markerKey"), value: v("markerVal") }),
        target: ($, v) => $.PortUsage({ declaredName: v("markerKey"), declaredType: v("markerVal") }),
        where: (v) => [
          tggEq(v("markerKey"), v("markerKey")),
          tggEq(v("markerVal"), v("markerVal")),
          tggComplement(["dialect", "options"]),
        ],
      }),
      tggRule({
        name: "CfdDirectiveToSysmlConstraint",
        sourceLang: "cfd",
        targetLang: "sysml2",
        source: ($, v) => $.Directive({ key: v("dirKey"), value: v("dirVal") }),
        target: ($, v) => $.ConstraintUsage({ declaredName: v("dirKey") }),
        where: (v) => [tggEq(v("dirKey"), v("dirKey")), tggComplement(["dirVal"])],
      }),
    ],
  },

  primitives: {
    lineComment: "%",
  },

  extras: () => [/[ \t\r]+/],

  rules: {
    SourceFile: ($) =>
      def({
        syntax: repeat(choice($.CommentLine, $.Directive, $._newline)),
        symbol: () => ({
          kind: "Class",
          name: "CfdConfig",
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

    CommentLine: ($) => seq(choice("%", "//", "#"), /.*/, $._newline),

    _newline: () => /\n/,

    Directive: ($) =>
      def({
        syntax: seq(
          field("key", $.IDENTIFIER),
          "=",
          field("value", choice($.TupleValue, $.ScalarValue, $.EmbeddedExpression)),
          choice($._newline, optional(/\r?\n/)),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Property",
          name: self.key ?? "DIRECTIVE",
        }),
      }),

    TupleValue: ($) =>
      seq(
        "(",
        choice($.ScalarValue, $.EmbeddedExpression),
        repeat(seq(",", choice($.ScalarValue, $.EmbeddedExpression))),
        ")",
      ),

    ScalarValue: ($) => choice($.NUMBER, $.IDENTIFIER, $.STRING),

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
