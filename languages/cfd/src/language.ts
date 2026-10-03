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
  fileExtensions: [".cfd", ".cfg", ".cfgt", ".su2"],
  lsp: {
    fileExtensions: [".cfd", ".cfg", ".cfgt", ".su2"],
    icons: {
      light: "./assets/cfd/icon-light.png",
      dark: "./assets/cfd/icon-dark.png",
    },
  },

  actions: [
    {
      id: "open_cfd_viewer",
      title: "Open 3D Aerodynamics Viewer",
      description: "Opens the 3D surface mesh and boundary marker viewer for SU2 aerodynamic configurations.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(package)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_cae@0",
        },
        languageModelTool: {
          name: "cfd_open_viewer",
          displayName: "Open 3D CFD Aerodynamics Viewer",
          modelDescription: "Renders 3D aerodynamic surface meshes, boundary markers, and pressure field probes.",
        },
      },
    },
    {
      id: "materialize_config",
      title: "Materialize CFD Config (.cfgt -> .cfg)",
      description: "Evaluates embedded parameter expressions to generate a concrete SU2 configuration file.",
      category: "transform",
      ui: {
        editorTitle: {
          icon: "$(file-code)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "2_transform@1",
        },
        explorerContextMenu: {
          group: "modelscript_cae@1",
        },
        languageModelTool: {
          name: "cfd_materialize_config",
          displayName: "Materialize SU2 CFD Config",
          modelDescription:
            "Evaluates template parameter expressions in a CFD config template (.cfgt) to generate a concrete .cfg file.",
        },
      },
    },
  ],

  polyglot: {
    languages: ["modelica", "sysml2"],
    rules: [
      tggRule({
        name: "CfdInletToModelicaFluidPort",
        sourceLang: "cfd",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.Directive({ key: "MARKER_INLET", value: v("markerVal") }),
        target: ($, _v) => $.ComponentClause({ name: "inlet", typeSpecifier: "Modelica.Fluid.Interfaces.FluidPort_a" }),
        where: (_v) => [tggComplement(["dialect", "meshFilename", "options"])],
      }),
      tggRule({
        name: "CfdHeatFluxToModelicaHeatPort",
        sourceLang: "cfd",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.Directive({ key: "MARKER_HEATFLUX", value: v("markerVal") }),
        target: ($, _v) =>
          $.ComponentClause({
            name: "heatPort",
            typeSpecifier: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a",
          }),
        where: (_v) => [tggComplement(["dialect", "meshFilename", "options"])],
      }),
      tggRule({
        name: "CfdMarkerToSysmlPort",
        sourceLang: "cfd",
        targetLang: "sysml2",
        priority: 5,
        source: ($, v) => $.Directive({ key: "MARKER_SYM", value: v("markerVal") }),
        target: ($, v) => $.PortUsage({ declaredName: "marker_sym", declaredType: v("markerVal") }),
        where: (v) => [tggEq(v("markerVal"), v("markerVal")), tggComplement(["dialect", "options"])],
      }),
      tggRule({
        name: "CfdDirectiveToSysmlConstraint",
        sourceLang: "cfd",
        targetLang: "sysml2",
        priority: 0,
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
