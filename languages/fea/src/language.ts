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
  type ActionExecutionContext,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
import { registerBuiltInFeaLibrarySync } from "./catalog/library-package-adapter.js";
import { canIndexFea, indexFeaDocument } from "./indexing.js";
import { feaPolyglotConfig } from "./tgg/index.js";
import type { MaterializeOptions } from "./types.js";

interface FeaActionContext extends ActionExecutionContext {
  documents?: { get(uri: string): { getText(): string } | undefined } | undefined;
  sharedFs?: { read(uri: string): Promise<string> } | undefined;
}

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
 * Finite Element Analysis (`.fea`, `.inp`, `.inpt`, `.bdf`, `.dat`) language definition.
 *
 * Defines the GLR grammar for Abaqus/CalculiX keyword cards, data lines, and `{{ expr }}`
 * template bindings, 3D FEA viewer/materialization/simulation actions, and polyglot TGG rules
 * linking FEA structural properties and boundary conditions to SysML v2 and Modelica.
 */
export const feaLanguage = language({
  name: "fea",
  fileExtensions: [".fea", ".inp", ".inpt", ".bdf", ".dat"],
  maturity: "beta",
  indexing: {
    indexFile: indexFeaDocument,
    canIndex: canIndexFea,
  },
  lsp: {
    fileExtensions: [".fea", ".inp", ".inpt", ".bdf", ".dat"],
    icons: {
      light: "./assets/fea/icon-light.png",
      dark: "./assets/fea/icon-dark.png",
    },
  },
  ui: {
    panels: [
      {
        id: "inpEditor",
        viewType: "modelscript.inpEditor",
        title: "FEA Deck & 3D Simulation Viewer",
        shortTitle: "FEA Deck",
        selector: ["*.inp", "*.inpt"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/FeaPanel.tsx",
        artifactViewTypes: ["fea", "inp", "calculix", "fea-deck"],
      },
    ],
    stencils: [
      { label: "Material", snippet: "*MATERIAL, NAME=ALUMINUM_6061\n*ELASTIC\n68900.0, 0.33\n*DENSITY\n2.7e-9\n" },
      { label: "Boundary", snippet: "*BOUNDARY\n1, 1, 3, 0.0\n" },
      { label: "Concentrated Load", snippet: "*CLOAD\n4, 2, -500.0\n" },
    ],
    toolbarButtons: [
      {
        id: "openFeaViewer",
        label: "Open 3D FEA Deck Viewer",
        shortLabel: "Open 3D",
        tooltip: "Open 3D FEA Deck Viewer",
        icon: "open-preview",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        actionId: "open_fea_viewer",
      },
      {
        id: "materializeDeck",
        label: "Materialize FEA Deck (.inpt -> .inp)",
        shortLabel: "Materialize FEA",
        tooltip: "Materialize FEA Deck (.inpt -> .inp)",
        icon: "file-code",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "materialize_deck",
      },
      {
        id: "runSimulation",
        label: "Run FEA Structural Simulation",
        shortLabel: "Run FEA",
        tooltip: "Run FEA Structural Simulation",
        icon: "play",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "run_simulation",
      },
    ],
  },

  // IDE and AI agent actions for 3D FEA mesh viewing, template materialization, and linear-elasticity simulation
  actions: [
    {
      id: "open_fea_viewer",
      title: "Open 3D FEA Deck Viewer",
      description: "Opens the 3D finite element deck viewer showing nodes, elements, boundary conditions, and loads.",
      category: "query",
      execute: async (
        ctx: FeaActionContext,
        params: { documentText?: string | undefined; uri?: string | undefined },
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
        ctx: FeaActionContext,
        params: {
          documentText?: string | undefined;
          uri?: string | undefined;
          options?: MaterializeOptions | undefined;
        },
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
      execute: async (
        ctx: FeaActionContext,
        params: { documentText?: string | undefined; uri?: string | undefined },
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
  polyglot: feaPolyglotConfig,

  primitives: {
    lineComment: "**",
  },

  extras: () => [/[ \t\r\n]+/, /(?:\*\*|\$|#)[^\r\n]*/],

  rules: {
    // Root FEA deck rule exposing Salsa instantiation and name-resolution queries
    SourceFile: ($) =>
      def({
        syntax: repeat(choice($["KeywordCard"]!, $["DataToken"]!)),
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

    // Abaqus/CalculiX keyword card (`*KEYWORD, PARAM=VAL`) indexed as a Section symbol
    KeywordCard: ($) =>
      def({
        syntax: prec.right(
          2,
          seq(
            field("name", $["CARD_HEADER"]!),
            repeat(seq(",", choice($["ParameterAssignment"]!, field("parameter", $["KeywordScalar"]!)))),
          ),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Section",
          name: (self["name"] ?? "*KEYWORD").replace(/^\*/, ""),
        }),
      }),

    KeywordScalar: ($) =>
      prec(1, choice($["IDENTIFIER"]!, $["QUALIFIED_IDENT"]!, $["NUMBER"]!, $["STRING"]!, $["EmbeddedExpression"]!)),

    ParameterAssignment: ($) =>
      seq(field("param", $["IDENTIFIER"]!), prec(3, "="), field("value", $["KeywordScalar"]!)),

    DataToken: ($) =>
      choice(
        $["NUMBER"]!,
        $["IDENTIFIER"]!,
        $["QUALIFIED_IDENT"]!,
        $["STRING"]!,
        $["EmbeddedExpression"]!,
        seq("(", repeat($["DataToken"]!), ")"),
        ",",
        "=",
        ":",
        "-",
        "+",
        "/",
        "&",
        ".",
      ),

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

    CallExpression: ($) =>
      seq(
        field("callee", $["QualifiedIdentifier"]!),
        "(",
        optional(seq($["Expression"]!, repeat(seq(",", $["Expression"]!)))),
        ")",
      ),

    PrimaryExpression: ($) =>
      choice(
        $["CallExpression"]!,
        $["QualifiedIdentifier"]!,
        $["NUMBER"]!,
        $["STRING"]!,
        seq("(", $["Expression"]!, ")"),
      ),

    QualifiedIdentifier: ($) => choice($["IDENTIFIER"]!, $["QUALIFIED_IDENT"]!),

    CARD_HEADER: () => /\*[A-Za-z_][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z_][A-Za-z0-9_-]*)*/,
    QUALIFIED_IDENT: () => /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/,
    IDENTIFIER: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NUMBER: () => /[+-]?(?:(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+|[+-]\d+)?|\d+(?:[eE][+-]?\d+)?)/,
    STRING: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInFeaLibrarySync();
