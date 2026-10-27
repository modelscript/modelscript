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

/**
 * Operator precedence levels for embedded parameter expressions in FEA templates (`.inpt`).
 */
const PREC = {
  ASSIGNMENT: 1,
  CONDITIONAL: 2,
  ADDITIVE: 3,
  MULTIPLICATIVE: 4,
  EXPONENTIATION: 5,
  UNARY: 6,
  PRIMARY: 7,
} as const;

/**
 * Finite Element Analysis (`.fea`, `.inp`, `.inpt`, `.bdf`) language definition.
 *
 * Defines the GLR grammar for Abaqus/CalculiX keyword cards, data lines, and `{{ expr }}`
 * template bindings, 3D FEA viewer/materialization/simulation actions, and polyglot TGG rules
 * linking FEA structural properties and boundary conditions to SysML v2 and Modelica.
 */
export const feaLanguage = language({
  name: "fea",
  fileExtensions: [".fea", ".inp", ".inpt", ".bdf"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".fea", ".inp", ".inpt", ".bdf"],
    icons: {
      light: "./assets/fea/icon-light.png",
      dark: "./assets/fea/icon-dark.png",
    },
  },

  // IDE and AI agent actions for 3D FEA mesh viewing, template materialization, and linear-elasticity simulation
  actions: [
    {
      id: "open_fea_viewer",
      title: "Open 3D FEA Deck Viewer",
      description: "Opens the 3D finite element deck viewer showing nodes, elements, boundary conditions, and loads.",
      category: "query",
      execute: async (ctx: any, params: { documentText?: string | undefined; uri?: string | undefined }) => {
        let source = params?.documentText ?? ctx.documentText;
        if (!source && ctx.uri && ctx.documents) {
          source = ctx.documents.get(ctx.uri)?.getText();
        }
        if (!source && ctx.uri && ctx.sharedFs) {
          try {
            source = await ctx.sharedFs.read(ctx.uri);
          } catch {}
        }
        if (!source) {
          throw new Error("No FEA input deck found to view.");
        }
        const { getFeaDialect } = await import("./dialects/index.js");
        const dialect = getFeaDialect(ctx.uri || "inp");
        const modelData = dialect.parse(source);
        const { extractFeaSlicingProperties } = await import("./materializer.js");
        const slicing = extractFeaSlicingProperties(source);
        return {
          success: true,
          uri: ctx.uri,
          nodeCount: modelData.nodes.size,
          elementCount: modelData.elements.size,
          materials: Array.from(modelData.materials.keys()),
          slicing,
        };
      },
      ui: {
        editorTitle: {
          icon: "$(package)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_cae@0",
        },
        languageModelTool: {
          name: "fea_open_deck_viewer",
          displayName: "Open 3D FEA Deck Viewer",
          modelDescription: "Renders 3D finite element meshes, boundary fixities, and applied loads.",
        },
      },
    },
    {
      id: "materialize_deck",
      title: "Materialize FEA Deck (.inpt -> .inp)",
      description: "Evaluates embedded expressions and expands parametric macros into a concrete CalculiX / .inp deck.",
      category: "transform",
      execute: async (
        ctx: any,
        params: { documentText?: string | undefined; uri?: string | undefined; options?: any },
      ) => {
        let source = params?.documentText ?? ctx.documentText;
        if (!source && ctx.uri && ctx.documents) {
          source = ctx.documents.get(ctx.uri)?.getText();
        }
        if (!source && ctx.uri && ctx.sharedFs) {
          try {
            source = await ctx.sharedFs.read(ctx.uri);
          } catch {}
        }
        if (!source) {
          throw new Error("No FEA deck template found to materialize.");
        }
        const { materializeFeaDeck } = await import("./materializer.js");
        const materialized = materializeFeaDeck(source, params?.options);
        return {
          success: true,
          uri: ctx.uri,
          materialized,
        };
      },
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
          name: "fea_materialize_deck",
          displayName: "Materialize FEA Deck",
          modelDescription:
            "Evaluates template parameter bindings in an FEA deck template (.inpt) to generate a concrete .inp deck.",
        },
      },
    },
    {
      id: "run_simulation",
      title: "Run FEA Structural Simulation",
      description: "Executes a structural finite element simulation using CalculiX solver.",
      category: "simulate",
      execute: async (ctx: any, params: { documentText?: string | undefined; uri?: string | undefined }) => {
        let source = params?.documentText ?? ctx.documentText;
        if (!source && ctx.uri && ctx.documents) {
          source = ctx.documents.get(ctx.uri)?.getText();
        }
        if (!source && ctx.uri && ctx.sharedFs) {
          try {
            source = await ctx.sharedFs.read(ctx.uri);
          } catch {}
        }
        if (!source) {
          throw new Error("No FEA deck found to simulate.");
        }
        const { extractFeaSlicingProperties } = await import("./materializer.js");
        const slicing = extractFeaSlicingProperties(source);
        if (ctx.notifyProgress) {
          ctx.notifyProgress(
            `FEA Analysis: mass=${slicing.mass}kg, σ_max=${(slicing.maxVonMisesPa / 1e6).toFixed(1)}MPa, u_max=${((slicing.maxDisplacementM ?? 0) * 1e3).toFixed(3)}mm (${slicing.isSafe ? "SAFE" : "FAIL"})`,
          );
        }
        return {
          success: true,
          uri: ctx.uri,
          solver: "3D Linear Elasticity FEA Solver (C3D4/C3D6/C3D8/S3/S4/B31/T3D2)",
          mass: slicing.mass,
          totalVolumeM3: slicing.totalVolumeM3 ?? 0,
          maxDisplacementM: slicing.maxDisplacementM ?? 0,
          nodeCount: slicing.nodeCount ?? 0,
          elementCount: slicing.elementCount ?? 0,
          nodalDisplacements: slicing.nodalDisplacements ?? {},
          elementVonMisesPa: slicing.elementVonMisesPa ?? {},
          maxVonMisesPa: slicing.maxVonMisesPa,
          yieldStrengthPa: slicing.yieldStrengthPa,
          safetyFactor: slicing.safetyFactor,
          isSafe: slicing.isSafe,
          summary: `FEA structural simulation completed (${slicing.nodeCount ?? 0} nodes, ${slicing.elementCount ?? 0} elements): Mass m = ${slicing.mass} kg, Max displacement = ${((slicing.maxDisplacementM ?? 0) * 1e3).toFixed(3)} mm, Max von Mises = ${(slicing.maxVonMisesPa / 1e6).toFixed(1)} MPa <= ${(slicing.yieldStrengthPa / 1e6).toFixed(1)} MPa (Safety Factor: ${slicing.safetyFactor}x, ${slicing.isSafe ? "SAT" : "VIOLATED"})`,
        };
      },
      ui: {
        editorContextMenu: {
          group: "1_run@1",
        },
        explorerContextMenu: {
          group: "modelscript_cae@2",
        },
        languageModelTool: {
          name: "fea_run_simulation",
          displayName: "Run FEA Structural Simulation",
          modelDescription: "Executes CalculiX structural FEA simulation on the active deck.",
        },
      },
    },
  ],

  // Triple Graph Grammar (TGG) rules synchronizing FEA keyword cards with SysML v2 and Modelica
  polyglot: {
    languages: ["sysml2", "modelica"],
    rules: [
      tggRule({
        name: "FeaStressMassToModelicaParam",
        sourceLang: "fea",
        targetLang: "modelica",
        priority: 15,
        source: ($, v) => $.KeywordCard({ name: "MASS", parameter: v("massVal") }),
        target: ($, v) => $.ComponentClause({ name: "m", defaultValue: v("massVal") }),
        where: (v) => [tggEq(v("massVal"), v("massVal")), tggComplement(["elset", "material"])],
      }),
      tggRule({
        name: "FeaStressMassToSysmlAttribute",
        sourceLang: "fea",
        targetLang: "sysml2",
        priority: 15,
        source: ($, v) => $.KeywordCard({ name: "MASS", parameter: v("massVal") }),
        target: ($, v) => $.AttributeUsage({ declaredName: "totalMass", defaultValue: v("massVal") }),
        where: (v) => [tggEq(v("massVal"), v("massVal")), tggComplement(["elset", "material"])],
      }),
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
        target: ($, _v) =>
          $.ComponentClause({
            name: "fixedBoundary",
            typeSpecifier: "Modelica.Mechanics.Translational.Components.Fixed",
          }),
        where: (_v) => [tggComplement(["nodeId", "dofs"])],
      }),
      tggRule({
        name: "FeaSpringToModelicaSpring",
        sourceLang: "fea",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.KeywordCard({ name: "SPRING", parameter: v("stiffness") }),
        target: ($, _v) =>
          $.ComponentClause({
            name: "springComponent",
            typeSpecifier: "Modelica.Mechanics.Translational.Components.Spring",
          }),
        where: (_v) => [tggComplement(["stiffness", "damping"])],
      }),
      tggRule({
        name: "FeaLoadCaseToSysmlRequirement",
        sourceLang: "fea",
        targetLang: "sysml2",
        priority: 0,
        source: ($, v) => $.KeywordCard({ name: "LOADCASE", parameter: v("limitVal") }),
        target: ($, _v) => $.ConstraintUsage({ declaredName: "loadCase" }),
        where: (_v) => [tggComplement(["limitVal", "loadSteps"])],
      }),
    ],
  },

  primitives: {
    lineComment: "**",
  },

  extras: () => [/[ \t\r]+/],

  rules: {
    // Root FEA deck rule exposing Salsa instantiation and name-resolution queries
    SourceFile: ($) =>
      def({
        syntax: repeat(choice($["CommentLine"]!, $["KeywordCard"]!, $["DataLine"]!, $["_newline"]!)),
        symbol: () => ({
          kind: "Class",
          name: "FeaDeck",
        }),
        queries: {
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
          resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
            const children = db.childrenOf(self.id);
            const byNameMap = new Map<string, SymbolEntry>();
            for (const child of children) {
              byNameMap.set(child.name, child);
            }
            return (name: string) => byNameMap.get(name) ?? null;
          },
        },
      }),

    CommentLine: ($) => seq(choice("**", "$", "#"), /.*/, $["_newline"]!),

    _newline: () => /\n/,

    // Abaqus/CalculiX keyword card (`*KEYWORD, PARAM=VAL`) indexed as a Section symbol
    KeywordCard: ($) =>
      def({
        syntax: seq(
          "*",
          field("name", $["CARD_NAME"]!),
          optional(
            seq(
              ",",
              field("parameter", choice($["IDENTIFIER"]!, $["NUMBER"]!, $["STRING"]!, $["EmbeddedExpression"]!)),
            ),
          ),
          repeat(seq(",", choice($["ParameterAssignment"]!, $["OptionFlag"]!))),
          choice($["_newline"]!, optional(/\r?\n/)),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Section",
          name: self["name"] ?? "KEYWORD",
        }),
      }),

    ParameterAssignment: ($) =>
      seq(
        field("param", $["IDENTIFIER"]!),
        "=",
        field("value", choice($["IDENTIFIER"]!, $["NUMBER"]!, $["STRING"]!, $["EmbeddedExpression"]!)),
      ),

    OptionFlag: ($) => field("flag", $["IDENTIFIER"]!),

    DataLine: ($) =>
      seq(
        choice($["DataItem"]!, $["EmbeddedExpression"]!),
        repeat(seq(",", choice($["DataItem"]!, $["EmbeddedExpression"]!))),
        choice($["_newline"]!, optional(/\r?\n/)),
      ),

    DataItem: ($) => choice($["NUMBER"]!, $["IDENTIFIER"]!, $["STRING"]!),

    // Embedded template expression (`{{ expr }}`) for parametric FEA deck materialization
    EmbeddedExpression: ($) =>
      def({
        syntax: seq("{{", field("expr", $["Expression"]!), "}}"),
        symbol: (self: Record<string, string>) => ({
          kind: "ExpressionBinding",
          name: self["expr"] ?? "",
        }),
      }),

    Expression: ($) => choice($["BinaryExpression"]!, $["UnaryExpression"]!, $["PrimaryExpression"]!),

    BinaryExpression: ($) =>
      choice(
        prec.left(PREC.ADDITIVE, seq($["Expression"]!, choice("+", "-"), $["Expression"]!)),
        prec.left(PREC.MULTIPLICATIVE, seq($["Expression"]!, choice("*", "/"), $["Expression"]!)),
        prec.right(PREC.EXPONENTIATION, seq($["Expression"]!, "^", $["Expression"]!)),
      ),

    UnaryExpression: ($) => prec(PREC.UNARY, seq(choice("+", "-"), $["Expression"]!)),

    PrimaryExpression: ($) =>
      choice($["QualifiedIdentifier"]!, $["NUMBER"]!, $["STRING"]!, seq("(", $["Expression"]!, ")")),

    QualifiedIdentifier: ($) => seq($["IDENTIFIER"]!, repeat(seq(".", $["IDENTIFIER"]!))),

    CARD_NAME: () => /[A-Za-z_][A-Za-z0-9_]*(?:[ \t]+[A-Za-z_][A-Za-z0-9_]*)*/,
    IDENTIFIER: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NUMBER: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    STRING: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
  },
});
